import FractonicaKit
import Foundation

// Earth-mode wording of the Rings screen (src/ui/rings/text.js): labels, "when" strings at a precision that suits the
// length of the cycle they belong to, countdowns. Pure functions of their inputs; checked by Checks/RingsChecks.swift.
// Pure mode never calls these: its words are in RingsPureText.

enum RingsText {
    static let year = 31_557_600.0
    static let minus = "−"

    /// "ε 5": the period letter and the depth.
    static func levelTag(_ level: Int) -> String {
        "\(Fractonica.periodName(level).text) \(level + 1)"
    }

    /// "3/5": a cycle's place in its parent (α counts in the catalogue: "6/18").
    static func counter(_ reading: LevelReading) -> String {
        "\(reading.local + 1)/\(reading.siblings)"
    }

    /// "ε 5 · 3/5".
    static func cycleTag(_ reading: LevelReading) -> String {
        "\(levelTag(reading.level)) · \(counter(reading))"
    }

    /// Date and time of day of `t` with a precision that matches a cycle `span` seconds long: dates only for cycles of
    /// about a year and more, minutes for day-long ones, milliseconds below ten seconds. `compact` writes "9 Oct" (the
    /// year only when it differs from `refYear`) instead of "Thu 9 Oct 2026".
    static func whenParts(_ earth: EarthFormatter, _ t: Double, span: Double, compact: Bool = false, refYear: Int? = nil) -> (date: String, time: String) {
        let p = earth.parts(t)
        let month = EarthTime.monthsShort[max(0, min(11, p.month - 1))]
        let yearScale = span >= year * 0.9
        let date: String
        if compact {
            let withYear = yearScale || refYear == nil || p.year != refYear
            date = "\(p.day) \(month)\(withYear ? " \(p.year)" : "")"
        } else {
            date = "\(EarthTime.weekdaysShort[max(0, min(6, p.weekday))]) \(p.day) \(month) \(p.year)"
        }
        let hm = "\(pad(p.hour)):\(pad(p.minute))"
        let time: String
        if yearScale {
            time = ""
        } else if span >= 86_400 {
            time = hm
        } else if span >= 10 {
            time = "\(hm):\(pad(p.second))"
        } else {
            time = "\(hm):\(pad(p.second)).\(pad(min(999, p.ms), width: 3))"
        }
        return (date, time)
    }

    /// `whenParts` on one line: "Thu 9 Oct 2026, 14:23".
    static func whenText(_ earth: EarthFormatter, _ t: Double, span: Double, compact: Bool = false, refYear: Int? = nil) -> String {
        let w = whenParts(earth, t, span: span, compact: compact, refYear: refYear)
        return w.time.isEmpty ? w.date : "\(w.date), \(w.time)"
    }

    /// "3 d 04 h" from a signed number of seconds (no "in", no "ago").
    static func countdownBody(_ seconds: Double) -> String {
        let text = EarthTime.countdown(abs(seconds))
        return text.hasPrefix("in ") ? String(text.dropFirst(3)) : text
    }

    /// "starts in 3 h 02 min" / "started 2 d 03 h ago" / "running now".
    static func startPhrase(start: Double, end: Double, now: Double) -> String {
        if now >= start && now < end { return "running now" }
        return start > now ? "starts \(EarthTime.countdown(start - now))" : "started \(EarthTime.countdown(start - now))"
    }

    /// "47.2 %", floored (a cycle never reads 100.0 % before it has ended); a narrow no-break space before the sign.
    static func percent(_ phase: Double) -> String {
        let tenths = min(999, max(0, (phase * 1000 + 1e-7).rounded(.down)))
        return String(format: "%.1f\u{202F}%%", tenths / 10)
    }

    /// "+3", "0", "−4" for a glyph value.
    static func value(_ v: Int) -> String {
        v > 0 ? "+\(v)" : v < 0 ? "\(minus)\(-v)" : "0"
    }

    /// Rising / Peak / Falling / Valley as the glyph shows it: the two extreme states are the peak and the valley.
    static func phaseWord(index: Int, derivative: Int, m: Int = 4) -> String {
        if index == m { return "Peak" }
        if index == 3 * m { return "Valley" }
        return derivative < 0 ? "Falling" : "Rising"
    }

    /// The arrow that goes with a phase word.
    static func phaseMark(_ word: String) -> String {
        switch word {
        case "Peak": "▲"
        case "Valley": "▼"
        case "Falling": "↘"
        default: "↗"
        }
    }

    /// The SF Symbol of a phase word.
    static func phaseSymbol(_ word: String) -> String {
        switch word {
        case "Peak": "arrowtriangle.up.fill"
        case "Valley": "arrowtriangle.down.fill"
        case "Falling": "arrow.down.right"
        default: "arrow.up.right"
        }
    }

    private static func pad(_ n: Int, width: Int = 2) -> String {
        let digits = String(abs(n))
        return digits.count >= width ? digits : String(repeating: "0", count: width - digits.count) + digits
    }
}
