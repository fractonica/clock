import FractonicaKit
import Foundation

// The stack's zoom: entries by Helion (the journal's day), and pinched out, blocks of whole periods — Deltas, then
// Gammas, then Betas — each with its entry count, a few emoji and pictures of its entries. Pure logic (grouping, the
// pinch's steps, the blocks' words), checked by Timeline/Checks.

/// How far the stack is zoomed out: the period its rows stand for.
enum JournalZoom: String, CaseIterable, Identifiable, Sendable, Comparable {
    case helion, delta, gamma, beta

    var id: String { rawValue }

    /// The engine level the rows group by.
    var level: Int {
        switch self {
        case .helion: 6
        case .delta: 3
        case .gamma: 2
        case .beta: 1
        }
    }

    /// 0 for the finest (Helions) … 3 for the coarsest (Betas).
    var rank: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    /// One step out (bigger periods), or nil at Betas.
    var coarser: JournalZoom? { rank + 1 < Self.allCases.count ? Self.allCases[rank + 1] : nil }

    /// One step in (smaller periods), or nil at Helions.
    var finer: JournalZoom? { rank > 0 ? Self.allCases[rank - 1] : nil }

    /// "Helions", "Deltas" …: the same words in both modes (they are Fractonica's own).
    var title: String {
        switch self {
        case .helion: "Helions"
        case .delta: "Deltas"
        case .gamma: "Gammas"
        case .beta: "Betas"
        }
    }

    /// "η", "δ" …
    var symbol: String { Fractonica.periodName(level).text }

    /// The level whose periods head the blocks' sections (a Delta's Gamma …); nil for the Helion stack, whose days
    /// carry their own headers.
    var sectionLevel: Int? { self == .helion ? nil : level - 1 }

    static func < (a: JournalZoom, b: JournalZoom) -> Bool { a.rank < b.rank }

    /// A launch argument's zoom: "helion" / "eta" / "η" / "day", "delta" / "δ", "gamma" / "γ", "beta" / "β".
    init?(launch text: String) {
        switch text.lowercased() {
        case "helion", "helions", "eta", "η", "day", "days", "stack": self = .helion
        case "delta", "deltas", "δ": self = .delta
        case "gamma", "gammas", "γ": self = .gamma
        case "beta", "betas", "β": self = .beta
        default: return nil
        }
    }
}

/// A block of the zoomed-out stack: one period's entries (newest first) and what its header shows of them.
struct JournalPeriod: Identifiable, Hashable, Sendable {
    /// "p<level>.<cycle>", or "out<n>" for moments outside the catalogue.
    let id: String
    let level: Int
    /// The period's global cycle index (nil outside the catalogue).
    let cycle: Int64?
    /// Its start and end (the records' span when outside the catalogue).
    let start: Double
    let end: Double
    /// Record ids, newest first.
    var ids: [String]
    /// The entries' emoji, most used first (ties: newest first), at most `JournalPeriods.emojiLimit`.
    var emojis: [String] = []
    /// How many different emoji the entries use (more than `emojis` shows).
    var emojiCount = 0
    /// Photos and video posters to show, newest first, at most `JournalPeriods.mediaLimit`.
    var media: [BlobRef] = []
    /// How many photos and videos the entries hold in all.
    var mediaCount = 0
    /// The record times, newest first (for the density strip).
    var times: [Double] = []

    var count: Int { ids.count }

    /// The period holds instant t.
    func contains(_ t: Double) -> Bool {
        cycle == nil ? t >= start && t <= end : t >= start && t < end
    }

    /// The id a period of `level` and `cycle` gets: the stack finds a period again by it.
    static func id(level: Int, cycle: Int64) -> String { "p\(level).\(cycle)" }
}

/// A section of blocks under their parent period (Deltas under their Gamma …).
struct JournalPeriodSection: Identifiable, Hashable, Sendable {
    let id: String
    let level: Int
    let cycle: Int64?
    let start: Double
    let end: Double
    var periods: [JournalPeriod]

    var count: Int { periods.reduce(0) { $0 + $1.count } }
}

enum JournalPeriods {
    static let emojiLimit = 6
    static let mediaLimit = 4

    /// Groups records (newest first) into periods of `level`, keeping their order. Records outside the catalogue share
    /// one period per run, as the Helion days do.
    static func group(_ records: [HubRecord], level: Int, clock: FractonicaClock = .shared) -> [JournalPeriod] {
        var periods: [JournalPeriod] = []
        var current: JournalPeriod?
        var tally = Tally()
        func close() {
            guard var p = current else { return }
            tally.finish(into: &p)
            periods.append(p)
        }
        for record in records {
            if let p = current, p.cycle == nil ? !clock.inRange(record.time) : p.contains(record.time) {
                current?.ids.append(record.id)
                current?.times.append(record.time)
                tally.add(record)
                continue
            }
            close()
            tally = Tally()
            if let reading = clock.level(at: record.time, level) {
                current = JournalPeriod(id: JournalPeriod.id(level: level, cycle: reading.cycle), level: level, cycle: reading.cycle,
                                        start: reading.start, end: reading.end, ids: [record.id], times: [record.time])
            } else {
                current = JournalPeriod(id: "out\(periods.count)", level: level, cycle: nil, start: record.time, end: record.time,
                                        ids: [record.id], times: [record.time])
            }
            tally.add(record)
        }
        close()
        // a run outside the catalogue spans its records
        return periods.map { p in
            guard p.cycle == nil, let lo = p.times.min(), let hi = p.times.max() else { return p }
            return JournalPeriod(id: p.id, level: p.level, cycle: nil, start: lo, end: hi, ids: p.ids, emojis: p.emojis,
                                 emojiCount: p.emojiCount, media: p.media, mediaCount: p.mediaCount, times: p.times)
        }
    }

    /// The emoji and pictures of a period's records, gathered as they are grouped.
    private struct Tally {
        var counts: [String: Int] = [:]
        var order: [String] = []
        var media: [BlobRef] = []
        var seen: Set<String> = []
        var mediaCount = 0

        mutating func add(_ record: HubRecord) {
            let emoji = record.entry?.emoji ?? (record.kind == JournalEntry.kind ? nil : record.generic.emoji)
            if let emoji, !emoji.isEmpty {
                if counts[emoji] == nil { order.append(emoji) }
                counts[emoji, default: 0] += 1
            }
            for blob in record.mediaBlobs where blob.role == "photo" || blob.role == "video" {
                mediaCount += 1
                if media.count < JournalPeriods.mediaLimit, seen.insert(blob.poster ?? blob.hash).inserted { media.append(blob) }
            }
        }

        func finish(into p: inout JournalPeriod) {
            // most used first; among equals the one met first (the newest)
            let rank = Dictionary(uniqueKeysWithValues: order.enumerated().map { ($1, $0) })
            p.emojis = Array(order.sorted { a, b in
                let ca = counts[a] ?? 0, cb = counts[b] ?? 0
                return ca != cb ? ca > cb : rank[a, default: 0] < rank[b, default: 0]
            }.prefix(JournalPeriods.emojiLimit))
            p.emojiCount = order.count
            p.media = media
            p.mediaCount = mediaCount
        }
    }

    /// The periods under their parents of `level` (a Delta's Gamma …), in order. A period belongs to the parent that
    /// holds its middle (so a float hair at a shared boundary never misfiles it).
    static func sections(_ periods: [JournalPeriod], level: Int, clock: FractonicaClock = .shared) -> [JournalPeriodSection] {
        var sections: [JournalPeriodSection] = []
        for p in periods {
            let mid = (p.start + p.end) / 2
            if let last = sections.last, last.cycle == nil ? p.cycle == nil : (mid >= last.start && mid < last.end) {
                sections[sections.count - 1].periods.append(p)
                continue
            }
            if p.cycle != nil, let r = clock.level(at: mid, level) {
                sections.append(JournalPeriodSection(id: "s" + JournalPeriod.id(level: level, cycle: r.cycle), level: level, cycle: r.cycle,
                                                     start: r.start, end: r.end, periods: [p]))
            } else {
                sections.append(JournalPeriodSection(id: "sout\(sections.count)", level: level, cycle: nil, start: p.start, end: p.end, periods: [p]))
            }
        }
        return sections
    }

    /// The period (by index) that holds t, else the nearest one by time; nil for an empty list.
    static func index(of t: Double, in periods: [JournalPeriod]) -> Int? {
        guard !periods.isEmpty else { return nil }
        if let i = periods.firstIndex(where: { $0.contains(t) }) { return i }
        var best = 0
        var distance = Double.infinity
        for (i, p) in periods.enumerated() {
            let d = t < p.start ? p.start - t : t > p.end ? t - p.end : 0
            if d < distance {
                distance = d
                best = i
            }
        }
        return best
    }

    // MARK: Words

    /// "Delta Trifracton": a period's name in Fractonica words (the same in both modes).
    static func name(level: Int, cycle: Int64?, notation: Notation = .standard) -> String {
        guard let cycle else { return "Outside the catalogue" }
        return notation.cycleName(level: level, cycle: cycle)
    }

    /// Where a period lies, in Earth time (not for pure mode): "8 Aug – 24 Oct 2026", "12 Dec 2025 – 3 Mar 2026" for a
    /// Delta or a Gamma, "Mar 2019 – Jan 2033" for a Beta. The end is exclusive: the last day shown is the one before it.
    static func earthSpan(start: Double, end: Double, level: Int, earth: EarthFormatter) -> String {
        let a = earth.parts(start)
        let b = earth.parts(max(start, end - 1))
        let months = EarthTime.monthsShort
        if level <= 1 {
            return a.year == b.year && a.month == b.month
                ? "\(months[a.month - 1]) \(a.year)"
                : "\(months[a.month - 1]) \(a.year) – \(months[b.month - 1]) \(b.year)"
        }
        if a.year == b.year {
            if a.month == b.month, a.day == b.day { return "\(a.day) \(months[a.month - 1]) \(a.year)" }
            return "\(a.day) \(months[a.month - 1]) – \(b.day) \(months[b.month - 1]) \(b.year)"
        }
        return "\(a.day) \(months[a.month - 1]) \(a.year) – \(b.day) \(months[b.month - 1]) \(b.year)"
    }

    /// Where a period lies in pure mode: the letter address of its parents ("α#6 β#4 γ#9" for a Delta, "α#6" for a
    /// Beta); empty outside the catalogue.
    static func address(level: Int, at t: Double, notation: Notation = .standard) -> String {
        guard level > 0, let d = notation.date(at: t) else { return "" }
        let ordinals = [d.alpha, d.beta, d.gamma, d.delta]
        return (0..<min(level, 4)).map { "\(Fractonica.periodName($0).text)#\(ordinals[$0])" }.joined(separator: " ")
    }

    /// "1 entry", "12 entries".
    static func entries(_ n: Int) -> String { n == 1 ? "1 entry" : "\(n) entries" }
}

/// The pinch that zooms the stack: steps out (to bigger periods) once the fingers close to `outward` of where the last
/// step happened, in once they open to `inward`, so one long pinch can pass several levels and a small wobble none.
struct JournalPinch: Sendable {
    static let outward = 0.66
    static let inward = 1.5

    /// The magnification at the last step (or the start).
    private(set) var base = 1.0

    /// The step a magnification makes, if any: +1 out (coarser), −1 in (finer), 0 none. A step re-bases the pinch.
    mutating func step(_ magnification: Double) -> Int {
        let ratio = magnification / base
        if ratio <= Self.outward {
            base = magnification
            return 1
        }
        if ratio >= Self.inward {
            base = magnification
            return -1
        }
        return 0
    }

    /// The live scale the content follows the fingers with between steps: 1 at the last step, damped and clamped so
    /// the page leans into the pinch without swimming.
    func lean(_ magnification: Double) -> Double {
        let ratio = magnification / base
        let damped = pow(ratio, 0.45)
        return min(1.08, max(0.9, damped))
    }

    /// The zoom a step leads to from `zoom`, nil when there is no further level that way.
    static func apply(_ step: Int, to zoom: JournalZoom) -> JournalZoom? {
        step > 0 ? zoom.coarser : step < 0 ? zoom.finer : nil
    }
}
