import FractonicaKit
import Foundation

// The journal's wave, in the Wave screen's circular harmonic geometry (WaveGeometry: the library's arcs). Time runs
// down the screen, newest at the top, along a spine: the half-arcs of one level laid end to end down a vertical axis,
// each a regular circular arc whose chord is its stretch of time, crests bulging one way and troughs the other, so
// they join smoothly at the nodes. The next levels ride the spine the library's way, each half-arc a circle orthogonal to its
// parent (`WaveArc.child`): loops perpendicular to the curve they ride, nested level by level.
//
// The zoom is continuous. The spine is the level whose half-arcs, as semicircles of the wave's radius, would be at
// most `factor` times as long as the screen allows: as the zoom grows its arcs lengthen and open (sweep from 180° down
// to nearly straight, never wider than the radius), while its children's loops grow to semicircles of that radius. When
// the spine is straight its children are exactly the next spine at 180°, so the spine passes to them without a jump;
// each level's emphasis follows its depth below the spine continuously, so the picture cross-fades as it zooms.
//
// Pure geometry (no SwiftUI, no clock state of its own), checked by Timeline/Checks:
//   frame      the view: the time at the top edge and points per second
//   zoom       the spine level, how far through its band, its arcs' sweep, each level's weight
//   layout     a zoom on a frame: the spine arcs, their children, the point of any moment
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

// MARK: - The zoom

/// How the wave is arranged at a zoom: which level is the spine, how far through its band, how open its arcs are, and
/// how strongly each level shows.
struct JournalArcZoom: Equatable, Sendable {
    /// The spine level: its half-arcs are the regular arcs time runs down.
    let spine: Int
    /// 0 ..< 1 through the spine's band: at 0 its half-arcs are semicircles of `radius`, towards 1 they open into a
    /// straight line while its children grow into the next spine.
    let lambda: Double
    /// The sweep of the spine's arcs, radians (π … nearly 0).
    let sweep: Double
    /// The wave's radius: the spine's semicircles at the start of a band, the reach either side of the axis.
    let radius: Double
    /// Points per second.
    let k: Double
    /// Mean half-arc chord in points of the spine and the three levels under it.
    let chords: [Double]

    /// The levels the wave can show at this zoom, coarsest first.
    var levels: ClosedRange<Int> { spine...(spine + 3) }
    /// The finest level the wave is traced to: every emoji sits on its curve.
    var deepest: Int { spine + 3 }

    /// A level's mean half-arc chord, in points.
    func chord(_ level: Int) -> Double {
        let i = level - spine
        return i >= 0 && i < chords.count ? chords[i] : 0
    }

    /// Depth below the spine, continuous: the spine is at −λ, its children at 1 − λ, …
    func depth(_ level: Int) -> Double { Double(level - spine) - lambda }

    /// How strongly a level shows (0 … 1): by its depth, and faded out while its loops are too small to see.
    func weight(_ level: Int) -> Double {
        JournalArcs.depthOpacity(depth(level)) * JournalArcs.sizeFade(chord(level))
    }

    /// Its line width, by depth.
    func lineWidth(_ level: Int) -> Double { JournalArcs.depthWidth(depth(level)) }

    /// The levels worth drawing, coarsest first (a level too faint to see is not drawn: its tiny loops would cost
    /// the most to stroke).
    var drawn: [Int] { levels.filter { weight($0) > 0.03 } }
}

/// One half-arc of the wave as laid out: its level, its index in the level (crest even, trough odd) and its circle.
struct JournalArc: Equatable, Sendable {
    let level: Int
    let idx: Int64
    let arc: WaveArc
}

enum JournalArcs {
    /// The levels that can be the spine: α … λ.
    static let spines = 0...10
    /// The narrowest sweep a spine arc keeps (its radius stays finite).
    static let minSweep = 1e-4

    static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let u = min(1, max(0, (x - a) / (b - a)))
        return u * u * (3 - 2 * u)
    }

    /// The spine's sweep λ of the way through its band (m children per half-arc): π at 0, 0 at 1, chosen so the arc's
    /// bulge plus its children's loops stay within the radius: tan(θ/4) = (m^−λ − 1/m) / (1 − 1/m).
    static func sweep(lambda: Double, factor m: Int) -> Double {
        let m = Double(max(2, m))
        let l = min(1, max(0, lambda))
        let q = (pow(m, -l) - 1 / m) / (1 - 1 / m)
        return max(minSweep, 4 * atan(max(0, q)))
    }

    /// The zoom at k points per second for a wave of `radius`: the spine is the coarsest level whose children's
    /// semicircles would still be smaller than the radius (its own chord below `factor` diameters).
    static func zoom(k: Double, radius: Double, clock: FractonicaClock = .shared) -> JournalArcZoom {
        let c0 = 2 * max(1, radius)
        func chord(_ level: Int) -> Double { k * clock.levelInfo(level).meanSeconds / 2 }
        var spine = spines.upperBound
        for level in spines where chord(level + 1) < c0 {
            spine = level
            break
        }
        let m = clock.levelInfo(spine).factor
        let lambda = min(1, max(0, log(chord(spine) / c0) / log(Double(m))))
        return JournalArcZoom(spine: spine, lambda: lambda, sweep: sweep(lambda: lambda, factor: m), radius: radius, k: k,
                              chords: (0...3).map { chord(spine + $0) })
    }

    /// A level fades in as its half-arcs grow from 2 to 8 points.
    static func sizeFade(_ chord: Double) -> Double { smoothstep(2, 8, chord) }

    /// A level's opacity by its depth below the spine: the spine full, its children a little over half, the
    /// grandchildren a quarter, nothing at depth 3; a spine opening into a straight line fades into the axis.
    static func depthOpacity(_ d: Double) -> Double {
        switch d {
        case ..<(-1): 0
        case ..<0: 1 - d * d
        case ..<1: 1 - 0.45 * d
        case ..<2: 0.55 - 0.3 * (d - 1)
        case ..<3: 0.25 * (3 - d)
        default: 0
        }
    }

    static func depthWidth(_ d: Double) -> Double {
        switch d {
        case ..<0: 2.4
        case ..<1: 2.4 - 0.9 * d
        case ..<2: 1.5 - 0.4 * (d - 1)
        default: max(0.8, 1.1 - 0.2 * (d - 2))
        }
    }

    /// A spine half-arc: the regular arc of `sweep` over the chord on the axis x0 from height y0 (its start, the earlier
    /// moment, lower on the screen) to y1, a crest turning one way (positive sweep, as the library's) and a trough the
    /// other. Moving up the screen a crest bulges left and a trough right.
    static func spineArc(from y0: Double, to y1: Double, x0: Double, sweep: Double, crest: Bool) -> WaveArc {
        let c = abs(y1 - y0)
        let dir: Double = y1 >= y0 ? 1 : -1
        let half = max(minSweep, min(Double.pi, sweep)) / 2
        let r = c / (2 * sin(half))
        let off = r * cos(half)
        // the centre sits off the chord's middle along its normal, on the side the arc turns towards
        let nx = crest ? -dir : dir
        let cx = x0 + nx * off, cy = (y0 + y1) / 2
        return WaveArc(cx: cx, cy: cy, radius: r, start: atan2(y0 - cy, x0 - cx), sweep: crest ? 2 * half : -2 * half)
    }

    // MARK: Cycle starts

    /// A cycle start in view: the margin labels and the hairlines.
    struct Tick: Equatable, Sendable {
        let level: Int
        let cycle: Int64
        let time: Double
    }

    /// The cycle starts of a level between positions p0 and p1, latest first (at most `limit`).
    static func ticks(level: Int, from p0: Double, to p1: Double, clock: FractonicaClock = .shared, limit: Int = 200) -> [Tick] {
        let q = clock.levelInfo(level).prefixDouble / 4
        let i0 = Int64((p0 * q).rounded(.up))
        let i1 = Int64((p1 * q).rounded(.down))
        guard i1 >= i0, i1 - i0 < Int64(limit) else { return [] }
        return stride(from: i1, through: i0, by: -1).map { i in
            Tick(level: level, cycle: i, time: clock.time(atPosition: Double(i) / q))
        }
    }

    /// The level whose cycles frame the view (hairlines across with the cycle's name): the coarsest level, no finer
    /// than the spine (its starts lie on the axis), whose cycles are at most 1.6 screens long.
    static func frameLevel(_ zoom: JournalArcZoom, height: Double, clock: FractonicaClock = .shared) -> Int? {
        (max(0, zoom.spine - 3)...zoom.spine).first { clock.levelInfo($0).meanSeconds * zoom.k <= 1.6 * height }
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

// MARK: - The layout

/// A zoom laid out on a frame: the spine down the axis x0 (y from `y`, a frame's or a cache's), its children, and the
/// point of any moment on the wave.
struct JournalArcLayout {
    let zoom: JournalArcZoom
    let x0: Double
    let clock: FractonicaClock
    /// A moment's height on the axis.
    let y: (Double) -> Double

    init(zoom: JournalArcZoom, x0: Double, clock: FractonicaClock = .shared, y: @escaping (Double) -> Double) {
        self.zoom = zoom
        self.x0 = x0
        self.clock = clock
        self.y = y
    }

    private func prefix(_ level: Int) -> Double { clock.levelInfo(level).prefixDouble }
    private func factor(_ level: Int) -> Int { clock.levelInfo(level).factor }

    /// The time of a catalogue position; past the end, carried on at the last interval's pace (the clipped last arcs
    /// keep their shape).
    private func time(_ p: Double) -> Double {
        let n = Double(clock.extent)
        guard p > n else { return clock.time(atPosition: p) }
        let last = clock.tMax - clock.time(atPosition: n - 1)
        return clock.tMax + (p - n) * last
    }

    /// The spine half-arc `h`, nil outside the catalogue.
    func spine(_ h: Int64) -> WaveArc? {
        let pp = prefix(zoom.spine)
        let p0 = 2 * Double(h) / pp
        guard h >= 0, p0 < Double(clock.extent) else { return nil }
        let p1 = 2 * Double(h + 1) / pp
        return JournalArcs.spineArc(from: y(time(p0)), to: y(time(p1)), x0: x0, sweep: zoom.sweep, crest: h % 2 == 0)
    }

    /// The spine half-arc and progress through it at a moment.
    func spineHalf(at t: Double) -> (idx: Int64, local: Double)? {
        guard let p = clock.position(at: t) else { return nil }
        let q = p * prefix(zoom.spine) / 2
        let idx = Int64(q.rounded(.down))
        return (idx, q - Double(idx))
    }

    /// The chain of half-arcs holding a moment, from the spine down to `level` (the deepest by default), each with the
    /// progress through it.
    func trace(_ t: Double, through level: Int? = nil) -> [(arc: JournalArc, local: Double)] {
        guard let s = spineHalf(at: t), let a = spine(s.idx) else { return [] }
        let last = max(zoom.spine, level ?? zoom.deepest)
        var chain = [(arc: JournalArc(level: zoom.spine, idx: s.idx, arc: a), local: s.local)]
        var cur = (idx: s.idx, local: s.local, arc: a)
        var l = zoom.spine
        while l < last {
            let m = factor(l)
            let c = WaveGeometry.childOf(idx: cur.idx, local: cur.local, m: m)
            let arc = cur.arc.child(m: m, local: c.j, index: c.idx)
            cur = (c.idx, c.local, arc)
            l += 1
            chain.append((JournalArc(level: l, idx: c.idx, arc: arc), c.local))
        }
        return chain
    }

    /// The point of a moment on the wave traced to `level` (the deepest by default): where its emoji sits.
    func point(_ t: Double, through level: Int? = nil) -> JournalWavePoint? {
        guard let last = trace(t, through: level).last else { return nil }
        let p = last.arc.arc.point(last.local)
        return JournalWavePoint(x: p.x, y: p.y)
    }

    /// The half-arcs of levels spine … `through` between moments t0 < t1 whose loops reach heights `yRange`, per level
    /// coarsest first (at most `limit` per level).
    func arcs(from t0: Double, to t1: Double, through last: Int, yRange: ClosedRange<Double>, limit: Int = 12_000) -> [[JournalArc]] {
        let last = min(max(last, zoom.spine), zoom.deepest)
        guard t1 > t0, let a = spineHalf(at: max(clock.tMin, t0)), let b = spineHalf(at: min(clock.tMax, t1)) else { return [] }
        let lo = min(a.idx, b.idx), hi = max(a.idx, b.idx)
        guard hi - lo < 2000 else { return [] }
        var out: [[JournalArc]] = [[]]
        for h in lo...hi {
            if let arc = spine(h) { out[0].append(JournalArc(level: zoom.spine, idx: h, arc: arc)) }
        }
        var l = zoom.spine
        while l < last {
            let m = factor(l)
            var next: [JournalArc] = []
            next.reserveCapacity(min(limit, out[out.count - 1].count * m))
            outer: for parent in out[out.count - 1] {
                for j in 0..<m {
                    let idx = parent.idx * Int64(m) + Int64(j)
                    let c = parent.arc.child(m: m, local: j, index: idx)
                    // its loop and everything riding it stay within about two radii of its centre
                    if c.cy + 2 * c.radius < yRange.lowerBound || c.cy - 2 * c.radius > yRange.upperBound { continue }
                    next.append(JournalArc(level: l + 1, idx: idx, arc: c))
                    if next.count >= limit { break outer }
                }
            }
            out.append(next)
            l += 1
        }
        return out
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
    /// Wave points come nearly in height order; `slack` is how far a later one may lie above an earlier one (a loop
    /// turning back), so the search looks that much further.
    static func place(_ pins: [JournalWavePin], size: Double, gap: Double, xRange: ClosedRange<Double>, slack: Double = 0,
                      point: (Double) -> JournalWavePoint?) -> [JournalWaveBadge] {
        let d = size + gap
        let lo = xRange.lowerBound + size / 2
        let hi = max(lo, xRange.upperBound - size / 2)
        var badges: [JournalWaveBadge] = []
        for pin in pins {
            guard let a = point(pin.time) else { continue }
            let candidates = [a.x, a.x + d, a.x - d].map { min(hi, max(lo, $0)) }
            var spot: Double?
            for c in candidates where isFree(c, a.y, badges, d, slack) {
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
            while j >= 0, a.y - badges[j].y < d + slack {
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

    private static func isFree(_ x: Double, _ y: Double, _ badges: [JournalWaveBadge], _ d: Double, _ slack: Double) -> Bool {
        var j = badges.count - 1
        // badges come (nearly) in y order: only the last few can be within reach
        while j >= 0, y - badges[j].y < d + slack {
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
