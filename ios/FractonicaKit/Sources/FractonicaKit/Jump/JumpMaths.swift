import Foundation
import Synchronization

/// The calendar-mapping maths the jump grammars stand on: a port of the parts of src/ui/calendar/convert.js they use
/// (catalogue text, exact landings, cycle points, addresses, civil-day arithmetic, wall-time notes, sync range,
/// the description of a target instant). Pure functions of the clock; times are Unix seconds.
enum JumpMaths {
    /// The period letters of depth 1 … 14 (convert.js `LETTERS`).
    static let letters = Array("αβγδεζηθικλμνξ").map(String.init)
    static let levelNames = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu", "Nu", "Xi"]
    static let monthsFull = EarthTime.monthsLong

    /// The letter of a level, as JavaScript indexes `LETTERS` ("undefined" past ξ).
    static func letter(_ level: Int) -> String { level >= 0 && level < letters.count ? letters[level] : "undefined" }
    static func levelName(_ level: Int) -> String { level >= 0 && level < levelNames.count ? levelNames[level] : "undefined" }

    /// Points of a cycle (convert.js `POINTS` without "phase"): id, label, phase.
    static let points: [(id: String, label: String, phase: Double)] = [
        ("begin", "Begin", 0), ("peak", "Peak", 0.25), ("node", "Node", 0.5), ("valley", "Valley", 0.75), ("end", "End", 1),
    ]

    /// Round to whole milliseconds (`r3`).
    static func r3(_ t: Double) -> Double { JSNumber.round(t * 1000) / 1000 }

    /// `Math.ceil(t * 1000) / 1000`.
    static func ceilMs(_ t: Double) -> Double { (t * 1000).rounded(.up) / 1000 }

    static func an(_ word: String) -> String {
        guard let first = word.lowercased().first else { return "a" }
        return "aeiou".contains(first) ? "an" : "a"
    }

    /// Echo user text inside a label: at most `max` UTF-16 units, cut with an ellipsis.
    static func clip(_ text: String, _ max: Int = 40) -> String {
        text.jsLength <= max ? text : text.jsSlice(0, max - 1).jsTrimEnd + "…"
    }

    /// `String(n)` of a JavaScript number.
    static func num(_ x: Double) -> String { JSNumber.string(x) }

    /// 1st, 2nd, 3rd, 4th …
    static func ordinal(_ n: Int) -> String {
        let v = n % 100
        if v >= 11 && v <= 13 { return "\(n)th" }
        let d = n % 10
        return "\(n)" + (d > 3 || d < 0 ? "th" : ["th", "st", "nd", "rd"][d])
    }

    static func pad2(_ n: Int) -> String { String(abs(n)).padStart(2) }

    // MARK: - Catalogue text

    /// "1613-05-19": a Unix time as a UTC date.
    static func utcDate(_ t: Double) -> String {
        let p = EarthTime.zonedParts(t, zone: utc)
        return "\(p.year)-\(pad2(p.month))-\(pad2(p.day))"
    }

    /// "1613-05-19 … 2857-06-13"
    static func catalogueRangeText(_ clock: FractonicaClock) -> String {
        "\(utcDate(clock.tMin)) … \(utcDate(clock.tMax))"
    }

    /// "1613-05-19 17:41:53"
    static func utcStamp(_ t: Double) -> String {
        let p = EarthTime.zonedParts(t, zone: utc)
        return "\(utcDate(t)) \(pad2(p.hour)):\(pad2(p.minute)):\(pad2(p.second))"
    }

    /// Why `t` is outside the catalogue ("before …" / "after …"), or nil inside it.
    static func rangeProblem(_ clock: FractonicaClock, _ t: Double) -> String? {
        if clock.inRange(t) { return nil }
        let before = t < clock.tMin
        let edge = before ? clock.tMin : clock.tMax
        let text = abs(t - edge) < 2 * 86_400 ? utcStamp(edge) : utcDate(edge)
        return before ? "before the catalogue starts (\(text) UTC)" : "after the catalogue ends (\(text) UTC)"
    }

    // MARK: - Landing on boundaries

    /// A time that is sure to show the cycle (or state) that begins at the boundary `t` (convert.js `landOn`).
    static func landOn(_ clock: FractonicaClock, _ t: Double, level: Int? = nil, want: ((Double) -> Bool)? = nil) -> Double {
        guard t.isFinite else { return t }
        var c = ceilMs(t)
        if let want {
            var i = 0
            while i < 3 && !want(c) {
                c = r3(c + 0.001)
                i += 1
            }
            return c
        }
        guard let level else { return c }
        for _ in 0..<3 {
            guard let l = clock.level(at: c, level) else { return c }
            if abs(l.start - t) < 5e-3 || l.start > t { return c }
            c = r3(c + 0.001)
        }
        return c
    }

    /// Time of the point at fraction `phase` of cycle `idx` (global) of `level`; nil beyond the catalogue.
    static func pointOfCycle(_ clock: FractonicaClock, _ level: Int, _ idx: Double, _ phase: Double = 0) -> Double? {
        let p = clock.levelInfo(level).prefixDouble
        let e = clock.catalogue
        let ext = Double(clock.extent)
        let n = idx * 4 + phase * 4
        guard n >= 0 else { return nil }
        let k = (n / p).rounded(.down)
        if k > ext { return nil }
        let rem = n - k * p
        if k == ext { return rem == 0 ? clock.tMax : nil }
        let i = Int(k)
        return e[i] + (rem / p) * (e[i + 1] - e[i])
    }

    // MARK: - Addresses

    /// "ε#5"
    static func cycleLabel(_ level: Int, _ n: Int) -> String { "\(letter(level))#\(n)" }

    /// "α#6 β#4 γ#9"
    static func pathText(_ path: [Int]) -> String {
        path.enumerated().map { cycleLabel($0.offset, $0.element) }.joined(separator: " ")
    }

    /// "α#6 › β#4 › γ#9" (`from`: the level of the first entry).
    static func chainText(_ path: [Int], from: Int = 0) -> String {
        path.enumerated().map { cycleLabel(from + $0.offset, $0.element) }.joined(separator: " › ")
    }

    /// The 1-based path of the cycles containing t, `depth` entries long; nil out of range.
    static func pathOfTime(_ clock: FractonicaClock, _ t: Double, _ depth: Int) -> [Int]? {
        var path: [Int] = []
        for level in 0..<depth {
            guard let l = clock.level(at: t, level) else { return nil }
            path.append(l.local + 1)
        }
        return path
    }

    /// "α#6 β#4 γ#9 δ#3 ε#5" of an instant, or nil out of range.
    static func addressText(_ clock: FractonicaClock, _ t: Double, depth: Int = 5) -> String? {
        guard clock.inRange(t), let path = pathOfTime(clock, t, depth) else { return nil }
        return pathText(path)
    }

    /// The number of cycles inside the catalogue directly under `parentPath` ([] = the Alphas).
    static func childCount(_ clock: FractonicaClock, _ parentPath: [Int]) -> Int {
        if parentPath.isEmpty { return Int(clock.count(0)) }
        let siblings = clock.levelInfo(parentPath.count).siblings ?? 0
        var n = 0
        for i in stride(from: 1, through: siblings, by: 1) {
            if clock.pathToCycle(parentPath + [i]) == nil { break }
            n = i
        }
        return n
    }

    /// Facts of the cycle at a valid path.
    static func cycleOfPath(_ clock: FractonicaClock, _ path: [Int]) -> (level: Int, idx: Int64, facts: CycleFacts)? {
        guard let idx = clock.pathToCycle(path), let facts = clock.cycle(level: path.count - 1, index: idx) else { return nil }
        return (path.count - 1, idx, facts)
    }

    // MARK: - Civil days and wall times

    static let utc = TimeZone(identifier: "UTC")!

    /// The `TimeZone` of an identifier (the device zone for an unknown one).
    static func timeZone(_ id: String) -> TimeZone { TimeZone(identifier: id) ?? .current }

    /// Add n civil days to a date (JavaScript `Date.UTC`, which reads years 0 … 99 as 1900 … 1999).
    static func addDays(_ y: Int, _ m: Int, _ d: Int, _ n: Int) -> (year: Int, month: Int, day: Int) {
        let year = (0...99).contains(y) ? y + 1900 : y
        let months = m - 1
        let yy = year + Int((Double(months) / 12).rounded(.down))
        let mm = ((months % 12) + 12) % 12 + 1
        let days = EarthTime.daysFromCivil(yy, mm, 1) + d - 1 + n
        return EarthTime.civilFromDays(days)
    }

    /// Unix seconds of civil fields read as UTC (no shift of years 0 … 99), with JavaScript's roll-over.
    static func utcSeconds(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0, _ second: Int = 0) -> Double {
        let months = month - 1
        let yy = year + Int((Double(months) / 12).rounded(.down))
        let mm = ((months % 12) + 12) % 12 + 1
        let days = Double(EarthTime.daysFromCivil(yy, mm, 1)) + Double(day) - 1
        return days * 86_400 + Double(hour) * 3600 + Double(minute) * 60 + Double(second)
    }

    /// Civil fields in `zone` → Unix seconds (fold: the earlier instant; gap: forward).
    static func localToUnix(_ f: EarthTime.CivilTime, _ zone: String) -> Double {
        EarthTime.zonedToUnix(f, zone: timeZone(zone))
    }

    /// The instants that show exactly these wall-clock fields in `zone`: none in a gap, two in a fold.
    private static func localTimes(_ f: EarthTime.CivilTime, _ zone: String) -> [Double] {
        let tz = timeZone(zone)
        let g = utcSeconds(f.year, f.month, f.day, f.hour, f.minute, f.second)
        var offsets: [Int] = []
        for x in [g - 86_400, g, g + 86_400] {
            let o = EarthTime.zonedParts(x, zone: tz).offset
            if !offsets.contains(o) { offsets.append(o) }
        }
        var out: [Double] = []
        for o in offsets {
            let t = g - Double(o)
            if EarthTime.zonedParts(t, zone: tz).offset == o { out.append(t) }
        }
        return out.sorted()
    }

    /// The sentence for a wall time that a zone does not have exactly once, or "".
    static func wallTimeNote(_ f: EarthTime.CivilTime, zone: String, t: Double, formatter: EarthFormatter, where place: String = "there") -> String {
        let times = localTimes(f, zone)
        if times.count == 1 { return "" }
        let hm = "\(pad2(f.hour)):\(pad2(f.minute))"
        if times.isEmpty {
            return "\(hm) does not exist \(place) (the clocks skip it): moved ahead to \(formatter.time(r3(t), seconds: false))"
        }
        return "\(hm) happens twice \(place) (the clocks go back): showing the first"
    }

    /// The first instant of the local day y-m-d in `zone` (robust against clock changes at midnight and skipped days).
    static func dayStart(_ zone: String, _ y: Int, _ m: Int, _ d: Int) -> Double {
        let tz = timeZone(zone)
        let target = EarthTime.daysFromCivil(y, m, d)
        func dn(_ t: Double) -> Int {
            let p = EarthTime.zonedParts(t, zone: tz)
            return EarthTime.daysFromCivil(p.year, p.month, p.day)
        }
        var hi = localToUnix(EarthTime.CivilTime(year: y, month: m, day: d), zone)
        if dn(hi) == target && dn(hi - 1) < target { return hi }
        var guardCount = 0
        while dn(hi) < target {
            guardCount += 1
            if guardCount > 100 { break }
            hi += 900
        }
        guardCount = 0
        var lo = hi - 900
        while dn(lo) >= target {
            guardCount += 1
            if guardCount > 100 { break }
            hi = lo
            lo -= 900
        }
        while hi - lo > 1 {
            let mid = ((lo + hi) / 2).rounded(.down)
            if dn(mid) >= target { hi = mid } else { lo = mid }
        }
        return hi
    }

    /// "+03:00", or "+00:53:28" for an offset with seconds.
    static func isoOffset(_ offsetSeconds: Int) -> String {
        let sign = offsetSeconds < 0 ? "-" : "+"
        let a = abs(offsetSeconds)
        let sec = a % 60
        return "\(sign)\(pad2(a / 3600)):\(pad2((a % 3600) / 60))" + (sec != 0 ? ":\(pad2(sec))" : "")
    }

    // MARK: - Solar syncs

    private static let sharedSyncRange = Mutex<(first: Int, last: Int)?>(nil)

    /// The first and last sync number that lies completely inside the catalogue.
    static func syncRange(_ clock: FractonicaClock) -> (first: Int, last: Int) {
        let shared = clock === FractonicaClock.shared
        if shared, let hit = sharedSyncRange.withLock({ $0 }) { return hit }
        var lo = clock.solar(at: clock.tMin + 6 * 86_400)?.sync ?? 0
        var hi = clock.solar(at: clock.tMax - 6 * 86_400)?.sync ?? 0
        while clock.solarSync(number: lo - 1) != nil { lo -= 1 }
        while clock.solarSync(number: lo) == nil { lo += 1 }
        while clock.solarSync(number: hi + 1) != nil { hi += 1 }
        while clock.solarSync(number: hi) == nil { hi -= 1 }
        let r = (lo, hi)
        if shared { sharedSyncRange.withLock { $0 = r } }
        return r
    }

    // MARK: - Description of a target

    /// "in 3 d 04 h" / "the displayed time".
    static func relativeText(_ formatter: EarthFormatter, _ t: Double, _ ref: Double) -> String {
        abs(t - ref) < 0.5 ? "the displayed time" : formatter.countdown(t - ref)
    }

    /// "Thu 8 Oct 2026, 12:00:00 UTC · α#6 β#4 γ#9 δ#3 ε#5 · in 3 d 04 h"
    static func describeTime(_ clock: FractonicaClock, _ formatter: EarthFormatter, _ t: Double, ref: Double, date: Bool = true) -> String {
        var parts: [String] = []
        if date { parts.append("\(formatter.long(r3(t))) \(formatter.tag(r3(t)))") }
        if let a = addressText(clock, t) { parts.append(a) }
        parts.append(relativeText(formatter, t, ref))
        return parts.joined(separator: " · ")
    }
}
