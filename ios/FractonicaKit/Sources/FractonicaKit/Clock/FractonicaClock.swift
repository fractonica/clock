import Synchronization

/// The Fractonica clock on the Saros 141 Unix catalogue: a Swift port of the web app's `src/core/model.js` and,
/// through it, of the reference library `fractonica.js` 2.0.0 (SPEC §2–§7).
///
/// Conventions, as in model.js
/// - Time is Unix seconds as `Double` (UTC, 86 400 s days, SPEC §2.1). Every query is rounded to 1 ms first.
/// - `level` is zero-based; depth = level + 1 is the user-facing number.
/// - Outside the catalogue (before 1613-05-19 or after 2857-06-13) nothing is extrapolated: readings are `nil`.
///   The catalogue's closing instant belongs to its last cycle (queried 1 ms inside it, the EDGE rule).
///
/// Numerics. The library works in exact rationals; so does this port. The catalogue is held in whole milliseconds
/// and a position is the exact fraction k + (t − E[k]) / (E[k+1] − E[k]) on 64/128-bit integers, so cycle indices,
/// glyph states, odometer digits, thresholds and quarters are exact. Times and phases become `Double` only at the
/// end, through the library's own conversion (`Ratio.libraryDouble`), and the float helpers (`locate`,
/// `position(at:)`, `boundaries`, `cycleStartTime`) repeat model.js's float arithmetic step for step, so readings
/// agree with the web app's (the golden tests check every reading, and the catalogue, positions and exact
/// timestamps bit for bit).
///
/// The clock is immutable apart from an internal, lock-protected cache of cycle facts, so one shared instance
/// serves the app, its widgets and background work alike.
public final class FractonicaClock: Sendable {
    /// Saros 141 Unix catalogue, default sequence, ascending family, solar sync anchor 20 / level 6 / 19 cycles / 4 days.
    public static let shared = FractonicaClock()

    /// Catalogue instants as the web model holds them (Unix seconds, converted with the library's `F.number`).
    public let catalogue: [Double]
    /// Highest ordinal (69): positions run from 0 to `extent`.
    public let extent: Int
    /// The catalogue's first and last eclipse (1613-05-19, 2857-06-13): readings exist from `tMin` to `tMax`.
    public let tMin: Double
    public let tMax: Double
    /// Mean Saros length in seconds, (tMax − tMin) / extent. For estimates only (SPEC §7.4).
    public let meanSaros: Double

    /// Catalogue in whole milliseconds, and the length of each Saros interval in milliseconds.
    let catalogueMs: [Int64]
    let intervalsMs: [Int64]
    /// Static facts and cycle counts for every supported level.
    let infos: [LevelInfo]
    let counts: [Int128]
    /// The EDGE instant `tMax − 0.001` (see `QueryTime`).
    let edge: QueryTime
    let solarSync: SolarSyncConstants
    /// Recently computed cycle facts (model.js `cycleCache`).
    let factsCache = Mutex<[FactsKey: CycleFacts]>([:])

    /// model.js `EDGE`: the closing instant is queried 1 ms inside the last cycle.
    static let edgeSeconds = 0.001

    private init() {
        let ms = Fractonica.saros141UnixMilliseconds
        catalogueMs = ms
        intervalsMs = zip(ms.dropFirst(), ms).map { $0 - $1 }
        extent = ms.count - 1
        catalogue = ms.map { Ratio(Int128($0), 1000).libraryDouble }
        tMin = catalogue[0]
        tMax = catalogue[extent]
        meanSaros = (tMax - tMin) / Double(extent)

        var prefixes: [Int128] = [1]
        for level in 1...Fractonica.supportedLevels.upperBound {
            prefixes.append(prefixes[level - 1] * Int128(Fractonica.sequence[(level - 1) % Fractonica.sequence.count]))
        }
        let extent128 = Int128(ms.count - 1)
        counts = prefixes.map { p in (extent128 * p + 3) / 4 } // ceil(extent · P / 4)
        let mean = meanSaros
        infos = prefixes.enumerated().map { level, prefix in
            let name = Fractonica.periodName(level)
            let sequence = Fractonica.sequence
            return LevelInfo(
                level: level,
                depth: level + 1,
                letter: name.letter,
                suffix: name.suffix,
                text: name.text,
                factor: sequence[level % sequence.count],
                siblings: level == 0 ? nil : sequence[(level - 1) % sequence.count],
                prefix: prefix,
                prefixDouble: Double(prefix),
                meanSeconds: (4 * mean) / Double(prefix)
            )
        }
        edge = QueryTime(seconds: catalogue[extent] - Self.edgeSeconds)
        solarSync = SolarSyncConstants(
            anchorCycle: Int128(SolarSyncConstants.anchor) * prefixes[SolarSyncConstants.level] / 4,
            anchorTime: Ratio(Int128(ms[SolarSyncConstants.anchor]), 1000),
            anchorSeconds: catalogue[SolarSyncConstants.anchor]
        )
    }

    // MARK: - Levels

    /// Static facts about a level. Levels outside `Fractonica.supportedLevels` are clamped into it (the result's
    /// `level` says which one was read); the library throws for them.
    public func levelInfo(_ level: Int) -> LevelInfo {
        infos[Self.supported(level)]
    }

    /// Number of cycles at a level in the catalogue, including the clipped last one (`clock.count`). Levels outside
    /// `Fractonica.supportedLevels` are clamped into it, as in `levelInfo(_:)`.
    public func count(_ level: Int) -> Int128 {
        counts[Self.supported(level)]
    }

    /// `level` clamped into `Fractonica.supportedLevels`.
    static func supported(_ level: Int) -> Int {
        min(Fractonica.supportedLevels.upperBound, max(Fractonica.supportedLevels.lowerBound, level))
    }

    // MARK: - Float catalogue helpers (model.js, SPEC §11)

    /// Whether t lies inside the catalogue, [tMin, tMax] (false for NaN).
    public func inRange(_ t: Double) -> Bool { t >= tMin && t <= tMax }

    /// t clamped into the catalogue (model.js `clamp`).
    public func clamp(_ t: Double) -> Double { min(tMax, max(tMin, t)) }

    /// The catalogue interval holding t: E[k] ≤ t < E[k+1] (k = extent − 1 at tMax) and the fraction through it.
    public func locate(_ t: Double) -> (k: Int, f: Double)? {
        guard t >= tMin && t <= tMax else { return nil }
        var lo = 0, hi = extent
        while lo + 1 < hi {
            let m = (lo + hi) >> 1
            if catalogue[m] <= t { lo = m } else { hi = m }
        }
        return (lo, (t - catalogue[lo]) / (catalogue[lo + 1] - catalogue[lo]))
    }

    /// Position in Saros units (float, model.js `positionOf`); nil outside the catalogue.
    public func position(at t: Double) -> Double? {
        guard let (k, f) = locate(t) else { return nil }
        return Double(k) + f
    }

    /// Time of a position (float, model.js `timeOfPosition`), clamped to the catalogue; NaN stays NaN.
    public func time(atPosition p: Double) -> Double {
        if p.isNaN { return .nan }
        if p <= 0 { return tMin }
        if p >= Double(extent) { return tMax }
        let k = Int(p.rounded(.down))
        return catalogue[k] + (p - Double(k)) * (catalogue[k + 1] - catalogue[k])
    }

    /// Time of the exact position n / d (the library's `timestampAt`); nil outside [0, extent], for a zero
    /// denominator, and for a denominator in lowest terms above 2^80, where the exact interpolation would leave
    /// 128 bits (the clock's own positions stay below 2^60).
    public func time(atPositionNumerator n: Int128, denominator d: Int128) -> Double? {
        guard d != 0, n != .min, d != .min else { return nil }
        let p = Ratio(n, d)
        guard p.denominator <= Self.maxExactDenominator else { return nil }
        return timestamp(at: p)?.libraryDouble
    }

    /// Start time of cycle `index` at `level` in float arithmetic split into ordinal and fraction (model.js
    /// `cycleStartTime`); nil beyond the catalogue end, for a negative index or an unsupported level.
    public func cycleStartTime(level: Int, index: Int64) -> Double? {
        guard Fractonica.supportedLevels.contains(level) else { return nil }
        let p = infos[level].prefixDouble
        let n = Double(index) * 4
        let k = (n / p).rounded(.down)
        if k > Double(extent) { return nil }
        if k == Double(extent) { return n - k * p == 0 ? tMax : nil }
        guard k >= 0 else { return nil }
        let i = Int(k)
        let f = (n - k * p) / p
        return catalogue[i] + f * (catalogue[i + 1] - catalogue[i])
    }
}

/// Constants of the reference solar sync (SPEC §7.2): anchor ordinal 20, level 6, 19 cycles ≈ 4 days.
struct SolarSyncConstants: Sendable {
    static let anchor = 20
    static let level = 6
    static let cycles: Int128 = 19
    static let days: Int128 = 4
    static let daySeconds: Int128 = 86_400

    /// Level-6 cycle index of the anchor eclipse, A · P(L) / 4.
    let anchorCycle: Int128
    /// Anchor eclipse time, exact and as the model's double.
    let anchorTime: Ratio
    let anchorSeconds: Double
}

/// Where an instant sits at one level: `LevelReading`'s cycle, local and phase without the times.
struct CycleState: Sendable {
    let cycle: Int64
    let local: Int
    let phase: Double

    /// 0 … 3, the quarter the phase is in (computed from the rounded phase, as the web app does).
    var quarter: Int { min(3, Int((phase * 4).rounded(.down))) }
}

/// Key of the cycle facts cache.
struct FactsKey: Hashable, Sendable {
    let level: Int
    let cycle: Int64
}
