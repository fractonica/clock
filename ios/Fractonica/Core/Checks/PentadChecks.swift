import FractonicaKit
import Foundation

// The Pentads as the app and widgets read them (Shared/Pentads.swift, SPEC §7.5): the cached lookup against the engine,
// the next Pentad, and the plain text that leads a reading with its Pentad (SPEC §15.3).

func pentadChecks() {
    let clock = FractonicaClock.shared
    let helion = clock.levelInfo(6).meanSeconds
    let a = 1_791_460_800.0 // SPEC vector A: Pentad II (its 2nd Helion) of sync 4820
    let p = Pentads.at(a)
    check(p?.sync == 4820 && p?.index == 1 && p?.helion == 2 && p?.helions == 5,
          "vector A is Pentad II, 2nd Helion, sync 4820 (\(String(describing: p)))")
    check(Pentads.index(at: clock.tMax + 1) == nil && Pentads.at(.nan) == nil, "no Pentad outside the catalogue")

    // the cache answers exactly what the engine does, whatever order the times come in
    var t = a - 2 * 86_400
    var mismatches = 0
    var indices = Set<Int>()
    while t < a + 6 * 86_400 {
        let cached = Pentads.at(t), direct = clock.pentad(at: t)
        if cached != direct { mismatches += 1 }
        if let i = cached?.index { indices.insert(i) }
        // an unrelated moment in between, which a single-entry cache would thrash on
        _ = Pentads.at(t - 1_000_000)
        t += 997
    }
    check(mismatches == 0, "the cached Pentad is the engine's (\(mismatches) mismatches)")
    check(indices == [0, 1, 2, 3], "eight days pass through every Pentad")

    // the next Pentad starts where the running one ends, one index on
    if let p, let next = Pentads.next(after: a) {
        check(next.index == 2 && next.start == p.end, "after Pentad II comes Pentad III at its end")
        check(Pentads.at(next.start + 1)?.index == 2, "Pentad III runs from there")
        check(Pentads.change(after: a) == p.end, "the Pentad at vector A changes at its end")
        check(abs((p.end - p.start) - 5 * helion) < 60, "a Pentad lasts five Helions")
    }
    // the Hypopentad: four Helions, and Pentad I after it
    var h = a
    while let q = Pentads.at(h), q.index != 3 { h = q.end + 1 }
    if let hypo = Pentads.at(h) {
        check(hypo.isHypopentad && hypo.helions == 4, "the Hypopentad has four Helions")
        check(abs((hypo.end - hypo.start) - 4 * helion) < 60, "the Hypopentad lasts four Helions")
        check(Pentads.next(after: h)?.index == 0, "Pentad I follows the Hypopentad")
        // three Pentads and the Hypopentad make the sync: four days, a few seconds short
        if let first = Pentads.at(hypo.end + 1), let previous = Pentads.at(hypo.start - 15 * helion + 60) {
            check(previous.index == 0, "fifteen Helions before the Hypopentad is Pentad I")
            let days = (first.start - previous.start) / 86_400
            check(abs(days - 4) < 0.001, "a sync of Pentads lasts four days, a few seconds short (\(days))")
        }
    }
    check(Pentads.dayOffset(1) == 0.25 && Pentads.dayOffset(3) == 0.75 && Pentads.solarDay == 4.75,
          "each Pentad starts ¼η later in the day")
    check(Pentads.helions.reduce(0, +) == 19, "the Pentads share the sync's 19 Helions")

    // words
    check(PentadWords.name(1) == "Pentad II" && PentadWords.name(3) == "Hypopentad", "names")
    check(PentadWords.name(2, .ascii) == "P3" && PentadWords.name(3, .ascii) == "H", "ASCII names")
    check(PentadWords.lead("δ#3 ε#2 5η 5ι", index: 1) == "Pentad II · δ#3 ε#2 5η 5ι", "a reading led by its Pentad")
    check(PentadWords.lead("δ#3 ε#2 5η 5ι", index: 3, form: .ascii) == "H · δ#3 ε#2 5η 5ι", "led in ASCII")
    check(PentadWords.lead("δ#3", index: nil) == "δ#3", "no Pentad, the reading alone")
    check(PentadWords.lead("", index: 0) == "Pentad I", "no reading, the Pentad alone")
    check(PentadWords.lead("x", at: a) == "Pentad II · x", "led by the Pentad at a time")
    if let p {
        check(PentadWords.full(p) == "Pentad II, 2nd Helion of 5", "the Helion's place: \(PentadWords.full(p))")
    }
    for text in [PentadWords.lead("x", at: a), PentadWords.lead("x", at: a, form: .ascii)] {
        check(!text.contains("\u{2B20}") && !text.contains("\u{25FB}"), "plain text never needs Apple Symbols: \(text)")
    }
    let words = Wording(pure: true, zone: "UTC")
    check(words.led("δ#3", at: a) == "Pentad II · δ#3" && words.pentadName(a, form: .ascii) == "P2", "Wording leads too")
}
