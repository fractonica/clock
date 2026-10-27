import FractonicaKit
import Foundation
import os

// The Pentads of SPEC §7.5 as the apps and widgets read them: the solar sync's 19 Helions as Pentad I, II, III (five
// Helions each) and the Hypopentad (four). A Pentad is about a solar day and leads a date the way a weekday leads a
// civil one (SPEC §15.3): "Pentad II · δ#3 ε#2 5η 5ι", or with its shape, "⬠II δ#3 ε#2 5η 5ι".
//
//   Pentads.at(t)                       the reading (cached for the running Helion: a ticking readout pays a range check)
//   PentadWords.lead("δ#3 ε#2 5η", index: 1)   "Pentad II · δ#3 ε#2 5η"   (plain text: notifications, copy, menus)
//   PentadMark(index: 1)                the shape and numeral (PentadMark.swift), for anything SwiftUI draws
//
// No SwiftUI here: checked by Fractonica/Core/Checks. Compiled into the apps and the widget extensions.

enum Pentads {
    /// The solar day in Helions (SPEC §7.5: 4.75 × 5.052 h ≈ 23.997 h).
    static let solarDay = 4.75
    /// Helions in each Pentad, by index.
    static let helions = [5, 5, 5, 4]
    /// Where each Pentad starts in the time of day, in Helions after the sync's start time of day: ¼η later each, the
    /// Hypopentad ¾η; the next Pentad I is back at 0.
    static func dayOffset(_ index: Int) -> Double { Double(index) / 4 }

    /// The Pentad running at t; nil outside the catalogue. The last few readings are kept for the Helion they were
    /// read in, so the displayed time asks the engine about once a Helion.
    static func at(_ t: Double, clock: FractonicaClock = .shared) -> PentadReading? {
        guard t.isFinite else { return nil }
        if let hit = cache.withLock({ entries in entries.first { $0.from <= t && t < $0.to } }) { return hit.reading }
        guard let reading = clock.pentad(at: t) else { return nil }
        let helion = clock.level(at: t, 6) // the Helion (η), the sync's level
        let entry = Entry(reading: reading, from: max(helion?.start ?? reading.start, reading.start),
                          to: min(helion?.end ?? reading.end, reading.end))
        cache.withLock { entries in
            entries.insert(entry, at: 0)
            if entries.count > 6 { entries.removeLast() }
        }
        return reading
    }

    /// The index (0 … 3, 3 the Hypopentad) of the Pentad running at t; nil outside the catalogue.
    static func index(at t: Double) -> Int? { at(t)?.index }

    /// The Pentad after the one running at t: its index and start (the running one's end); nil when the catalogue ends
    /// first.
    static func next(after t: Double, clock: FractonicaClock = .shared) -> (index: Int, start: Double)? {
        guard let p = at(t, clock: clock), p.end < clock.tMax else { return nil }
        return ((p.index + 1) % 4, p.end)
    }

    /// The displayed time of the next change of the Pentad at t (its end), for a view that redraws only then.
    static func change(after t: Double) -> Double? {
        guard let p = at(t) else { return nil }
        return p.end
    }

    private struct Entry: Sendable {
        let reading: PentadReading
        let from: Double
        let to: Double
    }

    private static let cache = OSAllocatedUnfairLock<[Entry]>(initialState: [])
}

/// What the Pentads say in plain text (SPEC §7.5): where a view can draw the shape it uses `PentadMark`; text that must
/// stay plain (notifications, Live Activity strings, menus, copy and share) says the name, or the ASCII form where room
/// is short. Never the "⬠" character itself, which only Apple Symbols draws.
enum PentadWords {
    enum Form: Sendable {
        /// "Pentad II", "Hypopentad".
        case full
        /// "P2", "H".
        case ascii
    }

    /// "Pentad II" · ascii "P2"; the Hypopentad "Hypopentad" · "H".
    static func name(_ index: Int, _ form: Form = .full) -> String {
        let i = min(max(index, 0), 3)
        return form == .full ? Notation.pentadNames[i] : Notation.pentadASCII[i]
    }

    /// What VoiceOver says for a Pentad's shape: its name.
    static func spoken(_ index: Int) -> String { name(index) }

    /// The separator between a Pentad and the reading it leads.
    static let separator = " · "

    /// A reading led by its Pentad, as a date by its weekday: "Pentad II · δ#3 ε#2 5η 5ι" (ascii "P2 · δ#3 ε#2 5η 5ι").
    /// Without a Pentad (outside the catalogue) the reading alone; an empty reading the name alone.
    static func lead(_ reading: String, index: Int?, form: Form = .full) -> String {
        guard let index else { return reading }
        return reading.isEmpty ? name(index, form) : name(index, form) + separator + reading
    }

    /// The same for the Pentad running at t.
    static func lead(_ reading: String, at t: Double, form: Form = .full) -> String {
        lead(reading, index: Pentads.index(at: t), form: form)
    }

    /// The Helion's place in its Pentad: "2nd Helion of 5" (the Hypopentad "of 4").
    static func place(_ p: PentadReading) -> String {
        "\(ordinal(p.helion)) Helion of \(p.helions)"
    }

    /// "Pentad II, 2nd Helion of 5".
    static func full(_ p: PentadReading) -> String {
        "\(name(p.index)), \(place(p))"
    }

    /// 1st, 2nd, 3rd, 4th, 5th.
    static func ordinal(_ n: Int) -> String {
        switch n {
        case 1: "1st"
        case 2: "2nd"
        case 3: "3rd"
        default: "\(n)th"
        }
    }
}
