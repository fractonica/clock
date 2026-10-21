/// Names of cycles and addresses of moments (SPEC §15.2–§15.3).
extension Notation {
    /// 1-based ordinal of cycle `cycle` of `level` inside its parent (Alpha: global).
    public func ordinalOf(level: Int, cycle: Int64) -> Int {
        guard let siblings = model.levelInfo(level).siblings else { return Int(clamping: Int128(cycle) + 1) }
        return Int(cycle % Int64(siblings)) + 1
    }

    /// The name of cycle `cycle` (global index) of `level`:
    /// - major: "Delta Trifracton"
    /// - ε: "ε#2"
    /// - finer: where it starts inside its Nuclide, "ε#2 5η 9ι" (`short` drops the Nuclide: "5η 9ι")
    public func cycleName(level: Int, cycle: Int64, short: Bool = false) -> String {
        if Self.isMajor(level) { return Self.periodName(level: level, ordinal: ordinalOf(level: level, cycle: cycle)) }
        let c = countsAtStart(level: level, cycle: cycle)
        if level == 4 { return "ε#\(c.epsilon)" }
        let parts = Self.minorStartParts(level: level, counts: c)
        return (short ? parts : ["ε#\(c.epsilon)"] + parts).joined(separator: " ")
    }

    /// Compact form: "δ#3", "ε#2", or the finest placing count of a minor cycle ("23η", "8ι", "11ν").
    public func cycleShort(level: Int, cycle: Int64) -> String {
        if level <= 4 { return Self.shortName(level: level, ordinal: ordinalOf(level: level, cycle: cycle)) }
        return Self.minorStartParts(level: level, counts: countsAtStart(level: level, cycle: cycle)).last ?? ""
    }

    /// The name of the cycle of `level` running at t; nil outside the catalogue.
    public func nameAt(_ t: Double, level: Int, short: Bool = false) -> String? {
        guard let s = model.cycleStates(at: t, levels: [level])?[0] else { return nil }
        return cycleName(level: level, cycle: s.cycle, short: short)
    }

    /// The stamp resolution that shows a level's cycle: δ "delta", ε "epsilon", ζ η "eta", θ ι "iota", κ λ "lambda",
    /// finer "nu".
    public static func resolutionOf(_ level: Int) -> String {
        if level <= 4 { return stampLevels[max(0, level)] }
        if level <= 6 { return "eta" }
        if level <= 8 { return "iota" }
        return level <= 10 ? "lambda" : "nu"
    }

    /// The letter address of t down to the resolution of `level`: "α#6 β#4 γ#9 δ#3 ε#2 5η 9ι".
    public func addressAt(_ t: Double, level: Int) -> String {
        stamp(at: t, upTo: Self.resolutionOf(level))
    }

    /// The catalogue's extent in pure terms: "α#1 – α#18".
    public func catalogueText() -> String {
        "\(Self.shortName(level: 0, ordinal: 1)) – \(Self.shortName(level: 0, ordinal: Int(model.count(0))))"
    }

    /// The n-th eclipse of the catalogue, 0-based like the position: "#22".
    public static func eclipseName(_ k: Int) -> String { "#\(k)" }

    /// 6231 → "6 231", −48420 → "−48 420" (narrow no-break space, true minus): digit groups never read as a year.
    public static func groupDigits(_ n: Double) -> String {
        let v = n.rounded(.towardZero)
        let body = JSNumber.string(abs(v))
        // JS: body.replace(/\B(?=(\d{3})+(?!\d))/g, NNBSP), i.e. separate every run of digits in threes from the right.
        var out = ""
        var run: [Character] = []
        func flushRun() {
            for (i, digit) in run.enumerated() {
                if i > 0 && (run.count - i) % 3 == 0 { out.append("\u{202F}") }
                out.append(digit)
            }
            run.removeAll()
        }
        for ch in body {
            if ch.isASCII && ch.isNumber { run.append(ch) } else { flushRun(); out.append(ch) }
        }
        flushRun()
        return (v < 0 ? "−" : "") + out
    }

    /// The counts that place a minor cycle's start, down to the first unit at or finer than its level: ζ "23η",
    /// η "5η", θ "5η 8ι", ι "5η 9ι", κ "5η 9ι 26λ", λ "5η 9ι 27λ", μ "… 27λ 10ν", ν "… 11ν", ξ "… 11.29ν".
    static func minorStartParts(level: Int, counts c: StartCounts) -> [String] {
        var parts: [String] = []
        if level >= 5 { parts.append("\(c.eta)η") }
        if level >= 7 { parts.append("\(c.iota)ι") }
        if level >= 9 { parts.append("\(c.lambda)λ") }
        if level >= 11 {
            parts.append(c.nuFrac != 0
                ? JSNumber.string(Double(JSNumber.fixed(Double(c.nu) + c.nuFrac, 2))!) + "ν"
                : "\(c.nu)ν")
        }
        return parts
    }
}
