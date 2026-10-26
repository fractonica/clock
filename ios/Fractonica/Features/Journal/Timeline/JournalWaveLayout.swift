import FractonicaKit
import Foundation

// The journal's wave: time runs down the screen (newest at the top), and the clock's levels are drawn along it as
// nested harmonic waves — each cycle a crest and a trough, each half-cycle a semicircle (the library's half-arc,
// flattened into a half-ellipse when its circle would not fit), each level riding the coarser one's curve. Only the
// levels whose cycles are readable at the zoom show: a level fades in as its cycles grow past a few dozen points and
// out once one cycle is several screens long. Each entry's emoji sits on the wave at its exact moment.
//
// Pure geometry (no SwiftUI, no clock state of its own), checked by Timeline/Checks:
//   frame      the view: the time at the top edge and points per second
//   strand     one level as drawn: its weight (fade), amplitude and cycles per catalogue position
//   badge      an emoji (or a cluster of them) placed on the wave, with the wave point it stands for

/// A point in the wave's view, y down.
struct JournalWavePoint: Equatable, Sendable {
    var x: Double
    var y: Double
}

/// What the wave view shows: the time at its top edge and how many points one second takes. Later times are higher.
struct JournalWaveFrame: Equatable, Sendable {
    var top: Double
    var k: Double

    func y(_ t: Double) -> Double { (top - t) * k }
    func t(_ y: Double) -> Double { top - y / k }
    /// The seconds a height shows.
    func span(_ height: Double) -> Double { height / k }
}

/// How far the wave may zoom and scroll: from about two Preons to about two Betas on the screen, within the catalogue
/// and not far past the journal's newest and oldest moments.
struct JournalWaveLimits: Equatable, Sendable {
    var kMin: Double
    var kMax: Double
    /// The latest and earliest moments to keep in reach (the newest entry or now; the oldest entry).
    var newest: Double
    var oldest: Double
    var tMin: Double
    var tMax: Double

    /// Preons (ι, level 8) on the screen at the closest zoom, Betas (β, level 1) at the widest.
    static let closest = 2.0
    static let widest = 2.2

    init(height: Double, newest: Double, oldest: Double, clock: FractonicaClock = .shared) {
        let h = max(120, height)
        kMax = h / (Self.closest * clock.levelInfo(8).meanSeconds)
        kMin = h / (Self.widest * clock.levelInfo(1).meanSeconds)
        self.newest = newest
        self.oldest = min(oldest, newest)
        tMin = clock.tMin
        tMax = clock.tMax
    }

    func clampK(_ k: Double) -> Double { min(kMax, max(kMin, k)) }

    /// The frame kept in reach: the newest moment no lower than a quarter of the screen below the top edge… unless the
    /// journal is shorter than the screen, when the newest stays near the top.
    func clamp(_ f: JournalWaveFrame, height h: Double) -> JournalWaveFrame {
        let k = clampK(f.k)
        let span = h / k
        let hiTop = min(tMax + 0.05 * span, newest + 0.25 * span)
        let loTop = max(tMin + 0.95 * span, oldest + 0.75 * span)
        var top = f.top
        if top < loTop { top = loTop }
        if top > hiTop { top = hiTop }
        return JournalWaveFrame(top: top, k: k)
    }

    /// Zoom by `factor` (> 1 closer) keeping the moment at height y where it is.
    func zoom(_ f: JournalWaveFrame, by factor: Double, aboutY y: Double, height h: Double) -> JournalWaveFrame {
        let anchor = f.t(y)
        let k = clampK(f.k * factor)
        return clamp(JournalWaveFrame(top: anchor + y / k, k: k), height: h)
    }

    /// Move the content down by dy points (dragging down shows later moments).
    func pan(_ f: JournalWaveFrame, by dy: Double, height h: Double) -> JournalWaveFrame {
        clamp(JournalWaveFrame(top: f.top + dy / f.k, k: f.k), height: h)
    }

    /// The frame with `k` that puts time t at height y.
    func frame(showing t: Double, atY y: Double, k: Double, height h: Double) -> JournalWaveFrame {
        let k = clampK(k)
        return clamp(JournalWaveFrame(top: t + y / k, k: k), height: h)
    }
}

/// One level as the wave draws it.
struct JournalWaveStrand: Equatable, Sendable {
    let level: Int
    /// 0 … 1: how far it has faded in (by its cycles' size on screen).
    let weight: Double
    /// The half-width of its half-arcs, in points (0 when faded out).
    let amplitude: Double
    /// Its cycles per catalogue position: P(L) / 4 (a level-L cycle spans 4 / P(L) Saros).
    let perPosition: Double
    /// One mean cycle in points.
    let cyclePoints: Double
}

enum JournalWave {
    /// The levels the wave can draw: α … λ.
    static let levels = 0...10
    /// A level fades in while its mean cycle grows from `fadeIn.lowerBound` to `fadeIn.upperBound` points, and out
    /// while it grows from `fadeOut` screens to 2.6 times as many.
    static let fadeIn = 16.0...36.0
    static let fadeOut = 3.0

    static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let u = min(1, max(0, (x - a) / (b - a)))
        return u * u * (3 - 2 * u)
    }

    /// The strands at zoom k on a view `height` tall whose wave may swing `half` points either side of its axis,
    /// coarsest first. A strand's half-arcs are semicircles (radius a quarter of a cycle) while they fit; coarser ones
    /// get wider caps, so every level swings wider than the ones riding it, and the sum stays inside `half`.
    static func strands(k: Double, height: Double, half: Double, clock: FractonicaClock = .shared) -> [JournalWaveStrand] {
        var out: [(level: Int, weight: Double, amp: Double, per: Double, c: Double)] = []
        for level in levels {
            let info = clock.levelInfo(level)
            let c = info.meanSeconds * k
            let wIn = smoothstep(log(fadeIn.lowerBound), log(fadeIn.upperBound), log(c))
            let wOut = 1 - smoothstep(log(fadeOut * height), log(fadeOut * 2.6 * height), log(c))
            let w = wIn * wOut
            guard w > 0.001 else { continue }
            let cap = half * 0.62 * c / (c + 0.5 * height)
            out.append((level, w, w * min(c / 4, cap), info.prefixDouble / 4, c))
        }
        let total = out.reduce(0) { $0 + $1.amp }
        let scale = total > 0.94 * half ? 0.94 * half / total : 1
        return out.map { JournalWaveStrand(level: $0.level, weight: $0.weight, amplitude: $0.amp * scale, perPosition: $0.per, cyclePoints: $0.c) }
    }

    /// The half-arc profile at cycle phase φ (0 ..< 1): a semicircle out (+) over the first half, the crest, peaking at
    /// φ = ¼ (the Peak), back on the axis at ½ (the Node), in (−) over the trough down to ¾ (the Valley), home at 1.
    static func profile(_ phase: Double) -> Double {
        let f = phase - phase.rounded(.down)
        let u = f < 0.5 ? 2 * f : 2 * f - 1
        let r = 2 * (max(0, u * (1 - u))).squareRoot()
        return f < 0.5 ? r : -r
    }

    /// The wave's offset from its axis at catalogue position p, summed over strands[0 ... last].
    static func offset(_ p: Double, _ strands: [JournalWaveStrand], through last: Int) -> Double {
        var x = 0.0
        var i = 0
        while i <= last, i < strands.count {
            let s = strands[i]
            if s.amplitude > 0 { x += s.amplitude * profile(p * s.perPosition) }
            i += 1
        }
        return x
    }

    /// The points of the wave through strands[0 ... last] between positions p0 < p1, in time order from p1 down to p0
    /// (top to bottom on screen). Each half-arc of the finest strand is sampled by angle — densely where it turns at
    /// its ends — so circles stay round; y comes from `y` (a frame's or a cache's), x from the axis `x0`.
    static func line(_ strands: [JournalWaveStrand], through last: Int, from p0: Double, to p1: Double, x0: Double,
                     clock: FractonicaClock = .shared, y: (Double) -> Double) -> [JournalWavePoint] {
        guard last >= 0, last < strands.count, p1 > p0 else { return [] }
        let fine = strands[last]
        let halves = 2 * fine.perPosition
        let h0 = Int64((p0 * halves).rounded(.down))
        let h1 = Int64((p1 * halves).rounded(.up))
        guard h1 - h0 < 20_000 else { return [] }
        // samples per half-arc: about one per 2.5 points of its chord, 10 … 40
        let chord = fine.cyclePoints / 2
        let n = Int(min(40, max(10, (chord / 2.5).rounded())))
        var points: [JournalWavePoint] = []
        points.reserveCapacity(Int(h1 - h0) * n + 1)
        var h = h1
        var done = false
        while h > h0, !done {
            let pb = Double(h) / halves
            let pa = Double(h - 1) / halves
            // from the half-arc's end (later, higher) to its start
            for i in (h == h1 ? 0 : 1)...n {
                let u = (1 + cos(Double.pi * Double(i) / Double(n))) / 2
                var p = pa + (pb - pa) * u
                if p > p1 { continue }
                if p <= p0 {
                    p = p0
                    done = true
                }
                let t = clock.time(atPosition: p)
                points.append(JournalWavePoint(x: x0 + offset(p, strands, through: last), y: y(t)))
                if done { break }
            }
            h -= 1
        }
        return points
    }

    // MARK: Cycle starts

    /// A cycle start in view: the margin labels and the hairlines.
    struct Tick: Equatable, Sendable {
        let level: Int
        let cycle: Int64
        let time: Double
    }

    /// The cycle starts of a strand between positions p0 and p1, latest first (at most `limit`).
    static func ticks(_ strand: JournalWaveStrand, from p0: Double, to p1: Double, clock: FractonicaClock = .shared, limit: Int = 200) -> [Tick] {
        let q = strand.perPosition
        let i0 = Int64((p0 * q).rounded(.up))
        let i1 = Int64((p1 * q).rounded(.down))
        guard i1 >= i0, i1 - i0 < Int64(limit) else { return [] }
        return stride(from: i1, through: i0, by: -1).map { i in
            Tick(level: strand.level, cycle: i, time: clock.time(atPosition: Double(i) / q))
        }
    }

    /// The level whose cycles frame the view (hairlines across with the cycle's name): the coarsest strand that is
    /// fully in and whose cycles are at most 1.6 screens long, so a boundary is usually in sight.
    static func frameLevel(_ strands: [JournalWaveStrand], height: Double) -> JournalWaveStrand? {
        strands.first { $0.weight > 0.6 && $0.cyclePoints <= 1.6 * height }
    }

    /// An Earth label for a cycle start of `level` (not for pure mode): "Mar 2026" for β and γ, "8 Oct 2026" for δ and
    /// ε, "Thu 8 Oct 14:20" for ζ and η, "14:20" finer.
    static func earthTick(_ t: Double, level: Int, earth: EarthFormatter) -> String {
        let p = earth.parts(t)
        let month = EarthTime.monthsShort[p.month - 1]
        switch level {
        case ...2: return "\(month) \(p.year)"
        case 3...4: return "\(p.day) \(month) \(p.year)"
        case 5...6: return "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(month) \(earth.time(t, seconds: false))"
        default: return earth.time(t, seconds: false)
        }
    }
}

// MARK: - Emoji on the wave

/// An entry to place: its id, its moment and the symbol it shows (its emoji, or a stand-in for its content).
struct JournalWavePin: Equatable, Sendable {
    let id: String
    let time: Double
    let symbol: String
}

/// An emoji on the wave: where it is drawn, the wave point of its moment, and the entries it stands for (more than
/// one when they lie too close together to show apart: a cluster with a count, opened by zooming in).
struct JournalWaveBadge: Equatable, Sendable {
    var x: Double
    var y: Double
    /// The exact point on the wave of the first entry's moment (the badge may sit beside it, joined by a tether).
    var anchor: JournalWavePoint
    /// Newest first.
    var ids: [String]
    var times: [Double]
    var symbol: String

    var isCluster: Bool { ids.count > 1 }
    var isOffset: Bool { abs(x - anchor.x) > 0.5 || abs(y - anchor.y) > 0.5 }
}

enum JournalWavePlacer {
    /// Places pins (newest first, so top to bottom) on the wave. Each takes the first free spot of: on its wave point,
    /// a badge's width to the right, to the left (inside `xRange`); a spot is free when no badge placed so far lies
    /// within `size + gap` of it. A pin with no free spot joins the nearest badge in its way, which becomes a cluster.
    static func place(_ pins: [JournalWavePin], size: Double, gap: Double, xRange: ClosedRange<Double>,
                      point: (Double) -> JournalWavePoint) -> [JournalWaveBadge] {
        let d = size + gap
        let lo = xRange.lowerBound + size / 2
        let hi = max(lo, xRange.upperBound - size / 2)
        var badges: [JournalWaveBadge] = []
        for pin in pins {
            let a = point(pin.time)
            let candidates = [a.x, a.x + d, a.x - d].map { min(hi, max(lo, $0)) }
            var spot: Double?
            for c in candidates where isFree(c, a.y, badges, d) {
                spot = c
                break
            }
            if let spot {
                badges.append(JournalWaveBadge(x: spot, y: a.y, anchor: a, ids: [pin.id], times: [pin.time], symbol: pin.symbol))
                continue
            }
            // no room: join the nearest badge in the way
            var best = badges.count - 1
            var bestD = Double.infinity
            var j = badges.count - 1
            while j >= 0, a.y - badges[j].y < d {
                let dist = hypot(badges[j].x - a.x, badges[j].y - a.y)
                if dist < bestD {
                    bestD = dist
                    best = j
                }
                j -= 1
            }
            if best >= 0 {
                badges[best].ids.append(pin.id)
                badges[best].times.append(pin.time)
            }
        }
        return badges
    }

    private static func isFree(_ x: Double, _ y: Double, _ badges: [JournalWaveBadge], _ d: Double) -> Bool {
        var j = badges.count - 1
        // badges come in y order: only the last few can be within reach
        while j >= 0, y - badges[j].y < d {
            if hypot(badges[j].x - x, badges[j].y - y) < d - 1e-9 { return false }
            j -= 1
        }
        return true
    }

    /// The badge under a point (within its radius plus `slop`), the nearest when several are.
    static func hit(_ badges: [JournalWaveBadge], x: Double, y: Double, radius: Double) -> JournalWaveBadge? {
        var best: JournalWaveBadge?
        var bestD = Double.infinity
        for b in badges {
            let dist = hypot(b.x - x, b.y - y)
            if dist <= radius, dist < bestD {
                bestD = dist
                best = b
            }
        }
        return best
    }

    /// How close to zoom so a cluster's entries come apart: the k at which its two closest moments lie `size + gap`
    /// apart, a little more; nil when they are closer than the closest zoom can separate.
    static func separatingK(_ badge: JournalWaveBadge, size: Double, gap: Double, kMax: Double) -> Double? {
        let times = badge.times.sorted()
        guard times.count > 1 else { return nil }
        var dt = Double.infinity
        for i in 1..<times.count { dt = min(dt, times[i] - times[i - 1]) }
        // fanned out beside the wave, neighbours need about half a badge of height each
        let need = (size + gap) * 1.1 / max(dt, 1e-6) / 2
        return need <= kMax ? need : nil
    }
}
