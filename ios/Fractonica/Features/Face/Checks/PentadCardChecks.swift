import FractonicaKit
import Foundation

// The Pentad card (PentadCardModel): the rows in the time of day, the running Helion, the countdown to the next Pentad
// in both modes, and its change schedule (nothing the card shows changes between two redraws).

func pentadCardChecks() {
    // the rows: 5, 5, 5, 4 Helions, each ¼η later in the day; the Hypopentad ends on the fourth day's turn
    let rows = PentadCardModel.rows
    check(rows.map(\.cells) == [5, 5, 5, 4], "rows of 5, 5, 5 and 4 Helions")
    check(rows.map(\.offset) == [0, 0.25, 0.5, 0.75], "each row starts ¼η later in the day")
    check(rows.map(\.first) == [0, 5, 10, 15], "rows start at the sync's Helions 0, 5, 10, 15")
    check(rows[3].end == Pentads.solarDay, "the Hypopentad ends where the solar day turns (4¾η)")
    check(PentadCardModel.span == 5.5, "the widest row ends at 5½η")
    check(PentadCardModel.dayLines == [0, 4.75], "a solar day is 4¾η")
    // each Pentad starts a day after the one above, ¼η later: 5k Helions = k days + k/4 Helions
    for row in rows { check(abs(Double(row.first) - (Double(row.index) * Pentads.solarDay + row.offset)) < 1e-12, "row \(row.index) is a day on") }

    // vector A: Pentad II, its 2nd Helion, sync 4820
    guard let m = PentadCardModel.make(at: vectorA) else { return check(false, "a card at vector A") }
    check(m.sync == 4820 && m.index == 1 && m.helion == 2 && m.helions == 5 && m.cell == 6, "vector A: Pentad II, 2nd Helion, cell 6")
    check(m.nextIndex == 2, "Pentad III comes next")
    if let minor = Notation.standard.clock(at: vectorA) {
        check(m.preons == minor.iota && m.progress == Double(minor.iota) / 36, "the lit Helion shows its completed Preons")
    }
    check(PentadCardModel.make(at: clock.tMax + 10) == nil, "no card outside the catalogue")

    // countdowns: Earth in whole minutes (rounded up), pure in Preons; no Earth units in pure mode
    check(PentadCardModel.countdown(at: 0, to: 30, pure: false) == "in 1 min", "under a minute is 1 min")
    check(PentadCardModel.countdown(at: 0, to: 3600, pure: false) == "in 1 h", "an hour")
    check(PentadCardModel.countdown(at: 0, to: 3725, pure: false) == "in 1 h 03 min", "1 h 03 min (rounded up)")
    check(PentadCardModel.countdown(at: 10, to: 5, pure: false) == nil, "nothing after the start")
    if let text = PentadCardModel.countdown(at: vectorA, to: m.end, pure: true) {
        check(text.hasPrefix("in ") && text.contains("η") && !text.contains("h ") && !text.contains("min"),
              "pure countdown in Helions and Preons: \(text)")
    } else {
        check(false, "a pure countdown at vector A")
    }

    // the schedule: across a whole Pentad, the card never changes between two redraws, and redraws stay rare
    for isPure in [false, true] {
        var t = m.start + 1
        var redraws = 0
        var missed = 0
        while t < m.end + 600 {
            guard let next = PentadCardModel.change(after: t, pure: isPure) else { break }
            check(next > t, "the next change is ahead")
            // sample inside the interval: what the card shows must stay the same
            let a = PentadCardModel.make(at: t), b = PentadCardModel.make(at: next - 0.01)
            let ca = a.flatMap { PentadCardModel.countdown(at: t, to: $0.end, pure: isPure) }
            let cb = b.flatMap { PentadCardModel.countdown(at: next - 0.01, to: $0.end, pure: isPure) }
            if a != b || ca != cb { missed += 1 }
            t = next + 0.002
            redraws += 1
        }
        check(missed == 0, "\(isPure ? "pure" : "Earth"): no change is missed between redraws (\(missed))")
        // a Pentad is ~25 h: Earth redraws once a minute and a Preon (~1,700), pure once a Preon (180)
        check(redraws < (isPure ? 200 : 1_800), "\(isPure ? "pure" : "Earth"): \(redraws) redraws in a Pentad")
    }
    let spoken = m.spoken(at: vectorA, pure: true)
    check(spoken.hasPrefix("Pentad II, 2nd Helion of 5") && spoken.contains("Pentad III in "), "VoiceOver: \(spoken)")

    // the explainer: pure mode says it in Helions and solar days only
    let pureTexts = [PentadExplainerText.lead(pure: true), PentadExplainerText.fromSun(pure: true),
                     PentadExplainerText.fromHelion(pure: true), PentadExplainerText.weekday(pure: true)]
        + (0...4).map { PentadExplainerText.step($0, pure: true) }
        + PentadExplainerText.rows(pure: true).flatMap { [$0.helions, $0.length, $0.start] }
    for text in pureTexts {
        var earthly = ["hour", "second", "minute", "≈", "%", "24"].filter { text.contains($0) }
        if text.range(of: #"\d\s?h\b"#, options: .regularExpression) != nil { earthly.append("N h") }
        check(earthly.isEmpty, "pure explainer has no Earth units (\(earthly)): \(text)")
    }
    check(PentadExplainerText.lead(pure: true).contains("4¾η is a solar day"), "pure: 4¾η is a solar day")
    check(PentadExplainerText.rows(pure: false).map(\.length) == ["5η ≈ 25.3 h", "5η ≈ 25.3 h", "5η ≈ 25.3 h", "4η ≈ 20.2 h"],
          "Earth lengths of the Pentads")
    check(PentadExplainerText.rows(pure: true).map(\.start) == ["+0", "+¼η", "+½η", "+¾η"], "each starts ¼η later")
}
