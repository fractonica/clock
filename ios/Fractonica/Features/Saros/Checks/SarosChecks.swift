import CoreGraphics
import Foundation
import FractonicaKit
import SwiftUI

// The Saros catalogue's data and maps: saros-geo's path files against what its own codec reads (the counts and
// figures below are saros_geo.js's), the path records SarosData points at, the world layers, the projection's
// round trip, and the clipper: rings that are small circles (whose inside is known exactly) on gnomonic,
// stereographic and outside views at random centres and scales, filled even-odd and compared point by point. The
// Helion dial against the engine. The Saros search against a search of every eclipse and the series' own clocks, its
// rarities and whole days; kept dates and their records; echoes landing on the date's phase, each year's solar day,
// merged and shared out within the budget.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Saros/Checks

@main
struct SarosChecks {
    static func main() {
        pathFileChecks()
        worldChecks()
        projectionChecks()
        clipChecks()
        helionDialChecks()
        searchChecks()
        dateChecks()
        echoChecks()
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

// MARK: - The Saros search

private func searchChecks() {
    // the rarities' limits, in Helions
    let cases: [(Double, MomentRarity)] = [(0, .cosmic), (1, .cosmic), (1.0001, .legendary), (11, .legendary), (11.5, .epic),
                                           (77, .epic), (77.01, .rare), (385, .rare), (385.5, .common), (1e9, .common)]
    for (h, r) in cases { check(SarosProximity.rarity(helions: h) == r, "\(h) Helions is \(r): \(SarosProximity.rarity(helions: h))") }
    check(SarosProximity.tiers.map(\.helions) == [1, 11, 77, 385], "1 Helion, a ζ (11), a Nuclide (77), a Delta (385)")
    if let clock = FractonicaClock.on(series: 141) {
        check(clock.levelInfo(6).prefix / clock.levelInfo(5).prefix == 11, "a ζ is 11 Helions")
        check(clock.levelInfo(6).prefix / clock.levelInfo(4).prefix == 77 && clock.levelInfo(6).prefix / clock.levelInfo(3).prefix == 385,
              "a Nuclide 77, a Delta 385")
    }

    // nearest by distance, against every eclipse; the Helions against each running series' own clock
    let times = SarosCatalogue.timeline.map(\.time)
    var rng = SplitMix(seed: 145)
    var clockChecked = 0
    for _ in 0..<300 {
        let t = rng.uniform(SarosSearch.earliest, SarosSearch.latest)
        let matches = SarosSearch.matches(.moment(t))
        let best = times.map { abs($0 - t) }.sorted().prefix(3)
        check(matches.count == 3 && zip(matches.map { abs($0.offset) }, best).allSatisfy { abs($0 - $1) < 1e-6 },
              "the three nearest eclipses to \(t)")
        check(zip(matches, matches.dropFirst()).allSatisfy { abs($0.offset) <= abs($1.offset) }, "nearest first")
        for m in matches {
            check(abs(m.offset - (m.eclipse.time - t)) < 1e-6, "the offset runs from the query to the eclipse")
            // on a clock the series carries, a Helion is 4 / 125 125 of a Saros in position, as the clock counts it
            if let clock = FractonicaClock.on(series: m.eclipse.series), let p = clock.position(at: t) {
                let byClock = abs(p - Double(m.eclipse.ordinal)) * 125_125 / 4
                check(abs(byClock - m.helions) < 1e-6 * max(1, byClock), "Saros \(m.eclipse.series): \(m.helions) Helions, the clock says \(byClock)")
                clockChecked += 1
            }
        }
    }
    check(clockChecked > 300, "the series' own clocks checked \(clockChecked) distances")

    // the Great American Eclipse, 2017-08-21 18:25:32 UTC, Saros 145 #21, by day in three zones
    let la = TimeZone(identifier: "America/Los_Angeles")!, tokyo = TimeZone(identifier: "Asia/Tokyo")!
    let aug21 = 1_503_316_800.0 // 2017-08-21 12:00 UTC
    let onTheDay = SarosSearch.matches(.day(containing: aug21, zone: la))
    check(onTheDay.first?.eclipse.series == 145 && onTheDay.first?.eclipse.ordinal == 21 && onTheDay.first?.offset == 0,
          "during the day in Los Angeles: offset 0")
    check(onTheDay.first?.rarity == .cosmic, "a day with an eclipse in it is cosmic")
    // in Tokyo the eclipse fell at 03:25 on the 22nd: the 21st ends 3 h 25 min before it, within a Helion
    let tokyo21 = SarosSearch.matches(.day(containing: aug21 - 6 * 3600, zone: tokyo)).first!
    check(abs(tokyo21.offset - 12_331) < 2 && tokyo21.rarity == .cosmic, "Tokyo's 21st: 3 h 25 min before (\(tokyo21.offset))")
    let tokyo20 = SarosSearch.matches(.day(containing: aug21 - 30 * 3600, zone: tokyo)).first!
    check(tokyo20.rarity == .legendary && abs(tokyo20.helions - (tokyo21.offset + 86_400) / tokyo20.eclipse.seriesHelion) < 1e-6,
          "Tokyo's 20th: legendary, \(tokyo20.helions) Helions")
    let moment = SarosSearch.matches(.moment(1_503_339_932 + 2 * 18_000)).first!
    check(moment.offset < 0 && moment.rarity == .legendary, "two Helions after it: the eclipse before, legendary")

    // whole days: midnight to midnight in the zone, 23 or 25 hours where the clocks change
    let london = TimeZone(identifier: "Europe/London")!
    let spring = SarosQuery.dayBounds(1_774_785_600, zone: london) // 2026-03-29, the clocks go forward
    check(spring.end - spring.start == 23 * 3600 && spring.start == 1_774_742_400, "London's 29 March 2026 is 23 hours: \(spring)")
    let utcDay = SarosQuery.day(containing: aug21, zone: .gmt)
    check(utcDay.start == 1_503_273_600 && utcDay.end == 1_503_360_000 && utcDay.isDay, "a UTC day")
    check(!SarosQuery.moment(aug21).isDay, "a moment is no span")
    check(SavedDate.noon(of: aug21 + 30_000, zone: la) == 1_503_342_000, "noon in Los Angeles")

    // the search's range: where Foundation's calendar and the catalogue agree
    var gregorian = Calendar(identifier: .gregorian)
    gregorian.timeZone = .gmt
    check(gregorian.date(from: DateComponents(year: 1583, month: 1, day: 1))?.timeIntervalSince1970 == SarosSearch.earliest, "1583-01-01")
    check(gregorian.date(from: DateComponents(year: 3000, month: 1, day: 1))?.timeIntervalSince1970 == SarosSearch.latest, "3000-01-01")
    // historic days find their eclipses in series that have ended: 1700 is past every series that ran then
    let old = SarosSearch.matches(.moment(-8_520_336_000)) // 1700-01-01
    check(old.contains { !SarosCatalogue.ongoing.contains($0.eclipse.series) }, "1700: ended series among the nearest: \(old.map(\.eclipse.series))")
}

private extension SarosEclipse {
    /// The Helion of its series, of the Saros before it.
    var seriesHelion: Double { SarosCatalogue.anySeries(series)!.helion(near: ordinal, after: false) }
}

// MARK: - Dates

private func dateChecks() {
    check(SavedDate.kind == JournalStore.dateKind && SavedDate.kind.hasPrefix("journal."), "dates are journal.date records, editable on any device")
    let date = SavedDate(id: "d1", time: 1_503_340_200, zone: "America/Los_Angeles", allDay: false, emoji: "🌑",
                         title: "Totality", text: "Oregon", echoes: DateEchoSettings(solarDay: true, solarMinute: 600, periods: [6, 4]))
    var record = date.record(updating: nil, now: 1_800_000_000)
    check(record.kind == "journal.date" && record.time == date.time && record.zone == date.zone, "the record's fields")
    check(record.data["saros"]?.number == 145 && record.data["rarity"]?.string == "cosmic", "its nearest eclipse's series and rarity alongside")
    check(record.data["text"]?.string == "Oregon" && record.data["emoji"]?.string == "🌑", "the hub reads data.emoji, data.title and data.text")
    let back = SavedDate(record: record)
    check(back?.echoes.periods == [4, 6] && back?.echoes.solarMinute == 600 && back?.echoes.solarDay == true, "echoes round-trip, periods in order")
    var expected = date
    expected.echoes.periods = [4, 6]
    check(back == expected, "a date round-trips through its record")
    // a newer client's fields stay; the hub's fields stay
    record.data = .object((record.data.object ?? [:]).merging(["colour": .string("teal")]) { a, _ in a })
    record.rev = 42
    var edited = back!
    edited.title = "Totality!"
    edited.emoji = nil
    let again = edited.record(updating: record, now: 1_800_000_100)
    check(again.data["colour"]?.string == "teal" && again.rev == 42 && again.data["emoji"] == nil, "unknown fields kept, a cleared emoji goes")
    check(SavedDate(record: HubRecord(id: "x", kind: "journal.entry", time: 0, data: .object([:]), created: 0, updated: 0)) == nil, "other kinds are no dates")
    var tomb = record
    tomb.deleted = true
    check(SavedDate(record: tomb) == nil, "a tombstone is no date")
    // echo settings from JSON: unknown levels and repeats dropped, the minute clamped
    let settings = DateEchoSettings(json: .object(["solarDay": .bool(true), "at": .number(3000), "periods": .array([.number(6), .number(9), .number(6), .number(0)])]))
    check(settings.periods == [0, 6] && settings.solarMinute == 1439 && settings.solarDay, "echo settings are sanitised: \(settings)")
    var toggled = DateEchoSettings()
    toggled.set(3, true)
    toggled.set(3, true)
    toggled.set(5, true)
    toggled.set(3, false)
    check(toggled.periods == [5] && DateEchoSettings().isEmpty, "periods turn on and off")
    check(SavedDate(time: 0, zone: "UTC", allDay: true, emoji: "🎂").name == "🎂" && SavedDate(time: 0, zone: "UTC", allDay: true).name == "Untitled date",
          "a date's name")
    // what the search measures from: a whole day in the date's zone, or the moment
    let day = SavedDate(time: 1_503_342_000, zone: "America/Los_Angeles", allDay: true)
    check(day.query.isDay && day.query.end - day.query.start == 86_400 && day.query.start == 1_503_298_800, "a whole day in its zone")
    check(!date.query.isDay, "a moment")
    let words = DateWords(pure: false, notation: Notation(clock: .shared))
    check(words.when(day) == "Mon 21 Aug 2017" && words.when(date) == "Mon 21 Aug 2017, 11:30", "Earth words: \(words.when(day)), \(words.when(date))")
    let pure = DateWords(pure: true, notation: Notation(clock: .shared))
    check(pure.when(day).hasPrefix("α#") && !pure.when(day).contains("2017"), "pure words: \(pure.when(day))")
}

// MARK: - Echoes

private func echoChecks() {
    let clock = FractonicaClock.on(series: 141)!
    let notation = Notation(clock: clock)
    let utc = TimeZone.gmt
    let now = 1_794_139_200.0 // 2026-11-08 12:00 UTC
    // a birthday: every year on 12 May at 09:00 (in the app's zone), from the year after
    var birthday = SavedDate(id: "b", time: SavedDate.noon(of: 579_430_000, zone: utc), zone: "UTC", allDay: true, emoji: "🎂", title: "Birthday")
    check(birthday.time == 579_441_600, "noon of 12 May 1988")
    birthday.echoes.solarDay = true
    let years = DateEchoPlanner.solarDays(of: birthday, after: now, zone: utc, count: 3)
    check(years.map(\.kind) == [.solarDay(year: 2027), .solarDay(year: 2028), .solarDay(year: 2029)], "the next three years: \(years.map(\.kind))")
    check(years.first?.time == 1_810_112_400, "12 May 2027 09:00 UTC: \(years.first?.time ?? 0)")
    let kyiv = TimeZone(identifier: "Europe/Kyiv")!
    check(DateEchoPlanner.solarDays(of: birthday, after: now, zone: kyiv, count: 1).first?.time == 1_810_112_400 - 3 * 3600,
          "at 09:00 in the app's zone")
    // a leap day: the 28th in other years
    let leap = SavedDate(id: "l", time: 951_825_600, zone: "UTC", allDay: true, echoes: DateEchoSettings(solarDay: true, solarMinute: 0))
    let leaps = DateEchoPlanner.solarDays(of: leap, after: now, zone: utc, count: 2)
    check(leaps.map(\.time) == [1_803_772_800, 1_835_395_200], "29 February echoes on 28 Feb 2027, 29 Feb 2028: \(leaps.map(\.time))")
    // a date to come echoes only after it
    let future = SavedDate(id: "f", time: now + 400 * 86_400, zone: "UTC", allDay: true, echoes: DateEchoSettings(solarDay: true))
    check(DateEchoPlanner.solarDays(of: future, after: now, zone: utc, count: 1).first.map { $0.time > future.time } == true, "a future date echoes the year after")

    // period echoes: the same reading below the period, in every later cycle
    let first = SavedDate(id: "p", time: 579_368_123.4, zone: "UTC", allDay: false)
    for level in DateEchoSettings.levels {
        let echoes = DateEchoPlanner.periods(of: first, level: level, after: now, clock: clock, count: 4)
        let name = DateEchoPlanner.periodName(level)
        guard let e = echoes.first else {
            check(level == 0, "\(name): echoes left inside the catalogue")
            continue
        }
        check(e.time > now, "\(name): the first echo is to come")
        let phase = DateEchoPlanner.phase(level: level, at: first.time, notation: notation)
        for echo in echoes {
            check(DateEchoPlanner.phase(level: level, at: echo.time, notation: notation) == phase,
                  "\(name): back at \(phase ?? "?"), read \(DateEchoPlanner.phase(level: level, at: echo.time, notation: notation) ?? "?")")
            if case .period(_, let cycle) = echo.kind, let reading = clock.level(at: echo.time, level) {
                check(reading.cycle == cycle, "\(name): in cycle \(cycle), the clock reads \(reading.cycle)")
            }
            // the same position within the cycle, to a millisecond's worth
            if let p0 = clock.position(at: first.time), let p1 = clock.position(at: echo.time) {
                let scale = clock.levelInfo(level).prefixDouble / 4
                let f0 = p0 * scale - (p0 * scale).rounded(.down), f1 = p1 * scale - (p1 * scale).rounded(.down)
                check(abs(f0 - f1) * clock.levelInfo(level).meanSeconds < 0.002, "\(name): the same phase, \(f0) and \(f1)")
            }
        }
        check(zip(echoes, echoes.dropFirst()).allSatisfy { abs(($1.time - $0.time) / clock.levelInfo(level).meanSeconds - 1) < 0.01 },
              "\(name): a cycle apart")
        if level == 4 { check(phase?.hasSuffix("ι") == true && phase?.split(separator: " ").count == 2, "a Nuclide's phase: \(phase ?? "")") }
        if level == 3 { check(phase?.hasPrefix("ε#") == true, "a Delta's phase: \(phase ?? "")") }
        if level == 5 { check(phase?.contains("of 11") == true, "a ζ's phase: \(phase ?? "")") }
    }
    check(DateEchoPlanner.periods(of: SavedDate(time: -20_000_000_000, zone: "UTC", allDay: false), level: 4, after: now, clock: clock, count: 3).isEmpty,
          "outside the catalogue: no period echoes")

    // a Nuclide's echo is one of its Helion too: merged under the Nuclide
    var both = first
    both.echoes.periods = [4, 6]
    // (enough Helions to reach the first Nuclide's echo, 16 days on)
    let merged = DateEchoPlanner.echoes(of: both, after: now, clock: clock, zone: utc, limit: 100)
    let nuclide = merged.first { $0.level == 4 }
    check(nuclide?.also == [6], "the Nuclide's echo also the Helion's: \(nuclide?.also ?? [])")
    check(Set(merged.map(\.id)).count == merged.count, "echo identifiers are unique")
    check(merged.allSatisfy { $0.id.hasPrefix("echo.p.") }, "identifiers carry the date: \(merged.first?.id ?? "")")

    // the plan: within the budget, each date's soonest of each kind first
    var helions = first
    helions.echoes.periods = [6]
    let plan = DateEchoPlanner.plan([helions, birthday], after: now, clock: clock, zone: utc)
    check(plan.count == DateEchoPlanner.budget, "\(DateEchoPlanner.budget) echoes pending: \(plan.count)")
    check(plan.contains { $0.dateID == "b" }, "a Helion's echoes do not crowd out a year's")
    check(zip(plan, plan.dropFirst()).allSatisfy { $0.time <= $1.time }, "soonest first")
    check(AlertPlanner.budget + 12 + DateEchoPlanner.budget + 1 <= 64, "Alerts, Moments, echoes and Timer share the 64 pending requests")

    // the notification's words
    let text = DateEchoText(pure: false, notation: notation)
    let y = DateEcho(dateID: "b", kind: .solarDay(year: 2027), time: years[0].time)
    check(text.title(birthday, y) == "🎂 Birthday", "title: the date's name")
    check(text.body(birthday, y) == "Echo: the same solar day, 39 years on — Thu 12 May 1988.", "solar body: \(text.body(birthday, y))")
    if let e = nuclide {
        let body = text.body(both, e)
        check(body.hasPrefix("Echo of the Nuclide: the clock is back at ") && body.hasSuffix("(and of the Helion)."), "period body: \(body)")
    }
    let pureText = DateEchoText(pure: true, notation: notation)
    check(!pureText.body(birthday, y).contains("1988") && !pureText.body(both, nuclide!).contains("1988"), "pure bodies have no Gregorian dates")
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
