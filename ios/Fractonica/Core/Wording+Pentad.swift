import FractonicaKit
import SwiftUI

// A date leads with its Pentad, as a civil date leads with its weekday (SPEC §7.5, §15.3). Screens draw the Pentad's
// shape (`Text.ledByPentad`, `PentadMark`); plain text (notifications, menus, copy, share) says its name:
//
//     Text.ledByPentad(at: t, words.notation.clockText(at: t))          "⬠II 34η 29ι 21λ"
//     words.led(words.notation.dateText(at: t), at: t)                   "Pentad II · Delta Trifracton End ε#5 34η 29ι"
//
// The Pentad changes once a Helion: `Pentads.at` keeps its reading for the running Helion, so a line that ticks pays a
// range check for it, nothing more.
extension Wording {
    /// The Pentad running at t; nil outside the catalogue.
    func pentad(_ t: Double) -> PentadReading? { Pentads.at(t) }

    /// Plain text led by the Pentad at t: "Pentad II · Delta Trifracton End ε#5" (ascii "P2 · …").
    func led(_ reading: String, at t: Double, form: PentadWords.Form = .full) -> String {
        PentadWords.lead(reading, at: t, form: form)
    }

    /// The Pentad's name at t, "Pentad II" ("" outside the catalogue).
    func pentadName(_ t: Double, form: PentadWords.Form = .full) -> String {
        Pentads.index(at: t).map { PentadWords.name($0, form) } ?? ""
    }

    /// The short pure date of t led by its Pentad, for the lines under a moment: "⬠II δ#3 ε#2 5η 5ι".
    func ledLetters(_ t: Double, upTo: String = "iota") -> Text {
        guard notation.model.inRange(t) else { return Text(verbatim: "—") }
        return Text.ledByPentad(at: t, notation.dateText(at: t, letters: true, upTo: upTo))
    }
}
