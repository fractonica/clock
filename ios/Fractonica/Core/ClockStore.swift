import FractonicaKit
import Foundation
import Observation

/// The displayed time: the one clock every screen reads (the time half of src/core/store.js).
///
///     live     displayed time = the device clock
///     travel   displayed time = anchor.t + rate · (now − anchor.real)
///              rate 0 = paused at a chosen moment, 1 = real speed from an offset, anything else = time-lapse
///              (displayed seconds per real second; negative runs backwards)
///
/// Screens never keep their own clock: they read `time(at:)` through `ClockTimeline`, which redraws them at the cadence
/// they ask for. Discontinuities (a jump, a rate change, back to live, a stop at the catalogue edge) bump `revision`
/// and record `lastChange`, so audio or animations can resynchronise with `.onChange(of: store.revision)`; continuous
/// playback changes nothing observable. Times are Unix seconds (SPEC §2.1). Travel is clamped to the catalogue and a
/// time-lapse stops at its edge: nothing is ever extrapolated.
@MainActor @Observable
final class ClockStore {
    /// The app's clock. Views read it from the environment (`@Environment(ClockStore.self)`); lifecycle hooks and
    /// other non-view code use this instance.
    static let shared = ClockStore()

    enum Mode: Sendable { case live, travel }

    /// Why the displayed time last jumped.
    enum Change: Sendable {
        /// The app started.
        case launch
        /// `travel(to:)` or `shift(by:)`.
        case jump
        /// `step(level:direction:)`.
        case cycle
        /// `setRate(_:)` or `play()`.
        case rate
        case pause
        case live
        /// A time-lapse reached the catalogue edge and stopped there.
        case edge
    }

    /// An end of the catalogue, where stepping or playing cannot go further.
    enum Edge: Sendable { case start, end }

    /// The displayed time as a function of real time: t = t0 + rate · (real − real0). Live is (0, 0, 1).
    struct TimeBase: Sendable, Equatable {
        var t0: Double
        var real0: Double
        var rate: Double

        static let live = TimeBase(t0: 0, real0: 0, rate: 1)

        func t(atReal real: Double) -> Double { t0 + rate * (real - real0) }
    }

    /// The engine every reading goes through.
    @ObservationIgnored let clock: FractonicaClock

    private(set) var mode: Mode = .live
    /// Displayed seconds per real second: 1 while live, 0 while paused.
    private(set) var rate: Double = 1
    private(set) var base: TimeBase = .live
    /// Bumps on every discontinuity (see `Change`).
    private(set) var revision = 0
    private(set) var lastChange: Change = .launch
    /// The speed Play uses (and a time-lapse keeps while running): one hour per second in Earth mode, 4ι per Blink in
    /// pure mode (`adoptPlayRate(pure:)`).
    var playRate: Double = TimeLapse.earthPlayRate

    @ObservationIgnored private var edgeTask: Task<Void, Never>?

    init(clock: FractonicaClock = .shared) {
        self.clock = clock
    }

    // MARK: Reading

    /// The displayed time at a real instant (Unix seconds). Cheap: call it for every frame.
    func time(at date: Date = .now) -> Double {
        let t = base.t(atReal: date.timeIntervalSince1970)
        return mode == .live ? t : clock.clamp(t)
    }

    var isLive: Bool { mode == .live }
    /// A time-lapse (or real-speed travel) is running.
    var isPlaying: Bool { mode == .travel && rate != 0 }
    /// The displayed time stands still.
    var isPaused: Bool { mode == .travel && rate == 0 }
    /// The catalogue's time span, Unix seconds.
    var catalogue: ClosedRange<Double> { clock.tMin...clock.tMax }

    // MARK: Moving

    /// Back to the device clock.
    func goLive() {
        mode = .live
        rate = 1
        base = .live
        changed(.live)
    }

    /// Show the moment `t` (clamped to the catalogue). `rate` nil keeps the running rate when already travelling and
    /// pauses otherwise.
    func travel(to t: Double, rate newRate: Double? = nil) {
        travel(to: t, rate: newRate, change: .jump)
    }

    /// Move the displayed time by `dt` seconds.
    func shift(by dt: Double) {
        travel(to: time() + dt)
    }

    /// Run a time-lapse at `rate` displayed seconds per real second from the displayed moment (0 pauses, negative runs
    /// backwards). A non-zero rate also becomes the speed Play uses.
    func setRate(_ newRate: Double) {
        let t = time()
        mode = .travel
        rate = newRate
        base = TimeBase(t0: t, real0: Date.now.timeIntervalSince1970, rate: newRate)
        if newRate != 0 { playRate = newRate }
        changed(newRate == 0 ? .pause : .rate)
    }

    func pause() { setRate(0) }

    /// Start the time-lapse at `playRate`; returns the edge instead when already standing at it.
    @discardableResult
    func play() -> Edge? {
        let t = time()
        if playRate > 0, t >= clock.tMax - 1 { return .end }
        if playRate < 0, t <= clock.tMin + 1 { return .start }
        setRate(playRate)
        return nil
    }

    @discardableResult
    func togglePlay() -> Edge? {
        if isPlaying {
            pause()
            return nil
        }
        return play()
    }

    /// Jump to the start of the next cycle of `level` (`direction` > 0), or to the start of the current one, or the
    /// previous one when within a second of the current start (`direction` < 0) — `stepCycle` of src/main.js.
    /// Returns the catalogue edge when there is nowhere to go.
    @discardableResult
    func step(level: Int, direction: Int) -> Edge? {
        let t = time()
        guard let current = clock.level(at: t, level) else { return direction > 0 ? .end : .start }
        if direction > 0 {
            guard current.end < clock.tMax else { return .end }
            travel(to: current.end + 0.001, rate: nil, change: .cycle)
            return nil
        }
        if t - current.start > 1 {
            travel(to: current.start + 0.001, rate: nil, change: .cycle)
            return nil
        }
        guard let previous = clock.level(at: current.start - 0.002, level) else { return .start }
        travel(to: previous.start + 0.001, rate: nil, change: .cycle)
        return nil
    }

    // MARK: Transport

    /// The speed the transport shows as chosen: real time while live, the running rate during a time-lapse, else
    /// the speed Play will use.
    var chosenRate: Double { isLive ? 1 : isPlaying ? rate : playRate }

    /// +1 forward, −1 backward: the direction of the chosen speed.
    var direction: Int { chosenRate < 0 ? -1 : 1 }

    /// Choose a speed in the transport: starts the time-lapse at `rate` (negative runs backwards), except real time
    /// while live, which simply stays live.
    func selectSpeed(_ newRate: Double) {
        if newRate == 1, isLive {
            playRate = 1
            return
        }
        setRate(newRate)
    }

    /// Turn the time-lapse around: Play's speed changes sign, and a running time-lapse continues the other way.
    func setDirection(_ sign: Int) {
        let magnitude = abs(isPlaying ? rate : playRate)
        let signed = sign < 0 ? -magnitude : magnitude
        if isPlaying { setRate(signed) } else { playRate = signed }
    }

    /// Keep Play's speed in the vocabulary of the mode: the Earth default (one hour per second) becomes the pure
    /// default (4ι per Blink) and back; any other chosen speed is kept.
    func adoptPlayRate(pure: Bool) {
        let pureDefault = Notation.standard.playRate
        if pure, playRate == TimeLapse.earthPlayRate {
            playRate = pureDefault
        } else if !pure, abs(playRate - pureDefault) < 1e-6 {
            playRate = TimeLapse.earthPlayRate
        }
    }

    // MARK: Internals

    private func travel(to t: Double, rate newRate: Double?, change: Change) {
        let keep = mode == .travel ? rate : 0
        mode = .travel
        rate = newRate ?? keep
        base = TimeBase(t0: clock.clamp(t), real0: Date.now.timeIntervalSince1970, rate: rate)
        changed(change)
    }

    private func changed(_ change: Change) {
        lastChange = change
        revision &+= 1
        scheduleEdgeStop()
    }

    /// A running time-lapse stops exactly at the catalogue edge it is heading for (`time(at:)` clamps meanwhile).
    private func scheduleEdgeStop() {
        edgeTask?.cancel()
        edgeTask = nil
        guard mode == .travel, rate != 0 else { return }
        let edge = rate > 0 ? clock.tMax : clock.tMin
        let wait = max(0, (edge - base.t0) / rate)
        edgeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(wait))
            guard !Task.isCancelled, let self else { return }
            self.mode = .travel
            self.rate = 0
            self.base = TimeBase(t0: edge, real0: Date.now.timeIntervalSince1970, rate: 0)
            self.lastChange = .edge
            self.revision &+= 1
            self.edgeTask = nil
        }
    }
}

/// A time-lapse speed of the transport: `rate` displayed seconds per real second, with its label.
struct TimeLapse: Identifiable, Hashable, Sendable {
    let id: String
    let rate: Double
    let label: String

    /// Earth-mode presets (`RATES` in src/main.js), real time first.
    static let earth: [TimeLapse] = [
        TimeLapse(id: "real", rate: 1, label: "×1 real time"),
        TimeLapse(id: "x10", rate: 10, label: "×10"),
        TimeLapse(id: "minute", rate: 60, label: "×60 · 1 min/s"),
        TimeLapse(id: "minute10", rate: 600, label: "×600 · 10 min/s"),
        TimeLapse(id: "hour", rate: 3600, label: "×3,600 · 1 h/s"),
        TimeLapse(id: "day", rate: 86400, label: "×86,400 · 1 d/s"),
        TimeLapse(id: "week", rate: 604_800, label: "×604,800 · 1 wk/s"),
        TimeLapse(id: "month", rate: 2_629_800, label: "×2.63 M · 1 mo/s"),
        TimeLapse(id: "year", rate: 31_557_600, label: "×31.6 M · 1 y/s"),
    ]

    /// Play's default speed in Earth mode: one hour per second.
    static let earthPlayRate = 3600.0
}
