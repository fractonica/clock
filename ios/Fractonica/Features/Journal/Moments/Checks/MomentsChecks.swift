import FractonicaKit
import AVFoundation
import Foundation

// Moments' logic: the moments (every Helion quarter boundary) against FractonicaKit's own cycles and thresholds, their
// labels (the longest level with a quarter boundary there) and names, the call 2 Flavons ahead ringing 11 Flavons, quiet
// hours, the settings, the streak, the collection and the missed calls, the calls that rang out, the `capture` JSON
// (with how its call went) and an edit keeping it, the bundled ringtones and chime, the reel's timing (a span
// even or not about the moment) and a reel made from films, chiming at the moment.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Journal/Moments/Checks

@main @MainActor
struct MomentsChecks {
    static func main() async {
        calendarChecks()
        kitChecks()
        labelChecks()
        promptChecks()
        quietChecks()
        settingsChecks()
        streakChecks()
        captureChecks()
        multiCaptureChecks()
        await storeChecks()
        missedChecks()
        soundChecks()
        reelChecks()
        await reelRenderChecks()
        Checks.finish()
    }
}

private let clock = FractonicaClock.shared
private let calendar = MomentCalendar(clock: clock)
private let notation = Notation.standard
/// SPEC §12 vector A, 2026-10-08 12:00 UTC.
private let vectorA = 1_791_460_800.0
private let utc = TimeZone(identifier: "UTC")!

// MARK: - The calendar

private func calendarChecks() {
    guard let q = calendar.index(after: vectorA), let m = calendar.moment(q), let before = calendar.moment(q - 1) else {
        check(false, "a moment after vector A")
        return
    }
    check(m.time > vectorA && before.time <= vectorA, "index(after:) is the first moment strictly after: \(before.time) \(m.time)")
    // one Helion quarter apart: ≈ 1.263 h
    let quarter = clock.levelInfo(6).meanSeconds / 4
    let list = calendar.upcoming(after: vectorA, count: 400)
    check(list.count == 400, "400 upcoming moments: \(list.count)")
    check(zip(list, list.dropFirst()).allSatisfy { $1.index == $0.index + 1 && $1.time > $0.time }, "moments are consecutive and increasing")
    let gaps = zip(list, list.dropFirst()).map { $1.time - $0.time }
    check(gaps.allSatisfy { abs($0 - quarter) < quarter * 0.01 }, "moments are a Helion quarter apart: \(gaps.min() ?? 0) … \(gaps.max() ?? 0)")
    // index(after:) on many instants, including exactly on a moment
    var ok = true
    for i in 0..<300 {
        let t = vectorA + Double(i) * 1234.567
        guard let q = calendar.index(after: t), let a = calendar.time(of: q), let b = calendar.time(of: q - 1) else { ok = false; break }
        if !(a > t && b <= t) { ok = false; print("  index(after: \(t)) → \(q)") }
    }
    check(ok, "index(after:) settles on the exact times")
    if let exact = calendar.time(of: q) {
        check(calendar.index(after: exact) == q + 1, "a moment's own time is not after itself")
        check(calendar.index(near: exact + 20) == q && calendar.index(near: exact - 20) == q, "index(near:) rounds to the moment")
    }
    check(calendar.previous(atOrBefore: vectorA)?.index == q - 1, "previous(atOrBefore:)")
    // the Preon each boundary falls on, read at the moment's own time (the first millisecond the engine reads it)
    var preons = true
    for m in list.prefix(80) {
        guard let c = notation.clock(at: m.time) else { preons = false; continue }
        let expected = m.level == .helion || m.level == .nuclide ? m.boundary.preon : nil
        let quarterOfHelion = Int(m.index % 4)
        if c.iota != [0, 9, 18, 27][quarterOfHelion] || c.lambda != 0 { preons = false; print("  \(m.index): \(c)") }
        if let expected, expected != c.iota { preons = false; print("  \(m.index) \(m.boundary) at ι \(c.iota)") }
    }
    check(preons, "moments fall on Preon 0, 9, 18 and 27 of their Helion, Flavon 0")
    // the next and previous boundary of each level, by arithmetic
    for level in MomentLevel.allCases {
        guard let n = calendar.next(atLeast: level, after: vectorA), let p = calendar.previous(atLeast: level, atOrBefore: vectorA) else {
            check(level == .alpha, "next and previous \(level.name) boundary")
            continue
        }
        let rank = { (l: MomentLevel) in MomentLevel.allCases.firstIndex(of: l)! }
        check(n.time > vectorA && p.time <= vectorA && rank(n.level) >= rank(level) && rank(p.level) >= rank(level),
              "next / previous \(level.name) boundary: \(p.title()) … \(n.title())")
        let between = calendar.upcoming(after: p.time, count: 3000, scan: 3000).prefix { $0.time < n.time }
        if rank(level) <= rank(.delta) { check(!between.contains { rank($0.level) >= rank(level) }, "nothing of \(level.name) between them") }
    }
    check(calendar.moment(-1) == nil && calendar.index(after: clock.tMax + 10) == nil, "nothing outside the catalogue")
    check(calendar.upcoming(after: clock.tMax - 3 * 3600, count: 10).allSatisfy { $0.time <= clock.tMax }, "no moment past the catalogue's end")
}

/// Every quarter boundary of the Helion, Nuclide, Delta, Gamma, Beta and Alpha running at vector A, as the engine
/// computes them, is a moment, labelled with that level or a longer one.
private func kitChecks() {
    for level in MomentLevel.allCases {
        guard let facts = clock.cycle(at: vectorA, level: level.kitLevel) else {
            check(false, "the \(level.name) at vector A")
            continue
        }
        for (k, event) in facts.events.prefix(4).enumerated() {
            guard let t = event.time else { continue }
            guard let q = calendar.index(near: t), let m = calendar.moment(q) else {
                check(false, "\(level.name) \(event.name) is a moment")
                continue
            }
            check(m.time >= t - 0.001 && m.time - t < 0.005, "\(level.name) \(event.name) is exactly a moment: \(m.time - t) s")
            let longer = MomentLevel.allCases.firstIndex(of: m.level)! >= MomentLevel.allCases.firstIndex(of: level)!
            check(longer, "\(level.name) \(event.name) is labelled \(level.name) or longer: \(m.level)")
            if m.level == level {
                check(m.boundary == MomentBoundary(quarter: k), "\(level.name) \(event.name) is its \(MomentBoundary(quarter: k)): \(m.boundary)")
                check(m.cycle == facts.cycle, "\(level.name) \(event.name) names its cycle: \(m.cycle) vs \(facts.cycle)")
            }
        }
    }
    // a Delta's start reads as the new Delta's first Helion, not the last Preon of the one before
    if let delta = clock.cycle(at: vectorA, level: 3), let q = calendar.index(near: delta.end), let start = calendar.moment(q),
       let c = notation.clock(at: start.time) {
        check(start.boundary == .start, "the next Delta's start: \(start.title())")
        check(c.epsilon == 1 && c.eta == 1 && c.iota == 0 && c.lambda == 0, "a Delta's start reads ε#1 1η 0ι 0λ: \(c)")
        let stamp = notation.dateText(at: start.time, letters: true, upTo: "iota")
        check(stamp.hasSuffix("ε#1 1η 0ι"), "its stamp: \(stamp)")
    }
    // a Delta boundary found with the engine, named in full
    // (the Delta at vector A is a Delta Trifracton, whose node is its Gamma's: take the next one)
    if let here = clock.cycle(at: vectorA, level: 3), let delta = clock.cycle(level: 3, index: here.cycle + 1), let t = delta.events[2].time, let q = calendar.index(near: t), let m = calendar.moment(q) {
        let name = notation.cycleName(level: 3, cycle: delta.cycle)
        check(m.level == .delta && m.boundary == .node && m.title() == "\(name) Node", "the Delta's node: \(m.title())")
        check(m.rarity == .epic && m.capture.level == "delta" && m.capture.rarity == .epic, "a Delta moment is epic")
    }
    if let gamma = clock.cycle(at: vectorA, level: 2), let t = gamma.events[1].time, let q = calendar.index(near: t), let m = calendar.moment(q) {
        check(m.level == .gamma && m.boundary == .peak && m.rarity == .legendary, "the Gamma's peak is legendary: \(m.title())")
    }
    // the next Gamma start is at least a Gamma (its own start, or a longer period's quarter)
    if let gamma = clock.cycle(at: vectorA, level: 2), let q = calendar.index(near: gamma.end), let m = calendar.moment(q) {
        check(m.rarity >= .legendary, "a Gamma's end is a legendary moment or rarer: \(m.title())")
    }
}

/// Over whole periods, each level has exactly its four boundaries; the labels follow the factor ladder.
private func labelChecks() {
    guard let delta = clock.cycle(at: vectorA, level: 3), let first = calendar.index(near: delta.start) else {
        check(false, "the Delta at vector A")
        return
    }
    // one Delta: 385 Helions, 1,540 moments
    var counts: [MomentLevel: Int] = [:]
    var boundaries: [MomentLevel: [MomentBoundary]] = [:]
    for q in first..<(first + 385 * 4) {
        let (level, j) = calendar.label(q)
        counts[level, default: 0] += 1
        boundaries[level, default: []].append(MomentBoundary(quarter: Int(j % 4)))
    }
    let atLeastDelta = (counts[.delta] ?? 0) + (counts[.gamma] ?? 0) + (counts[.beta] ?? 0) + (counts[.alpha] ?? 0)
    check(atLeastDelta == 4, "a Delta has 4 boundaries of Delta or longer: \(counts)")
    check((counts[.nuclide] ?? 0) + atLeastDelta == 20, "5 Nuclides have 20 boundaries: \(counts)")
    check(counts[.helion] == 1540 - 20, "the rest are Helion moments: \(counts[.helion] ?? 0)")
    let helion = boundaries[.helion] ?? []
    check(helion.filter { $0 == .start }.count > 0 && helion.filter { $0 == .valley }.count > 0, "Helion moments of every boundary")
    check(calendar.moment(first)?.level != .helion && calendar.moment(first)?.boundary == .start, "the Delta begins on a start")
    // names
    if let m = calendar.upcoming(after: vectorA, count: 200, where: { $0.level == .helion && $0.boundary == .node }).first {
        let helionName = notation.cycleShort(level: 6, cycle: m.cycle)
        check(m.title() == "Helion \(helionName) Descending Node" && helionName.hasSuffix("η"), "a Helion node's name: \(m.title())")
    }
    if let m = calendar.upcoming(after: vectorA, count: 200, where: { $0.level == .helion && $0.boundary == .start }).first {
        check(m.title() == "Helion \(notation.cycleShort(level: 6, cycle: m.cycle)) Ascending Node", "a Helion start's name: \(m.title())")
    }
    if let m = calendar.upcoming(after: vectorA, count: 200, where: { $0.level == .helion && $0.boundary == .peak }).first {
        check(m.title().hasSuffix(" Peak"), "a Helion peak keeps its name: \(m.title())")
    }
    if let m = calendar.upcoming(after: vectorA, count: 2000, scan: 4000, where: { $0.level == .nuclide && $0.boundary == .start }).first {
        check(m.title().hasPrefix("Nuclide ε#") && m.title().hasSuffix(" Start") && m.rarity == .rare, "a Nuclide start's name: \(m.title())")
    }
    // a moment leads with its Pentad (SPEC §7.5): a Helion start belongs to the Pentad it starts in
    var starts = 0
    for m in calendar.upcoming(after: vectorA, count: 80, where: { $0.boundary == .start }) {
        guard let p = clock.pentad(at: m.time + 1) else { continue }
        if m.pentad != p.index { check(false, "a moment's Pentad is the one running just after it: \(m.title())") }
        if p.helion == 1 { starts += 1 }
        let led = m.ledTitle(notation)
        check(led == "\(PentadWords.name(p.index)) · \(m.title(notation))", "a moment's title led by its Pentad: \(led)")
    }
    check(starts > 0, "some starts open a Pentad, and belong to it")
}

private func promptChecks() {
    let flavon = clock.levelInfo(10).meanSeconds
    for m in calendar.upcoming(after: vectorA, count: 50) {
        let p = calendar.promptTime(of: m), end = calendar.ringEnd(of: m)
        let lead = m.time - p
        if abs(lead - 2 * flavon) > 0.1 { check(false, "2 Flavons ahead: \(lead) s"); return }
        let f = calendar.flavons(from: p, to: m), g = calendar.flavons(from: end, to: m)
        if abs(f - 2) > 0.001 || abs(g + 9) > 0.001 { check(false, "2 Flavons ahead, nine after, by position: \(f), \(g)"); return }
        if calendar.ringing(at: p - 0.01)?.index == m.index || calendar.ringing(at: p + 0.01)?.index != m.index
            || calendar.ringing(at: m.time + 5 * flavon)?.index != m.index || calendar.ringing(at: end + 0.01)?.index == m.index {
            check(false, "ringing(at:) over \(m.index)'s call"); return
        }
    }
    check(true, "every call rings 2 Flavons before its moment, for 11 Flavons")
    check(calendar.ringing(at: calendar.upcoming(after: vectorA, count: 1)[0].time - 30 * flavon) == nil, "no call between moments")
}

private func quietChecks() {
    let q = MomentQuietHours()
    let midnight = 1_791_417_600.0  // 2026-10-08 00:00 UTC
    func at(_ h: Double) -> Double { midnight + h * 3600 }
    check(q.contains(at(23.5), zone: utc) && q.contains(at(3), zone: utc) && q.contains(at(6.99), zone: utc), "23:00 – 07:00 holds the night")
    check(!q.contains(at(7), zone: utc) && !q.contains(at(12), zone: utc) && !q.contains(at(22.99), zone: utc), "… and not the day")
    let kyiv = TimeZone(identifier: "Europe/Kyiv")!
    check(q.contains(at(21), zone: kyiv) && !q.contains(at(21), zone: utc), "quiet hours follow the zone")
    var day = MomentQuietHours(enabled: true, start: 13 * 60, end: 14 * 60)
    check(day.contains(at(13.5), zone: utc) && !day.contains(at(14), zone: utc), "a window inside the day")
    day.enabled = false
    check(!day.contains(at(13.5), zone: utc), "disabled quiet hours hold nothing")
}

private func settingsChecks() {
    var s = MomentSettings()
    let list = calendar.upcoming(after: vectorA, count: 3000, scan: 3000)
    let peak = list.first { $0.level == .helion && $0.boundary == .peak }!
    let node = list.first { $0.level == .helion && $0.boundary == .node }!
    let delta = list.first { $0.level == .delta } ?? calendar.upcoming(after: vectorA, count: 1, scan: 3000) { $0.rarity >= .epic }.first!
    let start = list.first { $0.level == .helion && $0.boundary == .start }!
    let nuclideStart = calendar.upcoming(after: vectorA, count: 1, scan: 3000) { $0.level == .nuclide && $0.boundary == .start }.first!
    let nuclidePeak = calendar.upcoming(after: vectorA, count: 1, scan: 3000) { $0.level == .nuclide && $0.boundary == .peak }.first!
    check(s.enabled && s.helion == .nodes && s.quiet.enabled && s.ringtone == .helion,
          "defaults: on, Helion nodes, quiet hours, the Helion ringtone")
    check(s.asks(start) && !s.asks(peak) && s.asks(node) && s.asks(delta),
          "a Helion's two nodes (its start and mid point) are rare moments; Delta and longer always")
    check(s.asks(nuclideStart) && !s.asks(nuclidePeak), "a Nuclide's start is a Helion's start; its peak a Helion's peak")
    // twice a Helion: over a Nuclide, its 77 starts and 77 nodes (a Delta's boundaries among them)
    let nuclide = calendar.next(atLeast: .nuclide, after: vectorA)!
    let asked = calendar.upcoming(after: nuclide.time - 1, count: 10_000, scan: 77 * 4) { s.asks($0) }
    check(asked.count == 2 * 77, "two moments a Helion: \(asked.count) in a Nuclide")
    s.helion = .none
    check(!s.asks(node) && !s.asks(start) && s.asks(delta), "Delta and longer are always asked for")
    s.enabled = false
    check(!s.asks(delta), "off: nothing")
    // persistence, lenient
    var t = MomentSettings()
    t.helion = .none
    t.quiet.start = 22 * 60
    let data = try! JSONEncoder().encode(t)
    check((try? JSONDecoder().decode(MomentSettings.self, from: data)) == t, "settings round-trip")
    let partial = try? JSONDecoder().decode(MomentSettings.self, from: Data(#"{"helion":"bogus","autoOpen":false,"ringtone":"bell"}"#.utf8))
    check(partial?.helion == .nodes && partial?.autoOpen == false && partial?.enabled == true && partial?.ringtone == .bell,
          "unknown values take their defaults")
    // quiet hours stop prompting
    let s2 = MomentSettings()
    let night = list.first { s2.asks($0) && s2.quiet.contains($0.time, zone: utc) }!
    check(s2.asks(night) && !s2.prompts(night, zone: utc), "a moment in quiet hours is not announced")
}

// MARK: - Streak

private func entry(_ m: Moment, id: String? = nil) -> HubRecord {
    var r = HubRecord.journalEntry(id: id ?? "m\(m.index)", time: m.time, zone: "UTC", entry: JournalEntry(emoji: "📸"), blobs: [], now: m.time)
    r.data = r.data.with(capture: m.capture)
    return r
}

private func streakChecks() {
    var settings = MomentSettings()
    settings.quiet.enabled = false
    let list = calendar.upcoming(after: vectorA, count: 30, scan: 400) { settings.asks($0) }
    // ten in a row, then a miss, then five
    let first = Array(list[0..<10]), second = Array(list[11..<16])
    let records = (first + second).map { entry($0) } + [HubRecord.journalEntry(time: vectorA, zone: nil, entry: JournalEntry(markdown: "plain"), blobs: [], now: vectorA)]
    let now = list[16].time + 5  // the moment after the last capture has just passed: within the grace
    var stats = MomentStats.make(entries: records, calendar: calendar, settings: settings, zone: utc, now: now)
    check(stats.current == 5 && stats.best == 10, "a miss ends the run: current \(stats.current), best \(stats.best)")
    check(stats.total(.common) == 1 && stats.capturedCount == 15, "totals: \(stats.totals)")
    check(stats.total(.rare) + stats.total(.epic) + stats.total(.legendary) + stats.total(.mythic) + stats.total(.cosmic) == 15, "every capture has a rarity")
    // once the grace has passed, the missed moment ends the run
    stats = MomentStats.make(entries: records, calendar: calendar, settings: settings, zone: utc, now: list[17].time + 1)
    check(stats.current == 0 && stats.best == 10, "a moment missed for good: current \(stats.current)")
    // moments that are not announced neither count nor break
    let asked = list
    let picked = Array(asked.prefix(6))
    stats = MomentStats.make(entries: picked.map { entry($0) }, calendar: calendar, settings: settings, zone: utc, now: picked.last!.time + 30)
    check(stats.current == 6 && stats.best == 6, "starts, peaks and valleys are skipped: \(stats.current)")
    // quiet hours are skipped too
    var quiet = MomentSettings()
    quiet.quiet = MomentQuietHours(enabled: true, start: 0, end: 12 * 60)
    let span = calendar.upcoming(after: 1_791_417_600 - 7200, count: 40)
    let loud = span.filter { quiet.prompts($0, zone: utc) }
    stats = MomentStats.make(entries: loud.map { entry($0) }, calendar: calendar, settings: quiet, zone: utc, now: loud.last!.time + 30)
    check(loud.count < span.count && stats.current == loud.count, "quiet hours do not break the streak: \(stats.current) of \(loud.count)")
    // a capture a few hundredths of a second off its moment still counts; one that is not on a moment does not
    var off = entry(list[0])
    off.data = off.data.with(capture: MomentCapture(at: list[0].time + 0.02, level: "helion", boundary: "start", rarity: .rare))
    var stray = entry(list[1], id: "stray")
    stray.data = stray.data.with(capture: MomentCapture(at: list[1].time + 600, level: "helion", boundary: "start", rarity: .rare))
    stats = MomentStats.make(entries: [off, stray], calendar: calendar, settings: settings, zone: utc, now: list[0].time + 30)
    check(stats.captured == [list[0].index], "only captures on a moment count: \(stats.captured)")
    check(MomentStats.make(entries: [], calendar: calendar, settings: settings, zone: utc, now: vectorA) == MomentStats(), "no captures, no streak")
}

// MARK: - The record

private func captureChecks() {
    let m = calendar.upcoming(after: vectorA, count: 1, scan: 3000) { $0.level == .delta }.first!
    let r = entry(m)
    check(r.capture == m.capture && r.rarity == .epic, "capture round-trips through data")
    let json = try! JSONEncoder().encode(r)
    let back = try! JSONDecoder().decode(HubRecord.self, from: json)
    check(back.capture?.at == m.time && back.capture?.boundary == m.boundary.rawValue && back.entry?.emoji == "📸", "capture survives JSON")
    let text = String(decoding: json, as: UTF8.self)
    check(text.contains(#""capture":{"#) && text.contains(#""rarity":"epic""#), "capture is in data: \(text.prefix(300))")
    // a capture without a rarity takes its level's
    let bare = MomentCapture(json: .object(["at": .number(1), "level": .string("alpha"), "boundary": .string("node")]))
    check(bare?.rarity == .cosmic, "rarity from the level")
    check(MomentCapture(json: .object(["level": .string("alpha")])) == nil, "no time, no capture")
    // how its call went
    for outcome in MomentOutcome.allCases {
        let c = MomentCapture(json: m.capture(outcome).json)
        if c?.outcome != outcome || c?.at != m.time { check(false, "the outcome \(outcome) round-trips"); return }
    }
    check(MomentCapture(json: m.capture.json)?.outcome == nil && m.capture.json.object?["outcome"] == nil, "a capture before the calls has none")
    var odd = m.capture.json.object!
    odd["outcome"] = .string("hung")
    check(MomentCapture(json: .object(odd))?.outcome == nil, "an unknown outcome reads as none")
    var missed = entry(m)
    missed.data = missed.data.with(capture: m.capture(.missed))
    check(missed.rarity == .common && missed.capture?.missed == true, "a missed call captured nothing: common")
    check(MomentOutcome.missed.title == "Missed" && MomentOutcome.missed.emoji == "🔴" && MomentOutcome.muted.title == "Muted",
          "a missed call's entry: Missed, red")
    check(HubRecord.journalEntry(time: 1, zone: nil, entry: JournalEntry(), blobs: [], now: 1).rarity == .common, "no capture: common")
    // the composer's data keeps capture
    let edited = JournalEntry(emoji: "🌙", markdown: "edited").data.keepingFields(of: r.data)
    check(edited["capture"] == r.data["capture"] && edited["markdown"]?.string == "edited" && edited["emoji"]?.string == "🌙", "an edit keeps capture")
    let cleared = JournalEntry(markdown: "x").data.keepingFields(of: JournalEntry(emoji: "🌙", title: "t", markdown: "y").data)
    check(cleared["emoji"] == nil && cleared["title"] == nil, "an edit may still clear the emoji and the title")
    check(MomentRarity.allCases.sorted() == MomentRarity.allCases && MomentRarity.cosmic > .mythic, "rarities are ordered")
    check(MomentLevel.allCases.map(\.rarity) == [.rare, .rare, .epic, .legendary, .mythic, .cosmic], "levels give rarities")
}

/// Several photo captures of a moment (as the app made them before its reels): their offsets, times and photo names
/// (hub/API.md), still read and shown.
private func multiCaptureChecks() {
    check(MomentCaptures.offsets(count: 1) == [0], "one capture: at the moment")
    check(MomentCaptures.offsets(count: 3) == [-1, 0, 1], "three: a Flavon before, at, a Flavon after")
    check(MomentCaptures.offsets(count: 5) == [-2, -1, 0, 1, 2], "five: two Flavons either side")
    check(MomentCaptures.offsets(count: 4) == [-1, 0, 1] && MomentCaptures.offsets(count: 0) == [-1, 0, 1], "another count takes the default")
    // names
    check(MomentCaptures.photoName(camera: "front", offset: 0, count: 1) == "front"
          && MomentCaptures.photoName(camera: "back", offset: 0, count: 1) == "back", "a single capture: front, back")
    let names = MomentCaptures.offsets(count: 3).flatMap { k in
        ["front", "back"].map { MomentCaptures.photoName(camera: $0, offset: k, count: 3) }
    }
    check(names == ["front@-1", "back@-1", "front@0", "back@0", "front@1", "back@1"], "several: front@-1 … back@1: \(names)")
    check(MomentCaptures.parse("front@-1")! == ("front", -1) && MomentCaptures.parse("back@2")! == ("back", 2), "names read back")
    check(MomentCaptures.parse("back")! == ("back", nil) && MomentCaptures.parse("x@y") == nil, "plain names, and bad offsets")
    check(MomentCaptures.sorted(names) == ["back@-1", "back@0", "back@1", "front@-1", "front@0", "front@1"],
          "kept back first, through the moment, then front: \(MomentCaptures.sorted(names))")
    check(MomentCaptures.sorted(["front", "back", "voice"]) == ["back", "front", "voice"], "a single capture: back, front")
    check(MomentCaptures.offsetTag(-1) == "\u{2212}1λ" && MomentCaptures.offsetTag(0) == "0" && MomentCaptures.offsetTag(2) == "+2λ", "tags")
    check(MomentCaptures.offsetLabel(-2) == "2λ before" && MomentCaptures.offsetLabel(1) == "1λ after", "labels")
    // grouping
    let groups = MomentCaptureGroup<String>.grouped(MomentCaptures.sorted(names)) { $0 }
    check(groups?.map(\.offset) == [-1, 0, 1], "grouped by offset, earliest first")
    check(groups?.allSatisfy { $0.main?.hasPrefix("back@") == true && $0.inset?.hasPrefix("front@") == true } == true,
          "each capture: the back photo with the front one as its inset")
    check(MomentCaptureGroup<String>.grouped(["front", "back"]) { $0 } == nil, "a single capture is not grouped")
    check(MomentCaptureGroup<String>.grouped(["back@0", "clip"]) { $0 } == nil, "other media: not grouped")
    check(MomentCaptureGroup<String>.grouped(["camera@-1", "camera@0"]) { $0 }?.map { $0.inset == nil } == [true, true],
          "one camera: no inset")
    // times: one Flavon apart in position, the moment itself in the middle
    let flavon = clock.levelInfo(10).meanSeconds
    for m in calendar.upcoming(after: vectorA, count: 20) {
        let times = MomentCaptures.offsets(count: 5).map { calendar.captureTime(of: m, offset: $0) }
        if times[2] != m.time { check(false, "the middle capture is the moment"); return }
        for (k, t) in zip(MomentCaptures.offsets(count: 5), times) where k != 0 {
            let f = calendar.flavons(from: t, to: m)
            if abs(f + Double(k)) > 0.0002 || t * 1000 != (t * 1000).rounded() || abs(abs(t - m.time) - Double(abs(k)) * flavon) > 0.5 {
                check(false, "capture \(k): \(f) Flavons from the moment, at \(t)")
                return
            }
        }
        if !zip(times, times.dropFirst()).allSatisfy({ $0 < $1 }) { check(false, "captures in order"); return }
    }
    check(true, "captures are a Flavon apart, on the millisecond, around the moment")
    // settings saved when there was a count still read (the count is gone)
    let old = try? JSONDecoder().decode(MomentSettings.self, from: Data(#"{"captures":5,"voice":false,"autoOpen":false}"#.utf8))
    check(old?.autoOpen == false && old?.enabled == true, "old settings with a capture count and a voice still read")
}

@MainActor private func storeChecks() async {
    let root = FileManager.default.temporaryDirectory.appending(path: "moments-checks-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let store = JournalStore(disk: JournalDisk(root: root))
    store.loadNow()
    let m = calendar.upcoming(after: vectorA, count: 1).first!
    let saved = store.save(entry(m))
    var draft = JournalDraft(key: saved.id, recordID: saved.id, emoji: "🌊", title: "", markdown: "added later", time: saved.time, timeChosen: true, zone: "UTC")
    draft.blobs = []
    let edited = store.saveEntry(draft)
    check(edited.capture == m.capture && edited.entry?.markdown == "added later" && edited.entry?.emoji == "🌊", "editing a captured entry keeps its capture")
    check(edited.time == m.time, "and its moment")
}

// MARK: - Missed calls

private func missedChecks() {
    var settings = MomentSettings()
    settings.quiet.enabled = false
    let flavon = clock.levelInfo(10).meanSeconds
    let list = calendar.upcoming(after: vectorA, count: 12, scan: 400) { settings.asks($0) }
    // the stats: a missed call's entry is neither a capture nor in the collection
    func call(_ m: Moment, _ outcome: MomentOutcome, id: String? = nil) -> HubRecord {
        var r = entry(m, id: id)
        r.data = r.data.with(capture: m.capture(outcome))
        return r
    }
    let records = [call(list[0], .answered), call(list[1], .missed), call(list[2], .declined), call(list[3], .muted),
                   call(list[4], .missed), call(list[4], .answered, id: "elsewhere"), call(list[5], .missed)]
    let stats = MomentStats.make(entries: records, calendar: calendar, settings: settings, zone: utc, now: list[6].time + 5)
    check(stats.captured == Set([list[0], list[2], list[3], list[4]].map(\.index)), "answered, declined and muted count; missed do not")
    check(stats.missed == Set([list[1].index, list[5].index]) && stats.missedCount == 2,
          "missed calls, but not one answered on another device: \(stats.missed)")
    check(stats.missedTimes == [list[1].time, list[5].time] && stats.missedCount(after: list[3].time) == 1, "the missed calls after a time")
    check(stats.totals.values.reduce(0, +) == 4, "missed calls are not in the collection: \(stats.totals)")
    check(stats.current == 0 && stats.best == 3, "a missed call ends the run: \(stats.current), best \(stats.best)")
    // the calls that rang out: announced, from `since` on, rung out by `now`, none covered
    let since = calendar.promptTime(of: list[1]) - 1
    let now = calendar.ringEnd(of: list[5]) + 1
    let rang = MomentCalls.unanswered(since: since, now: now, calendar: calendar, settings: settings, zone: utc, covered: [list[2].index])
    check(rang.map(\.index) == [1, 3, 4, 5].map { list[$0].index }, "rang out: \(rang.map(\.index))")
    let ringing = MomentCalls.unanswered(since: since, now: calendar.ringEnd(of: list[5]) - 1, calendar: calendar, settings: settings, zone: utc, covered: [])
    check(ringing.last?.index == list[4].index, "a call still ringing has not rung out")
    let begun = MomentCalls.unanswered(since: calendar.promptTime(of: list[1]) + 1, now: now, calendar: calendar, settings: settings, zone: utc, covered: [])
    check(begun.first?.index == list[2].index, "a call rung before the calls began is not missed")
    check(MomentCalls.unanswered(since: now, now: now - 1, calendar: calendar, settings: settings, zone: utc, covered: []).isEmpty, "nothing before since")
    var quiet = settings
    quiet.quiet = MomentQuietHours(enabled: true, start: 0, end: 24 * 60 - 1)
    check(MomentCalls.unanswered(since: since, now: now, calendar: calendar, settings: quiet, zone: utc, covered: []).isEmpty,
          "quiet hours do not call, nor miss")
    let limited = MomentCalls.unanswered(since: vectorA, now: vectorA + 40 * 3600, calendar: calendar, settings: settings, zone: utc, covered: [], limit: 5)
    check(limited.count == 5 && limited.allSatisfy { calendar.ringEnd(of: $0) <= vectorA + 40 * 3600 }, "at most the limit")
    check(abs(MomentRingtone.cycle - flavon / 2) < 0.01, "a ring is half a Flavon: \(MomentRingtone.cycle)")
}

// MARK: - Sounds

/// Resources/Moments.
private let soundFolder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appending(path: "Resources/Moments")

private func soundChecks() {
    // the ringtones: the synthesised ones whole rings, the alarms whole repeats of theirs, all under the 30 s a
    // notification's or an alarm's sound may last
    check(MomentRingtone.synthesised.count == 4 && MomentRingtone.alarms.count == 18 && MomentRingtone.allCases.first == .helion,
          "four synthesised ringtones, then 18 alarms")
    check(Set(MomentRingtone.allCases.map(\.title)).count == MomentRingtone.allCases.count, "each ringtone its own name")
    for tone in MomentRingtone.allCases {
        let url = soundFolder.appending(path: tone.fileName)
        guard let file = try? AVAudioFile(forReading: url) else {
            check(false, "the ringtone \(tone.fileName) is there")
            continue
        }
        let seconds = Double(file.length) / file.fileFormat.sampleRate
        if tone.isSynthesised {
            check(abs(seconds - Double(MomentRingtone.rings) * MomentRingtone.cycle) < 0.05 && seconds < 30,
                  "\(tone.fileName): \(MomentRingtone.rings) rings, \(String(format: "%.2f", seconds)) s")
        } else {
            check(seconds > 15 && seconds <= 28.05 && file.fileFormat.channelCount == 1,
                  "\(tone.fileName) (\(tone.title)): mono, \(String(format: "%.2f", seconds)) s")
        }
    }
    // the chime at the moment, from its first sound, at the reel's rate
    let chime = MomentReelRenderer.chime(soundFolder.appending(path: "moment-chime.caf")) ?? []
    let onset = chime.prefix(480).map(abs).max() ?? 0
    check(abs(Double(chime.count) / 48_000 - 1.48) < 0.03 && onset > 0.05,
          "the chime: \(String(format: "%.2f", Double(chime.count) / 48_000)) s at 48 kHz, sounding from its start (\(onset))")
}

// MARK: - The reel

private func reelChecks() {
    let flavon = clock.levelInfo(10).meanSeconds
    // the film: half a Flavon either side of the moment, by position
    for m in calendar.upcoming(after: vectorA, count: 6) {
        let span = calendar.filmSpan(of: m)
        let before = calendar.flavons(from: span.start, to: m), after = calendar.flavons(from: span.end, to: m)
        if abs(before - 0.5) > 1e-4 || abs(after + 0.5) > 1e-4 || span.start >= m.time || span.end <= m.time {
            check(false, "the film spans half a Flavon either side: \(before), \(after)")
        }
    }
    check(true, "a moment's film spans half a Flavon either side of it")
    let timing = MomentReelTiming(before: flavon / 2, after: flavon / 2)
    typealias T = MomentReelTiming
    check(abs(timing.duration - flavon) < 1e-9 && timing.frameCount == Int((timing.duration / timing.frame).rounded()),
          "the reel lasts the film, at real time, a frame each Sub-blink")
    check(abs(T.subBlink - clock.levelInfo(12).meanSeconds / 7) < 1e-9 && abs(T.subBlink - 0.0444) < 0.0005,
          "a Sub-blink, a seventh of a Blink: \(T.subBlink) s")
    // its landmarks (u: seconds from the moment)
    check(abs(timing.source(at: 0) + flavon / 2) < 1e-9, "the reel opens half a Flavon before the moment")
    check(abs(timing.source(at: flavon / 2)) < 1e-9 && abs(timing.moment - flavon / 2) < 1e-9, "it reaches the moment halfway, the chime there")
    check(abs(timing.source(at: timing.duration) - flavon / 2) < 1e-9, "and ends half a Flavon after")
    check((0..<40).allSatisfy { k in
        let t = timing.duration * Double(k) / 40
        return abs(timing.source(at: t) - (t - flavon / 2)) < 1e-9
    }, "every instant where it was filmed, at real time")
    // an answered call's reel: picked up 3 s before the moment, hung up 20 s after
    let answered = MomentReelTiming(before: 3, after: 20)
    check(abs(answered.duration - 23) < 1e-9 && abs(answered.moment - 3) < 1e-9 && abs(answered.source(at: 3)) < 1e-9,
          "an answered call's film once, 23 s, its chime at 3 s")
    // the words: the date without the cycles' marks, the time down to the Sub-blink, one ξ a frame
    let date = MomentReelText.date(at: vectorA, notation: notation)
    check(date == "α6 β4 γ9 δ3 ε5", "the date: \(date)")
    let time = MomentReelText.time(at: vectorA, notation: notation)
    check(time.hasPrefix("34η 29ι 21λ ") && time.hasSuffix("ξ"), "the time to the ξ: \(time)")
    let xi = T.subBlink
    let start = vectorA + 0.0123
    let reads = (0..<40).map { i -> Int64 in
        let jitter = Double((i * 7919) % 11 - 5) / 5 * 0.004 // ±4 ms
        return clock.level(at: MomentReelText.readAt(start + Double(i) * xi + jitter, first: start, frame: xi), 13)!.cycle
    }
    check(zip(reads, reads.dropFirst()).allSatisfy { $1 == $0 + 1 }, "frames a Sub-blink apart read one ξ apart, jitter or not")
    // the frames an output frame blends
    let times = [-0.5, -0.25, 0, 0.25, 0.5]
    check(MomentReelFrames.pick(times, -1) == (0, 0, 0) && MomentReelFrames.pick(times, 2) == (4, 4, 0), "outside the film: its ends held")
    let p = MomentReelFrames.pick(times, 0.1)
    check(p.a == 2 && p.b == 3 && abs(p.weight - 0.4) < 1e-12, "between two frames: both, weighted by nearness")
}

// MARK: - The reel, made

/// Two films as the cameras write them (HEVC, portrait, their time zero a host clock's hours in), made into a reel.
private func reelRenderChecks() async {
    let dir = FileManager.default.temporaryDirectory.appending(path: "reel-checks-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let flavon = clock.levelInfo(10).meanSeconds
    let moment = vectorA
    let half = flavon / 2
    var films: [MomentFilm] = []
    for (camera, rate) in [("back", 60.0), ("front", 30.0)] {
        let url = dir.appending(path: "\(camera).mov")
        guard let first = writeFilm(to: url, from: moment - half, to: moment + half, rate: rate) else {
            check(false, "the \(camera) film was written")
            return
        }
        films.append(MomentFilm(camera: camera, url: url, start: first))
    }
    let soundURL = dir.appending(path: "sound.m4a")
    guard writeTone(to: soundURL, seconds: 2 * half) else {
        check(false, "the sound film was written")
        return
    }
    films.append(MomentFilm(camera: "sound", url: soundURL, start: moment - half))
    var script = MomentReelScript(center: moment, half: half, notation: notation, accent: [0.3, 0.5, 1], side: 160)
    script.chime = soundFolder.appending(path: "moment-chime.caf")
    let out = dir.appending(path: "reel.mov")
    do {
        let report = try await MomentReelRenderer.render(films: films, script: script, to: out) { _ in }
        check(report.gaps.isEmpty, "the films read to their ends, without gaps: \(report.gaps)")
        check(report.notes.count == 3 && report.notes[0].hasPrefix("back: ") && report.notes[0].contains("none without a picture")
              && !report.notes[0].contains("stopped"), "how each film was read, for the archive: \(report.notes)")
    } catch {
        check(false, "the reel is made from two films: \(error.localizedDescription)")
        return
    }
    if let keep = ProcessInfo.processInfo.environment["FX_REEL_OUT"] {
        try? FileManager.default.removeItem(atPath: keep)
        try? FileManager.default.copyItem(at: out, to: URL(fileURLWithPath: keep))
    }
    let asset = AVURLAsset(url: out)
    let timing = script.timing
    let duration = (try? await asset.load(.duration).seconds) ?? 0
    let video = try? await asset.loadTracks(withMediaType: .video).first
    let audio = try? await asset.loadTracks(withMediaType: .audio).first
    let size = try? await video?.load(.naturalSize)
    check(abs(duration - timing.duration) < 0.1, "the reel lasts the film: \(duration) s of \(timing.duration)")
    check(size == CGSize(width: 160, height: 320), "two squares, one over the other: \(String(describing: size))")
    // the heard tone runs under the chime: at the reel's start, up to the moment, and on to the end
    let pcm = await samples(of: out)
    func rms(_ x: [Float], _ from: Double, _ to: Double) -> Double {
        let a = max(0, Int(from * 48_000)), b = min(x.count, Int(to * 48_000))
        guard b > a else { return 0 }
        return (x[a..<b].reduce(0) { $0 + Double($1 * $1) } / Double(b - a)).squareRoot()
    }
    // (the tone, 0.4 at its peak, brought to 0.7)
    check(audio != nil && abs(rms(pcm, 0.5, 1.5) - 0.7 / 2.squareRoot()) < 0.06, "the heard sound at the start, at a steady level: \(rms(pcm, 0.5, 1.5))")
    let m = timing.moment
    check(rms(pcm, m - 1, m - 0.1) > 0.1, "and up to the moment: \(rms(pcm, m - 1, m - 0.1))")
    check(rms(pcm, timing.duration - 1.5, timing.duration - 0.2) > 0.1, "and to the end: \(rms(pcm, timing.duration - 1.5, timing.duration - 0.2))")
    // the chime from the moment on: what the same reel without it lacks there and nowhere before
    var quiet = script
    quiet.chimes = false
    let quietURL = dir.appending(path: "reel-quiet.mov")
    _ = try? await MomentReelRenderer.render(films: films, script: quiet, to: quietURL) { _ in }
    let without = await samples(of: quietURL)
    let chime = zip(pcm, without).map { $0 - $1 }
    let chimeBefore = rms(chime, m - 0.6, m - 0.05), chimeAfter = rms(chime, m, m + 0.6)
    check(!without.isEmpty && chimeAfter > 0.1 && chimeBefore < 0.01, "the chime at the moment: \(chimeAfter) from it on, \(chimeBefore) before it")

    // read a few seconds a reader: the same frames as one reader for the whole
    let whole = await frameSamples(out, stretch: 1000), stretched = await frameSamples(out, stretch: 0.5)
    check(whole.frames.count == timing.frameCount && whole.readers == 1, "the reel's frames, read whole: \(whole.frames.count) of \(timing.frameCount)")
    check(stretched.frames.map(\.time) == whole.frames.map(\.time) && stretched.frames.map(\.luma) == whole.frames.map(\.luma)
          && stretched.readers >= Int(duration / 0.5) - 1,
          "read half a second a reader, the same frames: \(stretched.frames.count) by \(stretched.readers) readers")

    // reversed: the last frame first, each lasting as long, the sound backwards with the picture
    let reversedURL = dir.appending(path: "reversed.mov")
    do {
        try await VideoReverser.reverse(out, to: reversedURL)
        let reversed = await frameSamples(reversedURL, stretch: 1000)
        let length = (try? await AVURLAsset(url: reversedURL).load(.duration).seconds) ?? 0
        check(abs(length - duration) < 0.05 && reversed.frames.count == whole.frames.count,
              "the reversed reel: as long, as many frames: \(length) s, \(reversed.frames.count)")
        let n = whole.frames.count
        func difference(_ a: [UInt8], _ b: [UInt8]) -> Double {
            Double(zip(a, b).reduce(0) { $0 + abs(Int($1.0) - Int($1.1)) }) / Double(max(a.count, 1))
        }
        let mirrored = (0..<n).map { difference(reversed.frames[$0].luma, whole.frames[n - 1 - $0].luma) }.max() ?? 99
        let straight = (0..<n).map { difference(reversed.frames[$0].luma, whole.frames[$0].luma) }.reduce(0, +) / Double(max(n, 1))
        check(mirrored < 4 && straight > 4 * mirrored, "frame k is the reel's frame n − 1 − k: \(mirrored) apart at most (\(straight) in order)")
        let times = zip(reversed.frames.dropFirst(), reversed.frames).map { $0.time - $1.time }
        let lengths = zip(whole.frames.dropFirst(), whole.frames).map { $0.time - $1.time }
        check(zip(times, lengths.reversed()).allSatisfy { abs($0 - $1) < 0.002 }, "each frame lasting as it did, in reverse")
        let back = await samples(of: reversedURL)
        let mirror = (forward: rms(pcm, m, m + 0.6), reversed: rms(back, duration - m - 0.6, duration - m))
        let tone = (forward: rms(pcm, m - 1, m - 0.1), reversed: rms(back, duration - m + 0.1, duration - m + 1))
        check(abs(mirror.reversed - mirror.forward) < 0.1 * mirror.forward && abs(tone.reversed - tone.forward) < 0.1 * tone.forward,
              "the sound backwards, the chime ending at the moment's mirror: \(mirror), \(tone)")
    } catch {
        check(false, "the reel reversed: \(error.localizedDescription)")
    }

    // picked up 1.5 s before the moment (the film's earlier frames left out), answered or muted, and one marked missed
    // without the chime: each once at real time
    for (kind, missed) in [("answered", false), ("muted", false), ("answered", true)] {
        var short = MomentReelScript(center: moment, before: 1.5, after: half, notation: notation, accent: [0.3, 0.5, 1],
                                     side: 160, chimes: !missed, missed: missed)
        short.chime = script.chime
        let url = dir.appending(path: "short-\(kind)-\(missed).mov")
        do {
            try await MomentReelRenderer.render(films: films, script: short, to: url) { _ in }
            let length = try await AVURLAsset(url: url).load(.duration).seconds
            let expected = 1.5 + half
            check(abs(length - expected) < 0.1 && short.timing.duration < timing.duration,
                  "\(kind) from 1.5 s before the moment\(missed ? ", marked missed" : ""): \(length) s of \(expected)")
        } catch {
            check(false, "a reel from 1.5 s before the moment: \(error.localizedDescription)")
        }
    }
}

/// A video's frames as `VideoFrameReader` gives them, `stretch` seconds a reader: each frame's time and its luma on a
/// 12 × 24 grid; and how many readers it took.
private func frameSamples(_ url: URL, stretch: Double) async -> (frames: [(time: Double, luma: [UInt8])], readers: Int) {
    guard var reader = try? await VideoFrameReader.open(AVURLAsset(url: url), stretch: stretch) else { return ([], 0) }
    var frames: [(time: Double, luma: [UInt8])] = []
    while let frame = reader.next() {
        let p = frame.pixels
        CVPixelBufferLockBaseAddress(p, .readOnly)
        let w = CVPixelBufferGetWidthOfPlane(p, 0), h = CVPixelBufferGetHeightOfPlane(p, 0)
        let row = CVPixelBufferGetBytesPerRowOfPlane(p, 0)
        let base = CVPixelBufferGetBaseAddressOfPlane(p, 0)!.assumingMemoryBound(to: UInt8.self)
        var luma: [UInt8] = []
        for y in 0..<24 { for x in 0..<12 { luma.append(base[(h * (2 * y + 1) / 48) * row + w * (2 * x + 1) / 24]) } }
        CVPixelBufferUnlockBaseAddress(p, .readOnly)
        frames.append((frame.time, luma))
    }
    return (frames, reader.readers)
}

/// A reel's sound, mono at 48 kHz.
private func samples(of url: URL) async -> [Float] {
    let asset = AVURLAsset(url: url)
    guard let audio = try? await asset.loadTracks(withMediaType: .audio).first, let reader = try? AVAssetReader(asset: asset) else { return [] }
    let output = AVAssetReaderTrackOutput(track: audio, outputSettings: [
        AVFormatIDKey: kAudioFormatLinearPCM, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false, AVSampleRateKey: 48_000, AVNumberOfChannelsKey: 1,
    ])
    reader.add(output)
    reader.startReading()
    var pcm: [Float] = []
    while let buffer = output.copyNextSampleBuffer(), let block = CMSampleBufferGetDataBuffer(buffer) {
        let n = CMBlockBufferGetDataLength(block)
        var chunk = [Float](repeating: 0, count: n / 4)
        chunk.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: n, destination: $0.baseAddress!) }
        pcm += chunk
    }
    return pcm
}

/// A steady 440 Hz tone as the microphone's film (AAC).
private func writeTone(to url: URL, seconds: Double) -> Bool {
    let rate = 48_000.0
    guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 1),
          let file = try? AVAudioFile(forWriting: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate,
                                                                   AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 96_000]),
          let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(seconds * rate)) else { return false }
    buffer.frameLength = buffer.frameCapacity
    let p = buffer.floatChannelData![0]
    for i in 0..<Int(buffer.frameLength) { p[i] = Float(0.4 * sin(2 * .pi * 440 * Double(i) / rate)) }
    return (try? file.write(from: buffer)) != nil
}

/// A film of plain frames from Unix `start` to `end` as FrameTap writes one: HEVC, 1080 × 1920 shrunk to 270 × 480,
/// its session started at a host clock time; returns the Unix time of its first frame.
private func writeFilm(to url: URL, from start: Double, to end: Double, rate: Double) -> Double? {
    guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mov) else { return nil }
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.hevc, AVVideoWidthKey: 270,
                                                                      AVVideoHeightKey: 480])
    input.expectsMediaDataInRealTime = true
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
        kCVPixelBufferWidthKey as String: 270, kCVPixelBufferHeightKey as String: 480,
    ])
    writer.add(input)
    guard writer.startWriting() else { return nil }
    let host = CMTime(seconds: 91_234.5678, preferredTimescale: 1_000_000_000)
    writer.startSession(atSourceTime: host)
    let count = Int((end - start) * rate)
    for k in 0..<count {
        while !input.isReadyForMoreMediaData { usleep(500) }
        var buffer: CVPixelBuffer?
        guard let pool = adaptor.pixelBufferPool else { return nil }
        CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
        guard let buffer else { return nil }
        CVPixelBufferLockBaseAddress(buffer, [])
        for plane in 0..<CVPixelBufferGetPlaneCount(buffer) {
            memset(CVPixelBufferGetBaseAddressOfPlane(buffer, plane), Int32(40 + k % 160),
                   CVPixelBufferGetBytesPerRowOfPlane(buffer, plane) * CVPixelBufferGetHeightOfPlane(buffer, plane))
        }
        CVPixelBufferUnlockBaseAddress(buffer, [])
        adaptor.append(buffer, withPresentationTime: host + CMTime(seconds: Double(k) / rate, preferredTimescale: 1_000_000_000))
    }
    input.markAsFinished()
    let done = DispatchSemaphore(value: 0)
    writer.finishWriting { done.signal() }
    done.wait()
    return writer.status == .completed ? start : nil
}
