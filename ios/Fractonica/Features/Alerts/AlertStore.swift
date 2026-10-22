import FractonicaKit
import Foundation
import Observation
import os
import Synchronization
import UserNotifications

/// Alerts' diagnostics: `log stream --predicate 'subsystem == "app.fractonica.clock" && category == "alerts"'`.
let alertsLog = Logger(subsystem: "app.fractonica.clock", category: "alerts")

/// Alerts' state: the rules and quiet hours (persisted under `alerts.v1`), the notification permission, the plan the
/// scheduler made and what the system actually holds. It keeps the system's pending `alert.` requests equal to the
/// plan: on launch, on becoming active, in the background refresh task, periodically while the app runs and whenever
/// rules, quiet hours, pure mode or the time zone change. Everything runs on the device's real clock.
///
///     @State private var alerts = AlertStore.shared
///     Toggle(rule.name, isOn: alerts.binding(enabled: rule.id))
@MainActor @Observable
final class AlertStore {
    static let shared = AlertStore()

    /// The notification permission, as Alerts needs to know it.
    enum Authorization: String, Sendable {
        case unknown, notDetermined, denied, authorized, provisional

        /// Notifications can be posted (provisional ones arrive quietly in the list).
        var canPost: Bool { self == .authorized || self == .provisional }
    }

    private(set) var config: AlertsConfig
    /// What the scheduler wants pending, and every rule's next moment.
    private(set) var plan = AlertPlan.empty
    /// The rendered title and body of each planned request, by identifier.
    private(set) var messages: [String: AlertMessage] = [:]
    /// The planned identifiers the system holds after the last refill.
    private(set) var pending: Set<String> = []
    private(set) var authorization = Authorization.unknown
    /// Alerts in the notification list, newest first.
    private(set) var delivered: [DeliveredAlert] = []
    private(set) var lastRefill: Date?
    /// Launch hooks for screenshots: a preview never touches the notification centre or saves anything.
    let launch: AlertLaunchOptions
    /// The editor to open on launch (`-FXAlertsEdit`), consumed by the screen.
    var launchEditor: String?
    /// A rule the editor just made while the permission is undecided: the screen explains, then asks, once the editor
    /// has closed (`PermissionPrimer`).
    var primerAfterEditor: AlertRule?
    /// The user put the explanation off ("Not Now"): this session does not bring it up again; the card stays.
    @ObservationIgnored var primerDeclined = false

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var refillTask: Task<Void, Never>?
    @ObservationIgnored private var refillAgain = false
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var wake: Task<Void, Never>?
    @ObservationIgnored private var started = false
    @ObservationIgnored private var active = true
    @ObservationIgnored private var clockObservers: [any NSObjectProtocol] = []
    #if os(macOS)
    @ObservationIgnored private var activity: NSBackgroundActivityScheduler?
    #endif

    init(defaults: UserDefaults = .standard, launch: AlertLaunchOptions = .current()) {
        self.defaults = defaults
        self.launch = launch
        config = launch.demo || launch.live ? launch.demoConfig : AlertsConfig.load(from: defaults)
        launchEditor = launch.edit
        if let auth = launch.authorization { authorization = auth }
    }

    // MARK: - Rules

    var rules: [AlertRule] { config.rules }

    var quiet: QuietHours {
        get { config.quiet }
        set {
            let next = newValue.sanitized()
            guard next != config.quiet else { return }
            config.quiet = next
            changed()
        }
    }

    var canAddRule: Bool { config.rules.count < AlertsConfig.maxRules }

    /// Whether making a rule now should explain notifications and ask for them: the permission is undecided and the
    /// explanation was not put off.
    var shouldPrime: Bool { authorization == .notDetermined && !primerDeclined }

    func rule(_ id: UUID) -> AlertRule? { config.rules.first { $0.id == id } }

    /// Adds a rule (sanitized) at the end of the list.
    func add(_ rule: AlertRule) {
        guard canAddRule else { return }
        config.rules.append(rule.sanitized())
        changed()
    }

    /// Replaces the rule with the same id.
    func update(_ rule: AlertRule) {
        guard let i = config.rules.firstIndex(where: { $0.id == rule.id }) else { return add(rule) }
        let next = rule.sanitized()
        guard next != config.rules[i] else { return }
        config.rules[i] = next
        changed()
    }

    func remove(_ ids: Set<UUID>) {
        config.rules.removeAll { ids.contains($0.id) }
        changed()
    }

    func move(from source: IndexSet, to destination: Int) {
        config.rules.move(fromOffsets: source, toOffset: destination)
        changed()
    }

    func duplicate(_ id: UUID) {
        guard canAddRule, let i = config.rules.firstIndex(where: { $0.id == id }) else { return }
        var copy = config.rules[i]
        copy.id = UUID()
        copy.name += " copy"
        config.rules.insert(copy, at: i + 1)
        changed()
    }

    func setEnabled(_ id: UUID, _ enabled: Bool) {
        guard let i = config.rules.firstIndex(where: { $0.id == id }), config.rules[i].enabled != enabled else { return }
        config.rules[i].enabled = enabled
        changed()
    }

    private func changed() {
        if !launch.isPreview && !launch.live { config.save(to: defaults) }
        refillSoon()
    }

    // MARK: - What is scheduled

    /// The planned alerts the system holds, soonest first (in a preview, the plan as if it were held).
    var scheduled: [PlannedAlert] {
        plan.alerts.filter { pending.contains($0.id) }
    }

    /// Planned but not held: the permission is missing (or the system refused them).
    var unscheduled: [PlannedAlert] {
        plan.alerts.filter { !pending.contains($0.id) }
    }

    /// The instant the scheduler reads as now: the device's real time (a launch hook may set it for a preview).
    var now: Double { launch.now ?? Date.now.timeIntervalSince1970 }

    /// The rule's next moment after `t`. Between refills the planned one may have passed: then its next queued alert
    /// (its own, or one folded into another rule's), so countdowns never run into the past; the planned one as a last
    /// resort.
    func next(of id: UUID, after t: Double) -> AlertOccurrence? {
        let planned = plan.next[id]
        if let planned, planned.fire > t { return planned }
        for alert in plan.alerts where alert.fire > t {
            if alert.ruleID == id { return alert.occurrence }
            if let o = alert.also.first(where: { $0.ruleID == id }) { return o }
        }
        return planned
    }

    /// The first of `list` still to come at `t` (the last one if all have passed, until the next refill).
    static func upcoming(_ list: [PlannedAlert], after t: Double) -> PlannedAlert? {
        list.first { $0.fire > t } ?? list.last
    }

    // MARK: - Lifecycle

    /// Starts the store once: the first plan (it never waits for the system), the permission, refills when settings
    /// change, and on macOS a periodic background activity.
    func start() {
        guard !started else { return }
        started = true
        observeSettings()
        observeClock()
        #if os(macOS)
        if !launch.isPreview { startBackgroundActivity() }
        #endif
        Task { await refill() }
        Task {
            if launch.live {
                // -FXAlertsLive: provisional permission needs no prompt, so the real queue can be checked unattended.
                _ = await AlertScheduling.within(10) {
                    await AlertScheduling.requestAuthorization([.alert, .sound, .provisional])
                }
            }
            if await refreshAuthorization() { await refill() }
        }
    }

    func becameActive() {
        start()
        active = true
        Task { await refill() }
        Task {
            if await refreshAuthorization() { await refill() }
        }
    }

    func enteredBackground() {
        #if os(iOS)
        active = false
        wake?.cancel()
        #endif
    }

    /// An alert was delivered while the app is in front: the list moves on.
    func alertArrived() {
        refillSoon(after: 1)
    }

    /// Refills shortly, coalescing quick successive changes (toggles, edits).
    func refillSoon(after seconds: Double = 0.25) {
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            await self?.refill()
        }
    }

    /// Plans from the real now and makes the system's pending `alert.` requests match the plan. Runs one at a time;
    /// a call made meanwhile waits for a fresh pass, so when it returns the requests reflect everything before it.
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
            let input = AlertScheduling.Input(rules: config.rules, quiet: config.quiet, zone: AppSettings.shared.timeZone,
                                              pure: AppSettings.shared.pure, now: now)
            let result = await Task.detached(priority: .userInitiated) { AlertScheduling.make(input) }.value
            plan = result.plan
            messages = result.messages
            if launch.isPreview {
                pending = authorization.canPost ? Set(result.requests.map(\.id)) : []
                delivered = launch.demo ? AlertScheduling.demoDelivered(input) : []
            } else if authorization.canPost {
                let requests = result.requests
                if let held = await AlertScheduling.within(30, { await AlertScheduling.apply(requests) }) {
                    pending = held
                } else {
                    alertsLog.error("the notification centre did not answer while queueing")
                }
                delivered = await AlertScheduling.within(5) { await AlertScheduling.delivered() } ?? delivered
            } else {
                pending = []
                delivered = []
            }
            lastRefill = .now
            alertsLog.info("refill: \(result.plan.alerts.count) planned, \(self.pending.count) held, permission \(self.authorization.rawValue)")
        } while refillAgain
        scheduleWake()
    }

    /// While the app runs (always on macOS, in front on iOS), wakes when the next alert has fired — its slot is free
    /// and the list moves on — or at least every 15 minutes.
    private func scheduleWake() {
        wake?.cancel()
        guard active, !launch.isPreview else { return }
        let now = Date.now.timeIntervalSince1970
        let next = scheduled.first { $0.fire > now }?.fire ?? now + 900
        let delay = min(900, max(5, next - now + 1))
        wake = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.refill()
        }
    }

    /// Pure mode and the zone change what notifications say and when quiet hours fall.
    private func observeSettings() {
        withObservationTracking {
            _ = AppSettings.shared.pure
            _ = AppSettings.shared.zone
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.refillSoon()
                self?.observeSettings()
            }
        }
    }

    /// The device's clock was set or its time zone changed: pending requests count down in elapsed time and quiet
    /// hours follow the zone, so plan again (the zone setting may be "system").
    private func observeClock() {
        for name in [Notification.Name.NSSystemClockDidChange, .NSSystemTimeZoneDidChange] {
            clockObservers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { _ in
                Task { @MainActor in AlertStore.shared.refillSoon(after: 1) }
            })
        }
    }

    #if os(macOS)
    /// Refills about every 20 minutes while the app runs, even when it is not in front (the menu bar clock keeps it
    /// running), on the system's energy-aware schedule.
    private func startBackgroundActivity() {
        let scheduler = NSBackgroundActivityScheduler(identifier: "app.fractonica.clock.alerts.refill")
        scheduler.repeats = true
        scheduler.interval = 20 * 60
        scheduler.tolerance = 5 * 60
        scheduler.qualityOfService = .utility
        scheduler.schedule { completion in
            Task { @MainActor in
                await AlertStore.shared.refill()
                completion(.finished)
            }
        }
        activity = scheduler
    }
    #endif

    // MARK: - Permission

    /// Reads the permission; true when it changed. A system that does not answer leaves it as it was.
    @discardableResult
    func refreshAuthorization() async -> Bool {
        let next: Authorization
        if let fake = launch.authorization {
            next = fake
        } else if let read = await AlertScheduling.within(5, { await AlertScheduling.authorization() }) {
            next = read
        } else {
            alertsLog.error("the notification centre did not answer for the permission")
            return false
        }
        guard next != authorization else { return false }
        authorization = next
        return true
    }

    /// Asks the system for permission (the user chose to turn alerts on), then schedules.
    func requestAuthorization() async {
        guard !launch.isPreview else { return }
        await AlertScheduling.requestAuthorization([.alert, .sound])
        await refreshAuthorization()
        await refill()
    }

    /// Clears Alerts' notifications from the notification list.
    func clearDelivered() {
        let ids = delivered.map(\.id)
        delivered = []
        guard !launch.isPreview, !ids.isEmpty else { return }
        AlertScheduling.removeDelivered(ids)
    }

    // MARK: - Notifications in front

    /// How an alert shows while the app is in front: silenced ones go straight to the list.
    func presentation(of identifier: String) -> UNNotificationPresentationOptions {
        plan.alerts.first { $0.id == identifier }?.silenced == true ? [.list] : [.banner, .list, .sound]
    }

    /// The level a delivered alert's rule listens to, to select it when the alert is opened.
    func level(ofNotification identifier: String) -> Int? {
        let parts = identifier.dropFirst(AlertPlanner.prefix.count).split(separator: ".", maxSplits: 1)
        guard let first = parts.first, let id = UUID(uuidString: String(first)) else { return nil }
        return rule(id)?.subject.level
    }
}

/// A rendered notification: what the user will read.
struct AlertMessage: Hashable, Sendable {
    let title: String
    let body: String
    /// Plays the default sound.
    let sound: Bool
}

/// An alert in the notification list.
struct DeliveredAlert: Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    let body: String
    let date: Date
    let ruleID: UUID?
}

// MARK: - Scheduling (off the main actor)

/// The work of a refill that needs no main actor: planning and rendering (CPU), and talking to the notification
/// centre. Every notification-centre call is made here, never on the main thread: the centre answers over synchronous
/// XPC, and a daemon that is slow or stuck must not freeze the interface (these functions are nonisolated, so they run
/// on the global executor; the synchronous removals go to a detached task).
enum AlertScheduling {
    struct Input: Sendable {
        let rules: [AlertRule]
        let quiet: QuietHours
        let zone: TimeZone
        let pure: Bool
        let now: Double
    }

    /// One request to keep pending.
    struct Request: Sendable {
        let id: String
        let fire: Double
        let message: AlertMessage
        let passive: Bool
        let thread: String
        let link: AppLink
        let relevance: Double

        /// Changes whenever anything the user would notice changes; a pending request with the same identifier and
        /// fingerprint is left alone.
        var fingerprint: String {
            "\(Int64((fire * 1000).rounded()))|\(message.sound)|\(passive)|\(link.url.absoluteString)|\(message.title)|\(message.body)"
        }
    }

    struct Result: Sendable {
        let plan: AlertPlan
        let messages: [String: AlertMessage]
        let requests: [Request]
    }

    /// `work`'s result, or nil when it takes longer than `seconds` (a notification centre that never answers must not
    /// hold up the plan; the late answer is dropped).
    static func within<T: Sendable>(_ seconds: Double, _ work: @escaping @Sendable () async -> T) async -> T? {
        let once = Once<T?>()
        return await withCheckedContinuation { continuation in
            once.set(continuation)
            Task { once.resume(await work()) }
            Task {
                try? await Task.sleep(for: .seconds(seconds))
                once.resume(nil)
            }
        }
    }

    /// A continuation resumed by whichever of its racers comes first.
    private final class Once<T: Sendable>: Sendable {
        private let continuation = Mutex<CheckedContinuation<T, Never>?>(nil)

        func set(_ c: CheckedContinuation<T, Never>) {
            continuation.withLock { $0 = c }
        }

        func resume(_ value: T) {
            continuation.withLock { c in
                c?.resume(returning: value)
                c = nil
            }
        }
    }

    static let fingerprintKey = "fx.alert.fingerprint"
    static let ruleKey = "fx.alert.rule"

    static func make(_ input: Input) -> Result {
        let planner = AlertPlanner()
        let plan = planner.plan(rules: input.rules, quiet: input.quiet, zone: input.zone, now: input.now)
        let text = AlertText(words: Wording(pure: input.pure, timeZone: input.zone))
        let rules = Dictionary(input.rules.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var messages: [String: AlertMessage] = [:]
        var requests: [Request] = []
        for alert in plan.alerts {
            guard let rule = rules[alert.ruleID] else { continue }
            let o = alert.occurrence
            let also = alert.also.compactMap { other in rules[other.ruleID].map { (rule: $0, occurrence: other) } }
            let sound = !alert.silenced && (rule.sound || also.contains { $0.rule.sound })
            let message = AlertMessage(title: text.title(rule, o), body: text.body(rule, o, also: also), sound: sound)
            messages[alert.id] = message
            requests.append(Request(
                id: alert.id, fire: alert.fire, message: message, passive: alert.silenced,
                thread: AlertPlanner.prefix + rule.id.uuidString, link: link(for: o, lead: rule.lead),
                relevance: max(0.05, 1 - (o.subject.rank + 1) / 15)))
        }
        return Result(plan: plan, messages: messages, requests: requests)
    }

    /// Where a tap leads: cycles to the ladder, the sync and eclipses to Now; an alert that comes ahead of its moment
    /// shows that moment.
    static func link(for o: AlertOccurrence, lead: AlertLead) -> AppLink {
        let screen: Screen = o.subject.level != nil ? .ladder : .now
        return AppLink(screen: screen, time: lead.isAtMoment ? nil : o.time + 0.002)
    }

    /// Makes the pending `alert.` requests equal to `requests`: unchanged ones stay, changed or unwanted ones go,
    /// new ones are added. Returns the identifiers held afterwards.
    static func apply(_ requests: [Request]) async -> Set<String> {
        assertOffMain()
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        var held: [String: String] = [:]
        for request in pending where request.identifier.hasPrefix(AlertPlanner.prefix) {
            held[request.identifier] = request.content.userInfo[fingerprintKey] as? String ?? ""
        }
        let wanted = Dictionary(requests.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let stale = held.filter { wanted[$0.key]?.fingerprint != $0.value }.map(\.key)
        if !stale.isEmpty { center.removePendingNotificationRequests(withIdentifiers: stale) }
        var kept = Set(held.keys).subtracting(stale)
        for request in requests where !kept.contains(request.id) {
            let interval = request.fire - Date.now.timeIntervalSince1970
            guard interval > 0.5 else { continue }
            let content = UNMutableNotificationContent()
            content.title = request.message.title
            content.body = request.message.body
            content.sound = request.message.sound ? .default : nil
            content.interruptionLevel = request.passive ? .passive : .active
            content.threadIdentifier = request.thread
            content.relevanceScore = request.relevance
            var info: [String: String] = request.link.userInfo
            info[fingerprintKey] = request.fingerprint
            info[ruleKey] = String(request.thread.dropFirst(AlertPlanner.prefix.count))
            content.userInfo = info
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            do {
                try await center.add(UNNotificationRequest(identifier: request.id, content: content, trigger: trigger))
                kept.insert(request.id)
            } catch {
                continue
            }
        }
        return kept
    }

    /// Asks for permission; returns when the user has answered (or at once when they did before).
    static func requestAuthorization(_ options: UNAuthorizationOptions) async {
        assertOffMain()
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: options)
    }

    /// Takes alerts off the notification list.
    static func removeDelivered(_ identifiers: [String]) {
        Task.detached(priority: .utility) {
            assertOffMain()
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)
        }
    }

    /// Debug builds stop here if a notification-centre call ever comes back to the main thread.
    private static func assertOffMain() {
        #if DEBUG
        dispatchPrecondition(condition: .notOnQueue(.main))
        #endif
    }

    static func authorization() async -> AlertStore.Authorization {
        assertOffMain()
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .authorized: return .authorized
        case .provisional, .ephemeral: return .provisional
        @unknown default: return .authorized
        }
    }

    /// Alerts in the notification list, newest first (at most 20).
    static func delivered() async -> [DeliveredAlert] {
        assertOffMain()
        let list = await UNUserNotificationCenter.current().deliveredNotifications()
        return list.filter { $0.request.identifier.hasPrefix(AlertPlanner.prefix) }
            .map { n in
                DeliveredAlert(
                    id: n.request.identifier, title: n.request.content.title, body: n.request.content.body, date: n.date,
                    ruleID: (n.request.content.userInfo[ruleKey] as? String).flatMap(UUID.init(uuidString:)))
            }
            .sorted { $0.date > $1.date }
            .prefix(20)
            .map { $0 }
    }

    /// The demo's notification list: what the enabled rules said during the last Helion or so.
    static func demoDelivered(_ input: Input) -> [DeliveredAlert] {
        let planner = AlertPlanner()
        let text = AlertText(words: Wording(pure: input.pure, timeZone: input.zone))
        var out: [DeliveredAlert] = []
        for rule in input.rules where rule.enabled {
            let past = planner.occurrences(of: rule, after: input.now - 86_400, limit: 60).filter { $0.fire <= input.now }
            for o in past.suffix(2) {
                out.append(DeliveredAlert(id: o.identifier, title: text.title(rule, o), body: text.body(rule, o),
                                          date: Date(timeIntervalSince1970: o.fire), ruleID: rule.id))
            }
        }
        return Array(out.sorted { $0.date > $1.date }.prefix(4))
    }
}

// MARK: - Launch hooks

/// Alerts' test hooks, read from the launch arguments like the shell's (never persisted; a preview never touches the
/// notification centre and saves nothing):
///
///     -FXAlertsDemo 1                       the presets as rules, for this launch only
///     -FXAlertsNow <unix s>                 plan from this instant instead of the device's now (e.g. out of range)
///     -FXAlertsAuth notDetermined|denied|authorized|provisional   show this permission state
///     -FXAlertsEdit <preset>|new|rule       open the editor: a preset's new rule, a blank one, or the first rule
///     -FXAlertsQuiet 1                      quiet hours on (with -FXAlertsDemo)
///     -FXAlertsPrimer 1                     show the permission explanation for the first rule
///     -FXAlertsLive 1                       the demo rules really queued, with provisional (quiet, promptless)
///                                           permission: checks the system queue end to end; nothing is saved
///     -FXAlertsScroll quiet                 scroll to a section (hero rules presets quiet upcoming recent)
///     -FXAlertsLandscape 1                  turn an iPhone to landscape when the screen appears (iOS screenshots)
struct AlertLaunchOptions: Sendable {
    var demo = false
    var live = false
    var now: Double?
    var authorization: AlertStore.Authorization?
    var edit: String?
    var quiet = false
    var primer = false
    var landscape = false
    var pure = false
    /// `-FXAlertsScroll hero|rules|presets|quiet|upcoming|recent` (with -FXAlertsEdit: `only|when|message|delivery|coming`):
    /// scroll there on launch.
    var scroll: String?

    /// A hook that shows without scheduling is set.
    var isPreview: Bool { (demo && !live) || now != nil || authorization != nil }

    static func current(_ defaults: UserDefaults = .standard,
                        arguments: [String] = CommandLine.arguments) -> AlertLaunchOptions {
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        func flag(_ key: String) -> Bool { string(key).map { ["1", "yes", "true"].contains($0.lowercased()) } ?? false }
        // The argument domain reads "-FXAlertsNow -11253790000" as two flags: a moment before 1970 comes from the raw
        // arguments, the token after the flag whatever its sign (as the shell's -FXTime).
        let rawNow = arguments.firstIndex(of: "-FXAlertsNow").flatMap { i in i + 1 < arguments.count ? arguments[i + 1] : nil }
        return AlertLaunchOptions(
            demo: flag("FXAlertsDemo"),
            live: flag("FXAlertsLive"),
            now: (rawNow ?? string("FXAlertsNow")).flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil },
            authorization: string("FXAlertsAuth").flatMap { AlertStore.Authorization(rawValue: $0) },
            edit: string("FXAlertsEdit"),
            quiet: flag("FXAlertsQuiet"),
            primer: flag("FXAlertsPrimer"),
            landscape: flag("FXAlertsLandscape"),
            pure: flag("FXPure"),
            scroll: string("FXAlertsScroll")
        )
    }

    /// The demo's rules: every preset, the major turns switched off.
    var demoConfig: AlertsConfig {
        var rules = [AlertPreset.helion, .deltaQuarters, .solarQuarters, .eclipse, .nuclide, .majors].map { $0.rule(pure: pure) }
        rules[5].enabled = false
        rules[1].lead = pure ? AlertLead(count: 3, unit: .preon) : AlertLead(count: 30, unit: .minute)
        return AlertsConfig(rules: rules, quiet: QuietHours(enabled: quiet))
    }
}
