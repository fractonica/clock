import FractonicaKit
import Foundation

// Up next's Pentads (SPEC §7.5): every listed turnover carries the Pentad it lands in, read just after it, and a row
// shows it only when it is another Pentad than the running one.

func upNextPentadChecks() {
    let clock = FractonicaClock.shared
    let a = 1_791_460_800.0 // vector A: Pentad II of sync 4820
    let turnovers = Turnovers.upcoming(clock, after: a, importance: Importance.byID("η"), maxLevel: 9, count: 12)
    let rows = Turnovers.byDay(turnovers, earth: EarthFormatter(zone: "UTC"), ref: a)
    check(rows.count == turnovers.count && rows.allSatisfy { $0.pentad == Pentads.at($0.turnover.time + 0.001) },
          "every Earth row carries the Pentad its turnover lands in")
    let pure = Turnovers.byNuclide(turnovers) { LadderPureText().turnoverInfo(time: $0.time, top: $0.top) }
    check(pure.allSatisfy { $0.pentad != nil }, "every pure row carries its Pentad")

    // twelve Helion turnovers from vector A run into Pentad III: shown there, not on the rows still in Pentad II
    let current = Pentads.at(a)?.start
    let shown = rows.map { Turnovers.shownPentad($0.pentad, current: current) }
    check(shown.contains(nil) && shown.contains(2), "rows in the running Pentad show none, the later ones Pentad III (\(shown))")
    check(zip(rows, shown).allSatisfy { row, s in (s == nil) == (row.pentad?.start == current) },
          "a row shows its Pentad exactly when it is not the running one")

    // a turnover on a Pentad's edge belongs to the Pentad that begins there
    if let p = Pentads.at(a) {
        check(Turnovers.pentad(at: p.end)?.index == 2, "a turnover at the end of Pentad II lands in Pentad III")
        check(Turnovers.pentad(at: p.start)?.index == 1, "a turnover at its start lands in Pentad II")
    }
    // the same index in the next sync is another Pentad
    if let p = Pentads.at(a) {
        let later = Pentads.at(a + 4 * 86_400)
        check(later?.index == 1 && Turnovers.shownPentad(later, current: p.start) == 1, "Pentad II of the next sync is another Pentad")
    }
    check(Turnovers.shownPentad(nil, current: 0) == nil, "no Pentad past the catalogue")
}
