import SwiftUI

/// A `TimelineSchedule` for real-time readouts: entries exactly where a readout changes, on one or more grids of
/// device time (`anchor + k · step`). A countdown in Blinks changes on the Blink grid that ends at its end; its Earth
/// seconds on the second grid that ends there. The Timer and the Stopwatch run on the device clock, not on the
/// displayed time, so they schedule themselves instead of using `ClockTimeline`.
///
///     TimelineView(TickSchedule(anchor: run.end, steps: [blinkSeconds, 1], paused: !running)) { context in … }
struct TickSchedule: TimelineSchedule, Sendable {
    /// A moment on every grid (the end of a countdown, the zero of a stopwatch).
    let anchor: Date
    /// Grid spacings in seconds; non-positive or non-finite ones are ignored.
    let steps: [Double]
    /// Only the first entry: the content draws once and waits for the next change.
    var paused = false

    /// The shortest gap between entries, so a readout never redraws faster than this.
    static let minimumGap = 1.0 / 60

    func entries(from startDate: Date, mode: TimelineScheduleMode) -> Entries {
        Entries(upcoming: startDate, schedule: self)
    }

    struct Entries: Sequence, IteratorProtocol {
        var upcoming: Date?
        let schedule: TickSchedule

        mutating func next() -> Date? {
            guard let date = upcoming else { return nil }
            upcoming = schedule.paused ? nil : schedule.tick(after: date)
            return date
        }
    }

    /// The first grid line strictly after `date` (at least `minimumGap` later); nil without a usable step.
    func tick(after date: Date) -> Date? {
        let usable = steps.filter { $0.isFinite && $0 > 0 }
        guard !usable.isEmpty else { return nil }
        let x = date.timeIntervalSince(anchor)
        let next = usable.map { step in
            var k = (x / step).rounded(.down) + 1
            if (k * step - x) < Self.minimumGap { k += 1 }
            return k * step
        }.min()!
        return anchor.addingTimeInterval(next)
    }
}
