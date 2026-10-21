/// The values `FractonicaClock` returns. Each mirrors the object of the same role in `src/core/model.js`; times are
/// Unix seconds, levels zero-based (depth = level + 1).

/// Static facts about a level (model.js `levelInfo`).
public struct LevelInfo: Hashable, Sendable {
    public let level: Int
    public let depth: Int
    /// Period letter, its numeric suffix (empty in the first alphabet) and both together ("η", "", "η").
    public let letter: String
    public let suffix: String
    public let text: String
    /// Cycles of level + 1 inside one cycle of this level, S[L mod 8].
    public let factor: Int
    /// Cycles of this level inside one parent cycle, S[(L−1) mod 8]; nil at level 0, which has no parent.
    public let siblings: Int?
    /// P(L), exact (SPEC §3.1). A level-L cycle spans 4 / P(L) Saros.
    public let prefix: Int128
    /// P(L) as a double, the way the web app's float helpers use it.
    public let prefixDouble: Double
    /// Mean cycle length in seconds over the whole catalogue (for estimates only; real cycles vary per Saros).
    public let meanSeconds: Double
}

/// A quarter threshold of a cycle: `begin`, `peak`, `node`, `valley` or `end` (SPEC §6.2). `time` is nil for an
/// event past the catalogue's end, inside the clipped final cycle.
public struct Threshold: Hashable, Sendable {
    public let name: String
    public let time: Double?
}

/// Full reading of one level at an instant (model.js `levelAt`).
public struct LevelReading: Hashable, Sendable {
    public let level: Int
    public let depth: Int
    /// Period name, e.g. "η".
    public let name: String
    public let factor: Int
    /// Cycles of this level in the parent; for level 0 the number of Alpha cycles in the catalogue (18).
    public let siblings: Int
    /// Global cycle index at this level (SPEC §3.2).
    public let cycle: Int64
    /// Index inside the parent, 0-based (for level 0 the global index).
    public let local: Int
    /// 0 ..< 1 position within the cycle, linear in Saros position (exact, then rounded once).
    public let phase: Double
    /// 0 … 1 fraction between the cycle's start and end times, linear in time.
    public let progress: Double
    /// 0 … 3: index into `Fractonica.quarterNames`.
    public let quarter: Int
    /// Glyph state (SPEC §4): index 0 ..< 4M, its value, derivative (+1 rising, 0 at an extremum, −1 falling),
    /// the falling-branch dot, trits most significant first.
    public let index: Int
    public let value: Int
    public let derivative: Int
    public let dotted: Bool
    public let trits: [Int]
    public let states: Int
    public let strokes: Int
    /// The cycle's start and end times, its duration and whether the catalogue end clips it.
    public let start: Double
    public let end: Double
    public let duration: Double
    public let clipped: Bool
    /// Seconds until `end`.
    public let remaining: Double
    /// The next quarter threshold after the instant (peak, node, valley or end).
    public let next: Threshold
    /// The cycle's five events, begin … end.
    public let thresholds: [Threshold]
}

/// Odometer read-out (SPEC §5, model.js `odometerAt`): glyph indices, coarsest first, and when the finest next changes.
public struct OdometerReading: Hashable, Sendable {
    public let digits: [Int]
    /// States per glyph, 4M.
    public let states: Int
    /// Time of the finest digit's next change; nil past the catalogue end.
    public let nextTime: Double?
}

/// Solar sync reading (SPEC §7, model.js `solarAt`).
public struct SolarReading: Hashable, Sendable {
    /// Sync number counted from the anchor (negative before 1973-12-24).
    public let sync: Int
    public let start: Double
    public let end: Double
    /// Anchor time + sync · 4 days: where the sync would start on a pure civil-day grid.
    public let nominalStart: Double
    /// 0 ..< 1, linear in time.
    public let phase: Double
    /// start − nominalStart: accumulated seconds against civil days.
    public let drift: Double
    /// 0 … 3, and the threshold that ends that quarter.
    public let quarter: Int
    public let threshold: Threshold
    /// Phase as 3 two-stroke glyphs (16 states each) and as 2 three-stroke glyphs (52 states each).
    public let digits3: [Int]
    public let digits2x3: [Int]
    /// The instant precedes the anchor eclipse.
    public let beforeAnchor: Bool
}

/// One sync by number (model.js `solarSyncByNumber`).
public struct SolarSyncInfo: Hashable, Sendable {
    public let sync: Int
    public let start: Double
    public let end: Double
    public let nominalStart: Double
    public let drift: Double
}

/// Start, end and events of one cycle (model.js `cycleByIndex` / `cycleAt`).
public struct CycleFacts: Hashable, Sendable {
    public let level: Int
    public let cycle: Int64
    public let start: Double
    public let end: Double
    public let duration: Double
    public let clipped: Bool
    /// begin, peak, node, valley, end.
    public let events: [Threshold]
}

/// A cycle start inside a time window (model.js `boundaries`).
public struct Boundary: Hashable, Sendable {
    /// Global cycle index.
    public let idx: Int64
    /// Index inside the parent (global for level 0).
    public let local: Int
    public let time: Double
}

/// A moment where cycles of one or more levels end together (model.js `upcomingEnds`).
public struct UpcomingEnd: Hashable, Sendable {
    public let time: Double
    /// The coarsest level that rolls over; every finer listed level ends with it.
    public let top: Int
    public let levels: [Int]
}

/// One stretch of time during which an odometer shows a given state (model.js `stateOccurrences`).
public struct StateOccurrence: Hashable, Sendable {
    public let start: Double
    public let end: Double
    /// Cycle index of the level the state belongs to.
    public let cycle: Int64
}
