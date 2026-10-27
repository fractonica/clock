import Foundation
import Observation

/// The journal's local store: the single owner of records and blob files on disk (layout in `JournalDisk`). Every
/// record — the device's own entries and, once the hub sync runs, everything the hub sends, of any kind — is kept as
/// its exact API JSON, so it round-trips between the device and the hub unchanged.
///
///     @State private var journal = JournalStore.shared
///     journal.entries                      // live journal entries, newest first
///     journal.saveEntry(draft)             // create or edit: updated = now, pending
///     journal.delete(id)                   // a tombstone, pending until uploaded, hidden at once
///
/// Local writes (create, edit, delete) set `updated` to now and make the record **pending**: listed by
/// `pendingRecords()` until the hub accepts it (`markUploaded`). A deletion is a tombstone record (`deleted`, empty
/// `data` and `blobs`) kept until it is uploaded and hidden from the journal meanwhile; its media go from disk at once
/// when nothing else names them. Records from the hub (`applyRemote`) never become pending; last writer wins by
/// `updated`, exactly as `RecordSyncing` documents.
///
/// **Change hook for the sync engine.** `onLocalChange` is called on the main actor after every local write that made
/// something pending (a save, an edit, a delete), once per write, after the record and state are on disk:
///
///     JournalStore.shared.onLocalChange = { HubSync.shared.scheduleUpload() }
///
/// It is not called for `applyRemote` / `markUploaded` (the sync engine's own writes). `revision` changes on every
/// change to the records, for views that cache derived lists.
///
/// The index loads off the main thread at launch (`load()`, from `JournalHooks.launch`); until it has, `isLoaded` is
/// false and the journal shows nothing. Launch arguments: `-FXJournalStore <dir>` keeps the journal in another folder,
/// `-FXJournalSeed 1` fills an empty journal with sample entries (`JournalSeed`).
@MainActor @Observable
final class JournalStore: RecordSyncing {
    static let shared = JournalStore(disk: .standard)

    let disk: JournalDisk

    /// Every record on the device by id, tombstones still waiting for upload included.
    private(set) var records: [String: HubRecord] = [:]
    /// Bumped on every change to `records`.
    private(set) var revision = 0
    /// Bumped whenever a blob file arrives (adopted, imported or downloaded): media views waiting for one look again.
    private(set) var blobArrivals = 0
    private(set) var isLoaded = false

    /// Called after every local write that made something pending (see the type's documentation).
    @ObservationIgnored var onLocalChange: (@MainActor () -> Void)?
    /// The clock for `updated` and `created`; replaced by the checks.
    @ObservationIgnored var now: () -> Double = { Date().timeIntervalSince1970 }
    /// Applied to every record this device writes (`save`, `saveEntry`, `rewrite`) before it is stored: the one place
    /// derived fields are kept current (JournalHooks installs the sky tags, `SkyTags.normalise`). Not applied to records
    /// from the hub.
    @ObservationIgnored var normalise: (@MainActor (HubRecord) -> HubRecord)?

    @ObservationIgnored private var state = JournalState()
    @ObservationIgnored private var pending: Set<String> = []
    /// Blob files present, by hash: the file name (hash.ext).
    @ObservationIgnored private var blobFiles: [String: String] = [:]
    @ObservationIgnored private var drafts: [String: JournalDraft] = [:]
    @ObservationIgnored private var loading: Task<Void, Never>?

    init(disk: JournalDisk) {
        self.disk = disk
    }

    // MARK: Loading

    /// Reads the index off the main thread, once; later calls wait for the first.
    func load() async {
        if isLoaded { return }
        if let loading { return await loading.value }
        let disk = disk
        let task = Task { @MainActor in
            let snapshot = await Task.detached(priority: .userInitiated) { disk.load() }.value
            self.adopt(snapshot)
        }
        loading = task
        await task.value
    }

    /// Reads the index on the calling thread (checks, and tools that need the store at once).
    func loadNow() {
        guard !isLoaded else { return }
        adopt(disk.load())
    }

    private func adopt(_ snapshot: JournalDisk.Snapshot) {
        records = Dictionary(snapshot.records.map { ($0.id, $0) }, uniquingKeysWith: { a, b in a.updated >= b.updated ? a : b })
        state = snapshot.state
        pending = Set(snapshot.state.pending).intersection(records.keys)
        blobFiles = snapshot.blobFiles
        drafts = Dictionary(snapshot.drafts.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        isLoaded = true
        revision += 1
        sweepBlobs()
    }

    // MARK: Reading

    /// Live journal entries (no tombstones), newest `time` first.
    var entries: [HubRecord] {
        records.values.filter { !$0.isDeleted && $0.kind == JournalEntry.kind }.sorted(by: Self.newestFirst)
    }

    /// Live records of other kinds (from other hub clients), newest first.
    var otherRecords: [HubRecord] {
        records.values.filter { !$0.isDeleted && $0.kind != JournalEntry.kind }.sorted(by: Self.newestFirst)
    }

    /// A live record by id.
    func record(_ id: String) -> HubRecord? {
        records[id].flatMap { $0.isDeleted ? nil : $0 }
    }

    func isPending(_ id: String) -> Bool { pending.contains(id) }

    nonisolated static func newestFirst(_ a: HubRecord, _ b: HubRecord) -> Bool {
        a.time != b.time ? a.time > b.time : a.id > b.id
    }

    // MARK: Local writes

    /// Creates or replaces a record written on this device: `updated` (and for a new record `created`) = now, pending.
    @discardableResult
    func save(_ record: HubRecord) -> HubRecord {
        var record = normalise?(record) ?? record
        let t = now()
        let old = records[record.id]
        if old == nil { record.created = t }
        // strictly newer than any version this device has seen, so last-writer-wins keeps the edit
        record.updated = max(t, (old?.updated ?? 0) + 0.001)
        commit(record, replacing: old)
        markPending(record.id)
        onLocalChange?()
        return record
    }

    /// Saves a draft as its entry: a new record, or an edit that keeps the record's hub fields.
    @discardableResult
    func saveEntry(_ draft: JournalDraft) -> HubRecord {
        var record = records[draft.recordID].flatMap { $0.isDeleted ? nil : $0 }
            ?? HubRecord.journalEntry(id: draft.recordID, time: draft.time, zone: draft.zone, entry: draft.entry, blobs: [], now: now())
        record.kind = JournalEntry.kind
        // a new entry whose moment nobody chose is stamped when it is saved
        record.time = draft.key == JournalDraft.newKey && draft.timeChosen != true ? now() : draft.time
        record.zone = draft.zone
        record.data = draft.entry.data.keepingFields(of: record.data)
        record.blobs = draft.blobs.isEmpty ? nil : draft.blobs
        record.deleted = nil
        let saved = save(record)
        discardDraft(draft.key)
        return saved
    }

    /// Writes several records again on this device at once (a migration: derived fields brought up to date): each is
    /// normalised, `updated` = now and pending, with one `onLocalChange` for all. Records no longer on the device or
    /// deleted meanwhile are skipped. Returns how many were written.
    @discardableResult
    func rewrite(_ changed: [HubRecord]) -> Int {
        var written = 0
        let t = now()
        for record in changed {
            guard let old = records[record.id], !old.isDeleted else { continue }
            var record = normalise?(record) ?? record
            record.updated = max(t, old.updated + 0.001)
            commit(record, replacing: old)
            pending.insert(record.id)
            written += 1
        }
        guard written > 0 else { return 0 }
        saveState()
        onLocalChange?()
        return written
    }

    /// The version of a one-off migration that ran on this store (0 when none has), kept in state.json.
    func migrationVersion(_ key: String) -> Int { state.migrations?[key] ?? 0 }

    func setMigrationVersion(_ key: String, _ version: Int) {
        var m = state.migrations ?? [:]
        m[key] = version
        state.migrations = m
        saveState()
    }

    /// Deletes a record: a tombstone, pending until uploaded and hidden at once; its media go from disk unless
    /// something else names them.
    func delete(_ id: String) {
        guard let old = records[id], !old.isDeleted else { return }
        let tombstone = old.tombstone(at: max(now(), old.updated + 0.001))
        commit(tombstone, replacing: old)
        markPending(id)
        onLocalChange?()
    }

    // MARK: RecordSyncing

    func pendingRecords() -> [HubRecord] {
        pending.compactMap { records[$0] }.sorted { $0.updated != $1.updated ? $0.updated < $1.updated : $0.id < $1.id }
    }

    func markUploaded(_ record: HubRecord) {
        // gone meanwhile (a tombstone from the feed removed it): nothing to keep
        guard let local = records[record.id] else { return }
        // only a strictly newer local edit stays pending; a tie (the engine's answer to a tie-409) takes the hub's copy
        if local.updated > record.updated { return }
        unmarkPending(record.id)
        if record.isDeleted {
            // the hub has the tombstone: the device no longer needs it
            remove(record.id, old: local)
        } else {
            commit(record, replacing: local)
        }
    }

    func applyRemote(_ record: HubRecord) {
        let local = records[record.id]
        if let local {
            if record.updated < local.updated { return }
            if record.updated == local.updated && pending.contains(record.id) { return }
        }
        unmarkPending(record.id)
        if record.isDeleted {
            if let local { remove(record.id, old: local) }
        } else {
            commit(record, replacing: local)
        }
    }

    /// Makes every record on the device pending again, live ones and tombstones (the sync layer calls it when the
    /// device pairs with a different hub, so everything uploads there). No `onLocalChange`: the caller syncs.
    func markAllPending() {
        pending = Set(records.keys)
        saveState()
    }

    func blobFile(_ hash: String) -> URL? {
        guard let name = blobFiles[hash] else { return nil }
        return disk.blobs.appending(path: name)
    }

    func storeBlob(_ hash: String, from file: URL) throws {
        try storeBlob(hash, from: file, type: blobType(hash))
    }

    var changeCursor: Int {
        get { state.changeCursor }
        set { state.changeCursor = newValue; saveState() }
    }

    var vectorCursor: Int {
        get { state.vectorCursor }
        set { state.vectorCursor = newValue; saveState() }
    }

    // MARK: Blobs

    /// Adopts a file as the blob `hash` of MIME `type` (moved into the store; a copy already there wins). Returns its
    /// file.
    @discardableResult
    func storeBlob(_ hash: String, from file: URL, type: String?) throws -> URL {
        let fm = FileManager.default
        try? fm.createDirectory(at: disk.blobs, withIntermediateDirectories: true)
        let name = "\(hash).\(JournalMIME.ext(for: type))"
        let target = disk.blobs.appending(path: name)
        if let existing = blobFiles[hash], fm.fileExists(atPath: disk.blobs.appending(path: existing).path) {
            if existing != name { try? fm.moveItem(at: disk.blobs.appending(path: existing), to: target) }
            if file.standardizedFileURL != target.standardizedFileURL { try? fm.removeItem(at: file) }
        } else {
            try? fm.removeItem(at: target)
            try fm.moveItem(at: file, to: target)
        }
        let had = blobFiles[hash] != nil
        blobFiles[hash] = fm.fileExists(atPath: target.path) ? name : blobFiles[hash]
        if !had, blobFiles[hash] != nil { blobArrivals += 1 }
        return blobFile(hash) ?? target
    }

    /// Hashes a file (off the main thread) and adopts it as a blob: the reference the composer adds to a draft.
    func importBlob(_ file: URL, type: String, role: String, name: String? = nil, width: Int? = nil, height: Int? = nil,
                    duration: Double? = nil, poster: String? = nil) async throws -> BlobRef {
        let (hash, size) = try await Task.detached(priority: .userInitiated) {
            (try JournalDisk.sha256(of: file), JournalDisk.fileSize(file))
        }.value
        try storeBlob(hash, from: file, type: type)
        return BlobRef(hash: hash, type: type, size: size, role: role, name: name, width: width, height: height,
                       duration: duration, poster: poster)
    }

    /// The MIME type the records give a blob.
    private func blobType(_ hash: String) -> String? {
        for record in records.values {
            if let blob = record.blob(hash) { return blob.type }
        }
        for draft in drafts.values {
            if let blob = draft.blobs.first(where: { $0.hash == hash }) { return blob.type }
        }
        return nil
    }

    /// Every hash a live record or a draft names.
    private func referencedHashes() -> Set<String> {
        var hashes = Set<String>()
        for record in records.values where !record.isDeleted { hashes.formUnion(record.blobHashes) }
        for draft in drafts.values { hashes.formUnion(draft.blobHashes) }
        return hashes
    }

    /// Removes the files of `candidates` that nothing names any more.
    private func collect(_ candidates: Set<String>) {
        guard !candidates.isEmpty else { return }
        let referenced = referencedHashes()
        for hash in candidates.subtracting(referenced) {
            if let url = blobFile(hash) { try? FileManager.default.removeItem(at: url) }
            blobFiles[hash] = nil
        }
    }

    /// At launch: blob files nothing names and older than a day (a download the sync engine has not yet tied to its
    /// record is younger) go.
    private func sweepBlobs() {
        let referenced = referencedHashes()
        let dayAgo = Date().addingTimeInterval(-86_400)
        for (hash, name) in blobFiles where !referenced.contains(hash) {
            let url = disk.blobs.appending(path: name)
            let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            if modified < dayAgo {
                try? FileManager.default.removeItem(at: url)
                blobFiles[hash] = nil
            }
        }
    }

    // MARK: Drafts

    func draft(_ key: String) -> JournalDraft? { drafts[key] }

    /// Autosaves a draft (an empty new one is discarded instead).
    func saveDraft(_ draft: JournalDraft) {
        var draft = draft
        draft.saved = now()
        let old = drafts[draft.key]
        if draft.isEmpty && draft.key == JournalDraft.newKey {
            discardDraft(draft.key)
            return
        }
        drafts[draft.key] = draft
        try? disk.write(draft)
        if let old { collect(old.blobHashes.subtracting(draft.blobHashes)) }
    }

    /// Forgets a draft and the media only it named.
    func discardDraft(_ key: String) {
        guard let old = drafts.removeValue(forKey: key) else { return }
        disk.removeDraft(key)
        collect(old.blobHashes)
    }

    // MARK: Storage

    /// Bytes used by records and by media.
    func usage() async -> (records: Int64, media: Int64) {
        let disk = disk
        return await Task.detached(priority: .utility) { disk.usage() }.value
    }

    // MARK: Internals

    private func commit(_ record: HubRecord, replacing old: HubRecord?) {
        records[record.id] = record
        try? disk.write(record)
        // a blob downloaded before its record arrived was stored as .bin: give it its extension
        for blob in record.blobs ?? [] {
            if let name = blobFiles[blob.hash], name != "\(blob.hash).\(JournalMIME.ext(for: blob.type))" {
                let from = disk.blobs.appending(path: name)
                let toName = "\(blob.hash).\(JournalMIME.ext(for: blob.type))"
                if (try? FileManager.default.moveItem(at: from, to: disk.blobs.appending(path: toName))) != nil {
                    blobFiles[blob.hash] = toName
                }
            }
        }
        revision += 1
        if let old { collect(old.blobHashes.subtracting(record.isDeleted ? [] : record.blobHashes)) }
    }

    private func remove(_ id: String, old: HubRecord) {
        records[id] = nil
        disk.removeRecord(id)
        revision += 1
        collect(old.blobHashes)
    }

    private func markPending(_ id: String) {
        pending.insert(id)
        saveState()
    }

    private func unmarkPending(_ id: String) {
        if pending.remove(id) != nil { saveState() }
    }

    private func saveState() {
        state.pending = pending.sorted()
        try? disk.write(state)
    }
}
