import FractonicaKit
import Foundation

/// What the star face shows at an instant (SPEC §7.5): the running sync's Helion as a chord of {19/4}, its Pentad, the
/// Sun's place in the day and the phases the rose's arms turn with. No SwiftUI here: checked by Checks/StarChecks.swift.
struct StarReading: Equatable, Sendable {
    let sync: Int
    /// The running Pentad (0 … 3, 3 the Hypopentad), the Helion's place in it (1 … 5) and its Helions (5 or 4).
    let pentad: Int
    let place: Int
    let helions: Int
    /// The running Helion in the sync, 0 … 18: the chord being drawn.
    let helion: Int
    /// How far into the Helion, 0 ..< 1, linear in position like its counts (36 Preons, 2,340 Flavons).
    let phase: Double
    /// The Helion's start and end.
    let start: Double
    let end: Double
    /// The Pentad's end, where the next one begins; the next Pentad, nil when the catalogue ends first.
    let pentadEnd: Double
    let nextPentad: Int?

    static func at(_ t: Double, clock: FractonicaClock = .shared) -> StarReading? {
        guard let p = Pentads.at(t, clock: clock), let h = clock.level(at: t, 6) else { return nil }
        return StarReading(sync: p.sync, pentad: p.index, place: p.helion, helions: p.helions,
                           helion: 5 * p.index + p.helion - 1, phase: min(max(h.phase, 0), 1), start: h.start, end: h.end,
                           pentadEnd: p.end, nextPentad: p.end < clock.tMax ? (p.index + 1) % 4 : nil)
    }

    /// The Sun's place in the day, in turns from the sync's start (the top).
    var sunTurns: Double { StarGeometry.sunTurns(helion: helion, phase: phase) }

    /// The Preons the Helion has completed (0 … 35), the θ it is in (0 … 8) and the Preon's place in it (0 … 3).
    var preon: Int { min(35, Int((phase * 36).rounded(.down))) }
    var theta: Int { preon / 4 }
    var iotaInTheta: Int { preon % 4 }

    /// The running Flavon's phase, 0 ..< 1 (2,340 Flavons a Helion).
    var flavonPhase: Double {
        let x = phase * 2_340
        return x - x.rounded(.down)
    }

    /// The Helion's phase at the start of the moving parts' step it is in (`StarCadence.motionSteps`).
    func steppedPhase(_ steps: Int) -> Double {
        (phase * Double(steps)).rounded(.down) / Double(steps)
    }

    /// The Blinks the running Flavon has completed (0 … 24; 58,500 Blinks a Helion).
    var blink: Int { Int((phase * 58_500).rounded(.down)) % 25 }

    /// What changes once a Helion: the drawn chords, the lit rim points, the hub's Pentad.
    var helionKey: HelionKey { HelionKey(sync: sync, helion: helion, pentad: pentad) }

    struct HelionKey: Equatable, Hashable, Sendable {
        let sync: Int
        let helion: Int
        let pentad: Int
    }
}

/// When the star face's layers change next, in displayed time (for `NowTimeline`).
enum StarCadence {
    /// The chords, rim points and hub: at the end of the running Helion.
    static func helion(after t: Double, clock: FractonicaClock = .shared) -> Double? {
        guard let h = clock.level(at: t, 6), h.end > t else { return nil }
        return h.end
    }

    /// The moving parts (the pen, the Sun, the rose and its arms): `steps` even steps a Helion, counted in its phase
    /// (as the Preon and Blink counts are) and turned into time from t, so a step lands on its count's change.
    static func motion(after t: Double, steps: Int, clock: FractonicaClock = .shared) -> Double? {
        guard let h = clock.level(at: t, 6), h.duration > 0, h.end > t else { return nil }
        let n = Double(max(1, steps))
        let x = h.phase * n
        let next = t + (x.rounded(.down) + 1 - x) / n * h.duration
        return min(max(next, t + 1e-6), h.end)
    }

    /// The steps a Helion for the pen, the Sun and the rose: once a μ (a fifth of a Flavon, about 1.6 s, when the
    /// rose's pen has moved a few tenths of a point), with Reduce Motion once a Flavon.
    static func motionSteps(reduceMotion: Bool) -> Int { reduceMotion ? 2_340 : 2_340 * 5 }

    /// The Flavon's spark steps once a Blink: 58,500 a Helion.
    static let sparkSteps = 2_340 * 25
}

/// The civil hours around the rim (Earth mode): the Sun travels the dial with the time of day, a turn a solar day from
/// the sync's start at the top, so the hours stand where the Sun will be at them.
enum StarHours {
    /// Turns from the top of hour 0 in the zone, for the Sun at `sunTurns` at t.
    static func midnightTurns(at t: Double, sunTurns: Double, earth: EarthFormatter) -> Double {
        let p = earth.parts(t)
        let seconds = Double(p.hour * 3_600 + p.minute * 60 + p.second) + Double(p.ms) / 1_000
        let x = sunTurns - seconds / 86_400
        return x - x.rounded(.down)
    }

    /// The next instant at which the zone's offset changes (daylight saving), when the ring turns by an hour.
    static func transition(after t: Double, earth: EarthFormatter) -> Double? {
        earth.timeZone.nextDaylightSavingTimeTransition(after: Date(timeIntervalSince1970: t))?.timeIntervalSince1970
    }
}

/// What the star face says: its caption and what VoiceOver reads (Pentad first, as a date leads with its weekday).
enum StarWords {
    /// "2nd Helion of 5".
    static func place(_ r: StarReading) -> String {
        "\(PentadWords.ordinal(r.place)) Helion of \(r.helions)"
    }

    /// "Pentad II, 2nd Helion of 5 · 34η 29ι. Pentad III in 13 h 04 min." (pure "… in 2η 30ι."): down to the Preon,
    /// as it is read again once a Preon (and a minute, for an Earth countdown: `PentadCardModel.change`).
    static func spoken(_ r: StarReading, at t: Double, pure: Bool, notation: Notation = .standard) -> String {
        var text = "\(PentadWords.name(r.pentad)), \(place(r))\(PentadWords.separator)\(notation.clockText(at: t, upTo: "iota"))."
        if let next = r.nextPentad, let countdown = PentadCardModel.countdown(at: t, to: r.pentadEnd, pure: pure, notation: notation) {
            text += " \(PentadWords.name(next)) \(countdown)."
        }
        return text
    }
}
