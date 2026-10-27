import FractonicaKit
import Foundation

// The ladder's logic against the web app: every string of src/ui/ladder/lib.js and src/ui/ladder/pure-text.js that
// the native ladder and Up next print, replayed from ladder-fixtures.json (make-ladder-fixtures.mjs), plus the
// navigation targets, the Up next memo and the cadences. Run: ios/scripts/check.sh ios/Fractonica/Features/Ladder/Checks

@main
struct LadderChecks {
    static func main() {
        let fixtures = loadFixtures()
        levelChecks(fixtures)
        upNextChecks(fixtures)
        staticChecks(fixtures)
        navigationChecks()
        memoChecks()
        cadenceChecks()
        pureLeakChecks()
        upNextPentadChecks()
        Checks.finish()
    }
}

private let clock = FractonicaClock.shared
private let pt = LadderPureText()
private let A = 1_791_460_800.0

private func loadFixtures() -> [String: Any] {
    let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let data = try! Data(contentsOf: here.appendingPathComponent("ladder-fixtures.json"))
    return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
}

/// Compares a value with a fixture field (strings, numbers, booleans, null).
private func same(_ got: Any?, _ want: Any?, _ what: @autoclosure () -> String, file: StaticString = #fileID, line: UInt = #line) {
    let ok: Bool
    switch (got, want) {
    case (nil, is NSNull), (nil, nil): ok = true
    case let (g as String, w as String): ok = g == w
    case let (g as Int, w as NSNumber): ok = g == w.intValue
    case let (g as Int64, w as NSNumber): ok = g == w.int64Value
    case let (g as Bool, w as NSNumber): ok = g == w.boolValue
    case let (g as Double, w as NSNumber): ok = abs(g - w.doubleValue) <= 1e-4
    default: ok = false
    }
    check(ok, "\(what()): got \(String(describing: got)), want \(String(describing: want))", file: file, line: line)
}

// MARK: - Rows and details

private func levelChecks(_ fixtures: [String: Any]) {
    for record in fixtures["records"] as! [[String: Any]] {
        let t = (record["t"] as! NSNumber).doubleValue
        let earth = EarthFormatter(zone: record["zone"] as? String)
        for entry in record["levels"] as! [[String: Any]] {
            let level = (entry["level"] as! NSNumber).intValue
            let at = "t \(t) level \(level)"
            guard let lv = clock.level(at: t, level) else {
                check(false, "\(at): no reading")
                continue
            }
            same(lv.cycle, entry["cycle"], "\(at) cycle")
            let e = entry["earth"] as! [String: Any]
            same(LadderText.remaining(lv.remaining), e["remaining"], "\(at) remaining")
            same(LadderText.countdown(lv.remaining), e["countdown"], "\(at) countdown")
            same(LadderText.countdownLong(lv.remaining), e["countdownLong"], "\(at) countdownLong")
            same(LadderText.whenFull(earth, lv.end, precise: lv.duration < 10), e["endFull"], "\(at) end")
            same(LadderText.whenFull(earth, lv.start, precise: lv.duration < 10), e["startFull"], "\(at) start")
            same(earth.tag(lv.end), e["tag"], "\(at) tag")
            same(EarthTime.duration(lv.duration), e["duration"], "\(at) duration")
            let quarters = e["quarters"] as! [Any]
            for k in 0..<4 {
                let when = lv.thresholds[k + 1].time
                same(when.map { LadderText.whenLabel(earth, $0, ref: lv.start, span: lv.duration) }, quarters[k], "\(at) quarter \(k)")
            }
            let seg = LadderText.segment(phase: lv.phase, factor: lv.factor)
            same(seg.index, e["segIndex"], "\(at) segment")
            same(LadderText.pctTenths(lv.phase), e["through"], "\(at) through")
            same(min(99, Int((seg.frac * 100).rounded(.down))), e["sectorPct"], "\(at) sector percent")
            let span = LadderText.positionSpan(cycle: lv.cycle, prefix: clock.levelInfo(level).prefix, extent: clock.extent, clipped: lv.clipped)
            same(span.from, e["spanFrom"], "\(at) span from")
            same(span.to, e["spanTo"], "\(at) span to")
            same(LadderText.lead(LadderText.justBeforeLead(lv.duration)), e["lead"], "\(at) lead")
            same(EarthTime.duration(clock.levelInfo(level).meanSeconds), e["every"], "\(at) every")

            let p = entry["pure"] as! [String: Any]
            same(pt.rowLabel(lv), p["row"], "\(at) pure row")
            same(pt.cycleTitle(level: level, cycle: lv.cycle), p["title"], "\(at) pure title")
            same(pt.cycleAddress(level: level, cycle: lv.cycle), p["address"], "\(at) pure address")
            let next = pt.nextCycle(level: level, cycle: lv.cycle)
            same(next?.name, p["next"], "\(at) pure next")
            same(next?.address, p["nextAddress"], "\(at) pure next address")
            same(LadderPureText.endsText(next?.name), p["ends"], "\(at) pure ends")
            same(pt.left(from: t, to: lv.end), p["left"], "\(at) pure left")
            same(pt.heroLeft(from: t, to: lv.end), p["heroLeft"], "\(at) pure hero left")
            same(pt.left(from: lv.start, to: t), p["started"], "\(at) pure started")
            same(pt.length(lv), p["length"], "\(at) pure length")
            same(LadderPureText.quarterWord(lv.phase), p["quarterWord"], "\(at) pure quarter")
            same(Notation.pairText(lv.phase), p["pair"], "\(at) pure pair")
            let sector = pt.sectorName(lv, index: seg.index, frac: seg.frac)
            same("\(sector.name)\(sector.quarter.map { " \($0)" } ?? "")", p["sector"], "\(at) pure sector")
            same(sector.major, p["sectorMajor"], "\(at) pure sector kind")
            let wheres = p["where"] as! [Any]
            for k in 0..<4 {
                same(pt.quarterWhere(lv.thresholds[k + 1].time, level: level), wheres[k], "\(at) pure where \(k)")
            }
            same(pt.blinks(LadderText.justBeforeLead(lv.duration)), p["lead"], "\(at) pure lead")
        }
    }
}

// MARK: - Up next

private func upNextChecks(_ fixtures: [String: Any]) {
    for record in fixtures["records"] as! [[String: Any]] {
        let t = (record["t"] as! NSNumber).doubleValue
        let earth = EarthFormatter(zone: record["zone"] as? String)
        for entry in record["upnext"] as! [[String: Any]] {
            let importance = Importance.byID(entry["imp"] as? String)
            let maxLevel = (entry["maxLevel"] as! NSNumber).intValue
            let at = "t \(t) \(importance.label) max \(maxLevel)"
            let want = entry["events"] as! [[String: Any]]
            let got = Turnovers.upcoming(clock, after: t, importance: importance, maxLevel: maxLevel)
            check(got.count == want.count, "\(at): \(got.count) turnovers, want \(want.count)")
            guard got.count == want.count else { continue }
            let days = Turnovers.byDay(Array(got.dropFirst()), earth: earth, ref: t)
            let nuclides = Turnovers.byNuclide(Array(got.dropFirst())) { pt.turnoverInfo(time: $0.time, top: $0.top) }
            for (k, (e, w)) in zip(got, want).enumerated() {
                let at = "\(at) #\(k)"
                same(e.time, w["time"], "\(at) time")
                same(e.top, w["top"], "\(at) top")
                same(e.finer, w["finer"], "\(at) finer")
                same(LadderText.countdown(e.time - t), w["countdown"], "\(at) countdown")
                same(LadderText.countdownLong(e.time - t), w["countdownLong"], "\(at) countdownLong")
                same(LadderText.whenFull(earth, e.time), w["full"], "\(at) full")
                same(LadderText.turnoverSentence(top: e.top, maxLevel: maxLevel), w["sentence"], "\(at) sentence")
                same(LadderPureText.turnoverWords(top: e.top, maxLevel: maxLevel), w["words"], "\(at) words")
                same(pt.heroLeft(from: t, to: e.time), w["heroLeft"], "\(at) hero left")
                same(pt.left(from: t, to: e.time), w["left"], "\(at) left")
                same(LadderText.justBeforeTurnover(clock: clock, time: e.time, top: e.top), w["before"], "\(at) just before")
                let info = pt.turnoverInfo(time: e.time, top: e.top)
                same(info.name, w["name"], "\(at) name")
                same(info.address, w["address"], "\(at) address")
                same(info.heading, w["heading"], "\(at) heading")
                same(info.stamp, w["stamp"], "\(at) stamp")
                guard k > 0 else { continue }
                let d = days[k - 1], n = nuclides[k - 1]
                same(d.heading, w["day"], "\(at) day")
                same(d.label, w["clock"], "\(at) clock")
                same(d.separated, w["newDay"], "\(at) new day")
                same(n.heading ?? "", w["head"], "\(at) nuclide heading")
                same(n.separated, w["newNuclide"], "\(at) new nuclide")
                same(n.label, info.name ?? "the catalogue ends", "\(at) nuclide label")
            }
        }
    }
}

// MARK: - Fixed tables

private func staticChecks(_ fixtures: [String: Any]) {
    let s = fixtures["statics"] as! [String: Any]
    for u in s["units"] as! [[String: Any]] {
        let level = (u["level"] as! NSNumber).intValue
        same(pt.unitClause(level), u["clause"], "unit clause \(level)")
        same(pt.unitSentence(level), u["sentence"], "unit sentence \(level)")
        same(pt.periodBlinks(clock.levelInfo(level).meanSeconds), u["periodBlinks"], "period blinks \(level)")
        same(LadderPureText.depthWords(level), u["depthWords"], "depth words \(level)")
        same(LadderPureText.levelSay(level), u["say"], "level say \(level)")
    }
    for x in s["sentences"] as! [[String: Any]] {
        let top = (x["top"] as! NSNumber).intValue, max = (x["max"] as! NSNumber).intValue
        same(LadderText.turnoverSentence(top: top, maxLevel: max), x["text"], "sentence \(top) \(max)")
    }
    for x in s["words"] as! [[String: Any]] {
        let top = (x["top"] as! NSNumber).intValue, max = (x["max"] as! NSNumber).intValue
        same(LadderPureText.turnoverWords(top: top, maxLevel: max), x["text"], "words \(top) \(max)")
    }
    for x in s["countdowns"] as! [[String: Any]] {
        let v = (x["s"] as! NSNumber).doubleValue
        same(LadderText.countdown(v), x["text"], "countdown \(v)")
        same(LadderText.countdownLong(v), x["long"], "countdownLong \(v)")
        same(LadderText.remaining(v), x["remaining"], "remaining \(v)")
    }
    for x in s["leads"] as! [[String: Any]] {
        let v = (x["s"] as! NSNumber).doubleValue
        same(LadderText.lead(v), x["text"], "lead \(v)")
        same(pt.blinks(v), x["blinks"], "lead blinks \(v)")
    }
    let utc = EarthFormatter(zone: "UTC")
    for x in s["labels"] as! [[String: Any]] {
        let t = (x["t"] as! NSNumber).doubleValue, ref = (x["ref"] as! NSNumber).doubleValue
        let span = (x["span"] as! NSNumber).doubleValue
        let got: String
        switch span {
        case -1: got = LadderText.whenFull(utc, t, precise: true)
        case -2: got = LadderText.whenFull(utc, t)
        case -3: got = LadderText.dayLabel(utc, t, refYear: 2026)
        case -4: got = LadderText.clockLabel(utc, t)
        default: got = LadderText.whenLabel(utc, t, ref: ref, span: span)
        }
        same(got, x["text"], "label \(t) \(ref) \(span)")
    }
    for x in s["spans"] as! [[String: Any]] {
        let cycle = Int64(x["cycle"] as! String)!, prefix = Int128(x["prefix"] as! String)!
        let span = LadderText.positionSpan(cycle: cycle, prefix: prefix, extent: clock.extent, clipped: (x["clipped"] as! NSNumber).boolValue)
        same(span.from, x["from"], "span from \(cycle)/\(prefix)")
        same(span.to, x["to"], "span to \(cycle)/\(prefix)")
    }
    // the hand-written expectations of test/ladder.test.js
    check(LadderText.counter(local: 99, siblings: 5) == "5 of 5", "the counter never passes the sibling count")
    check([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 112].map(LadderText.ordinal)
        == ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "112th"], "ordinals")
    check(LadderText.segment(phase: 1, factor: 7) == (6, 1), "a full phase stays in the last segment")
    check(LadderText.segment(phase: .nan, factor: 4) == (0, 0), "NaN reads as the start")
    check(LadderText.pctWhole(1) == 99 && LadderText.pctWhole(0.66) == 66, "percent floors and never reaches 100")
    check(LadderText.ratioToDecimal(2, 3, decimals: 6) == "0.666667" && LadderText.ratioToDecimal(5, 2, decimals: 0) == "3", "exact decimals")
    check(LadderText.place(level: 6, local: 0, siblings: 11, cycle: 717_211) == "1 of 11 in ζ 6 · #717\u{202F}212", "the place of a cycle")
    check(LadderText.place(level: 0, local: 5, siblings: 18, cycle: 5) == "6 of 18 in the catalogue", "an Alpha's place")
    check(LadderText.grouped(1_234_567) == "1\u{202F}234\u{202F}567" && LadderText.grouped(12) == "12", "digit groups")
    check(Importance.all.map(\.label) == ["α–γ", "α–δ", "α–ε", "α–ζ", "α–η"], "importance labels")
    check(Importance.byID("nonsense").id == "ζ" && Importance.byID(nil).label == "α–ζ", "importance falls back to α–ζ")
}

// MARK: - Navigation targets

private func navigationChecks() {
    for t in [A, 946_684_800, 2_886_085_800, 1e9, clock.tMin + 5, clock.tMax - 3 * 86_400] {
        for level in 0...13 {
            guard let lv = clock.level(at: t, level) else { continue }
            let before = LadderText.justBeforeTime(end: lv.end, duration: lv.duration)
            check(clock.level(at: before, level)?.cycle == lv.cycle, "Just before stays in the cycle (depth \(level + 1) at \(t))")
            check(lv.end - before <= 2 + 1e-5 && lv.end - before <= lv.duration / 4 + 1e-5, "Just before is at most 2 s or a quarter ahead")
            if lv.end < clock.tMax - 0.01 {
                check(clock.level(at: LadderText.justAfterTime(end: lv.end), level)?.cycle == lv.cycle + 1, "Just after is in the next cycle (depth \(level + 1))")
            }
        }
    }
    for importance in Importance.all {
        for e in Turnovers.upcoming(clock, after: A, importance: importance, maxLevel: 9) {
            let dest = LadderText.justBeforeTurnover(clock: clock, time: e.time, top: e.top)
            check(clock.level(at: dest, e.top)?.cycle == clock.level(at: e.time - 0.01, e.top)?.cycle, "Just before a turnover lands in the cycle that ends")
            check(abs(e.time - dest - 2) < 1e-6, "Just before a turnover of hours is 2 s ahead")
        }
    }
    check(LadderText.lead(2) == "2 s" && LadderText.lead(0.0775) == "78 ms" && LadderText.lead(1.9425) == "1.9 s", "lead texts")
}

// MARK: - Up next memo

private func memoChecks() {
    let memo = TurnoverMemo()
    let imp = Importance.byID("ζ")
    let first = memo.turnovers(clock, at: A, importance: imp, maxLevel: 9)
    let g0 = memo.generation
    _ = memo.turnovers(clock, at: A + 3600, importance: imp, maxLevel: 9)
    check(memo.generation == g0, "the list is reused while it still describes the time")
    _ = memo.turnovers(clock, at: first[0].time + 1, importance: imp, maxLevel: 9)
    check(memo.generation == g0 + 1 && memo.advanced == 1, "a passed turnover recomputes and advances by one: \(memo.advanced)")
    check(memo.turnovers.first?.time == first[1].time, "the list moved up")
    _ = memo.turnovers(clock, at: A - 86_400 * 30, importance: imp, maxLevel: 9)
    check(memo.advanced == -1, "a jump back is not an advance")
    _ = memo.turnovers(clock, at: A, importance: Importance.byID("η"), maxLevel: 9)
    check(memo.advanced == -1 && memo.turnovers.allSatisfy { $0.top <= 6 }, "another importance recomputes")
    let outside = memo.turnovers(clock, at: clock.tMax + 1000, importance: imp, maxLevel: 9)
    check(outside.isEmpty, "nothing outside the catalogue")
    let g1 = memo.generation
    _ = memo.turnovers(clock, at: clock.tMax + 2000, importance: imp, maxLevel: 9)
    check(memo.generation == g1, "outside, the empty list is kept")
    let last = memo.turnovers(clock, at: clock.tMax - 60, importance: imp, maxLevel: 9)
    check(last.allSatisfy { $0.time <= clock.tMax + 1e-6 }, "never past the catalogue")
    check(Turnovers.advance(from: first, to: Array(first.dropFirst(2))) == 2, "advance by two")
    check(Turnovers.advance(from: first, to: [first[3], first[1]]) == -1, "unrelated lists")
    paceChecks()
    rowsCacheChecks()
}

/// The pass animation and the haptic: paced like upnext.js (600 ms), the haptic only for a pass the clock ran into.
private func paceChecks() {
    let memo = TurnoverMemo()
    let imp = Importance.byID("η")
    let list = memo.turnovers(clock, at: A, importance: imp, maxLevel: 9, now: 100, revision: 1)
    check(!memo.passed && !memo.ranPast, "the first list is not a pass")
    _ = memo.turnovers(clock, at: list[0].time + 0.5, importance: imp, maxLevel: 9, now: 101, revision: 1)
    check(memo.passed && memo.ranPast, "running past a turnover animates and taps")
    _ = memo.turnovers(clock, at: list[1].time + 0.5, importance: imp, maxLevel: 9, now: 101.2, revision: 1)
    check(memo.advanced == 1 && !memo.passed && !memo.ranPast, "a second pass 0.2 s later (a time-lapse) is not animated again")
    _ = memo.turnovers(clock, at: list[2].time + 0.5, importance: imp, maxLevel: 9, now: 102, revision: 1)
    check(memo.passed && memo.ranPast, "a pass 0.8 s after the last animated one is animated")
    _ = memo.turnovers(clock, at: list[3].time + 0.001, importance: imp, maxLevel: 9, now: 110, revision: 2)
    check(memo.passed && !memo.ranPast, "Just after (a jump) animates the list but does not tap")
    _ = memo.turnovers(clock, at: list[3].time + 86_400 * 3, importance: imp, maxLevel: 9, now: 120, revision: 3)
    check(!memo.passed && !memo.ranPast, "a jump over many turnovers is not a pass")
}

/// The grouped rows are worked out once per list, mode, zone and year.
private func rowsCacheChecks() {
    let memo = TurnoverMemo()
    let imp = Importance.byID("ζ")
    let utc = EarthFormatter(zone: "UTC"), kyiv = EarthFormatter(zone: "Europe/Kyiv")
    let list = memo.turnovers(clock, at: A, importance: imp, maxLevel: 9)
    let earth = memo.rows(pure: false, earth: utc, ref: A, text: pt)
    check(earth == Turnovers.byDay(Array(list.dropFirst()), earth: utc, ref: A), "Earth rows are the day grouping of the list after the hero")
    check(memo.rows(pure: true, earth: utc, ref: A, text: pt) == Turnovers.byNuclide(Array(list.dropFirst())) { pt.turnoverInfo(time: $0.time, top: $0.top) },
          "pure rows are the Nuclide grouping")
    check(memo.rows(pure: false, earth: kyiv, ref: A + 60, text: pt) == Turnovers.byDay(Array(list.dropFirst()), earth: kyiv, ref: A), "another zone regroups")
    _ = memo.turnovers(clock, at: list[0].time + 1, importance: imp, maxLevel: 9)
    check(memo.rows(pure: false, earth: utc, ref: list[0].time + 1, text: pt).first?.turnover == list[2], "a new list regroups")
}

// MARK: - Cadences

private func cadenceChecks() {
    let means = (0...13).map { clock.levelInfo($0).meanSeconds }
    check(LadderCadence.row(meanSeconds: means[6]) == LadderCadence.readout, "η rows tick at 4 Hz")
    check(LadderCadence.row(meanSeconds: means[9]).map { $0 < 0.1 } == true, "κ rows tick about once a pixel")
    check(LadderCadence.row(meanSeconds: means[10]) == nil && LadderCadence.row(meanSeconds: means[13]) == nil, "λ and finer every frame")
    check(means[12] < LadderCadence.stillBelow && means[11] > LadderCadence.stillBelow, "ν and ξ are too fast to follow, μ is not")
    let blink = Notation.standard.blinkSeconds
    check(LadderCadence.countdown(remaining: 9.9, pure: false, blinkSeconds: blink, container: 0.25) == 0.1, "tenths below 10 s")
    check(LadderCadence.countdown(remaining: 10.2, pure: false, blinkSeconds: blink, container: 0.25) == 0.1, "one tick of lookahead")
    check(LadderCadence.countdown(remaining: 11, pure: false, blinkSeconds: blink, container: 0.25) == nil, "the container is enough above 10 s")
    check(LadderCadence.countdown(remaining: 2, pure: true, blinkSeconds: blink, container: 0.25) != nil, "decimal Blinks tick fast")
    check(LadderCadence.countdown(remaining: 60, pure: true, blinkSeconds: blink, container: 0.25) == nil, "whole Blinks do not")
    check(LadderCadence.countdown(remaining: -1, pure: false, blinkSeconds: blink, container: 0.25) == nil, "nothing after the end")

    // closed rows redraw as often as their bar or their countdown needs
    check(LadderCadence.row(meanSeconds: means[0], remaining: 6e8, pure: false) == 60, "an α row redraws once a minute")
    check(LadderCadence.row(meanSeconds: means[5], remaining: 3 * 86_400, pure: false) == 60, "a ζ row days from its end: once a minute")
    check(LadderCadence.row(meanSeconds: means[5], remaining: 5 * 3600, pure: false) == 1, "… hours from it: once a second")
    check(LadderCadence.row(meanSeconds: means[6], remaining: 3000, pure: false) == 1, "an η row: once a second")
    check(LadderCadence.row(meanSeconds: means[8], remaining: 300, pure: false) == means[8] / 2000, "an ι row: once a bar pixel")
    check(LadderCadence.row(meanSeconds: means[10], remaining: 3, pure: false) == nil, "a λ row: every frame")
    check(LadderCadence.row(meanSeconds: means[4], remaining: 2e6, pure: true) == 60, "pure: a span of ε and coarser changes slowly")
    check(LadderCadence.row(meanSeconds: means[6], remaining: 3000, pure: true) == 1, "pure: an ι λ span ticks every second")
    check(LadderCadence.row(meanSeconds: means[7], remaining: 10, pure: true) == LadderCadence.readout, "pure: a λ ν span ticks 4 times a second")
    check(LadderCadence.row(meanSeconds: means[0]) == LadderCadence.readout, "a row not yet read ticks 4 times a second")
    // measured bars: a phone's ~700 px bar slows ι and κ down to what a pixel needs
    check(LadderCadence.row(meanSeconds: means[8], remaining: 300, pure: false, pixels: 700) == means[8] / 700, "ι on a phone: its own pixel")
    check(LadderCadence.row(meanSeconds: means[8], remaining: 300, pure: false, pixels: 700)! > 0.5, "ι on a phone: under 2 Hz")
    check(LadderCadence.row(meanSeconds: means[9], remaining: 30, pure: false, pixels: 700) == means[9] / 700, "κ on a phone: its own pixel")
    check(LadderCadence.row(meanSeconds: means[10], remaining: 3, pure: false, pixels: 700) == nil, "λ on a phone: every frame")
    check(LadderCadence.row(meanSeconds: means[8], remaining: 300, pure: false, pixels: 0) != nil, "an unmeasured (zero) bar never divides by zero")
    // open rows: the bar's pixel, at least once a second, ν-fast while a pure threshold or start is under two λ away
    check(LadderCadence.openRow(meanSeconds: means[0], untilNext: 1e8, elapsed: 1e8, pure: false) == 1, "an open α row: once a second")
    check(LadderCadence.openRow(meanSeconds: means[0], untilNext: 1e8, elapsed: 1e8, pure: true) == 1, "pure too")
    check(LadderCadence.openRow(meanSeconds: means[8], untilNext: 100, elapsed: 100, pure: false, pixels: 2000) == means[8] / 2000, "an open ι row: its pixel")
    check(LadderCadence.openRow(meanSeconds: means[6], untilNext: 10, elapsed: 3000, pure: true) == LadderCadence.readout, "pure: a threshold in λ ν")
    check(LadderCadence.openRow(meanSeconds: means[6], untilNext: 3000, elapsed: 5, pure: true) == LadderCadence.readout, "pure: started ν ago")
    check(LadderCadence.openRow(meanSeconds: means[6], untilNext: 3000, elapsed: 5, pure: false) == 1, "Earth: the start is a date")
    check(LadderCadence.openRow(meanSeconds: means[11], untilNext: 1, elapsed: 1, pure: false) == nil, "an open μ row: every frame")
    for level in 0...9 {
        for remaining in [0.5, 9, 59, 3599, 86_399, 86_401, 1e7] where remaining < means[level] {
            for pure in [false, true] {
                let c = LadderCadence.row(meanSeconds: means[level], remaining: remaining, pure: pure)
                check(c.map { $0 <= 60 && $0 <= LadderCadence.textStep(remaining: remaining, pure: pure) } ?? true,
                      "a row never waits longer than its countdown's step (depth \(level + 1), \(remaining) s)")
            }
        }
    }
    // Up next: calm (1 s) unless a turnover or the strip's threshold is under ten seconds plus one calm tick away
    check(LadderCadence.upNext(untilNext: nil) == LadderCadence.upNextCalm, "nothing ahead: calm")
    check(LadderCadence.upNext(untilNext: 3600) == LadderCadence.upNextCalm, "an hour ahead: calm")
    check(LadderCadence.upNext(untilNext: 10.5) == LadderCadence.readout, "ten seconds ahead (plus a tick): quick")
    check(LadderCadence.upNext(untilNext: 0.2) == LadderCadence.readout, "about to pass: quick")
}

// MARK: - Pure mode says nothing Earth-ish

private func pureLeakChecks() {
    let earthish = /[0-9]\s?(ms|s|min|h|d|y|wk|mo)\b|%|UTC|\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\b(1[6-9]|2[0-9])[0-9]{2}-[0-9]{2}|second|minute|hour|day|week|month|year/
    var samples: [String] = []
    for t in [A, 946_684_800, 2_886_085_800, clock.tMin + 1, clock.tMax - 1] {
        for level in 0...13 {
            guard let lv = clock.level(at: t, level) else { continue }
            let seg = LadderText.segment(phase: lv.phase, factor: lv.factor)
            let sector = pt.sectorName(lv, index: seg.index, frac: seg.frac)
            samples += [pt.rowLabel(lv), pt.cycleTitle(level: level, cycle: lv.cycle), pt.cycleAddress(level: level, cycle: lv.cycle),
                        LadderPureText.endsText(pt.nextCycle(level: level, cycle: lv.cycle)?.name), pt.left(from: t, to: lv.end),
                        pt.heroLeft(from: t, to: lv.end), pt.length(lv), sector.name, pt.unitSentence(level),
                        pt.periodBlinks(clock.levelInfo(level).meanSeconds), pt.blinks(LadderText.justBeforeLead(lv.duration)),
                        LadderPureText.turnoverWords(top: level, maxLevel: 13)]
            samples += lv.thresholds.map { pt.quarterWhere($0.time, level: level) }
        }
        for importance in Importance.all {
            let turnovers = Turnovers.upcoming(clock, after: t, importance: importance, maxLevel: 9)
            samples += Turnovers.byNuclide(turnovers) { pt.turnoverInfo(time: $0.time, top: $0.top) }.flatMap { [$0.label, $0.heading ?? ""] }
            samples += turnovers.map { pt.turnoverInfo(time: $0.time, top: $0.top).stamp }
        }
    }
    let leaks = samples.filter { $0.contains(earthish) }
    check(leaks.isEmpty, "pure wording leaks Earth terms: \(leaks.prefix(5))")
    check(samples.count > 1000, "the scan saw \(samples.count) strings")
}
