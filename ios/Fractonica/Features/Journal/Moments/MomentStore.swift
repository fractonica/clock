import FractonicaKit
import Foundation
import Observation
import os
import UserNotifications

/// Moments' diagnostics: `log stream --predicate 'subsystem == "app.fractonica.clock" && category == "moments"'`.
let momentsLog = Logger(subsystem: "app.fractonica.clock", category: "moments")

/// Moments' state: the settings (`moments.v1`), the streak and collection derived from the journal's records (their
/// `capture`, so they follow every device through the hub), the next moment, and the instant view to present (the
/// Moments screen shows the rest). While the app is in front it wakes at each announced moment's prompt (11 Flavons
/// ahead) and opens the instant view — unless "Open by itself" is off or `-FXMomentsAuto 0` was given
/// (`opensByItself`); in the background the notifications announce them (`MomentScheduling`, a rolling window of
/// `moment.` requests refilled on launch, on becoming active and leaving, in the background refresh and whenever the
/// settings change). Everything runs on the device's real clock.
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
    private(set) var stats = MomentStats()
    /// The instant view to present.
    var instant: InstantRequest?
    private(set) var authorization = MomentAuthorization.unknown
    /// The `moment.` requests the system holds after the last refill.
    private(set) var pendingCount = 0

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
    /// Moments whose instant view was opened (or closed) already: they never open by themselves again.
    @ObservationIgnored private var handled: Set<Int64> = []

    static let defaultsKey = "moments.v1"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.defaultsKey),
           let saved = try? JSONDecoder().decode(MomentSettings.self, from: data) {
            settings = saved
        } else {
            settings = MomentSettings()
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
            applyLaunchOptions()
        }
        Task {
            authorization = await MomentScheduling.authorization()
            await refill()
        }
        scheduleWake()
    }

    func becameActive() {
        start()
        active = true
        Task {
            authorization = await MomentScheduling.authorization()
            await refill()
        }
        refreshStats()
        scheduleWake()
    }

    func enteredBackground() {
        #if os(iOS)
        active = false
        wake?.cancel()
        #endif
        refillSoon()
    }

    // MARK: - Moments

    /// Whether moment `m` is announced (asked for, outside quiet hours).
    func prompts(_ m: Moment) -> Bool { settings.prompts(m, zone: zone) }

    /// The next announced moment after `t` (now by default).
    func nextMoment(after t: Double? = nil) -> Moment? {
        calendar.upcoming(after: t ?? now, count: 1, scan: 600) { [settings, zone] in settings.prompts($0, zone: zone) }.first
    }

    /// The moment whose 11 Flavons are running now, if it is announced.
    func momentInPrompt(at t: Double? = nil) -> Moment? {
        let t = t ?? now
        guard let m = nextMoment(after: t) else { return nil }
        return calendar.promptTime(of: m) <= t ? m : nil
    }

    /// Whether the instant view may open by itself at a moment's prompt (the settings' "Open by itself", and no
    /// `-FXMomentsAuto 0`). Every way it opens without a tap goes through `openByItself(_:)`, which asks this.
    var opensByItself: Bool { settings.enabled && settings.autoOpen && launch.autoOpen }

    /// How many times a moment is captured: the setting, or `-FXMomentsCaptures` for this launch.
    var capturesPerMoment: Int { launch.captures ?? settings.captures }

    /// Opens the instant view for a moment (not when another one is up): a tap (a notification, Get Ready).
    func openInstant(_ m: Moment, demo: Bool = false) {
        handled.insert(m.index)
        guard instant == nil else { return }
        instant = InstantRequest(moment: m, demo: demo)
    }

    /// Opens the instant view for a moment whose prompt has come, without a tap; false (and nothing opens) when it may
    /// not open by itself, or did already for this moment.
    @discardableResult
    func openByItself(_ m: Moment) -> Bool {
        guard opensByItself, !handled.contains(m.index), instant == nil, m.time > now else {
            momentsLog.info("not opening the instant view by itself for \(m.index) (allowed: \(self.opensByItself))")
            return false
        }
        openInstant(m)
        return true
    }

    /// The instant view closed.
    func instantClosed() {
        instant = nil
        refreshStats()
        scheduleWake()
    }

    /// A tap on a moment's notification: the instant view while the moment is ahead, else the composer, late.
    func openFromNotification(index: Int64?) {
        let m = index.flatMap(calendar.moment)
        if let m, m.time > now + 1 {
            openInstant(m)
        } else {
            AppRouter.shared.show(.journal)
            JournalUI.shared.compose()
        }
    }

    /// While the app is in front: sleeps until the next announced moment's prompt, then opens the instant view.
    private func scheduleWake() {
        wake?.cancel()
        guard active, opensByItself else { return }
        guard let m = nextMoment() else { return }
        let prompt = calendar.promptTime(of: m)
        let delay = prompt - now
        if delay <= 0 {
            if !handled.contains(m.index) { openByItself(m) }
            // wake again after this moment
            wake = Task { [weak self] in
                try? await Task.sleep(for: .seconds(max(1, m.time - Date.now.timeIntervalSince1970 + 1)))
                guard !Task.isCancelled else { return }
                self?.scheduleWake()
            }
            return
        }
        wake = Task { [weak self] in
            // at most 15 minutes at a time: the device clock may be set, the settings may change
            try? await Task.sleep(for: .seconds(min(delay, 900)), tolerance: .milliseconds(200))
            guard !Task.isCancelled else { return }
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

    // MARK: - Notifications

    /// Asks for permission to announce moments (at a moment of intent: the sheet, turning Moments on).
    func requestAuthorization() async {
        await MomentScheduling.requestAuthorization()
        authorization = await MomentScheduling.authorization()
        await refill()
    }

    func refillSoon(after seconds: Double = 0.3) {
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            await self?.refill()
        }
    }

    /// Makes the system's pending `moment.` requests match the next announced moments. One at a time.
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
            let input = MomentScheduling.Input(settings: settings, zone: zone, pure: AppSettings.shared.pure, now: now)
            let calendar = calendar
            let requests = authorization.canPost && settings.enabled
                ? await Task.detached(priority: .utility) { MomentScheduling.requests(input, calendar: calendar) }.value
                : []
            pendingCount = await MomentScheduling.apply(requests)
            momentsLog.info("refill: \(requests.count) moments queued, \(self.pendingCount) held")
        } while refillAgain
    }

    // MARK: - Launch options

    private func applyLaunchOptions() {
        if launch.screen { AppRouter.shared.show(.moments) }
        if let seconds = launch.instantIn {
            let t = now + seconds
            let real = nextMoment(after: t) ?? calendar.upcoming(after: t, count: 1).first
            let level = launch.level ?? real?.level ?? .helion
            let boundary = launch.boundary ?? real?.boundary ?? .node
            let m = Moment(index: real?.index ?? 0, time: t, level: level, boundary: boundary, cycle: real.map { cycle(of: $0, at: level) } ?? 0)
            instant = InstantRequest(moment: m, demo: true)
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

/// The instant view to present: a moment, real or a demo one (`-FXMomentsInstant`, whose time is made up).
struct InstantRequest: Identifiable, Hashable {
    let id = UUID()
    let moment: Moment
    var demo = false
}

enum MomentAuthorization: String, Sendable {
    case unknown, notDetermined, denied, authorized, provisional

    var canPost: Bool { self == .authorized || self == .provisional }
}

// MARK: - Scheduling

/// The `moment.` notification requests: a rolling window of the next announced moments (the system holds 64 requests
/// for every feature together: Alerts keeps at most 50, Timer one, Moments at most `budget`). Off the main actor:
/// UserNotifications answers over synchronous XPC.
enum MomentScheduling {
    static let prefix = "moment."
    static let budget = 12
    /// userInfo keys: the moment's number and a fingerprint of what the request says.
    static let indexKey = "fx.moment"
    static let fingerprintKey = "fx.moment.fingerprint"

    struct Input: Sendable {
        var settings: MomentSettings
        var zone: TimeZone
        var pure: Bool
        var now: Double
    }

    struct Request: Sendable, Hashable {
        var id: String
        var index: Int64
        var fire: Double
        var title: String
        var subtitle: String
        var body: String
        var sound: String?
        var fingerprint: String { [title, subtitle, body, sound ?? "-", String(Int(fire))].joined(separator: "|") }
    }

    /// The requests for the next `budget` announced moments whose prompt is still ahead.
    static func requests(_ input: Input, calendar: MomentCalendar) -> [Request] {
        let list = calendar.upcoming(after: input.now, count: budget + 2, scan: 800) { input.settings.prompts($0, zone: input.zone) }
        return list.compactMap { m -> Request? in
            let fire = calendar.promptTime(of: m)
            guard fire > input.now + 1 else { return nil }
            return request(for: m, fire: fire, voice: input.settings.voice)
        }.prefix(budget).map { $0 }
    }

    static func request(for m: Moment, fire: Double, voice: Bool) -> Request {
        Request(
            id: "\(prefix)\(m.index)",
            index: m.index,
            fire: fire,
            title: m.ledTitle(),
            subtitle: "\(m.rarity.title) moment · in \(MomentCalendar.leadFlavons) Flavons",
            body: "Get ready: both cameras and your voice capture it at the exact moment. Choose an emoji, write a line.",
            sound: voice ? "\(m.soundName).caf" : nil
        )
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
            content.interruptionLevel = .timeSensitive
            content.sound = r.sound.map { UNNotificationSound(named: UNNotificationSoundName($0)) } ?? .default
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

    static func index(ofIdentifier identifier: String) -> Int64? {
        guard identifier.hasPrefix(prefix) else { return nil }
        return Int64(identifier.dropFirst(prefix.count))
    }
}

// MARK: - Launch options

/// Moments' launch arguments, for screenshots and checks (never persisted):
///
///     -FXMomentsInstant <seconds>   open the instant view for a moment that many seconds away (its label is the next
///                                   real moment's, or -FXMomentsLevel / -FXMomentsBoundary); it captures and saves
///     -FXMomentsLevel <level>       helion nuclide delta gamma beta alpha
///     -FXMomentsBoundary <b>        start peak node valley
///     -FXMomentsCaptures 1|3|5      capture that many times for this launch (the setting stays)
///     -FXMomentsSheet 1             show the Moments screen (as -FXTab moments does)
///     -FXMomentsSettings 1          … on its settings
///     -FXMomentsDemo 1              fill the journal with captured entries of every rarity and a streak (use with
///                                   -FXJournalStore <dir> to keep them out of the real journal)
///     -FXMomentsAuto 0              never open the instant view by itself (screenshots); the moments' banners are
///                                   kept out of sight too
///     -FXMomentsPreview 1           never touch the notification centre
struct MomentLaunchOptions: Sendable {
    var instantIn: Double?
    var level: MomentLevel?
    var boundary: MomentBoundary?
    var captures: Int?
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
            level: string("FXMomentsLevel").flatMap { MomentLevel(rawValue: $0.lowercased()) },
            boundary: string("FXMomentsBoundary").flatMap { MomentBoundary(rawValue: $0.lowercased()) },
            captures: string("FXMomentsCaptures").flatMap(Int.init).flatMap { MomentCaptures.choices.contains($0) ? $0 : nil },
            screen: flag("FXMomentsSheet") || flag("FXMomentsSettings"),
            settings: flag("FXMomentsSettings"),
            demo: flag("FXMomentsDemo"),
            autoOpen: string("FXMomentsAuto").map { !["0", "no", "false"].contains($0.lowercased()) } ?? true,
            isPreview: flag("FXMomentsPreview")
        )
    }
}
