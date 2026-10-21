import Testing
@testable import FractonicaKit

/// Cycle facts, addressing, navigation and search against cycles.json.
@Suite("Cycle fixtures")
struct CycleFixtureTests {
    let clock = FractonicaClock.shared
    let fixture = Fixtures.cycles

    @Test("cycleByIndex / cycleAt")
    func facts() {
        var check = Checker("cycle facts")
        for row in fixture["byIndex"].array {
            let level = row["level"].int
            let index = Int64(row["idx"].string)!
            compare(clock.cycle(level: level, index: index), row["facts"], "L\(level) #\(index)", &check)
        }
        for row in fixture["at"].array {
            let level = row["level"].int, t = row["t"].double
            compare(clock.cycle(at: t, level: level), row["facts"], "L\(level) at \(t)", &check)
        }
        check.report()
    }

    @Test("pathToCycle / cycleToPath")
    func paths() {
        var check = Checker("paths")
        for row in fixture["paths"].array {
            let level = row["level"].int, index = Int64(row["idx"].string)!
            check.equal(clock.cycleToPath(level: level, cycle: index), row["path"].ints, "cycleToPath L\(level) #\(index)")
            check.equal(clock.pathToCycle(row["path"].ints), row["back"].optionalString.map { Int64($0)! }, "pathToCycle \(row["path"].ints)")
        }
        for row in fixture["badPaths"].array {
            check.equal(clock.pathToCycle(row["path"].ints), row["back"].optionalString.map { Int64($0)! }, "pathToCycle \(row["path"].ints)")
        }
        check.equal(clock.pathToCycle([]), nil, "empty path")
        check.report()
    }

    @Test("Float and exact position ↔ time")
    func positionsAndTimes() {
        var check = Checker("position ↔ time")
        for row in fixture["startTimes"].array {
            let level = row["level"].int, index = Int64(row["idx"].int)
            check.equal(clock.cycleStartTime(level: level, index: index), row["time"].optionalDouble, "cycleStartTime L\(level) #\(index)")
        }
        for row in fixture["timeOfPosition"].array {
            check.equal(clock.time(atPosition: row[0].double), row[1].double, "timeOfPosition \(row[0].double)")
        }
        for row in fixture["timestamps"].array {
            let n = Int128(row[0].string)!, d = Int128(row[1].string)!
            // exact rational → F.number: bit-identical
            check.equal(clock.time(atPositionNumerator: n, denominator: d), row[2].optionalDouble, "timestampAt \(n)/\(d)")
        }
        check.report()
    }

    @Test("boundaries")
    func boundaries() {
        var check = Checker("boundaries")
        for row in fixture["boundaries"].array {
            let level = row["level"].int, t0 = row["t0"].double, t1 = row["t1"].double
            let out = clock.boundaries(level: level, from: t0, to: t1, limit: row["limit"].int)
            let expected = row["out"].array
            let what = "L\(level) [\(t0), \(t1)]"
            check.equal(out.map(\.idx), expected.map { Int64($0["idx"].int) }, "\(what) idx")
            check.equal(out.map(\.local), expected.map { $0["local"].int }, "\(what) local")
            for (b, e) in zip(out, expected) { check.time(b.time, e["time"].double, "\(what) #\(b.idx) time") }
        }
        check.report()
    }

    @Test("upcomingEnds")
    func upcoming() {
        var check = Checker("upcomingEnds")
        for row in fixture["upcoming"].array {
            let t = row["t"].double
            let o = row["opts"]
            let out = o.isNull
                ? clock.upcomingEnds(after: t)
                : clock.upcomingEnds(after: t, fromLevel: o["fromLevel"].int, toLevel: o["toLevel"].int, count: o["count"].int,
                                     perLevel: o["perLevel"].int)
            let expected = row["out"].array
            check.equal(out.count, expected.count, "t=\(t) count")
            for (e, x) in zip(out, expected) {
                check.time(e.time, x["time"].double, "t=\(t) end time")
                check.equal(e.top, x["top"].int, "t=\(t) top")
                check.equal(e.levels, x["levels"].ints, "t=\(t) levels")
            }
        }
        check.report()
    }

    @Test("stateOccurrences")
    func occurrences() {
        var check = Checker("stateOccurrences")
        for row in fixture["occurrences"].array {
            let level = row["level"].int, digits = row["digits"].ints, t = row["t"].double, o = row["opts"]
            let out = clock.stateOccurrences(level: level, digits: digits, around: t, strokes: o["strokes"].int,
                                             direction: o["direction"].int, count: o["count"].int)
            let expected = row["out"].array
            let what = "L\(level) \(digits) dir \(o["direction"].int) t=\(t)"
            check.equal(out.map(\.cycle), expected.map { Int64($0["cycle"].int) }, "\(what) cycles")
            for (s, e) in zip(out, expected) {
                check.time(s.start, e["start"].double, "\(what) start")
                check.time(s.end, e["end"].double, "\(what) end")
            }
        }
        check.equal(clock.stateOccurrences(level: 6, digits: [16], around: 1_791_460_800), [], "invalid digit")
        check.report()
    }

    @Test("solarSyncByNumber")
    func syncs() {
        var check = Checker("solarSyncByNumber")
        for row in fixture["syncs"].array {
            let n = row["n"].int
            let s = clock.solarSync(number: n), e = row["out"]
            guard check.presence(s != nil, !e.isNull, "sync \(n)"), let s else { continue }
            check.equal(s.sync, e["sync"].int, "sync \(n) number")
            check.time(s.start, e["start"].double, "sync \(n) start")
            check.time(s.end, e["end"].double, "sync \(n) end")
            check.time(s.nominalStart, e["nominalStart"].double, "sync \(n) nominalStart")
            check.time(s.drift, e["drift"].double, "sync \(n) drift")
        }
        check.report()
    }

    private func compare(_ facts: CycleFacts?, _ expected: JSON, _ what: String, _ check: inout Checker) {
        guard check.presence(facts != nil, !expected.isNull, what), let facts else { return }
        check.time(facts.start, expected["start"].double, "\(what) start")
        check.time(facts.end, expected["end"].double, "\(what) end")
        check.time(facts.duration, expected["duration"].double, "\(what) duration")
        check.equal(facts.clipped, expected["clipped"].bool, "\(what) clipped")
        check.equal(facts.events.map(\.name), ClockFixtureTests.thresholdNames, "\(what) event names")
        for (k, time) in expected["events"].array.enumerated() {
            check.time(facts.events[k].time, time.optionalDouble, "\(what) event \(k)")
        }
    }
}
