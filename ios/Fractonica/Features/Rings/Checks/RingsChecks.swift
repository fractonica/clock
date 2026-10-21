import CoreGraphics
import FractonicaKit
import Foundation

// The Rings screen's logic against the web app (src/ui/rings/geometry.js, text.js, pure-text.js): the expected values
// are computed by make-fixture.mjs from the JavaScript itself, run here with Node. Then the pure-mode wording is
// scanned with the web app's leak rules (tools/pure-scan.mjs), and the native-only helpers (depth range, drag
// direction, continuous scrubbing) are checked on their own. Run: ios/scripts/check.sh ios/Fractonica/Features/Rings/Checks

@main
struct RingsChecks {
    static func main() {
        if let fixture = loadFixture() {
            readingChecks(fixture)
            childChecks(fixture)
            scrubChecks(fixture)
            layoutChecks(fixture)
        } else {
            print("note: Node or the web modules are unavailable; the comparisons with the JavaScript were skipped")
        }
        leakChecks()
        nativeChecks()
        Checks.finish()
    }
}

// MARK: - Fixture

private let clock = FractonicaClock.shared
private let pure = RingsPureText()
private let cycles = RingsCycles()
private let earth = EarthFormatter(zone: "UTC")

private func loadFixture() -> [String: Any]? {
    let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let root = here.appendingPathComponent("../../../../..").standardized
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", here.appendingPathComponent("make-fixture.mjs").path]
    process.currentDirectoryURL = root
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = FileHandle.nullDevice
    do { try process.run() } catch { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
}

private func str(_ any: Any?) -> String? { any as? String }
private func num(_ any: Any?) -> Double? { (any as? NSNumber)?.doubleValue }
private func dict(_ any: Any?) -> [String: Any]? { any as? [String: Any] }
private func list(_ any: Any?) -> [Any] { any as? [Any] ?? [] }

private func reading(at t: Double, _ level: Int) -> LevelReading? {
    clock.level(at: t >= clock.tMax ? clock.tMax - 0.001 : t, level)
}

private func readingChecks(_ fixture: [String: Any]) {
    var compared = 0
    for case let row as [String: Any] in list(fixture["readings"]) {
        guard let t = num(row["t"]), let level = num(row["level"]).map(Int.init) else { continue }
        let at = "t=\(t) level=\(level)"
        guard let r = reading(at: t, level) else {
            check(false, "no reading at \(at)")
            continue
        }
        compared += 1
        check(Double(r.cycle) == num(row["cycle"]), "cycle at \(at)")
        check(pure.displayName(r) == str(row["displayName"]), "displayName at \(at): \(pure.displayName(r)) vs \(str(row["displayName"]) ?? "nil")")
        check(pure.cycleName(level: level, cycle: r.cycle) == str(row["cycleName"]), "cycleName at \(at)")
        check(pure.centreSpan(from: t, to: r.end) == str(row["centre"]), "centreSpan at \(at): \(pure.centreSpan(from: t, to: r.end)) vs \(str(row["centre"]) ?? "nil")")
        check(pure.centreSpan(from: t, to: r.end, compact: true) == str(row["centreCompact"]), "compact centreSpan at \(at)")
        check(pure.endLine(r) == str(row["endLine"]), "endLine at \(at): \(pure.endLine(r)) vs \(str(row["endLine"]) ?? "nil")")

        let times = r.thresholds.map(\.time)
        let labels = pure.boundaryLabels(level: level, times: times)
        let expected = list(row["labels"])
        check(labels.count == expected.count, "five labels at \(at)")
        for (i, label) in labels.enumerated() where i < expected.count {
            guard let e = dict(expected[i]) else {
                check(label == nil, "label \(i) is missing at \(at)")
                continue
            }
            guard let label else {
                check(false, "label \(i) exists at \(at)")
                continue
            }
            check(label.date == str(e["date"]) && label.time == str(e["time"]), "label \(i) at \(at): \(label.date)|\(label.time) vs \(str(e["date"]) ?? "")|\(str(e["time"]) ?? "")")
            check(label.sameAsStart == (e["sameAsStart"] as? Bool), "label \(i) sameAsStart at \(at)")
            let alt = list(e["alt"]).compactMap(dict)
            check(alt.count == label.alt.count && zip(alt, label.alt).allSatisfy { str($0["date"]) == $1.date && str($0["time"]) == $1.time }, "label \(i) alt at \(at)")
            check(str(dict(e["full"])?["date"]) == label.full.date && str(dict(e["full"])?["time"]) == label.full.time, "label \(i) full at \(at)")
        }
        let chips = list(row["chips"]).compactMap(dict)
        for k in 0..<4 where k < chips.count {
            let c = pure.chip(r, k: k, t: times[k + 1], now: t, label: labels[k + 1])
            let e = chips[k]
            check(c.count == str(e["count"]) && c.date == str(e["date"]) && c.time == str(e["time"]), "chip \(k) at \(at): \(c.count)|\(c.date)|\(c.time) vs \(str(e["count"]) ?? "")|\(str(e["date"]) ?? "")|\(str(e["time"]) ?? "")")
            check(c.title == str(e["title"]), "chip \(k) title at \(at): \(c.title) vs \(str(e["title"]) ?? "")")
            check(c.label == str(e["label"]), "chip \(k) label at \(at)")
        }
        let res = pure.resolution(span: pure.cycleSpan(level))
        let start = pure.when(r.start, res: res, dateTokens: 3, timeTokens: 3)
        let end = pure.when(r.end, res: res, dateTokens: 3, timeTokens: 3)
        check(start.date == str(dict(row["factStart"])?["date"]) && start.time == str(dict(row["factStart"])?["time"]), "fact start at \(at): \(start)")
        check(end.date == str(dict(row["factEnd"])?["date"]) && end.time == str(dict(row["factEnd"])?["time"]), "fact end at \(at): \(end)")
        let length = pure.lengthWithName(level: level, start: r.start, end: r.end, clipped: r.clipped)
        check(length == str(row["length"]), "length at \(at): \(length) vs \(str(row["length"]) ?? "")")
        let address = pure.addressTokens(level: level, cycle: r.cycle)
        check(address.map(\.text) == list(row["address"]).compactMap(str), "address at \(at): \(address.map(\.text))")
        check(address.map { Double($0.level) } == list(row["addressLevels"]).compactMap(num), "address levels at \(at)")
        check(RingsPureText.stateText(r.phase, level: level) == str(row["stateText"]), "stateText at \(at)")
        check(pure.pointerText(level: level, t) == str(row["pointer"]), "pointer at \(at): \(pure.pointerText(level: level, t)) vs \(str(row["pointer"]) ?? "")")
        check(pure.inText(now: t, r.end) == str(row["inEnd"]), "in end at \(at)")
        check(pure.inText(now: t, r.start) == str(row["inStart"]), "in start at \(at)")
        check(pure.aboutTurn(level) == str(row["aboutTurn"]), "about turn at \(at): \(pure.aboutTurn(level)) vs \(str(row["aboutTurn"]) ?? "")")

        // Earth wording
        let refYear = earth.parts(t).year
        for (i, x) in times.enumerated() {
            let e = dict(list(row["earthParts"])[i])
            let c = dict(list(row["earthCompact"])[i])
            guard let x else {
                check(e == nil, "Earth part \(i) is missing at \(at)")
                continue
            }
            let p = RingsText.whenParts(earth, x, span: r.duration)
            check(p.date == str(e?["date"]) && p.time == str(e?["time"]), "Earth part \(i) at \(at): \(p) vs \(String(describing: e))")
            let q = RingsText.whenParts(earth, x, span: r.duration, compact: true, refYear: refYear)
            check(q.date == str(c?["date"]) && q.time == str(c?["time"]), "compact Earth part \(i) at \(at): \(q)")
        }
        check(RingsText.countdownBody(r.remaining) == str(row["countdown"]), "countdown at \(at): \(RingsText.countdownBody(r.remaining)) vs \(str(row["countdown"]) ?? "")")
        check(RingsText.percent(r.phase) == str(row["percent"]), "percent at \(at): \(RingsText.percent(r.phase))")
        check(RingsText.cycleTag(r) == str(row["tag"]), "cycle tag at \(at)")
        check(abs(cycles.phaseLimit(level: level, cycle: r.cycle) - (num(row["phaseLimit"]) ?? -1)) < 1e-12, "phase limit at \(at)")
    }
    check(compared > 100, "the fixture has readings (\(compared))")
}

private func childChecks(_ fixture: [String: Any]) {
    for case let row as [String: Any] in list(fixture["children"]) {
        guard let level = num(row["level"]).map(Int.init), let cycle = num(row["cycle"]).map({ Int64($0) }), let j = num(row["j"]).map(Int.init) else { continue }
        let at = "level=\(level) cycle=\(cycle) j=\(j)"
        let c = cycles.child(level: level, cycle: cycle, sector: j)
        guard let e = dict(row["child"]) else {
            check(c == nil, "no child at \(at)")
            continue
        }
        guard let c else {
            check(false, "a child at \(at)")
            continue
        }
        check(Double(c.level) == num(e["level"]) && Double(c.index) == num(e["index"]), "child index at \(at)")
        check(c.start == num(e["start"]) && c.end == num(e["end"]) && c.clipped == (e["clipped"] as? Bool), "child times at \(at): \(c.start) \(c.end)")
        let follower = pure.follower(level: c.level, cycle: c.index, end: c.end, clipped: c.clipped)
        check(follower == str(row["follower"]), "child follower at \(at): \(follower ?? "nil") vs \(str(row["follower"]) ?? "nil")")
        if let t = num(row["t"]) {
            check(pure.startPhrase(start: c.start, end: c.end, now: t) == str(row["startPhrase"]), "pure start phrase at \(at) t=\(t)")
            check(RingsText.startPhrase(start: c.start, end: c.end, now: t) == str(row["earthStart"]), "Earth start phrase at \(at) t=\(t): \(RingsText.startPhrase(start: c.start, end: c.end, now: t))")
        }
    }
}

private func scrubChecks(_ fixture: [String: Any]) {
    for case let row as [String: Any] in list(fixture["scrubs"]) {
        guard let level = num(row["level"]).map(Int.init), let cycle = num(row["cycle"]).map({ Int64($0) }), let phase = num(row["phase"]) else { continue }
        let at = "level=\(level) cycle=\(cycle) phase=\(phase)"
        let a = cycles.time(level: level, cycle: cycle, phase: phase)
        check(a == num(row["at"]), "time at phase \(at): \(String(describing: a)) vs \(String(describing: num(row["at"])))")
        let s = cycles.scrubTime(level: level, cycle: cycle, phase: phase)
        check(s == num(row["time"]), "scrub \(at): \(String(describing: s)) vs \(String(describing: num(row["time"])))")
        let snap = cycles.scrubTime(level: level, cycle: cycle, phase: phase, snap: true)
        check(snap == num(row["snap"]), "snapped scrub \(at)")
    }
}

private func layoutChecks(_ fixture: [String: Any]) {
    for case let row as [String: Any] in list(fixture["layouts"]) {
        guard let size = num(row["size"]), let count = num(row["count"]).map(Int.init) else { continue }
        let lay = RingLayout(size: CGFloat(size), count: count)
        let at = "size=\(size) count=\(count)"
        check(abs(Double(lay.rOuter) - (num(row["rOuter"]) ?? 0)) < 1e-9 && abs(Double(lay.rHole) - (num(row["rHole"]) ?? 0)) < 1e-9, "layout radii \(at)")
        check(abs(Double(lay.band) - (num(row["band"]) ?? 0)) < 1e-9 && abs(Double(lay.thick) - (num(row["thick"]) ?? 0)) < 1e-9, "layout band \(at)")
        for case let h as [String: Any] in list(row["hits"]) {
            guard let x = num(h["x"]), let y = num(h["y"]) else { continue }
            let hit = lay.hit(CGPoint(x: x, y: y))
            switch (hit, dict(h["hit"])) {
            case (nil, nil): check(true, "")
            case (.hole?, let e?): check(str(e["zone"]) == "hole", "hole at \(at) \(x),\(y)")
            case (.ring(let i, let phase, let radial)?, let e?):
                check(str(e["zone"]) == "ring" && Double(i) == num(e["ring"]) && abs(phase - (num(e["phase"]) ?? -1)) < 1e-9 && abs(radial - (num(e["radial"]) ?? -1)) < 1e-9,
                      "ring hit at \(at) \(x),\(y): \(i) \(phase) \(radial)")
            default: check(false, "hit at \(at) \(x),\(y): \(String(describing: hit))")
            }
        }
    }
}

// MARK: - Pure-mode leaks

/// The hard rules of tools/pure-scan.mjs.
private let leakRules: [(String, NSRegularExpression)] = [
    ("clock-time", #"\b\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\b"#),
    ("iso-date", #"\b\d{4}-\d{2}-\d{2}\b"#),
    ("slash-date", #"\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b"#),
    ("month-name", #"\b(January|February|March|April|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b|\bMay\s\d"#),
    ("weekday", #"\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\b"#),
    ("earth-unit", #"\b\d+([.,]\d+)?\s?(ms|msec|s|sec|secs|min|mins|h|hr|hrs|d|day|days|wk|wks|week|weeks|mo|month|months|y|yr|yrs|year|years|Hz|kHz|bpm|BPM)\b"#),
    ("per-unit", #"\bper\s(s|sec|second|min|minute|hour|day|week|month|year)\b|/(s|min|h|d|y)\b"#),
    ("unit-word", #"(?i)\b(seconds?|minutes?|hours?|days?|weeks?|months?|years?|decades?|centur(y|ies)|today|tomorrow|yesterday|daily|weekly|monthly|yearly|annual|midnight|noon|o'clock)\b"#),
    ("zone-word", #"(?i)\b(UTC|GMT|UT1|Unix|ISO\s?8601|time\s?zones?|timezones?|local time|Gregorian|Julian|Anno|DST|daylight)\b"#),
    ("am-pm", #"\b\d{1,2}\s?(am|pm|AM|PM)\b|\bAD\b|\bBC\b"#),
    ("percent", #"(?i)%|\bper ?cent(age)?s?\b"#),
    ("frequency", #"(?i)\bHz\b|\bkHz\b|\bhertz\b"#),
    ("half-unit", #"[αβγδεζηθικλμνξ]½"#),
    ("beat-word", #"(?i)\bbeats?\b"#),
    ("retired-unit", #"\b(Hadron|Quark|Chromon|Somon|Atom)s?\b"#),
    ("minor-fracton", #"\b(Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi|Omicron)\s+[A-Za-z]*fracton\b"#),
    ("note-name", #"\b[A-G](#|♯|♭)?\d\b"#),
].map { ($0.0, try! NSRegularExpression(pattern: $0.1)) }

private func leaks(_ text: String) -> [String] {
    let range = NSRange(text.startIndex..., in: text)
    return leakRules.compactMap { $0.1.firstMatch(in: text, range: range) == nil ? nil : $0.0 }
}

private func leakChecks() {
    // the rules themselves catch what they must
    check(leaks("in 3 h 02 min") == ["earth-unit"], "the scanner sees Earth units")
    check(leaks("47.2\u{202F}%").contains("percent"), "the scanner sees percentages")
    check(leaks("Thu 8 Oct 2026, 14:23").count >= 2, "the scanner sees dates and times")

    var strings: [String] = []
    let instants: [Double] = [1_791_460_800, 946_684_800, 2_886_085_800, clock.tMin + 0.5, clock.tMin + 86_400 * 3, clock.tMax - 1, clock.tMax - 86_400 * 200, -5_000_000_000, 15_000_000_000]
    for t in instants {
        for level in 0...13 {
            guard let r = reading(at: t, level) else { continue }
            strings += [pure.displayName(r), pure.centreSpan(from: t, to: r.end), pure.centreSpan(from: t, to: r.end, compact: true), pure.endLine(r)]
            let times = r.thresholds.map(\.time)
            let labels = pure.boundaryLabels(level: level, times: times)
            for l in labels.compactMap({ $0 }) { strings += [l.date, l.time, l.full.date, l.full.time] + l.alt.flatMap { [$0.date, $0.time] } }
            for k in 0..<4 {
                let c = pure.chip(r, k: k, t: times[k + 1], now: t, label: labels[k + 1])
                strings += [c.count, c.date, c.time, c.title, c.label]
            }
            strings += [pure.lengthWithName(level: level, start: r.start, end: r.end, clipped: r.clipped), RingsPureText.stateText(r.phase, level: level),
                        pure.pointerText(level: level, t), pure.inText(now: t, r.end), pure.inText(now: t, r.start), pure.aboutTurn(level),
                        RingsPureText.sliderText(word: RingsText.phaseWord(index: r.index, derivative: r.derivative), phase: r.phase, name: pure.cycleName(level: level, cycle: r.cycle), level: level)]
            strings += pure.addressTokens(level: level, cycle: r.cycle).map(\.text)
            let factor = r.factor
            for j in [0, factor / 2, factor - 1] {
                guard let c = cycles.child(level: level, cycle: r.cycle, sector: j) else { continue }
                strings += [pure.startPhrase(start: c.start, end: c.end, now: t), pure.endsSentence(level: c.level, cycle: c.index, end: c.end, clipped: c.clipped),
                            pure.lengthWithName(level: c.level, start: c.start, end: c.end, clipped: c.clipped), pure.cycleName(level: c.level, cycle: c.index)]
            }
        }
    }
    strings += RingsHelp.items(pure: true).flatMap { [$0.title, $0.body] }
    var leaked = 0
    for s in Set(strings) {
        let found = leaks(s)
        if !found.isEmpty {
            leaked += 1
            if leaked <= 12 { print("  leak \(found): \(s)") }
        }
    }
    check(leaked == 0, "no pure-mode string leaks Earth terms (\(leaked) of \(Set(strings).count) leak)")
    check(Set(strings).count > 1000, "the scan saw enough strings (\(Set(strings).count))")
}

// MARK: - Native helpers

private func nativeChecks() {
    // depth range
    let r = DepthRange(minDepth: 1, maxDepth: 10)
    check(r.levels == Array(0...9) && r.count == 10, "the default range shows α … κ")
    check(DepthRange(minDepth: 9, maxDepth: 3) == DepthRange(minLevel: 8, maxLevel: 8), "an inverted range collapses onto its minimum")
    check(DepthRange(minDepth: -4, maxDepth: 99) == DepthRange(minLevel: 0, maxLevel: 13), "garbage is clamped")
    check(r.stepped(outer: true, by: 1) == DepthRange(minLevel: 1, maxLevel: 9), "one less outer ring")
    check(r.stepped(outer: true, by: -1) == r, "nothing above α")
    check(r.stepped(outer: false, by: 1) == DepthRange(minLevel: 0, maxLevel: 10), "one more inner ring")
    check(DepthRange(minLevel: 5, maxLevel: 5).stepped(outer: false, by: -1) == DepthRange(minLevel: 5, maxLevel: 5), "the range never empties")
    check(DepthRange(minLevel: 13, maxLevel: 13).stepped(outer: false, by: 1).maxLevel == 13, "nothing below ξ")
    check(r.widened(to: 12) == DepthRange(minLevel: 0, maxLevel: 12) && DepthRange(minLevel: 4, maxLevel: 6).widened(to: 1) == DepthRange(minLevel: 1, maxLevel: 6), "widening takes the level in")
    check(r.clamp(12) == 9 && r.clamp(3) == 3, "the selection follows the range")

    // phases and points
    let c = CGPoint(x: 100, y: 100)
    for phase in stride(from: 0.0, to: 1.0, by: 0.0625) {
        let p = RingsMath.point(around: c, radius: 50, phase: phase)
        check(abs(RingsMath.phase(of: p, around: c) - phase) < 1e-9, "phase ↔ point round trip at \(phase)")
    }
    check(abs(RingsMath.point(around: c, radius: 50, phase: 0.25).x - 150) < 1e-9, "a quarter turn is 3 o'clock")
    check(RingsMath.sector(of: 0.999999, factor: 5) == 4 && RingsMath.sector(of: 0, factor: 5) == 0 && RingsMath.sector(of: 1, factor: 5) == 4, "sectors")
    check(abs(RingsMath.unwrappedStep(from: 0.95, to: 0.05) - 0.1) < 1e-12 && abs(RingsMath.unwrappedStep(from: 0.05, to: 0.95) + 0.1) < 1e-12, "the hand moves the short way past 12 o'clock")
    check(RingsMath.triangle(0.25) == 1 && RingsMath.triangle(0.75) == -1 && RingsMath.triangle(0.5) == 0, "the triangle wave")
    check((0..<16).map { RingsMath.stateValue($0) } == [0, 1, 2, 3, 4, 3, 2, 1, 0, -1, -2, -3, -4, -3, -2, -1], "glyph values")
    check(RingsMath.glyphExtreme(strokes: 2) == 4 && RingsMath.glyphExtreme(strokes: 3) == 13, "glyph extremes")

    // drags: along the ring scrubs, across it scrolls
    check(RingsMath.isTangentialDrag(start: CGPoint(x: 100, y: 10), translation: CGSize(width: 12, height: 1), center: c), "sideways at 12 o'clock runs along the ring")
    check(!RingsMath.isTangentialDrag(start: CGPoint(x: 100, y: 10), translation: CGSize(width: 1, height: 12), center: c), "down at 12 o'clock crosses the rings")
    check(RingsMath.isTangentialDrag(start: CGPoint(x: 190, y: 100), translation: CGSize(width: 0, height: -12), center: c), "up at 3 o'clock runs along the ring")
    check(!RingsMath.isTangentialDrag(start: c, translation: CGSize(width: 10, height: 0), center: c), "no direction at the centre")
    check(RingsMath.isHorizontalDrag(CGSize(width: 9, height: 3)) && !RingsMath.isHorizontalDrag(CGSize(width: 9, height: 12)) && !RingsMath.isHorizontalDrag(CGSize(width: 4, height: 0)), "horizontal drags")

    // blur and freeze
    let lambda = clock.levelInfo(10).meanSeconds
    check(!RingsMath.isBlur(meanSeconds: lambda, speed: 1) && RingsMath.isBlur(meanSeconds: clock.levelInfo(13).meanSeconds, speed: 1), "ξ blurs live, λ does not")
    check(!RingsMath.isBlur(meanSeconds: 0.01, speed: 0), "nothing blurs while paused")
    check(RingsMath.isFast(meanSeconds: clock.levelInfo(11).meanSeconds, speed: 1) && !RingsMath.isFast(meanSeconds: lambda, speed: 1), "μ is fast, λ is not")

    // continuous scrubbing: a cycle position runs through the cycles without gaps or jumps back
    let t = 1_791_460_800.0
    for level in [0, 3, 6, 9, 12, 13] {
        guard let r = clock.level(at: t, level) else { continue }
        let base = Double(r.cycle)
        var last = -Double.infinity
        var monotonic = true
        for k in 0...40 {
            let pos = base + 0.5 + Double(k) * 0.05
            guard let x = cycles.scrubTime(level: level, position: pos) else { monotonic = false; break }
            if x < last { monotonic = false }
            last = x
            let back = clock.level(at: x, level)
            if let back, Double(back.cycle) != pos.rounded(.down) { monotonic = false }
        }
        check(monotonic, "scrubbing level \(level) by cycle position is monotonic and stays in the right cycle")
    }
    let total = Double(clock.extent) * clock.levelInfo(6).prefixDouble / 4
    check(cycles.scrubTime(level: 6, position: total + 5).map { $0 <= clock.tMax && $0 > clock.tMax - 1 } ?? false, "scrubbing past the end stops at the catalogue's end")
    check(cycles.scrubTime(level: 6, position: -3) == clock.tMin + 0.001, "scrubbing before the start stops at the catalogue's start")

    // threshold jumps
    check(cycles.thresholdJump(nil, now: t) == .void, "a threshold beyond the catalogue goes nowhere")
    check(cycles.thresholdJump(t + 10, now: t) == .ahead(t + 10.001) && cycles.thresholdJump(t - 10, now: t) == .back(t - 9.999), "thresholds ahead and behind")
    check(cycles.thresholdJump(clock.tMax, now: clock.tMax) == .end, "the closing instant is a dead end")

    // the wave plot
    let w = WaveLayout(width: 320, height: 160)
    check(w.x(0) == w.x0 && w.x(1) == w.x1 && abs(w.phase(atX: w.x(0.3)) - 0.3) < 1e-9, "wave x ↔ phase")
    check(w.y(1) < w.y(0) && w.y(-1) > w.y(0), "the wave's peak is up")
}
