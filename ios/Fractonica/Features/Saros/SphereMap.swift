import CoreGraphics
import Foundation
import Synchronization
import SwiftUI

// The Saros catalogue's maps: the sphere, the world drawn on it and an azimuthal perspective projection of it (after
// gnomonicube's face projection, whose `projectionR` it takes: 0 gnomonic, −1 stereographic, below −1 a view from
// outside the globe). Everything is clipped on the sphere to a cap around the map's centre before it is projected, so
// no projection ever meets a point it cannot show: lines are cut where they leave the cap, and areas are closed along
// the cap's rim in the direction that keeps their inside on the left (Weiler–Atherton against a cap), which keeps a
// coast running off the map filled on the land side however it leaves and re-enters.

/// A point of space, mostly a unit vector: x towards 0° E on the equator, y towards 90° E, z to the north pole. A plain
/// struct rather than SIMD3, whose generic operators cost a call each in unoptimised builds (and the map projects tens of
/// thousands of points a frame while it is dragged).
struct Vec3: Sendable, Equatable {
    var x: Double
    var y: Double
    var z: Double

    @inline(__always) init(_ x: Double, _ y: Double, _ z: Double) {
        self.x = x
        self.y = y
        self.z = z
    }

    static let zero = Vec3(0, 0, 0)

    @inline(__always) static func + (a: Vec3, b: Vec3) -> Vec3 { Vec3(a.x + b.x, a.y + b.y, a.z + b.z) }
    @inline(__always) static func - (a: Vec3, b: Vec3) -> Vec3 { Vec3(a.x - b.x, a.y - b.y, a.z - b.z) }
    @inline(__always) static prefix func - (a: Vec3) -> Vec3 { Vec3(-a.x, -a.y, -a.z) }
    @inline(__always) static func * (a: Vec3, k: Double) -> Vec3 { Vec3(a.x * k, a.y * k, a.z * k) }
    @inline(__always) static func / (a: Vec3, k: Double) -> Vec3 { Vec3(a.x / k, a.y / k, a.z / k) }
}

extension GeoPoint {
    var vector: Vec3 {
        let lat = self.lat * .pi / 180, lon = self.lon * .pi / 180
        return Vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat))
    }

    init(_ v: Vec3) {
        let n = normalized(v)
        self.init(lon: atan2(n.y, n.x) * 180 / .pi, lat: asin(max(-1, min(1, n.z))) * 180 / .pi)
    }
}

@inline(__always) func dot(_ a: Vec3, _ b: Vec3) -> Double { a.x * b.x + a.y * b.y + a.z * b.z }
@inline(__always) func cross(_ a: Vec3, _ b: Vec3) -> Vec3 {
    Vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
}
@inline(__always) func normalized(_ v: Vec3) -> Vec3 { v / max(1e-300, dot(v, v).squareRoot()) }

/// A ring (or line) of points on the sphere and the smallest cap around it that the clipping tests against first.
struct SphereRing: Sendable {
    let points: [Vec3]
    /// Every point lies within `radius` (radians) of `center`.
    let center: Vec3
    let radius: Double

    init(_ points: [Vec3]) {
        self.points = points
        let sum = points.reduce(Vec3.zero, +)
        let center = dot(sum, sum) > 1e-12 ? normalized(sum) : (points.first ?? Vec3(0, 0, 1))
        self.center = center
        radius = acos(max(-1, min(1, points.map { dot($0, center) }.min() ?? 1)))
    }

    /// The same ring running the other way round when it runs clockwise (seen from outside the globe) around the
    /// smaller of the two regions it bounds: areas are clipped as counterclockwise rings.
    func counterclockwise() -> SphereRing {
        var turn = 0.0
        for i in points.indices {
            turn += dot(cross(points[i], points[(i + 1) % points.count]), center)
        }
        return turn >= 0 ? self : SphereRing(points.reversed())
    }
}

/// One layer of the world map from an "FXMP" file (ios/scripts/make-saros.mjs): u32 ring count, then per ring u32
/// point count and i16 pairs of longitude × 32767/180 and latitude × 32767/90.
struct MapLayer: Sendable {
    let rings: [SphereRing]

    init(rings: [SphereRing]) { self.rings = rings }

    init?(data: Data) {
        let b = [UInt8](data)
        guard b.count >= 8, b[0] == 0x46, b[1] == 0x58, b[2] == 0x4D, b[3] == 0x50 else { return nil }
        func u32(_ at: Int) -> Int { Int(b[at]) | Int(b[at + 1]) << 8 | Int(b[at + 2]) << 16 | Int(b[at + 3]) << 24 }
        func i16(_ at: Int) -> Double { Double(Int16(bitPattern: UInt16(b[at]) | UInt16(b[at + 1]) << 8)) }
        var at = 8
        var rings: [SphereRing] = []
        for _ in 0..<u32(4) {
            guard at + 4 <= b.count else { return nil }
            let n = u32(at)
            at += 4
            guard at + 4 * n <= b.count else { return nil }
            var points: [Vec3] = []
            points.reserveCapacity(n)
            for k in 0..<n {
                points.append(GeoPoint(lon: i16(at + 4 * k) * 180 / 32767, lat: i16(at + 4 * k + 2) * 90 / 32767).vector)
            }
            at += 4 * n
            rings.append(SphereRing(points))
        }
        self.rings = rings
    }
}

/// The world's layers, read from the app's bundle (or `directory`) on first use: Natural Earth land at 1:110m for
/// thumbnails and at 1:50m, its lakes and the countries' borders for the map.
enum WorldMap {
    enum Layer: String, CaseIterable, Sendable {
        case coarseLand = "land-110m", land, lakes, borders
    }

    static func layer(_ layer: Layer, directory: URL? = nil) -> MapLayer {
        if let hit = cache.withLock({ $0[layer] }) { return hit }
        let url = directory?.appendingPathComponent("\(layer.rawValue).bin")
            ?? Bundle.main.url(forResource: layer.rawValue, withExtension: "bin")
        let loaded = url.flatMap { try? Data(contentsOf: $0) }.flatMap { MapLayer(data: $0) } ?? MapLayer(rings: [])
        cache.withLock { $0[layer] = loaded }
        return loaded
    }

    private static let cache = Mutex<[Layer: MapLayer]>([:])

    /// Meridians every `step` degrees (to 80° of latitude) and parallels, as lines a point a degree, cut into pieces of
    /// at most 10° so that the clipper passes over the ones off the map.
    static func graticule(step: Double) -> [SphereRing] {
        var lines: [SphereRing] = []
        func add(_ points: [GeoPoint]) {
            for start in stride(from: 0, to: points.count - 1, by: 10) {
                lines.append(SphereRing(points[start...min(points.count - 1, start + 10)].map(\.vector)))
            }
        }
        for lon in stride(from: -180.0, to: 180, by: step) {
            add(stride(from: -80.0, through: 80, by: 1).map { GeoPoint(lon: lon, lat: $0) })
        }
        for lat in stride(from: -90 + step, to: 90, by: step) where abs(lat) <= 80 {
            add(stride(from: -180.0, through: 180, by: 1).map { GeoPoint(lon: $0, lat: lat) })
        }
        return lines
    }
}

/// An azimuthal perspective projection of the sphere onto the plane touching it at `center`, from the point on the
/// axis at `r` sphere radii from the centre of the Earth, on the far side (gnomonicube's `projectionR`, −3 … 0):
/// 0 is gnomonic (great circles are straight lines; a hemisphere at most, stretched towards its rim), −1 stereographic
/// (angles kept; all but the antipode), below −1 a view from outside the globe (the side it faces). North is up.
///
/// A point θ from the centre lands s(θ) = sin θ · (1 − r) / (cos θ − r) sphere radii from it on the plane, `scale`
/// points a radius on screen.
struct MapProjection: Sendable, Equatable {
    var center: GeoPoint
    var r: Double = 0
    /// Screen points a sphere radius on the plane.
    var scale: Double
    var size: CGSize

    /// The view's axes: east, north and out through `center`.
    var axes: (east: Vec3, north: Vec3, out: Vec3) {
        let c = center.vector
        let pole = Vec3(0, 0, 1)
        var east = cross(pole, c)
        if dot(east, east) < 1e-12 { east = Vec3(0, center.lat > 0 ? 1 : -1, 0) }
        east = normalized(east)
        return (east, cross(c, east), c)
    }

    /// The farthest angle from the centre the projection can show (radians): a hemisphere for gnomonic, all but the
    /// antipode for r between −1 and 0, the near side's cap seen from outside below −1.
    var horizon: Double { r >= -1 ? acos(r) : acos(1 / r) }

    /// s(θ): plane distance of a point θ from the centre.
    func planeRadius(_ theta: Double) -> Double { sin(theta) * (1 - r) / (cos(theta) - r) }

    /// θ(s), the inverse of `planeRadius`, within the horizon.
    func angle(planeRadius s: Double) -> Double {
        let a = 1 - r
        let theta = acos(max(-1, min(1, s * r / (s * s + a * a).squareRoot()))) - atan2(a, s)
        return min(horizon, max(0, theta))
    }

    /// The cap the map clips to (radians around the centre): just beyond the view's farthest corner, short of the
    /// horizon (half a degree inside it; a gnomonic map stops at 89°, 57 radii out).
    var clipAngle: Double {
        let corner = (Double(size.width * size.width + size.height * size.height)).squareRoot() / 2 / scale
        let limit = r >= -0.01 ? 89 * Double.pi / 180 : horizon - 0.5 * .pi / 180
        return min(limit, angle(planeRadius: corner) + 2 * .pi / 180)
    }

    /// A point given in the view's axes (z outwards), on screen.
    @inline(__always) func screen(_ v: Vec3) -> CGPoint {
        let k = (1 - r) / (v.z - r) * scale
        return CGPoint(x: size.width / 2 + v.x * k, y: size.height / 2 - v.y * k)
    }

    /// A point of the sphere in the view's axes.
    @inline(__always) func view(_ p: Vec3, _ axes: (east: Vec3, north: Vec3, out: Vec3)) -> Vec3 {
        Vec3(dot(p, axes.east), dot(p, axes.north), dot(p, axes.out))
    }

    /// A place on screen, or nil beyond the horizon.
    func project(_ g: GeoPoint) -> CGPoint? {
        let v = view(g.vector, axes)
        return v.z > cos(horizon) + 1e-9 ? screen(v) : nil
    }

    /// The place under a point of the screen, or nil off the projection.
    func unproject(_ point: CGPoint) -> GeoPoint? {
        let x = (point.x - size.width / 2) / scale, y = (size.height / 2 - point.y) / scale
        let s = (x * x + y * y).squareRoot()
        let theta = angle(planeRadius: s)
        guard planeRadius(theta).isFinite, abs(planeRadius(theta) - s) < 1e-6 * max(1, s) else { return nil }
        let a = axes
        let dir = s > 0 ? (a.east * (x / s) + a.north * (y / s)) : a.east
        return GeoPoint(a.out * cos(theta) + dir * sin(theta))
    }

    /// The scale that shows `angle` (radians) from the centre at `radius` points on screen.
    func scale(showing angle: Double, at radius: Double) -> Double {
        radius / max(1e-9, planeRadius(min(angle, horizon - 1e-3)))
    }
}

/// Clips rings and lines to the cap of a projection and draws them as paths.
struct MapClipper {
    let projection: MapProjection
    let axes: (east: Vec3, north: Vec3, out: Vec3)
    /// The cap: z ≥ z0 in the view's axes, its rim a circle of radius rim.
    let cap: Double
    let z0: Double
    let rim: Double

    init(_ projection: MapProjection) {
        self.projection = projection
        axes = projection.axes
        cap = projection.clipAngle
        z0 = cos(cap)
        rim = sin(cap)
    }

    /// The cap's rim on screen, the edge of the map.
    var rimPath: Path {
        Path { p in
            let points = stride(from: 0.0, through: 2 * .pi, by: .pi / 90).map {
                projection.screen(Vec3(rim * cos($0), rim * sin($0), z0))
            }
            p.addLines(points)
            p.closeSubpath()
        }
    }

    /// Whether a ring's bounding cap misses the map's cap, lies inside it, or crosses its rim.
    private enum Overlap { case outside, inside, crossing }

    private func overlap(_ ring: SphereRing) -> Overlap {
        let d = acos(max(-1, min(1, dot(ring.center, axes.out))))
        if d - ring.radius > cap { return .outside }
        if d + ring.radius < cap { return .inside }
        return .crossing
    }

    /// Areas (counterclockwise rings, `SphereRing.counterclockwise`) as one path of closed subpaths, to fill even-odd.
    func areas(_ rings: [SphereRing]) -> Path {
        var path = Path()
        for ring in rings {
            for loop in clipArea(ring) where loop.count > 2 {
                path.addLines(loop.map(projection.screen))
                path.closeSubpath()
            }
        }
        return path
    }

    /// Lines as one path of open subpaths (`closed` lines run back to their first point).
    func lines(_ rings: [SphereRing], closed: Bool = false) -> Path {
        var path = Path()
        for ring in rings {
            for piece in clipLine(ring, closed: closed) where piece.count > 1 {
                path.addLines(piece.map(projection.screen))
            }
        }
        return path
    }

    // MARK: - Clipping

    /// The parts of a counterclockwise ring inside the cap, closed along the rim, in the view's axes.
    func clipArea(_ ring: SphereRing) -> [[Vec3]] {
        let points = ring.points
        guard points.count > 2 else { return [] }
        switch overlap(ring) {
        case .outside:
            return contains(ring) ? [arc(from: 0, to: 2 * .pi)] : []
        case .inside:
            return [points.map { projection.view($0, axes) }]
        case .crossing:
            break
        }
        let v = points.map { projection.view($0, axes) }
        guard let start = v.firstIndex(where: { $0.z < z0 }) else { return [v] }
        // the runs inside, each from where it enters the cap to where it leaves
        var pieces: [[Vec3]] = []
        var current: [Vec3] = []
        var previous = v[start]
        for step in 1...v.count {
            let p = v[(start + step) % v.count]
            let wasIn = previous.z >= z0, isIn = p.z >= z0
            if isIn {
                if !wasIn { current = [crossing(previous, p)] }
                current.append(p)
            } else if wasIn {
                current.append(crossing(previous, p))
                pieces.append(current)
                current = []
            }
            previous = p
        }
        if pieces.isEmpty { return contains(ring) ? [arc(from: 0, to: 2 * .pi)] : [] }
        // link each exit to the next entry counterclockwise round the rim (the cap's inside on the left, as the ring's)
        let entries = pieces.map { atan2($0[0].y, $0[0].x) }
        let exits = pieces.map { atan2($0[$0.count - 1].y, $0[$0.count - 1].x) }
        var used = [Bool](repeating: false, count: pieces.count)
        var loops: [[Vec3]] = []
        for first in pieces.indices where !used[first] {
            var loop: [Vec3] = []
            var i = first
            for _ in pieces.indices {
                used[i] = true
                loop += pieces[i]
                var next = first, best = Double.infinity
                for k in pieces.indices where k == first || !used[k] {
                    var d = (entries[k] - exits[i]).truncatingRemainder(dividingBy: 2 * .pi)
                    if d < 0 { d += 2 * .pi }
                    if d < best { best = d; next = k }
                }
                loop += arc(from: exits[i], to: exits[i] + best)
                if next == first { break }
                i = next
            }
            loops.append(loop)
        }
        return loops
    }

    /// The parts of a line inside the cap, in the view's axes.
    func clipLine(_ ring: SphereRing, closed: Bool = false) -> [[Vec3]] {
        guard ring.points.count > 1, overlap(ring) != .outside else { return [] }
        var v = ring.points.map { projection.view($0, axes) }
        if closed, let first = v.first { v.append(first) }
        var out: [[Vec3]] = []
        var current: [Vec3] = v[0].z >= z0 ? [v[0]] : []
        for k in 1..<v.count {
            let a = v[k - 1], b = v[k]
            switch (a.z >= z0, b.z >= z0) {
            case (true, true): current.append(b)
            case (true, false):
                current.append(crossing(a, b))
                out.append(current)
                current = []
            case (false, true): current = [crossing(a, b), b]
            case (false, false): break
            }
        }
        if current.count > 1 { out.append(current) }
        return out
    }

    /// Where the chord from a to b crosses the cap's plane, put on the rim.
    private func crossing(_ a: Vec3, _ b: Vec3) -> Vec3 {
        let t = (z0 - a.z) / (b.z - a.z)
        let p = a + (b - a) * t
        let angle = atan2(p.y, p.x)
        return Vec3(rim * cos(angle), rim * sin(angle), z0)
    }

    /// The rim from one angle to another, counterclockwise, a point every 2°.
    private func arc(from a0: Double, to a1: Double) -> [Vec3] {
        let steps = max(1, Int(((a1 - a0) / (2 * .pi / 180)).rounded(.up)))
        return (1..<steps).map { k in
            let a = a0 + (a1 - a0) * Double(k) / Double(steps)
            return Vec3(rim * cos(a), rim * sin(a), z0)
        }
    }

    /// Whether a counterclockwise ring that stays off the cap's rim surrounds the map's centre: its winding about the
    /// centre seen from the antipode (stereographically), +1 inside, 0 or −1 (around the antipode) outside.
    private func contains(_ ring: SphereRing) -> Bool {
        guard dot(ring.center, axes.out) >= cos(ring.radius) else { return false }
        var turn = 0.0
        var previous: CGPoint?
        var first: CGPoint?
        for p in ring.points {
            let v = projection.view(p, axes)
            let k = 1 / max(1e-9, 1 + v.z)
            let q = CGPoint(x: v.x * k, y: v.y * k)
            if let a = previous { turn += atan2(a.x * q.y - a.y * q.x, a.x * q.x + a.y * q.y) }
            if first == nil { first = q }
            previous = q
        }
        if let a = previous, let q = first { turn += atan2(a.x * q.y - a.y * q.x, a.x * q.x + a.y * q.y) }
        return turn > .pi
    }
}
