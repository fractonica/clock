import Foundation
import Observation

/// The stopwatch: stored dates and lap marks (never ticks), persisted under "timer.stopwatch.v1" so it keeps counting
/// across launches, with a Live Activity on iOS while it is not reset.
@MainActor @Observable
final class StopwatchStore {
    static let shared = StopwatchStore()
    static let storageKey = "timer.stopwatch.v1"

    private(set) var run = StopwatchRun()
    /// Bumped on every lap, for haptics and list animations.
    private(set) var lapCount = 0

    @ObservationIgnored private(set) var clock = RealClock()
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private(set) var isDemo = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var words: TimerWords {
        TimerWords(words: AppSettings.shared.wording, clock: clock, now: .now)
    }

    func restore() {
        if let data = defaults.data(forKey: Self.storageKey), let saved = try? JSONDecoder().decode(StopwatchRun.self, from: data) {
            run = saved
            lapCount = saved.marks.count
        }
        followWording()
        syncActivity()
    }

    /// A state for screenshots: never saved, no Live Activity.
    func demo(clock: RealClock, run: StopwatchRun) {
        isDemo = true
        self.clock = clock
        self.run = run
        lapCount = run.marks.count
    }

    func start() {
        run.start(at: .now)
        changed()
    }

    func stop() {
        run.stop(at: .now)
        changed()
    }

    func toggle() {
        if run.isRunning { stop() } else { start() }
    }

    func lap() {
        guard run.isRunning else { return }
        run.lap(at: .now)
        lapCount = run.marks.count
        changed()
    }

    func reset() {
        guard !run.isRunning else { return }
        run.reset()
        lapCount = 0
        changed()
    }

    /// Lap while running, reset while stopped (the left button).
    func lapOrReset() {
        if run.isRunning { lap() } else { reset() }
    }

    func enteredBackground() {
        syncActivity()
    }

    private func changed() {
        guard !isDemo else { return }
        if let data = try? JSONEncoder().encode(run) { defaults.set(data, forKey: Self.storageKey) }
        syncActivity()
    }

    private func syncActivity() {
        #if os(iOS) && canImport(ActivityKit)
        guard !isDemo else { return }
        guard !run.isClear else { return TimerActivities.show(.stopwatch, runID: nil, state: nil) }
        TimerActivities.show(.stopwatch, runID: run.id.uuidString, state: TimerActivities.state(for: run, words: words))
        #endif
    }

    private func followWording() {
        withObservationTracking {
            _ = AppSettings.shared.wording
        } onChange: { [weak self] in
            Task { @MainActor in
                self?.syncActivity()
                self?.followWording()
            }
        }
    }
}
