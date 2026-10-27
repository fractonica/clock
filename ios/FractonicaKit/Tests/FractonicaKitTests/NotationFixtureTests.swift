import Testing
@testable import FractonicaKit

/// The pure-mode notation against pure.json (src/core/pure.js).
@Suite("Notation fixtures")
struct NotationFixtureTests {
    let notation = Notation()
    let fixture = Fixtures.pure

    @Test("Vocabulary, unit ladder, rates and lengths")
    func statics() {
        let s = fixture["statics"]
        var check = Checker("statics")
        check.equal(Notation.levelNames, s["levelNames"].strings, "levelNames")
        check.equal(Notation.ordinalNames, s["ordinalNames"].strings, "ordinalNames")
        check.equal(Notation.quarterWords, s["quarterWords"].strings, "quarterWords")
        check.equal(Notation.unitLevels, s["unitLevels"].ints, "unitLevels")
        let units = s["units"].array.map {
            FUnit(id: $0["id"].string, sym: $0["sym"].string, level: $0["level"].int, name: $0["name"].string, major: $0["major"].bool)
        }
        check.equal(Notation.units, units, "units")
        for row in s["kinds"].array {
            let level = row[0].int
            check.equal(Notation.isMajor(level), row[1].bool, "isMajor(\(level))")
            check.equal(Notation.isUnitLevel(level), row[2].bool, "isUnitLevel(\(level))")
            check.equal(Notation.levelKind(level), row[3].string, "levelKind(\(level))")
        }
        for row in s["unitOf"].array { check.equal(Notation.unit(row[0].string)?.id, row[1].optionalString, "unitOf \(row[0].string)") }
        for row in s["unitName"].array {
            check.equal(Notation.unitName(row[0].string, count: row[1].int), row[2].string, "unitName \(row[0].string) \(row[1].int)")
        }
        for row in s["unitNameLevel"].array {
            check.equal(Notation.unitName(level: row[0].int, count: row[1].int), row[2].string, "unitName level \(row[0].int)")
        }
        for row in s["ordinalName"].array { check.equal(Notation.ordinalName(row[0].int), row[1].string, "ordinalName \(row[0].int)") }
        for row in s["periodName"].array {
            check.equal(Notation.periodName(level: row[0].int, ordinal: row[1].int), row[2].string, "periodName \(row[0].int) \(row[1].int)")
        }
        for row in s["shortName"].array {
            check.equal(Notation.shortName(level: row[0].int, ordinal: row[1].int), row[2].string, "shortName \(row[0].int) \(row[1].int)")
        }
        for row in s["resolutionOf"].array { check.equal(Notation.resolutionOf(row[0].int), row[1].string, "resolutionOf \(row[0].int)") }
        for row in s["eclipseName"].array { check.equal(Notation.eclipseName(row[0].int), row[1].string, "eclipseName") }
        check.equal(notation.catalogueText(), s["catalogueText"].string, "catalogueText")
        check.equal((0...20).map(notation.cyclePos), s["cyclePos"].doubles, "cyclePos")
        check.equal(Notation.units.map(notation.unitPos), s["lengths"].doubles, "unitPos")
        check.equal(Notation.units.map(notation.unitSeconds), s["unitSeconds"].doubles, "unitSeconds")
        check.equal(notation.blinkSeconds, s["blinkSeconds"].double, "blinkSeconds")
        let rates = s["rates"].array.map { Notation.Rate(id: $0["id"].string, rate: $0["rate"].double, label: $0["label"].string) }
        check.equal(notation.rates, rates, "rates")
        check.equal(notation.playRate, s["playRate"].double, "playRate")
        check.report()
    }

    @Test("Spans: decompose, durationPos, duration, countdown, between, cycleLength")
    func spans() {
        var check = Checker("spans")
        for row in fixture["spans"].array {
            let dpos = row["dpos"].double, parts = row["parts"].int, keepZeros = row["keepZeros"].bool
            let what = "dpos \(dpos) parts \(parts) keepZeros \(keepZeros)"
            let parts2 = notation.decompose(dpos, parts: parts, keepZeros: keepZeros).map { "\($0.count)\($0.unit.sym)" }
            check.equal(parts2, row["decompose"].array.map { "\($0[1].int)\($0[0].string)" }, "\(what) decompose")
            check.equal(notation.durationPos(dpos, parts: parts, keepZeros: keepZeros), row["text"].string, what)
            check.equal(notation.durationPos(dpos), row["text2"].string, "\(what) default")
        }
        for row in fixture["durations"].array {
            let seconds = row["seconds"].double, at = row["at"].double, parts = row["parts"].int, keepZeros = row["keepZeros"].bool
            let what = "\(seconds) s at \(at) parts \(parts) keepZeros \(keepZeros)"
            check.equal(notation.duration(seconds, parts: parts, at: at, keepZeros: keepZeros), row["duration"].string, "\(what) duration")
            check.equal(notation.countdown(seconds, parts: parts, at: at, keepZeros: keepZeros), row["countdown"].string, "\(what) countdown")
        }
        for row in fixture["between"].array {
            let t1 = row["t1"].double, t2 = row["t2"].double, parts = row["parts"].int
            check.equal(notation.between(t1, t2, parts: parts), row["text"].string, "between \(t1) \(t2)")
        }
        for row in fixture["secondsPerPosition"].array {
            check.equal(notation.secondsPerPosition(at: row[0].double), row[1].double, "secondsPerPosition \(row[0].double)")
        }
        for row in fixture["cycleLength"].array {
            check.equal(notation.cycleLength(level: row[0].int, parts: row[1].int), row[2].string, "cycleLength \(row[0].int) \(row[1].int)")
        }
        for row in fixture["pairs"].array {
            let p = Notation.pair(row[0].double)
            check.equal([p.index, p.hi, p.lo], [row[1]["index"].int, row[1]["hi"].int, row[1]["lo"].int], "pair \(row[0].double)")
            check.equal(Notation.pairText(row[0].double), row[2].string, "pairText \(row[0].double)")
        }
        check.report()
    }

    @Test("Cycle names and start counts")
    func cycles() {
        var check = Checker("cycle names")
        for row in fixture["cycles"].array {
            let level = row["level"].int, cycle = Int64(row["idx"].string)!
            let what = "L\(level) #\(cycle)"
            let c = notation.countsAtStart(level: level, cycle: cycle), e = row["counts"]
            check.equal([c.delta, c.epsilon, c.eta, c.iota, c.lambda, c.nu],
                        ["delta", "epsilon", "eta", "iota", "lambda", "nu"].map { e[$0].int }, "\(what) counts")
            check.equal(c.nuFrac, e["nuFrac"].double, "\(what) nuFrac")
            check.equal(notation.ordinalOf(level: level, cycle: cycle), row["ordinalOf"].int, "\(what) ordinalOf")
            check.equal(notation.cycleName(level: level, cycle: cycle), row["name"].string, "\(what) name")
            check.equal(notation.cycleName(level: level, cycle: cycle, short: true), row["short"].string, "\(what) short name")
            check.equal(notation.cycleShort(level: level, cycle: cycle), row["cycleShort"].string, "\(what) cycleShort")
        }
        check.report()
    }

    @Test("Clocks, dates, stamps, names and addresses at an instant")
    func moments() {
        let upTo = fixture["upTo"].strings
        var check = Checker("moments")
        for row in fixture["moments"].array {
            let t = row["t"].double
            let what = "t=\(t)"
            let c = notation.clock(at: t)
            if check.presence(c != nil, !row["clock"].isNull, "\(what) clock"), let c {
                let e = row["clock"]
                check.equal([c.epsilon, c.eta, c.iota, c.lambda, c.nu], ["epsilon", "eta", "iota", "lambda", "nu"].map { e[$0].int }, "\(what) clock")
            }
            check.equal(upTo.map { notation.clockText(at: t, upTo: $0) }, row["clockText"].strings, "\(what) clockText")
            check.equal(notation.clockText(at: t), row["clockTextDefault"].string, "\(what) clockText default")
            let d = notation.date(at: t)
            if check.presence(d != nil, !row["date"].isNull, "\(what) date"), let d {
                let e = row["date"], q = e["quarter"]
                check.equal([d.alpha, d.beta, d.gamma, d.delta, d.epsilon], ["alpha", "beta", "gamma", "delta", "epsilon"].map { e[$0].int }, "\(what) date")
                check.equal([d.quarter.alpha, d.quarter.beta, d.quarter.gamma, d.quarter.delta],
                            ["alpha", "beta", "gamma", "delta"].map { q[$0].string }, "\(what) quarters")
            }
            check.equal((0...13).map { notation.quarter(at: t, level: $0) }, row["quarter"].array.map(\.optionalInt), "\(what) quarter")
            check.equal((0...4).map { notation.majorText(at: t, level: $0) }, row["majorText"].strings, "\(what) majorText")
            let dates = ["short", "full"].flatMap { form in
                [false, true].flatMap { letters in upTo.map { notation.dateText(at: t, form: form, letters: letters, upTo: $0) } }
            }
            check.equal(dates, row["dateText"].strings, "\(what) dateText")
            check.equal(notation.dateText(at: t), row["dateTextDefault"].string, "\(what) dateText default")
            check.equal(upTo.map { notation.stamp(at: t, upTo: $0) }, row["stamp"].strings, "\(what) stamp")
            check.equal(notation.stamp(at: t), row["stampDefault"].string, "\(what) stamp default")
            let pentads = ["full", "short", "ascii"].flatMap { form in [false, true].map { notation.pentadText(at: t, form: form, helion: $0) } }
            check.equal(pentads, row["pentadText"].strings, "\(what) pentadText")
            for (level, names) in row["nameAt"].array.enumerated() {
                check.equal(notation.nameAt(t, level: level), names[0].optionalString, "\(what) nameAt L\(level)")
                check.equal(notation.nameAt(t, level: level, short: true), names[1].optionalString, "\(what) short nameAt L\(level)")
            }
            check.equal((0...13).map { notation.addressAt(t, level: $0) }, row["addressAt"].strings, "\(what) addressAt")
        }
        check.report()
    }

    @Test("Drift, digit groups, speeds, Blinks and pB")
    func realTime() {
        var check = Checker("real time")
        for row in fixture["drift"].array {
            let start = row["start"].double, nominal = row["nominalStart"].double, drift = row["drift"].double
            check.equal(notation.driftLambda(start: start, nominalStart: nominal, drift: drift), row["lambda"].int, "driftLambda \(start)")
            check.equal(notation.driftText(start: start, nominalStart: nominal, drift: drift), row["text"].string, "driftText \(start)")
        }
        for row in fixture["groupDigits"].array { check.equal(Notation.groupDigits(row[0].double), row[1].string, "groupDigits \(row[0].double)") }
        for row in fixture["rateLabel"].array { check.equal(notation.rateLabel(row[0].double), row[1].string, "rateLabel \(row[0].double)") }
        for row in fixture["blinks"].array {
            let s = row[0].double
            check.equal(notation.blinks(s), row[1].string, "blinks \(s)")
            check.equal(notation.secondsToBlinks(s), row[2].double, "secondsToBlinks \(s)")
            check.equal(notation.blinksToSeconds(s), row[3].double, "blinksToSeconds \(s)")
            check.equal(notation.perBlink(s), row[4].double, "perBlink \(s)")
        }
        for row in fixture["pbText"].array { check.equal(Notation.pbText(row[0].double), row[1].string, "pbText \(row[0].double)") }
        check.report()
    }
}
