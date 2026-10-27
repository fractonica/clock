import FractonicaKit
import Foundation

// Moments' logic: the moments (every Helion quarter boundary) against FractonicaKit's own cycles and thresholds, their
// labels (the longest level with a quarter boundary there) and names, the prompt 11 Flavons ahead, quiet hours, the
// settings, the streak and the collection, the `capture` JSON and an edit keeping it, the bundled announcements.
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
        soundChecks()
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
        check(m.title() == "Helion \(helionName) Node" && helionName.hasSuffix("η"), "a Helion node's name: \(m.title())")
        check(m.spoken == "Helion node" && m.soundName == "moment-helion-node", "a Helion node's announcement")
    }
    if let m = calendar.upcoming(after: vectorA, count: 2000, scan: 4000, where: { $0.level == .nuclide && $0.boundary == .start }).first {
        check(m.title().hasPrefix("Nuclide ε#") && m.title().hasSuffix(" Start") && m.rarity == .rare, "a Nuclide start's name: \(m.title())")
        check(m.spoken == "A new Nuclide begins", "a start is announced as a beginning")
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
        let p = calendar.promptTime(of: m)
        let lead = m.time - p
        if abs(lead - 11 * flavon) > 0.5 { check(false, "11 Flavons ahead: \(lead) s"); return }
        let f = calendar.flavons(from: p, to: m)
        if abs(f - 11) > 0.001 { check(false, "11 Flavons by position: \(f)"); return }
    }
    check(true, "every prompt is 11 Flavons before its moment")
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
    let nuclide = list.first { $0.level == .nuclide }!
    check(s.enabled && s.helion == .nodes && s.voice && s.quiet.enabled, "defaults: on, Helion nodes, voice, quiet hours")
    check(!s.asks(start) && !s.asks(peak) && s.asks(node) && s.asks(delta) && !s.asks(nuclide),
          "only a Helion's node is a rare moment; Delta and longer always")
    s.helion = .none
    check(!s.asks(node) && s.asks(delta), "Delta and longer are always asked for")
    s.enabled = false
    check(!s.asks(delta), "off: nothing")
    // persistence, lenient
    var t = MomentSettings()
    t.helion = .none
    t.quiet.start = 22 * 60
    let data = try! JSONEncoder().encode(t)
    check((try? JSONDecoder().decode(MomentSettings.self, from: data)) == t, "settings round-trip")
    let partial = try? JSONDecoder().decode(MomentSettings.self, from: Data(#"{"helion":"bogus","voice":false}"#.utf8))
    check(partial?.helion == .nodes && partial?.voice == false && partial?.enabled == true, "unknown values take their defaults")
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
    check(HubRecord.journalEntry(time: 1, zone: nil, entry: JournalEntry(), blobs: [], now: 1).rarity == .common, "no capture: common")
    // the composer's data keeps capture
    let edited = JournalEntry(emoji: "🌙", markdown: "edited").data.keepingFields(of: r.data)
    check(edited["capture"] == r.data["capture"] && edited["markdown"]?.string == "edited" && edited["emoji"]?.string == "🌙", "an edit keeps capture")
    let cleared = JournalEntry(markdown: "x").data.keepingFields(of: JournalEntry(emoji: "🌙", title: "t", markdown: "y").data)
    check(cleared["emoji"] == nil && cleared["title"] == nil, "an edit may still clear the emoji and the title")
    check(MomentRarity.allCases.sorted() == MomentRarity.allCases && MomentRarity.cosmic > .mythic, "rarities are ordered")
    check(MomentLevel.allCases.map(\.rarity) == [.rare, .rare, .epic, .legendary, .mythic, .cosmic], "levels give rarities")
}

/// Several captures of a moment: their offsets, times, photo names (hub/API.md) and the setting.
private func multiCaptureChecks() {
    check(MomentCaptures.offsets(count: 1) == [0], "one capture: at the moment")
    check(MomentCaptures.offsets(count: 3) == [-1, 0, 1], "three: a Flavon before, at, a Flavon after")
    check(MomentCaptures.offsets(count: 5) == [-2, -1, 0, 1, 2], "five: two Flavons either side")
    check(MomentCaptures.offsets(count: 4) == [-1, 0, 1] && MomentCaptures.offsets(count: 0) == [-1, 0, 1], "another count takes the default")
    check(MomentSettings().captures == 3, "three captures by default")
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
        if calendar.promptTime(of: m) >= times[0] { check(false, "the prompt comes before the first capture"); return }
    }
    check(true, "captures are a Flavon apart, on the millisecond, around the moment")
    // the setting, lenient
    func decoded(_ json: String) -> MomentSettings? { try? JSONDecoder().decode(MomentSettings.self, from: Data(json.utf8)) }
    check(decoded(#"{"captures":5}"#)?.captures == 5 && decoded(#"{"captures":1}"#)?.captures == 1, "1 and 5 read")
    check(decoded(#"{"captures":4}"#)?.captures == 3 && decoded(#"{"captures":"x"}"#)?.captures == 3
          && decoded(#"{"captures":null}"#)?.captures == 3 && decoded("{}")?.captures == 3, "anything else: three")
    check(decoded(#"{"captures":4,"voice":false}"#)?.voice == false, "a bad count leaves the rest alone")
    var s = MomentSettings()
    s.captures = 5
    check((try? JSONDecoder().decode(MomentSettings.self, from: JSONEncoder().encode(s)))?.captures == 5, "the count round-trips")
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

// MARK: - Sounds

private func soundChecks() {
    let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appending(path: "Resources/Moments")
    var missing: [String] = []
    for level in MomentLevel.allCases {
        for boundary in MomentBoundary.allCases {
            let m = Moment(index: 0, time: 0, level: level, boundary: boundary, cycle: 0)
            let url = folder.appending(path: "\(m.soundName).caf")
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            if size < 1000 { missing.append(m.soundName) }
        }
    }
    check(missing.isEmpty, "an announcement for every level and boundary in \(folder.path): missing \(missing)")
}
