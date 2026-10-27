import FractonicaKit
import Foundation

// The calendar's Pentads (CalendarPentads.swift, SPEC §7.5): Helions grouped into Pentad rows like days into weeks
// (the Hypopentad's short row, partial rows at a window's edges), the Pentads that begin in a cell, a month's Pentad
// band and the Pentads each civil day carries — all against the engine's `pentad(at:)`.

func pentadCalendarChecks() {
    let clock = FractonicaClock.shared
    let anchor = CalPentads.anchorHelion(clock)
    let a = 1_791_460_800.0 // SPEC vector A: Pentad II (its 2nd Helion) of sync 4820

    // a Helion's place agrees with the engine everywhere, before the anchor too
    var bad = 0
    var t = clock.tMin + 1000
    while t < clock.tMax {
        if let h = clock.level(at: t, 6), let p = clock.pentad(at: t) {
            let place = CalPentads.place(ofHelion: h.cycle, anchor: anchor)
            if place.sync != p.sync || place.index != p.index || place.helion != p.helion { bad += 1 }
        }
        t += 9_876_543.21
    }
    check(bad == 0, "a Helion's Pentad is the engine's across the catalogue (\(bad) differ)")
    if let h = clock.level(at: a, 6) {
        let place = CalPentads.place(ofHelion: h.cycle, anchor: anchor)
        check(place == CalPentads.Place(sync: 4820, index: 1, helion: 2), "vector A: Pentad II, 2nd Helion, sync 4820")
        // the anchor eclipse starts Pentad I of sync 0, and the Helion before it is the Hypopentad's last
        check(CalPentads.place(ofHelion: anchor, anchor: anchor) == CalPentads.Place(sync: 0, index: 0, helion: 1), "the anchor's Helion")
        check(CalPentads.place(ofHelion: anchor - 1, anchor: anchor) == CalPentads.Place(sync: -1, index: 3, helion: 4),
              "before the anchor: the last Helion of sync −1's Hypopentad")
    }

    // rows: a whole sync is four rows of 5, 5, 5 and 4 Helions
    let sync = CalPentads.firstHelion(sync: 4820, index: 0, anchor: anchor)
    let whole = CalPentads.rows(firstHelion: sync, count: 19, anchor: anchor)
    check(whole.map(\.count) == [5, 5, 5, 4] && whole.map(\.index) == [0, 1, 2, 3], "a sync is Pentad I, II, III and the Hypopentad")
    check(whole.allSatisfy(\.isWhole) && whole.last?.isHypopentad == true, "every row whole, the Hypopentad's a Helion shorter")
    check(zip(whole, whole.dropFirst()).allSatisfy { $0.first + Int64($0.count) == $1.first }, "the rows follow on")
    // a window inside a Pentad, and across a sync's end: partial rows at the edges
    let mid = CalPentads.rows(firstHelion: sync + 6, count: 2, anchor: anchor)
    check(mid.count == 1 && mid[0].index == 1 && mid[0].inside == 1..<3, "two Helions inside Pentad II: one partial row")
    let across = CalPentads.rows(firstHelion: sync + 17, count: 5, anchor: anchor)
    check(across.map(\.index) == [3, 0] && across.map(\.sync) == [4820, 4821], "across a sync's end: the Hypopentad, then Pentad I")
    check(across[0].inside == 2..<4 && across[1].inside == 0..<3, "the window's Helions in each (\(across.map(\.inside)))")
    check(CalPentads.rows(firstHelion: sync, count: 0, anchor: anchor).isEmpty, "an empty window has no rows")

    // a pure month cell: 11 Helions, the Pentads that begin in it and the rows it touches
    var cellsWrong: [Int64] = []
    for z in Int64(0)..<Int64(60) {
        let first = (sync / 11 + z) * 11
        let rows = CalPentads.rows(firstHelion: first, count: 11, anchor: anchor)
        let covered = rows.reduce(0) { $0 + $1.inside.count }
        let starts = CalPentads.starts(firstHelion: first, count: 11, anchor: anchor)
        let expected = (0..<11).filter { CalPentads.place(ofHelion: first + Int64($0), anchor: anchor).helion == 1 }
        // 11 Helions touch three Pentads, or four when the Hypopentad lies inside
        if covered != 11 || starts.map(\.offset) != expected || !(3...4).contains(rows.count) { cellsWrong.append(first) }
    }
    check(cellsWrong.isEmpty, "every cell's Helions fall in exactly one row and its Pentad starts are first Helions (\(cellsWrong))")

    // spans in time: the month band and each day's Pentads
    let spans = CalPentads.spans(clock, from: a, to: a + 10 * 86_400)
    check(spans.first.map { $0.start <= a && $0.end > a && $0.index == 1 } == true, "the band begins with the Pentad running at its start")
    check(zip(spans, spans.dropFirst()).allSatisfy { $0.end == $1.start && $1.index == ($0.index + 1) % 4 }, "the Pentads follow on, I to the Hypopentad")
    check(spans.allSatisfy { clock.pentad(at: ($0.start + $0.end) / 2)?.index == $0.index }, "each span is the engine's Pentad")
    check(spans.count == 10 || spans.count == 11, "ten days hold about ten Pentads (\(spans.count))")
    let hypo = spans.first { $0.index == 3 }!, five = spans.first { $0.index == 0 }!
    check(hypo.end - hypo.start < five.end - five.start - 4 * 3600, "the Hypopentad is a Helion shorter")
    check(CalPentads.spans(clock, from: clock.tMax + 1, to: clock.tMax + 86_400).isEmpty, "no Pentads after the catalogue")
    let edge = CalPentads.spans(clock, from: clock.tMin - 86_400, to: clock.tMin + 86_400)
    check(edge.first?.start == clock.tMin, "the catalogue's first Pentad is cut at its edge")
    if let main = CalPentads.main(clock, from: a - 12 * 3600, to: a + 12 * 3600) {
        check(main.index == 1, "the day around vector A is mostly Pentad II")
    }

    // the month grid: each day carries the Pentads that begin on it, every Pentad on exactly one day, in order
    let utc = TimeZone(identifier: "UTC")!
    let grid = CalMonthGrid(clock: clock, zone: utc, year: 2026, month: 10, weekStart: 1, bands: [.level(4), .pentad, .level(6)],
                            syncRange: CalMath.syncRange(clock))
    let carried = grid.days.flatMap(\.pentads)
    let inGrid = CalPentads.spans(clock, from: grid.start, to: grid.end).filter { $0.start >= grid.start }
    check(carried.map(\.start) == inGrid.map(\.start), "every Pentad starting in the six weeks is on one day (\(carried.count) of \(inGrid.count))")
    check(grid.days.allSatisfy { d in d.pentads.allSatisfy { $0.start >= d.start && $0.start < d.end } }, "each on its own day")
    check(grid.days.allSatisfy { $0.pentads.count <= 2 }, "a day carries at most two Pentads")
    check(grid.days.contains { $0.pentads.isEmpty } || grid.days.allSatisfy { $0.pentads.count == 1 }, "days without a Pentad start are possible")
    let band = grid.days[10].tracks.first { $0.band == .pentad }
    check(band != nil && band!.segments.allSatisfy { (0...3).contains($0.ordinal) }, "the Pentad band holds Pentads 0 … 3")
    check(CalendarBand(key: "pentad") == .pentad && CalendarBand.pentad.key == "pentad", "the Pentad band round-trips its key")
}
