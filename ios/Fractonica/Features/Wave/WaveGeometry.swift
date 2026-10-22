import Foundation

// Pure geometry of the wave view (src/ui/wave/geometry.js): arcs, cameras, projection, picking and the catalogue's
// row layout. Plain numbers only — no clock, no SwiftUI — so Checks/ can test it against the JavaScript.
//
// Vocabulary
//   half-arc     one half-cycle of a level (the library's arc index); a crest has a positive sweep, a trough a
//                negative one (even / odd index)
//   local        0…1 progress through a half-arc ("the marker position")
//   camera       world point (cx, cy) in the middle of the stage, `scale` points per world unit, world rotated by `rot`
//   screen arc   an arc projected to stage points

/// A point of the wave's world or of the stage (y points down).
struct WavePoint: Equatable, Sendable {
    var x: Double
    var y: Double
}

/// An axis-aligned rectangle in stage points.
struct WaveRect: Equatable, Sendable {
    var x0: Double
    var y0: Double
    var x1: Double
    var y1: Double

    var width: Double { x1 - x0 }
    var height: Double { y1 - y0 }

    func contains(_ x: Double, _ y: Double) -> Bool { x >= x0 && x <= x1 && y >= y0 && y <= y1 }

    /// Area shared with `other` (0 when apart).
    func overlap(_ other: WaveRect) -> Double {
        max(0, min(x1, other.x1) - max(x0, other.x0)) * max(0, min(y1, other.y1) - max(y0, other.y0))
    }

    func inset(by d: Double) -> WaveRect { WaveRect(x0: x0 + d, y0: y0 + d, x1: x1 - d, y1: y1 - d) }
}

/// Points kept free around a fitted figure.
struct WavePad: Equatable, Sendable {
    var l = 0.0
    var r = 0.0
    var t = 0.0
    var b = 0.0
}

/// A circular arc of the harmonic geometry (the library's `clock.arc`): centre, radius, start angle and signed sweep,
/// radians, y down.
struct WaveArc: Equatable, Sendable {
    var cx: Double
    var cy: Double
    var radius: Double
    var start: Double
    var sweep: Double

    /// The point at progress t (0 = start, 1 = end).
    func point(_ t: Double) -> WavePoint {
        let a = start + sweep * t
        return WavePoint(x: cx + radius * cos(a), y: cy + radius * sin(a))
    }
}

/// The half-arc of one level that holds an instant: its index, the progress through it and which half of the cycle.
struct WaveHalf: Sendable {
    var idx: Int64
    var local: Double
    /// 0 = crest (first half of the cycle), 1 = trough.
    var half: Int
    /// The engine's reading of the level (levels 0…13; nil for the deeper ones, which descend by float).
    var reading: WaveReading?
}

/// What the wave keeps of a level reading: the cycle, its phase (position-linear) and the glyph state.
struct WaveReading: Sendable {
    var cycle: Int64
    var phase: Double
    var index: Int
}

enum WaveGeometry {
    static let tau = 2 * Double.pi

    static func clamp01(_ x: Double) -> Double { x < 0 ? 0 : x > 1 ? 1 : x }

    /// JavaScript's `%` on doubles (truncating remainder).
    static func jsMod(_ a: Double, _ b: Double) -> Double { a.truncatingRemainder(dividingBy: b) }

    /// An angle wrapped into [−π, π).
    static func wrapPi(_ a: Double) -> Double {
        var r = jsMod(a + .pi, tau)
        if r < 0 { r += tau }
        return r - .pi
    }

    /// The rotation that turns a focused arc so its middle points up for a crest and down for a trough: every
    /// half-arc then reads like the wave it is.
    static func viewRotation(_ arc: WaveArc) -> Double {
        let mid = arc.start + arc.sweep / 2
        return wrapPi((arc.sweep >= 0 ? -Double.pi / 2 : Double.pi / 2) - mid)
    }

    static func easeOutCubic(_ x: Double) -> Double { 1 - pow(1 - clamp01(x), 3) }

    // MARK: Levels and markers

    /// Half-arc reading from a full-cycle reading: index 2·cycle (+1 in the second half) and progress through it.
    static func halfOf(cycle: Int64, phase: Double) -> WaveHalf {
        let half = phase >= 0.5 ? 1 : 0
        return WaveHalf(idx: cycle * 2 + Int64(half), local: min(1, max(0, phase * 2 - Double(half))), half: half)
    }

    /// The child half-arc (m children per half-arc) holding progress `local` of half-arc `idx`.
    static func childOf(idx: Int64, local: Double, m: Int) -> (idx: Int64, local: Double, j: Int) {
        let x = local * Double(m)
        var j = Int(x.rounded(.down))
        if j >= m { j = m - 1 }
        if j < 0 { j = 0 }
        return (idx * Int64(m) + Int64(j), x - Double(j), j)
    }

    /// Fraction (0…1) of half-arc `idx` travelled when the current half-arc of its level is `cur`.
    static func travelled(_ idx: Int64, _ cur: WaveHalf) -> Double {
        idx < cur.idx ? 1 : idx > cur.idx ? 0 : cur.local
    }

    /// "+3" / "−4": a 1-based loop number with the sign of the arc's sweep (crest +, trough −).
    static func signedLabel(_ n: Int, sweep: Double) -> String {
        (sweep >= 0 ? "+" : "−") + String(n)
    }

    /// The phase glyph state (ascending family) at progress t of half-arc `idx`: floor(cycle phase · 4M), SPEC §4.
    static func glyphIndexAt(idx: Int64, t: Double, strokes: Int = 2) -> Int {
        var m = 1
        for _ in 0..<strokes { m *= 3 }
        let half = (m - 1) / 2
        let states = 4 * half
        let i = Int(((Double(idx % 2) + clamp01(t)) * 2 * Double(half)).rounded(.down))
        return ((i % states) + states) % states
    }
}

// MARK: - Frames and cameras

/// How two frames relate: p_to = (x, y) + k · p_from (translate and uniform scale).
struct WaveFrameMap: Equatable, Sendable {
    var x: Double
    var y: Double
    var k: Double

    static let identity = WaveFrameMap(x: 0, y: 0, k: 1)
}

/// A view of the world: (cx, cy) in the middle of the stage, `scale` points per world unit, world rotated by `rot`.
struct WaveCamera: Equatable, Sendable {
    var cx: Double
    var cy: Double
    var scale: Double
    var rot: Double

    /// The camera that fits a cloud of world points (flat x0, y0, x1, y1, …) into a W × H stage after rotating the
    /// world by `rot`, keeping `pad` free around the figure.
    static func fit(_ points: [Double], rot: Double, width W: Double, height H: Double, pad: WavePad = WavePad(),
                    maxScale: Double = .infinity) -> WaveCamera {
        let c = cos(rot)
        let s = sin(rot)
        var x0 = Double.infinity, y0 = Double.infinity, x1 = -Double.infinity, y1 = -Double.infinity
        var i = 0
        while i + 1 < points.count {
            let x = c * points[i] - s * points[i + 1]
            let y = s * points[i] + c * points[i + 1]
            x0 = min(x0, x)
            x1 = max(x1, x)
            y0 = min(y0, y)
            y1 = max(y1, y)
            i += 2
        }
        let bw = max(1e-12, x1 - x0)
        let bh = max(1e-12, y1 - y0)
        let availW = max(40, W - pad.l - pad.r)
        let availH = max(40, H - pad.t - pad.b)
        let scale = min(availW / bw, availH / bh, maxScale)
        // the figure's centre in rotated space, shifted so it lands in the middle of the free area
        let rx = (x0 + x1) / 2 - (pad.l + availW / 2 - W / 2) / scale
        let ry = (y0 + y1) / 2 - (pad.t + availH / 2 - H / 2) / scale
        return WaveCamera(cx: c * rx + s * ry, cy: -s * rx + c * ry, scale: scale, rot: rot)
    }

    /// `fit`, kept clear of floating controls: when the fitted figure reaches under one of `avoid` (a figure filling a
    /// short stage puts its corners exactly where the zoom buttons float), it is fitted again with the pad grown past
    /// that control, vertically or sideways, whichever leaves the figure larger.
    static func fit(_ points: [Double], rot: Double, width W: Double, height H: Double, pad: WavePad,
                    avoiding avoid: [WaveRect]) -> WaveCamera {
        var pad = pad
        var cam = fit(points, rot: rot, width: W, height: H, pad: pad)
        for _ in 0..<4 {
            let view = WaveProjection(cam, width: W, height: H)
            guard let r = avoid.first(where: { covers($0, points, view) }) else { break }
            var vertical = pad
            if r.y0 + r.y1 < H { vertical.t = max(pad.t, r.y1 + 6) } else { vertical.b = max(pad.b, H - r.y0 + 6) }
            var sideways = pad
            if r.x0 + r.x1 > W { sideways.r = max(pad.r, W - r.x0 + 6) } else { sideways.l = max(pad.l, r.x1 + 6) }
            let a = fit(points, rot: rot, width: W, height: H, pad: vertical)
            let b = fit(points, rot: rot, width: W, height: H, pad: sideways)
            (cam, pad) = a.scale >= b.scale ? (a, vertical) : (b, sideways)
        }
        return cam
    }

    /// Whether a projected point cloud has a point inside a rectangle.
    private static func covers(_ r: WaveRect, _ points: [Double], _ view: WaveProjection) -> Bool {
        var i = 0
        while i + 1 < points.count {
            let p = view.point(points[i], points[i + 1])
            if r.contains(p.x, p.y) { return true }
            i += 2
        }
        return false
    }

    /// The camera between a and b (e in 0…1): the scale moves geometrically and the centre follows the exact "zoom
    /// towards a point" path, so whatever stays still between the two cameras stays still all along; the rotation
    /// takes the short way round.
    static func lerp(_ a: WaveCamera, _ b: WaveCamera, _ e: Double) -> WaveCamera {
        let s = exp(log(a.scale) * (1 - e) + log(b.scale) * e)
        let ia = 1 / a.scale
        let ib = 1 / b.scale
        let d = ib - ia
        let g = abs(d) < 1e-9 * max(ia, ib) ? e : (1 / s - ia) / d
        return WaveCamera(
            cx: a.cx + (b.cx - a.cx) * g,
            cy: a.cy + (b.cy - a.cy) * g,
            scale: s,
            rot: a.rot + WaveGeometry.wrapPi(b.rot - a.rot) * e
        )
    }

    /// This camera, given in frame X, expressed in frame Y where p_Y = o + k · p_X.
    func toFrame(_ m: WaveFrameMap) -> WaveCamera {
        WaveCamera(cx: m.x + m.k * cx, cy: m.y + m.k * cy, scale: scale / m.k, rot: rot)
    }

    /// The inverse: this camera, given in Y, expressed in X.
    func fromFrame(_ m: WaveFrameMap) -> WaveCamera {
        WaveCamera(cx: (cx - m.x) / m.k, cy: (cy - m.y) / m.k, scale: scale * m.k, rot: rot)
    }

    /// The camera after the user's own pinch and pan on a W × H stage: every stage point p moves to
    /// anchor + scale · (p − anchor) + translation.
    func adjusted(by user: WaveUserTransform, width W: Double, height H: Double) -> WaveCamera {
        if user.isIdentity { return self }
        let s = user.scale
        let k = scale * s
        // the stage shift the transform adds to the centre, back in world units (inverse rotation)
        let sx = (user.anchor.x - W / 2) * (1 - s) + user.translation.x
        let sy = (user.anchor.y - H / 2) * (1 - s) + user.translation.y
        let c = cos(rot)
        let sn = sin(rot)
        let wx = c * sx + sn * sy
        let wy = -sn * sx + c * sy
        return WaveCamera(cx: cx - wx / k, cy: cy - wy / k, scale: k, rot: rot)
    }
}

/// The user's own adjustment of the fitted camera: a pinch about `anchor` and a pan, in stage points.
struct WaveUserTransform: Equatable, Sendable {
    var scale = 1.0
    var anchor = WavePoint(x: 0, y: 0)
    var translation = WavePoint(x: 0, y: 0)

    static let identity = WaveUserTransform()

    var isIdentity: Bool { scale == 1 && translation.x == 0 && translation.y == 0 }

    /// Between this transform and identity (e = 1 is identity).
    func easedToIdentity(_ e: Double) -> WaveUserTransform {
        WaveUserTransform(
            scale: exp(log(scale) * (1 - e)),
            anchor: anchor,
            translation: WavePoint(x: translation.x * (1 - e), y: translation.y * (1 - e))
        )
    }
}

/// A camera projecting onto a W × H stage, with its cosine and sine cached for projecting many arcs per frame.
struct WaveProjection: Sendable {
    let cam: WaveCamera
    let width: Double
    let height: Double
    let c: Double
    let s: Double
    let k: Double

    init(_ cam: WaveCamera, width: Double, height: Double) {
        self.cam = cam
        self.width = width
        self.height = height
        c = cos(cam.rot)
        s = sin(cam.rot)
        k = cam.scale
    }

    func point(_ x: Double, _ y: Double) -> WavePoint {
        let dx = x - cam.cx
        let dy = y - cam.cy
        return WavePoint(x: width / 2 + k * (c * dx - s * dy), y: height / 2 + k * (s * dx + c * dy))
    }

    func point(_ p: WavePoint) -> WavePoint { point(p.x, p.y) }

    func arc(_ a: WaveArc) -> WaveScreenArc {
        let dx = a.cx - cam.cx
        let dy = a.cy - cam.cy
        return WaveScreenArc(
            x: width / 2 + k * (c * dx - s * dy),
            y: height / 2 + k * (s * dx + c * dy),
            r: a.radius * k,
            a0: a.start + cam.rot,
            sweep: a.sweep
        )
    }
}

/// An arc projected onto the stage, in points.
struct WaveScreenArc: Equatable, Sendable {
    var x: Double
    var y: Double
    var r: Double
    var a0: Double
    var sweep: Double

    func point(_ t: Double) -> WavePoint {
        let a = a0 + sweep * t
        return WavePoint(x: x + r * cos(a), y: y + r * sin(a))
    }

    /// Unit vector from the centre through progress t: the outward normal of the arc there.
    func normal(_ t: Double) -> WavePoint {
        let a = a0 + sweep * t
        return WavePoint(x: cos(a), y: sin(a))
    }

    /// The nearest point of the arc (progress 0…tMax) to a stage point: its progress and the distance in points.
    func nearest(_ px: Double, _ py: Double, tMax: Double = 1) -> (t: Double, dist: Double) {
        let dx = px - x
        let dy = py - y
        let dir: Double = sweep < 0 ? -1 : 1
        let span = abs(sweep)
        var d = WaveGeometry.jsMod((atan2(dy, dx) - a0) * dir, WaveGeometry.tau)
        if d < 0 { d += WaveGeometry.tau }
        if d <= span * tMax { return (d / span, abs(hypot(dx, dy) - r)) }
        let p0 = point(0)
        let p1 = point(tMax)
        let d0 = hypot(px - p0.x, py - p0.y)
        let d1 = hypot(px - p1.x, py - p1.y)
        return d0 <= d1 ? (0, d0) : (tMax, d1)
    }

    /// Length in points of the part 0…fraction.
    func length(_ fraction: Double = 1) -> Double { r * abs(sweep) * fraction }
}

// MARK: - The catalogue overview

/// The 35 α half-arcs of the catalogue wrapped into rows so they use the stage: row r holds `cols` consecutive α
/// half-arcs (2 world units wide each).
struct WaveRowLayout: Equatable, Sendable {
    var cols: Int
    var rows: Int
    var scale: Double
    var worldW: Double
    var worldH: Double
    var rowPitch: Double

    /// The row count that gives the biggest scale.
    static func best(count n: Int, width W: Double, height H: Double, pad: WavePad = WavePad(), rowPitch: Double = 3.1,
                     minCols: Int = 2, maxCols: Int? = nil) -> WaveRowLayout? {
        let availW = max(40, W - pad.l - pad.r)
        let availH = max(40, H - pad.t - pad.b)
        var best: WaveRowLayout?
        let top = min(maxCols ?? n, n)
        guard top >= minCols else { return nil }
        for cols in stride(from: top, through: minCols, by: -1) {
            let rows = (n + cols - 1) / cols
            let worldW = 2 * Double(cols)
            let worldH = Double(rows - 1) * rowPitch + 2 * 1.4 // arcs reach ±1 and their child loops about 0.4 further
            let scale = min(availW / worldW, availH / worldH)
            if best == nil || scale > best!.scale * 1.0001 {
                best = WaveRowLayout(cols: cols, rows: rows, scale: scale, worldW: worldW, worldH: worldH, rowPitch: rowPitch)
            }
        }
        return best
    }

    /// The shift applied to α half-arc r: p' = p + offset.
    func offset(_ r: Int64) -> (x: Double, y: Double, row: Int, col: Int) {
        let row = Int(r) / cols
        return (-2 * Double(cols) * Double(row), Double(row) * rowPitch, row, Int(r) % cols)
    }

    /// The camera that shows the whole layout.
    func camera(width W: Double, height H: Double, pad: WavePad = WavePad()) -> WaveCamera {
        let cx = worldW / 2
        let top = -1.4
        let bottom = Double(rows - 1) * rowPitch + 1.4
        let cy = (top + bottom) / 2
        let availW = W - pad.l - pad.r
        let availH = H - pad.t - pad.b
        return WaveCamera(
            cx: cx - (pad.l + availW / 2 - W / 2) / scale,
            cy: cy - (pad.t + availH / 2 - H / 2) / scale,
            scale: scale,
            rot: 0
        )
    }
}
