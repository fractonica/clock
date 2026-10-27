import Foundation

/// The words of the Pentad explainer (SPEC §7.5) in both modes; pure mode says it with Helions and solar days only (no
/// hours, no seconds). No SwiftUI here: checked by Checks/FaceChecks.swift.
enum PentadExplainerText {
    /// The opening: the Helion is the link to the Sun.
    static func lead(pure: Bool) -> String {
        pure ? "The Helion is the clock's link to the Sun: 4¾η is a solar day."
            : "The Helion is the clock's link to the Sun: a solar day is 4¾ Helions (4.75 × 5.052 h ≈ 23.997 h)."
    }

    /// The relation seen from the Sun.
    static func fromSun(pure: Bool) -> String {
        pure ? "When the Sun is back at the same place in the sky a day later, the Helions have moved ¼η back. The Helion's quarters fall at the same time of day every day, and after four days (19η, one solar sync) the whole grid repeats, a little over a Flavon earlier."
            : "When the Sun is back at the same place in the sky a day later, the Helions have moved a quarter Helion back. The Helion's quarters fall at the same time of day every day, and after four days (19 Helions, one solar sync) the whole grid repeats, about 10 seconds earlier."
    }

    /// The relation seen from the Helion.
    static func fromHelion(pure: Bool) -> String {
        pure ? "After 5η the Sun is ¼η later in its day. Three such runs drift ¾η; the fourth is one Helion short, which brings the Sun back — a leap year run backwards: a period taken out instead of one added."
            : "After 5 Helions the Sun is a quarter Helion (≈ 1.26 h) later in its day. Three such runs drift ¾ Helion; the fourth is one Helion short, which brings the Sun back — a leap year run backwards: a period taken out instead of one added."
    }

    /// Why a date leads with its Pentad.
    static func weekday(pure: Bool) -> String {
        "Each of these runs is a Pentad, about a day long, and a date leads with it the way a civil date leads with its weekday."
    }

    /// The diagram's caption for each step of its animation (0 … 3 the Pentads, 4 the next sync's Pentad I).
    static func step(_ step: Int, pure: Bool) -> String {
        switch step {
        case 0: "Pentad I starts as the sync's solar day does."
        case 1: pure ? "Five Helions are a day and ¼η: Pentad II starts ¼η later in the day."
            : "Five Helions are a day and ¼ Helion (≈ 1.26 h): Pentad II starts that much later in the day."
        case 2: pure ? "Pentad III starts ½η later in the day." : "Pentad III starts ½ Helion (≈ 2.5 h) later in the day."
        case 3: pure ? "The Hypopentad starts ¾η later, and has only four Helions…"
            : "The Hypopentad starts ¾ Helion (≈ 3.8 h) later, and has only four Helions…"
        default: "…so it ends just as the fourth day turns: the next Pentad I is back in step with the Sun."
        }
    }

    /// One Pentad for the table: its Helions in the sync, its length and where it starts in the day.
    struct Row: Equatable, Sendable {
        let index: Int
        let helions: String
        let length: String
        let start: String
    }

    static func rows(pure: Bool) -> [Row] {
        let offsets = ["+0", "+¼η", "+½η", "+¾η"]
        let places = ["Helions 1–5", "Helions 6–10", "Helions 11–15", "Helions 16–19"]
        return (0..<4).map { i in
            let n = i == 3 ? 4 : 5
            return Row(index: i, helions: places[i],
                       length: pure ? "\(n)η" : "\(n)η ≈ \(i == 3 ? "20.2" : "25.3") h",
                       start: offsets[i])
        }
    }
}
