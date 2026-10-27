import FractonicaKit
import Foundation

/// The journal's days: entries grouped by the Helion (η, level 6, about five hours) they fall in — the unit the
/// notation numbers "like the day of a month" (1η … 77η in its Nuclide), so a Helion reads as the journal's day:
/// "34η" over "ε#5 · Delta Trifracton End", the Earth date and hours under it. Records outside the catalogue share one
/// group. The days group under their Pentad (SPEC §7.5) as civil days under their week: the first day shown of each
/// Pentad carries its `band` (which of its five Helions, four in the Hypopentad, hold entries). Pure logic, checked by
/// Journal/Checks.
struct JournalDay: Identifiable, Hashable, Sendable {
    /// "h<cycle>", or "out" for moments outside the catalogue.
    let id: String
    /// The Helion's global cycle index.
    let cycle: Int64?
    /// The Helion's start and end (the records' span when outside the catalogue).
    let start: Double
    let end: Double
    /// Record ids, newest first.
    var ids: [String]
    /// The Pentad the Helion belongs to (nil outside the catalogue).
    var pentad: PentadReading? = nil
    /// On the first day shown of its Pentad (the newest): the Pentad's band, its Helions with entries.
    var band: JournalPentadBand? = nil

    /// The Helion's number in its Nuclide (1 … 77) and the Nuclide's in its Delta (1 … 5): "34η", "ε#5".
    func names(notation: Notation = .standard) -> (helion: String, nuclide: String, delta: String)? {
        guard cycle != nil, let clock = notation.clock(at: start + 1e-3) else { return nil }
        return ("\(clock.eta)η", "ε#\(clock.epsilon)", notation.majorText(at: start + 1e-3, level: 3))
    }
}

enum JournalDays {
    /// The Helion level.
    static let level = 6

    /// Groups records (newest first) by Helion, keeping their order.
    static func group(_ records: [HubRecord], clock: FractonicaClock = .shared) -> [JournalDay] {
        var days: [JournalDay] = []
        var current: JournalDay?
        for record in records {
            if var day = current, day.cycle == nil ? !clock.inRange(record.time) : (record.time >= day.start && record.time < day.end) {
                day.ids.append(record.id)
                current = day
                continue
            }
            if let current { days.append(current) }
            if let reading = clock.level(at: record.time, level) {
                current = JournalDay(id: "h\(reading.cycle)", cycle: reading.cycle, start: reading.start, end: reading.end, ids: [record.id])
            } else {
                current = JournalDay(id: "out\(days.count)", cycle: nil, start: record.time, end: record.time, ids: [record.id])
            }
        }
        if let current { days.append(current) }
        return bandsByPentad(days, clock: clock)
    }

    /// Each day's Pentad, and on the first day of each run of days in the same Pentad the run's band.
    static func bandsByPentad(_ days: [JournalDay], clock: FractonicaClock = .shared) -> [JournalDay] {
        var out = days
        for i in out.indices where out[i].cycle != nil {
            // the Helion's middle: its start can round onto the previous Helion
            out[i].pentad = Pentads.at((out[i].start + out[i].end) / 2, clock: clock)
        }
        var i = 0
        while i < out.count {
            guard let p = out[i].pentad else {
                i += 1
                continue
            }
            var j = i
            var places = Set<Int>()
            while j < out.count, let q = out[j].pentad, q.sync == p.sync, q.index == p.index {
                places.insert(q.helion)
                j += 1
            }
            out[i].band = JournalPentadBand(sync: p.sync, index: p.index, helions: p.helions, start: p.start, end: p.end,
                                            places: places)
            i = j
        }
        return out
    }
}

/// A Pentad over its days in the journal's stack: which of its Helions (1 … 5, 1 … 4 in the Hypopentad) hold entries.
struct JournalPentadBand: Hashable, Sendable {
    let sync: Int
    /// 0 … 3; 3 is the Hypopentad.
    let index: Int
    /// 5, or 4 for the Hypopentad.
    let helions: Int
    let start: Double
    let end: Double
    /// The places of the Helions with entries.
    let places: Set<Int>

    var id: String { "p\(sync).\(index)" }

    /// "Pentad II · 2 of 5 Helions with entries" (plain text, for VoiceOver).
    var summary: String {
        "\(PentadWords.name(index)) · \(places.count) of \(helions) Helions with entries"
    }
}

/// The plain words of the journal's Pentads.
enum JournalPentadWords {
    /// A Pentad's Earth span, its end exclusive: "Thu 8 Oct 15:02 – Fri 16:18" across midnight, "Thu 8 Oct 15:02–19:20"
    /// within one day (a Pentad lasts about a day, so the end needs no date).
    static func earthSpan(start: Double, end: Double, earth: EarthFormatter) -> String {
        let a = earth.parts(start), b = earth.parts(end)
        let day = "\(EarthTime.weekdaysShort[a.weekday]) \(a.day) \(EarthTime.monthsShort[a.month - 1])"
        let from = earth.time(start, seconds: false), to = earth.time(end, seconds: false)
        if a.year == b.year && a.month == b.month && a.day == b.day { return "\(day) \(from)–\(to)" }
        return "\(day) \(from) – \(EarthTime.weekdaysShort[b.weekday]) \(to)"
    }
}
