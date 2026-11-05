import CoreGraphics
import Foundation
import FractonicaKit
import SwiftUI

// The Saros catalogue's data and maps: saros-geo's path files against what its own codec reads (the counts and
// figures below are saros_geo.js's), the path records SarosData points at, the world layers, the projection's
// round trip, and the clipper: rings that are small circles (whose inside is known exactly) on gnomonic,
// stereographic and outside views at random centres and scales, filled even-odd and compared point by point.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Saros/Checks

@main
struct SarosChecks {
    static func main() {
        pathFileChecks()
        worldChecks()
        projectionChecks()
        clipChecks()
        helionDialChecks()
        Checks.finish()
    }
}

private let resources = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../Resources/Saros").standardizedFileURL

private func pathFileChecks() {
    let paths = SarosPaths.series(141, directory: resources)
    check(paths.count == 50, "Saros 141 has 50 paths: \(paths.count)")
    if paths.count == 50 {
        let p = paths[20]
        check(p.type == "A" && p.latitude == 1.1 && p.longitude == -48.5, "1973's annular eclipse: \(p.type) \(p.latitude) \(p.longitude)")
        check(p.magnitude == 0.9174 && p.gamma == 0.4171 && p.centralDuration == 722 && p.centralWidthKm == 345, "its figures")
        check(p.rings.count == 1 && p.rings[0].count == 133, "its outline: \(p.rings.map(\.count))")
        check(paths[0].type == "Pb" && paths[0].isPartial && paths[0].rings[0].count == 69, "the series begins partial")
        check(paths[35].type == "Am", "2244 is the middle eclipse")
        // the TT second of greatest eclipse, as saros-geo keeps it: 1973-12-24 15:02:44
        check(paths[20].ttSeconds == 125_593_364, "TT seconds: \(paths[20].ttSeconds)")
    }
    var total = 0, mismatched = 0
    for series in SarosCatalogue.all {
        let all = SarosPaths.series(series.number, directory: resources)
        total += all.count
        for e in series.eclipses {
            guard let record = e.pathRecord else { continue }
            guard record < all.count else { mismatched += 1; continue }
            let p = all[record]
            // the same eclipse: its greatest point to the tenth of a degree, TT − Unix between −1 min (ΔT was negative
            // from about 1870 to 1902) and 2 h (ΔT in 1582)
            let dt = Double(p.ttSeconds) - e.time
            if abs(p.latitude - e.latitude) > 0.051 || abs(p.longitude - e.longitude) > 0.051 || dt < -60 || dt > 7200 { mismatched += 1 }
        }
    }
    check(total == 1737, "1737 paths in all: \(total)")
    check(mismatched == 0, "every path record is its eclipse's: \(mismatched) not")
    check(SarosPaths.series(999, directory: resources).isEmpty, "no file, no paths")
    check((try? SarosPaths.decode(Data([1, 0]))) == nil, "a truncated file is an error")
}

private func worldChecks() {
    let land = WorldMap.layer(.land, directory: resources)
    let coarse = WorldMap.layer(.coarseLand, directory: resources)
    let lakes = WorldMap.layer(.lakes, directory: resources)
    let borders = WorldMap.layer(.borders, directory: resources)
    check(land.rings.count == 1422 && land.rings.reduce(0) { $0 + $1.points.count } == 59247, "1:50m land")
    check(coarse.rings.count == 128 && lakes.rings.count == 457 && borders.rings.count == 1631, "the other layers")
    // the generator wrote areas counterclockwise round their smaller side
    let flipped = land.rings.filter { $0.counterclockwise().points.first != $0.points.first || $0.counterclockwise().points.count != $0.points.count }
    check(flipped.isEmpty, "land rings run counterclockwise: \(flipped.count) do not")
    let antarctica = land.rings.filter { $0.center.z < -0.99 && $0.points.count > 2000 }
    check(antarctica.count == 1, "one ring is round the south pole (Antarctica): \(antarctica.count)")
    let eurasia = land.rings.max { $0.points.count < $1.points.count }
    check(eurasia.map { GeoPoint($0.center).lat > 30 && $0.radius < 0.75 * .pi } == true, "the biggest ring is Afro-Eurasia, its bounding cap 95–135°")
}

private func projectionChecks() {
    var rng = SplitMix(seed: 7)
    for r in [0.0, -0.5, -1, -2, -3] {
        for _ in 0..<40 {
            let center = GeoPoint(lon: rng.uniform(-180, 180), lat: rng.uniform(-85, 85))
            let p = MapProjection(center: center, r: r, scale: 300, size: CGSize(width: 400, height: 300))
            let g = GeoPoint(lon: center.lon + rng.uniform(-30, 30), lat: max(-89, min(89, center.lat + rng.uniform(-30, 30))))
            guard let s = p.project(g), let back = p.unproject(s) else {
                check(false, "r \(r): \(g) projects and comes back")
                continue
            }
            let d = dot(back.vector - g.vector, back.vector - g.vector).squareRoot()
            check(d < 1e-9, "r \(r): round trip off by \(d) radii")
            let theta = acos(dot(g.vector, center.vector))
            check(abs(p.angle(planeRadius: p.planeRadius(theta)) - theta) < 1e-9, "θ(s(θ)) = θ")
        }
        let p = MapProjection(center: GeoPoint(lon: 10, lat: 20), r: r, scale: 100, size: CGSize(width: 300, height: 300))
        check(p.project(GeoPoint(lon: 10, lat: 20)) == CGPoint(x: 150, y: 150), "the centre is the middle of the view")
        let north = p.project(GeoPoint(lon: 10, lat: 30))!
        check(abs(north.x - 150) < 1e-9 && north.y < 150, "north is up")
        let east = p.project(GeoPoint(lon: 20, lat: 20))!
        check(east.x > 150, "east is right")
    }
    let gnomonic = MapProjection(center: GeoPoint(lon: 0, lat: 0), r: 0, scale: 100, size: CGSize(width: 200, height: 200))
    check(abs(gnomonic.planeRadius(.pi / 4) - 1) < 1e-12, "gnomonic: tan 45° = 1")
    check(gnomonic.project(GeoPoint(lon: 120, lat: 0)) == nil, "gnomonic: nothing beyond 90°")
    let stereo = MapProjection(center: GeoPoint(lon: 0, lat: 0), r: -1, scale: 100, size: CGSize(width: 200, height: 200))
    check(abs(stereo.planeRadius(.pi / 2) - 2) < 1e-12, "stereographic: 2 tan 45° = 2")
    check(stereo.project(GeoPoint(lon: 120, lat: 0)) != nil, "stereographic: beyond 90° too")
}

/// A ring round a small circle: `radius` (radians) about `center`, counterclockwise seen from outside.
private func circle(_ center: Vec3, _ radius: Double, points: Int = 240) -> SphereRing {
    let up = abs(center.z) < 0.9 ? Vec3(0, 0, 1) : Vec3(1, 0, 0)
    let e = normalized(cross(up, center)), n = cross(center, e)
    return SphereRing((0..<points).map { k in
        let a = 2 * Double.pi * Double(k) / Double(points)
        return center * cos(radius) + (e * cos(a) + n * sin(a)) * sin(radius)
    })
}

private func clipChecks() {
    var rng = SplitMix(seed: 41)
    var compared = 0, wrong = 0, cases = 0
    for r in [0.0, -1, -3] {
        for _ in 0..<60 {
            let center = GeoPoint(lon: rng.uniform(-180, 180), lat: rng.uniform(-80, 80))
            let size = CGSize(width: 240, height: 180)
            let p = MapProjection(center: center, r: r, scale: rng.uniform(40, 600), size: size)
            let clipper = MapClipper(p)
            // circles near the centre, across the rim, round the whole view, round the antipode; some clockwise
            // copies given as counterclockwise() would fix them
            let centre = center.vector
            var rings: [(ring: SphereRing, center: Vec3, radius: Double)] = []
            for _ in 0..<4 {
                let near = normalized(centre + Vec3(rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)) * rng.uniform(0, 1.5))
                let radius = rng.uniform(0.05, 1.4)
                rings.append((circle(near, radius), near, radius))
            }
            rings.append((circle(centre, 1.2), centre, 1.2))
            rings.append((circle(-centre, 0.5), -centre, 0.5))
            let reversed = circle(centre, 0.3)
            rings.append((SphereRing(reversed.points.reversed()).counterclockwise(), centre, 0.3))
            for (index, (ring, c, radius)) in rings.enumerated() {
                cases += 1
                let path = clipper.areas([ring])
                var bad = 0
                // off the half-point grid: CoreGraphics' containment test is ambiguous on a vertex's own row
                for gx in stride(from: 6.37, to: size.width, by: 12) {
                    for gy in stride(from: 6.71, to: size.height, by: 12) {
                        let point = CGPoint(x: gx, y: gy)
                        guard let g = p.unproject(point) else { continue }
                        let theta = acos(min(1, dot(g.vector, centre)))
                        guard theta < clipper.cap - 0.01 else { continue }
                        let d = acos(min(1, dot(g.vector, c)))
                        guard abs(d - radius) > 0.01 else { continue } // too close to the edge to call
                        compared += 1
                        if path.contains(point, eoFill: true) != (d < radius) { wrong += 1; bad += 1 }
                    }
                }
                if bad > 0 {
                    let dc = acos(min(1, dot(c, centre)))
                    print("  r \(r) scale \(Int(p.scale)) cap \(Int(clipper.cap * 180 / .pi))° ring \(index) radius \(Int(radius * 180 / .pi))° at \(Int(dc * 180 / .pi))° from centre: \(bad) wrong, loops \(clipper.clipArea(ring).count)")
                }
            }
        }
    }
    check(compared > 50_000, "enough points compared: \(compared) in \(cases) cases")
    check(wrong == 0, "clipped areas fill exactly their inside: \(wrong) of \(compared) points wrong")
    // lines: a meridian through the centre stays whole, one beyond the horizon is gone
    let p = MapProjection(center: GeoPoint(lon: 0, lat: 0), r: 0, scale: 100, size: CGSize(width: 200, height: 200))
    let clipper = MapClipper(p)
    let meridian = SphereRing(stride(from: -60.0, through: 60, by: 1).map { GeoPoint(lon: 0, lat: $0).vector })
    check(clipper.clipLine(meridian).count == 1, "a meridian through the centre is one line")
    let far = SphereRing(stride(from: -60.0, through: 60, by: 1).map { GeoPoint(lon: 180, lat: $0).vector })
    check(clipper.clipLine(far).isEmpty, "the far meridian is off the map")
    let land = WorldMap.layer(.land, directory: resources)
    let started = Date()
    for lon in stride(from: -180.0, to: 180, by: 30) {
        _ = MapClipper(MapProjection(center: GeoPoint(lon: lon, lat: 20), r: -1, scale: 120, size: CGSize(width: 400, height: 800))).areas(land.rings)
    }
    print("12 views of the 1:50m land in \(String(format: "%.0f", Date().timeIntervalSince(started) * 1000)) ms")
}

private func helionDialChecks() {
    let utc = EarthFormatter(timeZone: .gmt)
    let vectorA = 1_791_460_800.0 // 2026-10-08 12:00 UTC
    for series in [141, 145, 117] {
        guard let clock = FractonicaClock.on(series: series), let dial = HelionDial(clock: clock, at: vectorA, earth: utc) else {
            check(false, "Saros \(series): a dial at vector A")
            continue
        }
        check(dial.helions.count == 19, "Saros \(series): 19 Helions in the sync: \(dial.helions.count)")
        check(zip(dial.helions, dial.helions.dropFirst()).allSatisfy { abs($0.end - $1.start) < 0.001 && $1.cycle == $0.cycle + 1 },
              "Saros \(series): the Helions run on from each other")
        check(dial.helions.map(\.pentad) == [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3], "Saros \(series): Pentads 5, 5, 5, 4")
        if let sync = clock.solar(at: vectorA), let info = clock.solarSync(number: sync.sync) {
            check(dial.sync == sync.sync, "Saros \(series): the engine's sync: \(dial.sync) vs \(sync.sync)")
            check(abs(dial.start - info.start) < 0.001 && abs(dial.end - info.end) < 0.001, "Saros \(series): the sync's start and end")
        }
        for helion in dial.helions {
            let middle = (helion.start + helion.node) / 2
            if let p = clock.pentad(at: middle) {
                check(p.index == helion.pentad && p.helion == helion.place, "Saros \(series): \(helion.label) is in Pentad \(p.index) at \(p.helion)")
            }
            if let c = Notation(clock: clock).clock(at: middle) {
                check("\(c.eta)η" == helion.label, "Saros \(series): \(helion.label) is the pure clock's \(c.eta)η")
            }
            check(abs((helion.node - helion.start) * 2 - (helion.end - helion.start)) < 0.01, "the descending node is half way")
        }
        // a Pentad later the nodes come a quarter Helion later in the day; a sync later, the drift earlier
        let h = dial.helions
        let day = { (t: Double) in dial.dayFraction(t) * 86_400 }
        var shift = day(h[5].start) - day(h[0].start)
        if shift < 0 { shift += 86_400 }
        // exactly 5η − 1 day (4¾ Helions fall a few seconds short of a day, so a little under a quarter Helion)
        let fiveHelions = h[5].start - h[0].start
        check(abs(shift - (fiveHelions - 86_400)) < 0.01 && abs(shift - (h[0].end - h[0].start) / 4) < 5,
              "Saros \(series): Pentad II begins 5η − 1 day later in the day: \(shift) s")
        if let next = HelionDial(clock: clock, at: vectorA, earth: utc, sync: 1), let drift = SarosCatalogue.series(series)?.drift(at: vectorA) {
            var back = day(next.start) - day(dial.start)
            if back > 43_200 { back -= 86_400 }
            check(abs(back - drift.perSync) < 0.05, "Saros \(series): the next sync begins \(back) s off in the day, its drift \(drift.perSync)")
            check(next.sync == dial.sync + 1 && abs(next.start - dial.end) < 0.001, "the next sync follows on")
        }
        let nodes = HelionDial.nodes(clock: clock, after: vectorA, count: 50, earth: utc)
        check(nodes.count == 50 && nodes.first!.time > vectorA && zip(nodes, nodes.dropFirst()).allSatisfy { $0.time < $1.time },
              "Saros \(series): 50 nodes after t, in order, running into the next sync")
        check(nodes.filter(\.ascending).count == 25, "ascending and descending in turn")
    }
    // the dial's angles: noon is the bottom of a 24-hour dial and the top of a 12-hour one
    let dial = HelionDial(clock: FractonicaClock.on(series: 141)!, at: vectorA, earth: utc)!
    check(abs(dial.dayFraction(vectorA) - 0.5) < 1e-9, "12:00 UTC is half the day")
    check(abs(dial.angle(vectorA, hours: 24) - .pi) < 1e-9 && abs(dial.angle(vectorA, hours: 12)) < 1e-9, "noon on both dials")
    check(abs(dial.angle(vectorA + 3 * 3600, hours: 12) - .pi / 2) < 1e-9, "15:00 at three o'clock")
    let tokyo = HelionDial(clock: FractonicaClock.on(series: 141)!, at: vectorA, earth: EarthFormatter(zone: "Asia/Tokyo"))!
    check(abs(tokyo.dayFraction(vectorA) - 21.0 / 24) < 1e-9, "the dial reads the zone's time of day: 21:00 in Tokyo")
}

/// A seeded generator, so the checks draw the same cases every run.
private struct SplitMix {
    var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
    mutating func uniform(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * Double(next() >> 11) / Double(1 << 53) }
}
