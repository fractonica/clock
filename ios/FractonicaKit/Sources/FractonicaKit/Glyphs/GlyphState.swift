/// A phase glyph state (SPEC §4, the library's `CBT.fromIndex(index, {depth: strokes})`).
///
/// A glyph of d strokes holds balanced-ternary values −M … M with M = (3^d − 1) / 2, and one cycle runs through its
/// 4M states: rising from 0 to the peak M, falling (dotted) through 0 to the valley −M, rising back to −1.
public struct GlyphState: Hashable, Sendable {
    /// State index 0 ..< 4M (any integer wraps).
    public let index: Int
    public let strokes: Int
    /// Balanced-ternary value −M … M.
    public let value: Int
    /// +1 rising, 0 at the peak or valley, −1 falling.
    public let derivative: Int
    /// The derivative dot: only on the falling branch, never at an extremum.
    public let dotted: Bool
    /// `strokes` balanced trits (−1, 0, +1), most significant first.
    public let trits: [Int]

    /// Stroke counts a glyph can have here; others are clamped into this range (the library allows 1 … 1024, far
    /// past anything drawable, and its values would leave `Int`).
    public static let strokeRange = 1...20

    /// The state at `index` (wrapped into 0 ..< 4M) for a glyph of `strokes` strokes (clamped to `strokeRange`).
    public static func of(index: Int, strokes: Int) -> GlyphState {
        if strokes >= 1 && strokes <= tables.count {
            let table = tables[strokes - 1]
            return table[floorMod(index, table.count)]
        }
        return make(index: index, strokes: clampStrokes(strokes))
    }

    /// Number of states of a glyph, 4M: 16 for two strokes, 52 for three (`strokes` clamped to `strokeRange`).
    public static func states(strokes: Int) -> Int { 4 * extreme(strokes: strokes) }

    /// M = (3^d − 1) / 2, the largest value a d-stroke glyph holds (d clamped to `strokeRange`).
    static func extreme(strokes: Int) -> Int {
        var p = 1
        for _ in 0..<clampStrokes(strokes) { p *= 3 }
        return (p - 1) / 2
    }

    static func clampStrokes(_ strokes: Int) -> Int {
        min(strokeRange.upperBound, max(strokeRange.lowerBound, strokes))
    }

    /// Every state of one- to four-stroke glyphs, built once: readings reuse these instead of allocating trits.
    private static let tables: [[GlyphState]] = (1...4).map { strokes in
        (0..<states(strokes: strokes)).map { make(index: $0, strokes: strokes) }
    }

    private static func make(index: Int, strokes: Int) -> GlyphState {
        let m = extreme(strokes: strokes)
        let k = floorMod(index, 4 * m)
        let value = k <= m ? k : k <= 3 * m ? 2 * m - k : k - 4 * m
        let derivative = k == m || k == 3 * m ? 0 : k < m || k > 3 * m ? 1 : -1
        return GlyphState(index: k, strokes: strokes, value: value, derivative: derivative, dotted: derivative == -1,
                          trits: balancedTrits(value, width: strokes))
    }

    /// The library's `toTrits`: balanced-ternary digits of `value`, padded to `width`, most significant first.
    static func balancedTrits(_ value: Int, width: Int) -> [Int] {
        var n = value
        var out: [Int] = []
        repeat {
            let d = floorMod(n + 1, 3) - 1
            out.append(d)
            n = (n - d) / 3
        } while n != 0
        while out.count < width { out.append(0) }
        return out.reversed()
    }
}
