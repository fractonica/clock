import FractonicaKit
import Foundation

// The timer and the stopwatch as values: what was set, when it rings, what is left. Everything is a stored date
// or span, never a count of ticks, so a run survives the app being closed and reads right whenever it is looked at.
// Pure logic (no UI, no system services): checked by Features/Timer/Checks. TimerStore and StopwatchStore own the
// side effects.

/// What a timer was set to.
enum TimerSpec: Codable, Hashable, Sendable {
    /// A span on the ladder ("4ι").
    case ladder(LadderSpan)
    /// An Earth span in whole seconds ("5 min"; Earth mode only).
    case earth(seconds: Int)
    /// Until a cycle begins ("Until 30ι").
    case aligned(AlignedTarget)

    /// How the run counts: ladder timers in Blinks, Earth timers in seconds.
    var measure: TimerRun.Measure {
        if case .earth = self { return .earth }
        return .ladder
    }
}

extension LadderSpan: Codable {
    init(from decoder: Decoder) throws {
        self.init(blinks: try decoder.singleValueContainer().decode(Int.self))
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(blinks)
    }
}

/// A timer that has been started: running towards `end`, or paused with `left` to go.
struct TimerRun: Codable, Hashable, Sendable, Identifiable {
    /// The unit a run counts in: Blinks (exact on the ladder, through the clock's position) or Earth seconds.
    enum Measure: String, Codable, Sendable {
        case ladder, earth
    }

    enum Problem: Error, Equatable {
        /// The span is empty.
        case empty
        /// Real now, or the end, lies outside the catalogue: a ladder timer cannot be measured there.
        case outsideCatalogue
    }

    var id = UUID()
    var spec: TimerSpec
    var measure: Measure
    /// The whole length in the measure's unit, additions included.
    var total: Double
    /// Device time when it rings; nil while paused.
    var end: Date?
    /// What is left while paused, in the measure's unit.
    var left: Double?
    /// When it was first started.
    var started: Date

    var isRunning: Bool { end != nil }

    // MARK: Starting

    /// Starts `spec` at `now`.
    static func start(_ spec: TimerSpec, at now: Date, clock: RealClock) -> Result<TimerRun, Problem> {
        switch spec {
        case .ladder(let span):
            guard !span.isZero else { return .failure(.empty) }
            guard let end = clock.date(after: now, blinks: Double(span.blinks)) else { return .failure(.outsideCatalogue) }
            return .success(TimerRun(spec: spec, measure: .ladder, total: Double(span.blinks), end: end, started: now))
        case .earth(let seconds):
            guard seconds > 0 else { return .failure(.empty) }
            return .success(TimerRun(spec: spec, measure: .earth, total: Double(seconds), end: now.addingTimeInterval(Double(seconds)), started: now))
        case .aligned(let target):
            let end = clock.date(target.time)
            guard let blinks = clock.blinks(from: now, to: end) else { return .failure(.outsideCatalogue) }
            guard blinks > 0 else { return .failure(.empty) }
            return .success(TimerRun(spec: spec, measure: .ladder, total: blinks, end: end, started: now))
        }
    }

    // MARK: Reading

    /// What is left in the measure's unit (never negative); nil for a ladder timer when now lies outside the catalogue.
    func remaining(at now: Date, clock: RealClock) -> Double? {
        if let left { return left }
        guard let end else { return 0 }
        switch measure {
        case .earth: return max(0, end.timeIntervalSince(now))
        case .ladder: return clock.blinks(from: now, to: end).map { max(0, $0) }
        }
    }

    /// Blinks left; for an Earth timer converted at now. Nil outside the catalogue.
    func remainingBlinks(at now: Date, clock: RealClock) -> Double? {
        guard let left = remaining(at: now, clock: clock) else { return nil }
        switch measure {
        case .ladder: return left
        case .earth: return clock.blinkSeconds(at: now).map { left / $0 }
        }
    }

    /// Device seconds left (exact while running; while paused a ladder span is converted at now, falling back to the
    /// mean Blink outside the catalogue).
    func remainingSeconds(at now: Date, clock: RealClock) -> Double {
        if let end { return max(0, end.timeIntervalSince(now)) }
        let left = left ?? 0
        switch measure {
        case .earth: return left
        case .ladder: return left * (clock.blinkSeconds(at: now) ?? clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds)
        }
    }

    /// The whole length in device seconds (a ladder total converted at now).
    func totalSeconds(at now: Date, clock: RealClock) -> Double {
        switch measure {
        case .earth: return total
        case .ladder: return total * (clock.blinkSeconds(at: now) ?? clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds)
        }
    }

    /// 1 at the start, 0 when it rings.
    func fraction(at now: Date, clock: RealClock) -> Double {
        guard total > 0 else { return 0 }
        let left = remaining(at: now, clock: clock) ?? remainingSeconds(at: now, clock: clock) / max(1e-9, totalSeconds(at: now, clock: clock)) * total
        return min(1, max(0, left / total))
    }

    /// Whether it has rung by `now`.
    func isDone(at now: Date) -> Bool {
        guard let end else { return false }
        return end <= now
    }

    /// The total as a ladder span (an Earth total converted at now): what the countdown's fields are sized for.
    func totalSpan(at now: Date, clock: RealClock) -> LadderSpan {
        switch measure {
        case .ladder: return LadderSpan(blinks: LadderReadout.ceilBlinks(total))
        case .earth: return LadderSpan(blinks: LadderReadout.ceilBlinks(total / (clock.blinkSeconds(at: now) ?? clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds)))
        }
    }

    // MARK: Changing

    /// Freezes what is left.
    mutating func pause(at now: Date, clock: RealClock) {
        guard let end else { return }
        switch measure {
        case .earth:
            left = max(0, end.timeIntervalSince(now))
        case .ladder:
            left = max(0, clock.blinks(from: now, to: end) ?? end.timeIntervalSince(now) / clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds)
        }
        self.end = nil
    }

    /// Runs again from `now`; fails (and stays paused) when a ladder span cannot be laid out from now.
    mutating func resume(at now: Date, clock: RealClock) -> Bool {
        guard let left, end == nil else { return end != nil }
        switch measure {
        case .earth:
            end = now.addingTimeInterval(left)
        case .ladder:
            guard let date = clock.date(after: now, blinks: left) else { return false }
            end = date
        }
        self.left = nil
        return true
    }

    /// Adds `blinks` to a ladder run (or their length at now to an Earth one); false when the new end would leave the
    /// catalogue.
    mutating func add(blinks: Int, at now: Date, clock: RealClock) -> Bool {
        switch measure {
        case .ladder:
            if let end {
                guard let later = clock.date(after: end, blinks: Double(blinks)) else { return false }
                self.end = later
            } else {
                left = (left ?? 0) + Double(blinks)
            }
            total += Double(blinks)
        case .earth:
            guard let seconds = clock.blinkSeconds(at: now) else { return false }
            add(seconds: Double(blinks) * seconds, at: now, clock: clock)
        }
        return true
    }

    /// Adds Earth seconds (an Earth run; a ladder run takes their length in Blinks at now).
    mutating func add(seconds: Double, at now: Date, clock: RealClock) {
        switch measure {
        case .earth:
            if let end { self.end = end.addingTimeInterval(seconds) } else { left = (left ?? 0) + seconds }
            total += seconds
        case .ladder:
            guard let b = clock.blinkSeconds(at: now) else { return }
            _ = add(blinks: Int((seconds / b).rounded()), at: now, clock: clock)
        }
    }
}

// MARK: - Stopwatch

/// A stopwatch: banked time plus the run since `since`, and the lap marks.
struct StopwatchRun: Codable, Hashable, Sendable {
    /// Identifies a run from its first start to its reset (its Live Activity).
    var id = UUID()
    /// Running since this device date; nil while stopped.
    var since: Date?
    /// Seconds counted before `since`.
    var banked: Double = 0
    /// Elapsed seconds at each lap mark, in order.
    var marks: [Double] = []

    var isRunning: Bool { since != nil }
    /// Never started, or reset.
    var isClear: Bool { since == nil && banked == 0 && marks.isEmpty }

    func elapsed(at now: Date) -> Double {
        banked + (since.map { max(0, now.timeIntervalSince($0)) } ?? 0)
    }

    /// The device date at which a continuous run would have read zero (for system timers counting up).
    func zero(at now: Date) -> Date { now.addingTimeInterval(-elapsed(at: now)) }

    mutating func start(at now: Date) {
        guard since == nil else { return }
        since = now
    }

    mutating func stop(at now: Date) {
        guard since != nil else { return }
        banked = elapsed(at: now)
        since = nil
    }

    mutating func lap(at now: Date) {
        guard since != nil else { return }
        marks.append(elapsed(at: now))
    }

    mutating func reset() {
        self = StopwatchRun()
    }

    /// The elapsed seconds at which the current lap began.
    var currentLapStart: Double { marks.last ?? 0 }

    /// Every lap, newest first: the running lap (index marks.count + 1) and the finished ones, each as its own span and
    /// the split (the total at its end).
    func laps(at now: Date) -> [Lap] {
        let total = elapsed(at: now)
        var out: [Lap] = []
        if !isClear {
            out.append(Lap(number: marks.count + 1, span: total - currentLapStart, split: total, isCurrent: true))
        }
        for (i, mark) in marks.enumerated().reversed() {
            let start = i == 0 ? 0 : marks[i - 1]
            out.append(Lap(number: i + 1, span: mark - start, split: mark, isCurrent: false))
        }
        return out
    }

    /// The fastest and slowest finished laps, once there are at least two.
    var extremes: (fastest: Int, slowest: Int)? {
        guard marks.count >= 2 else { return nil }
        let spans = marks.enumerated().map { i, m in m - (i == 0 ? 0 : marks[i - 1]) }
        guard let lo = spans.indices.min(by: { spans[$0] < spans[$1] }),
              let hi = spans.indices.max(by: { spans[$0] < spans[$1] }), lo != hi else { return nil }
        return (lo + 1, hi + 1)
    }

    struct Lap: Hashable, Sendable, Identifiable {
        let number: Int
        /// Seconds of this lap.
        let span: Double
        /// Seconds from the start to the lap's end (to now for the running lap).
        let split: Double
        let isCurrent: Bool
        var id: Int { number }
    }
}

// MARK: - Earth readouts

enum EarthClockText {
    /// "4:59", "1:04:59": a countdown's whole seconds, rounded up.
    static func countdown(_ seconds: Double) -> String {
        let s = Int(max(0, seconds - 1e-3).rounded(.up))
        return hms(s)
    }

    /// "0:28.47", "1:04:59.10": a stopwatch's elapsed time with hundredths.
    static func stopwatch(_ seconds: Double) -> String {
        let hundredths = Int((max(0, seconds) * 100 + 1e-6).rounded(.down))
        let s = hundredths / 100
        let h = hundredths % 100
        return "\(hms(s, padMinutes: true)).\(h < 10 ? "0" : "")\(h)"
    }

    /// Seconds as "m:ss" or "h:mm:ss".
    static func hms(_ s: Int, padMinutes: Bool = false) -> String {
        let hours = s / 3600, minutes = (s / 60) % 60, seconds = s % 60
        let ss = seconds < 10 ? "0\(seconds)" : "\(seconds)"
        if hours > 0 { return "\(hours):\(minutes < 10 ? "0" : "")\(minutes):\(ss)" }
        return "\(padMinutes && minutes < 10 ? "0" : "")\(minutes):\(ss)"
    }

    /// "5 min", "1 h 30 min", "45 s": the name of an Earth span.
    static func name(seconds: Int) -> String {
        let h = seconds / 3600, m = (seconds / 60) % 60, s = seconds % 60
        var parts: [String] = []
        if h > 0 { parts.append("\(h) h") }
        if m > 0 { parts.append("\(m) min") }
        if s > 0 { parts.append("\(s) s") }
        return parts.isEmpty ? "0 s" : parts.joined(separator: " ")
    }
}
