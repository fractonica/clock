import FractonicaKit
import Foundation

/// When what the Now screen shows changes next, in displayed time (SPEC §10: "recompute at the next state change of
/// the finest visible glyph … from nextTime"). Each function returns the first instant strictly after t at which its
/// part of the screen reads differently, or nil when nothing it shows will change again (past the catalogue's end).
/// `FaceTimeline` turns these instants into redraws, so a still reading costs nothing between its changes: the η
/// triplet wakes once per λ (≈ 7.8 s), the ι triplet once per ν (≈ 311 ms), the watch face at its bottom glyph's pace.
enum FaceCadence {
    /// The cycle tick at the bottom of the journal face moves in this many steps per cycle (about a pixel each on the
    /// largest face).
    static let arcSteps = 1024.0
    /// The solar odometer: three 16-state glyphs, 4096 steps per sync (SPEC §7.3).
    static let solarSteps = 4096.0

    /// The journal face showing unit `unit` (`Journal.units`): its finest count, the lead unit's phase pair (or a
    /// major period's 3-stroke glyph, child ordinal and quarter word) and the cycle tick.
    static func journal(after t: Double, unit: Int, clock: FractonicaClock = .shared) -> Double? {
        let u = FaceStepper.clampUnit(unit)
        let first = Journal.units[u].level
        guard let lead = clock.level(at: t, first) else { return nil }
        var candidates: [Double?] = [arcStep(after: t, lead)]
        if first <= 3 {
            candidates.append(clock.level(at: t, first + 1)?.end)
            candidates.append(lead.next.time)
            candidates.append(clock.odometer(at: t, first, strokes: 3, digits: 1)?.nextTime)
        } else {
            candidates.append(clock.level(at: t, Journal.units[u + 2].level)?.end)
            candidates.append(clock.odometer(at: t, first, strokes: 2, digits: 2)?.nextTime)
        }
        return earliest(after: t, candidates)
    }

    /// The watch face at `topDepth`: both period odometers (their counters turn with them) and the solar odometer;
    /// with `countdowns` (pure info labels, "in 6ι 43λ") every Flavon as well.
    static func watch(after t: Double, topDepth: Int, countdowns: Bool = false, clock: FractonicaClock = .shared) -> Double? {
        let levels = WatchGeometry.levels(topDepth: topDepth)
        var candidates: [Double?] = [
            clock.odometer(at: t, levels.top)?.nextTime,
            clock.odometer(at: t, levels.bottom)?.nextTime,
        ]
        if let solar = clock.solar(at: t) { candidates.append(solarStep(after: t, solar)) }
        if countdowns { candidates.append(clock.level(at: t, 10)?.end) }
        return earliest(after: t, candidates)
    }

    /// A line of readings down to the Flavon (the stamp, "ε#5 34η 29ι 21λ") and, in Earth mode, a clock with seconds.
    static func readings(after t: Double, pure: Bool, clock: FractonicaClock = .shared) -> Double? {
        let lambda = clock.level(at: t, 10)?.end
        return earliest(after: t, pure ? [lambda] : [lambda, nextSecond(after: t)])
    }

    /// The date line above the face: Earth date and time with seconds and the short pure date (down to ι); in pure
    /// mode the short date and the stamp (down to λ).
    static func dateLine(after t: Double, pure: Bool, clock: FractonicaClock = .shared) -> Double? {
        if pure { return earliest(after: t, [clock.level(at: t, 10)?.end]) }
        return earliest(after: t, [nextSecond(after: t), clock.level(at: t, 8)?.end])
    }

    /// A countdown to the end of the running cycle of `level` and the name of what begins then. Earth countdowns
    /// ("in 12 min 04 s", `EarthTime.countdown`) change every tenth of a second in their last ten seconds, then every
    /// second, minute or hour; pure ones ("in 6ι 43λ") with their finest part ("in 6ι 24ν" while no Flavon is left
    /// over).
    static func countdown(after t: Double, level: Int, pure: Bool, clock: FractonicaClock = .shared) -> Double? {
        guard let reading = clock.level(at: t, level) else { return nil }
        let end = reading.end
        guard end > t else { return nil }
        if pure { return earliest(after: t, [pureSpanStep(after: t, end: end, clock: clock), end]) }
        return earliest(after: t, [earthCountdownStep(after: t, end: end), end])
    }

    /// The next instant at which a pure countdown to `end` (a cycle end, so a boundary of every finer unit) reads
    /// differently: the end of the running cycle of its finest part; a tenth of a Blink in its last ten Blinks, which
    /// keep a decimal.
    static func pureSpanStep(after t: Double, end: Double, clock: FractonicaClock = .shared) -> Double? {
        let notation = Notation(clock: clock)
        let parts = notation.decompose((end - t) / notation.secondsPerPosition(at: t))
        guard let finest = parts.last?.unit else { return nil }
        if finest.id == "nu", (end - t) < 10 * notation.blinkSeconds { return t + notation.blinkSeconds / 10 }
        return clock.level(at: t, finest.level)?.end
    }

    // MARK: Parts

    /// The next instant at which an `EarthTime.countdown` to `end` reads differently.
    static func earthCountdownStep(after t: Double, end: Double) -> Double? {
        let r = end - t
        guard r > 0 else { return nil }
        let step: Double = r < 10 ? 0.1 : r < 3_600 ? 1 : r < 86_400 ? 60 : 3_600
        var k = (r / step).rounded(.down)
        if k * step >= r { k -= 1 }
        return end - k * step
    }

    /// The next second of an Earth clock. Its formatter rounds t to the millisecond first, so a second begins half a
    /// millisecond early.
    static func nextSecond(after t: Double) -> Double {
        (t + 0.000_5).rounded(.down) + 1 - 0.000_5
    }

    /// The next step of the cycle tick: `arcSteps` steps per cycle, linear in time.
    static func arcStep(after t: Double, _ lead: LevelReading) -> Double? {
        guard lead.duration > 0 else { return nil }
        let k = (lead.progress * arcSteps).rounded(.down) + 1
        return lead.start + k / arcSteps * lead.duration
    }

    /// The next change of the solar odometer: its phase is linear in time.
    static func solarStep(after t: Double, _ solar: SolarReading) -> Double? {
        let length = solar.end - solar.start
        guard length > 0 else { return nil }
        let k = (solar.phase * solarSteps).rounded(.down) + 1
        return solar.start + k / solarSteps * length
    }

    /// The earliest candidate strictly after t.
    static func earliest(after t: Double, _ candidates: [Double?]) -> Double? {
        candidates.compactMap { $0 }.filter { $0.isFinite && $0 > t }.min()
    }
}
