import FractonicaKit
import Foundation

/// Pure-mode wording of the ladder and Up next (SPEC §15, docs/design/80-pure.md, revision 3): a port of
/// src/ui/ladder/pure-text.js on `Notation`. Nothing here reads a zone, a Gregorian field or a percentage.
///
/// - Major periods α β γ δ are said in words with their fracton ordinal and quarter word ("Trifracton Node"); their
///   phase is never drawn.
/// - Minor cycles are named by where they start in their Nuclide ("ε#5", "34η", "28ι", "3.43ν"); their phase is a pair
///   of 2-stroke glyphs.
/// - Spans are counted over α β γ δ ε η ι λ ν ("6ι 43λ"); real time in Blinks ("6.43 Blinks").
struct LadderPureText: Sendable {
    let notation: Notation
    var clock: FractonicaClock { notation.model }

    init(notation: Notation = .standard) {
        self.notation = notation
    }

    // MARK: Names

    /// "Eta" for level 6.
    static func levelWord(_ level: Int) -> String {
        level >= 0 && level < Notation.levelNames.count ? Notation.levelNames[level] : "Level \(level + 1)"
    }

    /// "Eta, depth 7": what a chip says to VoiceOver.
    static func depthWords(_ level: Int) -> String { "\(levelWord(level)), depth \(level + 1)" }

    /// How a sentence names a level: majors in words ("Delta"), the others by their letter ("η").
    static func levelSay(_ level: Int) -> String {
        Notation.isMajor(level) ? Notation.levelNames[level] : LadderText.letter(level)
    }

    /// "Node": the quarter word of a phase.
    static func quarterWord(_ phase: Double) -> String {
        Notation.quarterWords[min(3, max(0, Int(((phase.isFinite ? phase : 0) * 4).rounded(.down))))]
    }

    /// What a row says beside its chip: "Trifracton Node" (a major; the chip completes "Delta"), "ε#5", "34η", "3.43ν".
    func rowLabel(_ lv: LevelReading) -> String {
        if Notation.isMajor(lv.level) {
            return "\(Notation.ordinalName(min(max(lv.local + 1, 1), lv.siblings))) \(Self.quarterWord(lv.phase))"
        }
        return notation.cycleShort(level: lv.level, cycle: lv.cycle)
    }

    /// The cycle itself: "Delta Trifracton", "ε#5", "ε#5 34η".
    func cycleTitle(level: Int, cycle: Int64) -> String { notation.cycleName(level: level, cycle: cycle) }

    /// The cycle of `coarse` (≤ level) that holds cycle `cycle` of `level`.
    func ancestor(level: Int, cycle: Int64, coarse: Int) -> Int64 {
        Int64(Int128(cycle) / (clock.levelInfo(level).prefix / clock.levelInfo(coarse).prefix))
    }

    /// The letter address of a cycle's start: "α#6 β#4 γ#9" (a Gamma), "α#6 β#4 γ#9 δ#3 ε#5 34η" (a minor cycle).
    func cycleAddress(level: Int, cycle: Int64) -> String {
        let top = min(level, 3)
        let path = clock.cycleToPath(level: top, cycle: level <= 3 ? cycle : ancestor(level: level, cycle: cycle, coarse: 3))
        let head = path.enumerated().map { Notation.shortName(level: $0.offset, ordinal: $0.element) }.joined(separator: " ")
        return level <= 3 ? head : "\(head) \(notation.cycleName(level: level, cycle: cycle))"
    }

    /// The cycle that follows cycle `cycle` of `level`, or nil when the catalogue ends with it. Its `name` is what is
    /// said where the current one ends: "Delta Tetrafracton", "ε#3", "35η", "ε#3 1η" (a new Nuclide).
    func nextCycle(level: Int, cycle: Int64) -> (index: Int64, name: String, address: String)? {
        let idx = cycle + 1
        guard Int128(idx) < clock.count(level) else { return nil }
        let name: String
        if level <= 4 {
            name = notation.cycleName(level: level, cycle: idx)
        } else {
            let same = ancestor(level: level, cycle: idx, coarse: 4) == ancestor(level: level, cycle: cycle, coarse: 4)
            name = notation.cycleName(level: level, cycle: idx, short: same)
        }
        return (idx, name, cycleAddress(level: level, cycle: idx))
    }

    /// "→ Delta Tetrafracton begins" / "→ 35η begins" / "→ the catalogue ends".
    static func endsText(_ nextName: String?) -> String {
        nextName.map { "→ \($0) begins" } ?? "→ the catalogue ends"
    }

    /// The child cycle the bar's current segment stands for: "Beta Tetrafracton" + "Valley" (a major child), "28ι".
    func sectorName(_ lv: LevelReading, index: Int, frac: Double) -> (name: String, quarter: String?, major: Bool) {
        let child = lv.level + 1
        if Notation.isMajor(child) {
            return (Notation.periodName(level: child, ordinal: index + 1), Self.quarterWord(frac), true)
        }
        let idx = lv.cycle * Int64(lv.factor) + Int64(index)
        return (notation.cycleShort(level: child, cycle: idx), nil, false)
    }

    // MARK: What a cycle is (prose)

    /// "36ι": how many of the next unit one cycle of a unit level holds; "" otherwise.
    func holds(_ level: Int) -> String {
        guard let i = Notation.unitLevels.firstIndex(of: level), i < Notation.unitLevels.count - 1 else { return "" }
        let next = Notation.unitLevels[i + 1]
        return "\(clock.levelInfo(next).prefix / clock.levelInfo(level).prefix)\(LadderText.letter(next))"
    }

    /// "a Helion (η) is 36ι", "a ζ cycle is 11η, not a unit", "a ξ cycle is 0.14ν, finer than a Blink".
    func unitClause(_ level: Int) -> String {
        let sym = LadderText.letter(level)
        switch Notation.levelKind(level) {
        case "between": return "\(Self.article(sym)) \(sym) cycle is \(notation.cycleLength(level: level)), not a unit"
        case "sub": return "\(Self.article(sym)) \(sym) cycle is \(notation.cycleLength(level: level)), finer than a Blink"
        default:
            let name = Notation.unitName(level: level)
            let subject = "\(Self.article(name)) \(name) (\(sym))"
            let h = holds(level)
            return h.isEmpty ? "\(subject) is the finest unit" : "\(subject) is \(h)"
        }
    }

    /// "A Helion (η) is 36ι."
    func unitSentence(_ level: Int) -> String {
        let c = unitClause(level)
        return c.prefix(1).uppercased() + c.dropFirst() + "."
    }

    /// "a" or "an" before a word or a letter read aloud.
    static func article(_ word: String) -> String {
        guard let first = word.lowercased().first else { return "a" }
        return "aeiouαεηιουω".contains(first) ? "an" : "a"
    }

    // MARK: Spans

    /// "6ι 43λ": the span between two instants (never negative: "0ν").
    func left(from t1: Double, to t2: Double, parts: Int = 2) -> String {
        t2 > t1 ? notation.between(t1, t2, parts: parts) : notation.durationPos(0, parts: parts)
    }

    /// The hero countdown, up to three units: "10η 6ι 43λ".
    func heroLeft(from t1: Double, to t2: Double) -> String {
        t2 > t1 ? notation.between(t1, t2, parts: 3) : notation.durationPos(0)
    }

    /// The length of a cycle: "1δ", "11η", "0.14ν"; a clipped last cycle keeps its odd tail.
    func length(_ lv: LevelReading) -> String {
        guard lv.clipped else { return notation.cycleLength(level: lv.level) }
        let p = clock.levelInfo(lv.level).prefix
        return notation.durationPos(Double(Int128(clock.extent) * p - 4 * Int128(lv.cycle)) / Double(p))
    }

    /// "6.43 Blinks": a short real-time lead.
    func blinks(_ seconds: Double) -> String { notation.blinks(seconds) }

    /// "1 Blink", "0.14 Blinks": how long a cycle too fast to count down lasts, two significant digits.
    func periodBlinks(_ seconds: Double) -> String {
        let n = LadderNumber.precision(notation.secondsToBlinks(seconds), 2)
        return notation.blinks(notation.blinksToSeconds(n))
    }

    // MARK: Placing an instant

    /// The tokens of an instant's full letter stamp: ["α#6", "β#4", "γ#9", "δ#3", "ε#5", "34η", "29ι", "21λ", "3ν"].
    func counterParts(_ t: Double) -> [String]? {
        guard let d = notation.date(at: t), let c = notation.clock(at: t) else { return nil }
        return ["α#\(d.alpha)", "β#\(d.beta)", "γ#\(d.gamma)", "δ#\(d.delta)", "ε#\(c.epsilon)", "\(c.eta)η", "\(c.iota)ι",
                "\(c.lambda)λ", "\(c.nu)ν"]
    }

    /// Which two stamp tokens place a quarter threshold of each level (pure-text.js `QUARTER_RESOLUTION`).
    private static let quarterResolution = [1, 2, 3, 5, 6, 6, 6, 6, 7, 7, 8, 8]

    /// Where a quarter threshold falls: "ε#2 20η" (δ), "34η 9ι" (η), "21λ 6ν" (λ); "" for ν and finer.
    func quarterWhere(_ when: Double?, level: Int) -> String {
        guard let when, level >= 0, level < Self.quarterResolution.count,
              let parts = counterParts(min(when + 0.001, clock.tMax)) else { return "" }
        let res = Self.quarterResolution[level]
        return "\(parts[res - 1]) \(parts[res])"
    }

    // MARK: Turnovers

    /// "ζ ends — 4 finer cycles (η, θ, ι, κ) end with it." / "Gamma ends, with 11 finer cycles (δ … ξ)."
    static func turnoverWords(top: Int, maxLevel: Int) -> String {
        let fin = LadderText.finerLevels(top, maxLevel: maxLevel)
        let name = levelSay(top)
        if fin.isEmpty { return "\(name) ends." }
        let one = fin.count == 1
        let noun = one ? "cycle" : "cycles"
        if Notation.isMajor(top) {
            return "\(name) ends, with \(fin.count) finer \(noun) (\(LadderText.levelLetters(fin, max: 3)))."
        }
        return "\(name) ends — \(fin.count) finer \(noun) (\(LadderText.levelLetters(fin))) end\(one ? "s" : "") with it."
    }

    /// What a turnover begins, in pure terms (pure-text.js `turnoverInfo`): the cycle of `top` that begins there (nil
    /// where the catalogue ends), its letter address, the Nuclide it falls in (`group`, its words as `heading`) and the
    /// short letter date of the turnover (`stamp`).
    func turnoverInfo(time: Double, top: Int) -> TurnoverWords {
        let after = time + 0.001
        let group = clock.level(at: min(after, clock.tMax), 4)?.cycle ?? -1
        guard let begins = clock.level(at: after, top), let d = notation.date(at: after), let c = notation.clock(at: after)
        else { return TurnoverWords(name: nil, address: "", group: group, heading: "", stamp: "") }
        return TurnoverWords(
            name: notation.cycleName(level: top, cycle: begins.cycle, short: top > 4),
            address: cycleAddress(level: top, cycle: begins.cycle),
            group: group,
            heading: "\(Notation.periodName(level: 3, ordinal: d.delta)) ε#\(c.epsilon)",
            stamp: "δ#\(d.delta) ε#\(c.epsilon) \(c.eta)η"
        )
    }
}

/// A turnover said in pure terms (`LadderPureText.turnoverInfo`).
struct TurnoverWords: Hashable, Sendable {
    /// What begins there: "Delta Tetrafracton", "ε#3", "45η"; nil where the catalogue ends.
    let name: String?
    /// "α#6 β#4 γ#9 δ#3 ε#5 45η".
    let address: String
    /// The global index of the Nuclide the turnover falls in (the pure "week" the list groups by).
    let group: Int64
    /// That Nuclide in words: "Delta Trifracton ε#5".
    let heading: String
    /// "δ#3 ε#5 45η".
    let stamp: String

    /// "→ 45η begins".
    var begins: String { LadderPureText.endsText(name) }
}
