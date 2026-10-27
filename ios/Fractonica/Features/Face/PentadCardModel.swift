import FractonicaKit
import Foundation

/// What the Pentad card shows (SPEC §7.5): the running sync's 19 Helions as four rows — Pentad I, II, III (five
/// Helions) and the Hypopentad (four) — laid out in the time of day, so each row starts ¼η later than the one above and
/// the Hypopentad, one Helion short, ends where the fourth solar day does; the running Helion lit with the Preons it
/// has completed, and when the next Pentad begins. No SwiftUI here: checked by Checks/FaceChecks.swift.
struct PentadCardModel: Equatable, Sendable {
    let sync: Int
    /// The running Pentad (0 … 3) and the Helion's place in it (1 … 5).
    let index: Int
    let helion: Int
    let helions: Int
    /// The running Helion's completed Preons (0 … 35): its progress in 36 steps, so the card changes once a Preon.
    let preons: Int
    let start: Double
    let end: Double
    /// The Pentad after it (nil when the catalogue ends first).
    let nextIndex: Int?

    /// The running Helion's place in the sync, 0 … 18.
    var cell: Int { 5 * index + helion - 1 }

    /// How far the running Helion has gone, in 36 steps.
    var progress: Double { Double(preons) / 36 }

    static func make(at t: Double, clock: FractonicaClock = .shared, notation: Notation = .standard) -> PentadCardModel? {
        guard let p = Pentads.at(t, clock: clock), let minor = notation.clock(at: t) else { return nil }
        return PentadCardModel(sync: p.sync, index: p.index, helion: p.helion, helions: p.helions, preons: minor.iota,
                               start: p.start, end: p.end, nextIndex: p.end < clock.tMax ? (p.index + 1) % 4 : nil)
    }

    // MARK: Layout in the time of day

    /// One row of the card: a Pentad's Helions placed in the time of day, in Helions after the time of day the sync
    /// began at (one solar day is 4¾η).
    struct Row: Equatable, Sendable {
        let index: Int
        /// Its Helions: 5, the Hypopentad 4.
        let cells: Int
        /// Where it starts in the day: 0, ¼, ½, ¾ Helion.
        let offset: Double
        /// The first Helion's place in the sync (0, 5, 10, 15).
        let first: Int

        var end: Double { offset + Double(cells) }
    }

    static let rows: [Row] = (0..<4).map {
        Row(index: $0, cells: Pentads.helions[$0], offset: Pentads.dayOffset($0), first: 5 * $0)
    }

    /// The width the rows need, in Helions of the day: the latest row end (Pentad III, ½ + 5).
    static let span = rows.map(\.end).max() ?? 5.5

    /// Where the solar days turn, in Helions of the day: the sync's start time of day and a day later.
    static let dayLines = [0, Pentads.solarDay]

    // MARK: Words

    /// When the next Pentad begins, as a countdown that changes at most once a minute (Earth, "in 3 h 12 min", whole
    /// minutes rounded up) or once a Preon (pure, "in 3η 12ι": the Preons still to start, counted from the running one's
    /// start). Nil when no Pentad follows.
    static func countdown(at t: Double, to start: Double, pure: Bool, notation: Notation = .standard) -> String? {
        guard start > t else { return nil }
        if pure {
            let from = notation.model.level(at: t, 8)?.start ?? t
            return "in " + notation.between(from, start, parts: 2)
        }
        let minutes = Int(((start - t) / 60).rounded(.up))
        if minutes < 60 { return "in \(minutes) min" }
        let h = minutes / 60, m = minutes % 60
        return m == 0 ? "in \(h) h" : "in \(h) h \(m < 10 ? "0" : "")\(m) min"
    }

    /// The next instant after t at which the card reads differently: the next Preon (its lit cell, the pure
    /// countdown) and, in Earth mode, the next whole minute of the countdown.
    static func change(after t: Double, pure: Bool, clock: FractonicaClock = .shared) -> Double? {
        guard let p = Pentads.at(t, clock: clock) else { return nil }
        var next = clock.level(at: t, 8)?.end ?? p.end
        if !pure {
            let left = p.end - t
            let past = left.truncatingRemainder(dividingBy: 60)
            next = min(next, t + (past > 0 ? past : 60))
        }
        return min(next, p.end)
    }

    /// The card for VoiceOver: "Pentad II, 2nd Helion of 5, 12 of 36 Preons. Pentad III in 3 h 12 min."
    func spoken(at t: Double, pure: Bool, notation: Notation = .standard) -> String {
        let reading = Pentads.at(t).map(PentadWords.full) ?? PentadWords.name(index)
        var text = "\(reading), \(preons) of 36 Preons."
        if let nextIndex, let countdown = Self.countdown(at: t, to: end, pure: pure, notation: notation) {
            text += " \(PentadWords.name(nextIndex)) \(countdown)."
        }
        return text
    }
}
