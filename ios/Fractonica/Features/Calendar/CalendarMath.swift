import FractonicaKit
import Foundation

// The calendar's mapping maths (no SwiftUI): everything the converter and the month view need to go from a Unix
// instant to its Fractonica description and back, ported from src/ui/calendar/convert.js and month.js. Readings always
// come from `FractonicaClock`; this file converts, lands and lays out. Times are Unix seconds, levels zero-based,
// paths 1-based ([Alpha, Beta, Gamma, …]). Checked by Checks/CalendarChecks.swift.

enum CalMath {
    /// The Greek letter of a level ("η").
    static func letter(_ level: Int) -> String { Fractonica.periodName(level).text }

    /// Round to whole milliseconds (the clock does the same before every query).
    static func r3(_ t: Double) -> Double { (t * 1000).rounded() / 1000 }

    /// "ε#5": the 5th ε inside its δ (a bare "ε 5" is the depth chip of the other screens).
    static func cycleLabel(level: Int, ordinal: Int) -> String { "\(letter(level))#\(ordinal)" }

    /// "α#6 β#4 γ#9", or with `separator` " › ".
    static func pathText(_ path: [Int], from level: Int = 0, separator: String = " ") -> String {
        path.enumerated().map { cycleLabel(level: level + $0.offset, ordinal: $0.element) }.joined(separator: separator)
    }

    static func pad(_ n: Int, _ width: Int = 2) -> String {
        let s = String(n.magnitude)
        return (n < 0 ? "-" : "") + String(repeating: "0", count: max(0, width - s.count)) + s
    }

    // MARK: Points and landings

    /// Time of the point at fraction `phase` (0 … 1, position-linear) of cycle `index` of `level`; nil beyond the
    /// catalogue (clipped last cycles). Phase 0 equals `cycleStartTime` (convert.js `pointOfCycle`).
    static func pointOfCycle(_ clock: FractonicaClock, level: Int, index: Int64, phase: Double = 0) -> Double? {
        let p = clock.levelInfo(level).prefixDouble
        let n = Double(index) * 4 + phase * 4
        guard n >= 0 else { return nil }
        let k = (n / p).rounded(.down)
        if k > Double(clock.extent) { return nil }
        let rem = n - k * p
        if k == Double(clock.extent) { return rem == 0 ? clock.tMax : nil }
        let i = Int(k)
        return clock.catalogue[i] + (rem / p) * (clock.catalogue[i + 1] - clock.catalogue[i])
    }

    /// The first millisecond for which `shows` holds, searched around the float estimate `t` of an exact boundary
    /// (pure-conv.js `firstMs`): the estimate can sit a hair on either side of a millisecond.
    static func firstMs(_ t: Double, _ shows: (Double) -> Bool) -> Double? {
        guard t.isFinite else { return nil }
        let i0 = (t * 1000 - 1e-3).rounded(.up)
        if shows(i0 / 1000), !shows((i0 - 1) / 1000) { return i0 / 1000 }
        var i = i0 - 3
        while i <= i0 + 6 {
            if shows(i / 1000) { return i / 1000 }
            i += 1
        }
        return nil
    }

    /// The first millisecond at which cycle `index` of `level` has reached `phase` (0 begins, 1 the next begins,
    /// ¼ ½ ¾ its peak, node, valley); nil beyond the catalogue (pure-conv.js `landPoint`).
    static func landPoint(_ clock: FractonicaClock, level: Int, index: Int64, phase: Double = 0) -> Double? {
        guard let t = pointOfCycle(clock, level: level, index: index, phase: phase) else { return nil }
        let shows: (Double) -> Bool
        if phase <= 0 {
            shows = { (clock.level(at: $0, level)?.cycle ?? -1) >= index }
        } else if phase >= 1 {
            shows = { (clock.level(at: $0, level)?.cycle ?? -1) >= index + 1 }
        } else {
            shows = { c in
                guard let l = clock.level(at: c, level) else { return false }
                return l.cycle > index || (l.cycle == index && l.phase >= phase)
            }
        }
        return firstMs(t, shows) ?? clock.clamp((t * 1000).rounded(.up) / 1000)
    }

    /// A time that shows the cycle of `level` that begins at the boundary `t` (convert.js `landOn`): the clock rounds
    /// queries to 1 ms, so a boundary like …172.42811 would otherwise read as the previous cycle.
    static func landOn(_ clock: FractonicaClock, _ t: Double, level: Int?) -> Double {
        var c = (t * 1000).rounded(.up) / 1000
        guard let level else { return c }
        for _ in 0..<3 {
            guard let l = clock.level(at: c, level) else { return c }
            if abs(l.start - t) < 5e-3 || l.start > t { return c }
            c = r3(c + 0.001)
        }
        return c
    }

    // MARK: Addresses

    /// The 1-based path of the cycles containing t, `depth` entries long; nil outside the catalogue.
    static func path(_ clock: FractonicaClock, at t: Double, depth: Int) -> [Int]? {
        var out: [Int] = []
        for level in 0..<max(0, depth) {
            guard let l = clock.level(at: t, level) else { return nil }
            out.append(l.local + 1)
        }
        return out
    }

    /// How many cycles exist inside the catalogue directly under the cycle `parent` (the maximum of the next entry,
    /// which respects the clipped last cycles); [] counts the Alphas.
    static func childCount(_ clock: FractonicaClock, parent: [Int]) -> Int {
        if parent.isEmpty { return Int(clock.count(0)) }
        guard let siblings = clock.levelInfo(parent.count).siblings else { return 0 }
        var n = 0
        for i in 1...siblings {
            if clock.pathToCycle(parent + [i]) == nil { break }
            n = i
        }
        return n
    }

    /// How many cycles a parent holds nominally (the hierarchy's count; the catalogue may end sooner): convert.js
    /// `nominalCount`.
    static func nominalCount(_ clock: FractonicaClock, parent: [Int]) -> Int {
        parent.isEmpty ? Int(clock.count(0)) : clock.levelInfo(parent.count).siblings ?? 0
    }

    /// Step the entry at `level` of a path by `delta` cycles of that level, carrying into the parents the odometer way
    /// (the last ε of a δ steps into the next δ's first ε); the finer entries keep their numbers where they exist.
    /// nil at the ends of the catalogue (pure-converter.js `stepLevel`).
    static func step(_ clock: FractonicaClock, path: [Int], level: Int, by delta: Int) -> [Int]? {
        guard level >= 0, level < path.count, let index = clock.pathToCycle(Array(path.prefix(level + 1))) else { return nil }
        let next = Int128(index) + Int128(delta)
        guard next >= 0, next < clock.count(level) else { return nil }
        return normalize(clock, path: clock.cycleToPath(level: level, cycle: Int64(next)) + path.dropFirst(level + 1))
    }

    /// Every entry clamped into what exists under its parents.
    static func normalize(_ clock: FractonicaClock, path: [Int]) -> [Int] {
        var out: [Int] = []
        for v in path {
            let maximum = childCount(clock, parent: out)
            if maximum == 0 { break }
            out.append(min(max(1, v), maximum))
        }
        return out
    }

    /// Points of a cycle the converter can address.
    enum Point: String, CaseIterable, Identifiable, Sendable {
        case begin, peak, node, valley, end, phase
        var id: String { rawValue }
        var label: String {
            switch self {
            case .begin: "Begin"
            case .peak: "Peak"
            case .node: "Node"
            case .valley: "Valley"
            case .end: "End"
            case .phase: "Same phase"
            }
        }
        var fraction: Double? {
            switch self {
            case .begin: 0
            case .peak: 0.25
            case .node: 0.5
            case .valley: 0.75
            case .end: 1
            case .phase: nil
            }
        }
    }

    /// The first millisecond of the named point of the cycle at `path` (pure-conv.js `landPath`).
    static func time(_ clock: FractonicaClock, path: [Int], point: Point, phaseNow: Double = 0) -> Double? {
        guard let index = clock.pathToCycle(path) else { return nil }
        return landPoint(clock, level: path.count - 1, index: index, phase: point.fraction ?? phaseNow)
    }

    // MARK: Position

    /// The catalogue in whole milliseconds (the clock holds it so; positions are exact fractions of it).
    static func catalogueMs(_ clock: FractonicaClock) -> [Int64] {
        clock.catalogue.map { Int64(($0 * 1000).rounded()) }
    }

    /// The position of t as an ordinal and an exact decimal fraction: `digits` digits after the point, rounded half up
    /// (convert.js `exactPosition`). nil outside the catalogue.
    static func position(_ clock: FractonicaClock, at t: Double, digits: Int = 15) -> (ordinal: Int, fraction: String)? {
        guard clock.inRange(r3(t)), let (k, _) = clock.locate(r3(t)) else { return nil }
        let e = catalogueMs(clock)
        let tMs = Int64((r3(t) * 1000).rounded())
        var whole = k
        var num = tMs - e[k]
        let den = e[k + 1] - e[k]
        if num >= den { // the closing instant: position k + 1 exactly
            whole += 1
            num -= den
        }
        // long division with one extra digit for rounding
        var out: [Int] = []
        var r = num
        for _ in 0...digits {
            r *= 10
            out.append(Int(r / den))
            r %= den
        }
        let roundUp = out.removeLast() >= 5
        if roundUp {
            var i = out.count - 1
            while i >= 0 {
                if out[i] == 9 {
                    out[i] = 0
                    i -= 1
                } else {
                    out[i] += 1
                    break
                }
            }
            if i < 0 { whole += 1 }
        }
        return (whole, out.map(String.init).joined())
    }

    /// The time of a position written as one decimal ("22.927850216635", "22", "22.") or an error message.
    static func time(_ clock: FractonicaClock, positionText text: String) -> Result<Double, CalendarError> {
        let s = text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".")
        guard let m = s.wholeMatch(of: /(\d{1,3})(?:\.(\d*))?/) else {
            return .failure(CalendarError("Write the position as a decimal number, e.g. 22.927850216635"))
        }
        let k = Int(m.1)!
        let digits = m.2.map(String.init) ?? ""
        let f = digits.isEmpty ? 0 : Double("0." + digits)!
        if k > clock.extent || (k == clock.extent && f > 0) {
            return .failure(CalendarError("A position runs from 0 to \(clock.extent): the catalogue holds \(clock.extent) Saros intervals"))
        }
        if k == clock.extent { return .success(clock.tMax) }
        let e = clock.catalogue
        return .success(e[k] + f * (e[k + 1] - e[k]))
    }

    /// An ISO 8601 moment: "2026-10-08T12:00:00.123+03:00", "…Z", or a wall time without an offset ("2026-10-08 14:30"),
    /// read in `zone` (a skipped wall time moves ahead, a repeated one is the first). nil when it is not a real moment.
    static func parseISO(_ text: String, zone: TimeZone) -> Double? { readISO(text, zone: zone)?.t }

    /// An ISO 8601 moment read in detail: the instant, and the wall-clock fields when they were given without an offset
    /// (a time of the zone, which may not exist or may happen twice there: see `wallTimeIssue`).
    static func readISO(_ text: String, zone: TimeZone) -> (t: Double, wall: EarthTime.CivilTime?)? {
        let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let pattern = /(-?\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?/
        guard let m = s.wholeMatch(of: pattern.ignoresCase()),
              let y = Int(m.1), let mo = Int(m.2), let d = Int(m.3) else { return nil }
        let h = m.4.flatMap { Int($0) } ?? 0, mi = m.5.flatMap { Int($0) } ?? 0, se = m.6.flatMap { Int($0) } ?? 0
        let ms = m.7.flatMap { Int(String($0).padding(toLength: 3, withPad: "0", startingAt: 0)) } ?? 0
        guard (1...12).contains(mo), d >= 1, d <= EarthTime.daysInMonth(y, mo), h <= 23, mi <= 59, se <= 59 else { return nil }
        let fields = EarthTime.CivilTime(year: y, month: mo, day: d, hour: h, minute: mi, second: se, ms: ms)
        guard let tz = m.8.map(String.init) else {
            return (EarthTime.zonedToUnix(fields, zone: zone), m.4 != nil ? fields : nil)
        }
        var offset = 0
        if tz.uppercased() != "Z" {
            let digits = tz.dropFirst().replacingOccurrences(of: ":", with: "")
            let hours = Int(digits.prefix(2)) ?? 0, minutes = digits.count > 2 ? Int(digits.suffix(2)) ?? 0 : 0
            guard hours <= 18, minutes <= 59 else { return nil }
            offset = (hours * 3600 + minutes * 60) * (tz.first == "-" ? -1 : 1)
        }
        return (EarthTime.zonedToUnix(fields, zone: TimeZone(identifier: "UTC")!) - Double(offset), nil)
    }

    /// A wall time a zone does not have exactly once.
    enum WallIssue: Sendable { case gap, fold }

    /// Whether the wall time `fields` is skipped (`gap`, the clocks jump over it) or repeated (`fold`, the clocks go
    /// back) in `zone`; nil when it happens exactly once (convert.js `localTimeIssue`).
    static func wallTimeIssue(_ fields: EarthTime.CivilTime, zone: TimeZone) -> WallIssue? {
        var utcFields = fields
        utcFields.ms = 0
        let g = EarthTime.zonedToUnix(utcFields, zone: TimeZone(identifier: "UTC")!)
        guard g.isFinite else { return nil }
        let offsetAt = { (t: Double) in EarthTime.zonedParts(t, zone: zone).offset }
        let offsets = Set([offsetAt(g - 86_400), offsetAt(g), offsetAt(g + 86_400)])
        let hits = offsets.filter { offsetAt(g - Double($0)) == $0 }.count
        return hits == 0 ? .gap : hits > 1 ? .fold : nil
    }

    /// The sentence under a typed wall time the zone does not have exactly once (convert.js `wallTimeNote`):
    /// "02:30 does not exist in Berlin (the clocks skip it): moved ahead to 03:30".
    static func wallTimeNote(_ fields: EarthTime.CivilTime, zone: TimeZone, resolved t: Double, earth: EarthFormatter, place: String) -> String? {
        guard let issue = wallTimeIssue(fields, zone: zone) else { return nil }
        let hm = "\(pad(fields.hour)):\(pad(fields.minute))"
        switch issue {
        case .gap: return "\(hm) does not exist in \(place) (the clocks skip it): moved ahead to \(earth.time(r3(t), seconds: false))"
        case .fold: return "\(hm) happens twice in \(place) (the clocks go back): showing the first"
        }
    }

    // MARK: Eclipses

    /// The eclipses around t: the previous (E[k] ≤ t) and the next one.
    static func eclipses(_ clock: FractonicaClock, around t: Double) -> (previous: Int?, next: Int?) {
        if t < clock.tMin { return (nil, 0) }
        if t >= clock.tMax { return (clock.extent, nil) }
        guard let (k, _) = clock.locate(t) else { return (nil, nil) }
        return (k, k + 1 <= clock.extent ? k + 1 : nil)
    }

    /// The eclipse whose greatest instant falls in [t0, t1), if any.
    static func eclipse(_ clock: FractonicaClock, in t0: Double, _ t1: Double) -> Int? {
        let e = clock.catalogue
        var lo = 0, hi = e.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if e[mid] < t0 { lo = mid + 1 } else { hi = mid }
        }
        return lo < e.count && e[lo] < t1 ? lo : nil
    }

    // MARK: Solar sync

    /// The first and last sync number entirely inside the catalogue.
    static func syncRange(_ clock: FractonicaClock) -> ClosedRange<Int> {
        var lo = clock.solar(at: clock.tMin + 6 * 86_400)?.sync ?? 0
        var hi = clock.solar(at: clock.tMax - 6 * 86_400)?.sync ?? 0
        while clock.solarSync(number: lo - 1) != nil { lo -= 1 }
        while clock.solarSync(number: lo) == nil { lo += 1 }
        while clock.solarSync(number: hi + 1) != nil { hi += 1 }
        while clock.solarSync(number: hi) == nil { hi -= 1 }
        return lo...hi
    }

    static let syncQuarterNames = ["start", "peak", "node", "valley"]

    /// The sync quarters overlapping [t0, t1) (month.js `syncQuartersInWindow`).
    static func syncQuarters(_ clock: FractonicaClock, from t0: Double, to t1: Double, range: ClosedRange<Int>) -> [CalSyncQuarter] {
        let lo = max(t0, clock.tMin), hi = min(t1, clock.tMax)
        guard hi > lo else { return [] }
        let probe = min(max(lo, clock.tMin + 8 * 86_400), clock.tMax - 8 * 86_400)
        var n = min(max(clock.solar(at: probe)?.sync ?? range.lowerBound, range.lowerBound), range.upperBound)
        while n > range.lowerBound, let previous = clock.solarSync(number: n - 1), previous.end > lo { n -= 1 }
        var out: [CalSyncQuarter] = []
        while n <= range.upperBound {
            defer { n += 1 }
            guard let s = clock.solarSync(number: n) else { continue }
            if s.end <= lo { continue }
            if s.start >= hi { break }
            let length = s.end - s.start
            for q in 0..<4 {
                out.append(CalSyncQuarter(sync: n, quarter: q, start: s.start + Double(q) / 4 * length,
                                       end: s.start + Double(q + 1) / 4 * length, syncStart: s.start, drift: s.drift))
            }
        }
        return out
    }

    // MARK: Civil days

    /// Add n civil days to a date.
    static func addDays(_ y: Int, _ m: Int, _ d: Int, _ n: Int) -> (year: Int, month: Int, day: Int) {
        EarthTime.civilFromDays(EarthTime.daysFromCivil(y, m, d) + n)
    }

    /// Day of week, 0 = Sunday.
    static func weekday(_ y: Int, _ m: Int, _ d: Int) -> Int {
        ((EarthTime.daysFromCivil(y, m, d) % 7) + 11) % 7
    }

    /// The first instant of the local day y-m-d in `zone` (convert.js `dayStart`): robust against zones whose clocks
    /// change at midnight and dates a zone skipped altogether (their start is the next day's: length 0).
    static func dayStart(_ zone: TimeZone, _ y: Int, _ m: Int, _ d: Int) -> Double {
        let target = EarthTime.daysFromCivil(y, m, d)
        let dayNumber = { (t: Double) -> Int in
            let p = EarthTime.zonedParts(t, zone: zone)
            return EarthTime.daysFromCivil(p.year, p.month, p.day)
        }
        var hi = EarthTime.zonedToUnix(.init(year: y, month: m, day: d), zone: zone)
        if dayNumber(hi) == target, dayNumber(hi - 1) < target { return hi }
        var guardCount = 0
        while dayNumber(hi) < target, guardCount < 100 {
            hi += 900
            guardCount += 1
        }
        var lo = hi - 900
        guardCount = 0
        while dayNumber(lo) >= target, guardCount < 100 {
            hi = lo
            lo -= 900
            guardCount += 1
        }
        while hi - lo > 1 {
            let mid = ((lo + hi) / 2).rounded(.down)
            if dayNumber(mid) >= target { hi = mid } else { lo = mid }
        }
        return hi
    }

    /// Months the month view can show: January 1613 … December 2857, as one index (year · 12 + month − 1).
    static let firstMonth = 1613 * 12
    static let lastMonth = 2857 * 12 + 11

    static func monthIndex(year: Int, month: Int) -> Int { year * 12 + month - 1 }
    static func yearMonth(_ index: Int) -> (year: Int, month: Int) {
        (Int((Double(index) / 12).rounded(.down)), ((index % 12) + 12) % 12 + 1)
    }
    static func clampMonth(_ index: Int) -> Int { min(lastMonth, max(firstMonth, index)) }
}

/// A message for the person, shown inline next to what they typed.
struct CalendarError: Error, Equatable, Sendable {
    let message: String
    init(_ message: String) { self.message = message }
}

/// One quarter of a solar sync inside a window.
struct CalSyncQuarter: Hashable, Sendable {
    let sync: Int
    /// 0 … 3; named by the threshold at its start: start, peak, node, valley.
    let quarter: Int
    let start: Double
    let end: Double
    let syncStart: Double
    let drift: Double
}

// MARK: - The month grid

/// What a day cell's band shows: the cycles of a level (γ … η), the Pentads (SPEC §7.5) or the solar sync quarters.
enum CalendarBand: Hashable, Sendable, Identifiable {
    case level(Int)
    case pentad
    case sync

    var id: String { key }

    /// "4" / "sync": the stored form.
    var key: String {
        switch self {
        case .level(let level): String(level)
        case .pentad: "pentad"
        case .sync: "sync"
        }
    }

    init?(key: String) {
        if key == "sync" {
            self = .sync
        } else if key == "pentad" {
            self = .pentad
        } else if let level = Int(key), CalendarBand.levels.contains(level) {
            self = .level(level)
        } else {
            return nil
        }
    }

    /// The levels a band can show: γ (1.1 years) … η (5 hours).
    static let levels = 2...6
    static let all: [CalendarBand] = levels.map(CalendarBand.level) + [.pentad, .sync]
}

/// A Gregorian month of local days (always 6 weeks × 7 days) whose cells carry the cycles of the chosen bands, each
/// cut at its exact time of day (month.js `monthGrid` + `buildMonth`). Day cells are delimited by real local
/// midnights, never "+86 400" (DST days are 23 or 25 hours). Built once per (month, zone, week start, bands).
struct CalMonthGrid: Sendable {
    struct Segment: Hashable, Sendable {
        /// Where the piece lies inside the day, 0 … 1 by elapsed time.
        let x0: Double
        let x1: Double
        /// Global cycle index (the sync number for the sync and Pentad bands) and the ordinal inside its parent, from 1
        /// (the quarter 0 … 3 for the sync band, the Pentad 0 … 3 for the Pentad band).
        let index: Int64
        let ordinal: Int
        /// The whole cycle (or sync quarter).
        let start: Double
        let end: Double
        let startsHere: Bool
        let endsHere: Bool
    }

    struct Track: Hashable, Sendable {
        let band: CalendarBand
        let segments: [Segment]
    }

    /// A Pentad beginning on a day: which (0 … 3, 3 the Hypopentad), of which sync, and when.
    struct PentadStart: Hashable, Sendable {
        let index: Int
        let sync: Int
        let start: Double
    }

    struct Day: Identifiable, Hashable, Sendable {
        let index: Int
        let year: Int
        let month: Int
        let day: Int
        let inMonth: Bool
        let weekday: Int
        /// The local day [start, end).
        let start: Double
        let end: Double
        /// Some of the day lies inside the catalogue (and the zone did not skip the date).
        let inRange: Bool
        /// The share of the day inside the catalogue, 0 … 1 (the band is cut there).
        let rangeFrom: Double
        let rangeTo: Double
        let eclipse: Int?
        let tracks: [Track]
        /// The Pentads that begin on the day, as a date carries its weekday (0, 1 or now and then 2: a Pentad is about a
        /// day, the Hypopentad 20 hours).
        let pentads: [PentadStart]

        var id: Int { index }
        var length: Double { end - start }
        var key: String { "\(year)-\(CalMath.pad(month))-\(CalMath.pad(day))" }
    }

    let year: Int
    let month: Int
    let weekStart: Int
    let days: [Day]
    let start: Double
    let end: Double

    /// - Parameters:
    ///   - weekStart: 1 Monday, 0 Sunday.
    ///   - syncRange: `CalMath.syncRange(clock)`, computed once.
    init(clock: FractonicaClock, zone: TimeZone, year: Int, month: Int, weekStart: Int, bands: [CalendarBand],
         syncRange: ClosedRange<Int>) {
        self.year = year
        self.month = month
        self.weekStart = weekStart
        let lead = (CalMath.weekday(year, month, 1) - weekStart + 7) % 7
        let first = CalMath.addDays(year, month, 1, -lead)
        let dates = (0...42).map { CalMath.addDays(first.year, first.month, first.day, $0) }
        let starts = dates.map { CalMath.dayStart(zone, $0.year, $0.month, $0.day) }
        start = starts[0]
        end = starts[42]
        let pieces = bands.map { band in (band, CalMonthGrid.items(clock: clock, band: band, from: starts[0], to: starts[42], syncRange: syncRange)) }
        // the Pentads of the six weeks, once: each day carries the ones that begin on it
        let pentadSpans = CalPentads.spans(clock, from: starts[0], to: starts[42])
        var pentadCursor = 0
        var cursor = [Int](repeating: 0, count: pieces.count)
        var out: [Day] = []
        for i in 0..<42 {
            let d = dates[i]
            let s = starts[i], e = starts[i + 1]
            let inRange = e > s && e > clock.tMin && s <= clock.tMax
            var tracks: [Track] = []
            if inRange {
                for (b, (band, items)) in pieces.enumerated() {
                    var j = cursor[b]
                    while j < items.count, items[j].end <= s { j += 1 }
                    cursor[b] = j
                    var segments: [Segment] = []
                    var k = j
                    while k < items.count, items[k].start < e {
                        let it = items[k]
                        segments.append(Segment(
                            x0: max(0, (it.start - s) / (e - s)), x1: min(1, (it.end - s) / (e - s)),
                            index: it.index, ordinal: it.ordinal, start: it.start, end: it.end,
                            startsHere: it.start >= s, endsHere: it.end < e))
                        k += 1
                    }
                    tracks.append(Track(band: band, segments: segments))
                }
            }
            var pentads: [PentadStart] = []
            while pentadCursor < pentadSpans.count, pentadSpans[pentadCursor].start < e {
                let p = pentadSpans[pentadCursor]
                // the catalogue's first Pentad is cut at its edge: it begins before it, not on that day
                if p.start >= s, p.start > clock.tMin { pentads.append(PentadStart(index: p.index, sync: p.sync, start: p.start)) }
                pentadCursor += 1
            }
            out.append(Day(
                index: i, year: d.year, month: d.month, day: d.day, inMonth: d.year == year && d.month == month,
                weekday: CalMath.weekday(d.year, d.month, d.day), start: s, end: e, inRange: inRange,
                rangeFrom: inRange ? max(0, (clock.tMin - s) / (e - s)) : 0,
                rangeTo: inRange ? min(1, (clock.tMax - s) / (e - s)) : 0,
                eclipse: inRange ? CalMath.eclipse(clock, in: s, e) : nil, tracks: tracks, pentads: pentads))
        }
        days = out
    }

    /// The index of the day holding t, or nil.
    func dayIndex(of t: Double) -> Int? {
        guard t >= start, t < end else { return nil }
        var lo = 0, hi = days.count - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if days[mid].start <= t { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    /// A cycle (or sync quarter) of a band in a window.
    struct Item: Hashable, Sendable {
        let index: Int64
        let ordinal: Int
        let start: Double
        let end: Double
    }

    /// The cycles of a band overlapping [t0, t1) inside the catalogue, in order.
    static func items(clock: FractonicaClock, band: CalendarBand, from t0: Double, to t1: Double,
                      syncRange: ClosedRange<Int>) -> [Item] {
        switch band {
        case .sync:
            return CalMath.syncQuarters(clock, from: t0, to: t1, range: syncRange).map {
                Item(index: Int64($0.sync), ordinal: $0.quarter, start: $0.start, end: $0.end)
            }
        case .pentad:
            return CalPentads.spans(clock, from: t0, to: t1).map {
                Item(index: Int64($0.sync), ordinal: $0.index, start: $0.start, end: $0.end)
            }
        case .level(let level):
            return cycles(clock: clock, level: level, from: t0, to: t1)
        }
    }

    /// The cycles of `level` overlapping [t0, t1) inside the catalogue: the one running at t0, then every boundary.
    static func cycles(clock: FractonicaClock, level: Int, from t0: Double, to t1: Double) -> [Item] {
        let lo = max(t0, clock.tMin), hi = min(t1, clock.tMax)
        guard hi > lo, let first = clock.level(at: lo, level) else { return [] }
        let siblings = clock.levelInfo(level).siblings
        let ordinal = { (index: Int64) -> Int in Int(siblings.map { index % Int64($0) } ?? index) + 1 }
        var starts: [(index: Int64, time: Double)] = [(first.cycle, first.start)]
        for b in clock.boundaries(level: level, from: lo, to: hi, limit: 4000) where b.idx > first.cycle && b.time < hi {
            starts.append((b.idx, b.time))
        }
        return starts.enumerated().map { i, s in
            let end = i + 1 < starts.count ? starts[i + 1].time : (clock.cycleStartTime(level: level, index: s.index + 1) ?? clock.tMax)
            return Item(index: s.index, ordinal: ordinal(s.index), start: s.time, end: end)
        }
    }
}

// MARK: - A day in detail

/// What happens on one local day: the boundaries of every level α … η at their time of day (a boundary of a coarse
/// level is also one of every finer level: it is listed once, under the coarsest), the solar sync quarters that begin,
/// the eclipse, and the cycles of the chosen bands that cover the day.
struct CalDayEvents: Sendable {
    struct Boundary: Identifiable, Hashable, Sendable {
        let time: Double
        /// The coarsest level that begins here, and how many finer levels begin with it.
        let level: Int
        let finest: Int
        let index: Int64
        let ordinal: Int
        var id: String { "\(level):\(index)" }
    }

    let boundaries: [Boundary]
    let syncs: [CalSyncQuarter]

    init(clock: FractonicaClock, from t0: Double, to t1: Double, levels: ClosedRange<Int> = 0...6, syncRange: ClosedRange<Int>) {
        var byTime: [Int64: Boundary] = [:]
        let lo = max(t0, clock.tMin), hi = min(t1, clock.tMax)
        if hi > lo {
            for level in levels {
                let siblings = clock.levelInfo(level).siblings
                for b in clock.boundaries(level: level, from: lo, to: hi, limit: 400) where b.time >= t0 && b.time < t1 {
                    let key = Int64((b.time * 1000).rounded())
                    if let existing = byTime[key] {
                        byTime[key] = Boundary(time: existing.time, level: existing.level, finest: level, index: existing.index, ordinal: existing.ordinal)
                    } else {
                        let ordinal = Int(siblings.map { b.idx % Int64($0) } ?? b.idx) + 1
                        byTime[key] = Boundary(time: b.time, level: level, finest: level, index: b.idx, ordinal: ordinal)
                    }
                }
            }
        }
        boundaries = byTime.values.sorted { $0.time < $1.time }
        syncs = CalMath.syncQuarters(clock, from: t0, to: t1, range: syncRange).filter { $0.start >= t0 && $0.start < t1 }
    }
}

// MARK: - The year ribbon

/// The months of a year as fractions of it, with the δ and ε cycle starts inside it (month.js `yearRibbon` and
/// `yearSummary`).
struct CalYearRibbon: Sendable {
    struct Month: Hashable, Sendable {
        let month: Int
        let x0: Double
        let x1: Double
        let inRange: Bool
    }

    struct Tick: Hashable, Sendable {
        let level: Int
        let x: Double
        let ordinal: Int
        let time: Double
    }

    let year: Int
    let start: Double
    let end: Double
    let months: [Month]
    let ticks: [Tick]
    /// How many δ and ε cycles the year covers (each cycle's overlapping fraction summed); nil outside the catalogue.
    let deltaCover: Double?
    let epsilonCover: Double?
    /// "γ#9·δ#3": the first and last δ of the year.
    let firstDelta: String?
    let lastDelta: String?

    init(clock: FractonicaClock, zone: TimeZone, year: Int) {
        self.year = year
        let starts = (0...12).map { m in m == 12 ? CalMath.dayStart(zone, year + 1, 1, 1) : CalMath.dayStart(zone, year, m + 1, 1) }
        start = starts[0]
        end = starts[12]
        let length = end - start
        months = (0..<12).map { m in
            Month(month: m + 1, x0: (starts[m] - starts[0]) / length, x1: (starts[m + 1] - starts[0]) / length,
                  inRange: starts[m + 1] > clock.tMin && starts[m] <= clock.tMax)
        }
        let delta = CalMonthGrid.cycles(clock: clock, level: 3, from: start, to: end)
        let epsilon = CalMonthGrid.cycles(clock: clock, level: 4, from: start, to: end)
        var ticks: [Tick] = []
        for (level, items) in [(3, delta), (4, epsilon)] {
            for c in items where c.start >= starts[0] && c.start < end {
                ticks.append(Tick(level: level, x: (c.start - starts[0]) / length, ordinal: c.ordinal, time: c.start))
            }
        }
        self.ticks = ticks
        let (s0, s1) = (start, end)
        let cover = { (items: [CalMonthGrid.Item], level: Int) -> Double? in
            guard !items.isEmpty else { return nil }
            let mean = clock.levelInfo(level).meanSeconds
            return items.reduce(0) { sum, c in
                let clipped = c.end >= clock.tMax && clock.cycleStartTime(level: level, index: c.index + 1) == nil
                let len = clipped ? mean : c.end - c.start
                return sum + (min(c.end, s1) - max(c.start, s0)) / len
            }
        }
        deltaCover = cover(delta, 3)
        epsilonCover = cover(epsilon, 4)
        let name = { (c: CalMonthGrid.Item) -> String in
            let path = clock.cycleToPath(level: 3, cycle: c.index)
            return "\(CalMath.cycleLabel(level: 2, ordinal: path[2]))·\(CalMath.cycleLabel(level: 3, ordinal: path[3]))"
        }
        firstDelta = delta.first.map(name)
        lastDelta = delta.count > 1 ? delta.last.map(name) : nil
    }

    /// "2026 covers 4.5 δ cycles (γ#9·δ#3 … γ#10·δ#2) and 22.5 ε cycles".
    var summary: String {
        guard let d = deltaCover, let e = epsilonCover else { return "\(year) lies outside the catalogue" }
        let range = [firstDelta, lastDelta].compactMap { $0 }.joined(separator: " … ")
        return "\(year) covers \(String(format: "%.1f", d)) δ cycles (\(range)) and \(String(format: "%.1f", e)) ε cycles"
    }
}
