import Foundation
import Testing
@testable import FractonicaKit

/// The engine against fuzz.json, the independent fixture of ios/scripts/make-fuzz-fixtures.mjs: instants a hair either
/// side of cycle and sync boundaries, every Saros interval, rounding ties, deep levels, both search directions, spans
/// next to whole unit counts, the journal at unit boundaries and Earth time in zones with odd offsets.
///
/// Tolerances are the golden tests' (integers and strings exactly, times within 0.5 ms, phases within 1e-9). Each test
/// also prints how many tolerance comparisons were not bit-identical: the port repeats the web app's arithmetic, so
/// anything but zero would point at a different computation.
@Suite("Fuzz fixtures")
struct FuzzFixtureTests {
    let clock = FractonicaClock.shared
    let notation = Notation()
    let fixture = Fixtures.fuzz

    // MARK: - Readings

    @Test("Levels, odometers, solar sync and address around boundaries")
    func readings() {
        var check = Checker("fuzz readings")
        for sample in fixture["readings"].array {
            let t = sample["t"].double
            let at = "t=\(t) (\(sample["tag"].string))"
            check.equal(clock.inRange(t), sample["inRange"].bool, "\(at) inRange")
            check.equal(clock.clamp(t), sample["clamp"].double, "\(at) clamp")
            check.equal(clock.position(at: t), sample["pos"].optionalDouble, "\(at) position")
            let locate = clock.locate(t)
            if check.presence(locate != nil, !sample["locate"].isNull, "\(at) locate"), let locate {
                check.equal(locate.k, sample["locate"][0].int, "\(at) locate.k")
                check.equal(locate.f, sample["locate"][1].double, "\(at) locate.f")
            }
            for record in sample["L"].array { compareLevel(t, record, at, &check) }
            for record in sample["O"].array { compareOdometer(t, record, at, &check) }
            compareSolar(clock.solar(at: t), sample["S"], "\(at) solar", &check)
            check.equal(clock.address(at: t), sample["A"].isNull ? nil : sample["A"].ints, "\(at) address")
        }
        check.report()
        print(check.summary)
    }

    /// One level record: [level, strokes, cycle, local, phase, progress, quarter, index, start, end, duration, clipped,
    /// remaining, nextName, nextTime, thresholdTimes | null], or [level, strokes, null] where the web app reads nothing.
    private func compareLevel(_ t: Double, _ record: JSON, _ at: String, _ check: inout Checker) {
        let f = record.array
        let level = f[0].int, strokes = f[1].int
        let what = "\(at) L\(level) s\(strokes)"
        let r = clock.level(at: t, level, strokes: strokes)
        guard check.presence(r != nil, !f[2].isNull, what), let r else { return }
        check.equal(r.cycle, Int64(f[2].double), "\(what) cycle")
        check.equal(r.local, f[3].int, "\(what) local")
        check.fraction(r.phase, f[4].double, "\(what) phase")
        check.fraction(r.progress, f[5].double, "\(what) progress")
        check.equal(r.quarter, f[6].int, "\(what) quarter")
        check.equal(r.index, f[7].int, "\(what) index")
        // value, derivative, dot and trits follow from the index (glyphs.json checks that mapping state by state)
        let glyph = GlyphState.of(index: f[7].int, strokes: strokes)
        check.equal([r.value, r.derivative], [glyph.value, glyph.derivative], "\(what) value / derivative")
        check.equal(r.dotted, glyph.dotted, "\(what) dotted")
        check.equal(r.trits, glyph.trits, "\(what) trits")
        check.equal(r.states, GlyphState.states(strokes: strokes), "\(what) states")
        check.time(r.start, f[8].double, "\(what) start")
        check.time(r.end, f[9].double, "\(what) end")
        check.time(r.duration, f[10].double, "\(what) duration")
        check.equal(r.clipped, f[11].bool, "\(what) clipped")
        check.time(r.remaining, f[12].double, "\(what) remaining")
        check.equal(r.next.name, f[13].string, "\(what) next.name")
        check.time(r.next.time, f[14].optionalDouble, "\(what) next.time")
        if !f[15].isNull {
            for (k, time) in f[15].array.enumerated() { check.time(r.thresholds[k].time, time.optionalDouble, "\(what) threshold \(k)") }
        }
    }

    /// One odometer record: [level, strokes, digits, states, nextTime, ...digitValues], or [level, strokes, digits, null].
    private func compareOdometer(_ t: Double, _ record: JSON, _ at: String, _ check: inout Checker) {
        let f = record.array
        let level = f[0].int, strokes = f[1].int, digits = f[2].int
        let what = "\(at) L\(level) odometer \(digits)×\(strokes)"
        let o = clock.odometer(at: t, level, strokes: strokes, digits: digits)
        guard check.presence(o != nil, !f[3].isNull, what), let o else { return }
        check.equal(o.states, f[3].int, "\(what) states")
        check.time(o.nextTime, f[4].optionalDouble, "\(what) nextTime")
        check.equal(o.digits, f.dropFirst(5).map(\.int), "\(what) digits")
    }

    /// [sync, start, end, nominalStart, phase, drift, quarter, thresholdName, thresholdTime, digits3, digits2x3, beforeAnchor]
    private func compareSolar(_ s: SolarReading?, _ expected: JSON, _ what: String, _ check: inout Checker) {
        guard check.presence(s != nil, !expected.isNull, what), let s else { return }
        let e = expected.array
        check.equal(s.sync, e[0].int, "\(what) sync")
        check.time(s.start, e[1].double, "\(what) start")
        check.time(s.end, e[2].double, "\(what) end")
        check.time(s.nominalStart, e[3].double, "\(what) nominalStart")
        check.fraction(s.phase, e[4].double, "\(what) phase")
        check.time(s.drift, e[5].double, "\(what) drift")
        check.equal(s.quarter, e[6].int, "\(what) quarter")
        check.equal(s.threshold.name, e[7].string, "\(what) threshold")
        check.time(s.threshold.time, e[8].double, "\(what) threshold time")
        check.equal(s.digits3, e[9].ints, "\(what) digits3")
        check.equal(s.digits2x3, e[10].ints, "\(what) digits2x3")
        check.equal(s.beforeAnchor, e[11].bool, "\(what) beforeAnchor")
    }

    @Test("Solar sync boundaries and syncs by number")
    func solar() {
        var check = Checker("fuzz solar")
        for row in fixture["solar"]["readings"].array {
            let t = row[0].double
            compareSolar(clock.solar(at: t), row[1], "solar t=\(t)", &check)
        }
        for row in fixture["solar"]["syncs"].array {
            let n = row[0].int
            let s = clock.solarSync(number: n), e = row[1]
            guard check.presence(s != nil, !e.isNull, "sync \(n)"), let s else { continue }
            check.equal(s.sync, n, "sync \(n) number")
            check.time(s.start, e[0].double, "sync \(n) start")
            check.time(s.end, e[1].double, "sync \(n) end")
            check.time(s.nominalStart, e[2].double, "sync \(n) nominalStart")
            check.time(s.drift, e[3].double, "sync \(n) drift")
        }
        check.report()
        print(check.summary)
    }

    // MARK: - Cycles

    @Test("Cycle facts, windows, start times, paths and positions")
    func cycles() {
        let c = fixture["cycles"]
        var check = Checker("fuzz cycles")
        for row in c["facts"].array {
            let level = row[0].int, index = Int64(row[1].string)!
            compareFacts(clock.cycle(level: level, index: index), row[2], "L\(level) #\(index)", &check)
        }
        for row in c["factsAt"].array {
            let t = row[0].double, level = row[1].int
            compareFacts(clock.cycle(at: t, level: level), row[2], "L\(level) at \(t)", &check)
        }
        for row in c["windows"].array {
            let level = row[0].int, t0 = row[1].double, t1 = row[2].double, limit = row[3].int
            let out = clock.boundaries(level: level, from: t0, to: t1, limit: limit)
            let expected = row[4].array
            let what = "boundaries L\(level) [\(t0), \(t1)] limit \(limit)"
            check.equal(out.map(\.idx), expected.map { Int64($0[0].double) }, "\(what) idx")
            check.equal(out.map(\.local), expected.map { $0[1].int }, "\(what) local")
            for (b, e) in zip(out, expected) { check.time(b.time, e[2].double, "\(what) #\(b.idx) time") }
        }
        for row in c["startTimes"].array {
            let level = row[0].int, index = Int64(row[1].double)
            check.equal(clock.cycleStartTime(level: level, index: index), row[2].optionalDouble, "cycleStartTime L\(level) #\(index)")
        }
        for row in c["paths"].array {
            let level = row[0].int, index = Int64(row[1].string)!
            check.equal(clock.cycleToPath(level: level, cycle: index), row[2].ints, "cycleToPath L\(level) #\(index)")
            check.equal(clock.pathToCycle(row[2].ints), row[3].optionalString.map { Int64($0)! }, "pathToCycle \(row[2].ints)")
        }
        for row in c["positions"].array {
            check.equal(clock.time(atPosition: row[0].double), row[1].double, "timeOfPosition \(row[0].double)")
        }
        check.report()
        print(check.summary)
    }

    /// [cycle, start, end, duration, clipped, eventTimes]
    private func compareFacts(_ facts: CycleFacts?, _ expected: JSON, _ what: String, _ check: inout Checker) {
        guard check.presence(facts != nil, !expected.isNull, what), let facts else { return }
        let e = expected.array
        check.equal(facts.cycle, Int64(e[0].double), "\(what) cycle")
        check.time(facts.start, e[1].double, "\(what) start")
        check.time(facts.end, e[2].double, "\(what) end")
        check.time(facts.duration, e[3].double, "\(what) duration")
        check.equal(facts.clipped, e[4].bool, "\(what) clipped")
        for (k, time) in e[5].array.enumerated() { check.time(facts.events[k].time, time.optionalDouble, "\(what) event \(k)") }
    }

    @Test("upcomingEnds over random level ranges, stateOccurrences both ways")
    func search() {
        let c = fixture["cycles"]
        var check = Checker("fuzz search")
        for row in c["upcoming"].array {
            let t = row[0].double
            let out = clock.upcomingEnds(after: t, fromLevel: row[1].int, toLevel: row[2].int, count: row[3].int, perLevel: row[4].int)
            let expected = row[5].array
            let what = "upcomingEnds t=\(t) L\(row[1].int)…\(row[2].int) count \(row[3].int) per \(row[4].int)"
            check.equal(out.count, expected.count, "\(what) count")
            for (e, x) in zip(out, expected) {
                check.time(e.time, x[0].double, "\(what) time")
                check.equal(e.top, x[1].int, "\(what) top")
                check.equal(e.levels, x[2].ints, "\(what) levels")
            }
        }
        for row in c["occurrences"].array {
            let level = row[0].int, digits = row[1].ints, t = row[2].double
            let strokes = row[3].int, direction = row[4].int, count = row[5].int
            let out = clock.stateOccurrences(level: level, digits: digits, around: t, strokes: strokes, direction: direction, count: count)
            let expected = row[6].array
            let what = "stateOccurrences L\(level) \(digits)×\(strokes) dir \(direction) t=\(t)"
            check.equal(out.map(\.cycle), expected.map { Int64($0[2].double) }, "\(what) cycles")
            for (s, e) in zip(out, expected) {
                check.time(s.start, e[0].double, "\(what) start")
                check.time(s.end, e[1].double, "\(what) end")
            }
        }
        check.report()
        print(check.summary)
    }

    // MARK: - Notation

    @Test("Pure clock, dates, stamps and names at boundary instants")
    func moments() {
        var check = Checker("fuzz moments")
        for row in fixture["pure"]["moments"].array {
            let t = row["t"].double
            let what = "t=\(t)"
            let c = notation.clock(at: t)
            if check.presence(c != nil, !row["clock"].isNull, "\(what) clock"), let c {
                let e = row["clock"]
                check.equal([c.epsilon, c.eta, c.iota, c.lambda, c.nu], ["epsilon", "eta", "iota", "lambda", "nu"].map { e[$0].int }, "\(what) clock")
            }
            let d = notation.date(at: t)
            if check.presence(d != nil, !row["date"].isNull, "\(what) date"), let d {
                let e = row["date"], q = e["quarter"]
                check.equal([d.alpha, d.beta, d.gamma, d.delta, d.epsilon], ["alpha", "beta", "gamma", "delta", "epsilon"].map { e[$0].int }, "\(what) date")
                check.equal([d.quarter.alpha, d.quarter.beta, d.quarter.gamma, d.quarter.delta],
                            ["alpha", "beta", "gamma", "delta"].map { q[$0].string }, "\(what) quarters")
            }
            let dt = row["dateText"]
            check.equal(notation.dateText(at: t, form: dt[0].string, letters: dt[1].bool, upTo: dt[2].string), dt[3].string,
                        "\(what) dateText \(dt[0].string) letters \(dt[1].bool) upTo \(dt[2].string)")
            check.equal(notation.dateText(at: t, form: "full", upTo: "nu"), row["dateFull"].string, "\(what) full date")
            check.equal(notation.stamp(at: t, upTo: row["stamp"][0].string), row["stamp"][1].string, "\(what) stamp")
            check.equal(notation.clockText(at: t, upTo: row["clockText"][0].string), row["clockText"][1].string, "\(what) clockText")
            check.equal(notation.majorText(at: t, level: row["majorText"][0].int), row["majorText"][1].string, "\(what) majorText")
            for q in row["quarter"].array {
                check.equal(notation.quarter(at: t, level: q[0].int), q[1].optionalInt, "\(what) quarter L\(q[0].int)")
            }
            for n in row["names"].array {
                let level = n[0].int
                check.equal(notation.nameAt(t, level: level), n[1].optionalString, "\(what) nameAt L\(level)")
                check.equal(notation.nameAt(t, level: level, short: true), n[2].optionalString, "\(what) short nameAt L\(level)")
                check.equal(notation.addressAt(t, level: level), n[3].string, "\(what) addressAt L\(level)")
            }
        }
        check.report()
        print(check.summary)
    }

    @Test("Cycle names at random levels 0 … 20 and cycles")
    func cycleNames() {
        var check = Checker("fuzz cycle names")
        for row in fixture["pure"]["cycles"].array {
            let level = row[0].int, cycle = Int64(row[1].string)!
            let what = "L\(level) #\(cycle)"
            let c = notation.countsAtStart(level: level, cycle: cycle), e = row[2]
            check.equal([c.delta, c.epsilon, c.eta, c.iota, c.lambda, c.nu],
                        ["delta", "epsilon", "eta", "iota", "lambda", "nu"].map { e[$0].int }, "\(what) counts")
            check.equal(c.nuFrac, e["nuFrac"].double, "\(what) nuFrac")
            check.equal(notation.ordinalOf(level: level, cycle: cycle), row[3].int, "\(what) ordinalOf")
            check.equal(notation.cycleName(level: level, cycle: cycle), row[4].string, "\(what) name")
            check.equal(notation.cycleName(level: level, cycle: cycle, short: true), row[5].string, "\(what) short name")
            check.equal(notation.cycleShort(level: level, cycle: cycle), row[6].string, "\(what) cycleShort")
        }
        check.report()
        print(check.summary)
    }

    @Test("Spans next to whole unit counts, durations, countdowns, between")
    func spans() {
        let p = fixture["pure"]
        var check = Checker("fuzz spans")
        for row in p["spans"].array {
            let dpos = row[0].double, parts = row[1].int, keepZeros = row[2].bool
            let what = "dpos \(dpos) parts \(parts) keepZeros \(keepZeros)"
            let counts = notation.decompose(dpos, parts: parts, keepZeros: keepZeros).map { "\($0.count)\($0.unit.sym)" }
            check.equal(counts, row[3].array.map { "\($0[1].int)\($0[0].string)" }, "\(what) decompose")
            check.equal(notation.durationPos(dpos, parts: parts, keepZeros: keepZeros), row[4].string, what)
            check.equal(notation.durationPos(dpos), row[5].string, "\(what) default")
        }
        for row in p["durations"].array {
            let seconds = row[0].double, at = row[1].double, parts = row[2].int, keepZeros = row[3].bool
            let what = "\(seconds) s at \(at) parts \(parts) keepZeros \(keepZeros)"
            check.equal(notation.duration(seconds, parts: parts, at: at, keepZeros: keepZeros), row[4].string, "\(what) duration")
            check.equal(notation.countdown(seconds, parts: parts, at: at, keepZeros: keepZeros), row[5].string, "\(what) countdown")
        }
        for row in p["between"].array {
            let t1 = row[0].double, t2 = row[1].double, parts = row[2].int, keepZeros = row[3].bool
            check.equal(notation.between(t1, t2, parts: parts, keepZeros: keepZeros), row[4].string, "between \(t1) \(t2) parts \(parts)")
        }
        for row in p["cycleLength"].array {
            check.equal(notation.cycleLength(level: row[0].int, parts: row[1].int), row[2].string, "cycleLength L\(row[0].int) parts \(row[1].int)")
        }
        for row in p["secondsPerPosition"].array {
            check.equal(notation.secondsPerPosition(at: row[0].double), row[1].double, "secondsPerPosition \(row[0].double)")
        }
        for row in p["pairs"].array {
            let f = row[0].double
            check.equal(Notation.pair(f).index, row[1].int, "pair \(f)")
            check.equal(Notation.pairText(f), row[2].string, "pairText \(f)")
        }
        check.report()
        print(check.summary)
    }

    @Test("Drift, rates, Blinks, pB and digit groups")
    func realTime() {
        let p = fixture["pure"]
        var check = Checker("fuzz real time")
        for row in p["drift"].array {
            let start = row[0].double, nominal = row[1].double, drift = row[2].double
            check.equal(notation.driftLambda(start: start, nominalStart: nominal, drift: drift), row[3].int, "driftLambda \(start)")
            check.equal(notation.driftText(start: start, nominalStart: nominal, drift: drift), row[4].string, "driftText \(start)")
        }
        for row in p["rates"].array { check.equal(notation.rateLabel(row[0].double), row[1].string, "rateLabel \(row[0].double)") }
        for row in p["blinks"].array {
            let s = row[0].double
            check.equal(notation.blinks(s), row[1].string, "blinks \(s)")
            check.equal(notation.secondsToBlinks(s), row[2].double, "secondsToBlinks \(s)")
            check.equal(notation.perBlink(s), row[3].double, "perBlink \(s)")
        }
        for row in p["pb"].array { check.equal(Notation.pbText(row[0].double), row[1].string, "pbText \(row[0].double)") }
        for row in p["groups"].array { check.equal(Notation.groupDigits(row[0].double), row[1].string, "groupDigits \(row[0].double)") }
        check.report()
        print(check.summary)
    }

    // MARK: - Journal

    @Test("Journal face for every unit at unit boundaries")
    func journal() {
        var check = Checker("fuzz journal")
        for row in fixture["journal"]["readings"].array {
            let t = row[0].double
            for (i, expected) in row[1].array.enumerated() {
                let u = i - 1
                let what = "journal t=\(t) u=\(u)"
                let r = Journal.reading(at: t, unit: u, notation: notation)
                guard check.presence(r != nil, !expected.isNull, what), let r else { continue }
                let e = expected.array
                check.equal(r.unit, e[0].int, "\(what) unit")
                check.equal(r.levels, e[1].ints, "\(what) levels")
                check.equal(r.leadLevel, e[2].int, "\(what) lead level")
                check.equal(r.leadLetter, e[3].string, "\(what) lead letter")
                check.fraction(r.leadPhase, e[4].double, "\(what) lead phase")
                check.equal(r.tokens, e[5].isNull ? nil : e[5].array.map { Journal.Token(level: $0[0].int, text: $0[1].string) }, "\(what) tokens")
                check.equal(r.major, e[6].isNull ? nil : Journal.Major(level: e[6][0].int, lines: e[6][1].strings, index3: e[6][2].int),
                            "\(what) major")
            }
        }
        for row in fixture["journal"]["clamps"].array {
            check.equal(Journal.clampUnit(row[0].double), row[1].int, "clampUnit \(row[0].double)")
        }
        check.report()
        print(check.summary)
    }

    // MARK: - Earth time

    @Test("Earth time in zones with odd offsets")
    func earth() {
        let e = fixture["earth"]
        var check = Checker("fuzz earth")
        for row in e["parts"].array {
            let zone = row[0].string, t = row[1].double
            let p = EarthTime.zonedParts(t, zone: TimeZone(identifier: zone)!)
            check.equal([p.year, p.month, p.day, p.hour, p.minute, p.second, p.ms, p.weekday, p.offset], row[2].ints, "zonedParts \(zone) \(t)")
        }
        for row in e["toUnix"].array {
            let zone = row[0].string, f = row[1].ints
            let fields = EarthTime.CivilTime(year: f[0], month: f[1], day: f[2], hour: f[3], minute: f[4], second: f[5], ms: f[6])
            check.equal(EarthTime.zonedToUnix(fields, zone: TimeZone(identifier: zone)!), row[2].double, "zonedToUnix \(zone) \(f)")
        }
        for row in e["formatted"].array {
            let f = EarthFormatter(zone: row[0].string), t = row[1].double, ref = row[2].double
            let what = "\(row[0].string) \(t)"
            check.equal(f.long(t), row[3].string, "\(what) long")
            check.equal(f.short(t), row[4].string, "\(what) short")
            check.equal(f.label(t, ref: ref), row[5].string, "\(what) label")
            check.equal(f.tag(t), row[6].string, "\(what) tag")
            check.equal(f.iso(t), row[7].string, "\(what) iso")
            check.equal(f.dateTime(t, ms: true), row[8].string, "\(what) dateTime")
        }
        for row in e["durations"].array {
            let s = row[0].double
            check.equal(EarthTime.duration(s), row[1].string, "duration \(s)")
            check.equal(EarthTime.duration(s, parts: 3), row[2].string, "duration \(s) parts 3")
            check.equal(EarthTime.countdown(s), row[3].string, "countdown \(s)")
        }
        for row in e["offsets"].array {
            let o = Self.number(row[0])
            check.equal(EarthTime.offsetLabel(o), row[1].string, "offsetLabel \(o)")
        }
        for row in e["civil"].array {
            let (y, m, d) = (row[0].int, row[1].int, row[2].int)
            check.equal(EarthTime.daysFromCivil(y, m, d), row[3].int, "daysFromCivil \(y) \(m) \(d)")
        }
        for row in e["rollover"].array {
            let zone = row[0].string, f = row[1].ints
            let fields = EarthTime.CivilTime(year: f[0], month: f[1], day: f[2], hour: f[3], minute: f[4], second: f[5], ms: f[6])
            check.equal(EarthTime.zonedToUnix(fields, zone: TimeZone(identifier: zone)!), row[2].double, "zonedToUnix rollover \(zone) \(f)")
        }
        check.report()
        print(check.summary)
    }

    /// A number the generator wrote as JSON, or as the string "NaN", "Infinity" or "-Infinity".
    private static func number(_ value: JSON) -> Double {
        guard case .string(let text) = value else { return value.double }
        switch text {
        case "NaN": return .nan
        case "Infinity": return .infinity
        case "-Infinity": return -.infinity
        default: preconditionFailure("not a number: \(text)")
        }
    }
}
