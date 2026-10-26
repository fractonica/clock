import FractonicaKit
import Foundation

/// The journal's days: entries grouped by the Helion (η, level 6, about five hours) they fall in — the unit the
/// notation numbers "like the day of a month" (1η … 77η in its Nuclide), so a Helion reads as the journal's day:
/// "34η" over "ε#5 · Delta Trifracton End", the Earth date and hours under it. Records outside the catalogue share one
/// group. Pure logic, checked by Journal/Checks.
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
        return days
    }
}
