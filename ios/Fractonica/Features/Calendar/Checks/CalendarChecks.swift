import FractonicaKit
import Foundation

// The calendar's mapping maths against the web app's semantics (src/ui/calendar/convert.js, month.js, pure-conv.js and
// test/calendar.test.js): position round trips, addresses and landings, local days across clock changes, the month
// grid and its bands, the day's boundaries, the year ribbon, pure counters, reading pure dates back to their first
// millisecond, the Delta page, and fixture.json (make-calendar-fixture.mjs runs the JavaScript itself). Run: ios/scripts/check.sh ios/Fractonica/Features/Calendar/Checks

@main
struct CalendarChecks {
    static func main() {
        positionChecks()
        addressChecks()
        stepChecks()
        isoChecks()
        wallTimeChecks()
        dayChecks()
        monthChecks()
        dayEventChecks()
        ribbonChecks()
        pureCounterChecks()
        pureInputChecks()
        pureWordChecks()
        deltaPageChecks()
        pentadCalendarChecks()
        webFixtureChecks()
        Checks.finish()
    }
}

private let clock = FractonicaClock.shared
private let vectorA = 1_791_460_800.0 // SPEC §12 vector A, 2026-10-08 12:00 UTC
private let utc = TimeZone(identifier: "UTC")!

private func samples(_ n: Int, seed: UInt64 = 7) -> [Double] {
    var g = seed
    return (0..<n).map { _ in
        g = g &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
        let u = Double(g >> 11) / Double(1 << 53)
        return CalMath.r3(clock.tMin + u * (clock.tMax - clock.tMin))
    }
}

private func positionChecks() {
    let p = CalMath.position(clock, at: vectorA)
    check(p?.ordinal == 22 && p?.fraction.hasPrefix("9278502166") == true, "vector A sits at position 22.92785021…: \(String(describing: p))")
    check(p?.fraction.count == 15, "15 digits after the point")
    // Gregorian -> position -> Gregorian reproduces the instant to 1 ms
    var worst = 0.0
    for t in samples(400) + [clock.tMin, clock.tMax, vectorA] {
        guard let pos = CalMath.position(clock, at: t), case .success(let back) = CalMath.time(clock, positionText: "\(pos.ordinal).\(pos.fraction)") else {
            check(false, "position round trip failed at \(t)")
            continue
        }
        worst = max(worst, abs(CalMath.r3(back) - t))
    }
    check(worst <= 0.001, "position round trips stay within 1 ms (worst \(worst) s)")
    check(CalMath.position(clock, at: clock.tMax)?.ordinal == clock.extent, "the closing instant is position \(clock.extent)")
    check(CalMath.position(clock, at: clock.tMin - 1) == nil, "no position before the catalogue")
    if case .failure = CalMath.time(clock, positionText: "70") {} else { check(false, "position 70 is refused") }
    if case .failure = CalMath.time(clock, positionText: "abc") {} else { check(false, "text is refused") }
    if case .success(let t) = CalMath.time(clock, positionText: "69") { check(t == clock.tMax, "position 69 is the end") }
    let around = CalMath.eclipses(clock, around: vectorA)
    check(around.previous == 22 && around.next == 23, "vector A lies between eclipses #22 and #23: \(around)")
    check(CalMath.eclipse(clock, in: clock.catalogue[22] - 1, clock.catalogue[22] + 1) == 22, "the eclipse of a window")
}

private func addressChecks() {
    check(CalMath.path(clock, at: vectorA, depth: 5) == clock.address(at: vectorA), "the path is the clock's address at depth 5")
    check(CalMath.childCount(clock, parent: []) == 18, "18 Alphas")
    check(CalMath.childCount(clock, parent: [6]) == 5, "an Alpha holds 5 Betas")
    let lastBetas = CalMath.childCount(clock, parent: [18])
    check(lastBetas >= 1 && lastBetas < 5, "the clipped last Alpha holds fewer Betas: \(lastBetas)")
    check(CalMath.normalize(clock, path: [40, 9, 0]) == [18, lastBetas, 1], "normalize clamps every entry: \(CalMath.normalize(clock, path: [40, 9, 0]))")
    for t in samples(60, seed: 3) {
        for depth in [3, 5, 7, 9] {
            guard let path = CalMath.path(clock, at: t, depth: depth) else { continue }
            guard let begin = CalMath.time(clock, path: path, point: .begin) else {
                check(false, "every running cycle has a start: \(path)")
                continue
            }
            check(CalMath.path(clock, at: begin, depth: depth) == path, "the landed begin shows the same path at depth \(depth): \(path)")
            check(CalMath.path(clock, at: begin - 0.001, depth: depth) != path, "one millisecond earlier is the previous cycle (depth \(depth))")
            if let node = CalMath.time(clock, path: path, point: .node), let l = clock.level(at: node, depth - 1) {
                check(l.phase >= 0.5 && l.phase < 0.5 + 1e-6 * 4, "the node lands at phase ½: \(l.phase)")
            }
        }
    }
    // landing on a boundary computed in float shows the cycle that begins there
    for b in clock.boundaries(level: 6, from: vectorA, to: vectorA + 10 * 86_400) {
        let landed = CalMath.landOn(clock, b.time, level: 6)
        check(clock.level(at: landed, 6)?.cycle == b.idx, "landOn shows η cycle \(b.idx)")
    }
    let range = CalMath.syncRange(clock)
    check(clock.solarSync(number: range.lowerBound) != nil && clock.solarSync(number: range.lowerBound - 1) == nil, "the first full sync")
    check(clock.solarSync(number: range.upperBound) != nil && clock.solarSync(number: range.upperBound + 1) == nil, "the last full sync")
}

private func stepChecks() {
    // + on the last ε of a δ carries into the next δ's first ε (the odometer way); − carries back
    let path = CalMath.path(clock, at: vectorA, depth: 5)!
    check(path == [6, 4, 9, 3, 5], "vector A's address: \(path)")
    check(CalMath.step(clock, path: path, level: 4, by: 1) == [6, 4, 9, 4, 1], "ε#5 + 1 is the next δ's ε#1")
    check(CalMath.step(clock, path: [6, 4, 9, 4, 1], level: 4, by: -1) == [6, 4, 9, 3, 5], "ε#1 − 1 is the previous δ's ε#5")
    check(CalMath.step(clock, path: [6, 5, 13, 5, 2], level: 1, by: 1) == [7, 1, 13, 5, 2], "β#5 + 1 carries into the next α, finer entries kept")
    check(CalMath.step(clock, path: [1, 1, 1], level: 2, by: -1) == nil, "nothing before the first γ")
    let last = clock.cycleToPath(level: 3, cycle: Int64(clock.count(3)) - 1)
    check(CalMath.step(clock, path: last, level: 3, by: 1) == nil, "nothing after the last δ")
    check(CalMath.step(clock, path: last, level: 3, by: -1) != nil, "the last δ steps back")
    // a step into the clipped last cycles clamps the finer entries into what exists
    let lastAlpha = CalMath.childCount(clock, parent: [18])
    if let p = CalMath.step(clock, path: [17, 5, 13], level: 0, by: 1) {
        check(p[0] == 18 && p[1] <= lastAlpha && clock.pathToCycle(p) != nil, "stepping into the clipped last α keeps a path that exists: \(p)")
    } else {
        check(false, "α#17 steps into α#18")
    }
    check(CalMath.nominalCount(clock, parent: []) == 18 && CalMath.nominalCount(clock, parent: [6]) == 5 && CalMath.nominalCount(clock, parent: [6, 4]) == 13,
          "nominal counts follow the hierarchy")
    check(CalMath.nominalCount(clock, parent: [18]) == 5 && CalMath.childCount(clock, parent: [18]) < 5, "the clipped α: nominally 5 β, fewer in the catalogue")
    // stepping η by one at depth 7 moves by exactly one η cycle
    let deep = CalMath.path(clock, at: vectorA, depth: 7)!
    if let next = CalMath.step(clock, path: deep, level: 6, by: 1) {
        check(clock.pathToCycle(next)! == clock.pathToCycle(deep)! + 1, "η + 1 is the next η")
    }
}

private func wallTimeChecks() {
    let berlin = TimeZone(identifier: "Europe/Berlin")!
    let gap = EarthTime.CivilTime(year: 2026, month: 3, day: 29, hour: 2, minute: 30)
    let fold = EarthTime.CivilTime(year: 2026, month: 10, day: 25, hour: 2, minute: 30)
    let fine = EarthTime.CivilTime(year: 2026, month: 10, day: 8, hour: 14, minute: 0)
    check(CalMath.wallTimeIssue(gap, zone: berlin) == .gap, "02:30 on Berlin's spring-forward day does not exist")
    check(CalMath.wallTimeIssue(fold, zone: berlin) == .fold, "02:30 on Berlin's fall-back day happens twice")
    check(CalMath.wallTimeIssue(fine, zone: berlin) == nil, "an ordinary wall time happens once")
    check(CalMath.wallTimeIssue(gap, zone: utc) == nil, "UTC has no gaps")
    let earth = EarthFormatter(timeZone: berlin)
    let t = EarthTime.zonedToUnix(gap, zone: berlin)
    let note = CalMath.wallTimeNote(gap, zone: berlin, resolved: t, earth: earth, place: "Berlin")
    check(note == "02:30 does not exist in Berlin (the clocks skip it): moved ahead to 03:30", "the gap sentence: \(note ?? "nil")")
    check(CalMath.wallTimeNote(fold, zone: berlin, resolved: 0, earth: earth, place: "Berlin") == "02:30 happens twice in Berlin (the clocks go back): showing the first", "the fold sentence")
    // ISO: the wall fields come back only for a time without an offset
    check(CalMath.readISO("2026-03-29T02:30", zone: berlin)?.wall == gap, "a wall time without an offset is reported")
    check(CalMath.readISO("2026-03-29T02:30+01:00", zone: berlin)?.wall == nil, "with an offset it is an instant")
    check(CalMath.readISO("2026-03-29", zone: berlin)?.wall == nil, "a date alone is its day's start, not a wall time")
    check(EarthTime.zonedToUnix(.init(year: 1583, month: 1, day: 1), zone: utc) == -12_212_553_600, "1583-01-01 UTC, the first day of the converter's date picker")
}

private func pureWordChecks() {
    check(CalPureMath.madeOf(level: 3) == "5ε" && CalPureMath.madeOf(level: 4) == "77η" && CalPureMath.madeOf(level: 6) == "36ι", "units are made of the next unit: \(CalPureMath.madeOf(level: 4))")
    check(CalPureMath.madeOf(level: 5) == "11η" && CalPureMath.madeOf(level: 7) == "4ι", "a depth between units is said in the unit below: \(CalPureMath.madeOf(level: 5))")
    check(CalPureMath.madeOf(level: 13).isEmpty == false && CalPureMath.madeOf(level: 12) == "", "the Blink is the finest unit; ξ is a fraction of it: \(CalPureMath.madeOf(level: 13))")
}

private func isoChecks() {
    let moscow = TimeZone(identifier: "Europe/Moscow")!
    check(CalMath.parseISO("2026-10-08T12:00:00.000+00:00", zone: moscow) == vectorA, "ISO with an offset")
    check(CalMath.parseISO("2026-10-08T15:00:00+03:00", zone: utc) == vectorA, "ISO with another offset")
    check(CalMath.parseISO("2026-10-08T12:00Z", zone: moscow) == vectorA, "ISO in UTC, minutes only")
    check(CalMath.parseISO("2026-10-08 15:00", zone: moscow) == vectorA, "a wall time is read in the zone")
    check(CalMath.parseISO("2026-10-08T12:00:00.25Z", zone: utc) == vectorA + 0.25, "milliseconds")
    check(CalMath.parseISO("2026-10-08", zone: utc) == vectorA - 43_200, "a date alone is its midnight")
    for bad in ["2026-02-30", "2026-13-01", "2026-10-08T24:00", "yesterday", "2026-10-08T12:00+25:00"] {
        check(CalMath.parseISO(bad, zone: utc) == nil, "“\(bad)” is refused")
    }
}

private func dayChecks() {
    let berlin = TimeZone(identifier: "Europe/Berlin")!
    let d0 = CalMath.dayStart(berlin, 2026, 3, 29)
    let d1 = CalMath.dayStart(berlin, 2026, 3, 30)
    check(d1 - d0 == 23 * 3600, "Berlin's spring-forward day lasts 23 h: \((d1 - d0) / 3600)")
    let f0 = CalMath.dayStart(berlin, 2026, 10, 25)
    let f1 = CalMath.dayStart(berlin, 2026, 10, 26)
    check(f1 - f0 == 25 * 3600, "Berlin's fall-back day lasts 25 h")
    // a zone whose clocks skipped midnight: the day starts at 01:00
    let saoPaulo = TimeZone(identifier: "America/Sao_Paulo")!
    let s = CalMath.dayStart(saoPaulo, 2018, 11, 4)
    let parts = EarthTime.zonedParts(s, zone: saoPaulo)
    check(parts.day == 4 && parts.hour == 1 && parts.minute == 0, "São Paulo 2018-11-04 begins at 01:00: \(parts)")
    // a date the zone skipped altogether lasts 0
    let apia = TimeZone(identifier: "Pacific/Apia")!
    check(CalMath.dayStart(apia, 2011, 12, 30) == CalMath.dayStart(apia, 2011, 12, 31), "Apia skipped 2011-12-30")
    check(CalMath.weekday(2026, 10, 8) == 4, "2026-10-08 is a Thursday")
    check(CalMath.yearMonth(CalMath.monthIndex(year: 2026, month: 10)) == (2026, 10), "month index round trip")
    check(CalMath.clampMonth(0) == CalMath.firstMonth, "months clamp to January 1613")
}

private func monthChecks() {
    let range = CalMath.syncRange(clock)
    let grid = CalMonthGrid(clock: clock, zone: utc, year: 2026, month: 10, weekStart: 1, bands: [.level(4), .level(6), .sync], syncRange: range)
    check(grid.days.count == 42, "six weeks")
    check(grid.days[0].year == 2026 && grid.days[0].month == 9 && grid.days[0].day == 28, "October 2026 starts on Monday 28 September: \(grid.days[0].key)")
    check(grid.days.filter(\.inMonth).count == 31, "31 days in October")
    check(zip(grid.days, grid.days.dropFirst()).allSatisfy { $0.end == $1.start }, "days are contiguous")
    let sunday = CalMonthGrid(clock: clock, zone: utc, year: 2026, month: 10, weekStart: 0, bands: [], syncRange: range)
    check(sunday.days[0].weekday == 0 && sunday.days[0].day == 27, "Sunday-first starts on 27 September")
    // every η boundary of the grid appears exactly once as a segment that starts in its day, at its time of day
    let etaStarts = clock.boundaries(level: 6, from: grid.start, to: grid.end - 0.001, limit: 2000).map(\.time)
    var seen: [Double] = []
    var ok = true
    for day in grid.days {
        let track = day.tracks.first { $0.band == .level(6) }!
        var x = 0.0
        for s in track.segments {
            if s.x0 < x - 1e-12 || s.x1 < s.x0 || s.x1 > 1 { ok = false }
            x = s.x1
            if s.startsHere {
                seen.append(s.start)
                if abs(day.start + s.x0 * day.length - s.start) > 1e-3 { ok = false }
            }
        }
        if abs(x - 1) > 1e-9 { ok = false }
    }
    check(ok, "η segments tile each day in order and sit at their time of day")
    check(seen == etaStarts, "every η boundary appears once: \(seen.count) of \(etaStarts.count)")
    let ordinals = grid.days.flatMap { $0.tracks[0].segments.filter(\.startsHere) }.map(\.ordinal)
    check(!ordinals.isEmpty && ordinals.allSatisfy { (1...5).contains($0) }, "ε ordinals are 1…5 in their δ")
    let sync = grid.days.flatMap { $0.tracks[2].segments }
    check(!sync.isEmpty && sync.allSatisfy { (0...3).contains($0.ordinal) }, "the sync band shows quarters")
    check(grid.dayIndex(of: vectorA) == grid.days.firstIndex { $0.day == 8 && $0.inMonth }, "vector A falls on the 8th")
    // the catalogue's first month: days before 19 May 1613 lie outside, the 19th is cut where the catalogue starts
    let first = CalMonthGrid(clock: clock, zone: utc, year: 1613, month: 5, weekStart: 1, bands: [.level(4)], syncRange: range)
    let may18 = first.days.first { $0.inMonth && $0.day == 18 }!
    let may19 = first.days.first { $0.inMonth && $0.day == 19 }!
    check(!may18.inRange && may18.tracks.isEmpty, "18 May 1613 lies before the catalogue")
    check(may19.inRange && may19.rangeFrom > 0 && may19.tracks[0].segments.first!.x0 >= may19.rangeFrom - 1e-9, "19 May 1613 starts its band where the catalogue starts")
    let last = CalMonthGrid(clock: clock, zone: utc, year: 2857, month: 6, weekStart: 1, bands: [.level(6)], syncRange: range)
    let june14 = last.days.first { $0.inMonth && $0.day == 14 }!
    check(!june14.inRange, "14 June 2857 lies after the catalogue")
    let berlin = CalMonthGrid(clock: clock, zone: TimeZone(identifier: "Europe/Berlin")!, year: 2026, month: 3, weekStart: 1, bands: [.level(5)], syncRange: range)
    check(berlin.days.first { $0.inMonth && $0.day == 29 }!.length == 23 * 3600, "a 23-hour day in the grid")
}

private func dayEventChecks() {
    let range = CalMath.syncRange(clock)
    // a day with a δ boundary: listed once, under δ, with the finer levels beginning with it
    let delta = clock.boundaries(level: 3, from: vectorA, to: vectorA + 120 * 86_400).first!
    let day = CalMath.dayStart(utc, EarthTime.zonedParts(delta.time, zone: utc).year, EarthTime.zonedParts(delta.time, zone: utc).month, EarthTime.zonedParts(delta.time, zone: utc).day)
    let events = CalDayEvents(clock: clock, from: day, to: day + 86_400, syncRange: range)
    let hit = events.boundaries.first { abs($0.time - delta.time) < 0.002 }
    check(hit?.level == 3 && hit?.finest == 6, "a δ boundary is listed once, under δ, down to η: \(String(describing: hit))")
    check(zip(events.boundaries, events.boundaries.dropFirst()).allSatisfy { $0.time < $1.time }, "boundaries in order")
    check(events.boundaries.allSatisfy { $0.time >= day && $0.time < day + 86_400 }, "only the day's boundaries")
    let etas = events.boundaries.filter { $0.finest == 6 }.count
    check(etas >= 4 && etas <= 6, "about five η boundaries a day: \(etas)")
}

private func ribbonChecks() {
    let r = CalYearRibbon(clock: clock, zone: utc, year: 2026)
    check(r.months.count == 12 && r.months[0].x0 == 0 && abs(r.months[11].x1 - 1) < 1e-12, "12 months span the year")
    check(r.ticks.contains { $0.level == 3 } && r.ticks.filter { $0.level == 4 }.count >= 20, "δ and ε ticks")
    check((4.4...4.6).contains(r.deltaCover ?? 0) && (22...23).contains(r.epsilonCover ?? 0), "a year covers ≈ 4.5 δ and ≈ 22.6 ε: \(r.summary)")
    check(r.summary.hasPrefix("2026 covers 4.5 δ cycles (γ#"), "summary: \(r.summary)")
    check(CalYearRibbon(clock: clock, zone: utc, year: 1600).summary == "1600 lies outside the catalogue", "outside the catalogue")
}

private func pureCounterChecks() {
    let n = Notation.standard
    let ranges = CalPureEntry.allCases.map { $0.range(clock) }
    check(ranges == [1...18, 1...5, 1...13, 1...5, 1...5, 1...77, 0...35, 0...64, 0...24], "the ranges come from the hierarchy: \(ranges)")
    let c = CalPureCounters(n, at: vectorA)!
    check(c[.eta] >= 1 && c[.eta] <= 77, "the Helion is numbered 1–77")
    for t in samples(40, seed: 11) {
        guard let cur = CalPureCounters(n, at: t) else { continue }
        for entry in [CalPureEntry.epsilon, .eta, .iota, .lambda, .nu, .delta] {
            let r = entry.range(clock)
            let target = cur[entry] == r.upperBound ? r.lowerBound : cur[entry] + 1
            guard case .success(let moved) = CalPureMath.set(clock, t, entry, to: target), let after = CalPureCounters(n, at: moved) else { continue }
            check(after[entry] == target, "setting \(entry.sym) to \(target) shows it")
            let finer = CalPureEntry.allCases.filter { $0 > entry && $0 != .nu }
            check(finer.allSatisfy { after[$0] == cur[$0] }, "what is finer than \(entry.sym) keeps its place")
        }
    }
    if case .failure = CalPureMath.set(clock, vectorA, .eta, to: 0) {} else { check(false, "0η is refused") }
    if case .failure = CalPureMath.set(clock, vectorA, .iota, to: 36) {} else { check(false, "36ι is refused") }
}

private func pureInputChecks() {
    let n = Notation.standard
    // every stamp reads back at its first millisecond
    for t in samples(120, seed: 5) {
        for upTo in ["epsilon", "eta", "iota", "lambda", "nu"] {
            let stamp = n.stamp(at: t, upTo: upTo)
            guard case .success(let back) = CalPureInput.read(stamp, clock: clock, ref: nil) else {
                check(false, "the stamp \(stamp) reads back")
                continue
            }
            check(n.stamp(at: back, upTo: upTo) == stamp && back <= t + 0.0005, "\(stamp) reads back to a moment that shows it, not after it")
            check(n.stamp(at: back - 0.001, upTo: upTo) != stamp, "\(stamp) lands on its first millisecond")
        }
        // the short date in words reads back inside the shown Gamma
        let words = n.dateText(at: t, upTo: "iota")
        if case .success(let back) = CalPureInput.read(words, clock: clock, ref: t) {
            check(n.dateText(at: back, upTo: "iota") == words, "\(words) reads back")
        } else {
            check(false, "the short date \(words) reads back")
        }
    }
    let at = CalPureCounters(n, at: vectorA)!
    if case .success(let t) = CalPureInput.read("34η 17ι", clock: clock, ref: vectorA), let c = CalPureCounters(n, at: t) {
        check(c[.eta] == 34 && c[.iota] == 17 && c[.lambda] == 0 && c[.epsilon] == at[.epsilon], "counts alone are read in the shown Nuclide")
    } else {
        check(false, "34η 17ι reads")
    }
    if case .success(let t) = CalPureInput.read("Delta Trifracton Node", clock: clock, ref: vectorA) {
        check(n.quarter(at: t, level: 3) == 1 && n.quarter(at: t - 0.001, level: 3) == 0, "a quarter word on the finest entry is where that quarter begins")
    } else {
        check(false, "Delta Trifracton Node reads")
    }
    if case .success(let t) = CalPureInput.read("6.4.9", clock: clock, ref: nil) {
        check(n.stamp(at: t, upTo: "epsilon").hasPrefix("α#6 β#4 γ#9 δ#1 ε#1"), "6.4.9 is the start of γ#9 of β#4 of α#6: \(n.stamp(at: t, upTo: "epsilon"))")
    }
    if case .success(let t) = CalPureInput.read("pos 22.5", clock: clock, ref: nil) {
        check(abs((clock.position(at: t) ?? 0) - 22.5) < 1e-9, "pos 22.5")
    }
    if case .success(let t) = CalPureInput.read("sync 4820", clock: clock, ref: nil) {
        check(clock.solar(at: t)?.sync == 4820, "sync 4820")
    }
    for bad in ["2026-10-08", "12:30", "0η", "ζ#5", "Epsilon Trifracton", "δ#3 34η", "hello", "α#19"] {
        if case .success = CalPureInput.read(bad, clock: clock, ref: vectorA) { check(false, "“\(bad)” is refused") }
    }
    if case .failure(let e) = CalPureInput.read("2026-10-08", clock: clock, ref: vectorA) {
        check(e.message.hasPrefix("Dates and clock times are off"), "Gregorian input gets the pure-mode answer")
    }
}

private func deltaPageChecks() {
    let range = CalMath.syncRange(clock)
    check(CalDeltaPage.count(clock) == 5607, "5607 Delta pages")
    check(CalDeltaPage.columnHelion == [1, 12, 23, 34, 45, 56, 67], "columns begin at 1η 12η … 67η")
    let index = CalDeltaPage.page(clock, at: vectorA)!
    let page = CalDeltaPage(clock: clock, index: index, syncRange: range)
    check(page.cells.count == 35, "35 cells")
    check(zip(page.cells, page.cells.dropFirst()).allSatisfy { $0.end == $1.start }, "cells are contiguous")
    let n = Notation.standard
    for cell in page.cells {
        let c = CalPureCounters(n, at: cell.start)!
        if c[.epsilon] != cell.epsilon || c[.eta] != cell.firstHelion {
            check(false, "cell \(cell.index) begins at ε#\(cell.epsilon) \(cell.firstHelion)η, the clock says ε#\(c[.epsilon]) \(c[.eta])η")
        }
        let before = CalPureCounters(n, at: cell.start - 0.001)!
        if before[.eta] == cell.firstHelion, before[.epsilon] == cell.epsilon { check(false, "cell \(cell.index) starts on its first millisecond") }
    }
    check(page.cellIndex(clock, at: vectorA) != nil, "vector A is on its page")
    let d = CalPureCounters(n, at: vectorA)!
    check(page.delta == d[.delta] && page.path == [d[.alpha], d[.beta], d[.gamma]], "the page's place is the clock's: \(page.path) δ#\(page.delta)")
    check(CalDeltaPage.page(clock, alpha: d[.alpha], beta: d[.beta], gamma: d[.gamma], delta: d[.delta]) == index, "page from its path")
    let quarters = page.cells.flatMap(\.quarters).filter(\.startsHere)
    check(quarters.map(\.quarter) == [0, 1, 2, 3], "four quarters begin on the page")
    let thresholds = page.cells.filter { $0.quarters.contains { $0.startsHere && $0.quarter > 0 } }.map(\.index)
    check(thresholds == [8, 17, 26], "the quarters begin in cells 8, 17 and 26 (1¼, 2½, 3¾ Nuclides): \(thresholds)")
    if let q1 = page.quarterStart(clock, 1) {
        check(n.quarter(at: q1, level: 3) == 1 && n.quarter(at: q1 - 0.001, level: 3) == 0, "the Node quarter's start lands on its first millisecond")
    }
    // the eclipses: 70 of them, at the fractions 0, ¾, ½, ¼ of their cell
    var found: [Int: Double] = [:]
    for p in 0..<CalDeltaPage.count(clock) {
        // only pages that can hold one (an eclipse every 2843.75 cells = 81.25 pages)
        let k = Int((Double(p) * 35 / 2843.75).rounded(.down))
        let lo = Int((Double(k) * 2843.75 / 35).rounded(.down)), hi = Int((Double(k + 1) * 2843.75 / 35).rounded(.down))
        guard p == lo || p == hi || p == lo + 1 || p == hi + 1 else { continue }
        for cell in CalDeltaPage(clock: clock, index: p, syncRange: range).cells where cell.eclipse != nil {
            found[cell.eclipse!] = cell.eclipseFraction
        }
    }
    check(found.count == 70, "70 eclipses on the pages: \(found.count)")
    check(found.allSatisfy { k, f in abs(f - [0, 0.75, 0.5, 0.25][k % 4]) < 1e-9 }, "eclipse k sits at 0, ¾, ½, ¼ of its cell")
    let lastPage = CalDeltaPage(clock: clock, index: CalDeltaPage.count(clock) - 1, syncRange: range)
    check(lastPage.cells.contains { !$0.inRange } && lastPage.cells.contains { $0.cut < 1 }, "the last page ends inside a cell")
    let syncs = page.cells.flatMap(\.syncs)
    check(syncs.count >= 6 && syncs.allSatisfy { (0...1).contains($0.x) }, "solar sync quarters on the page: \(syncs.count)")
}

// MARK: - Against the web app (fixture.json from make-calendar-fixture.mjs)

private typealias JSON = [String: Any]

private func num(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }
private func int(_ v: Any?) -> Int? { (v as? NSNumber)?.intValue }

private func webFixtureChecks() {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("fixture.json")
    guard let data = try? Data(contentsOf: url), let fx = try? JSONSerialization.jsonObject(with: data) as? JSON else {
        check(false, "fixture.json is missing: run node ios/Fractonica/Features/Calendar/Checks/make-calendar-fixture.mjs")
        return
    }
    let range = CalMath.syncRange(clock)
    let webRange = fx["syncRange"] as? JSON
    check(range.lowerBound == int(webRange?["first"]) && range.upperBound == int(webRange?["last"]), "sync range \(range) as the web's")
    check(CalDeltaPage.count(clock) == int(fx["viewCount"]), "Delta page count \(CalDeltaPage.count(clock)) as the web's")
    webMonthChecks(fx["months"] as? [JSON] ?? [], syncRange: range)
    webYearChecks(fx["years"] as? [JSON] ?? [])
    webInstantChecks(fx["instants"] as? [JSON] ?? [])
    webPageChecks(fx["pages"] as? [JSON] ?? [], syncRange: range)
}

private func webMonthChecks(_ months: [JSON], syncRange: ClosedRange<Int>) {
    var cells = 0, segments = 0, bad: [String] = []
    for m in months {
        guard let y = int(m["year"]), let mo = int(m["month"]), let z = m["zone"] as? String, let zone = TimeZone(identifier: z),
              let ws = int(m["weekStart"]), let ov = m["overlay"] as? String, let band = CalendarBand(key: ov),
              let webCells = m["cells"] as? [JSON] else { bad.append("unreadable month"); continue }
        let grid = CalMonthGrid(clock: clock, zone: zone, year: y, month: mo, weekStart: ws, bands: [band], syncRange: syncRange)
        let tag = "\(y)-\(mo) \(z) \(ov)"
        guard grid.days.count == webCells.count else { bad.append("\(tag): \(grid.days.count) days"); continue }
        for (day, c) in zip(grid.days, webCells) {
            cells += 1
            let dayTag = "\(tag) \(day.key)"
            if day.year != int(c["y"]) || day.month != int(c["m"]) || day.day != int(c["d"]) || day.inMonth != (c["inMonth"] as? Bool)
                || day.weekday != int(c["dow"]) { bad.append("\(dayTag): date"); continue }
            if day.start != num(c["start"]) || day.end != num(c["end"]) { bad.append("\(dayTag): day \(day.start) … \(day.end)") }
            if day.inRange != (c["inRange"] as? Bool) { bad.append("\(dayTag): inRange \(day.inRange)") }
            if (day.eclipse ?? -1) != int(c["eclipse"]) { bad.append("\(dayTag): eclipse \(String(describing: day.eclipse))") }
            let webSegs = c["segs"] as? [JSON] ?? []
            let segs = day.tracks.first?.segments ?? []
            guard segs.count == webSegs.count else { bad.append("\(dayTag): \(segs.count) segments, web \(webSegs.count)"); continue }
            for (s, w) in zip(segs, webSegs) {
                segments += 1
                guard Int(s.index) == int(w["idx"]), s.ordinal == int(w["ord"]), s.startsHere == (w["sh"] as? Bool), s.endsHere == (w["eh"] as? Bool),
                      let ws = num(w["start"]), let we = num(w["end"]), abs(s.start - ws) < 1e-4, abs(s.end - we) < 1e-4 else {
                    bad.append("\(dayTag): segment \(s.index) #\(s.ordinal) \(s.start)…\(s.end) vs \(w)")
                    continue
                }
                let x0 = max(0, (ws - day.start) / day.length), x1 = min(1, (we - day.start) / day.length)
                if abs(s.x0 - x0) > 1e-9 || abs(s.x1 - x1) > 1e-9 { bad.append("\(dayTag): segment \(s.index) at \(s.x0)…\(s.x1)") }
            }
        }
    }
    check(bad.isEmpty, "\(months.count) month grids (\(cells) days, \(segments) segments) match month.js buildMonth: \(bad.prefix(6))")
}

private func webYearChecks(_ years: [JSON]) {
    for w in years {
        guard let y = int(w["year"]), let z = w["zone"] as? String, let zone = TimeZone(identifier: z) else { continue }
        let r = CalYearRibbon(clock: clock, zone: zone, year: y)
        check(r.summary == w["text"] as? String, "year \(y) \(z): \"\(r.summary)\" is the web's \"\(w["text"] as? String ?? "")\"")
        check(r.start == num(w["start"]) && r.end == num(w["end"]), "year \(y) \(z) spans the web's local year")
        let months = w["months"] as? [JSON] ?? []
        let monthsMatch = months.count == r.months.count && zip(r.months, months).allSatisfy {
            abs($0.x0 - (num($1["x0"]) ?? .nan)) < 1e-12 && abs($0.x1 - (num($1["x1"]) ?? .nan)) < 1e-12 && $0.inRange == ($1["inRange"] as? Bool)
        }
        check(monthsMatch, "year \(y) \(z): ribbon months as the web's")
        let ticks = (w["ticks"] as? [JSON] ?? []).map { "\(int($0["level"]) ?? -1):\(int($0["ord"]) ?? -1):\(CalMath.r3(num($0["start"]) ?? .nan))" }
        let mine = r.ticks.map { "\($0.level):\($0.ordinal):\(CalMath.r3($0.time))" }
        check(Set(ticks) == Set(mine) && ticks.count == mine.count, "year \(y) \(z): δ and ε ticks as the web's (\(mine.count) vs \(ticks.count))")
    }
}

private func webInstantChecks(_ instants: [JSON]) {
    var bad: [String] = []
    for w in instants {
        guard let t = num(w["t"]) else { continue }
        let pos = CalMath.position(clock, at: t).map { "\($0.ordinal).\($0.fraction)" }
        if pos != w["position"] as? String { bad.append("\(t): position \(pos ?? "nil") vs \(w["position"] ?? "nil")") }
        let path = (w["path"] as? [NSNumber])?.map(\.intValue)
        if CalMath.path(clock, at: t, depth: 14) != path { bad.append("\(t): address") }
        let solar = clock.solar(at: t)
        if let s = w["sync"] as? JSON {
            if solar?.sync != int(s["n"]) || abs((solar?.phase ?? .nan) - (num(s["phase"]) ?? .nan)) > 1e-9 { bad.append("\(t): solar sync \(String(describing: solar?.sync))") }
            if let n = int(s["n"]), let info = clock.solarSync(number: n), let ws = num(s["start"]), let we = num(s["end"]), let wd = num(s["drift"]) {
                if abs(info.start - ws) > 1e-4 || abs(info.end - we) > 1e-4 || abs(info.drift - wd) > 1e-4 { bad.append("\(t): sync \(n) facts") }
            }
        } else if solar != nil, CalMath.syncRange(clock).contains(solar!.sync) {
            bad.append("\(t): a solar sync where the web has none")
        }
        let e = CalMath.eclipses(clock, around: t)
        let we = w["eclipse"] as? JSON
        if e.previous != int(we?["prev"]) || e.next != int(we?["next"]) { bad.append("\(t): eclipses \(String(describing: e))") }
        if CalDeltaPage.page(clock, at: t) != int(w["view"]) { bad.append("\(t): Delta page") }
        let c = CalPureCounters(.standard, at: t)
        if let wc = w["counters"] as? JSON {
            let keys = ["alpha", "beta", "gamma", "delta", "epsilon", "eta", "iota", "lambda", "nu"]
            if c?.values != keys.map({ int(wc[$0]) ?? -1 }) { bad.append("\(t): pure counters \(String(describing: c?.values))") }
        } else if c != nil {
            bad.append("\(t): pure counters where the web has none")
        }
    }
    check(bad.isEmpty, "\(instants.count) instants: position, address, solar sync, eclipses, Delta page and pure counters as the web's: \(bad.prefix(6))")
}

private func webPageChecks(_ pages: [JSON], syncRange: ClosedRange<Int>) {
    var bad: [String] = []
    for w in pages {
        guard let hv = int(w["hv"]), let cells = w["cells"] as? [JSON] else { continue }
        let page = CalDeltaPage(clock: clock, index: hv, syncRange: syncRange)
        for (c, wc) in zip(page.cells, cells) {
            let tag = "page \(hv) cell \(c.index)"
            if Int(c.z) != int(wc["z"]) || c.inRange != (wc["inRange"] as? Bool) { bad.append("\(tag): place"); continue }
            if abs(c.cut - (num(wc["cut"]) ?? .nan)) > 1e-12 || c.start != num(wc["start"]) || c.end != num(wc["end"]) {
                bad.append("\(tag): \(c.start) … \(c.end) cut \(c.cut)")
            }
            if (c.eclipse ?? -1) != int(wc["eclipse"]) || (c.eclipse != nil && abs(c.eclipseFraction - (num(wc["frac"]) ?? .nan)) > 1e-12) {
                bad.append("\(tag): eclipse \(String(describing: c.eclipse)) at \(c.eclipseFraction)")
            }
            let syncs = (wc["syncs"] as? [JSON] ?? []).map { "\(int($0["n"]) ?? 0):\(int($0["q"]) ?? 0):\(String(format: "%.9f", num($0["x"]) ?? .nan))" }
            if syncs != c.syncs.map({ "\($0.sync):\($0.quarter):\(String(format: "%.9f", $0.x))" }) { bad.append("\(tag): syncs \(c.syncs) vs \(syncs)") }
            let dq = (wc["dq"] as? [JSON] ?? []).map { "\(int($0["q"]) ?? 0):\(num($0["x0"]) ?? .nan):\(num($0["x1"]) ?? .nan):\(($0["sh"] as? Bool) == true)" }
            if dq != c.quarters.map({ "\($0.quarter):\($0.x0):\($0.x1):\($0.startsHere)" }) { bad.append("\(tag): Delta quarters") }
        }
    }
    check(bad.isEmpty, "\(pages.count) Delta pages match pure-conv.js buildPureGrid: \(bad.prefix(6))")
}
