import FractonicaKit
import Foundation

// The wave's scenes (src/ui/wave/scene.js) over the library's circular harmonic geometry (fractonica.js `child`,
// `arc` with `relativeTo`). Pure: FractonicaKit and plain numbers, no SwiftUI, checked against the JavaScript.
//
// Work is bounded: a focus scene holds its half-arc, at most `factor` children (≤ 13) and `factor · factor′`
// grandchildren (≤ 143) plus four ancestors; the catalogue overview holds the 35 α arcs and their β and γ loops
// (about 2.5k arcs, built once).
//
// Frames. A focus scene lives in the frame of its own half-arc (centre 0,0, radius 1: the library's `relativeTo`
// rebasing, which keeps the maths precise at any depth). Each frame is related to the frame of its α ancestor by a
// translate + uniform scale `toAlpha` (p_α = (x, y) + k · p), which is what lets the stage zoom smoothly between depths.

/// Where navigation lands after a half-arc start (seconds), so the reading is inside it.
let waveLand = 0.001
/// The deepest level a marker is ever drawn for (focus ξ + its grandchildren).
let waveDeepest = 15

/// Time facts of a half-arc; `end` is clipped at the catalogue's end.
struct WaveSpan: Equatable, Sendable {
    var start: Double
    var end: Double
    var duration: Double
    /// The part of the nominal half-arc inside the catalogue (the last arcs are clipped).
    var fraction: Double
    var clipped: Bool
}

/// Everything a label or tooltip says about a half-arc (scene.js `describe`).
///
/// Two numberings of one thing live here and must never be confused:
///   `n` / `of`              the half-arc among the half-arcs of its parent HALF-ARC (the loop number the picture
///                           shows, signed: +3 crest, −2 trough); `of` = factor(level − 1)
///   `cycleN` / `cycleOf`    the CYCLE it is half of, among the cycles of its parent CYCLE: the "6 / 11" every other
///                           screen shows. A cycle is two half-arcs, so its halves can sit in different parent half-arcs.
struct WaveHalfInfo: Equatable, Sendable {
    var level: Int
    var idx: Int64
    var letter: String
    var parent: String?
    var depth: Int
    var crest: Bool
    var n: Int
    var of: Int
    var cycle: Int64
    var cycleN: Int
    var cycleOf: Int
    var span: WaveSpan

    var signed: String { (crest ? "+" : "−") + String(n) }
    /// "first" / "second" half of its cycle.
    var half: String { crest ? "first" : "second" }
    /// The apex of the half-arc: "peak" (crest) or "valley" (trough).
    var apex: String { crest ? "peak" : "valley" }
    /// The event names at its start, middle and end.
    var marks: [String] { crest ? ["begin", "peak", "node"] : ["node", "valley", "end"] }
    var start: Double { span.start }
    var end: Double { span.end }
    var duration: Double { span.duration }
    var fraction: Double { span.fraction }
    var clipped: Bool { span.clipped }
}

/// Where a step button goes: a time, or nowhere because the catalogue ends.
enum WaveStepTarget: Equatable, Sendable {
    case time(Double)
    case edge(WaveEdge)
}

/// An end of the catalogue.
enum WaveEdge: Equatable, Sendable { case start, end }

/// A child (or grandchild) half-arc of a focus scene.
struct WaveLoop: Sendable {
    var level: Int
    var idx: Int64
    /// Its place among its parent's children, 0-based.
    var j: Int
    /// The grandchild's place among the child's children (−1 for a child).
    var k: Int
    var arc: WaveArc
    var fraction: Double
}

/// An ancestor of a focus scene, seen from the focus frame.
struct WaveAncestor: Sendable {
    var level: Int
    var idx: Int64
    /// Which of its children holds the focus (0-based), out of `slotM`.
    var slotJ: Int
    var slotM: Int
    var fraction: Double
    var arc: WaveArc
}

/// One marker per level: the point of the level's half-arc at its progress.
struct WaveMarker: Sendable {
    var level: Int
    var idx: Int64
    var local: Double
    var arc: WaveArc
    var x: Double
    var y: Double
}

/// The scene focused on one half-arc: the arc, its children and grandchildren, its closest ancestors.
final class WaveFocusScene {
    let level: Int
    let idx: Int64
    /// Its α ancestor.
    let r0: Int64
    let focus: WaveArc
    let fraction: Double
    let children: [WaveLoop]
    let grand: [WaveLoop]
    /// Parent first.
    let ancestors: [WaveAncestor]
    /// World points (flat x, y) the camera fits: the focus, children and grandchildren.
    let samples: [Double]
    let rot: Double
    let toAlpha: WaveFrameMap
    let info: WaveHalfInfo
    /// Arcs below the grandchildren, which only change when their half-arc does.
    var deep: [WaveDeepKey: WaveArc] = [:]

    init(level: Int, idx: Int64, r0: Int64, focus: WaveArc, fraction: Double, children: [WaveLoop], grand: [WaveLoop],
         ancestors: [WaveAncestor], samples: [Double], rot: Double, toAlpha: WaveFrameMap, info: WaveHalfInfo) {
        self.level = level
        self.idx = idx
        self.r0 = r0
        self.focus = focus
        self.fraction = fraction
        self.children = children
        self.grand = grand
        self.ancestors = ancestors
        self.samples = samples
        self.rot = rot
        self.toAlpha = toAlpha
        self.info = info
    }
}

struct WaveDeepKey: Hashable, Sendable {
    var level: Int
    var idx: Int64
}

/// An arc of the catalogue overview, shifted to its row.
struct WaveOverviewArc: Sendable {
    var level: Int
    var idx: Int64
    var r0: Int64
    var fraction: Double
    var row: Int
    var col: Int
    var arc: WaveArc
}

/// The whole Saros 141 wave: the α arcs wrapped into rows, with their β and γ loops.
final class WaveOverviewScene {
    let layout: WaveRowLayout
    /// Arcs of levels 0, 1 and 2.
    let levels: [[WaveOverviewArc]]

    init(layout: WaveRowLayout, levels: [[WaveOverviewArc]]) {
        self.layout = layout
        self.levels = levels
    }
}

/// A scene on the stage.
enum WaveScene {
    case focus(WaveFocusScene)
    case overview(WaveOverviewScene)

    var key: String {
        switch self {
        case .focus(let s): "\(s.level):\(s.idx)"
        case .overview: "O"
        }
    }

    var focus: WaveFocusScene? {
        if case .focus(let s) = self { return s }
        return nil
    }

    var overview: WaveOverviewScene? {
        if case .overview(let s) = self { return s }
        return nil
    }

    /// How two scenes' frames relate (p_to = (x, y) + k · p_from), or nil when they share no α ancestor.
    static func relate(_ from: WaveScene, _ to: WaveScene) -> WaveFrameMap? {
        let r0: Int64
        switch (from, to) {
        case (.overview, .overview): return nil
        case (.focus(let a), .focus(let b)):
            guard a.r0 == b.r0 else { return nil }
            r0 = a.r0
        case (.focus(let a), _): r0 = a.r0
        case (_, .focus(let b)): r0 = b.r0
        }
        func toAlpha(_ s: WaveScene) -> WaveFrameMap {
            switch s {
            case .focus(let f): return f.toAlpha
            case .overview(let o):
                let a = o.levels[0][Int(r0)].arc
                return WaveFrameMap(x: -a.cx, y: -a.cy, k: 1)
            }
        }
        let a = toAlpha(from)
        let b = toAlpha(to)
        return WaveFrameMap(x: (a.x - b.x) / b.k, y: (a.y - b.y) / b.k, k: a.k / b.k)
    }
}

/// The wave's engine: the library geometry and the time facts of half-arcs for one clock.
final class WaveEngine {
    let clock: FractonicaClock
    let extent: Int
    /// Per level 0…20: factor, prefix number (as the web's `prefixNum`), number of half-arcs.
    private let factors: [Int]
    private let prefixes: [Double]
    private let halfCounts: [Int64]
    private let exactPrefixes: [Int128]
    private var overviewCache: [[WaveOverviewArc]]?

    init(clock: FractonicaClock = .shared) {
        self.clock = clock
        extent = clock.extent
        let levels = Fractonica.supportedLevels
        factors = levels.map { clock.levelInfo($0).factor }
        prefixes = levels.map { clock.levelInfo($0).prefixDouble }
        exactPrefixes = levels.map { clock.levelInfo($0).prefix }
        let e = Int128(clock.extent)
        halfCounts = levels.map { Int64((e * clock.levelInfo($0).prefix + 1) / 2) }
    }

    func factor(_ level: Int) -> Int { factors[level] }
    func prefix(_ level: Int) -> Double { prefixes[level] }
    func exactPrefix(_ level: Int) -> Int128 { exactPrefixes[level] }
    /// Half-arcs of a level in the catalogue, the clipped last one included (`clock.count(level, 'half')`).
    func halfCount(_ level: Int) -> Int64 { halfCounts[level] }

    /// Fraction of a nominal half-arc inside the catalogue (the last arcs are clipped).
    func fractionOf(_ level: Int, _ idx: Int64) -> Double {
        min(1, max(0, (Double(extent) * prefix(level) - 2 * Double(idx)) / 2))
    }

    /// Unix time at progress p (0…1) of half-arc idx of a level (position-linear, as the arcs are).
    func timeAt(_ level: Int, _ idx: Int64, _ p: Double) -> Double {
        clock.time(atPosition: ((Double(idx) + p) * 2) / prefix(level))
    }

    /// Index of the level-`l` half-arc that holds half-arc (level, idx), l ≤ level.
    func ancestorIndex(_ level: Int, _ idx: Int64, _ l: Int) -> Int64 {
        var i = idx
        var k = level - 1
        while k >= l {
            i /= Int64(factor(k))
            k -= 1
        }
        return i
    }

    func halfSpan(_ level: Int, _ idx: Int64) -> WaveSpan {
        let fraction = fractionOf(level, idx)
        let start = timeAt(level, idx, 0)
        let end = timeAt(level, idx, fraction)
        return WaveSpan(start: start, end: end, duration: end - start, fraction: fraction, clipped: fraction < 1)
    }

    /// Where the step buttons go from time t, which lies in half-arc (level, idx): the start of the next half-arc
    /// (dir > 0), or the start of this one when more than a moment into it, else the start of the previous one. The
    /// moment is measured in seconds as well as in share, so Prev moves on even on the 22 ms half-arcs of ξ.
    func stepTarget(_ level: Int, _ idx: Int64, t: Double, dir: Int) -> WaveStepTarget {
        if dir > 0 { return idx + 1 >= halfCount(level) ? .edge(.end) : .time(timeAt(level, idx + 1, 0) + waveLand) }
        let start = timeAt(level, idx, 0)
        if t - start > max(1.5 * waveLand, 0.02 * halfSpan(level, idx).duration) { return .time(start + waveLand) }
        return idx == 0 ? .edge(.start) : .time(timeAt(level, idx - 1, 0) + waveLand)
    }

    func describe(_ level: Int, _ idx: Int64) -> WaveHalfInfo {
        let name = Fractonica.periodName(level)
        let par: Int? = level == 0 ? nil : factor(level - 1)
        let n = Int(par.map { idx % Int64($0) } ?? idx) + 1
        let cycle = idx / 2
        return WaveHalfInfo(
            level: level,
            idx: idx,
            letter: name.text,
            parent: level == 0 ? nil : Fractonica.periodName(level - 1).text,
            depth: level + 1,
            crest: idx % 2 == 0,
            n: n,
            of: par ?? Int(halfCount(0)),
            cycle: cycle,
            cycleN: Int(par.map { cycle % Int64($0) } ?? cycle) + 1,
            cycleOf: par ?? Int((halfCount(0) + 1) / 2),
            span: halfSpan(level, idx)
        )
    }

    /// The half-arc of every level 0…15 at t (nil outside the catalogue). Levels 0…13 are the engine's exact
    /// readings; deeper ones descend from level 13 by float.
    func readHalves(_ t: Double) -> [WaveHalf]? {
        guard clock.inRange(t) else { return nil }
        var out: [WaveHalf] = []
        out.reserveCapacity(waveDeepest + 1)
        for level in 0...Fractonica.maxLevel {
            guard let r = clock.level(at: t, level) else { return nil }
            var h = WaveGeometry.halfOf(cycle: r.cycle, phase: r.phase)
            // the very last instant of the catalogue belongs to the last half-arc (at its end)
            let last = halfCount(level) - 1
            if h.idx > last {
                h.idx = last
                h.local = 1
                h.half = Int(last % 2)
            }
            h.reading = WaveReading(cycle: r.cycle, phase: r.phase, index: r.index)
            out.append(h)
        }
        for level in (Fractonica.maxLevel + 1)...waveDeepest {
            let c = WaveGeometry.childOf(idx: out[level - 1].idx, local: out[level - 1].local, m: factor(level - 1))
            out.append(WaveHalf(idx: c.idx, local: c.local, half: Int(c.idx % 2)))
        }
        return out
    }

    // MARK: The library geometry

    private static func moduloAngle(_ x: Double) -> Double {
        let tau = WaveGeometry.tau
        return WaveGeometry.jsMod(WaveGeometry.jsMod(x, tau) + tau, tau)
    }

    /// fractonica.js `clock.arc(level, index, {root: 'wave', relativeTo})`. With `relativeTo` (an ancestor or the
    /// arc itself) that ancestor is the unit circle at the origin and everything is expressed in its frame.
    func arc(_ level: Int, _ index: Int64, relativeTo ref: (level: Int, idx: Int64)? = nil) -> WaveArc {
        var indices = [Int64](repeating: 0, count: level + 1)
        indices[level] = index
        var l = level - 1
        while l >= 0 {
            indices[l] = indices[l + 1] / Int64(factor(l))
            l -= 1
        }
        let r = indices[0]
        var result = WaveArc(cx: Double(r) * 2 + 1, cy: 0, radius: 1, start: .pi, sweep: .pi * (r % 2 != 0 ? -1 : 1))
        for l in 0...level {
            if let ref, l <= ref.level {
                result.cx = 0
                result.cy = 0
                result.radius = 1
            }
            if l < level {
                let m = factor(l)
                result = result.child(m: m, local: Int(indices[l + 1] % Int64(m)), index: indices[l + 1])
            }
            result.start = Self.moduloAngle(result.start)
        }
        return result
    }

    /// Half-arc (level, idx) in the frame of `ref`, an ancestor or itself.
    func arc(_ level: Int, _ idx: Int64, in ref: (level: Int, idx: Int64)) -> WaveArc {
        arc(level, idx, relativeTo: ref)
    }

    // MARK: Scenes

    /// The scene focused on half-arc (level, idx): the arc, its children and grandchildren, and its closest
    /// ancestors expressed in the same frame.
    func buildFocus(_ level: Int, _ idx: Int64) -> WaveFocusScene {
        let ref = (level: level, idx: idx)
        let focus = arc(level, idx, in: ref)
        let fraction = fractionOf(level, idx)
        let m = factor(level)
        var children: [WaveLoop] = []
        for j in 0..<m {
            let ci = idx * Int64(m) + Int64(j)
            if ci >= halfCount(level + 1) { break }
            children.append(WaveLoop(level: level + 1, idx: ci, j: j, k: -1, arc: arc(level + 1, ci, in: ref), fraction: fractionOf(level + 1, ci)))
        }
        let m2 = factor(level + 1)
        var grand: [WaveLoop] = []
        for c in children {
            for k in 0..<m2 {
                let gi = c.idx * Int64(m2) + Int64(k)
                if gi >= halfCount(level + 2) { break }
                grand.append(WaveLoop(level: level + 2, idx: gi, j: c.j, k: k, arc: arc(level + 2, gi, in: ref), fraction: fractionOf(level + 2, gi)))
            }
        }
        // ancestors (parent first): their circles seen from the focus frame
        var ancestors: [WaveAncestor] = []
        var l = level - 1
        while l >= max(0, level - 4) {
            let ai = ancestorIndex(level, idx, l)
            let abs = arc(l, ai)
            let f = arc(level, idx, in: (l, ai)) // the focus arc in the ancestor's frame
            let slotM = factor(l)
            let slotJ = Int(ancestorIndex(level, idx, l + 1) % Int64(slotM))
            ancestors.append(WaveAncestor(
                level: l, idx: ai, slotJ: slotJ, slotM: slotM, fraction: fractionOf(l, ai),
                arc: WaveArc(cx: -f.cx / f.radius, cy: -f.cy / f.radius, radius: 1 / f.radius, start: abs.start, sweep: abs.sweep)
            ))
            l -= 1
        }
        // fitting samples: focus, children and grandchildren
        var pts: [Double] = []
        pts.reserveCapacity(2 * (65 + 33 * children.count + 13 * grand.count))
        func sample(_ a: WaveArc, _ fr: Double, _ n: Int) {
            for i in 0...n {
                let angle = a.start + a.sweep * (fr * Double(i) / Double(n))
                pts.append(a.cx + a.radius * cos(angle))
                pts.append(a.cy + a.radius * sin(angle))
            }
        }
        sample(focus, fraction, 64)
        for c in children { sample(c.arc, c.fraction, 32) }
        for g in grand { sample(g.arc, g.fraction, 12) }
        // the frame map to the α ancestor's frame
        let r0 = ancestorIndex(level, idx, 0)
        var toAlpha = WaveFrameMap.identity
        if level > 0 {
            let f0 = arc(level, idx, in: (0, r0))
            toAlpha = WaveFrameMap(x: f0.cx, y: f0.cy, k: f0.radius)
        }
        return WaveFocusScene(
            level: level, idx: idx, r0: r0, focus: focus, fraction: fraction, children: children, grand: grand,
            ancestors: ancestors, samples: pts, rot: WaveGeometry.viewRotation(focus), toAlpha: toAlpha,
            info: describe(level, idx)
        )
    }

    /// How many points the focused half-arc of a scene measures once the camera has fitted it into W × H with `pad`
    /// (the part inside the catalogue only).
    func focusArcLength(_ scene: WaveFocusScene, width W: Double, height H: Double, pad: WavePad) -> Double {
        let cam = WaveCamera.fit(scene.samples, rot: scene.rot, width: W, height: H, pad: pad)
        return WaveProjection(cam, width: W, height: H).arc(scene.focus).length(scene.fraction)
    }

    /// One marker per level on its own arc, coarsest first: the ancestors in view, the focus arc, its child and
    /// grandchild and up to two further levels. Empty when the displayed time is outside the scene's half-arc.
    func markers(_ scene: WaveFocusScene, _ cur: [WaveHalf], maxLevel: Int = waveDeepest) -> [WaveMarker] {
        let level = scene.level
        guard cur.count > level, cur[level].idx == scene.idx else { return [] }
        var list: [WaveMarker] = []
        func add(_ l: Int, _ idx: Int64, _ a: WaveArc) {
            let local = cur[l].local
            let p = a.point(local)
            list.append(WaveMarker(level: l, idx: idx, local: local, arc: a, x: p.x, y: p.y))
        }
        for a in scene.ancestors.reversed() where cur[a.level].idx == a.idx {
            add(a.level, a.idx, a.arc)
        }
        add(level, scene.idx, scene.focus)
        if level + 1 < cur.count {
            let slot = cur[level + 1].idx - scene.idx * Int64(factor(level))
            if slot >= 0, slot < Int64(scene.children.count) {
                let c = scene.children[Int(slot)]
                if c.idx == cur[level + 1].idx {
                    add(c.level, c.idx, c.arc)
                    if level + 2 < cur.count, let g = scene.grand.first(where: { $0.idx == cur[level + 2].idx }) {
                        add(g.level, g.idx, g.arc)
                    }
                }
            }
        }
        var l = level + 3
        while l <= min(level + 4, maxLevel), l < cur.count {
            let key = WaveDeepKey(level: l, idx: cur[l].idx)
            let a: WaveArc
            if let cached = scene.deep[key] {
                a = cached
            } else {
                a = arc(l, cur[l].idx, in: (scene.level, scene.idx))
                if scene.deep.count > 64 { scene.deep.removeAll() }
                scene.deep[key] = a
            }
            add(l, cur[l].idx, a)
            l += 1
        }
        return list
    }

    /// Absolute arcs of levels 0…2 of the whole wave, built once.
    func overviewLevels() -> [[WaveOverviewArc]] {
        if let overviewCache { return overviewCache }
        var levels: [[WaveOverviewArc]] = [[], [], []]
        for l in 0...2 {
            let n = halfCount(l)
            levels[l].reserveCapacity(Int(n))
            for i in 0..<n {
                levels[l].append(WaveOverviewArc(level: l, idx: i, r0: ancestorIndex(l, i, 0), fraction: fractionOf(l, i), row: 0, col: 0, arc: arc(l, i)))
            }
        }
        overviewCache = levels
        return levels
    }

    /// The catalogue scene for a row layout: every arc shifted to its row.
    func buildOverview(_ layout: WaveRowLayout) -> WaveOverviewScene {
        let levels = overviewLevels().map { list in
            list.map { e -> WaveOverviewArc in
                let o = layout.offset(e.r0)
                var shifted = e
                shifted.row = o.row
                shifted.col = o.col
                shifted.arc.cx += o.x
                shifted.arc.cy += o.y
                return shifted
            }
        }
        return WaveOverviewScene(layout: layout, levels: levels)
    }

    /// The markers of the catalogue scene for the levels big enough to see (radius ≥ 2.6 points at scale k).
    func overviewMarkers(_ ov: WaveOverviewScene, _ cur: [WaveHalf], scale k: Double) -> [WaveMarker] {
        var out: [WaveMarker] = []
        for l in 0...2 {
            guard let first = ov.levels[l].first, first.arc.radius * k >= 2.6 else { break }
            let h = cur[l]
            guard h.idx >= 0, h.idx < Int64(ov.levels[l].count) else { break }
            let e = ov.levels[l][Int(h.idx)]
            let p = e.arc.point(h.local)
            out.append(WaveMarker(level: l, idx: h.idx, local: h.local, arc: e.arc, x: p.x, y: p.y))
        }
        return out
    }
}
