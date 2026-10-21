/// Exact times and positions: how a `Double` query becomes the rational the library computes with, and back.

/// A query instant as model.js sees it.
///
/// `seconds` is the double the model computes with (rounded to 1 ms, or the EDGE instant `tMax − 0.001`); `ms` is
/// the exact whole-millisecond time the library receives. model.js hands the library `R(String(ms(t)))`, and a time
/// rounded to whole milliseconds prints as exactly that decimal (a double nearest to a decimal of at most 15
/// significant digits prints back as that decimal), so every exact position starts from integer milliseconds, even
/// at the EDGE instant, which the model rounds once more on its way to the library.
struct QueryTime: Sendable {
    let seconds: Double
    let ms: Int64

    /// `seconds` as the model holds it; the library's millisecond instant is `Math.round(seconds · 1000)`.
    /// Only for times inside the catalogue (the conversion to `Int64` would trap far outside it).
    init(seconds: Double) {
        self.seconds = seconds
        ms = Int64(JSNumber.round(seconds * 1000))
    }

    var ratio: Ratio { Ratio(Int128(ms), 1000) }
}

/// A catalogue position n / d in lowest terms (Saros units, 0 … extent).
struct ExactPosition: Sendable {
    let n: Int64
    let d: Int64

    /// Index of the cycle holding this position at a level with prefix P: floor(n · P / 4d).
    func cycle(prefix: Int128) -> Int128 { Int128(n) * prefix / (4 * Int128(d)) }
}

extension FractonicaClock {
    /// model.js `ms(t)` and the catalogue check; `clampEdge` adds levelAt / odometerAt's EDGE rule.
    func query(_ t: Double, clampEdge: Bool) -> QueryTime? {
        let seconds = JSNumber.round(t * 1000) / 1000
        guard seconds >= tMin && seconds <= tMax else { return nil }
        if clampEdge && seconds > tMax - Self.edgeSeconds { return edge }
        return QueryTime(seconds: seconds)
    }

    /// The library's `positionAt`: k + (t − E[k]) / (E[k+1] − E[k]) with E[k] ≤ t (k = extent − 1 at the end).
    func exactPosition(_ q: QueryTime) -> ExactPosition {
        var lo = 0, hi = extent
        while lo + 1 < hi {
            let m = (lo + hi) >> 1
            if catalogueMs[m] <= q.ms { lo = m } else { hi = m }
        }
        let d = intervalsMs[lo]
        let n = Int64(lo) * d + (q.ms - catalogueMs[lo])
        let g = Int64(gcd(n.magnitude, d.magnitude))
        return ExactPosition(n: n / g, d: d / g)
    }

    /// The largest position denominator `timestamp(at:)` takes. With |E[k]| < 2^45 ms and intervals < 2^40 ms the
    /// interpolation's products then stay below 2^126; the clock's own positions (cycle starts, quarter events,
    /// odometer steps of any display) have denominators far below it.
    static let maxExactDenominator: Int128 = 1 << 80

    /// The library's `timestampAt`: the exact time of a position in [0, extent], or nil outside. The denominator must
    /// not exceed `maxExactDenominator`.
    func timestamp(at p: Ratio) -> Ratio? {
        let a = p.numerator, b = p.denominator
        guard a >= 0, a <= Int128(extent) * b else { return nil }
        let k = Int(min(a / b, Int128(extent - 1)))
        // E[k] + (E[k+1] − E[k]) · (p − k), in milliseconds over b.
        let ms = Int128(catalogueMs[k]) * b + Int128(intervalsMs[k]) * (a - Int128(k) * b)
        return Ratio(ms, 1000 * b)
    }

    /// Whether a position lies at or before the catalogue end.
    func withinExtent(_ p: Ratio) -> Bool {
        p.numerator <= Int128(extent) * p.denominator
    }
}
