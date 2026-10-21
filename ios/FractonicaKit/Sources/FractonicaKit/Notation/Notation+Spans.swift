/// Spans in ladder units (SPEC §15.4): "2ε 5η", "6ι 43λ", "0.14ν"; and the 256-state phase pair.
extension Notation {
    /// Float positions carry ~1e-14 Saros of error, more than a Blink (5.5e-10) times 1e-4; counting with a relative
    /// fudge would read exact cycle lengths one small unit short. 1e-12 Saros is 0.6 ms, far below a Blink (311 ms).
    static let epsPos = 1e-12

    /// Break a position span (Saros units) into counts of ladder units, starting from the largest unit that fits.
    /// Returns up to `parts` non-zero counts, longest first ("3η 2λ", never "3η 0ι 2λ"); with `keepZeros` the next
    /// `parts` consecutive units instead, zeros included. Empty for a non-finite span or one whose count of the
    /// largest unit would not fit `Int` (beyond 10^17 Alphas).
    public func decompose(_ dpos: Double, parts: Int = 2, keepZeros: Bool = false) -> [(unit: FUnit, count: Int)] {
        guard dpos.isFinite else { return [] }
        let lengths = tables.lengths
        var rem = abs(dpos) + Self.epsPos
        // Finer than a Blink: count 0 (durationPos writes it as a decimal).
        let first = lengths.firstIndex { $0 <= rem } ?? lengths.count - 1
        var out: [(unit: FUnit, count: Int)] = []
        var i = first
        while i < lengths.count && out.count < parts {
            let count = (rem / lengths[i]).rounded(.down)
            guard let whole = Int(exactly: count) else { return [] }
            rem -= count * lengths[i]
            if rem < 0 { rem = 0 }
            if count > 0 || keepZeros || out.isEmpty { out.append((Self.units[i], whole)) }
            i += 1
        }
        return out
    }

    /// "2ε 5η" / "5η 12ι" / "6ι 43λ" for a span of `dpos` Saros units. The ladder ends at the Blink: a span led by the
    /// Blink and under ten of them keeps a decimal, "2.6ν", "0.14ν". Negative spans read "−3η 5λ"; "—" where
    /// `decompose` has nothing (a non-finite or absurdly long span).
    public func durationPos(_ dpos: Double, parts: Int = 2, keepZeros: Bool = false) -> String {
        let counts = decompose(dpos, parts: max(1, parts), keepZeros: keepZeros)
        guard let lead = counts.first else { return "—" }
        let span = abs(dpos)
        let blink = tables.lengths[tables.lengths.count - 1]
        let text = lead.unit.id == "nu" && span / blink < 10
            ? Self.blinkCount(span / blink) + lead.unit.sym
            : counts.map { "\($0.count)\($0.unit.sym)" }.joined(separator: " ")
        return dpos < 0 && text.contains(where: "123456789".contains) ? "−" + text : text
    }

    /// The same for a number of device seconds, measured in the catalogue interval around `at`.
    public func duration(_ seconds: Double, parts: Int = 2, at: Double, keepZeros: Bool = false) -> String {
        durationPos(seconds / secondsPerPosition(at: at), parts: parts, keepZeros: keepZeros)
    }

    /// "in 5η 12ι" / "5η 12ι ago".
    public func countdown(_ seconds: Double, parts: Int = 2, at: Double, keepZeros: Bool = false) -> String {
        let text = duration(abs(seconds), parts: parts, at: at, keepZeros: keepZeros)
        return seconds < 0 ? "\(text) ago" : "in \(text)"
    }

    /// The span between two instants measured in position (exact across eclipse intervals).
    public func between(_ t1: Double, _ t2: Double, parts: Int = 2, keepZeros: Bool = false) -> String {
        guard let a = model.position(at: t1), let b = model.position(at: t2) else {
            return duration(t2 - t1, parts: parts, at: t1, keepZeros: keepZeros)
        }
        return durationPos(b - a, parts: parts, keepZeros: keepZeros)
    }

    /// Exact nominal length of one full cycle of `level`: "1δ", "11η" (a ζ), "4ι" (a θ), "5ν", "0.14ν" (a ξ).
    public func cycleLength(level: Int, parts: Int = 2) -> String {
        durationPos(cyclePos(level), parts: parts)
    }

    /// A count of Blinks with a decimal part: "0.14", "2.6", "4" (two significant digits below one, one decimal above).
    static func blinkCount(_ x: Double) -> String {
        if x < 1e-4 { return "0" }
        if x < 0.001 { return "<0.001" }
        if x < 1 { return JSNumber.string(JSNumber.precision(x, 2)) }
        return JSNumber.string(JSNumber.round(x * 10) / 10)
    }

    // MARK: - 256-state phase pairs

    /// A cycle fraction 0 … 1 as two 2-stroke glyph indices (0 … 15 each): 256 states.
    public static func pair(_ fraction: Double) -> (index: Int, hi: Int, lo: Int) {
        let f = min(1, max(0, fraction.isFinite ? fraction : 0))
        let index = min(255, Int((f * 256).rounded(.down)))
        return (index, index >> 4, index & 15)
    }

    /// "13·4": the pair as two numbers.
    public static func pairText(_ fraction: Double) -> String {
        let p = pair(fraction)
        return "\(p.hi)·\(p.lo)"
    }
}
