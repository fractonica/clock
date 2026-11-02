import FractonicaKit
import Foundation
import Observation
import os
import UserNotifications
#if os(iOS)
import UIKit
#endif

/// Moments' diagnostics: `log stream --predicate 'subsystem == "app.fractonica.clock" && category == "moments"'`.
let momentsLog = Logger(subsystem: "app.fractonica.clock", category: "moments")

/// Moments' state: the settings (`moments.v1`), the streak, collection and missed calls derived from the journal's
/// records (their `capture`, so they follow every device through the hub), the next moment, and the call to present
/// (the Moments screen shows the rest). Every moment the settings ask for is a call: it rings 1 Flavon before the
/// moment for 11 Flavons. While the app is in front its call screen rings by itself (unless "Ring in the app" is off or
/// `-FXMomentsAuto 0` was given: `opensByItself`); otherwise the system's alarm rings it (`MomentAlarms`, kept in step on
/// leaving and in the background refresh), or without alarms a notification (`MomentScheduling`, a rolling window of
/// `moment.` requests refilled on launch, on becoming active and leaving, in the background refresh and whenever the
/// settings change), which also says "Missed Call" when one rings out. What became of each call is kept (`marks`, a few
/// days): a call picked up never rings again, and one that rang out unanswered becomes a journal entry — "Missed", 🔴 —
/// once, on the iPhone (`sweepMissed`). The app's badge counts the missed calls not looked at yet. Everything runs on
/// the device's real clock.
@MainActor @Observable
final class MomentStore {
    static let shared = MomentStore()

    var settings: MomentSettings {
        didSet {
            guard settings != oldValue else { return }
            save()
            refreshStats()
            refillSoon()
            scheduleWake()
        }
    }
    private(set) var stats = MomentStats() {
        didSet { if stats != oldValue { updateBadge() } }
    }
    /// The call to present.
    var instant: InstantRequest?
    private(set) var authorization = MomentAuthorization.unknown
    private(set) var alarmAuthorization = MomentAlarmAuthorization.unknown
    /// The `moment.` requests the system holds after the last refill.
    private(set) var pendingCount = 0
    /// The missed calls looked at (the Moments screen in view) up to this instant.
    private(set) var missedSeen: Double
    /// A test call that rings later (the Moments screen's Ring in 2 Flavons): its made-up moment.
    private(set) var testCall: Moment?
    /// A choice made on an alarm for the call whose screen is up already: that screen makes it.
    private(set) var pick: CallPick?

    let calendar = MomentCalendar()
    let launch = MomentLaunchOptions.current()

    @ObservationIgnored private let defaults = UserDefaults.standard
    @ObservationIgnored private var started = false
    @ObservationIgnored private var active = true
    @ObservationIgnored private var wake: Task<Void, Never>?
    @ObservationIgnored private var refillTask: Task<Void, Never>?
    @ObservationIgnored private var refillAgain = false
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var statsTask: Task<Void, Never>?
    /// What became of each recent call, by moment.
    @ObservationIgnored private var marks: [Int64: CallMark] = [:]
    /// Missed calls are written for calls from this instant on (the first launch that rang them).
    @ObservationIgnored private var callsSince: Double

    static let defaultsKey = "moments.v1"
    private static let marksKey = "moments.calls.v1"
    private static let sinceKey = "moments.callsSince"
    private static let seenKey = "moments.missedSeen"
    private static let testKey = "moments.testCall"

    init() {
        let defaults = UserDefaults.standard
        if let data = defaults.data(forKey: Self.defaultsKey),
           let saved = try? JSONDecoder().decode(MomentSettings.self, from: data) {
            settings = saved
        } else {
            settings = MomentSettings()
        }
        let now = Date.now.timeIntervalSince1970
        if defaults.object(forKey: Self.sinceKey) == nil { defaults.set(now, forKey: Self.sinceKey) }
        callsSince = defaults.double(forKey: Self.sinceKey)
        missedSeen = defaults.object(forKey: Self.seenKey) == nil ? now : defaults.double(forKey: Self.seenKey)
        if let data = defaults.data(forKey: Self.marksKey), let saved = try? JSONDecoder().decode([String: CallMark].self, from: data) {
            marks = Dictionary(uniqueKeysWithValues: saved.compactMap { k, v in Int64(k).map { ($0, v) } })
        }
        if let data = defaults.data(forKey: Self.testKey), let saved = try? JSONDecoder().decode(TestCall.self, from: data) {
            testCall = saved.moment
        }
    }

    private func save() {
        if let data = try? JSONEncoder().encode(settings) { defaults.set(data, forKey: Self.defaultsKey) }
    }

    private var zone: TimeZone { AppSettings.shared.timeZone }
    private var now: Double { Date.now.timeIntervalSince1970 }

    // MARK: - Lifecycle

    func start() {
        guard !started else { return }
        started = true
        observeJournal()
        observeSettings()
        refreshStats()
        Task {
            await JournalStore.shared.load()
            if launch.demo { MomentDemo.fill(JournalStore.shared, calendar: calendar) }
            refreshStats()
            sweepMissed()
            applyLaunchOptions()
        }
        Task {
            alarmAuthorization = MomentAlarms.authorization()
            await readAuthorization()
            await refill()
        }
        scheduleWake()
    }

    func becameActive() {
        start()
        active = true
        Task {
            alarmAuthorization = MomentAlarms.authorization()
            await readAuthorization()
            await refill()
        }
        sweepMissed()
        refreshStats()
        scheduleWake()
    }

    func enteredBackground() {
        #if os(iOS)
        active = false
        wake?.cancel()
        // the alarms take over from the app's own ringing: set before the app is suspended
        let work = UIApplication.shared.beginBackgroundTask(withName: "Moment calls")
        Task {
            await refill()
            UIApplication.shared.endBackgroundTask(work)
        }
        #else
        refillSoon()
        #endif
    }

    // MARK: - Moments

    /// Whether moment `m` is a call (asked for, outside quiet hours).
    func prompts(_ m: Moment) -> Bool { settings.prompts(m, zone: zone) }

    /// The next announced moment after `t` (now by default).
    func nextMoment(after t: Double? = nil) -> Moment? {
        calendar.upcoming(after: t ?? now, count: 1, scan: 600) { [settings, zone] in settings.prompts($0, zone: zone) }.first
    }

    /// The next call to ring after `t`: the next moment, or the one after it when the next one rings already.
    func nextCall(after t: Double) -> Moment? {
        guard let m = nextMoment(after: t) else { return nil }
        return calendar.promptTime(of: m) > t ? m : nextMoment(after: m.time)
    }

    /// The call ringing at `t` that nobody has picked up (nor captured its moment elsewhere).
    func ringingCall(at t: Double? = nil) -> Moment? {
        calendar.ringing(at: t ?? now) { [self] m in
            prompts(m) && marks[m.index] == nil && !stats.captured.contains(m.index) && !stats.missed.contains(m.index)
        }
    }

    /// Whether the call screen may ring by itself while the app is in front (the settings' "Ring in the app", and no
    /// `-FXMomentsAuto 0`). Every way it opens without a tap goes through `openByItself(_:)`, which asks this.
    var opensByItself: Bool { settings.enabled && settings.autoOpen && launch.autoOpen }

    /// The missed calls not looked at yet: the badge's number.
    var unseenMissed: Int { stats.missedCount(after: missedSeen) }

    /// Rings a made-up moment a Flavon from now (the Moments screen's Test a Call, `-FXMomentsInstant`): named as the
    /// next real moment, or as `level` and `boundary`; answered, muted or declined like a real one and saved the same
    /// way. Its time is no real moment's, so it never counts for the streak.
    func openTest(in seconds: Double? = nil, level: MomentLevel? = nil, boundary: MomentBoundary? = nil) {
        guard instant == nil else { return }
        let lead = Double(MomentCalendar.leadFlavons) * flavon
        // (a time under a Flavon, from the launch options: a call that has rung a while already)
        instant = InstantRequest(moment: madeUp(at: now + (seconds ?? lead), level: level, boundary: boundary), demo: true)
    }

    /// Rings a made-up moment's call in `seconds` (its moment a Flavon later): with the phone locked by then, as the
    /// system's alarm (asked for here when it never was), or as a notification without alarms.
    func scheduleTest(in seconds: Double) {
        let lead = Double(MomentCalendar.leadFlavons) * flavon
        let m = madeUp(at: now + seconds + lead)
        testCall = m
        if let data = try? JSONEncoder().encode(TestCall(m)) { defaults.set(data, forKey: Self.testKey) }
        scheduleWake()
        Task {
            if alarmAuthorization == .notDetermined { alarmAuthorization = await MomentAlarms.requestAuthorization() }
            await refill()
        }
    }

    /// The test call's notification, tapped: it rings here.
    func ringTest() {
        guard let m = testCall else { return }
        clearTest()
        openCall(m, demo: true)
    }

    private var flavon: Double { FractonicaClock.shared.levelInfo(10).meanSeconds }

    /// A moment at `t` named as the next real one (or as `level` and `boundary`).
    private func madeUp(at t: Double, level: MomentLevel? = nil, boundary: MomentBoundary? = nil) -> Moment {
        let real = nextMoment(after: t) ?? calendar.upcoming(after: t, count: 1).first
        let level = level ?? real?.level ?? .helion
        let boundary = boundary ?? real?.boundary ?? .node
        return Moment(index: real?.index ?? 0, time: t, level: level, boundary: boundary,
                      cycle: real.map { cycle(of: $0, at: level) } ?? 0)
    }

    /// Opens a moment's call (not when another one is up): ringing, or picked up already from its alarm.
    func openCall(_ m: Moment, demo: Bool = false, start: CallStart = .ringing) {
        guard instant == nil else { return }
        instant = InstantRequest(moment: m, demo: demo, start: start)
    }

    /// Rings a moment's call without a tap; false (and nothing opens) when it may not open by itself, or was picked up
    /// already, or has rung out.
    @discardableResult
    func openByItself(_ m: Moment) -> Bool {
        guard opensByItself, marks[m.index] == nil, instant == nil, now < calendar.ringEnd(of: m) else {
            momentsLog.info("not ringing \(m.index) by itself (allowed: \(self.opensByItself))")
            return false
        }
        openCall(m)
        return true
    }

    /// The alarm's Answer or Decline (`AnswerMomentCallIntent`, `DeclineMomentCallIntent`): the app opens on the call,
    /// picked up or declined at once.
    func pickUp(index: Int64, test: Bool, answer: Bool) {
        let start: CallStart = answer ? .answered : .declined(now)
        if test {
            guard let m = testCall else { return }
            clearTest()
            instant = InstantRequest(moment: m, demo: true, start: start)
            return
        }
        guard let m = calendar.moment(index) else { return }
        if let current = instant, current.moment.index == m.index, !current.demo {
            // its call screen is up already (it rang as the app came to the front): picked up there
            pick = CallPick(index: m.index, answer: answer)
            return
        }
        guard marks[m.index] == nil || marks[m.index]?.state == .ringing else { return }
        instant = nil
        openCall(m, start: start)
    }

    /// The call closed.
    func instantClosed() {
        instant = nil
        refreshStats()
        scheduleWake()
    }

    /// A tap on a moment's notification: its call while it rings, else the Moments screen (a missed call).
    func openFromNotification(index: Int64?) {
        if let m = index.flatMap(calendar.moment), now < calendar.ringEnd(of: m), marks[m.index] == nil || marks[m.index]?.state == .ringing {
            openCall(m)
        } else {
            AppRouter.shared.show(.moments)
        }
    }

    // MARK: - Calls

    /// A call's screen opened: it rings here now (the sweep leaves it to the screen).
    func callOpened(_ m: Moment, demo: Bool) {
        if demo { return }
        if marks[m.index] == nil { mark(m, .ringing) }
    }

    /// A call answered, muted or declined: it never rings again, nor is missed.
    func callPicked(_ m: Moment, _ outcome: MomentOutcome, demo: Bool) {
        if demo {
            clearTest()
            return
        }
        mark(m, CallMark.State(outcome))
        MomentScheduling.forget(m.index)
        refillSoon()
    }

    /// A call rang out: its entry, "Missed" (on the iPhone — one device writes them — or for a test call); its id.
    func recordMissed(_ m: Moment, demo: Bool) async -> String? {
        if !demo {
            guard marks[m.index]?.state != .missed else { return nil }
            mark(m, .missed)
        } else {
            clearTest()
        }
        #if os(iOS)
        return await saveMissed(m)
        #else
        return nil
        #endif
    }

    /// Writes a missed call's entry for every call that rang out unanswered since the calls began (on the iPhone).
    func sweepMissed() {
        #if os(iOS)
        guard settings.enabled, launch.autoOpen, !launch.isPreview, JournalStore.shared.isLoaded else { return }
        let now = self.now
        var covered = Set(marks.keys)
        for record in JournalStore.shared.entries {
            if let c = record.capture, let q = calendar.index(near: c.at) { covered.insert(q) }
        }
        let since = max(callsSince, now - 3 * 86_400)
        let missed = MomentCalls.unanswered(since: since, now: now - 1, calendar: calendar, settings: settings, zone: zone, covered: covered)
        guard !missed.isEmpty else { return }
        for m in missed { mark(m, .missed) }
        Task {
            for m in missed { _ = await saveMissed(m) }
            momentsLog.info("missed calls written: \(missed.map(\.index))")
        }
        #endif
    }

    /// The missed calls looked at: the badge clears.
    func markMissedSeen() {
        missedSeen = now
        defaults.set(missedSeen, forKey: Self.seenKey)
        updateBadge()
    }

    private func saveMissed(_ m: Moment) async -> String? {
        do {
            let record = try await MomentSaver.save(moment: m, emoji: MomentOutcome.missed.emoji, text: "", media: [], outcome: .missed)
            return record.id
        } catch {
            momentsLog.error("could not write the missed call: \(error.localizedDescription)")
            return nil
        }
    }

    private func mark(_ m: Moment, _ state: CallMark.State) {
        marks[m.index] = CallMark(state: state, at: now)
        // a few days are enough: older calls are written or covered by their entries
        marks = marks.filter { $0.value.at > now - 4 * 86_400 }
        let saved = Dictionary(uniqueKeysWithValues: marks.map { (String($0.key), $0.value) })
        if let data = try? JSONEncoder().encode(saved) { defaults.set(data, forKey: Self.marksKey) }
    }

    private func clearTest() {
        guard testCall != nil else { return }
        testCall = nil
        defaults.removeObject(forKey: Self.testKey)
        refillSoon()
    }

    private func updateBadge() {
        #if os(iOS)
        guard authorization.canPost, !launch.isPreview else { return }
        let count = unseenMissed
        Task { try? await UNUserNotificationCenter.current().setBadgeCount(count) }
        #endif
    }

    /// While the app is in front: sleeps until the next call's first ring (or the ringing one's end, to write it
    /// missed), then rings it.
    private func scheduleWake() {
        wake?.cancel()
        guard active, settings.enabled || testCall != nil else { return }
        let now = self.now
        if opensByItself, let m = ringingCall(at: now) { openByItself(m) }
        // a test call's moment is made up: it rings a mean Flavon before it
        if let test = testCall, test.time - Double(MomentCalendar.leadFlavons) * flavon <= now + 0.2 {
            if instant == nil, now < test.time + 10 * flavon {
                clearTest()
                openCall(test, demo: true)
            } else if now >= test.time + 10 * flavon {
                clearTest()
            }
        }
        var next: [Double] = []
        if let m = nextCall(after: now) { next.append(calendar.promptTime(of: m)) }
        if let m = calendar.ringing(at: now, where: prompts) { next.append(calendar.ringEnd(of: m) + 1) }
        if let test = testCall { next.append(test.time - Double(MomentCalendar.leadFlavons) * flavon) }
        guard let t = next.filter({ $0 > now }).min() else { return }
        wake = Task { [weak self] in
            // at most 15 minutes at a time: the device clock may be set, the settings may change
            try? await Task.sleep(for: .seconds(min(t - Date.now.timeIntervalSince1970, 900)), tolerance: .milliseconds(200))
            guard !Task.isCancelled else { return }
            self?.sweepMissed()
            self?.scheduleWake()
        }
    }

    // MARK: - Streak and collection

    /// Recomputes the stats off the main thread from the journal's entries.
    func refreshStats() {
        let store = JournalStore.shared
        guard store.isLoaded else { return }
        let entries = store.entries
        let input = (calendar, settings, zone, now)
        statsTask?.cancel()
        statsTask = Task { [weak self] in
            let stats = await Task.detached(priority: .utility) {
                MomentStats.make(entries: entries, calendar: input.0, settings: input.1, zone: input.2, now: input.3)
            }.value
            guard !Task.isCancelled else { return }
            self?.stats = stats
        }
    }

    private func observeJournal() {
        withObservationTracking {
            _ = JournalStore.shared.revision
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.refreshStats()
                self?.observeJournal()
            }
        }
    }

    private func observeSettings() {
        withObservationTracking {
            _ = AppSettings.shared.pure
            _ = AppSettings.shared.zone
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.refillSoon()
                self?.refreshStats()
                self?.observeSettings()
            }
        }
    }

    // MARK: - Notifications and alarms

    /// Reads the notifications' permission; a notification centre that does not answer (it happens in the Simulator)
    /// leaves it as it was rather than holding up the calls.
    private func readAuthorization() async {
        if let read = await AlertScheduling.within(5, { await MomentScheduling.authorization() }) {
            authorization = read
        } else {
            momentsLog.error("the notification centre did not answer for the permission")
        }
    }

    /// Asks for permission to call: notifications, then alarms (at a moment of intent: the screen, turning Moments on).
    func requestAuthorization() async {
        await MomentScheduling.requestAuthorization()
        await readAuthorization()
        if launch.autoOpen { alarmAuthorization = await MomentAlarms.requestAuthorization() }
        await refill()
    }

    /// Asks for the alarms alone (the Moments screen while they were never asked for, the settings' button).
    func requestAlarms() async {
        alarmAuthorization = await MomentAlarms.requestAuthorization()
        await refill()
    }

    /// Calls ring as the system's alarms (iOS 26, allowed).
    var ringsAsAlarms: Bool { alarmAuthorization == .authorized }

    func refillSoon(after seconds: Double = 0.3) {
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            await self?.refill()
        }
    }

    /// Makes the system's pending `moment.` requests and the alarms match the next calls. One at a time.
    func refill() async {
        if let running = refillTask {
            refillAgain = true
            await running.value
            return
        }
        let task = Task { await runRefills() }
        refillTask = task
        await task.value
        refillTask = nil
    }

    private func runRefills() async {
        repeat {
            refillAgain = false
            guard !launch.isPreview else { break }
            let alarms = ringsAsAlarms && launch.autoOpen
            let test = testCall.map { (fire: $0.time - Double(MomentCalendar.leadFlavons) * flavon, title: $0.ledTitle()) }
            let input = MomentScheduling.Input(settings: settings, zone: zone, pure: AppSettings.shared.pure, now: now, alarms: alarms,
                                               unseen: unseenMissed, covered: Set(marks.keys), test: test)
            let calendar = calendar
            // the alarms first: they ring whatever the notification centre does
            await syncAlarms(alarms)
            let requests = authorization.canPost && (settings.enabled || testCall != nil)
                ? await Task.detached(priority: .utility) { MomentScheduling.requests(input, calendar: calendar) }.value
                : []
            if let held = await AlertScheduling.within(10, { await MomentScheduling.apply(requests) }) {
                pendingCount = held
            } else {
                momentsLog.error("the notification centre did not answer while queueing")
            }
            updateBadge()
            momentsLog.info("refill: \(requests.count) requests queued, \(self.pendingCount) held; alarms \(String(describing: self.alarmAuthorization)), \(self.active ? "in front" : "away")")
        } while refillAgain
    }

    /// The alarms: the next calls while the app is not in front (or always, when it does not ring them itself);
    /// none while it does.
    private func syncAlarms(_ allowed: Bool) async {
        guard allowed else { return }
        let inFront = active && opensByItself
        #if os(iOS)
        if inFront {
            MomentAlarms.clear()
            return
        }
        var calls: [MomentAlarmCall] = []
        if settings.enabled {
            let list = calendar.upcoming(after: now, count: MomentAlarms.window + 1, scan: 800) { [settings, zone] in settings.prompts($0, zone: zone) }
            for m in list where marks[m.index] == nil && calendar.promptTime(of: m) > now + 1 {
                calls.append(MomentAlarmCall(index: m.index, fire: calendar.promptTime(of: m), title: m.title(AppSettings.shared.wording.notation),
                                             ringtone: settings.ringtone))
            }
        }
        if let test = testCall {
            let fire = test.time - Double(MomentCalendar.leadFlavons) * flavon
            if fire > now + 1 {
                calls.append(MomentAlarmCall(index: test.index, test: true, fire: fire, title: test.title(AppSettings.shared.wording.notation),
                                             ringtone: settings.ringtone))
            }
        }
        await MomentAlarms.sync(Array(calls.prefix(MomentAlarms.window)))
        #endif
    }

    // MARK: - Launch options

    private func applyLaunchOptions() {
        if launch.screen { AppRouter.shared.show(.moments) }
        if let seconds = launch.testIn {
            scheduleTest(in: seconds)
        }
        if let seconds = launch.instantIn {
            openTest(in: seconds, level: launch.level, boundary: launch.boundary)
        } else if let rang = launch.rang {
            openTest(in: Double(MomentCalendar.leadFlavons) * flavon - rang, level: launch.level, boundary: launch.boundary)
        }
    }

    /// The cycle at `level` a moment's boundary belongs to (for a demo moment relabelled to another level).
    private func cycle(of m: Moment, at level: MomentLevel) -> Int64 {
        if level == m.level { return m.cycle }
        return clockCycle(level: level.kitLevel, at: m.time + 1) ?? 0
    }

    private func clockCycle(level: Int, at t: Double) -> Int64? {
        FractonicaClock.shared.level(at: t, level)?.cycle
    }
}

/// A choice made on a call's alarm, for its screen.
struct CallPick: Equatable, Sendable {
    let id = UUID()
    let index: Int64
    let answer: Bool
}

/// What became of a call: ringing on its screen, answered, muted, declined, or written as missed.
struct CallMark: Codable, Hashable, Sendable {
    enum State: String, Codable, Sendable {
        case ringing, answered, muted, declined, missed

        init(_ outcome: MomentOutcome) {
            self = State(rawValue: outcome.rawValue) ?? .answered
        }
    }

    var state: State
    var at: Double
}

/// A test call kept for its alarm's buttons: its made-up moment.
private struct TestCall: Codable {
    var index: Int64
    var time: Double
    var level: MomentLevel
    var boundary: MomentBoundary
    var cycle: Int64

    init(_ m: Moment) {
        index = m.index
        time = m.time
        level = m.level
        boundary = m.boundary
        cycle = m.cycle
    }

    var moment: Moment { Moment(index: index, time: time, level: level, boundary: boundary, cycle: cycle) }
}

/// The call to present: a moment, real or a demo one (a test call, `-FXMomentsInstant`, whose time is made up), and how
/// it opens.
struct InstantRequest: Identifiable, Hashable {
    let id = UUID()
    let moment: Moment
    var demo = false
    var start = CallStart.ringing
}

/// How a call's screen opens: ringing, or picked up already from its alarm — answered, or declined at that instant.
enum CallStart: Hashable, Sendable {
    case ringing
    case answered
    case declined(Double)
}

enum MomentAuthorization: String, Sendable {
    case unknown, notDetermined, denied, authorized, provisional

    var canPost: Bool { self == .authorized || self == .provisional }
}

// MARK: - Scheduling

/// The `moment.` notification requests: a rolling window of the next calls — each one's ring (`moment.<n>`, its
/// ringtone once, time-sensitive; only where alarms do not ring them) and its "Missed Call" when it rings out
/// (`moment.missed.<n>`, numbering the app's badge). The system holds 64 requests for every feature together: Alerts
/// keeps at most 50, Timer one, Moments at most `budget`. Off the main actor: UserNotifications answers over
/// synchronous XPC.
enum MomentScheduling {
    static let prefix = "moment."
    static let missedPrefix = "moment.missed."
    /// A test call's ring (where alarms do not ring it).
    static let testID = "moment.test"
    static let budget = 12
    /// userInfo keys: the moment's number and a fingerprint of what the request says.
    static let indexKey = "fx.moment"
    static let fingerprintKey = "fx.moment.fingerprint"

    struct Input: Sendable {
        var settings: MomentSettings
        var zone: TimeZone
        var pure: Bool
        var now: Double
        /// Alarms ring the calls: no ring notifications.
        var alarms = false
        /// The missed calls not looked at yet: the first "Missed Call" badges one more.
        var unseen = 0
        /// Calls picked up already.
        var covered: Set<Int64> = []
        /// A test call's first ring and its caller.
        var test: (fire: Double, title: String)?
    }

    struct Request: Sendable, Hashable {
        var id: String
        var index: Int64
        var fire: Double
        var title: String
        var subtitle: String
        var body: String
        var sound: String?
        var badge: Int?
        var urgent = true
        var fingerprint: String {
            [title, subtitle, body, sound ?? "-", badge.map(String.init) ?? "-", String(Int(fire))].joined(separator: "|")
        }
    }

    /// The requests for the next calls whose ring or end is still ahead, soonest first: at most `budget`.
    static func requests(_ input: Input, calendar: MomentCalendar) -> [Request] {
        let flavon = calendar.clock.levelInfo(10).meanSeconds
        // a call rings on for ten Flavons after its moment: its end may be ahead still
        let back = Double(MomentCalendar.ringFlavons - MomentCalendar.leadFlavons) * flavon + 1
        let list = calendar.upcoming(after: input.now - back, count: budget + 2, scan: 800) { input.settings.prompts($0, zone: input.zone) }
        var out: [Request] = []
        var badge = input.unseen
        if !input.alarms, let test = input.test, test.fire > input.now + 1 {
            out.append(Request(id: testID, index: -1, fire: test.fire, title: test.title, subtitle: "Test call · in 1 Flavon",
                               body: "Answer, mute or decline it.", sound: input.settings.ringtone.fileName))
        }
        for m in list where input.settings.enabled && !input.covered.contains(m.index) {
            let ring = calendar.promptTime(of: m), end = calendar.ringEnd(of: m)
            if !input.alarms, ring > input.now + 1 { out.append(request(for: m, fire: ring, ringtone: input.settings.ringtone)) }
            if end > input.now + 1 {
                badge += 1
                out.append(missed(m, fire: end, badge: badge))
            }
        }
        return Array(out.sorted { $0.fire < $1.fire }.prefix(budget))
    }

    /// A call's ring: the moment for the caller, its ringtone.
    static func request(for m: Moment, fire: Double, ringtone: MomentRingtone) -> Request {
        Request(
            id: "\(prefix)\(m.index)",
            index: m.index,
            fire: fire,
            title: m.ledTitle(),
            subtitle: "\(m.rarity.title) moment calling · in \(MomentCalendar.leadFlavons) Flavon",
            body: "Answer to film it with the back camera, mute to film both cameras through it, or decline for a photo from each.",
            sound: ringtone.fileName
        )
    }

    /// A call that rang out: "Missed Call", the moment's name, the badge.
    static func missed(_ m: Moment, fire: Double, badge: Int) -> Request {
        Request(id: "\(missedPrefix)\(m.index)", index: m.index, fire: fire, title: "Missed Call", subtitle: "", body: m.ledTitle(),
                sound: nil, badge: badge, urgent: false)
    }

    /// Makes the pending `moment.` requests equal to `requests`; returns how many the system holds.
    static func apply(_ requests: [Request]) async -> Int {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests().filter { $0.identifier.hasPrefix(prefix) }
        let wanted = Dictionary(requests.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var keep = Set<String>()
        var remove: [String] = []
        for p in pending {
            if let w = wanted[p.identifier], p.content.userInfo[fingerprintKey] as? String == w.fingerprint {
                keep.insert(p.identifier)
            } else {
                remove.append(p.identifier)
            }
        }
        if !remove.isEmpty { center.removePendingNotificationRequests(withIdentifiers: remove) }
        let now = Date.now.timeIntervalSince1970
        for r in requests where !keep.contains(r.id) {
            let content = UNMutableNotificationContent()
            content.title = r.title
            content.subtitle = r.subtitle
            content.body = r.body
            content.threadIdentifier = "moments"
            content.interruptionLevel = r.urgent ? .timeSensitive : .active
            content.sound = r.sound.map { UNNotificationSound(named: UNNotificationSoundName($0)) } ?? (r.badge == nil ? .default : nil)
            content.badge = r.badge.map { NSNumber(value: $0) }
            var info: [AnyHashable: Any] = AppLink(screen: .moments).userInfo
            info[indexKey] = NSNumber(value: r.index)
            info[fingerprintKey] = r.fingerprint
            content.userInfo = info
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, r.fire - now), repeats: false)
            do {
                try await center.add(UNNotificationRequest(identifier: r.id, content: content, trigger: trigger))
                keep.insert(r.id)
            } catch {
                momentsLog.error("could not queue \(r.id): \(error.localizedDescription)")
            }
        }
        return keep.count
    }

    /// A call picked up: its ring and its "Missed Call", pending or shown, go.
    static func forget(_ index: Int64) {
        let ids = ["\(prefix)\(index)", "\(missedPrefix)\(index)"]
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    static func authorization() async -> MomentAuthorization {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .authorized: return .authorized
        case .provisional: return .provisional
        default: return .authorized
        }
    }

    static func requestAuthorization() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
    }

    /// The moment number a notification carries.
    static func index(of userInfo: [AnyHashable: Any]) -> Int64? {
        (userInfo[indexKey] as? NSNumber)?.int64Value
    }

    /// The moment number of a `moment.` or `moment.missed.` request.
    static func index(ofIdentifier identifier: String) -> Int64? {
        if identifier.hasPrefix(missedPrefix) { return Int64(identifier.dropFirst(missedPrefix.count)) }
        guard identifier.hasPrefix(prefix) else { return nil }
        return Int64(identifier.dropFirst(prefix.count))
    }

    /// Whether a request says a call was missed.
    static func isMissed(_ identifier: String) -> Bool { identifier.hasPrefix(missedPrefix) }
}

// MARK: - Launch options

/// Moments' launch arguments, for screenshots and checks (never persisted):
///
///     -FXMomentsInstant <seconds>   ring a call for a made-up moment that many seconds away (its label is the next
///                                   real moment's, or -FXMomentsLevel / -FXMomentsBoundary); answered, muted or
///                                   declined it films and saves (in the Simulator a drawn film stands in)
///     -FXMomentsRang <seconds>      … or one that has rung that long already (its moment past after a Flavon; it
///                                   rings out 11 Flavons in)
///     -FXMomentsTestIn <seconds>    a test call that many seconds from now (Ring in 2 Flavons): away from the app by
///                                   then, its alarm rings
///     -FXMomentsPick <choice>       pick it up by itself 2 s after it rings: answer, mute, decline (or wait: let it
///                                   ring out)
///     -FXMomentsLevel <level>       helion nuclide delta gamma beta alpha
///     -FXMomentsBoundary <b>        start peak node valley
///     -FXMomentsSheet 1             show the Moments screen (as -FXTab moments does)
///     -FXMomentsSettings 1          … on its settings
///     -FXMomentsDemo 1              fill the journal with captured entries of every rarity and a streak (use with
///                                   -FXJournalStore <dir> to keep them out of the real journal)
///     -FXMomentsAuto 0              never ring a call by itself (screenshots), nor as an alarm, nor write missed
///                                   calls; the moments' banners are kept out of sight too
///     -FXMomentsPreview 1           never touch the notification centre
struct MomentLaunchOptions: Sendable {
    var instantIn: Double?
    var testIn: Double?
    var rang: Double?
    var pick: String?
    var level: MomentLevel?
    var boundary: MomentBoundary?
    var screen = false
    var settings = false
    var demo = false
    var autoOpen = true
    var isPreview = false

    static func current(_ defaults: UserDefaults = .standard) -> MomentLaunchOptions {
        func string(_ key: String) -> String? { defaults.string(forKey: key).flatMap { $0.isEmpty ? nil : $0 } }
        func flag(_ key: String) -> Bool { string(key).map { ["1", "yes", "true"].contains($0.lowercased()) } ?? false }
        return MomentLaunchOptions(
            instantIn: string("FXMomentsInstant").flatMap(Double.init),
            testIn: string("FXMomentsTestIn").flatMap(Double.init),
            rang: string("FXMomentsRang").flatMap(Double.init),
            pick: string("FXMomentsPick")?.lowercased(),
            level: string("FXMomentsLevel").flatMap { MomentLevel(rawValue: $0.lowercased()) },
            boundary: string("FXMomentsBoundary").flatMap { MomentBoundary(rawValue: $0.lowercased()) },
            screen: flag("FXMomentsSheet") || flag("FXMomentsSettings"),
            settings: flag("FXMomentsSettings"),
            demo: flag("FXMomentsDemo"),
            autoOpen: string("FXMomentsAuto").map { !["0", "no", "false"].contains($0.lowercased()) } ?? true,
            isPreview: flag("FXMomentsPreview")
        )
    }
}
