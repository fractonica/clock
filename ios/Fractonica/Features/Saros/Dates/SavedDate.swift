import FractonicaKit
import Foundation

// Dates: moments or whole days the person keeps — a birthday, a wedding, a launch — each with an emoji, a title and a
// description, the Saros series of its nearest eclipse and the rarity that gives (`SarosSearch`), and its **echoes**:
// notifications when the date comes round again, every year on its solar day, or every time a period of the clock's
// series is back at the same phase (hub/API.md `journal.date`).
//
// A date is a hub record of kind `journal.date`, kept in the journal's store and synced with it (any device may edit
// it, as a journal entry). Pure logic, checked by Saros/Checks.

/// One kept date, read from its record.
struct SavedDate: Identifiable, Hashable, Sendable {
    static let kind = "journal.date"

    var id: String
    /// The moment; for a whole day, its noon in `zone`.
    var time: Double
    /// The zone the day is read in (IANA).
    var zone: String
    /// A whole day rather than a moment.
    var allDay: Bool
    var emoji: String?
    var title: String
    var text: String
    var echoes: DateEchoSettings

    init(id: String = UUID().uuidString.lowercased(), time: Double, zone: String, allDay: Bool, emoji: String? = nil,
         title: String = "", text: String = "", echoes: DateEchoSettings = DateEchoSettings()) {
        self.id = id
        self.time = time
        self.zone = zone
        self.allDay = allDay
        self.emoji = emoji
        self.title = title
        self.text = text
        self.echoes = echoes
    }

    /// A live `journal.date` record as a date; nil for any other.
    init?(record: HubRecord) {
        guard record.kind == Self.kind, !record.isDeleted else { return nil }
        let data = record.data
        id = record.id
        time = record.time
        zone = record.zone ?? TimeZone.current.identifier
        allDay = data["allDay"]?.bool ?? false
        emoji = data["emoji"]?.string.flatMap { $0.isEmpty ? nil : $0 }
        title = data["title"]?.string ?? ""
        text = data["text"]?.string ?? ""
        echoes = DateEchoSettings(json: data["echoes"])
    }

    var timeZone: TimeZone { TimeZone(identifier: zone) ?? .current }

    /// What the Saros search measures from: the whole day, or the moment.
    var query: SarosQuery { allDay ? .day(containing: time, zone: timeZone) : .moment(time) }

    /// "🎂 Birthday", or the emoji alone, or "Untitled date".
    var name: String {
        let words = title.isEmpty ? (emoji == nil ? "Untitled date" : nil) : title
        return [emoji, words].compactMap { $0 }.joined(separator: " ")
    }

    /// The record to store: `old`'s hub fields and any data fields this version does not know kept, its nearest
    /// eclipse's series and rarity written alongside for other clients (the hub's page lists them).
    func record(updating old: HubRecord?, now: Double) -> HubRecord {
        var data = old?.data.object ?? [:]
        data["emoji"] = emoji.map(JSONValue.string) ?? nil
        data["title"] = .string(title)
        data["text"] = .string(text)
        data["allDay"] = .bool(allDay)
        data["echoes"] = echoes.json
        if let nearest = SarosSearch.matches(query, count: 1).first {
            data["saros"] = .number(Double(nearest.eclipse.series))
            data["rarity"] = .string(nearest.rarity.rawValue)
        }
        return HubRecord(
            id: id, kind: Self.kind, time: time, end: nil, zone: zone, data: .object(data), text: nil,
            tags: old?.tags, blobs: nil, created: old?.created ?? now, updated: now, deleted: nil,
            source: old?.source, editor: old?.editor, rev: old?.rev, fx: old?.fx
        )
    }

    /// The moment a day stands for: its noon in `zone` (where the clocks change at noon, the hour after).
    static func noon(of t: Double, zone: TimeZone) -> Double {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let day = calendar.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: t))
        var c = day
        c.hour = 12
        return calendar.date(from: c)?.timeIntervalSince1970 ?? t
    }
}

/// The echoes a date asks for, synced with it (`data.echoes`):
///
///     { "solarDay": true, "at": 540, "periods": [4, 6] }
struct DateEchoSettings: Hashable, Sendable {
    /// Every year on the date's solar day (a 29 February on the 28th in other years).
    var solarDay = false
    /// When in that day: minutes after midnight, in the app's zone.
    var solarMinute = 9 * 60
    /// Levels (0 α … 6 η) whose every later cycle echoes the date, when the clock is back at the same phase of it.
    var periods: [Int] = []

    /// The periods an echo can follow: Alpha … Helion.
    static let levels = Array(0...6)

    var isEmpty: Bool { !solarDay && periods.isEmpty }

    init(solarDay: Bool = false, solarMinute: Int = 9 * 60, periods: [Int] = []) {
        self.solarDay = solarDay
        self.solarMinute = solarMinute
        self.periods = periods
    }

    init(json: JSONValue?) {
        solarDay = json?["solarDay"]?.bool ?? false
        solarMinute = json?["at"]?.number.map { min(1439, max(0, Int($0))) } ?? 9 * 60
        periods = (json?["periods"]?.array ?? []).compactMap { $0.number.map(Int.init) }
            .filter(Self.levels.contains).sorted()
        periods = Array(Set(periods)).sorted()
    }

    var json: JSONValue {
        .object(["solarDay": .bool(solarDay), "at": .number(Double(solarMinute)), "periods": .array(periods.map { .number(Double($0)) })])
    }

    func follows(_ level: Int) -> Bool { periods.contains(level) }

    mutating func set(_ level: Int, _ on: Bool) {
        periods = Array(Set(periods).symmetricDifference(follows(level) == on ? [] : [level])).sorted()
    }
}

extension JSONValue {
    var bool: Bool? { if case .bool(let b) = self { b } else { nil } }
    var array: [JSONValue]? { if case .array(let a) = self { a } else { nil } }
}

// MARK: - Echoes

/// One echo of a date: when it comes and what it echoes.
struct DateEcho: Hashable, Sendable, Identifiable {
    enum Kind: Hashable, Sendable {
        /// The date's solar day in `year`.
        case solarDay(year: Int)
        /// The cycle `cycle` (global index) of `level`, at the date's phase in it.
        case period(level: Int, cycle: Int64)
    }

    let dateID: String
    let kind: Kind
    let time: Double
    /// Shorter periods whose echo falls at the same moment (an echo of a Nuclide is one of its Helion too).
    var also: [Int] = []

    /// The notification's identifier: "echo.<date>.y2031", "echo.<date>.l4.c6120".
    var id: String {
        switch kind {
        case .solarDay(let year): "\(DateEchoPlanner.prefix)\(dateID).y\(year)"
        case .period(let level, let cycle): "\(DateEchoPlanner.prefix)\(dateID).l\(level).c\(cycle)"
        }
    }

    var level: Int? { if case .period(let level, _) = kind { level } else { nil } }
}

/// When a date's echoes come (`DateEchoes` schedules them): the solar day each later year, and for each period the
/// moment of every later cycle at the date's phase in it — the same position within the cycle, so the clock reads the
/// same at every finer level (the date's ε#2 75η 26ι, echoed by its Delta, is ε#2 75η 26ι of each later Delta).
enum DateEchoPlanner {
    /// Identifier prefix of the echo notifications (ARCHITECTURE: features share the 64 pending requests by prefix).
    static let prefix = "echo."
    /// The echo requests kept pending at most.
    static let budget = 8

    /// The date's echoes after `now`, soonest first, at most `limit` of each kind it asks for; echoes of one date at
    /// the same moment are one, under its longest period. A date outside the clock's catalogue has no period echoes.
    static func echoes(of date: SavedDate, after now: Double, clock: FractonicaClock, zone: TimeZone, limit: Int) -> [DateEcho] {
        var out: [DateEcho] = []
        if date.echoes.solarDay {
            out += solarDays(of: date, after: now, zone: zone, count: limit)
        }
        for level in date.echoes.periods {
            out += periods(of: date, level: level, after: now, clock: clock, count: limit)
        }
        return merged(out)
    }

    /// The date's solar day in each later year from now on: its month and day (in its own zone) at `solarMinute` in
    /// `zone`, the 28th for a 29 February outside leap years.
    static func solarDays(of date: SavedDate, after now: Double, zone: TimeZone, count: Int) -> [DateEcho] {
        guard count > 0 else { return [] }
        var own = Calendar(identifier: .gregorian)
        own.timeZone = date.timeZone
        let d = own.dateComponents([.year, .month, .day], from: Date(timeIntervalSince1970: date.time))
        guard let year = d.year, let month = d.month, let day = d.day else { return [] }
        var here = Calendar(identifier: .gregorian)
        here.timeZone = zone
        let thisYear = here.component(.year, from: Date(timeIntervalSince1970: now))
        var out: [DateEcho] = []
        var y = max(year + 1, thisYear - 1)
        while out.count < count, y <= 9999 {
            defer { y += 1 }
            let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
            let c = DateComponents(year: y, month: month, day: month == 2 && day == 29 && !leap ? 28 : day,
                                   hour: date.echoes.solarMinute / 60, minute: date.echoes.solarMinute % 60)
            guard let t = here.date(from: c)?.timeIntervalSince1970, t > now else { continue }
            out.append(DateEcho(dateID: date.id, kind: .solarDay(year: y), time: t))
        }
        return out
    }

    /// The date's echoes in the later cycles of `level` from now on: cycle c's start plus the date's phase in its own
    /// cycle, by position (Saros units), so the clock reads the same below `level`.
    static func periods(of date: SavedDate, level: Int, after now: Double, clock: FractonicaClock, count: Int) -> [DateEcho] {
        guard count > 0, let p = clock.position(at: date.time) else { return [] }
        let scale = clock.levelInfo(level).prefixDouble / 4 // cycles per Saros
        let cycles = p * scale
        let own = cycles.rounded(.down)
        let phase = cycles - own
        let fromNow = (clock.position(at: clock.clamp(now)) ?? 0) * scale
        var c = max(own + 1, fromNow.rounded(.down))
        var out: [DateEcho] = []
        let last = Double(clock.extent) * scale
        while out.count < count, c + phase <= last {
            defer { c += 1 }
            let t = clock.time(atPosition: (c + phase) / scale)
            guard t > now else { continue }
            out.append(DateEcho(dateID: date.id, kind: .period(level: level, cycle: Int64(c)), time: t))
        }
        return out
    }

    /// A date's period echoes within a millisecond of each other as one: the longest period's, the shorter ones in
    /// `also` (an echo of a Nuclide is always one of its Helion too). Solar days stay apart.
    static func merged(_ echoes: [DateEcho]) -> [DateEcho] {
        var out: [DateEcho] = []
        for e in echoes.sorted(by: { $0.time < $1.time }) {
            guard let level = e.level,
                  let i = out.lastIndex(where: { $0.dateID == e.dateID && $0.level != nil && abs($0.time - e.time) < 0.001 }),
                  let held = out[i].level else {
                out.append(e)
                continue
            }
            if level < held {
                var primary = e
                primary.also = (out[i].also + [held]).sorted()
                out[i] = primary
            } else {
                out[i].also = (out[i].also + [level]).sorted()
            }
        }
        return out
    }

    /// The echoes to keep pending: each date's soonest echo of each kind first (so a Helion's echoes cannot crowd out a
    /// year's), soonest first up to `budget`, then the soonest of the rest.
    static func plan(_ dates: [SavedDate], after now: Double, clock: FractonicaClock, zone: TimeZone, budget: Int = budget) -> [DateEcho] {
        let all = dates.flatMap { echoes(of: $0, after: now, clock: clock, zone: zone, limit: budget) }
        var firsts: [DateEcho] = []
        var seen = Set<String>()
        for e in all.sorted(by: { $0.time < $1.time }) {
            let key = "\(e.dateID)|\(e.level.map(String.init) ?? "y")"
            if seen.insert(key).inserted { firsts.append(e) }
        }
        var chosen = Array(firsts.prefix(budget))
        let taken = Set(chosen.map(\.id))
        chosen += all.filter { !taken.contains($0.id) }.sorted { $0.time < $1.time }.prefix(max(0, budget - chosen.count))
        return chosen.sorted { $0.time < $1.time }
    }

    /// The name of a period an echo follows: "Alpha", "Beta", "Gamma", "Delta", "Nuclide", "ζ", "Helion".
    static func periodName(_ level: Int) -> String {
        Notation.unit(level: level)?.name ?? Fractonica.periodName(level).text
    }

    /// What the clock reads within a cycle of `level` at t, the phase an echo repeats: for a Delta "ε#2 75η 26ι", a
    /// Nuclide "75η 26ι", a ζ "η 9 of 11 · 26ι", a Helion "26ι 14λ".
    static func phase(level: Int, at t: Double, notation: Notation) -> String? {
        guard notation.model.inRange(t) else { return nil }
        switch level {
        case 0...4:
            let parts = notation.stamp(at: t, upTo: "iota").split(separator: " ")
            return parts.dropFirst(level + 1).joined(separator: " ")
        case 5:
            let parts = notation.clockText(at: t, upTo: "iota").split(separator: " ")
            guard let first = parts.first, let eta = Int(first.dropLast()) else { return nil }
            return (["η \((eta - 1) % 11 + 1) of 11"] + parts.dropFirst().map(String.init)).joined(separator: " · ")
        default:
            return notation.clockText(at: t, upTo: "lambda").split(separator: " ").dropFirst().joined(separator: " ")
        }
    }
}

// MARK: - Words

/// How a date and its echoes are said: Earth dates in the date's own zone, or in pure mode its stamp on the reference
/// clock (and no Gregorian date at all).
struct DateWords: Sendable {
    let pure: Bool
    let notation: Notation

    /// "Thu 12 May 1988" for a whole day, "Mon 21 Aug 2017, 18:25" for a moment · pure its stamp, to the Nuclide for a
    /// day and to the Preon for a moment ("α#5 β#3 γ#2 δ#4 ε#2 75η 26ι"), or "outside the clock's catalogue".
    func when(_ date: SavedDate) -> String {
        if pure {
            guard notation.model.inRange(date.time) else { return "outside the clock's catalogue" }
            return notation.stamp(at: date.time, upTo: date.allDay ? "epsilon" : "iota")
        }
        let p = EarthFormatter(timeZone: date.timeZone).parts(date.time)
        let day = "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year)"
        return date.allDay ? day : "\(day), \(String(format: "%02d:%02d", p.hour, p.minute))"
    }
}

/// An echo's notification: the date's name for its title, and what comes round again.
struct DateEchoText: Sendable {
    let pure: Bool
    let notation: Notation

    func title(_ date: SavedDate, _ echo: DateEcho) -> String { date.name }

    /// "Echo: the same solar day, 38 years on — Thu 12 May 1988." · "Echo of the Nuclide: the clock is back at
    /// 75η 26ι, as on Thu 12 May 1988 (and of the Helion)." · pure, the stamp in place of the date.
    func body(_ date: SavedDate, _ echo: DateEcho) -> String {
        let words = DateWords(pure: pure, notation: notation)
        switch echo.kind {
        case .solarDay(let year):
            if pure { return "Echo: the same solar day comes round again." }
            let born = EarthFormatter(timeZone: date.timeZone).parts(date.time).year
            let years = year - born
            return "Echo: the same solar day, \(years) year\(years == 1 ? "" : "s") on — \(words.when(date))."
        case .period(let level, _):
            let name = DateEchoPlanner.periodName(level)
            let also = echo.also.isEmpty ? "" : " (and of the \(echo.also.map(DateEchoPlanner.periodName).joined(separator: ", ")))"
            let phase = DateEchoPlanner.phase(level: level, at: date.time, notation: notation)
            let back = phase.map { "the clock is back at \($0)" } ?? "the clock is back at the same phase"
            return "Echo of the \(name): \(back), as \(pure ? "at" : "on") \(words.when(date))\(also)."
        }
    }
}
