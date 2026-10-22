import Foundation

// The solar wave (src/ui/wave/solar.js): geometry and decisions on plain numbers.
//
// A solar sync is 19 η cycles (SPEC §7). Its boundaries are η cycle boundaries, so in Saros position units the sync
// grid is exact: sync n starts at (anchor + 19 n) · 4 / P6, with P6 the prefix of level 6 and anchor = A · P6 / 4
// (A = 20, the first eclipse of Alpha 6). 19 is no factor of the hierarchy, so a sync is not one more level of nested
// arcs: it is drawn as a ripple riding the focused arc whose wavelength is one sync,
//
//     displacement(p) = amp · sin(2π · syncPhase(position(p)))      (outward positive)
//
// which puts peak, node, valley and end where the glyph wave has them.

enum WaveSolar {
    static let syncLevel = 6
    static let syncCycles = 19.0
    static let syncAnchor = 20.0
    static let quarters = ["peak", "node", "valley", "end"]
    /// A ripple needs at least this many syncs on the focused arc …
    static let minSyncs = 1.5
    /// … and a wavelength of at least this many points (below it the ripple is fuzz on the arc).
    static let minWavelength = 26.0
    /// From this wavelength on the ripple is drawn at full strength; between the two it fades in from `minStrength`.
    static let fullWavelength = 40.0
    static let minStrength = 0.5
    static let ampMin = 3.0
    static let ampMax = 20.0

    /// The sync grid for the prefix `p6` of level 6 (125125 for Saros 141).
    struct Grid: Equatable, Sendable {
        var p6: Double
        var anchor: Double
        /// One sync in Saros position units.
        var length: Double

        init(p6: Double) {
            self.p6 = p6
            anchor = WaveSolar.syncAnchor * p6 / 4
            length = WaveSolar.syncCycles * 4 / p6
        }

        /// The sync coordinate of a Saros position: its integer part is the sync number, its fraction the phase.
        func coord(_ pos: Double) -> Double { (pos * p6 / 4 - anchor) / WaveSolar.syncCycles }

        /// The position of a sync coordinate.
        func position(ofCoord c: Double) -> Double { (c * WaveSolar.syncCycles + anchor) * 4 / p6 }

        func at(_ pos: Double) -> (sync: Int, phase: Double, coord: Double) {
            let c = coord(pos)
            let s = c.rounded(.down)
            return (Int(s), c - s, c)
        }
    }

    /// How many syncs fit on `fraction` of a half-arc of a level with prefix `p`.
    static func syncsOnArc(prefix p: Double, fraction: Double, grid: Grid) -> Double {
        2 * fraction / p / grid.length
    }

    /// A half-arc in position units: progress p of half-arc idx (prefix P) is the position pos0 + p · span.
    struct ArcSpec: Equatable, Sendable {
        var idx: Int64
        var p: Double
        var pos0: Double
        var span: Double
        var fraction: Double

        init(idx: Int64, prefix: Double, fraction: Double = 1) {
            self.idx = idx
            p = prefix
            pos0 = Double(idx) * 2 / prefix
            span = 2 / prefix
            self.fraction = fraction
        }
    }

    struct Fit: Equatable, Sendable {
        enum Why: Sendable { case ok, coarse, fine }
        var visible: Bool
        var strength: Double
        var wavelength: Double
        var syncs: Double
        var why: Why
    }

    /// Does the ripple fit an arc of `arcPx` points carrying `syncs` syncs?
    static func rippleFit(syncs: Double, arcPx: Double) -> Fit {
        let wavelength = syncs > 0 ? arcPx / syncs : .infinity
        if !(syncs >= minSyncs) { return Fit(visible: false, strength: 0, wavelength: wavelength, syncs: syncs, why: .coarse) }
        if !(wavelength >= minWavelength) { return Fit(visible: false, strength: 0, wavelength: wavelength, syncs: syncs, why: .fine) }
        let k = (wavelength - minWavelength) / (fullWavelength - minWavelength)
        return Fit(visible: true, strength: WaveGeometry.clamp01(minStrength + (1 - minStrength) * k), wavelength: wavelength, syncs: syncs, why: .ok)
    }

    /// The levels (of `count`) whose current half-arc carries a ripple as the stage shows them. `pxOf` is only asked
    /// for levels that could carry one on an arc no longer than `maxPx`.
    static func rippleDepths(count: Int, syncsOf: (Int) -> Double, pxOf: (Int) -> Double, maxPx: Double = .infinity) -> [Int] {
        var out: [Int] = []
        for l in 0..<count {
            let syncs = syncsOf(l)
            if !(syncs >= minSyncs) || syncs * minWavelength > maxPx { continue }
            if rippleFit(syncs: syncs, arcPx: pxOf(l)).visible { out.append(l) }
        }
        return out
    }

    /// The ripple's amplitude for a wavelength: 6 % of it, between `ampMin` and `ampMax`.
    static func rippleAmp(_ wavelength: Double) -> Double { min(ampMax, max(ampMin, wavelength * 0.06)) }

    /// How many quarters of a sync have passed at `phase` (0…3).
    static func quarterOf(_ phase: Double) -> Int { min(3, max(0, Int((phase * 4).rounded(.down)))) }

    /// The time a drag travels to for `phase` of a sync [start, end]: time-linear, kept just inside it.
    static func travelTime(start: Double, end: Double, phase: Double, margin: Double = 0.001) -> Double {
        min(end - margin, max(start + margin, start + WaveGeometry.clamp01(phase) * (end - start)))
    }

    /// A point of the ripple at progress p (0…fraction) of the projected arc: the carrier pushed out by the ripple,
    /// with the outward normal and the displacement.
    static func point(_ sa: WaveScreenArc, _ spec: ArcSpec, _ grid: Grid, _ p: Double, amp: Double) -> (x: Double, y: Double, nx: Double, ny: Double, d: Double) {
        let a = sa.a0 + sa.sweep * p
        let c = grid.coord(spec.pos0 + p * spec.span)
        let d = amp * sin(WaveGeometry.tau * (c - c.rounded(.down)))
        return (sa.x + (sa.r + d) * cos(a), sa.y + (sa.r + d) * sin(a), cos(a), sin(a), d)
    }

    /// The ripple as a polyline riding the projected arc: point i at progress fraction · i / n.
    static func polyline(_ sa: WaveScreenArc, _ spec: ArcSpec, _ grid: Grid, amp: Double, step: Double = 2) -> [WavePoint] {
        let f = spec.fraction
        let n = max(12, min(1600, Int((sa.length(f) / step).rounded(.up))))
        return (0...n).map { i in
            let q = point(sa, spec, grid, f * Double(i) / Double(n), amp: amp)
            return WavePoint(x: q.x, y: q.y)
        }
    }

    /// The polyline index where the bright (travelled) part ends.
    static func split(n: Int, travelled: Double, fraction: Double) -> Int {
        max(0, min(n, Int((Double(n) * travelled / fraction + 0.5).rounded(.down))))
    }

    /// The pin of the displayed time: its foot on the ripple at progress `pNow` and its head `lift` points beyond the
    /// ripple (never closer to the centre than the carrier plus `lift`).
    static func pin(_ sa: WaveScreenArc, _ spec: ArcSpec, _ grid: Grid, pNow: Double, amp: Double, lift: Double = 17)
        -> (foot: WavePoint, head: WavePoint, nx: Double, ny: Double) {
        let p = min(spec.fraction, max(0, pNow))
        let f = point(sa, spec, grid, p, amp: amp)
        let r = sa.r + lift + max(0, f.d)
        return (WavePoint(x: f.x, y: f.y), WavePoint(x: sa.x + r * f.nx, y: sa.y + r * f.ny), f.nx, f.ny)
    }

    /// The phase inside sync `sync` of the point at progress t of the arc: what dragging the pin means (held at the
    /// sync's ends, so a drag never leaves it).
    static func pinPhase(_ spec: ArcSpec, _ grid: Grid, t: Double, sync: Int) -> Double {
        WaveGeometry.clamp01(grid.coord(spec.pos0 + t * spec.span) - Double(sync))
    }

    struct QuarterMark: Equatable, Sendable {
        var sync: Int
        /// 1…4: peak, node, valley, end.
        var k: Int
        var coord: Double
        /// Progress on the half-arc.
        var p: Double
        var name: String { WaveSolar.quarters[k - 1] }
    }

    /// The quarter marks of the syncs that overlap the arc, inside [0, fraction]; `only` limits them to one sync.
    static func quarterMarks(_ spec: ArcSpec, _ grid: Grid, only: Int? = nil) -> [QuarterMark] {
        let c0 = grid.coord(spec.pos0)
        let c1 = grid.coord(spec.pos0 + spec.fraction * spec.span)
        var out: [QuarterMark] = []
        let first = Int(c0.rounded(.down))
        let last = Int(c1.rounded(.down)) + 1
        guard first <= last else { return out }
        for s in first...last {
            if let only, s != only { continue }
            for k in 1...4 {
                let coord = Double(s) + Double(k) / 4
                if coord < c0 || coord > c1 { continue }
                out.append(QuarterMark(sync: s, k: k, coord: coord, p: (grid.position(ofCoord: coord) - spec.pos0) / spec.span))
            }
        }
        return out
    }

    /// The dial's mini wave in a w × h box: the point at a phase of the sync.
    static func dialPoint(phase: Double, width w: Double, height h: Double, padX: Double = 7, padY: Double = 5) -> WavePoint {
        let a = h / 2 - padY
        return WavePoint(x: padX + (w - 2 * padX) * phase, y: h / 2 - a * sin(WaveGeometry.tau * phase))
    }
}
