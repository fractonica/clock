import Foundation
import Observation

/// The phone's side of calls by dispatch: it keeps this device's schedule on the hub (`DispatchSchedule`, through the
/// journal's store and its hub sync), reads the dispatch's status from there, and makes the code that pairs a dispatch
/// with the hub. `MomentStore` decides when moments ring by dispatch (`MomentStore.dispatched`) and hands the calls
/// over at every refill; `MomentCallKit` rings them as they come.
///
/// Pairing is the hub's: the dispatch is a hub client (a `service` on `dispatch.*`) for as long as the hub keeps it, so
/// alert mode only writes `enabled: false` into the schedule, and choosing calls again needs no new code.
@MainActor @Observable
final class MomentDispatch {
    static let shared = MomentDispatch()

    /// The VoIP push token (hex), once PushKit gives one; kept, so a launch knows it before PushKit says it again.
    var pushToken: String? {
        didSet {
            guard pushToken != oldValue else { return }
            defaults.set(pushToken, forKey: Self.tokenKey)
            MomentStore.shared.refillSoon()
        }
    }

    @ObservationIgnored private let store: JournalStore
    @ObservationIgnored private let defaults: UserDefaults
    private static let tokenKey = "moments.dispatch.token"
    private static let pairedKey = "moments.dispatch.paired"

    init(store: JournalStore = .shared, defaults: UserDefaults = .standard) {
        self.store = store
        self.defaults = defaults
        pushToken = defaults.string(forKey: Self.tokenKey)
    }

    // MARK: Who and where

    /// This install's id (the schedule record's), made once.
    var install: String {
        if let id = defaults.string(forKey: "moments.dispatch.install") { return id }
        let id = UUID().uuidString.lowercased()
        defaults.set(id, forKey: "moments.dispatch.install")
        return id
    }

    var recordID: String { DispatchSchedule.recordID(install: install) }

    /// The push topic (the bundle id's VoIP topic), environment and team.
    var push: DispatchSchedule.Push {
        DispatchSchedule.Push(token: pushToken, environment: Self.environment, topic: (Bundle.main.bundleIdentifier ?? "app.fractonica.clock") + ".voip")
    }

    nonisolated static let environment: String = {
        #if targetEnvironment(simulator)
        return "development"
        #else
        let text = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
            .flatMap { try? Data(contentsOf: $0) }.flatMap { String(data: $0, encoding: .isoLatin1) }
        return DispatchSetup.apsEnvironment(profile: text)
        #endif
    }()

    /// The developer team (Info.plist `FXTeamID`, the build's `DEVELOPMENT_TEAM`).
    static var team: String? {
        (Bundle.main.object(forInfoDictionaryKey: "FXTeamID") as? String).flatMap { $0.count == 10 ? $0 : nil }
    }

    // MARK: The dispatch

    /// The dispatches the hub has seen (their status records), the one seen last first.
    var dispatches: [DispatchStatus] {
        _ = store.revision
        return store.records.values.compactMap(DispatchStatus.init(record:)).sorted { $0.seen > $1.seen }
    }

    /// The dispatch that answers this hub: the one seen last.
    var current: DispatchStatus? { dispatches.first }

    /// A dispatch is paired with the hub (it has written its status). Remembered: at launch, until the journal's store
    /// has loaded (a VoIP push launches the app straight into a call), the answer is the last one known.
    var isPaired: Bool {
        guard store.isLoaded else { return defaults.bool(forKey: Self.pairedKey) }
        let paired = current != nil
        if paired != defaults.bool(forKey: Self.pairedKey) { defaults.set(paired, forKey: Self.pairedKey) }
        return paired
    }

    /// The phone syncs with a hub (the dispatch pairs through it).
    var hasHub: Bool { SyncEngine.shared.isPaired }

    // MARK: The schedule

    /// The schedule as the hub has it (this device's own record).
    var published: DispatchSchedule? {
        store.record(recordID).flatMap { DispatchSchedule(data: $0.data) }
    }

    /// Writes the schedule when it differs from the one the hub has: the calls (when `enabled`), or alert mode.
    func publish(enabled: Bool, calls: [DispatchCall]) {
        guard store.isLoaded, hasHub else { return }
        let schedule = DispatchSchedule(enabled: enabled, name: HubDevice.defaultName, team: Self.team, push: push,
                                        calls: enabled ? Array(calls.prefix(DispatchSchedule.maxCalls)) : [])
        // nothing to say: never rang by dispatch, and not now
        if !enabled, store.record(recordID) == nil { return }
        guard published != schedule else { return }
        let now = Date.now.timeIntervalSince1970
        let old = store.record(recordID)
        store.save(HubRecord(id: recordID, kind: DispatchSchedule.kind, time: old?.time ?? now, end: nil, zone: nil,
                             data: schedule.data, text: nil, tags: nil, blobs: nil, created: old?.created ?? now, updated: now,
                             deleted: nil, source: old?.source, editor: old?.editor, rev: old?.rev, fx: old?.fx))
    }

    // MARK: Pairing

    struct PairingCode: Identifiable, Hashable {
        let code: String
        let expires: Double
        let command: String
        var id: String { code }
    }

    /// A code for `node dispatch/bin/dispatch.mjs CODE`: the hub makes it for a service limited to `dispatch.*`.
    func makeCode() async throws -> PairingCode {
        guard let client = SyncEngine.shared.client else { throw HubError.notPaired }
        let answer = try await client.createDispatchPairing(name: "Fractonica Dispatch")
        return PairingCode(code: answer.code, expires: answer.expires,
                           command: DispatchSetup.command(code: answer.code, hub: SyncEngine.shared.credentials?.hubURL))
    }
}
