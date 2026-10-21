import FractonicaKit
import Foundation

// The jump screen's logic: what the box reads in each mode (the Earth box also takes the pure grammar's readings),
// replaying a recent jump, the hints, the date readings, and the recent-jump list (dedupe, limit, sanitising, the two
// modes kept apart, persistence). The grammars themselves are FractonicaKit's (golden tests: swift test --filter Jump).
// Run: ios/scripts/check.sh ios/Fractonica/Features/Jump/Checks

@main
struct JumpChecks {
    static func main() {
        interpreterChecks()
        displayChecks()
        historyChecks()
        Checks.finish()
    }
}

private let a = 1_791_460_800.0 // SPEC vector A, 2026-10-08 12:00 UTC
private func earth(_ now: Double = a, level: Int? = 6) -> JumpInterpreter.Situation {
    .init(now: now, real: now + 5, pure: false, zone: "UTC", dayFirst: true, level: level)
}
private func pure(_ now: Double = a) -> JumpInterpreter.Situation {
    .init(now: now, real: now + 5, pure: true, zone: "UTC", dayFirst: true, level: 6)
}

private func interpreterChecks() {
    // Earth box: the web grammar first
    let date = JumpInterpreter.candidates("2031-06-01 14:30", earth())
    check(date.first?.kind == .date && date.first?.time == 1_938_090_600, "a date reads in the zone: \(date.map(\.label))")
    // what only the pure grammar reads is taken in the Earth box too, and only its readings come back
    for text in ["Delta Trifracton Node", "+2ε 5η", "34η 17ι", "+4 Blinks", "Gamma Difracton"] {
        let out = JumpInterpreter.candidates(text, earth())
        let viaPure = PureJumpParser.parse(text, PureJumpContext(now: a, real: a + 5, level: 6)).filter(\.isSelectable)
        check(!out.isEmpty && out.allSatisfy(\.isSelectable), "\(text) reads in the Earth box: \(out.map(\.label))")
        check(out.map(\.time) == viaPure.map(\.time), "\(text) lands where the pure box lands")
    }
    // what both read is the Earth grammar's reading
    let next = JumpInterpreter.candidates("next ε", earth())
    check(next.first?.label == "Next ε boundary" && next.first?.detail.contains("UTC") == true, "next ε is the Earth reading: \(next.first?.detail ?? "")")
    // nothing reads: the Earth answer, or the pure grammar's precise pointer instead of the generic one
    let junk = JumpInterpreter.candidates("hello world", earth())
    check(junk.count == 1 && junk[0].label == "Cannot read \"hello world\"", "junk gets the Earth answer: \(junk.map(\.label))")
    let feb = JumpInterpreter.candidates("2031-02-30", earth())
    check(feb.first?.label == "February 2031 has only 28 days", "an Earth error stays: \(feb.map(\.label))")
    let zero = JumpInterpreter.candidates("ε#2 0η", earth())
    check(zero.first?.label.contains("Helions are numbered") == true || zero.first?.label.contains("0η") == true,
          "the pure pointer replaces the generic answer: \(zero.map(\.label))")
    let retired = JumpInterpreter.candidates("+2 hadrons", earth())
    check(retired.first?.label.hasPrefix("That unit name is retired") == true, "a retired unit gets its pointer: \(retired.map(\.label))")
    check(JumpInterpreter.candidates("   ", earth()).isEmpty, "blank text reads as nothing")

    // pure box: the pure grammar only, Earth input answered
    let earthly = JumpInterpreter.candidates("2031-06-01", pure())
    check(earthly.count == 1 && earthly[0].label == "Dates and clock times are off in pure mode", "pure mode turns dates away: \(earthly.map(\.label))")
    let leaks = try! NSRegularExpression(pattern: "\\b(1[6-9]|2[0-9])\\d\\d-\\d\\d|\\b\\d{1,2}:\\d\\d|UTC|%|\\d (d|h|min|s|y|ms)\\b")
    for text in ["2031-06-01 14:30 Tokyo", "+3d", "tomorrow", "1791460800", "next ε", "α#6 β#3 γ#11", "pos 24.5", "now", "xyz", "Moscow"] {
        for c in JumpInterpreter.candidates(text, pure()) {
            let shown = c.label + " " + c.detail + " " + c.note
            check(leaks.firstMatch(in: shown, range: NSRange(location: 0, length: (shown as NSString).length)) == nil,
                  "pure mode never prints Earth terms: \(text) → \(shown)")
        }
    }

    // replaying a recent jump keeps the reading chosen then (06/01/2031 read month/day stays month/day)
    let slash = JumpInterpreter.candidates("06/01/2031", earth())
    check(slash.count == 2 && slash[0].label.contains("day/month"), "06/01/2031 reads both ways, day first first: \(slash.map(\.label))")
    let chosen = JumpHistory.Entry(text: "06/01/2031", label: slash[1].label, kind: "date")
    check(JumpInterpreter.replay(chosen, in: slash) == slash[1], "the month/day reading is replayed")
    let stale = JumpHistory.Entry(text: "06/01/2031", label: "something else", kind: "date")
    check(JumpInterpreter.replay(stale, in: slash) == slash[0], "an unknown reading falls back to the best one")
    check(JumpInterpreter.replay(stale, in: junk) == nil, "a text that no longer reads replays nothing")
    // an offset counts from the displayed time it is read at
    let later = JumpInterpreter.candidates("+3d", earth(a + 3600))
    check(later.first?.time == a + 3600 + 3 * 86_400, "+3d counts from the displayed time: \(later.first?.time ?? 0)")

    // examples: the mode's own; the Earth box also teaches a few Fractonica ones, and every example reads
    let earthGroups = JumpInterpreter.examples(pure: false, dayFirst: true)
    check(earthGroups.map(\.title) == ["Earth", "Fractonica"], "the Earth box shows both kinds of examples")
    check(JumpInterpreter.examples(pure: true, dayFirst: nil).map(\.title) == ["Fractonica"], "pure mode shows Fractonica examples only")
    for group in earthGroups {
        for example in group.items {
            check(JumpInterpreter.best(JumpInterpreter.candidates(example.text, earth())) != nil, "Earth example \(example.text) reads")
        }
    }
    for example in JumpInterpreter.examples(pure: true, dayFirst: nil)[0].items {
        check(JumpInterpreter.best(JumpInterpreter.candidates(example.text, pure())) != nil, "pure example \(example.text) reads")
    }
}

private func displayChecks() {
    check(JumpInterpreter.hint("Day 0 does not exist") == "Day 0 does not exist", "a plain hint is kept")
    check(JumpInterpreter.hint("A Delta is 5 Nuclides. Press ? for the glossary.") == "A Delta is 5 Nuclides.", "the glossary key is not offered")
    let generic = JumpInterpreter.candidates("xyz", earth())[0].detail
    let trimmed = JumpInterpreter.hint(generic, examplesShown: true)
    check(!trimmed.contains("Try ") && trimmed.contains("change the zone in Settings"), "the list of forms goes where examples follow: \(trimmed)")
    let pureGeneric = JumpInterpreter.candidates("xyz", pure())[0].detail
    check(JumpInterpreter.hint(pureGeneric, examplesShown: true) == "# numbers and Helions start at 1, counts at 0.",
          "pure: only the notation rule stays: \(JumpInterpreter.hint(pureGeneric, examplesShown: true))")

    let long = "Sun 1 Jun 2031, 00:00:00 UTC"
    check(JumpInterpreter.dateReading(label: long, long: long) == nil, "a plain date says nothing more")
    check(JumpInterpreter.dateReading(label: long + " (month/day)", long: long) == "month/day", "the slash order is kept")
    check(JumpInterpreter.dateReading(label: "June 2031 · " + long, long: long) == "June 2031", "a month is kept")
    check(JumpInterpreter.dateReading(label: "2031 · " + long, long: long) == "2031", "a year is kept")
    check(JumpInterpreter.repeats("Delta Trifracton Node", in: ["Delta Trifracton Node ε#2"]), "a note inside a line repeats it")
    check(!JumpInterpreter.repeats("ε lasts 77η", in: ["Delta Trifracton Node ε#2"]), "another note does not")
    check(!JumpInterpreter.repeats("", in: ["x"]), "an empty note repeats nothing")

    check(JumpCandidate.Kind.allCases.allSatisfy { !$0.title.isEmpty && !$0.systemImage.isEmpty }, "every kind has a name and a symbol")
}

private func historyChecks() {
    var h = JumpHistory()
    h.remember("+3d", label: "+3 d from the displayed time", kind: "relative")
    h.remember("next ε", label: "Next ε boundary", kind: "boundary")
    h.remember("  +3d ", label: "+3 d again", kind: "relative")
    check(h.entries.map(\.text) == ["+3d", "next ε"], "a repeated text moves to the top once: \(h.entries.map(\.text))")
    check(h.entries[0].label == "+3 d again", "with its latest reading")
    h.remember("   ", label: "", kind: "error")
    check(h.entries.count == 2, "blank text is not remembered")
    for i in 0..<20 { h.remember("+\(i)d", label: "", kind: "relative") }
    check(h.entries.count == JumpHistory.limit && h.entries[0].text == "+19d", "at most \(JumpHistory.limit), newest first")
    h.remove(h.entries[0])
    check(h.entries[0].text == "+18d", "an entry can be removed")
    h.removeAll()
    check(h.entries.isEmpty, "and all of them")

    let messy = [
        JumpHistory.Entry(text: "", label: "x", kind: "date"),
        JumpHistory.Entry(text: "a", label: String(repeating: "l", count: 500), kind: "cycle"),
        JumpHistory.Entry(text: "a", label: "dup", kind: "cycle"),
        JumpHistory.Entry(text: String(repeating: "t", count: 400), label: "", kind: "date"),
    ]
    let clean = JumpHistory(entries: messy)
    check(clean.entries.count == 2 && clean.entries[0].label.count == 300 && clean.entries[1].text.count == JumpParser.maxInput,
          "stored lists are sanitised: \(clean.entries.map { ($0.text.count, $0.label.count) })")

    let suite = "fx.jump.checks.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    var earthList = JumpHistory()
    earthList.remember("2031-06-01", label: "Sun 1 Jun 2031, 00:00:00 UTC", kind: "date")
    earthList.save(pure: false, to: defaults)
    var pureList = JumpHistory()
    pureList.remember("next Helion", label: "Next η boundary", kind: "boundary")
    pureList.save(pure: true, to: defaults)
    check(JumpHistory.load(pure: false, from: defaults) == earthList, "the Earth list survives a relaunch")
    check(JumpHistory.load(pure: true, from: defaults) == pureList, "the pure list is its own")
    check(!JumpHistory.load(pure: true, from: defaults).entries.contains { $0.text == "2031-06-01" }, "a date never shows in pure mode")
    defaults.set(Data("garbage".utf8), forKey: JumpHistory.key(pure: false))
    check(JumpHistory.load(pure: false, from: defaults).entries.isEmpty, "garbage in storage reads as no history")
    check(JumpHistory.key(pure: false).hasPrefix("jump.") && JumpHistory.key(pure: true).hasPrefix("jump."), "keys carry the feature prefix")
}
