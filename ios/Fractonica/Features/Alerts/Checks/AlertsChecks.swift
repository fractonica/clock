import FractonicaKit
import Foundation

// Alerts' pure logic against the engine: event enumeration (levels, filters, leads, the solar sync, eclipses), the
// merge of simultaneous events, the fair share of the notification budget, quiet hours, the message tokens in both
// vocabularies (pure mode never says an Earth unit) and persistence. Run:
//     ios/scripts/check.sh ios/Fractonica/Features/Alerts/Checks

/// SPEC §12 vector A, 2026-10-08 12:00 UTC: "Delta Trifracton End ε#5 34η 29ι", the Helion ends 3 372.428 s later.
let vectorA = 1_791_460_800.0
let clock = FractonicaClock.shared
let planner = AlertPlanner()
let utc = TimeZone(identifier: "UTC")!

@main
struct AlertsChecks {
    static func main() {
        helionChecks()
        filterChecks()
        leadChecks()
        solarAndEclipseChecks()
        edgeChecks()
        fairShareChecks()
        planChecks()
        quietChecks()
        textChecks()
        persistenceChecks()
        Checks.finish()
    }
}

func rule(_ subject: AlertSubject, _ events: Set<AlertEvent>, ordinal: Int? = nil, coarser: Int? = nil,
          lead: AlertLead = .atMoment) -> AlertRule {
    AlertRule(name: "test", subject: subject, events: events, ordinal: ordinal, coarser: coarser, lead: lead)
}

func helionChecks() {
    let r = AlertPreset.helion.rule(pure: false)
    let list = planner.occurrences(of: r, after: vectorA, limit: 60)
    check(list.count == 60, "60 Helion beginnings: \(list.count)")
    let reading = clock.level(at: vectorA, 6)!
    check(abs(list[0].time - (vectorA + 3372.428)) < 0.002, "the next Helion begins 6ι 43λ after A: \(list[0].time - vectorA)")
    check(list[0].time == reading.end, "… exactly where the running Helion ends")
    check(list[0].index == reading.cycle + 1, "… and it is the next cycle")
    check(zip(list, list.dropFirst()).allSatisfy { $1.time - $0.time > 18_000 && $1.time - $0.time < 18_400 },
          "Helions follow about 5.05 h apart")
    check(list.allSatisfy { $0.fire == $0.time && $0.fire > vectorA }, "no lead: they fire at the moment, after now")
    check(list[0].identifier == "alert.\(r.id.uuidString).6.\(reading.cycle + 1).begin",
          "identifier alert.<rule>.<event>: \(list[0].identifier)")
    check(Set(list.map(\.identifier)).count == list.count, "identifiers are unique")

    // begin + end: one notification per turnover
    let both = planner.occurrences(of: rule(.level(6), [.begin, .end]), after: vectorA, limit: 60)
    check(both.count == 60 && zip(both, list).allSatisfy { $0.time == $1.time }, "begin and end merge into one turnover")
    check(both[0].events == [.begin, .end] && both[0].event == .begin && both[0].index == reading.cycle + 1,
          "the turnover is told as the beginning: \(both[0].events)")

    // quarters
    let quarters = planner.occurrences(of: rule(.level(6), [.peak, .node, .valley]), after: vectorA, limit: 9)
    let facts = clock.cycle(level: 6, index: reading.cycle + 1)!
    check(quarters.count == 9 && quarters[0].time == facts.events[1].time && quarters[1].time == facts.events[2].time
          && quarters[2].time == facts.events[3].time, "peak, node and valley of the next Helion in order")

    // the running cycle's later quarters count (A is in the Helion's End quarter: the next threshold is its end)
    let atA = planner.occurrences(of: rule(.level(3), [.peak, .node, .valley, .end]), after: vectorA, limit: 2)
    let delta = clock.level(at: vectorA, 3)!
    check(atA.first?.time == delta.next.time && atA.first?.event == .end, "Delta Trifracton End: its end comes next")
}

func filterChecks() {
    // the 5th Delta of each Gamma
    let fifth = planner.occurrences(of: rule(.level(3), [.begin], ordinal: 5), after: vectorA, limit: 6)
    check(fifth.count == 6 && fifth.allSatisfy { $0.index % 5 == 4 }, "ordinal 5: only Delta Pentafracton")
    check(zip(fifth, fifth.dropFirst()).allSatisfy { $1.index - $0.index == 5 }, "… one per Gamma")

    // Helions that begin with a Nuclide
    let withNuclide = planner.occurrences(of: rule(.level(6), [.begin], coarser: 4), after: vectorA, limit: 10)
    check(withNuclide.count == 10 && withNuclide.allSatisfy { $0.index % 77 == 0 && $0.top <= 4 },
          "coarser ε: only the Helions that begin a Nuclide")
    let nuclides = clock.boundaries(level: 4, from: vectorA, to: vectorA + 200 * 86_400)
    check(zip(withNuclide, nuclides).allSatisfy { abs($0.time - $1.time) < 0.001 }, "… at the Nuclide boundaries")

    // a Blink that ends with a Helion: ratio P(12)/P(6) = 58 500
    let blinks = planner.occurrences(of: rule(.level(12), [.end], coarser: 6), after: vectorA, limit: 3)
    check(blinks.count == 3 && blinks.allSatisfy { ($0.index + 1) % 58_500 == 0 }, "coarser on a fine level is cheap and exact")

    // impossible combinations
    let never = rule(.level(6), [.begin], ordinal: 3, coarser: 4)
    check(!never.filtersCanMeet() && planner.occurrences(of: never, after: vectorA, limit: 5).isEmpty,
          "the 3rd Helion of a ζ never begins a Nuclide")
    check(rule(.level(6), [.end], ordinal: 11, coarser: 4).filtersCanMeet(), "the 11th ends one")
    check(rule(.level(6), [.peak], coarser: 4).sanitized().events == [.begin], "a coarser filter keeps turnovers only")
    check(rule(.level(3), [.begin], ordinal: 9).sanitized().ordinal == nil, "a Gamma has 5 Deltas, not 9")
    check(rule(.level(3), [.begin], coarser: 5).sanitized().coarser == nil, "a coarser level is coarser")
    check(rule(.level(40), []).sanitized().subject == .level(13), "levels clamp to the UI's 0 … 13")

    // the Alpha ordinal is global
    let alpha7 = planner.occurrences(of: rule(.level(0), [.begin], ordinal: 7), after: vectorA, limit: 3)
    check(alpha7.count == 1 && alpha7[0].index == 6, "Alpha Heptafracton begins once")
}

func leadChecks() {
    let r = rule(.level(6), [.begin], lead: AlertLead(count: 15, unit: .minute))
    let list = planner.occurrences(of: r, after: vectorA, limit: 5)
    check(list.allSatisfy { $0.fire == $0.time - 900 }, "15 min before")

    let preon = rule(.level(6), [.begin], lead: AlertLead(count: 1, unit: .helion))
    let early = planner.occurrences(of: preon, after: vectorA, limit: 5)
    let starts = planner.occurrences(of: rule(.level(6), [.begin]), after: vectorA - 20_000, limit: 8)
    check(early.allSatisfy { o in starts.contains { abs($0.time - o.fire) < 0.001 } },
          "1η before a Helion begins is the previous Helion's beginning")
    check(early.allSatisfy { $0.fire > vectorA }, "… and only those still to come")

    // a lead longer than the gap: the first event is the one whose notification is still ahead
    let long = rule(.level(10), [.begin], lead: AlertLead(count: 2, unit: .day))
    let flavons = planner.occurrences(of: long, after: vectorA, limit: 3)
    check(flavons.count == 3 && flavons[0].fire > vectorA && flavons[0].fire - vectorA < 8,
          "a 2-day lead on Flavons starts about now: \(flavons.first.map { $0.fire - vectorA } ?? -1)")
    let t = planner.eventTime(firingAt: vectorA, lead: AlertLead(count: 3, unit: .preon))
    check(abs(planner.fireTime(event: t, lead: AlertLead(count: 3, unit: .preon)) - vectorA) < 0.001,
          "eventTime(firingAt:) inverts fireTime")
}

func solarAndEclipseChecks() {
    let sync = clock.solar(at: vectorA)!
    let r = AlertPreset.solarQuarters.rule(pure: false)
    let list = planner.occurrences(of: r, after: vectorA, limit: 8)
    check(list.count == 8, "8 sync events")
    check(zip(list, list.dropFirst()).allSatisfy { abs($1.time - $0.time - 86_397.5) < 5 }, "quarters a day apart")
    check(list.contains { $0.event == .begin && abs($0.time - sync.end) < 0.001 && $0.index == sync.sync + 1 },
          "the next sync begins where this one ends")
    check(abs(list[0].time - sync.threshold.time!) < 0.01, "the first is this sync's next quarter")
    check(list.filter { $0.event == .begin }.allSatisfy { clock.level(at: $0.time + 0.002, 6)!.start - $0.time < 0.002 },
          "a sync begins with a Helion")

    let e = AlertPreset.eclipse.rule(pure: false)
    let eclipses = planner.occurrences(of: e, after: vectorA, limit: 3)
    check(eclipses.count == 3 && eclipses[0].index == 23 && eclipses[0].time == clock.catalogue[23],
          "the next eclipse of Saros 141 after A is #23 (2028-01-26)")
    check(eclipses[0].fire == clock.catalogue[23] - 86_400, "… told a day ahead")
}

func edgeChecks() {
    check(planner.plan(rules: [AlertPreset.helion.rule(pure: false)], quiet: QuietHours(), zone: utc, now: 3e10).outOfRange,
          "a real now past the catalogue: out of range")
    check(planner.occurrences(of: AlertPreset.helion.rule(pure: false), after: -2e10, limit: 3).isEmpty,
          "before it: nothing")
    let nearEnd = clock.tMax - 3 * 86_400
    let last = planner.occurrences(of: AlertPreset.helion.rule(pure: false), after: nearEnd, limit: 60)
    check(!last.isEmpty && last.count < 60 && last.allSatisfy { $0.time <= clock.tMax }, "nothing past the catalogue's end: \(last.count)")
    let syncs = planner.occurrences(of: AlertPreset.solarQuarters.rule(pure: false), after: nearEnd, limit: 60)
    check(syncs.allSatisfy { $0.time <= clock.tMax }, "the last partial sync is never read")
    check(planner.occurrences(of: AlertPreset.eclipse.rule(pure: false), after: nearEnd, limit: 3).map(\.index) == [69],
          "the last eclipse is #69")
    let early = clock.tMin + 100
    check(planner.occurrences(of: AlertPreset.solarQuarters.rule(pure: false), after: early, limit: 4).count == 4,
          "near the catalogue's start the first whole sync is found")
}

func fairShareChecks() {
    let q = { (n: Int, step: Double) in (0..<n).map { Double($0) * step } }
    var s = AlertPlanner.fairShare([q(100, 1), q(1, 1), q(100, 1)], demands: [100, 1, 100], budget: 60)
    check(s == [30, 1, 29] || s == [29, 1, 30], "a rule needing one leaves the rest to the others: \(s)")
    check(s.reduce(0, +) == 60, "the budget is used")
    s = AlertPlanner.fairShare([q(100, 10), q(100, 1)], demands: [100, 100], budget: 7)
    check(s == [3, 4], "an odd slot goes to the sooner queue: \(s)")
    s = AlertPlanner.fairShare([q(5, 1), q(5, 1)], demands: [5, 5], budget: 60)
    check(s == [5, 5], "never more than wanted")
    s = AlertPlanner.fairShare([], demands: [], budget: 60)
    check(s.isEmpty, "no rules")
    s = AlertPlanner.fairShare([q(40, 1), q(40, 1), q(40, 1)], demands: [40, 2, 40], budget: 60)
    check(s == [29, 2, 29], "max-min fair: \(s)")
}

func planChecks() {
    let helion = AlertPreset.helion.rule(pure: false)
    let nuclide = AlertPreset.nuclide.rule(pure: false)
    let flavon = rule(.level(10), [.begin])
    let eclipse = AlertPreset.eclipse.rule(pure: false)
    let plan = planner.plan(rules: [helion, nuclide, flavon, eclipse], quiet: QuietHours(), zone: utc, now: vectorA)
    check(plan.alerts.count == 60, "60 pending at most: \(plan.alerts.count)")
    check(plan.alerts.allSatisfy { $0.id.hasPrefix("alert.") }, "every request is an alert.")
    check(Set(plan.alerts.map(\.id)).count == plan.alerts.count, "no identifier twice")
    check(zip(plan.alerts, plan.alerts.dropFirst()).allSatisfy { $1.fire - $0.fire >= 0.5 },
          "no two notifications at the same instant")
    check(plan.alerts.contains { $0.ruleID == eclipse.id }, "the fast Flavon rule cannot starve the eclipse")
    check(plan.alerts.contains { $0.ruleID == nuclide.id }, "… nor the Nuclide")
    let byRule = Dictionary(grouping: plan.alerts, by: \.ruleID).mapValues(\.count)
    check((byRule[flavon.id] ?? 0) >= 25 && byRule[nuclide.id] == 2 && byRule[eclipse.id] == 2,
          "slow rules take their next two, fast ones share the rest: \(byRule.values.sorted())")
    for rule in [helion, flavon] {
        let mine = plan.alerts.filter { $0.ruleID == rule.id }.map(\.fire)
        let all = planner.occurrences(of: rule, after: vectorA, limit: 60).map(\.fire)
        check(mine == Array(all.prefix(mine.count)) || rule.id == flavon.id, "soonest first within a share")
    }
    // A Nuclide turnover is a Helion turnover too: told once, by the Nuclide, the Helion folded in.
    let both = planner.plan(rules: [helion, nuclide], quiet: QuietHours(), zone: utc, now: vectorA)
    let turn = both.alerts.first { $0.ruleID == nuclide.id }!
    check(turn.also.count == 1 && turn.also[0].ruleID == helion.id, "the Helion beginning folds into the Nuclide's")
    check(!both.alerts.contains { $0.ruleID == helion.id && abs($0.fire - turn.fire) < 0.5 }, "… and is not told twice")
    check(both.next[helion.id] != nil && both.next[nuclide.id] != nil, "every rule has its next moment")
    // disabled rules are not planned
    var off = helion
    off.enabled = false
    check(planner.plan(rules: [off], quiet: QuietHours(), zone: utc, now: vectorA).alerts.isEmpty, "a disabled rule is silent")
}

func quietChecks() {
    var q = QuietHours(enabled: true, start: 22 * 60 + 30, end: 7 * 60, mode: .silence)
    let midnight = 1_791_417_600.0 // 2026-10-08 00:00 UTC
    check(q.contains(midnight + 3 * 3600, zone: utc), "03:00 is quiet")
    check(q.contains(midnight + 23 * 3600, zone: utc), "23:00 is quiet")
    check(!q.contains(midnight + 7 * 3600, zone: utc), "07:00 is not")
    check(!q.contains(midnight + 12 * 3600, zone: utc), "noon is not")
    let moscow = TimeZone(identifier: "Europe/Moscow")!
    check(q.contains(midnight + 3 * 3600, zone: moscow), "03:00 UTC is 06:00 in Moscow: quiet there too")
    check(!q.contains(midnight + 19 * 3600, zone: moscow) && q.contains(midnight + 19 * 3600, zone: TimeZone(identifier: "Asia/Tokyo")!),
          "19:00 UTC is 22:00 in Moscow (not yet quiet) and 04:00 in Tokyo (quiet)")
    q.start = 9 * 60
    q.end = 17 * 60
    check(q.contains(midnight + 12 * 3600, zone: utc) && !q.contains(midnight + 20 * 3600, zone: utc), "a daytime window")
    q.end = q.start
    check(!q.contains(midnight + 12 * 3600, zone: utc), "an empty window holds nothing")
    check(QuietHours(start: -60, end: 1500).sanitized() == QuietHours(start: 1380, end: 60), "minutes wrap into the day")

    let helion = AlertPreset.helion.rule(pure: false)
    var night = QuietHours(enabled: true, start: 22 * 60, end: 6 * 60, mode: .skip)
    let skipped = planner.plan(rules: [helion], quiet: night, zone: utc, now: vectorA)
    check(!skipped.alerts.isEmpty && skipped.alerts.allSatisfy { !night.contains($0.fire, zone: utc) }, "skip holds them back")
    night.mode = .silence
    let silent = planner.plan(rules: [helion], quiet: night, zone: utc, now: vectorA)
    check(silent.alerts.contains(where: \.silenced) && silent.alerts.allSatisfy { $0.silenced == night.contains($0.fire, zone: utc) },
          "silence marks exactly the quiet ones")
    var loud = helion
    loud.ignoresQuietHours = true
    check(!planner.plan(rules: [loud], quiet: night, zone: utc, now: vectorA).alerts.contains(where: \.silenced),
          "a rule may ring through quiet hours")
}

/// Earth words that pure mode must never say (docs/design/80-pure.md rule 2).
func leaks(_ s: String) -> [String] {
    let patterns = [#"\d\s?(s|ms|min|h|d|y|wk|mo)\b"#, #"\d{1,2}:\d{2}"#, "%", "UTC", #"\b(day|days|hour|hours|minute|minutes|second|seconds|week|month|year|today|tomorrow)\b"#,
                    #"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b"#, #"\b(1[6-9]|2[0-8])\d\d\b"#]
    return patterns.filter { s.range(of: $0, options: .regularExpression) != nil }
}

func textChecks() {
    let earth = AlertText(words: Wording(pure: false, timeZone: utc))
    let pure = AlertText(words: Wording(pure: true, timeZone: utc))

    let helion = AlertPreset.helion.rule(pure: false)
    let h = planner.occurrences(of: helion, after: vectorA, limit: 1)[0]
    check(pure.title(helion, h) == "35η begins", "pure title: \(pure.title(helion, h))")
    check(earth.title(helion, h) == "35η begins", "Earth title: \(earth.title(helion, h))")
    check(earth.body(helion, h) == "A new Helion · 12:56:12", "Earth body: \(earth.body(helion, h))")
    check(pure.body(helion, h) == "A new Helion · 35η 0ι 0λ", "pure body: \(pure.body(helion, h))")

    // a Helion that starts a Nuclide carries the Nuclide
    let n = planner.occurrences(of: rule(.level(6), [.begin], coarser: 4), after: vectorA, limit: 1)[0]
    check(pure.name(n).hasPrefix("ε#") && pure.name(n).hasSuffix(" 1η"), "a new Nuclide's first Helion: \(pure.name(n))")

    // Deltas and the coarsest turnover
    let delta = rule(.level(3), [.begin])
    let d = planner.occurrences(of: delta, after: vectorA, limit: 1)[0]
    check(earth.title(delta, d) == "Delta Tetrafracton begins", "the next Delta: \(earth.title(delta, d))")
    let majors = AlertPreset.majors.rule(pure: false)
    let turns = planner.occurrences(of: majors, after: vectorA, limit: 40)
    let beta = turns.first { $0.top <= 1 }!
    check(earth.name(beta).hasPrefix(beta.top == 0 ? "Alpha " : "Beta "), "a Beta turning names the Beta: \(earth.name(beta))")
    check(earth.unit(beta) == (beta.top == 0 ? "Alpha" : "Beta") && earth.unit(turns[0]) == "Gamma", "{unit} follows")
    check(earth.ordinal(turns[0]) == Notation.ordinalName(earth.notation.ordinalOf(level: 2, cycle: turns[0].index)),
          "{ordinal} of a major is its fracton word")

    let quarters = AlertPreset.deltaQuarters.rule(pure: false)
    let q = planner.occurrences(of: quarters, after: vectorA, limit: 3)
    check(earth.title(quarters, q[1]) == "Delta Tetrafracton reaches its peak", "quarters: \(earth.title(quarters, q[1]))")

    let sync = AlertPreset.solarQuarters.rule(pure: false)
    let s = planner.occurrences(of: sync, after: vectorA, limit: 1)[0]
    check(earth.title(sync, s).hasPrefix("Solar sync \(s.index) "), "sync title: \(earth.title(sync, s))")

    let eclipse = AlertPreset.eclipse.rule(pure: false)
    let e = planner.occurrences(of: eclipse, after: vectorA, limit: 1)[0]
    check(earth.title(eclipse, e) == "Saros 141 eclipse #23", "eclipse title: \(earth.title(eclipse, e))")
    check(earth.body(eclipse, e).hasPrefix("Greatest eclipse in 1\u{00A0}day · Jan 26 "), "eclipse body: \(earth.body(eclipse, e))")
    let pureEclipse = AlertPreset.eclipse.rule(pure: true)
    let pe = planner.occurrences(of: pureEclipse, after: vectorA, limit: 1)[0]
    check(pure.body(pureEclipse, pe).hasPrefix("Greatest eclipse in 5η · "), "pure eclipse body: \(pure.body(pureEclipse, pe))")

    // moments far ahead name their year (Earth) or their Alpha, Beta and Gamma (pure): the SPEC §8 label drops them
    let eclipse23 = clock.catalogue[23] + 0.002
    check(earth.moment(eclipse23, from: vectorA) == "Jan 26 2028 15:07", "an eclipse years ahead: \(earth.moment(eclipse23, from: vectorA))")
    check(earth.moment(eclipse23, from: eclipse23 - 86_400) == "Jan 26 15:07", "… a day ahead, in its year")
    check(earth.moment(h.time + 0.002, from: vectorA) == "12:56:12", "… the same day: the time")
    check(pure.moment(eclipse23, from: vectorA) == "α#6 β#4 γ#10 δ#4 ε#4 58η", "pure, another Gamma: \(pure.moment(eclipse23, from: vectorA))")
    check(pure.moment(d.time + 0.002, from: vectorA) == "δ#4 ε#1 1η", "pure, the same Gamma: \(pure.moment(d.time + 0.002, from: vectorA))")
    check(pure.moment(h.time + 0.002, from: vectorA) == "35η 0ι 0λ", "pure, the same Nuclide: the clock")
    check(leaks(pure.moment(eclipse23, from: vectorA)).isEmpty, "pure moments say no Earth word")

    // tokens and templates
    var custom = helion
    custom.title = "{unit} {ordinal} · {name} {event} {nope}"
    check(earth.title(custom, h) == "Helion \(Journal.ordinal(earth.notation.ordinalOf(level: 6, cycle: h.index))) · 35η begins {nope}",
          "tokens: \(earth.title(custom, h))")
    custom.title = "  "
    check(earth.title(custom, h) == "35η begins", "an empty title falls back to the default")
    check(earth.body(helion, h, also: [(AlertPreset.nuclide.rule(pure: false), n)]).contains("\nAlso: "), "folded alerts are listed")

    // leads in words
    check(earth.leadSummary(AlertLead(count: 15, unit: .minute), at: vectorA) == "15\u{00A0}min before", "Earth lead")
    check(earth.leadSummary(AlertLead(count: 3, unit: .preon), at: vectorA) == "3ι before", "Fractonica lead")
    check(pure.leadSummary(AlertLead(count: 15, unit: .minute), at: vectorA).hasPrefix("≈ 1ι "), "an Earth lead in pure words: \(pure.leadSummary(AlertLead(count: 15, unit: .minute), at: vectorA))")
    check(earth.filterSummary(rule(.level(3), [.begin], ordinal: 5)) == "only Delta Pentafracton", "ordinal words")
    let nuclides = planner.occurrences(of: rule(.level(4), [.begin]), after: vectorA, limit: 2)
    check(pure.title(rule(.level(4), [.begin]), nuclides[0]) == "Delta Tetrafracton begins",
          "a Nuclide beginning a Delta is told as the Delta: \(pure.title(rule(.level(4), [.begin]), nuclides[0]))")
    check(pure.title(rule(.level(4), [.begin]), nuclides[1]) == "ε#2 begins", "a Greek letter is never capitalized")
    check(earth.filterSummary(rule(.level(6), [.begin], coarser: 4)) == "when a Nuclide turns too", "coarser words")
    check(earth.subjectName(.level(5)) == "ζ 6" && earth.subjectName(.level(6)) == "Helion", "subject names")

    // pure mode never says an Earth unit, whatever the rule
    var said: [String] = []
    let now = vectorA
    for preset in AlertPreset.allCases {
        for madeIn in [false, true] {
            let r = preset.rule(pure: madeIn)
            for o in planner.occurrences(of: r, after: now, limit: 4) {
                said += [pure.title(r, o), pure.body(r, o)]
            }
            said += [pure.summary(r, at: now), pure.subjectName(r.subject), pure.subjectDetail(r.subject),
                     preset.title, preset.detail(pure: true)]
        }
    }
    for level in 0...13 { said += [pure.subjectName(.level(level)), pure.subjectDetail(.level(level))] }
    let leaky = said.filter { !leaks($0).isEmpty }
    check(leaky.isEmpty, "pure mode says no Earth unit: \(leaky.prefix(5))")
    check(!said.isEmpty, "pure texts were produced")
}

func persistenceChecks() {
    let suite = "fx.alerts.checks.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    check(AlertsConfig.load(from: defaults) == AlertsConfig(), "nothing saved: no rules")
    var config = AlertsConfig(rules: AlertPreset.allCases.map { $0.rule(pure: false) },
                              quiet: QuietHours(enabled: true, start: 60, end: 120, mode: .skip))
    config.rules[0].ordinal = 3
    config.rules[0].lead = AlertLead(count: 2, unit: .preon)
    config.save(to: defaults)
    check(AlertsConfig.load(from: defaults) == config, "rules and quiet hours round-trip")
    defaults.set(Data("garbage".utf8), forKey: AlertsConfig.key)
    check(AlertsConfig.load(from: defaults) == AlertsConfig(), "garbage falls back to no rules")
    let json = #"{"rules":[{"subject":{"level":{"_0":44}},"name":"  "},{"subject":{"solar":{}},"ordinal":4}],"quiet":{"start":-5}}"#
    let decoded = AlertsConfig.decode(Data(json.utf8))
    check(decoded?.rules.count == 2 && decoded?.rules[0].subject == .level(13) && decoded?.rules[0].name == "Alert"
          && decoded?.rules[1].ordinal == nil && decoded?.quiet.start == 1435, "lenient, sanitized decoding: \(String(describing: decoded))")
    let twice = AlertsConfig(rules: [config.rules[0], config.rules[0]])
    check(twice.sanitized().rules.count == 1, "a rule id appears once")
}
