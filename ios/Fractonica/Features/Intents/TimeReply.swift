import FractonicaKit
import Foundation

/// What "What's the Fractonica time?" answers at an instant: the words Siri speaks, the minor clock, the short date and
/// the stamp shown in the snippet, and the Earth moment unless pure mode is on. Pure logic (checked by
/// Features/Intents/Checks).
struct FractonicaTimeReply: Hashable, Sendable {
    /// "It's Helion 34, Preon 29, Flavon 21 of the 5th Nuclide of Delta Trifracton, in its End quarter."
    let spoken: String
    /// "34η 29ι 21λ" as (level, number, letter) parts, for colouring.
    let clock: [Part]
    /// "Delta Trifracton End · ε#5".
    let date: String
    /// The full letter address down to the Flavon: "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ". The intent's value.
    let stamp: String
    /// The Helion's phase pair (two 2-stroke glyphs).
    let helionPair: [Int]
    /// "Thu 8 Oct 2026, 12:00:00 · UTC"; nil in pure mode.
    let earth: String?

    struct Part: Hashable, Sendable {
        let level: Int
        let number: Int
        let letter: String
    }

    var clockText: String { clock.map { "\($0.number)\($0.letter)" }.joined(separator: " ") }

    /// The reply at t; nil outside the catalogue.
    init?(at t: Double, pure: Bool, zone: TimeZone, notation: Notation = Notation()) {
        guard let c = notation.clock(at: t), let d = notation.date(at: t),
              let pair = notation.model.odometer(at: t, 6)?.digits else { return nil }
        let delta = Notation.periodName(level: 3, ordinal: d.delta)
        clock = [Part(level: 6, number: c.eta, letter: "η"), Part(level: 8, number: c.iota, letter: "ι"),
                 Part(level: 10, number: c.lambda, letter: "λ")]
        date = "\(delta) \(d.quarter.delta) · ε#\(d.epsilon)"
        stamp = notation.stamp(at: t, upTo: "lambda")
        helionPair = pair
        spoken = "It's Helion \(c.eta), Preon \(c.iota), Flavon \(c.lambda) of the \(Journal.ordinal(d.epsilon)) Nuclide of "
            + "\(delta), in its \(d.quarter.delta) quarter."
        if pure {
            earth = nil
        } else {
            let earth = EarthFormatter(timeZone: zone)
            self.earth = "\(earth.long(t)) · \(earth.tag(t))"
        }
    }
}
