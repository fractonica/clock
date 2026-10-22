import FractonicaKit
import Foundation

// When a widget's picture changes. A widget timeline holds an entry exactly at every instant something it draws
// changes (a glyph state, a count, a quarter, an Earth day), and nothing in between: the system shows each entry until
// the next one. Pure logic, checked by Widgets/Checks.

/// One kind of change a widget shows.
enum WidgetChange: Hashable, Sendable {
    /// The 256-state phase pair of a level (two 2-stroke glyphs, SPEC §15.3): the level's 2-digit odometer.
    case pair(level: Int)
    /// The 52-state 3-stroke glyph of a level (a major period's phase on the journal face).
    case glyph3(level: Int)
    /// A new cycle of a level, so a new count ("29ι" → "30ι").
    case cycle(level: Int)
    /// A new quarter of a level (Peak, Node, Valley, End).
    case quarter(level: Int)
    /// The solar odometer: three 2-stroke glyphs of the sync phase (SPEC §7.3), one state every ~84 s.
    case solarDigits
    /// Midnight in an Earth zone (IANA id; nil is the device's): "today" turns into a weekday.
    case midnight(zone: String?)
    /// A countdown to `end` shown in whole `step`s ("3 d 04 h" for an hour): it changes each time a whole step is
    /// used up.
    case countdown(to: Double, step: Double)

    /// Readings are taken this long after a change, so a boundary computed a hair early (the engine rounds instants
    /// to whole milliseconds) still reads the new state.
    static let settle = 0.002

    /// The first instant after `t` at which this changes; nil when it never does again inside the catalogue.
    func next(after t: Double, clock: FractonicaClock = .shared) -> Double? {
        let at = t + Self.settle
        let next: Double?
        switch self {
        case .pair(let level):
            next = clock.odometer(at: at, level)?.nextTime
        case .glyph3(let level):
            next = clock.odometer(at: at, level, strokes: 3, digits: 1)?.nextTime
        case .cycle(let level):
            next = clock.level(at: at, level).flatMap { $0.clipped ? nil : $0.end }
        case .quarter(let level):
            next = clock.level(at: at, level)?.next.time
        case .solarDigits:
            next = clock.solar(at: at).map { s in
                let step = (s.digits3[0] * 16 + s.digits3[1]) * 16 + s.digits3[2]
                return s.start + Double(step + 1) / 4096 * (s.end - s.start)
            }
        case .midnight(let zone):
            let earth = EarthFormatter(zone: zone)
            let p = earth.parts(at)
            next = earth.toUnix(EarthTime.CivilTime(year: p.year, month: p.month, day: p.day + 1))
        case .countdown(let end, let step):
            // the count shown is floor((end − t) / step); it drops when end − t reaches the next whole step
            let left = end - at
            let whole = (left / step).rounded(.down)
            next = left > 0 && step > 0 ? end - whole * step : nil
        }
        guard let next, next > t, next <= clock.tMax else { return nil }
        return next
    }
}

/// The instants of a widget's timeline.
enum EntrySchedule {
    /// The most entries one timeline holds; the widget reloads after the last.
    static let maxEntries = 150

    /// The entry times from `start`: `start` itself, then every instant one of `changes` happens, earliest first, for
    /// at most `horizon` seconds and `maxEntries` entries. A change closer than `minimumGap` to the previous one moves
    /// that entry to the later instant (both show from there on, at most `minimumGap` late). Empty outside the
    /// catalogue.
    static func times(from start: Double, changes: Set<WidgetChange>, horizon: Double = 86_400,
                      maxEntries: Int = maxEntries, minimumGap: Double = 1,
                      clock: FractonicaClock = .shared) -> [Double] {
        times(from: start, horizon: horizon, maxEntries: maxEntries, minimumGap: minimumGap, clock: clock) { _ in changes }
    }

    /// The same, for a picture whose changes depend on what it shows (`changes(at: t)`: the changes to follow from
    /// the entry at t on, such as countdowns to the events that entry lists).
    static func times(from start: Double, horizon: Double = 86_400, maxEntries: Int = maxEntries,
                      minimumGap: Double = 1, clock: FractonicaClock = .shared,
                      changes: (Double) -> Set<WidgetChange>) -> [Double] {
        guard clock.inRange(start), maxEntries > 0 else { return [] }
        let end = start + horizon
        var times = [start]
        var t = start
        while let next = changes(t).compactMap({ $0.next(after: t, clock: clock) }).min(), next <= end {
            if times.count > 1 && next - times[times.count - 1] < minimumGap {
                // too close to the previous change: show both from the later instant
                times[times.count - 1] = next
            } else if times.count < maxEntries {
                times.append(next)
            } else {
                break
            }
            t = next
        }
        return times
    }
}
