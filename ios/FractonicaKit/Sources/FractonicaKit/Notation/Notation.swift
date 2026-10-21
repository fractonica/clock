/// Pure-mode notation: how to say everything in Fractonica terms only (SPEC §15). A port of `src/core/pure.js`.
///
/// No Gregorian dates, zones, Earth time units or percentages.
///
/// Two kinds of period
/// - major (ultrahelion): α Alpha · β Beta · γ Gamma · δ Delta, said in **words**: the level, its fracton ordinal in
///   the parent and the quarter it is in, "Delta Trifracton Node". The quarter is named by the threshold that ends it.
/// - minor (infrahelion): ε Nuclide · η Helion · ι Preon · λ Flavon · ν Blink, said in **letters**. Below δ the ladder
///   skips every other depth: a Delta is 5 Nuclides, a Nuclide 77 Helions, a Helion 36 Preons, a Preon 65 Flavons,
///   a Flavon 25 Blinks. ζ θ κ μ (and ξ …) stay depths of the hierarchy but are not units.
///
/// Notation: `X#n` is an ordinal from 1 (α#6, ε#2); `nX` a count from 0 (5ι, spans "6ι 43λ") — except the Helion of a
/// date or clock, numbered from 1 inside its Nuclide like the day of a month.
///
/// Everything is presentation only; the clock still runs on Unix seconds (`FractonicaClock`).
public struct Notation: Sendable {
    /// The clock the notation reads (pure.js's `model`).
    public let model: FractonicaClock
    let tables: Tables

    /// The notation of `clock` (pure.js `createPure(model)`); its per-clock tables are built once and shared.
    public init(clock: FractonicaClock = .shared) {
        model = clock
        tables = clock === FractonicaClock.shared ? Tables.shared : Tables(model: clock)
    }

    // MARK: - Names

    /// The name of each level's letter, one per level of the first alphabet (α Alpha … ω Omega).
    public static let levelNames = [
        "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi",
        "Omicron", "Pi", "Rho", "Sigma", "Tau", "Upsilon", "Phi", "Chi", "Psi", "Omega",
    ]

    /// Fracton ordinals, 1-based (index 0 is empty); 11 is the owner's own coinage.
    public static let ordinalNames = [
        "", "Monofracton", "Difracton", "Trifracton", "Tetrafracton", "Pentafracton", "Hexafracton", "Heptafracton",
        "Octafracton", "Nonafracton", "Decafracton", "Didecafracton", "Dodecafracton", "Tridecafracton",
        "Tetradecafracton", "Pentadecafracton", "Hexadecafracton", "Heptadecafracton", "Octadecafracton",
        "Nonadecafracton", "Icosafracton",
    ]

    /// The quarter of a major period, named by the threshold that ends it (SPEC §6.2).
    public static let quarterWords = ["Peak", "Node", "Valley", "End"]

    /// The word for one tick of real time, and the compact "cycles per Blink" that replaces Hz.
    public static let blink = "Blink"
    public static let perBlinkUnit = "pB"

    /// The unit ladder, longest first: the four major periods, then the minor units every other depth.
    public static let units: [FUnit] = [
        FUnit(id: "alpha", sym: "α", level: 0, name: "Alpha", major: true),
        FUnit(id: "beta", sym: "β", level: 1, name: "Beta", major: true),
        FUnit(id: "gamma", sym: "γ", level: 2, name: "Gamma", major: true),
        FUnit(id: "delta", sym: "δ", level: 3, name: "Delta", major: true),
        FUnit(id: "epsilon", sym: "ε", level: 4, name: "Nuclide", major: false),
        FUnit(id: "eta", sym: "η", level: 6, name: "Helion", major: false),
        FUnit(id: "iota", sym: "ι", level: 8, name: "Preon", major: false),
        FUnit(id: "lambda", sym: "λ", level: 10, name: "Flavon", major: false),
        FUnit(id: "nu", sym: "ν", level: 12, name: "Blink", major: false),
    ]

    /// Levels that are units: 0 1 2 3 4 6 8 10 12.
    public static let unitLevels = units.map(\.level)

    /// Resolution words of `stamp` / `dateText`, coarse to fine.
    static let stampLevels = ["alpha", "beta", "gamma", "delta", "epsilon", "eta", "iota", "lambda", "nu"]

    /// Levels said in words (α β γ δ).
    public static func isMajor(_ level: Int) -> Bool { level >= 0 && level <= 3 }

    /// Levels that are units of the ladder: 0 1 2 3 4 6 8 10 12.
    public static func isUnitLevel(_ level: Int) -> Bool { unitLevels.contains(level) }

    /// What a depth is: "major" (α β γ δ), "unit" (ε η ι λ ν), "between" (ζ θ κ μ: skipped by the ladder) or "sub"
    /// (ξ and finer, shorter than a Blink).
    public static func levelKind(_ level: Int) -> String {
        if isMajor(level) { return "major" }
        if isUnitLevel(level) { return "unit" }
        return level < 12 ? "between" : "sub"
    }

    /// The unit of a symbol ("η"), id ("eta") or name ("Helion"); nil when it is not on the ladder.
    public static func unit(_ key: String) -> FUnit? {
        units.first { $0.sym == key || $0.id == key || $0.name == key }
    }

    /// The unit of a level; nil for the levels between units.
    public static func unit(level: Int) -> FUnit? { units.first { $0.level == level } }

    /// "Helion" / "Helions" for a symbol, id or name; `count` 1 gives the singular. Unknown keys come back as is.
    public static func unitName(_ key: String, count: Int = 1) -> String {
        guard let u = unit(key) else { return key }
        return count == 1 ? u.name : u.name + "s"
    }

    /// "Blink" / "Blinks" for a unit's level; other levels come back as the number.
    public static func unitName(level: Int, count: Int = 1) -> String {
        guard let u = unit(level: level) else { return String(level) }
        return count == 1 ? u.name : u.name + "s"
    }

    /// "Difracton" for 2; beyond the table "#25".
    public static func ordinalName(_ n: Int) -> String {
        n >= 1 && n < ordinalNames.count ? ordinalNames[n] : "#\(n)"
    }

    /// "Delta Trifracton": the `ordinal`-th (1-based, in its parent; global for Alpha) cycle of a major level. Other
    /// levels have no fracton names and get the letter form "ε#2".
    public static func periodName(level: Int, ordinal: Int) -> String {
        guard isMajor(level) else { return shortName(level: level, ordinal: ordinal) }
        return "\(levelNames[level]) \(ordinalName(ordinal))"
    }

    /// "γ#2": the compact letter form of an ordinal.
    public static func shortName(level: Int, ordinal: Int) -> String {
        let letter = level >= 0 && level < Fractonica.greekLetters.count ? Fractonica.greekLetters[level] : "?"
        return "\(letter)#\(ordinal)"
    }

    // MARK: - Unit lengths

    /// Length of one unit (a whole cycle of its depth) in Saros position units.
    public func unitPos(_ u: FUnit) -> Double { cyclePos(u.level) }

    /// Length of a whole cycle of `level` in Saros position units, 4 / P.
    public func cyclePos(_ level: Int) -> Double { 4 / model.levelInfo(level).prefixDouble }

    /// Mean device seconds of a unit (real-time conversions only).
    public func unitSeconds(_ u: FUnit) -> Double { model.levelInfo(u.level).meanSeconds }

    /// Mean device seconds in one Blink: the bridge between real time and the ladder.
    public var blinkSeconds: Double { tables.blinkSeconds }

    /// Seconds per Saros position unit around t: the length of the catalogue interval t falls in.
    public func secondsPerPosition(at t: Double) -> Double {
        let k = model.locate(min(model.tMax - 1e-3, max(model.tMin, t)))?.k ?? 0
        return model.catalogue[k + 1] - model.catalogue[k]
    }
}

/// A unit of the ladder (pure.js `UNITS`): "eta" / "η" / depth 7 (level 6) / "Helion".
public struct FUnit: Hashable, Sendable {
    public let id: String
    public let sym: String
    public let level: Int
    public let name: String
    /// α β γ δ: said in words.
    public let major: Bool
}

extension Notation {
    /// Per-clock constants derived once: unit lengths, the Blink and the time-lapse presets.
    struct Tables: Sendable {
        static let shared = Tables(model: .shared)

        /// `unitPos` of every unit, longest first.
        let lengths: [Double]
        let blinkSeconds: Double
        let rates: [Rate]

        init(model: FractonicaClock) {
            lengths = Notation.units.map { 4 / model.levelInfo($0.level).prefixDouble }
            let blink = model.levelInfo(Notation.units[Notation.units.count - 1].level).meanSeconds
            blinkSeconds = blink
            rates = [Rate(id: "real", rate: 1, label: "real time")] + Notation.rateSteps.map { id, unitID, n in
                let u = Notation.unit(unitID)!
                let seconds = model.levelInfo(u.level).meanSeconds
                return Rate(
                    id: id,
                    rate: JSNumber.precision((Double(n) * seconds) / blink, 12),
                    label: "\(n == 1 ? "" : String(n))\(u.sym) per \(Notation.blink)"
                )
            }
        }
    }
}
