import Foundation
import Network
import Observation

/// Optional addition to `RecordSyncing` (proposed to the journal store): make every live local record pending again.
/// The engine calls it after pairing with a hub other than the one the store last synced with (or after the hub lost
/// its data), so everything on the device goes up to the new hub. A store without it uploads only what is pending.
@MainActor
protocol RecordSyncResetting: AnyObject {
    func markAllPending()
}

/// Two-way sync of the journal with a paired hub (hub/API.md), and the state the hub settings page shows.
///
/// The journal's store attaches itself at launch and reports local saves; the UI reads `status` and calls the rest:
///
///     SyncEngine.shared.attach(JournalStore.shared)     // once, at launch
///     SyncEngine.shared.localChanged()                  // after every local save or delete (debounced sync)
///     await SyncEngine.shared.syncNow()                 // pull to refresh
///     let file = try await SyncEngine.shared.ensureBlob(hash)   // a video (or any blob) the device lacks
///
/// A pass pushes, then pulls, then reads the vector feed:
/// - **push**: `pendingRecords()` → `POST /v1/blobs/check` → upload what the hub lacks (smallest first, so the largest
///   go last; an interrupted pass resumes at the first blob the hub still lacks) → `POST /v1/records/batch` in chunks
///   of 100 → 201/200 `markUploaded`, 409 `applyRemote(current)`, 422 upload the missing blobs and retry once.
/// - **pull**: `GET /v1/changes` from `changeCursor`, 500 at a time → `applyRemote` → save the cursor. Posters,
///   photos and audio of the records pulled download in the background, three at a time; videos when asked for.
/// - **vectors**: `GET /v1/vectors?dim=256` from `vectorCursor` into the on-disk `VectorIndex` (for `SemanticSearch`).
///
/// Passes run on pairing, on launch and foreground, a few seconds after local saves, on request, after network
/// recovery, with backoff after failures, and in a background refresh task on iOS; while the app is active a long poll
/// (`changes?wait=25`) brings other devices' entries in within a second. Everything waits on the network off the main
/// actor; only applying records to the store runs on it.
@MainActor @Observable
final class SyncEngine {
    static let shared = SyncEngine()

    // MARK: State for the UI

    enum Status: Equatable, Sendable {
        /// No hub: the journal is local only.
        case unpaired
        /// Paired and up to date (or waiting for the next pass).
        case idle
        case syncing(SyncProgress)
        /// The hub cannot be reached; the engine retries by itself.
        case offline
        /// The hub answered 401: the device's token was revoked. Local data stays; pair again.
        case revoked
        /// Something else went wrong; retried with backoff.
        case error(String)
    }

    struct SyncProgress: Equatable, Sendable {
        enum Phase: Sendable { case connecting, uploadingMedia, sendingEntries, receivingEntries, indexing }

        var phase: Phase
        var done = 0
        var total = 0
        var bytesDone: Int64 = 0
        var bytesTotal: Int64 = 0

        /// "Uploading 3 of 12 · 41 MB".
        var text: String {
            switch phase {
            case .connecting: "Connecting…"
            case .uploadingMedia: "Uploading \(min(done + 1, total)) of \(total) · \(SyncEngine.bytes(bytesTotal))"
            case .sendingEntries: "Sending \(done) of \(total) \(total == 1 ? "entry" : "entries")"
            case .receivingEntries: done == 0 ? "Checking for changes…" : "Receiving entries · \(done)"
            case .indexing: "Updating search · \(done)"
            }
        }

        /// 0…1 when the phase has a known size.
        var fraction: Double? {
            switch phase {
            case .uploadingMedia: bytesTotal > 0 ? Double(bytesDone) / Double(bytesTotal) : nil
            case .sendingEntries: total > 0 ? Double(done) / Double(total) : nil
            default: nil
            }
        }
    }

    private(set) var status: Status = .unpaired
    /// What pairing stored (hub address and name, this device's name and client id); nil when unpaired.
    private(set) var credentials: HubCredentials?
    /// The hub's `GET /v1` from the last pass or address check.
    private(set) var hubInfo: HubInfo?
    /// The end of the last complete pass.
    private(set) var lastSync: Date?
    /// Records waiting to go up.
    private(set) var pendingCount = 0
    /// Records on the hub, all kinds (`GET /v1/kinds`), and of them journal entries.
    private(set) var hubRecordCount: Int?
    private(set) var hubEntryCount: Int?
    /// Records with vectors on this device (semantic search works for them).
    private(set) var vectorRecordCount = 0
    /// Media still to download in the background.
    private(set) var mediaRemaining = 0
    /// A note about records or media the last pass could not send (shown under the status), nil when all went.
    private(set) var problem: String?
    /// Uploads of media are waiting for Wi-Fi ("Upload media on cellular" is off).
    private(set) var waitingForWiFi = false

    var isPaired: Bool { credentials != nil }
    var isSyncing: Bool { if case .syncing = status { true } else { false } }
    private var isFailed: Bool { if case .error = status { true } else { false } }

    /// "Download all media": videos too, in the background (off: when opened).
    var downloadAllMedia: Bool {
        didSet {
            defaults.set(downloadAllMedia, forKey: Keys.downloadAll)
            if downloadAllMedia { startDownloads() }
        }
    }

    /// "Upload media on cellular" (default on).
    var uploadMediaOnCellular: Bool {
        didSet {
            defaults.set(uploadMediaOnCellular, forKey: Keys.cellular)
            if uploadMediaOnCellular && waitingForWiFi { requestPass() }
        }
    }

    /// One line for the status: "Up to date", "3 waiting to upload", "Uploading 3 of 12 · 41 MB", "Hub revoked this
    /// device" …
    var statusText: String {
        switch status {
        case .unpaired: "Not paired"
        case .idle:
            if waitingForWiFi && pendingCount > 0 { "Waiting for Wi-Fi to upload media" }
            else if pendingCount > 0 { "\(pendingCount) waiting to upload" }
            else if mediaRemaining > 0 { "Downloading media · \(mediaRemaining) left" }
            else { "Up to date" }
        case .syncing(let progress): progress.text
        case .offline: "Can’t reach the hub"
        case .revoked: "Hub revoked this device"
        case .error(let message): message
        }
    }

    // MARK: Dependencies

    private let secrets: any HubSecretStore
    private let defaults: UserDefaults
    private let directory: URL?
    private let session: URLSession
    private(set) var store: (any RecordSyncing)?
    let vectors: VectorIndex
    @ObservationIgnored private var ledger: MediaLedger
    @ObservationIgnored private var ledgerChanged = false

    /// Long-poll length in seconds (`changes?wait=`), and the pause after a local save before a pass.
    var livePollWait = 25
    var localChangeDelay: Duration = .seconds(3)
    /// Records per batch request, and per changes page.
    var batchSize = 100
    var pageSize = 500

    private enum Keys {
        static let downloadAll = "hub.downloadAllMedia"
        static let cellular = "hub.uploadMediaOnCellular"
        static let lastSync = "hub.lastSync"
        static let lastHub = "hub.lastHubId"
    }

    /// - Parameters:
    ///   - secrets: where the credentials and device id live (the Keychain in the app).
    ///   - defaults: the media preferences, last sync time and the last hub synced with.
    ///   - directory: the vector index and media ledger (Application Support/Hub in the app); nil keeps them in memory.
    init(secrets: any HubSecretStore = HubKeychain.standard, defaults: UserDefaults = .standard,
         directory: URL? = SyncEngine.defaultDirectory, session: URLSession = HubClient.defaultSession) {
        self.secrets = secrets
        self.defaults = defaults
        self.directory = directory
        self.session = session
        vectors = VectorIndex(directory: directory)
        ledger = MediaLedger.load(from: directory?.appendingPathComponent("media.json"))
        downloadAllMedia = defaults.bool(forKey: Keys.downloadAll)
        uploadMediaOnCellular = defaults.object(forKey: Keys.cellular) as? Bool ?? true
        if let last = defaults.object(forKey: Keys.lastSync) as? Double { lastSync = Date(timeIntervalSince1970: last) }
        credentials = secrets.load()
        status = credentials == nil ? .unpaired : .idle
        if let credentials, defaults.string(forKey: Keys.lastHub) == nil {
            defaults.set(credentials.hubId, forKey: Keys.lastHub)
        }
        vectorsLoaded = Task { [vectors] in await vectors.load() }
    }

    /// Application Support/Hub, kept out of backups (the hub has it all).
    nonisolated static var defaultDirectory: URL? {
        guard var url = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                     appropriateFor: nil, create: true) else { return nil }
        url.appendPathComponent("Hub", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }

    /// A client for the paired hub.
    var client: HubClient? {
        credentials.map { HubClient(base: $0.hubURL, token: $0.token, session: session) }
    }

    // MARK: Store and lifecycle

    /// The journal's store: the engine reads pending records from it and applies the hub's. Starts a pass when paired.
    func attach(_ store: any RecordSyncing) {
        self.store = store
        pendingCount = store.pendingRecords().count
        startPathMonitor()
        requestPass()
    }

    /// The store saved or deleted something: sync a few seconds later (repeated saves push the pass back).
    func localChanged() {
        guard let store else { return }
        pendingCount = store.pendingRecords().count
        guard isPaired else { return }
        debounce?.cancel()
        debounce = Task { [localChangeDelay] in
            try? await Task.sleep(for: localChangeDelay)
            guard !Task.isCancelled else { return }
            self.requestPass()
        }
    }

    /// The app came to the front: sync, then keep a long poll open for other devices' changes.
    func becameActive() {
        isActive = true
        startPathMonitor()
        requestPass()
        startLive()
    }

    /// The app left the front: stop the long poll (a running pass finishes while the system allows).
    func enteredBackground() {
        isActive = false
        live?.cancel()
        live = nil
    }

    /// One pass now, waiting for it (and for one already running). For pull to refresh and the Sync now button.
    func syncNow() async {
        retry?.cancel()
        retryDelay = .seconds(5)
        if status == .revoked { status = .idle }
        requestPass()
        await pass?.value
    }

    /// A pass for the background refresh task; returns when it is done (or cancelled).
    func backgroundSync() async {
        requestPass()
        await pass?.value
        await downloads?.value
    }

    // MARK: Pairing

    /// `GET /v1` at a typed address: the hub's name, version and whether search works. Throws `HubError`.
    func checkAddress(_ text: String) async throws -> (url: URL, info: HubInfo) {
        guard let url = HubAddress.normalize(text) else { throw HubError.invalidAddress(text) }
        let info = try await HubClient(base: url, session: session).info()
        return (url, info)
    }

    /// Pairs with the hub at `url` using a code from its web page, as `name`. On success the credentials go to the
    /// Keychain and a pass starts: everything pending (everything ever written here, on a first pairing) uploads.
    @discardableResult
    func pair(url: URL, code: String, name: String, platform: String = HubDevice.platform) async throws -> HubPairResponse {
        let base = HubClient(base: url, session: session)
        let response = try await base.pair(code: code, name: name, platform: platform, device: secrets.deviceId())
        let credentials = HubCredentials(hubURL: url, token: response.token, clientId: response.client.id,
                                         clientName: response.client.name, hubId: response.hub.id,
                                         hubName: response.hub.name, paired: Date.now.timeIntervalSince1970)
        do {
            try secrets.save(credentials)
        } catch {
            throw HubError.file("Could not keep the hub’s token: \(error.localizedDescription)")
        }
        cancelWork()
        let previous = defaults.string(forKey: Keys.lastHub)
        if previous != response.hub.id {
            // Another hub (or one never synced with): read its whole feed and give it everything.
            if let store {
                store.changeCursor = 0
                store.vectorCursor = 0
                (store as? RecordSyncResetting)?.markAllPending()
            }
            await vectors.reset(model: nil)
            try? await vectors.save()
            ledger.removeAll()
            saveLedger(force: true)
            lastSync = nil
            defaults.removeObject(forKey: Keys.lastSync)
        }
        defaults.set(response.hub.id, forKey: Keys.lastHub)
        self.credentials = credentials
        hubInfo = nil
        problem = nil
        status = .idle
        retryDelay = .seconds(5)
        pendingCount = store?.pendingRecords().count ?? 0
        requestPass()
        startLive()
        return response
    }

    /// Forgets the hub on this device. Local entries stay; pairing again (with the same hub) continues where it left.
    /// The hub keeps this device's client until it is removed in the hub's web page; pairing again replaces its token.
    func unpair() {
        cancelWork()
        secrets.delete()
        credentials = nil
        hubInfo = nil
        hubRecordCount = nil
        hubEntryCount = nil
        problem = nil
        waitingForWiFi = false
        mediaRemaining = 0
        status = .unpaired
    }

    private func cancelWork() {
        live?.cancel()
        live = nil
        pass?.cancel()
        pass = nil
        rerun = false
        retry?.cancel()
        retry = nil
        debounce?.cancel()
        downloads?.cancel()
        downloads = nil
    }

    // MARK: Passes

    @ObservationIgnored private var pass: Task<Void, Never>?
    @ObservationIgnored private var rerun = false
    @ObservationIgnored private var retry: Task<Void, Never>?
    @ObservationIgnored private var retryDelay: Duration = .seconds(5)
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var live: Task<Void, Never>?
    @ObservationIgnored private var isActive = false
    @ObservationIgnored private var downloads: Task<Void, Never>?
    @ObservationIgnored private var vectorRefresh: Task<Void, Never>?
    @ObservationIgnored private var inflight: [String: Task<URL, any Error>] = [:]
    @ObservationIgnored private var vectorsLoaded: Task<Void, Never>?
    @ObservationIgnored private var pathMonitor: NWPathMonitor?
    /// Bumped whenever a task starts, so a cancelled one finishing late does not clear its successor.
    @ObservationIgnored private var generation = (pass: 0, live: 0, downloads: 0)

    /// Starts a pass, or one more after the running one.
    func requestPass() {
        guard credentials != nil, store != nil, status != .revoked else { return }
        if pass != nil {
            rerun = true
            return
        }
        generation.pass += 1
        let id = generation.pass
        pass = Task {
            repeat {
                rerun = false
                await runPass()
            } while rerun && !Task.isCancelled
            if generation.pass == id { pass = nil }
        }
    }

    private func runPass() async {
        guard let client, let store else { return }
        retry?.cancel()
        status = .syncing(SyncProgress(phase: .connecting))
        do {
            let info = try await client.info()
            hubInfo = info
            if let credentials, info.hub.id != credentials.hubId {
                throw HubError.api(HubAPIError(status: 409, body: HubErrorBody(
                    code: "conflict", message: "Another hub answers at this address; pair again")))
            }
            try await push(client, store)
            try await pull(client, store)
            try await refreshVectors(client, store, model: info.embedding?.model)
            if let kinds = try? await client.kinds() {
                hubRecordCount = kinds.kinds.reduce(0) { $0 + $1.count }
                hubEntryCount = kinds.kinds.first { $0.kind == JournalEntry.kind }?.count ?? 0
            }
            pendingCount = store.pendingRecords().count
            lastSync = .now
            defaults.set(Date.now.timeIntervalSince1970, forKey: Keys.lastSync)
            retryDelay = .seconds(5)
            status = .idle
            startDownloads()
            if waitingForWiFi { scheduleRetry(after: .seconds(60)) }
        } catch {
            fail(HubError.from(error))
        }
    }

    private func fail(_ error: HubError) {
        pendingCount = store?.pendingRecords().count ?? pendingCount
        switch error {
        case .cancelled:
            status = isPaired ? .idle : .unpaired
        case .api(let api) where api.code == .unauthorized:
            status = .revoked
            live?.cancel()
            live = nil
            downloads?.cancel()
        case .offline, .transport:
            status = .offline
            scheduleRetry()
        case .api(let api):
            status = .error(error.localizedDescription)
            scheduleRetry(after: api.retryAfter.map { .seconds($0) })
        default:
            status = .error(error.localizedDescription)
            scheduleRetry()
        }
    }

    private func scheduleRetry(after delay: Duration? = nil) {
        retry?.cancel()
        let wait = delay ?? retryDelay
        if delay == nil { retryDelay = min(retryDelay * 2, .seconds(300)) }
        retry = Task {
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled else { return }
            self.requestPass()
        }
    }

    // MARK: Push

    private func push(_ client: HubClient, _ store: any RecordSyncing) async throws {
        let pending = store.pendingRecords()
        pendingCount = pending.count
        problem = nil
        waitingForWiFi = false
        guard !pending.isEmpty else { return }
        var problems: [String] = []

        var refs: [String: BlobRef] = [:]
        for record in pending where !record.isDeleted {
            for blob in record.blobs ?? [] { refs[blob.hash.lowercased()] = blob }
        }
        var unsent = Set<String>()
        if !refs.isEmpty {
            var missing: [String] = []
            for chunk in refs.keys.sorted().hubChunks(of: 1000) {
                missing += try await client.missingBlobs(chunk).map { $0.lowercased() }
            }
            unsent = try await upload(Set(missing), refs: refs, client, store, problems: &problems)
        }
        let ready = pending.filter { !blocked($0, by: unsent) }
        let held = pending.count - ready.count
        if held > 0 && !waitingForWiFi {
            problems.append("\(held) \(held == 1 ? "entry names" : "entries name") media missing on this device")
        }
        try await send(ready, refs: refs, client, store, retrying: true, problems: &problems)
        pendingCount = store.pendingRecords().count
        problem = problems.isEmpty ? nil : problems.joined(separator: " · ")
    }

    private func blocked(_ record: HubRecord, by unsent: Set<String>) -> Bool {
        !record.isDeleted && (record.blobs ?? []).contains { unsent.contains($0.hash.lowercased()) }
    }

    /// Uploads `hashes` the hub lacks, smallest first. Returns the hashes that did not go up (not on this device,
    /// waiting for Wi-Fi, refused); throws on what stops the pass (offline, revoked).
    private func upload(_ hashes: Set<String>, refs: [String: BlobRef], _ client: HubClient,
                        _ store: any RecordSyncing, problems: inout [String]) async throws -> Set<String> {
        var unsent = Set<String>()
        var items: [(hash: String, ref: BlobRef, file: URL, size: Int64)] = []
        for hash in hashes {
            guard let ref = refs[hash], let file = store.blobFile(hash) else {
                unsent.insert(hash)
                continue
            }
            let size = (try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize).flatMap { $0 }.map(Int64.init)
            items.append((hash, ref, file, size ?? Int64(ref.size)))
        }
        items.sort { ($0.size, $0.hash) < ($1.size, $1.hash) }
        let total = items.reduce(Int64(0)) { $0 + $1.size }
        var done: Int64 = 0
        var refused = 0
        for (index, item) in items.enumerated() {
            try Task.checkCancellation()
            status = .syncing(SyncProgress(phase: .uploadingMedia, done: index, total: items.count,
                                           bytesDone: done, bytesTotal: total))
            let base = done
            do {
                try await client.uploadBlob(hash: item.hash, type: item.ref.type, file: item.file,
                                            allowsCellular: uploadMediaOnCellular) { [weak self] sent, _ in
                    Task { @MainActor in self?.uploaded(bytes: base + sent) }
                }
            } catch let error as HubError {
                switch error {
                case .cellularNotAllowed:
                    waitingForWiFi = true
                    unsent.insert(item.hash)
                case .api(let api) where api.code == .unprocessable || api.code == .tooLarge || api.code == .forbidden:
                    refused += 1
                    unsent.insert(item.hash)
                default:
                    throw error
                }
            }
            done += item.size
        }
        if refused > 0 { problems.append("The hub refused \(refused) media \(refused == 1 ? "file" : "files")") }
        return unsent
    }

    private func uploaded(bytes: Int64) {
        guard case .syncing(var progress) = status, progress.phase == .uploadingMedia else { return }
        progress.bytesDone = max(progress.bytesDone, min(bytes, progress.bytesTotal))
        status = .syncing(progress)
    }

    /// Sends records in batches; 409 adopts the hub's copy, 422 uploads what the hub says is missing and retries once.
    private func send(_ records: [HubRecord], refs: [String: BlobRef], _ client: HubClient, _ store: any RecordSyncing,
                      retrying: Bool, problems: inout [String]) async throws {
        guard !records.isEmpty else { return }
        var again: [HubRecord] = []
        var missing = Set<String>()
        var rejected: [String] = []
        var sent = 0
        for chunk in records.hubChunks(of: max(1, min(batchSize, 500))) {
            try Task.checkCancellation()
            status = .syncing(SyncProgress(phase: .sendingEntries, done: sent, total: records.count))
            let results = try await client.putRecords(chunk)
            let byId = Dictionary(chunk.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
            for item in results {
                guard let local = byId[item.id] else { continue }
                switch item.status {
                case 200, 201:
                    store.markUploaded(item.record ?? local)
                case 409:
                    var current = item.error?.current
                    if current == nil { current = try? await client.record(item.id) }
                    if let current { adopt(current, over: local, store) }
                case 422:
                    again.append(local)
                    missing.formUnion((item.error?.missing ?? []).map { $0.lowercased() })
                case 401:
                    throw HubError.api(HubAPIError(status: 401, body: item.error))
                default:
                    rejected.append(item.error?.message ?? HTTPURLResponse.localizedString(forStatusCode: item.status))
                }
            }
            sent += chunk.count
        }
        if !rejected.isEmpty {
            problems.append("The hub refused \(rejected.count) \(rejected.count == 1 ? "entry" : "entries"): \(rejected[0])")
        }
        guard !again.isEmpty else { return }
        if retrying {
            var refs = refs
            for record in again { for blob in record.blobs ?? [] { refs[blob.hash.lowercased()] = blob } }
            let unsent = try await upload(missing, refs: refs, client, store, problems: &problems)
            try await send(again.filter { !blocked($0, by: unsent) }, refs: refs, client, store, retrying: false,
                           problems: &problems)
        } else {
            problems.append("\(again.count) \(again.count == 1 ? "entry names" : "entries name") media the hub lacks")
        }
    }

    /// The hub kept its copy (409): adopt it. A newer copy goes through `applyRemote`; one with the same `updated` won
    /// the hub's tie rule (the greater canonical hash), which the store's tie rule (keep a pending local copy) would
    /// refuse forever, so it is taken as accepted with `markUploaded`, which clears pending.
    private func adopt(_ current: HubRecord, over sent: HubRecord, _ store: any RecordSyncing) {
        if current.updated == sent.updated {
            store.markUploaded(current)
        } else {
            store.applyRemote(current)
        }
        if ledger.update(current) { ledgerChanged = true }
    }

    // MARK: Pull

    private func pull(_ client: HubClient, _ store: any RecordSyncing) async throws {
        var after = store.changeCursor
        var received = 0
        var restarted = false
        status = .syncing(SyncProgress(phase: .receivingEntries))
        while true {
            try Task.checkCancellation()
            let page = try await client.changes(after: after, limit: pageSize)
            if page.changes.isEmpty && !page.more && page.cursor < after && !restarted {
                // The hub's feed is behind the cursor: it lost its data (or was replaced). Read it all and give it all.
                restarted = true
                after = 0
                store.changeCursor = 0
                (store as? RecordSyncResetting)?.markAllPending()
                continue
            }
            apply(page.changes, to: store)
            received += page.changes.count
            after = page.cursor
            store.changeCursor = after
            status = .syncing(SyncProgress(phase: .receivingEntries, done: received))
            if !page.more || page.changes.isEmpty { break }
        }
        saveLedger()
    }

    private func apply(_ records: [HubRecord], to store: any RecordSyncing) {
        guard !records.isEmpty else { return }
        for record in records {
            store.applyRemote(record)
            if ledger.update(record) { ledgerChanged = true }
        }
    }

    private func saveLedger(force: Bool = false) {
        guard ledgerChanged || force else { return }
        ledgerChanged = false
        ledger.save(to: directory?.appendingPathComponent("media.json"))
    }

    // MARK: Live

    /// Keeps `GET /v1/changes?wait=` open while the app is active, applying what arrives at once.
    private func startLive() {
        guard live == nil, isActive, credentials != nil, store != nil, status != .revoked else { return }
        generation.live += 1
        let id = generation.live
        live = Task {
            var backoff: Duration = .seconds(2)
            while !Task.isCancelled {
                guard let client, let store, status != .revoked else { break }
                let after = store.changeCursor
                do {
                    let page = try await client.changes(after: after, limit: pageSize, wait: livePollWait)
                    backoff = .seconds(2)
                    guard !Task.isCancelled else { break }
                    if page.changes.isEmpty && !page.more { continue }
                    if pass == nil && store.changeCursor == after && !page.more {
                        apply(page.changes, to: store)
                        store.changeCursor = page.cursor
                        saveLedger()
                        startDownloads()
                        scheduleVectorRefresh()
                    } else {
                        requestPass()
                        try? await Task.sleep(for: .milliseconds(500))
                    }
                } catch {
                    let error = HubError.from(error)
                    if case .cancelled = error { break }
                    if error.isUnauthorized {
                        status = .revoked
                        break
                    }
                    if case .offline = error, !isSyncing { status = .offline }
                    try? await Task.sleep(for: backoff)
                    backoff = min(backoff * 2, .seconds(60))
                    if status == .offline { requestPass() }
                }
            }
            if generation.live == id { live = nil }
        }
    }

    // MARK: Vectors

    /// Reads the vector feed into the index (one refresh at a time). `model` is the hub's current one: a different
    /// model than the index holds starts the index over (the hub's `vrev` restarted).
    private func refreshVectors(_ client: HubClient, _ store: any RecordSyncing, model: String?) async throws {
        if let running = vectorRefresh {
            await running.value
            return
        }
        let work = Task { () throws -> Void in
            try await readVectors(client, store, model: model)
        }
        vectorRefresh = Task { _ = try? await work.value }
        defer { vectorRefresh = nil }
        try await work.value
    }

    private func readVectors(_ client: HubClient, _ store: any RecordSyncing, model: String?) async throws {
        await vectorsLoaded?.value
        let held = await vectors.model
        if let model, !model.isEmpty, let held, held != model {
            await vectors.reset(model: model)
            store.vectorCursor = 0
        }
        if store.vectorCursor != (await vectors.cursor) {
            // The store and the index disagree (one was reset or lost): read the feed again from the start.
            await vectors.reset(model: model)
            store.vectorCursor = 0
        }
        var restarted = false
        while true {
            try Task.checkCancellation()
            let after = await vectors.cursor
            let page = try await client.vectors(after: after, dim: vectors.dim, limit: 2000)
            if await !vectors.apply(page) {
                guard !restarted else { break }
                restarted = true
                await vectors.reset(model: page.model)
                store.vectorCursor = 0
                continue
            }
            store.vectorCursor = await vectors.cursor
            if page.vectors.count > 50 {
                status = .syncing(SyncProgress(phase: .indexing, done: await vectors.count))
            }
            if !page.more || page.vectors.isEmpty { break }
        }
        try? await vectors.save()
        vectorRecordCount = await vectors.recordCount
    }

    /// A quiet vector refresh (after live changes, the worker needs a moment; before a semantic search).
    func refreshVectorsQuietly() async {
        guard let client, let store, status != .revoked else { return }
        try? await refreshVectors(client, store, model: hubInfo?.embedding?.model)
    }

    private func scheduleVectorRefresh() {
        Task {
            for delay in [5, 30] {
                try? await Task.sleep(for: .seconds(delay))
                await self.refreshVectorsQuietly()
            }
        }
    }

    // MARK: Media

    /// The local file of blob `hash`, downloading it first (and verifying its SHA-256) when the device lacks it. For a
    /// video opened, or any blob the store does not have yet. Throws `HubError`.
    func ensureBlob(_ hash: String) async throws -> URL {
        let hash = hash.lowercased()
        guard let store else { throw HubError.file("The journal is not ready") }
        if let file = store.blobFile(hash) { return file }
        if let running = inflight[hash] { return try await running.value }
        guard let client, status != .revoked else { throw HubError.notPaired }
        let task = Task { () throws -> URL in
            let temp = try await client.downloadBlob(hash: hash)
            do {
                try store.storeBlob(hash, from: temp)
            } catch {
                try? FileManager.default.removeItem(at: temp)
                throw HubError.file("Could not keep a downloaded file: \(error.localizedDescription)")
            }
            guard let file = store.blobFile(hash) else { throw HubError.file("The journal did not keep a downloaded file") }
            return file
        }
        inflight[hash] = task
        defer { inflight[hash] = nil }
        do {
            return try await task.value
        } catch {
            throw HubError.from(error)
        }
    }

    /// A preview of a blob made by the hub (`?thumb=<px>`, 64…2048), with the token in the URL so `AsyncImage` can load
    /// it; the hub answers 404 when it cannot make one (fall back to the poster or the blob). Nil when unpaired.
    func thumbnailURL(hash: String, px: Int) -> URL? {
        client?.thumbnailURL(hash: hash, px: px)
    }

    /// A blob on the hub with the token in the URL, to stream a video the device does not have (`AVPlayer`) instead of
    /// waiting for `ensureBlob`. Nil when unpaired.
    func remoteBlobURL(hash: String) -> URL? {
        client?.blobURL(hash: hash)
    }

    /// A hub-made JPEG preview, cached in Caches/HubThumbnails. Throws `.api(.notFound)` when the hub cannot make one.
    func thumbnail(hash: String, px: Int) async throws -> URL {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("HubThumbnails", isDirectory: true)
        let file = caches.appendingPathComponent("\(hash.lowercased())-\(px).jpg")
        if FileManager.default.fileExists(atPath: file.path) { return file }
        guard let client else { throw HubError.notPaired }
        let data = try await client.thumbnail(hash: hash, px: px)
        try? FileManager.default.createDirectory(at: caches, withIntermediateDirectories: true)
        try data.write(to: file, options: .atomic)
        return file
    }

    /// Downloads, three at a time, what `MediaLedger` wants and the store lacks.
    func startDownloads() {
        guard downloads == nil, credentials != nil, store != nil, status != .revoked else { return }
        generation.downloads += 1
        let id = generation.downloads
        downloads = Task {
            var skipped = Set<String>()
            outer: while !Task.isCancelled {
                guard let store else { break }
                let wanted = ledger.wanted(all: downloadAllMedia) { store.blobFile($0) != nil || skipped.contains($0) }
                mediaRemaining = wanted.count
                if wanted.isEmpty { break }
                for group in wanted.hubChunks(of: 3) {
                    var stop = false
                    let tasks = group.map { item in
                        Task { () -> (String, HubError?) in
                            do {
                                _ = try await self.ensureBlob(item.hash)
                                return (item.hash, nil)
                            } catch {
                                return (item.hash, HubError.from(error))
                            }
                        }
                    }
                    let results = await withTaskCancellationHandler {
                        var results: [(String, HubError?)] = []
                        for task in tasks { results.append(await task.value) }
                        return results
                    } onCancel: {
                        for task in tasks { task.cancel() }
                    }
                    for (hash, error) in results {
                        mediaRemaining = max(0, mediaRemaining - 1)
                        guard let error else { continue }
                        switch error {
                        case .api(let api) where api.code == .notFound || api.code == .forbidden:
                            ledger.markGone(hash)
                            ledgerChanged = true
                        case .cancelled, .offline, .transport, .api, .notPaired:
                            stop = true
                        default:
                            skipped.insert(hash)
                        }
                    }
                    if stop || Task.isCancelled { break outer }
                }
            }
            saveLedger()
            mediaRemaining = store.map { store in
                ledger.wanted(all: downloadAllMedia) { store.blobFile($0) != nil }.count
            } ?? 0
            if generation.downloads == id { downloads = nil }
        }
    }

    // MARK: Network

    private func startPathMonitor() {
        guard pathMonitor == nil else { return }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in self?.pathChanged(satisfied: satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "app.fractonica.hub.path"))
        pathMonitor = monitor
    }

    private func pathChanged(satisfied: Bool) {
        guard isPaired else { return }
        if satisfied {
            if status == .offline || waitingForWiFi || isFailed {
                retryDelay = .seconds(5)
                requestPass()
            }
            startLive()
        } else if !isSyncing && status != .revoked {
            status = .offline
        }
    }

    // MARK: Formatting

    nonisolated static func bytes(_ count: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: count, countStyle: .file)
    }
}

extension Array {
    /// The array in consecutive pieces of at most `size`.
    func hubChunks(of size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0 ..< Swift.min($0 + size, count)]) }
    }
}
