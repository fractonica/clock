import Foundation

/// The journal face reading: the clock read the way the printed diary addresses it (docs/design/90-diary.md,
/// SPEC §15). A port of the pure parts of `src/ui/face/journal.js`.
///
/// - top: the phase of the middle's longest unit, as two 2-stroke glyphs (256 states) with its letter.
/// - middle: three named units from the selected one down, every count in two digits so the reading keeps its width:
///   "72η 24ι 62λ", "ε#02 72η 24ι", "24ι 62λ 03ν".
/// - bottom: the longest unit's cycle as two half-arcs (left descending below the axis, right ascending above it)
///   with a tick at the present position.
/// - major: a major period (Alpha … Delta) is shown alone: its phase as one big 3-stroke glyph, four lines of words
///   ("5th / Delta / Trifracton / End": the 5th Nuclide of Delta Trifracton, in its End quarter) and its own cycle.
///
/// Units, long to short: α β γ δ (major) · ε η ι λ ν (minor). `unit` is the index of the first one shown, 0 … 6
/// (the last triplet is ι λ ν).
public enum Journal {
    /// The named units, long to short: (level, id).
    public static let units: [(level: Int, id: String)] = [
        (0, "alpha"), (1, "beta"), (2, "gamma"), (3, "delta"), (4, "epsilon"), (6, "eta"), (8, "iota"), (10, "lambda"),
        (12, "nu"),
    ]

    /// The last unit index: the triplet ι λ ν.
    public static let maxUnit = units.count - 3

    /// A unit index clamped to 0 … `maxUnit`.
    public static func clampUnit(_ u: Int) -> Int { min(maxUnit, max(0, u)) }

    /// A stored or computed unit index: rounded (halves up) and clamped; non-finite values give the Helion triplet (5).
    public static func clampUnit(_ u: Double) -> Int {
        Int(min(Double(maxUnit), max(0, JSNumber.round(u.isFinite ? u : 5))))
    }

    /// "1st", "2nd", "3rd", "4th", "11th", "22nd".
    public static func ordinal(_ n: Int) -> String {
        let v = n % 100
        let suffix: String
        if v >= 11 && v <= 13 {
            suffix = "th"
        } else {
            switch n % 10 {
            case 1: suffix = "st"
            case 2: suffix = "nd"
            case 3: suffix = "rd"
            default: suffix = "th"
            }
        }
        return "\(n)\(suffix)"
    }

    /// One minor unit of the middle line: its level and text ("34η", "ε#05").
    public struct Token: Hashable, Sendable {
        public let level: Int
        public let text: String
    }

    /// A major period shown alone: four lines (its child's ordinal, its name, its fracton word, its quarter) and its
    /// 3-stroke glyph state (0 … 51).
    public struct Major: Hashable, Sendable {
        public let level: Int
        public let lines: [String]
        public let index3: Int
    }

    /// What the face shows at an instant.
    public struct Reading: Hashable, Sendable {
        public let unit: Int
        /// The units' levels: three minor ones, or the major one alone.
        public let levels: [Int]
        /// The longest unit shown: its phase is the top glyphs and the bottom cycle.
        public let leadLevel: Int
        public let leadLetter: String
        public let leadPhase: Double
        /// Minor mode: "72η", "24ι", "62λ".
        public let tokens: [Token]?
        /// Major mode.
        public let major: Major?
    }

    /// The face at time t with unit index `unit` (journal.js `journalReading`); nil outside the catalogue.
    public static func reading(at t: Double, unit: Int, notation: Notation = Notation()) -> Reading? {
        let unit = clampUnit(unit)
        let first = units[unit].level
        let levels = first <= 3 ? [first] : units[unit..<unit + 3].map(\.level)
        let model = notation.model
        guard let lead = model.level(at: t, levels[0]),
              let c = notation.clock(at: t),
              let d = notation.date(at: t) else { return nil }
        let letter = Fractonica.greekLetters[first]
        if first <= 3 {
            let child = [d.beta, d.gamma, d.delta, d.epsilon][first]
            let own = [d.alpha, d.beta, d.gamma, d.delta][first]
            let quarter = [d.quarter.alpha, d.quarter.beta, d.quarter.gamma, d.quarter.delta][first]
            let words = Notation.periodName(level: first, ordinal: own).split(separator: " ").map(String.init)
            let major = Major(
                level: first,
                lines: [ordinal(child), words[0], words[1], quarter],
                index3: model.level(at: t, first, strokes: 3)?.index ?? 0
            )
            return Reading(unit: unit, levels: levels, leadLevel: first, leadLetter: letter, leadPhase: lead.phase,
                           tokens: nil, major: major)
        }
        let two = { (n: Int) in n < 10 && n >= 0 ? "0\(n)" : String(n) }
        let tokens = levels.map { level -> Token in
            switch level {
            case 4: Token(level: level, text: "ε#\(two(c.epsilon))")
            case 6: Token(level: level, text: "\(two(c.eta))η")
            case 8: Token(level: level, text: "\(two(c.iota))ι")
            case 10: Token(level: level, text: "\(two(c.lambda))λ")
            default: Token(level: level, text: "\(two(c.nu))ν")
            }
        }
        return Reading(unit: unit, levels: levels, leadLevel: first, leadLetter: letter, leadPhase: lead.phase,
                       tokens: tokens, major: nil)
    }

    /// The point at cycle fraction f on the two half-arcs and the outward normal there (for the tick). The left arc
    /// (centre `cl`) runs from its left end through the bottom to the middle; the right arc (centre `cr`) from the
    /// middle over the top to its right end. y grows downward.
    public static func arcPoint(_ f: Double, cl: Double, cr: Double, cy: Double, r: Double)
        -> (x: Double, y: Double, nx: Double, ny: Double) {
        let p = min(1, max(0, f))
        if p <= 0.5 {
            let a = Double.pi * 2 * p // 0 at the left end, π at the middle, through the bottom
            let x = cl - r * cos(a)
            let y = cy + r * sin(a)
            return (x, y, (x - cl) / r, (y - cy) / r)
        }
        let a = Double.pi * (2 * p - 1)
        let x = cr - r * cos(a)
        let y = cy - r * sin(a)
        return (x, y, (x - cr) / r, (y - cy) / r)
    }
}
