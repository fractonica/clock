import FractonicaKit
import Foundation

// What the pendulum face reads at an instant: each level's place in its running cycle, the Pentad dial's state, when
// to redraw, and what VoiceOver says. No SwiftUI here: checked by Checks/PendulumChecks.swift.

/// One pendulum's swing at an instant.
struct SwingState: Equatable, Sendable {
    let level: Int
    /// 0 ..< 1 through the running cycle, linear in time (0 at its start).
    let phase: Double
    /// The running cycle's length, seconds.
    let duration: Double

    func angle(amplitude: Double) -> Double { Swing.angle(phase: phase, amplitude: amplitude) }
}

enum PendulumReading {
    /// The swings of `levels` at t, in the same order; nil outside the catalogue.
    static func swings(at t: Double, levels: [Int], clock: FractonicaClock = .shared) -> [SwingState]? {
        var out: [SwingState] = []
        out.reserveCapacity(levels.count)
        for level in levels {
            guard let r = clock.level(at: t, level), r.duration > 0 else { return nil }
            out.append(SwingState(level: level, phase: min(max((t - r.start) / r.duration, 0), 1), duration: r.duration))
        }
        return out
    }

    /// Displayed seconds between two redraws of the slower pendulums and the dial: ι, the quickest of them, moves its
    /// bob about a tenth of a point in a quarter of a second.
    static let slowStep = 0.25
    /// With Reduce Motion everything redraws once a displayed second.
    static let calmStep = 1.0
}

/// The Pentad dial at an instant.
struct PentadDialState: Equatable, Sendable {
    let sync: Int
    /// 0 … 3; 3 the Hypopentad.
    let index: Int
    /// The Helion's place in its Pentad, 1 … 5 (1 … 4 in the Hypopentad), and the Pentad's Helions.
    let helion: Int
    let helions: Int
    /// How far the running Helion has run, 0 … 1 (the Helion pendulum's phase).
    let progress: Double

    /// The running Helion of the sync, 0 … 18.
    var within: Int { 5 * index + helion - 1 }
    /// Helions into the sync, continuous.
    var position: Double { Double(within) + progress }
    var isHypopentad: Bool { index == 3 }

    static func make(at t: Double, clock: FractonicaClock = .shared) -> PentadDialState? {
        guard let p = Pentads.at(t, clock: clock), let eta = clock.level(at: t, PendulumSpace.helionLevel),
              eta.duration > 0 else { return nil }
        return PentadDialState(sync: p.sync, index: p.index, helion: p.helion, helions: p.helions,
                               progress: min(max((t - eta.start) / eta.duration, 0), 1))
    }
}

/// What VoiceOver hears: the minor reading led by its Pentad, then how the everyday units swing.
enum PendulumWords {
    /// "swinging right to its peak" … by the quarter the swing is in.
    static func swing(phase: Double) -> String {
        switch Swing.quarter(phase: phase) {
        case 0: "swinging right to its peak"
        case 1: "swinging back to its node"
        case 2: "swinging left to its valley"
        default: "swinging back to its end"
        }
    }

    /// "Pendulums. Pentad II, 2nd Helion of 5 · ε#5 34η 29ι 21λ"; outside the catalogue the out-of-range words.
    static func label(at t: Double, notation: Notation, outOfRange: [String]) -> String {
        guard let p = Pentads.at(t), let minor = notation.clock(at: t) else {
            return "Pendulums: " + outOfRange.joined(separator: " ")
        }
        let reading = "ε#\(minor.epsilon) " + notation.clockText(at: t, upTo: "lambda")
        return "Pendulums. " + PentadWords.full(p) + PentadWords.separator + reading
    }

    /// The units' swings, longest first: "Nuclide swinging left to its valley; Helion …; Preon …; Flavon …".
    static func value(_ swings: [SwingState]) -> String {
        [4, 6, 8, 10].compactMap { level in
            swings.first { $0.level == level }.map { "\(Notation.unitName(level: level)) \(swing(phase: $0.phase))" }
        }.joined(separator: "; ")
    }
}
