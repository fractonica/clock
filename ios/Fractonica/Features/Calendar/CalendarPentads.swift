import FractonicaKit
import Foundation

/// The Pentads (SPEC §7.5) laid out like weeks: where Helions are laid out like days of a calendar, they group into
/// Pentad rows (five Helions each, the Hypopentad four, so its row is visibly shorter), and where civil days are laid
/// out, each day carries the Pentads that begin on it. Pure logic, built once per page or day (never per tick), checked
/// by Checks/CalendarChecks.swift against the engine's `pentad(at:)`.
enum CalPentads {
    /// The global index of the sync anchor's Helion, A · P(6) / 4 (SPEC §7.1, §7.5): Pentads count whole Helions from it.
    static func anchorHelion(_ clock: FractonicaClock) -> Int64 {
        Int64(20 * clock.levelInfo(6).prefix / 4)
    }

    /// The anchor's Helion on the shared clock.
    static let anchor = anchorHelion(.shared)

    /// Where a Helion (global η index) stands among the Pentads: its sync, its Pentad (0 … 3, 3 the Hypopentad) and its
    /// place in it (1 … 5, 1 … 4 in the Hypopentad).
    struct Place: Hashable, Sendable {
        let sync: Int
        let index: Int
        let helion: Int
    }

    static func place(ofHelion h: Int64, anchor: Int64) -> Place {
        let k = h - anchor
        let sync = k >= 0 ? k / 19 : -((-k + 18) / 19)
        let within = Int(k - sync * 19)
        let index = min(3, within / 5)
        return Place(sync: Int(sync), index: index, helion: within - 5 * index + 1)
    }

    /// The first Helion (global η index) of Pentad `index` of sync `sync`.
    static func firstHelion(sync: Int, index: Int, anchor: Int64) -> Int64 {
        anchor + 19 * Int64(sync) + 5 * Int64(index)
    }

    /// One Pentad as a row of Helion cells: the whole Pentad (five cells, four for the Hypopentad), with the cells of
    /// the window it was laid out for marked (a row at the window's edge is partial: the cells outside it are only shown).
    struct Row: Identifiable, Hashable, Sendable {
        let sync: Int
        /// 0 … 3; 3 is the Hypopentad.
        let index: Int
        /// The Pentad's first Helion (global η index).
        let first: Int64
        /// 5, or 4 for the Hypopentad.
        let count: Int
        /// The cells inside the window, as places 0 ..< count.
        let inside: Range<Int>

        var id: Int64 { first }
        var isHypopentad: Bool { index == 3 }
        /// The global η index of each cell.
        var helions: [Int64] { (0..<count).map { first + Int64($0) } }
        /// The whole Pentad lies inside the window.
        var isWhole: Bool { inside == 0..<count }
    }

    /// The Pentads covering the window of Helions [first, first + count), in order: one row each, the first and last
    /// partial when the window starts or ends inside a Pentad.
    static func rows(firstHelion first: Int64, count: Int, anchor: Int64) -> [Row] {
        guard count > 0 else { return [] }
        let last = first + Int64(count) // exclusive
        var rows: [Row] = []
        let p = place(ofHelion: first, anchor: anchor)
        var sync = p.sync, index = p.index
        while true {
            let start = firstHelion(sync: sync, index: index, anchor: anchor)
            guard start < last else { break }
            let size = index == 3 ? 4 : 5
            let lo = Int(max(0, first - start)), hi = Int(min(Int64(size), last - start))
            rows.append(Row(sync: sync, index: index, first: start, count: size, inside: lo..<hi))
            if index == 3 { sync += 1; index = 0 } else { index += 1 }
        }
        return rows
    }

    /// The Pentads that begin inside the window of Helions [first, first + count): how many Helions into the window
    /// each begins, and which it is (for the bands of a cell).
    static func starts(firstHelion first: Int64, count: Int, anchor: Int64) -> [(offset: Int, index: Int)] {
        rows(firstHelion: first, count: count, anchor: anchor).compactMap { row in
            row.first >= first ? (Int(row.first - first), row.index) : nil
        }
    }

    /// A Pentad in time: its sync, index, start and end (cut at the catalogue's edges).
    struct Span: Hashable, Sendable {
        let sync: Int
        let index: Int
        let start: Double
        let end: Double
    }

    /// The Pentad that runs through most of [t0, t1) (a day's "weekday"); nil outside the catalogue.
    static func main(_ clock: FractonicaClock, from t0: Double, to t1: Double) -> Span? {
        spans(clock, from: t0, to: t1).max { a, b in
            min(a.end, t1) - max(a.start, t0) < min(b.end, t1) - max(b.start, t0)
        }
    }

    /// The Pentads overlapping [t0, t1) inside the catalogue, in order (the month's band, a day's Pentads).
    static func spans(_ clock: FractonicaClock, from t0: Double, to t1: Double) -> [Span] {
        let lo = max(t0, clock.tMin), hi = min(t1, clock.tMax)
        guard hi > lo, let p = clock.pentad(at: lo) else { return [] }
        var out = [Span(sync: p.sync, index: p.index, start: p.start, end: p.end)]
        var sync = p.sync, index = p.index
        while let last = out.last, last.end < hi, out.count < 4000 {
            if index == 3 { sync += 1; index = 0 } else { index += 1 }
            guard let s = clock.pentad(sync: sync, index: index) else { break }
            out.append(Span(sync: sync, index: index, start: s.start, end: s.end))
        }
        return out
    }
}
