import Testing
@testable import FractonicaKit

/// The clock against clock.json and samples.json: catalogue, level tables, the library's number conversion, and every
/// reading (levels, odometers, solar sync, address) at each sample time.
@Suite("Clock fixtures")
struct ClockFixtureTests {
    let clock = FractonicaClock.shared
    let fixture = Fixtures.clock

    /// The library's names for a cycle's events, and the contract's (the same events of an ascending family).
    static let thresholdNames = ["begin", "peak", "node", "valley", "end"]

    @Test("Catalogue, level tables and constants")
    func tables() {
        var check = Checker("tables")
        check.equal(Fractonica.sequence, fixture["sequence"].ints, "sequence")
        check.equal(Fractonica.quarterNames, fixture["quarterNames"].strings, "quarter names")
        check.equal(Fractonica.greek, fixture["greek"].string, "greek")
        check.equal(clock.extent, fixture["extent"].int, "extent")
        // the model's float catalogue goes through F.number: bit-identical, not merely close
        check.equal(clock.catalogue, fixture["catalogue"].doubles, "catalogue")
        check.equal(clock.tMin, fixture["tMin"].double, "tMin")
        check.equal(clock.tMax, fixture["tMax"].double, "tMax")
        check.equal(clock.meanSaros, fixture["meanSaros"].double, "meanSaros")
        for (k, text) in fixture["catalogueStrings"].strings.enumerated() {
            check.equal(Fractonica.saros141UnixMilliseconds[k], Int64(text.filter { $0 != "." })!, "E[\(k)] ms")
        }
        for row in fixture["levels"].array {
            let level = row["level"].int
            let info = clock.levelInfo(level)
            let at = "level \(level)"
            check.equal(info.depth, row["depth"].int, "\(at) depth")
            check.equal(info.letter, row["letter"].string, "\(at) letter")
            check.equal(info.suffix, row["suffix"].string, "\(at) suffix")
            check.equal(info.text, row["text"].string, "\(at) text")
            check.equal(info.factor, row["factor"].int, "\(at) factor")
            check.equal(info.siblings, row["siblings"].optionalInt, "\(at) siblings")
            check.equal(String(info.prefix), row["prefix"].string, "\(at) prefix")
            check.equal(info.prefixDouble, row["prefixNum"].double, "\(at) prefixNum")
            check.equal(info.meanSeconds, row["meanSeconds"].double, "\(at) meanSeconds")
            check.equal(String(clock.count(level)), row["count"].string, "\(at) count")
        }
        for row in fixture["periodNames"].array {
            let name = Fractonica.periodName(row[0].int)
            check.equal([name.letter, name.suffix, name.text], [row[1].string, row[2].string, row[3].string], "periodName(\(row[0].int))")
        }
        check.report()
    }

    @Test("F.number: the library's rational → double conversion, bit for bit")
    func libraryNumber() {
        var check = Checker("F.number")
        for row in fixture["numbers"].array {
            let r = Ratio(Int128(row[0].string)!, Int128(row[1].string)!)
            check.equal(r.libraryDouble, row[2].double, "\(row[0].string)/\(row[1].string)")
        }
        check.report()
    }

    @Test("Sample times: position, levels, odometers, solar sync, address")
    func samples() {
        let file = Fixtures.samples
        let strokes3Levels = file["strokes3Levels"].ints
        var check = Checker("samples")
        for sample in file["samples"].array {
            let t = sample["t"].double
            let at = "t=\(t)"
            check.equal(clock.inRange(t), sample["inRange"].bool, "\(at) inRange")
            check.equal(clock.clamp(t), sample["clamp"].double, "\(at) clamp")
            check.equal(clock.position(at: t), sample["pos"].optionalDouble, "\(at) position")
            let locate = clock.locate(t)
            if check.presence(locate != nil, !sample["locate"].isNull, "\(at) locate"), let locate {
                check.equal(locate.k, sample["locate"]["k"].int, "\(at) locate.k")
                check.equal(locate.f, sample["locate"]["f"].double, "\(at) locate.f")
            }
            for (level, record) in sample["levels"].array.enumerated() {
                compare(clock.level(at: t, level), record, strokes: 2, "\(at) L\(level)", &check)
            }
            if !sample["strokes3"].isNull {
                for (i, record) in sample["strokes3"].array.enumerated() {
                    compare(clock.level(at: t, strokes3Levels[i], strokes: 3), record, strokes: 3,
                            "\(at) L\(strokes3Levels[i]) s3", &check)
                }
            }
            for (key, strokes, digits) in [("s2d2", 2, 2), ("s2d3", 2, 3), ("s3d2", 3, 2)] where !sample["odometer"][key].isNull {
                for (level, record) in sample["odometer"][key].array.enumerated() {
                    let o = clock.odometer(at: t, level, strokes: strokes, digits: digits)
                    let what = "\(at) L\(level) odometer \(key)"
                    guard check.presence(o != nil, !record.isNull, what), let o else { continue }
                    check.equal(o.states, record[0].int, "\(what) states")
                    check.time(o.nextTime, record[1].optionalDouble, "\(what) nextTime")
                    check.equal(o.digits, Array(record.array.dropFirst(2)).map(\.int), "\(what) digits")
                }
            }
            compareSolar(clock.solar(at: t), sample["solar"], at, &check)
            check.equal(clock.address(at: t), sample["address"].isNull ? nil : sample["address"].ints, "\(at) address")
        }
        check.report()
    }

    /// One level reading against its array record (field order: samples.json `levelFields`).
    private func compare(_ r: LevelReading?, _ record: JSON, strokes: Int, _ what: String, _ check: inout Checker) {
        guard check.presence(r != nil, !record.isNull, what), let r else { return }
        let f = record.array
        check.equal(r.cycle, Int64(f[0].int), "\(what) cycle")
        check.equal(r.local, f[1].int, "\(what) local")
        check.fraction(r.phase, f[2].double, "\(what) phase")
        check.fraction(r.progress, f[3].double, "\(what) progress")
        check.equal(r.quarter, f[4].int, "\(what) quarter")
        check.equal(r.index, f[5].int, "\(what) index")
        check.equal(r.value, f[6].int, "\(what) value")
        check.equal(r.derivative, f[7].int, "\(what) derivative")
        check.equal(r.dotted, f[8].bool, "\(what) dotted")
        check.equal(r.trits, f[9].ints, "\(what) trits")
        check.time(r.start, f[10].double, "\(what) start")
        check.time(r.end, f[11].double, "\(what) end")
        check.time(r.duration, f[12].double, "\(what) duration")
        check.equal(r.clipped, f[13].bool, "\(what) clipped")
        check.time(r.remaining, f[14].double, "\(what) remaining")
        check.equal(r.next.name, f[15].string, "\(what) next.name")
        check.time(r.next.time, f[16].optionalDouble, "\(what) next.time")
        if !f[17].isNull {
            check.equal(r.thresholds.map(\.name), Self.thresholdNames, "\(what) threshold names")
            for (k, time) in f[17].array.enumerated() {
                check.time(r.thresholds[k].time, time.optionalDouble, "\(what) threshold \(k)")
            }
        }
        let info = clock.levelInfo(r.level)
        check.equal([r.depth, r.factor, r.strokes, r.states], [info.depth, info.factor, strokes, GlyphState.states(strokes: strokes)],
                    "\(what) static fields")
        check.equal(r.name, info.text, "\(what) name")
        check.equal(r.siblings, info.siblings ?? 18, "\(what) siblings")
    }

    private func compareSolar(_ s: SolarReading?, _ expected: JSON, _ what: String, _ check: inout Checker) {
        guard check.presence(s != nil, !expected.isNull, "\(what) solar"), let s else { return }
        check.equal(s.sync, expected["sync"].int, "\(what) solar sync")
        check.time(s.start, expected["start"].double, "\(what) solar start")
        check.time(s.end, expected["end"].double, "\(what) solar end")
        check.time(s.nominalStart, expected["nominalStart"].double, "\(what) solar nominalStart")
        check.fraction(s.phase, expected["phase"].double, "\(what) solar phase")
        check.time(s.drift, expected["drift"].double, "\(what) solar drift")
        check.equal(s.quarter, expected["quarter"].int, "\(what) solar quarter")
        check.equal(s.threshold.name, expected["threshold"]["name"].string, "\(what) solar threshold")
        check.time(s.threshold.time, expected["threshold"]["time"].double, "\(what) solar threshold time")
        check.equal(s.digits3, expected["digits3"].ints, "\(what) solar digits3")
        check.equal(s.digits2x3, expected["digits2x3"].ints, "\(what) solar digits2x3")
        check.equal(s.beforeAnchor, expected["beforeAnchor"].bool, "\(what) solar beforeAnchor")
    }
}
