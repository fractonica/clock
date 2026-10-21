/// Real time in Fractonica terms (SPEC §15.5): speeds as units per Blink, frequencies as cycles per Blink (pB).
extension Notation {
    /// A time-lapse preset: how much of the ladder passes per Blink of real time.
    public struct Rate: Hashable, Sendable {
        public let id: String
        /// Displayed seconds per real second.
        public let rate: Double
        public let label: String
    }

    /// The presets after real time: whole counts of a unit per Blink (5ν = 5×, λ = 25×, 13λ = 325×, ι = 1 625×,
    /// 4ι = 6 500×, η = 58 500×, …), because the hierarchy is a product of whole factors.
    static let rateSteps: [(id: String, unit: String, count: Int)] = [
        ("nu5", "nu", 5), ("lambda", "lambda", 1), ("lambda13", "lambda", 13), ("iota", "iota", 1), ("iota4", "iota", 4),
        ("eta", "eta", 1), ("eta11", "eta", 11), ("epsilon", "epsilon", 1), ("delta", "delta", 1), ("gamma", "gamma", 1),
    ]

    /// Real time, then the presets of `rateSteps`.
    public var rates: [Rate] { tables.rates }

    /// The default Play speed of pure mode: 4ι per Blink (6 500×).
    public var playRate: Double { tables.rates.first { $0.id == "iota4" }!.rate }

    /// "η per Blink" / "4ι per Blink" for a preset; any other rate in the largest unit that passes at least once per
    /// Blink ("2.22ι per Blink"), slower than real time "0.5ν per Blink"; negative rates add " backward".
    public func rateLabel(_ rate: Double) -> String {
        let r = abs(rate)
        let base: String
        if let hit = tables.rates.first(where: { abs($0.rate - r) / $0.rate < 0.005 }) {
            base = hit.label
        } else {
            let per = r * blinkSeconds // clock seconds per Blink of real time
            let u = Self.units.first { unitSeconds($0) <= per * 1.0000001 } ?? Self.units[Self.units.count - 1]
            let k = per / unitSeconds(u)
            let near = JSNumber.round(k)
            let text = abs(k - near) / near < 0.005 && near >= 1
                ? JSNumber.string(near)
                : JSNumber.string(JSNumber.precision(k, 3))
            base = "\(text == "1" ? "" : text)\(u.sym) per \(Self.blink)"
        }
        return rate < 0 ? base + " backward" : base
    }

    /// "3.5 Blinks": a span of device seconds counted in Blinks.
    public func blinks(_ seconds: Double) -> String {
        let n = seconds / blinkSeconds
        if n > 0 && n < 0.001 { return "<0.001 \(Self.blink)s" }
        let rounded = JSNumber.precision(n, 3)
        let text = rounded >= 1000 ? Self.groupDigits(rounded) : JSNumber.string(rounded)
        return "\(text) \(Self.blink)\(text == "1" ? "" : "s")"
    }

    /// Device seconds of a count of Blinks.
    public func blinksToSeconds(_ n: Double) -> Double { n * blinkSeconds }

    /// Blinks in a span of device seconds.
    public func secondsToBlinks(_ s: Double) -> Double { s / blinkSeconds }

    /// A frequency in cycles per device second (Hz) as cycles per Blink: 22.5 Hz → 7.
    public func perBlink(_ hz: Double) -> Double { hz * blinkSeconds }

    /// "34.2 pB", "2 772 pB", "0.2 pB"; slower than one cycle per 25 Blinks "1 per 65 Blinks"; "—" if not positive.
    public static func pbText(_ pb: Double) -> String {
        guard pb > 0, pb.isFinite else { return "—" }
        if pb < 0.04 - 1e-9 { return "1 per \(groupDigits(JSNumber.round(1 / pb))) \(blink)s" }
        let v: String
        if pb >= 999.5 {
            v = groupDigits(JSNumber.round(pb))
        } else if pb >= 99.95 {
            v = JSNumber.string(Double(JSNumber.fixed(pb, 1))!)
        } else {
            v = JSNumber.string(JSNumber.precision(pb, 3))
        }
        return "\(v) \(perBlinkUnit)"
    }
}
