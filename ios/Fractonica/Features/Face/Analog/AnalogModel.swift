import FractonicaKit
import Foundation

// What the analog dial reads (Features/Face/Analog), with no SwiftUI: checked by Analog/Checks.
//
// Each hand turns once while the one before it moves a tick, as on a watch:
//   Nuclide rider    on the bezel, once round the chapter ring per Nuclide: 77 Helions (7 ζ of 11η), its Pentads
//                    marked where they start
//   Helion hand      the dauphine, once per Helion, over 36 Preons (9 θ indices of 4ι, the Preons between as dots)
//   Preon hand       long and thin, once per Preon over the railway's 65 Flavons (5 κ of 13λ)
//   Flavon register  (6 o'clock) once per Flavon over 25 Blinks (5 μ of 5ν), stepping once a Blink
//   Pentad register  (12 o'clock) one turn per solar sync: 19 Helions as Pentad I, II, III and the Hypopentad
//   Helion window    (3 o'clock) the Helion's number in its Nuclide, 1 … 77
//   balance          (9 o'clock) swings with the μ cycle (depth 12): twice a period, right at the peak, left at the valley
//
// Angles are fractions of a turn, 0 at the top, clockwise.

/// One reading of the dial at an instant.
struct AnalogReading: Equatable, Sendable {
    /// The Nuclide in its Delta (1 … 5), the Helion's number in the Nuclide (1 … 77), the Preons completed in the
    /// Helion (0 … 35), Flavons in the Preon (0 … 64), Blinks in the Flavon (0 … 24) (SPEC §15.3).
    let epsilon: Int
    let eta: Int
    let iota: Int
    let lambda: Int
    let nu: Int
    /// The Helion's phase, 0 ..< 1: the main hand.
    let helion: Double
    /// The running Pentad (0 … 3, 3 the Hypopentad), the Helion's place in it (1 … 5) and its Helions (5 or 4).
    let pentad: Int
    let pentadHelion: Int
    let pentadHelions: Int
    let sync: Int

    /// The running Helion's place in its sync, 0 … 18.
    var syncHelion: Int { 5 * pentad + pentadHelion - 1 }
    /// Blinks completed in the Preon, 0 … 1624: where the Preon hand stands.
    var blinks: Int { lambda * 25 + nu }

    /// The main hand: the Helion's phase.
    var helionAngle: Double { min(max(helion, 0), 1) }
    /// The Preon hand, a step a Blink: 1625 steps a turn.
    var preonAngle: Double { Double(blinks) / Double(AnalogDial.blinksPerPreon) }
    /// The Flavon register's hand, a step a Blink: 25 steps a turn.
    var flavonAngle: Double { Double(nu) / Double(AnalogDial.blinksPerFlavon) }
    /// The Nuclide's rider: the Helion's place on the 77-Helion ring, gliding through its slot with the Helion.
    var nuclideAngle: Double { (Double(eta - 1) + helionAngle) / Double(AnalogDial.helionsPerNuclide) }
    /// The Pentad register's hand: the Helion's place in its sync, gliding through its pip with the Helion.
    var syncAngle: Double { (Double(syncHelion) + helionAngle) / Double(AnalogDial.helionsPerSync) }

    /// The place in the sync (0 … 18) of the Nuclide's first Helion, from which every Pentad on the ring follows.
    var nuclideFirstInSync: Int {
        let n = AnalogDial.helionsPerSync
        return ((syncHelion - (eta - 1)) % n + n) % n
    }

    /// The reading at t; nil outside the catalogue.
    static func make(at t: Double, clock: FractonicaClock = .shared, notation: Notation = .standard) -> AnalogReading? {
        guard let minor = notation.clock(at: t), let helion = clock.level(at: t, 6),
              let pentad = Pentads.at(t, clock: clock) else { return nil }
        return AnalogReading(epsilon: minor.epsilon, eta: minor.eta, iota: minor.iota, lambda: minor.lambda, nu: minor.nu,
                             helion: helion.phase, pentad: pentad.index, pentadHelion: pentad.helion,
                             pentadHelions: pentad.helions, sync: pentad.sync)
    }

    /// What VoiceOver reads: the minor reading led by its Pentad, "Pentad II · ε#5 34η 29ι 21λ".
    var spoken: String {
        PentadWords.lead("ε#\(epsilon) \(eta)η \(iota)ι \(lambda)λ", index: pentad)
    }

    /// The same with the Pentad's place: "Pentad II, 2nd Helion of 5".
    var spokenPentad: String {
        "\(PentadWords.name(pentad)), \(PentadWords.ordinal(pentadHelion)) Helion of \(pentadHelions)"
    }
}

/// The dial's fixed counts and layouts.
enum AnalogDial {
    static let preonsPerHelion = 36
    /// θ: an index every 4 Preons, 9 a Helion.
    static let preonsPerTheta = 4
    static let flavonsPerPreon = 65
    /// κ: a major tick every 13 Flavons, 5 a Preon.
    static let flavonsPerKappa = 13
    static let blinksPerFlavon = 25
    /// μ: a major tick every 5 Blinks, 5 a Flavon.
    static let blinksPerMu = 5
    static let blinksPerPreon = 1625
    static let helionsPerNuclide = 77
    /// ζ: a major mark every 11 Helions, 7 a Nuclide.
    static let helionsPerZeta = 11
    static let helionsPerSync = 19

    /// The Helion numbers printed on the chapter ring: the first of each ζ (1, 12, 23 … 67).
    static let zetaNumbers = (0..<7).map { $0 * helionsPerZeta + 1 }

    /// The Preon counts printed on the main track at the θ indices (4, 8 … 32; the top has the double index).
    static let thetaNumbers = (1..<9).map { $0 * preonsPerTheta }

    /// The Blink counts printed in the Flavon register at the μ ticks (0, 5 … 20).
    static let muNumbers = (0..<5).map { $0 * blinksPerMu }

    /// The Helion's quarters on the main dial (peak ¼, node ½, valley ¾), as fractions of a turn.
    static let quarters = [0.25, 0.5, 0.75]

    /// Where each Pentad's first Helion sits in the sync (0, 5, 10, 15), and its Helions.
    static let pentadFirst = [0, 5, 10, 15]
    static let pentadHelions = Pentads.helions

    /// The Pentad (0 … 3) of a place in the sync (0 … 18).
    static func pentad(ofSyncHelion k: Int) -> Int { min(3, k / 5) }

    /// One Pentad's stretch of the 77-Helion ring: Helion slots `from ..< to` of the Nuclide (slot 0 is 1η), and
    /// whether it begins inside this Nuclide (else it carries over from the one before).
    struct RingArc: Equatable, Sendable {
        let pentad: Int
        let from: Int
        let to: Int
        let begins: Bool

        var helions: Int { to - from }
    }

    /// The Pentads across a Nuclide whose first Helion is at place `first` (0 … 18) of its sync: 77 is 4 syncs and a
    /// Helion, so the Pentads start one Helion earlier on the ring with every Nuclide. Arcs are contiguous and cover
    /// the 77 slots; the first carries over unless the Nuclide happens to begin a Pentad.
    static func ringArcs(first: Int) -> [RingArc] {
        let n = helionsPerSync
        var arcs: [RingArc] = []
        var from = 0
        var pentad = Self.pentad(ofSyncHelion: ((first % n) + n) % n)
        for slot in 1...helionsPerNuclide {
            let place = (first + slot) % n
            guard slot == helionsPerNuclide || pentadFirst.contains(place) else { continue }
            arcs.append(RingArc(pentad: pentad, from: from, to: slot, begins: from > 0 || pentadFirst.contains(((first % n) + n) % n)))
            from = slot
            pentad = Self.pentad(ofSyncHelion: place)
        }
        return arcs
    }

    /// The balance's angle, in degrees clockwise, at phase `phase` of the μ cycle: two swings a period (`Swing`) — the
    /// right extreme at the peak (¼), back through the centre at the node (½), the left extreme at the valley (¾).
    static func balanceAngle(phase: Double, amplitude: Double = 210) -> Double {
        Swing.angle(phase: phase, amplitude: amplitude)
    }

    /// A part that turns once every `period` displayed seconds is drawn as a blur rather than a hand when the clock
    /// runs it round faster than once every `shortest` real seconds (a time-lapse): drawn at 30–60 Hz it would only
    /// alias.
    static func blurred(period: Double, rate: Double, shortest: Double) -> Bool {
        guard rate != 0, rate.isFinite, period > 0 else { return false }
        return period / abs(rate) < shortest
    }

    // MARK: Cadences (displayed time of the next change, for `NowTimeline`)

    /// The hands: the Preon hand and the Flavon register step once a Blink, and the other hands glide with them.
    static func handsChange(after t: Double, clock: FractonicaClock = .shared) -> Double? {
        clock.level(at: t, 12)?.end
    }

    /// The Pentads on the ring and in the register, the Helion window: they change with the Helion.
    static func calendarChange(after t: Double, clock: FractonicaClock = .shared) -> Double? {
        clock.level(at: t, 6)?.end
    }

    /// What VoiceOver reads changes once a Flavon.
    static func labelChange(after t: Double, clock: FractonicaClock = .shared) -> Double? {
        clock.level(at: t, 10)?.end
    }
}
