import FractonicaKit
import Foundation

// What a row of the watch face says about itself when it is pressed and held (or right-clicked on a Mac): the web
// face's row tooltips (src/ui/face/helpers.js `periodTooltip`, `solarTooltip`; pure.js `purePeriodTooltip`,
// `pureSolarTooltip`), without the click hints (the menu under the card is the native way to act). Pure mode says it
// in Fractonica terms only: places, counts and spans on the ladder. No SwiftUI here: checked by Checks/FaceChecks.swift.

/// A row's explanation: a title, what one cycle is, and a few lines.
struct RowTip: Equatable, Sendable {
    /// "η · depth 7", "Solar sync #4820".
    var title: String
    /// "≈ 5 h 3 min per cycle" · pure "one Helion = 36ι".
    var aside: String
    var lines: [String]
    /// The row's level (nil for the solar sync): the card's accent.
    var level: Int?
    /// Pure solar sync: the phase drawn as a glyph pair beside the first line.
    var pairPhase: Double?
}

enum FaceTips {
    /// Pure mode: which numbers count from 1 and which from 0 (pure.js `FROM_ONE`).
    static let fromOne =
        "Ordinals (fracton names, # numbers) and the Helion (η) count from 1; states and the counts ι λ ν from 0."

    /// The explanation of the period row of `level` at t; nil outside the catalogue.
    static func period(level: Int, at t: Double, words: Wording) -> RowTip? {
        let clock = words.notation.model
        guard let lv = clock.level(at: t, level), let od = clock.odometer(at: t, level) else { return nil }
        let info = clock.levelInfo(level)
        let letter = Fractonica.periodName(level).text
        let coarse = od.digits.first ?? 0
        let fine = od.digits.count > 1 ? od.digits[1] : 0
        let majorNext = clock.odometer(at: t, level, digits: 1)?.nextTime
        let state = "State \(coarse) of 16: \(FaceWords.describe(index: coarse))"
        let title = "\(letter) · depth \(level + 1)"

        if words.pure {
            let n = words.notation
            let span = { (to: Double?) in to.map { "in \(n.between(t, $0))" } ?? FaceWords.dash }
            let major = Notation.isMajor(level)
            let q = min(3, max(0, lv.quarter))
            var lines = [FaceWords.place(level: level, reading: lv, notation: n), state]
            lines.append("Right (fine) glyph: state \(fine) of 16" + (od.nextTime.map { _ in ", changes \(span(od.nextTime))" } ?? ""))
            if let majorNext { lines.append("Next change \(span(majorNext))") }
            // a major period is read by its quarter: when this one ends and which comes next
            if major, q < 3, q + 1 < lv.thresholds.count, let at = lv.thresholds[q + 1].time {
                lines.append("\(Notation.quarterWords[q]) ends \(span(at)) → \(Notation.quarterWords[q + 1])")
            }
            let atEdge = lv.clipped || lv.end >= clock.tMax - 1e-3
            lines.append(atEdge ? "Ends \(span(lv.end)), with the catalogue"
                : "Ends \(span(lv.end)) → \(FaceWords.follower(level: level, cycle: lv.cycle, notation: n)) begins")
            lines.append(fromOne)
            return RowTip(title: title, aside: cycleAside(level: level, notation: n), lines: lines, level: level)
        }

        var lines = [state]
        lines.append("Right (fine) glyph: state \(fine) of 16" + (od.nextTime.map { ", changes at \(words.label($0, relativeTo: t))" } ?? ""))
        if let majorNext {
            lines.append("Next change \(words.label(majorNext, relativeTo: t)) (\(words.countdown(majorNext - t, at: t)))")
        }
        let parent = level > 0 ? " in its \(Fractonica.periodName(level - 1).letter)" : ""
        lines.append("Cycle \(lv.local + 1) of \(lv.siblings)\(parent) · ends \(words.label(lv.end, relativeTo: t))")
        return RowTip(title: title, aside: "≈ \(words.duration(info.meanSeconds, at: t)) per cycle", lines: lines, level: level)
    }

    /// The explanation of the solar odometer at t (also where the sync is not defined); nil outside the catalogue.
    static func solar(at t: Double, words: Wording) -> RowTip? {
        let clock = words.notation.model
        guard clock.inRange(t) else { return nil }
        guard let s = clock.solar(at: t) else {
            let line = words.pure
                ? "The sync around this instant runs past the catalogue, so it is not defined here."
                : "The 4-day sync around this instant runs past the Saros 141 catalogue, so it is not defined here."
            return RowTip(title: "Solar sync", aside: "", lines: [line])
        }
        let title = "Solar sync #\(FaceWords.integer(s.sync))"
        if words.pure {
            let n = words.notation
            let between = { (a: Double, b: Double) in n.between(a, b) }
            return RowTip(
                title: title,
                aside: "one sync = 19η (19 \(Notation.unitName("η", count: 19)))",
                lines: [
                    "Phase \(Notation.pairText(s.phase)) of 256 in this sync",
                    "Drift \(n.driftText(start: s.start, nominalStart: s.nominalStart, drift: s.drift)) against the solar rhythm",
                    "Next \(s.threshold.name) " + (s.threshold.time.map { "in \(between(t, $0))" } ?? FaceWords.dash),
                    "Sync began \(between(s.start, t)) ago",
                ],
                pairPhase: s.phase
            )
        }
        let drift = (s.drift > 0 ? "+" : "") + words.duration(s.drift, at: t)
        return RowTip(
            title: title,
            aside: "19 η cycles ≈ 4 days",
            lines: [
                "Phase \(FaceWords.percent(s.phase)) % of this 4-day sync",
                "Drift against civil days \(drift)",
                "Next \(s.threshold.name) " + (s.threshold.time.map { words.label($0, relativeTo: t) } ?? FaceWords.dash),
                "Sync time \(words.label(s.start, relativeTo: t))",
            ]
        )
    }

    /// What one cycle of a level is, in pure words (pure.js `cycleAside`): "one Delta = 5ε", "one Helion = 36ι",
    /// "one Blink, the finest unit", "one cycle = 4ι".
    static func cycleAside(level: Int, notation n: Notation) -> String {
        let clock = n.model
        if Notation.isMajor(level) {
            let child = clock.levelInfo(level + 1)
            return "one \(Notation.levelNames[level]) = \(child.siblings ?? 0)\(child.letter)"
        }
        let nextUnit: [Int: (Int, String)] = [4: (77, "η"), 6: (36, "ι"), 8: (65, "λ"), 10: (25, "ν")]
        if let (count, symbol) = nextUnit[level] { return "one \(Notation.unitName(level: level)) = \(count)\(symbol)" }
        if level == 12 { return "one \(Notation.unitName(level: 12)), the finest unit" }
        return "one cycle = \(n.cycleLength(level: level))"
    }

    /// The tip as plain lines, for a menu (macOS shows no preview card) and VoiceOver.
    static func plainLines(_ tip: RowTip) -> [String] {
        [tip.aside].filter { !$0.isEmpty } + tip.lines
    }
}
