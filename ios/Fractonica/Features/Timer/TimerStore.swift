import FractonicaKit
import Foundation
import Observation
import SwiftUI

/// The timer: the run (if any), the duration being set, recent timers, and everything a run does outside the screen —
/// the ring when it ends (chime, haptic, alert or toast), its notification and its Live Activity. One timer at a time,
/// on the device clock; persisted under "timer.v1" so a run survives the app being closed (`TimerHooks` restores it at
/// launch and rings a timer that ended meanwhile).
@MainActor @Observable
final class TimerStore {
    static let shared = TimerStore()
    static let storageKey = "timer.v1"

    /// The duration on the wheels.
    struct Draft: Codable, Hashable {
        enum Input: String, Codable, CaseIterable {
            case ladder, earth
        }

        var ladder = LadderSpan(iota: 4)
        var earthSeconds = 300
        /// Earth mode may set the wheels in hours, minutes and seconds.
        var input: Input = .ladder

        /// What Start starts in the current mode (pure mode always sets the ladder).
        func spec(pure: Bool) -> TimerSpec {
            pure || input == .ladder ? .ladder(ladder) : .earth(seconds: earthSeconds)
        }
    }

    /// A timer that has rung and is waiting to be acknowledged.
    struct Ringing: Identifiable, Equatable {
        let id: UUID
        let spec: TimerSpec
        /// When it rang.
        let at: Date
    }

    private struct Saved: Codable {
        var run: TimerRun?
        var draft: Draft
        var recents: [TimerSpec]
    }

    private(set) var run: TimerRun?
    var draft = Draft() {
        didSet { if draft != oldValue { save() } }
    }
    /// Timers set on the wheels lately, newest first (presets and aligned ends have their own rows).
    private(set) var recents: [TimerSpec] = []
    private(set) var ringing: Ringing?
    private(set) var access: TimerNotifications.Access = .unknown
    /// Why the last start failed, for the screen to say.
    var problem: TimerRun.Problem?

    /// Real time on the clock (offset only under the -FXTimerNow launch argument).
    @ObservationIgnored private(set) var clock = RealClock()
    /// Set by TimerScreen: the ring shows as an alert there, elsewhere as a toast and a banner.
    @ObservationIgnored var isScreenVisible = false
    @ObservationIgnored private(set) var isAppActive = true
    @ObservationIgnored private var ringTask: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults
    /// Screenshot states: nothing is saved, posted or shown outside the app.
    @ObservationIgnored private(set) var isDemo = false
    @ObservationIgnored private var restoring = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The words of the current mode at real now.
    var words: TimerWords {
        TimerWords(words: AppSettings.shared.wording, clock: clock, now: .now)
    }

    // MARK: Launch

    /// Loads the saved state, then rings a timer that ended while the app was closed.
    func restore() {
        if let data = defaults.data(forKey: Self.storageKey), let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            restoring = true
            draft = saved.draft
            restoring = false
            run = saved.run
            recents = saved.recents
        }
        followWording()
        reconcile()
        changed(save: false)
        refreshAccess()
    }

    /// A state for screenshots (launch arguments): never saved, no notification, no Live Activity.
    func demo(clock: RealClock, run: TimerRun?, draft: Draft?, ringing: TimerSpec?) {
        isDemo = true
        self.clock = clock
        if let draft {
            restoring = true
            self.draft = draft
            restoring = false
        }
        self.run = run
        if let ringing { self.ringing = Ringing(id: UUID(), spec: ringing, at: .now) }
        armRingTask()
    }

    // MARK: Running

    /// Starts a timer (replacing any running one); false, with `problem` set, when it cannot start.
    @discardableResult
    func start(_ spec: TimerSpec) -> Bool {
        dismissRinging()
        switch TimerRun.start(spec, at: .now, clock: clock) {
        case .success(let new):
            problem = nil
            run = new
            remember(spec)
            changed()
            askForNotifications()
            return true
        case .failure(let failure):
            problem = failure
            Haptics.play(.warning)
            return false
        }
    }

    func pause() {
        guard var run, run.isRunning else { return }
        run.pause(at: .now, clock: clock)
        self.run = run
        changed()
    }

    func resume() {
        guard var run, !run.isRunning else { return }
        guard run.resume(at: .now, clock: clock) else {
            problem = .outsideCatalogue
            Haptics.play(.warning)
            return
        }
        self.run = run
        changed()
    }

    func togglePause() {
        if run?.isRunning == true { pause() } else { resume() }
    }

    func cancel() {
        guard run != nil else { return }
        run = nil
        changed()
    }

    /// +1 of a ladder unit.
    func add(_ unit: LadderUnit) {
        guard var run else { return }
        guard run.add(blinks: unit.blinks, at: .now, clock: clock) else {
            problem = .outsideCatalogue
            Haptics.play(.warning)
            return
        }
        self.run = run
        changed()
    }

    /// +1 min to an Earth timer.
    func addMinute() {
        guard var run else { return }
        run.add(seconds: 60, at: .now, clock: clock)
        self.run = run
        changed()
    }

    // MARK: Ringing

    /// Rings the run if its end has come (at launch, on returning to the app, when its task wakes, when its
    /// notification arrives in front).
    func reconcile(now: Date = .now) {
        guard let run, let end = run.end else { return }
        guard run.isDone(at: now) else { return armRingTask() }
        ring(run, live: isAppActive && now.timeIntervalSince(end) < 3)
    }

    private func ring(_ finished: TimerRun, live: Bool) {
        let end = finished.end ?? .now
        let title = words.title(finished.spec)
        run = nil
        changed()
        if live {
            ringing = Ringing(id: finished.id, spec: finished.spec, at: end)
            Haptics.play(.success)
            TimerChime.shared.play(repeating: isScreenVisible)
            if !isScreenVisible { ToastCenter.shared.show("Timer done · \(title)", for: 4) }
        } else if Date.now.timeIntervalSince(end) < 120 {
            // came back to the app right after it rang (the notification has played the chime)
            ringing = Ringing(id: finished.id, spec: finished.spec, at: end)
        } else {
            ToastCenter.shared.show("\(title) rang at \(words.moment(end))", for: 4)
        }
    }

    /// Stops the chime and clears the alert.
    func dismissRinging() {
        TimerChime.shared.stop()
        guard ringing != nil else { return }
        ringing = nil
        if !isDemo { TimerNotifications.clearDelivered() }
    }

    /// Starts the timer that rang again; an aligned one waits for the following cycle.
    func repeatRinging() {
        guard let spec = ringing?.spec else { return }
        dismissRinging()
        if case .aligned(let target) = spec {
            if let next = AlignedTarget.next(level: target.level, after: clock.t(.now)) { start(.aligned(next)) }
        } else {
            start(spec)
        }
    }

    /// The Timer screen appeared or disappeared.
    func screen(visible: Bool) {
        isScreenVisible = visible
        guard visible, let ringing else { return }
        if Date.now.timeIntervalSince(ringing.at) > 600 { dismissRinging() }
    }

    // MARK: Lifecycle

    func becameActive() {
        isAppActive = true
        reconcile()
        refreshAccess()
    }

    func enteredBackground() {
        isAppActive = false
        TimerChime.shared.stop()
        // re-word what shows outside the app in the current mode
        changed(save: false)
    }

    // MARK: Effects

    private func changed(save shouldSave: Bool = true) {
        if shouldSave { save() }
        armRingTask()
        guard !isDemo else { return }
        scheduleNotification()
        syncActivity()
    }

    private func save() {
        guard !isDemo, !restoring else { return }
        let saved = Saved(run: run, draft: draft, recents: recents)
        if let data = try? JSONEncoder().encode(saved) { defaults.set(data, forKey: Self.storageKey) }
    }

    /// Wakes the app's own ring at the run's end (the notification covers a closed app).
    private func armRingTask() {
        ringTask?.cancel()
        ringTask = nil
        guard let end = run?.end else { return }
        ringTask = Task { [weak self] in
            let wait = end.timeIntervalSinceNow
            if wait > 0 {
                try? await Task.sleep(until: .now + .seconds(wait), tolerance: .milliseconds(10), clock: .continuous)
            }
            guard !Task.isCancelled else { return }
            self?.reconcile(now: max(.now, end))
        }
    }

    private func scheduleNotification() {
        guard let run, let end = run.end else { return TimerNotifications.replace(with: nil) }
        TimerNotifications.replace(with: TimerNotifications.Plan(
            id: TimerNotifications.prefix + run.id.uuidString,
            after: end.timeIntervalSinceNow,
            title: "Timer done",
            body: words.notificationBody(run),
            link: AppLink(screen: .timer).userInfo
        ))
    }

    private func syncActivity() {
        #if os(iOS) && canImport(ActivityKit)
        guard let run else { return TimerActivities.show(.timer, runID: nil, state: nil) }
        TimerActivities.show(.timer, runID: run.id.uuidString, state: TimerActivities.state(for: run, words: words), staleDate: run.end)
        #endif
    }

    /// Re-words the notification and the Live Activity when pure mode or the zone changes.
    private func followWording() {
        withObservationTracking {
            _ = AppSettings.shared.wording
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.changed(save: false)
                self.followWording()
            }
        }
    }

    private func remember(_ spec: TimerSpec) {
        switch spec {
        case .ladder(let span) where TimerPresets.spans.contains(span):
            return
        case .ladder, .earth:
            recents.removeAll { $0 == spec }
            recents.insert(spec, at: 0)
            recents = Array(recents.prefix(4))
        case .aligned:
            return
        }
    }

    func forget(_ spec: TimerSpec) {
        recents.removeAll { $0 == spec }
        save()
    }

    // MARK: Notifications permission

    /// Asks at the moment of intent: the first time a timer starts.
    private func askForNotifications() {
        guard !isDemo, access == .unknown else { return }
        Task {
            access = await TimerNotifications.requestIfNeeded()
            if access == .allowed { scheduleNotification() }
        }
    }

    private func refreshAccess() {
        guard !isDemo else { return }
        Task { access = await TimerNotifications.access() }
    }
}
