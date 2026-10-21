/// Pure clocks, dates and stamps (SPEC §15.3): "Delta Trifracton Node ε#2 5η 5ι", "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι".
extension Notation {
    /// Where the start of cycle `cycle` of `level` falls on the minor ladder: the Delta and Nuclide ordinals, the
    /// Helion's number in the Nuclide (from 1) and the counts of completed Preons, Flavons and Blinks. Counts of units
    /// finer than `level` are 0 at a start; `nuFrac` is the fraction of a Blink for levels below ν. Exact.
    public func countsAtStart(level: Int, cycle: Int64) -> StartCounts {
        let c = Int128(cycle)
        let prefix = { (l: Int) in self.model.levelInfo(l).prefix }
        let own = prefix(level)
        let at = { (l: Int) in l <= level ? c / (own / prefix(l)) : c * (prefix(l) / own) }
        let local = { (l: Int, parent: Int) in Int(at(l) % (prefix(l) / prefix(parent))) }
        var nuFrac = 0.0
        if level > 12 {
            let ratio = own / prefix(12)
            nuFrac = Double(c % ratio) / Double(ratio)
        }
        return StartCounts(
            delta: Int(at(3) % 5) + 1,
            epsilon: local(4, 3) + 1,
            eta: local(6, 4) + 1,
            iota: local(8, 6),
            lambda: local(10, 8),
            nu: local(12, 10),
            nuFrac: nuFrac
        )
    }

    /// The pure clock at t: the Nuclide in its Delta (1 … 5), the Helion numbered from 1 in the Nuclide (1 … 77) and
    /// the completed Preons (0 … 35), Flavons (0 … 64) and Blinks (0 … 24). Nil outside the catalogue.
    public func clock(at t: Double) -> MinorClock? {
        guard let s = model.cycleStates(at: t, levels: Array(4...12)) else { return nil }
        return MinorClock(
            epsilon: s[0].local + 1,
            eta: s[1].local * 11 + s[2].local + 1,
            iota: s[3].local * 4 + s[4].local,
            lambda: s[5].local * 13 + s[6].local,
            nu: s[7].local * 5 + s[8].local
        )
    }

    /// "5η 5ι 5λ": the clock's counts down to `upTo` ("eta", "iota", "lambda" or "nu"); "—" outside the catalogue.
    public func clockText(at t: Double, upTo: String = "lambda") -> String {
        guard let c = clock(at: t) else { return "—" }
        let k = Self.stampLevels.firstIndex(of: upTo) ?? -1
        var parts = ["\(c.eta)η"]
        if k >= 6 { parts.append("\(c.iota)ι") }
        if k >= 7 { parts.append("\(c.lambda)λ") }
        if k >= 8 { parts.append("\(c.nu)ν") }
        return parts.joined(separator: " ")
    }

    /// 0 … 3: the quarter of the running cycle of `level` (0 Peak … 3 End); nil outside the catalogue.
    public func quarter(at t: Double, level: Int) -> Int? {
        model.cycleStates(at: t, levels: [level])?[0].quarter
    }

    /// The pure date at t: ordinals of the four major periods (α 1 … 18, β 1 … 5, γ 1 … 13, δ 1 … 5) with their quarter
    /// words, and the Nuclide ordinal (1 … 5). Nil outside the catalogue.
    public func date(at t: Double) -> PureDate? {
        guard let s = model.cycleStates(at: t, levels: Array(0...4)) else { return nil }
        let word = { (i: Int) in Self.quarterWords[s[i].quarter] }
        return PureDate(
            alpha: Int(s[0].cycle) + 1,
            beta: s[1].local + 1,
            gamma: s[2].local + 1,
            delta: s[3].local + 1,
            epsilon: s[4].local + 1,
            quarter: PureDate.Quarters(alpha: word(0), beta: word(1), gamma: word(2), delta: word(3))
        )
    }

    /// "Delta Trifracton Node": a major period running at t in words, with its quarter; "—" otherwise.
    public func majorText(at t: Double, level: Int) -> String {
        guard Self.isMajor(level), let s = model.cycleStates(at: t, levels: [level])?[0] else { return "—" }
        return "\(Self.periodName(level: level, ordinal: ordinalOf(level: level, cycle: s.cycle))) \(Self.quarterWords[s.quarter])"
    }

    /// The date at t.
    /// - `form` "short" (default): "Delta Trifracton Node ε#2 5η 5ι"; "full": "Alpha Pentafracton Peak, Beta
    ///   Tetrafracton Valley, Gamma Difracton End, Delta Trifracton Node, ε#2 5η 5ι".
    /// - `letters`: "δ#3 ε#2 5η 5ι" / "α#5 β#4 γ#2 δ#3 ε#2 5η 5ι" (no quarter words: the counts imply them).
    /// - `upTo`: the finest part, "delta" … "iota" (default) … "nu".
    public func dateText(at t: Double, form: String = "short", letters: Bool = false, upTo: String = "iota") -> String {
        guard let d = date(at: t) else { return "—" }
        let k = max(3, Self.stampLevels.firstIndex(of: upTo) ?? -1)
        let ordinals = [d.alpha, d.beta, d.gamma, d.delta]
        let quarters = [d.quarter.alpha, d.quarter.beta, d.quarter.gamma, d.quarter.delta]
        let majorLevels = form == "full" ? [0, 1, 2, 3] : [3]
        let major = majorLevels.map { level in
            letters
                ? "\(Fractonica.greekLetters[level])#\(ordinals[level])"
                : "\(Self.periodName(level: level, ordinal: ordinals[level])) \(quarters[level])"
        }
        var minor: [String] = []
        if k >= 4 { minor.append("ε#\(d.epsilon)") }
        if k >= 5 { minor.append(clockText(at: t, upTo: Self.stampLevels[k])) }
        if letters { return (major + minor).joined(separator: " ") }
        let head = major.joined(separator: ", ")
        if minor.isEmpty { return head }
        return head + (form == "full" ? ", " : " ") + minor.joined(separator: " ")
    }

    /// The full letter address of t down to a resolution (default "iota"): "α#5 β#4 γ#2 δ#3 ε#2 5η 5ι". It identifies
    /// a moment unambiguously and reads back.
    public func stamp(at t: Double, upTo: String = "iota") -> String {
        dateText(at: t, form: "full", letters: true, upTo: Self.stampLevels.contains(upTo) ? upTo : "iota")
    }

    // MARK: - Solar drift

    /// Solar drift counted in Flavons: the shift of a sync start against the 4-day grid, measured in position (exact
    /// across eclipse intervals). Pass a `SolarReading`'s or `SolarSyncInfo`'s start, nominal start and drift.
    public func driftLambda(start: Double, nominalStart: Double, drift: Double) -> Int {
        let lambda = cyclePos(10)
        let dpos: Double
        if let a = model.position(at: nominalStart), let b = model.position(at: start) {
            dpos = b - a
        } else {
            dpos = drift / secondsPerPosition(at: start)
        }
        // pure.js: `Math.round(dpos / lam) || 0` (NaN reads 0); a count beyond `Int` reads 0 as well.
        return Int(exactly: JSNumber.round(dpos / lambda)) ?? 0
    }

    /// "−623λ" / "+12λ" / "0λ".
    public func driftText(start: Double, nominalStart: Double, drift: Double) -> String {
        let n = driftLambda(start: start, nominalStart: nominalStart, drift: drift)
        return (n > 0 ? "+" : "") + Self.groupDigits(Double(n)) + "λ"
    }
}

/// Where a cycle starts on the minor ladder (`Notation.countsAtStart`).
public struct StartCounts: Hashable, Sendable {
    public let delta: Int
    public let epsilon: Int
    public let eta: Int
    public let iota: Int
    public let lambda: Int
    public let nu: Int
    public let nuFrac: Double
}

/// The pure clock (`Notation.clock(at:)`).
public struct MinorClock: Hashable, Sendable {
    public let epsilon: Int
    public let eta: Int
    public let iota: Int
    public let lambda: Int
    public let nu: Int
}

/// The pure date (`Notation.date(at:)`).
public struct PureDate: Hashable, Sendable {
    public let alpha: Int
    public let beta: Int
    public let gamma: Int
    public let delta: Int
    public let epsilon: Int
    public let quarter: Quarters

    /// The quarter word of each major period ("Peak", "Node", "Valley", "End").
    public struct Quarters: Hashable, Sendable {
        public let alpha: String
        public let beta: String
        public let gamma: String
        public let delta: String
    }
}

extension Notation {
    public typealias StartCounts = FractonicaKit.StartCounts
    public typealias MinorClock = FractonicaKit.MinorClock
    public typealias PureDate = FractonicaKit.PureDate
}
