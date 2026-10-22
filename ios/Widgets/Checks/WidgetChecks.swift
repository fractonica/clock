import FractonicaKit
import Foundation

// Checks of the widgets' logic (ios/scripts/check.sh ios/Widgets/Checks): timelines hold an entry exactly where the
// picture changes and nowhere else, the snapshots read the SPEC vectors right, and pure words stay pure.

@main
enum WidgetChecks {
    /// SPEC §12 vector A: 2026-10-08 12:00 UTC.
    static let a = 1_791_460_800.0
    static let clock = FractonicaClock.shared

    static func main() {
        vectors()
        words()
        schedules()
        pureLeaks()
        edges()
        helionArc()
        Checks.finish()
    }

    // MARK: - SPEC vectors

    static func vectors() {
        let pure = WidgetWords(pure: true)
        let earth = WidgetWords(pure: false, zone: "UTC")

        let journal = JournalSnapshot(at: a, unit: 5, words: pure)
        check(journal?.tokens.map(\.text) == ["34η", "29ι"], "Helion face stops at the Preon: \(String(describing: journal?.tokens))")
        check(journal?.top == .pair(hi: 13, lo: 0), "Helion pair at A is [13, 0] (SPEC §15.6)")
        check(journal?.leadLevel == 6 && journal?.leadLetter == "η", "the Helion leads")
        check(journal?.caption == "Delta Trifracton End · ε#5", "caption: \(journal?.caption ?? "nil")")
        check(journal.map { $0.preon != nil && $0.preon!.contains(a) } == true, "the running Preon holds A")

        let nuclide = JournalSnapshot(at: a, unit: 4, words: pure)
        check(nuclide?.tokens.map(\.text) == ["ε#05", "34η", "29ι"], "Nuclide face: \(String(describing: nuclide?.tokens.map(\.text)))")
        check(nuclide?.tokens.first?.prefix == "ε#" && nuclide?.tokens.first?.number == "05", "ε token splits into mark and number")

        let delta = JournalSnapshot(at: a, unit: 3, words: pure)
        check(delta?.lines == ["5th", "Delta", "Trifracton", "End"], "Delta face: \(delta?.lines ?? [])")
        check(delta?.preon == nil && delta?.tokens.isEmpty == true, "a major face has no counts")
        if case .glyph3(let index)? = delta?.top {
            check(index == clock.level(at: a, 3, strokes: 3)?.index, "major glyph is the 3-stroke state")
        } else {
            check(false, "a major face shows a 3-stroke glyph")
        }
        check(JournalSnapshot(at: a, unit: 9, words: pure)?.unit == 5, "units beyond η clamp to the Helion face")
        check(JournalSnapshot(at: a, unit: -3, words: pure)?.unit == 0, "negative units clamp to α")

        let c = ClockSnapshot(at: a, words: pure)
        check(c?.tokens.map(\.text) == ["34η", "29ι"], "clock tokens")
        check(c?.helionPair == [13, 0], "clock pair")
        check(c?.major == "Delta Trifracton End" && c?.nuclide == "ε#5", "clock date: \(c?.major ?? "") \(c?.nuclide ?? "")")
        check(c?.nextHelion == "35η", "the next Helion: \(c?.nextHelion ?? "nil")")
        check(c?.nextHelionWhen == "7ι", "pure Helion countdown counts the Preons still to start: \(c?.nextHelionWhen ?? "")")
        check(c?.earthDay == nil && c?.earthZone == nil, "pure clock has no Earth day or zone")
        check(c?.solarText.hasPrefix("sync ") == true && c?.solarText.contains("drift") == true && c?.solarText.hasSuffix("λ") == true,
              "pure solar line: \(c?.solarText ?? "")")
        check(c?.solarDigits == clock.solar(at: a)?.digits3, "solar odometer")

        let ce = ClockSnapshot(at: a, words: earth)
        check(ce?.earthDay == "Thu 8 Oct 2026", "Earth day: \(ce?.earthDay ?? "nil")")
        check(ce?.earthZone == "UTC", "Earth zone tag")
        let helionEnd = clock.level(at: a, 6)!.end
        check(abs(helionEnd - a - 3372.428) < 0.01, "SPEC §12: the Helion ends 3372.428 s after A")
        check(ce?.nextHelionWhen == "12:56", "Earth: the next Helion at 12:56: \(ce?.nextHelionWhen ?? "")")
        check(ce?.solarText.hasPrefix("sync ") == true && ce?.solarText.contains("began") == true, "Earth solar line: \(ce?.solarText ?? "")")

        let up = UpNextSnapshot(at: a, words: pure)
        check(up?.turnovers.first?.level == 6 && up?.turnovers.first?.begins == "35η", "first turnover: \(String(describing: up?.turnovers.first))")
        check(up?.turnovers.first?.countdown == "7ι", "pure countdown: \(up?.turnovers.first?.countdown ?? "nil")")
        check(up?.turnovers.first?.when == "δ#3 ε#5 35η", "pure when: \(up?.turnovers.first?.when ?? "")")
        check(up.map { zip($0.turnovers, $0.turnovers.dropFirst()).allSatisfy { $0.time < $1.time } } == true, "turnovers are sorted")
        check(up.map { Set($0.turnovers.map(\.level)).count == $0.turnovers.count } == true, "one row per level")
        let delta3 = up?.turnovers.first { $0.level == 3 }
        check(delta3?.begins == "Delta Tetrafracton", "the next Delta in words: \(delta3?.begins ?? "nil")")
        // ε#5 is the Delta's last Nuclide: the ε and δ ends coincide and the row names the coarser
        check(up?.turnovers.contains { $0.level == 4 } == false, "ε ends with δ here, so δ names the row")

        let upE = UpNextSnapshot(at: a, words: earth)
        check(upE?.turnovers.first?.countdown == nil, "Earth: a close turnover counts down live")
        check(upE?.turnovers.first?.when == "12:56", "Earth when: \(upE?.turnovers.first?.when ?? "")")
        check(upE?.turnovers.last?.countdown?.hasSuffix(" d") == true || upE?.turnovers.last?.countdown?.hasSuffix(" h") == true,
              "Earth: a far turnover is a static span: \(upE?.turnovers.last?.countdown ?? "nil")")

        // the shortest unit listed (the web card's importance)
        let fromDelta = UpNextSnapshot(at: a, words: pure, finest: 3)
        check(fromDelta?.turnovers.map(\.level) == [3, 2, 1, 0], "from the Delta: δ γ β α: \(fromDelta?.turnovers.map(\.level) ?? [])")
        check(fromDelta?.turnovers.first?.countdown == "43η 7ι", "from the Delta: \(fromDelta?.turnovers.first?.countdown ?? "nil")")
        check(UpNextSnapshot.levels(from: 4) == [4, 3, 2, 1, 0] && UpNextSnapshot.levels(from: 2) == [2, 1, 0], "levels from a unit up")
        let live = 1_792_672_927.0 // ε#1 24η: the Nuclide ends before the Delta
        let fromNuclide = UpNextSnapshot(at: live, words: earth, finest: 4)
        check(fromNuclide?.turnovers.first?.level == 4 && fromNuclide?.turnovers.first?.begins == "ε#2",
              "from the Nuclide: ε#2 first: \(String(describing: fromNuclide?.turnovers.first))")
        // Earth entries are sparse: one where the Smart Stack lead before the Nuclide's end begins
        if let end = fromNuclide?.turnovers.first?.time {
            let times = EntrySchedule.times(from: end - 6 * 3600, horizon: 7 * 3600) { UpNextSnapshot.changes(at: $0, words: earth, finest: 4) }
            check(times.contains(end - UpNextSnapshot.relevanceLead), "an Earth entry where the lead before a Nuclide's end begins")
            check(times.contains(end), "an Earth entry at the Nuclide's end")
        }

        let rings = RingsSnapshot(at: a, words: pure)
        check(rings?.rings.map(\.level) == Array(0...6), "rings α … η")
        check(rings?.rings.allSatisfy { $0.phase >= 0 && $0.phase < 1 && $0.local < $0.siblings } == true, "ring readings in range")
        check(rings?.next?.begins == "35η", "rings: next Helion")

        let lock = AccessorySnapshot(at: a)
        check(lock?.helion == 34 && lock?.inline == "34η 29ι", "lock: \(lock?.inline ?? "nil")")
        check(lock?.major == "Delta Trifracton End" && lock?.nuclide == "ε#5", "lock date")
    }

    // MARK: - Words

    static func words() {
        let w = WidgetWords(pure: false, zone: "UTC")
        check(w.earthWhen(a + 3600, from: a) == "13:00", "same day: \(w.earthWhen(a + 3600, from: a))")
        check(w.earthWhen(a + 86_400, from: a) == "Fri 12:00", "tomorrow: \(w.earthWhen(a + 86_400, from: a))")
        check(w.earthWhen(a + 6 * 86_400, from: a) == "Wed 12:00", "six days: \(w.earthWhen(a + 6 * 86_400, from: a))")
        check(w.earthWhen(a + 10 * 86_400, from: a) == "Oct 18 12:00", "farther: \(w.earthWhen(a + 10 * 86_400, from: a))")
        check(w.earthWhen(a + 400 * 86_400, from: a) == "Nov 12 2027 12:00", "another year: \(w.earthWhen(a + 400 * 86_400, from: a))")
        check(w.earthSpan(3 * 86_400 + 4 * 3600 + 5) == "3 d 04 h", "Earth span: \(w.earthSpan(3 * 86_400 + 4 * 3600 + 5))")
        let berlin = WidgetWords(pure: false, zone: "Europe/Berlin")
        check(berlin.earthWhen(a, from: a) == "14:00", "zone applies: \(berlin.earthWhen(a, from: a))")
        check(berlin.earthZone(a) == "UTC+02:00", "zone tag: \(berlin.earthZone(a))")

        let p = WidgetWords(pure: true)
        // the last Helion of ε#5 rolls into the next Delta's first Nuclide
        let nuclideEnd = clock.level(at: a, 4)!.end
        let lastHelion = clock.level(at: nuclideEnd - 1, 6)!
        check(p.nextCycleName(level: 6, cycle: lastHelion.cycle) == "ε#1 1η", "across a Nuclide: \(p.nextCycleName(level: 6, cycle: lastHelion.cycle) ?? "nil")")
        let helion = clock.level(at: a, 6)!
        check(p.nextCycleName(level: 6, cycle: helion.cycle) == "35η", "inside a Nuclide")
        let lastAlpha = Int64(clock.count(0)) - 1
        check(p.nextCycleName(level: 0, cycle: lastAlpha) == nil, "nothing begins after the last Alpha")
        check(WidgetWords.levelWord(3) == "Delta" && WidgetWords.levelWord(6) == "η", "level words")
        let nu = Journal.reading(at: a, unit: 6)?.tokens?.last.map(CountToken.init(journal:))
        check(nu?.suffix == "ν" && nu?.number == "03" && nu?.level == 12, "ν token: \(String(describing: nu))")
    }

    // MARK: - Schedules

    /// What a family draws at t, as a comparable key (continuous values such as the arc's tick are left out where a
    /// coarser change already schedules them).
    static func schedules() {
        let pure = WidgetWords(pure: true)
        let earth = WidgetWords(pure: false, zone: "UTC")
        let starts = [a, 946_684_800, 2_886_085_800, clock.tMin + 86_400 * 3]
        for start in starts {
            for unit in JournalSnapshot.units {
                expectHonest("journal \(unit)", from: start, changes: { _ in JournalSnapshot.changes(unit: unit) }) { t in
                    JournalSnapshot(at: t, unit: unit, words: pure).map { s in
                        "\(s.top) \(s.tokens.map(\.text)) \(s.lines) \(s.preon.map { "\($0.lowerBound)" } ?? "") \(Notation.pair(s.leadPhase).index)"
                    }
                }
            }
            for words in [pure, earth] {
                let mode = words.pure ? "pure" : "earth"
                expectHonest("clock \(mode)", from: start, changes: { _ in ClockSnapshot.changes(words: words) }) { t in
                    ClockSnapshot(at: t, words: words).map {
                        "\($0.tokens.map(\.text)) \($0.helionPair) \($0.solarDigits ?? []) \($0.solarText) \($0.nextHelionWhen) \($0.major) \($0.nuclide) \($0.earthDay ?? "")"
                    }
                }
                // Earth turnovers counting down live change nothing at a Preon start
                expectHonest("up next \(mode)", from: start, exactChanges: words.pure, changes: { UpNextSnapshot.changes(at: $0, words: words) }) { t in
                    UpNextSnapshot(at: t, words: words).map { $0.turnovers.map { "\($0.level) \($0.begins ?? "") \($0.when) \($0.countdown ?? "")" }.joined(separator: "|") }
                }
                for finest in [4, 3] {
                    expectHonest("up next from \(finest) \(mode)", from: start, exactChanges: false,
                                 changes: { UpNextSnapshot.changes(at: $0, words: words, finest: finest) }) { t in
                        UpNextSnapshot(at: t, words: words, finest: finest).map {
                            $0.turnovers.map { "\($0.level) \($0.begins ?? "") \($0.when) \($0.countdown ?? "")" }.joined(separator: "|")
                        }
                    }
                }
                expectHonest("rings \(mode)", from: start, exactChanges: words.pure, changes: { _ in RingsSnapshot.changes(words: words) }) { t in
                    RingsSnapshot(at: t, words: words).map { "\($0.tokens.map(\.text)) \($0.helionPair) \($0.next?.countdown ?? "") \($0.next?.when ?? "")" }
                }
            }
            expectHonest("accessory", from: start, changes: { _ in AccessorySnapshot.changes }) { t in
                AccessorySnapshot(at: t).map { "\($0.helion) \($0.helionPair) \($0.inline) \($0.major) \($0.nuclide)" }
            }
            expectHonest("helion arc", from: start, changes: { _ in HelionArcSnapshot.changes }) { t in
                HelionArcSnapshot(at: t).map { "\($0.helionToken.text) \($0.preonToken.text) \($0.preon) \($0.step)" }
            }
        }

        // bounds of a timeline
        let times = EntrySchedule.times(from: a, changes: ClockSnapshot.changes(words: pure))
        check(times.count == EntrySchedule.maxEntries, "a busy timeline fills its \(EntrySchedule.maxEntries) entries: \(times.count)")
        check(times.first == a, "a timeline starts now")
        check(zip(times, times.dropFirst()).allSatisfy { $1 - $0 >= 1 }, "entries at least a second apart")
        let slow = EntrySchedule.times(from: a, changes: JournalSnapshot.changes(unit: 0), horizon: 86_400)
        check(slow.count >= 1 && slow.count < 10 && slow.last! <= a + 86_400, "an Alpha face changes a few times a day: \(slow.count)")
        check(EntrySchedule.times(from: a, changes: []) == [a], "no changes: one entry")
        // minimumGap merges into the later instant
        let merged = EntrySchedule.times(from: a, changes: [.pair(level: 6), .cycle(level: 8)], minimumGap: 30)
        check(zip(merged.dropFirst(), merged.dropFirst(2)).allSatisfy { $1 - $0 >= 30 }, "merged entries keep the gap")
    }

    /// Every entry of the timeline shows a state that holds until the next entry, and (when `exactChanges`) the state
    /// really changes at each entry.
    /// Merged changes may show up to the schedule's `minimumGap` (1 s) late, so "holds until the next entry" is
    /// checked a second before it.
    static func expectHonest(_ name: String, from start: Double, exactChanges: Bool = true,
                             changes: (Double) -> Set<WidgetChange>, key: (Double) -> String?) {
        let horizon = 30 * 3600.0
        let times = EntrySchedule.times(from: start, horizon: horizon, maxEntries: 80, changes: changes)
        guard times.count > 1 else {
            check(times == [start] && key(start + WidgetChange.settle) == key(start + horizon),
                  "\(name) from \(start): a single entry holds for the whole horizon")
            return
        }
        var stale = 0, idle = 0
        for (t0, t1) in zip(times, times.dropFirst()) {
            let shown = key(t0 + WidgetChange.settle)
            if key(max(t0 + WidgetChange.settle, t1 - 1)) != shown { stale += 1 }
            if exactChanges && key(t1 - 0.005) == key(t1 + WidgetChange.settle) { idle += 1 }
        }
        check(stale == 0, "\(name) from \(start): \(stale) of \(times.count - 1) entries go stale before the next")
        check(idle == 0, "\(name) from \(start): \(idle) entries change nothing")
    }

    // MARK: - Pure words

    /// Earth words a pure widget must never print (docs/design/80-pure.md, rule 2).
    static let forbidden: [String] = [
        #"\d:\d\d"#, #"\d\s?(s|ms|min|h|d|wk|mo|y)\b"#, "%", "UTC", "GMT",
        #"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b"#, #"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b"#,
        #"\b(1[6-9]|2[0-8])\d\d\b"#, "Hz", "today", "tomorrow", "hour", "minute", "second", "day", "week", "month", "year",
    ]

    static func pureLeaks() {
        let pure = WidgetWords(pure: true)
        var instants: [Double] = [a, 946_684_800, 2_886_085_800, clock.tMin + 3 * 86_400, clock.tMax - 3 * 86_400]
        var seed: UInt64 = 0x9E37_79B9_7F4A_7C15
        for _ in 0..<200 {
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            instants.append(clock.tMin + Double(seed >> 11) / Double(1 << 53) * (clock.tMax - clock.tMin))
        }
        var leaks: [String] = []
        for t in instants {
            var texts: [String] = []
            for unit in JournalSnapshot.units {
                if let s = JournalSnapshot(at: t, unit: unit, words: pure) {
                    texts += s.tokens.map(\.text) + s.lines + [s.caption, s.accessibility]
                }
            }
            if let s = ClockSnapshot(at: t, words: pure) {
                texts += [s.major, s.nuclide, s.solarText, s.nextHelion ?? "", s.nextHelionWhen, s.accessibility]
                check(s.earthDay == nil && s.earthZone == nil, "pure clock without Earth fields")
            }
            if let s = UpNextSnapshot(at: t, words: pure) {
                texts += s.turnovers.flatMap { [$0.title, $0.when, $0.countdown ?? ""] }
                check(s.turnovers.allSatisfy { $0.countdown != nil }, "pure countdowns are never live Earth timers")
            }
            if let s = RingsSnapshot(at: t, words: pure) { texts.append(s.accessibility) }
            if let s = AccessorySnapshot(at: t) { texts += [s.inline, s.major, s.nuclide] }
            if let s = HelionArcSnapshot(at: t) { texts += [s.helionToken.text, s.preonToken.text, s.accessibility] }
            for text in texts {
                for pattern in forbidden where text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil {
                    leaks.append("\(pattern) in \"\(text)\"")
                }
            }
        }
        check(leaks.isEmpty, "pure words leak Earth terms: \(leaks.prefix(5))")
    }

    // MARK: - Catalogue edges

    static func edges() {
        let pure = WidgetWords(pure: true)
        for t in [clock.tMin - 1, clock.tMax + 1, -1e12, 1e12] {
            check(JournalSnapshot(at: t, unit: 5, words: pure) == nil, "no journal outside the catalogue (\(t))")
            check(ClockSnapshot(at: t, words: pure) == nil, "no clock outside (\(t))")
            check(UpNextSnapshot(at: t, words: pure) == nil, "no up next outside (\(t))")
            check(RingsSnapshot(at: t, words: pure) == nil, "no rings outside (\(t))")
            check(AccessorySnapshot(at: t) == nil, "no accessory outside (\(t))")
            check(HelionArcSnapshot(at: t) == nil, "no Helion Arc outside (\(t))")
            check(EntrySchedule.times(from: t, changes: ClockSnapshot.changes(words: pure)).isEmpty, "no timeline outside (\(t))")
        }
        // the closing hours: entries never pass the end, the last turnover is the catalogue's end
        let late = clock.tMax - 3600
        let times = EntrySchedule.times(from: late, changes: ClockSnapshot.changes(words: pure))
        check(!times.isEmpty && times.allSatisfy { $0 <= clock.tMax }, "entries stop at the catalogue's end")
        let up = UpNextSnapshot(at: late, words: pure)
        check(up?.turnovers.last?.when == "α#1 – α#18", "pure: the end is the catalogue's extent: \(up?.turnovers.last?.when ?? "nil")")
        check(up?.turnovers.last.map { $0.begins == nil && $0.title == "The catalogue ends" } == true,
              "the last turnover is the end: \(String(describing: up?.turnovers.last))")
        check(JournalSnapshot(at: clock.tMax, unit: 5, words: pure) != nil, "the closing instant still reads")
        // the first instants
        let early = EntrySchedule.times(from: clock.tMin, changes: JournalSnapshot.changes(unit: 5))
        check(early.first == clock.tMin && early.count > 1, "a timeline from the catalogue's first instant")
    }

    // MARK: - Helion Arc

    static func helionArc() {
        typealias G = HelionArcGeometry
        // the counts: the journal face's, two digits each, at A and anywhere in the catalogue
        let s = HelionArcSnapshot(at: a)
        check(s?.helionToken.text == "34η" && s?.preonToken.text == "29ι", "Helion Arc at A: \(s?.helionToken.text ?? "nil") \(s?.preonToken.text ?? "")")
        check(s?.helion == 34 && s?.preon == 29, "Helion Arc counts at A")
        check(s?.helionToken.level == 6 && s?.preonToken.level == 8 && s?.helionToken.number == "34" && s?.preonToken.suffix == "ι",
              "tokens split for colouring")
        let first = clock.level(at: clock.level(at: a, 4)!.start + WidgetChange.settle, 6)!.start + WidgetChange.settle
        let start = HelionArcSnapshot(at: first)
        check(start?.helionToken.text == "01η" && start?.preonToken.text == "00ι" && start?.step == 0,
              "two digits at a Nuclide's start: \(start?.helionToken.text ?? "nil") \(start?.preonToken.text ?? "")")
        var instants: [Double] = [a, first, 946_684_800, 2_886_085_800, clock.tMin, clock.tMin + 3 * 86_400, clock.tMax - 3 * 86_400, clock.tMax]
        var seed: UInt64 = 0x2545_F491_4F6C_DD1D
        for _ in 0..<300 {
            seed = seed &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            instants.append(clock.tMin + Double(seed >> 11) / Double(1 << 53) * (clock.tMax - clock.tMin))
        }
        var wrong: [String] = []
        for t in instants {
            guard let s = HelionArcSnapshot(at: t), let c = Notation.standard.clock(at: t), let preon = clock.level(at: t, 8),
                  let journal = Journal.reading(at: t, unit: 5)?.tokens else {
                wrong.append("\(t): no reading")
                continue
            }
            if [s.helionToken.text, s.preonToken.text] != journal.prefix(2).map(\.text) { wrong.append("\(t): labels \(s.helionToken.text) \(s.preonToken.text)") }
            if s.helion != c.eta || s.preon != c.iota { wrong.append("\(t): counts \(s.helion) \(s.preon) vs \(c.eta) \(c.iota)") }
            // the dot stands in the middle of the Preon's sixteenth the moment is in
            if abs(s.phase - preon.phase) > 0.5 / Double(HelionArcSnapshot.steps) + 1e-6 { wrong.append("\(t): dot \(s.phase) vs phase \(preon.phase)") }
        }
        check(wrong.isEmpty, "Helion Arc readings: \(wrong.prefix(4))")

        // the lens: 36 Preons a Helion, the running one drawn 7 times as long; its stretch always holds the moment's
        // true place on the Helion
        check(clock.levelInfo(6).factor * clock.levelInfo(7).factor == G.preons, "36 Preons a Helion")
        check(G.window(preon: 0).lowerBound == 0 && abs(G.window(preon: G.preons - 1).upperBound - 1) < 1e-12, "the lens spans the arc's ends")
        check(abs(G.window - 1.0 / 6) < 1e-12 && abs(G.amplitude - .pi / 12) < 1e-12, "the wave takes a sixth of the arc: \(G.window)")
        var lens: [String] = []
        for preon in 0..<G.preons {
            let w = G.window(preon: preon)
            if abs(w.upperBound - w.lowerBound - G.window) > 1e-12 { lens.append("\(preon): width") }
            if preon > 0 && abs(w.lowerBound - G.window(preon: preon - 1).lowerBound - (1 - G.window) / Double(G.preons - 1)) > 1e-12 {
                lens.append("\(preon): the lens moves on by one Preon's share of the rest")
            }
            for k in 0...16 {
                let p = Double(k) / 16
                let truth = (Double(preon) + p) / Double(G.preons)
                if truth < w.lowerBound - 1e-12 || truth > w.upperBound + 1e-12 { lens.append("\(preon) \(p): true place \(truth) off \(w)") }
                if k > 0 && G.position(preon: preon, phase: p) <= G.position(preon: preon, phase: Double(k - 1) / 16) { lens.append("\(preon) \(p): not forward") }
            }
            if G.position(preon: preon, phase: 0) != w.lowerBound || abs(G.position(preon: preon, phase: 1) - w.upperBound) > 1e-12 {
                lens.append("\(preon): the Preon's ends are the lens's")
            }
        }
        check(lens.isEmpty, "the lens: \(lens.prefix(4))")

        // the drawing in each family's frame
        func near(_ p: CGPoint, _ q: CGPoint, _ eps: Double = 1e-9) -> Bool { hypot(p.x - q.x, p.y - q.y) < eps }
        for (w, h) in [(160.0, 72.0), (126.0, 126.0), (306.0, 126.0), (332.0, 138.0)] {
            let g = HelionArcGeometry(width: w, height: h)
            let name = "\(Int(w))×\(Int(h))"
            let fitsW = abs(G.widthInRadii * g.r - w) < 1e-9, fitsH = abs(G.heightInRadii * g.r - h) < 1e-9
            check((fitsW || fitsH) && G.widthInRadii * g.r <= w + 1e-9 && G.heightInRadii * g.r <= h + 1e-9, "\(name): the drawing fits")
            check(near(g.arc(0).point, CGPoint(x: g.cx - 2 * g.r, y: g.cy)) && near(g.arc(0.5).point, CGPoint(x: g.cx, y: g.cy))
                  && near(g.arc(1).point, CGPoint(x: g.cx + 2 * g.r, y: g.cy)), "\(name): the half-arcs meet on the axis")
            var shape: [String] = []
            for i in 1..<100 where i != 50 {
                let f = Double(i) / 100
                let q = g.arc(f)
                // the first half-arc below the axis (descending), the second above (ascending)
                if f < 0.5 ? q.point.y <= g.cy : q.point.y >= g.cy { shape.append("\(f) on the wrong side of the axis") }
                // the wave's first half bulges to the right of the way the arc runs
                let ahead = g.arc(f + 1e-6).point
                let run = CGVector(dx: ahead.x - q.point.x, dy: ahead.y - q.point.y)
                if abs(-run.dy * q.side.dx + run.dx * q.side.dy - hypot(run.dx, run.dy)) > 1e-6 { shape.append("\(f): side") }
            }
            var waves: [String] = []
            for preon in 0..<G.preons {
                let lens = G.window(preon: preon)
                // the wave starts and ends on the arc at the Preon's stretch, and crosses it halfway
                if !near(g.wave(preon: preon, phase: 0), g.arc(lens.lowerBound).point, 1e-6)
                    || !near(g.wave(preon: preon, phase: 1), g.arc(lens.upperBound).point, 1e-6)
                    || !near(g.wave(preon: preon, phase: 0.5), g.arc((lens.lowerBound + lens.upperBound) / 2).point, 1e-6) {
                    waves.append("\(preon): ends")
                }
                // its first half a half-arc on the right of the way, its second on the left, `amplitude` radii high
                for (p, sign) in [(0.25, 1.0), (0.75, -1.0)] {
                    let q = g.arc(lens.lowerBound + p * G.window)
                    let d = g.wave(preon: preon, phase: p)
                    let lift = (d.x - q.point.x) * q.side.dx + (d.y - q.point.y) * q.side.dy
                    if abs(lift - sign * G.amplitude * g.r) > 1e-6 { waves.append("\(preon) \(p): lift \(lift)") }
                }
                // the drawn wave ends where the dot stands
                for step in [0, 7, 15] {
                    let p = (Double(step) + 0.5) / 16
                    if !near(g.wave(preon: preon, from: 0, to: p).last!, g.wave(preon: preon, phase: p)) { waves.append("\(preon) \(step): dot") }
                }
                // nothing leaves the frame, and the counts stay clear of the arc and of the wave wherever it rides
                let points = g.arc(from: 0, to: 1) + g.wave(preon: preon, from: 0, to: 1)
                if points.contains(where: { $0.x < 0 || $0.x > w || $0.y < 0 || $0.y > h }) { waves.append("\(preon): leaves the frame") }
                for first in [true, false] {
                    let rect = g.labelRect(first: first, reach: g.cy)
                    if rect.minX < -1e-9 || rect.maxX > w + 1e-9 || rect.minY < -1e-9 || rect.maxY > h + 1e-9 { waves.append("label leaves the frame") }
                    if points.contains(where: { rect.insetBy(dx: -1, dy: -1).contains($0) }) { waves.append("\(preon): the \(first ? "first" : "second") count under a line") }
                }
            }
            check(shape.isEmpty && waves.isEmpty, "\(name): \((shape + waves).prefix(4))")
            let label = g.labelRect(first: true, reach: g.cy)
            check(label.width > g.r && label.height > 0.8 * g.r, "\(name): room for a count: \(label)")
        }

        // a timeline: sixteen entries a Preon, each Preon start among them, the budget filled
        let times = EntrySchedule.times(from: a, changes: HelionArcSnapshot.changes)
        check(times.count == EntrySchedule.maxEntries && times.first == a, "a full timeline from now: \(times.count)")
        if let last = times.last {
            var boundaries: [Double] = []
            var t = clock.level(at: a, 8)!.end
            while t <= last {
                boundaries.append(t)
                t = clock.level(at: t + WidgetChange.settle, 8)!.end
            }
            check(boundaries.allSatisfy { b in times.contains { abs($0 - b) < 0.01 } }, "an entry at every Preon start")
            let preonLength = clock.level(at: a, 8)!.duration
            let gaps = zip(times.dropFirst(), times.dropFirst(2)).map { $1 - $0 }
            check(gaps.allSatisfy { abs($0 - preonLength / 16) < 0.5 }, "entries a sixteenth of a Preon apart: \(gaps.min() ?? 0) … \(gaps.max() ?? 0)")
            check(boundaries.count >= 9 && last - a < 86_400, "150 entries last about 9ι: \(boundaries.count) Preon starts, \(Int(last - a)) s")
        }
    }
}
