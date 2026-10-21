import Foundation

/// Time-zone aware civil time and Earth-unit durations: a port of the free functions of `src/core/format.js`.
/// Nothing here knows about the Fractonica clock.
///
/// Civil fields come from `TimeZone` offsets and proleptic-Gregorian day arithmetic, the calendar `Intl` uses in the
/// web app. (Foundation's `Calendar(identifier: .gregorian)` switches to the Julian calendar before 1582-10-15, which
/// would disagree with the web app for early dates; zone offsets, including the local-mean-time seconds of old dates,
/// come from the same tz database in both.)
public enum EarthTime {
    /// Civil fields of an instant in a zone (format.js `zonedParts`). `month` 1 … 12, `weekday` 0 = Sunday,
    /// `offset` = UTC offset in seconds (local − UTC).
    public struct Parts: Hashable, Sendable {
        public let year: Int
        public let month: Int
        public let day: Int
        public let hour: Int
        public let minute: Int
        public let second: Int
        public let ms: Int
        public let weekday: Int
        public let offset: Int
    }

    /// Civil fields to convert back to an instant (`zonedToUnix`); out-of-range fields roll over like `Date.UTC`.
    public struct CivilTime: Hashable, Sendable {
        public var year: Int
        public var month: Int
        public var day: Int
        public var hour: Int
        public var minute: Int
        public var second: Int
        public var ms: Int

        /// Month 1 … 12, day 1 … 31, 24-hour clock; larger or negative fields roll over.
        public init(year: Int, month: Int, day: Int, hour: Int = 0, minute: Int = 0, second: Int = 0, ms: Int = 0) {
            (self.year, self.month, self.day, self.hour, self.minute, self.second, self.ms) =
                (year, month, day, hour, minute, second, ms)
        }
    }

    /// Month and weekday names in English, as format.js `MONTHS_SHORT`, `MONTHS_LONG` and `WEEKDAYS_SHORT` (Sunday first).
    public static let monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    public static let monthsLong = [
        "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November",
        "December",
    ]
    public static let weekdaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    /// The device's zone identifier (format.js `SYSTEM_ZONE`).
    public static var systemZone: String { TimeZone.current.identifier }

    /// Civil fields of Unix time t in `zone`. The instant is rounded to whole milliseconds first, so the fraction can
    /// never reach 1000 ms. Times beyond JavaScript's Date range (±8.64e12 s) are clamped to it, NaN reads as 0.
    public static func zonedParts(_ t: Double, zone: TimeZone) -> Parts {
        let limit = dateRangeSeconds * 1000
        let totalMs = JSNumber.round(min(limit, max(-limit, t.isNaN ? 0 : t * 1000)))
        let whole = (totalMs / 1000).rounded(.down)
        let offset = zone.secondsFromGMT(for: Date(timeIntervalSince1970: whole))
        let local = Int64(whole) + Int64(offset)
        let days = Int(local >= 0 ? local / 86_400 : -((-local + 86_399) / 86_400))
        let seconds = Int(local - Int64(days) * 86_400)
        let (year, month, day) = civilFromDays(days)
        return Parts(
            year: year, month: month, day: day,
            hour: seconds / 3600, minute: seconds / 60 % 60, second: seconds % 60,
            ms: Int(totalMs - whole * 1000),
            weekday: floorMod(days + 4, 7), // 1970-01-01 was a Thursday
            offset: offset
        )
    }

    /// Inverse of `zonedParts` (format.js `zonedToUnix`). A local time that happens twice (clocks went back) resolves
    /// to the earlier instant; a skipped one (clocks went forward) resolves forward by the length of the gap.
    /// NaN for fields outside JavaScript's Date range (about ±275 000 years), where the web app throws.
    public static func zonedToUnix(_ fields: CivilTime, zone: TimeZone) -> Double {
        guard fields.year.magnitude <= dateRangeYears, fields.month.magnitude <= 12 * dateRangeYears else {
            return .nan
        }
        // The fields read as UTC, with month overflow rolled into the year as Date.setUTCFullYear does, and the rest
        // added in double arithmetic as Date's MakeTime / MakeDate do (exact below 2^53).
        let months = fields.month - 1
        let year = fields.year + Int((Double(months) / 12).rounded(.down))
        let days = Double(daysFromCivil(year, floorMod(months, 12) + 1, 1)) + Double(fields.day) - 1
        let g = days * 86_400 + Double(fields.hour) * 3600 + Double(fields.minute) * 60 + Double(fields.second)
        guard abs(g) <= dateRangeSeconds else { return .nan }
        let offsetAt = { (t: Double) in zonedParts(t, zone: zone).offset }
        // Candidate offsets: those in force a day before, at, and a day after the guess.
        var best: Double?
        for o in [offsetAt(g - 86_400), offsetAt(g), offsetAt(g + 86_400)] {
            let t = g - Double(o)
            if offsetAt(t) == o, best.map({ t < $0 }) ?? true { best = t }
        }
        // A gap: use the offset in force before the change.
        return (best ?? g - Double(offsetAt(g - 86_400))) + Double(fields.ms) / 1000
    }

    /// An offset like "+03:00"; local-mean-time offsets keep their seconds ("+02:30:17").
    public static func offsetLabel(_ offsetSeconds: Double) -> String {
        let sign = offsetSeconds < 0 ? "-" : "+"
        let a = abs(JSNumber.round(offsetSeconds))
        let seconds = a.truncatingRemainder(dividingBy: 60)
        let hours = pad((a / 3600).rounded(.down))
        let minutes = pad((a.truncatingRemainder(dividingBy: 3600) / 60).rounded(.down))
        // JS appends the seconds when they are truthy: neither 0 nor NaN.
        return "\(sign)\(hours):\(minutes)" + (seconds != 0 && !seconds.isNaN ? ":\(pad(seconds))" : "")
    }

    /// Days since 1970-01-01 of a proleptic-Gregorian date (Howard Hinnant's algorithm, with format.js's floor
    /// divisions, so months outside 1 … 12 give the web app's numbers too).
    public static func daysFromCivil(_ y: Int, _ m: Int, _ d: Int) -> Int {
        let y = m <= 2 ? y - 1 : y
        let era = Int((Double(y) / 400).rounded(.down))
        let yoe = y - era * 400
        let doy = Int((Double(153 * (m + (m > 2 ? -3 : 9)) + 2) / 5).rounded(.down)) + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    /// The proleptic-Gregorian date of a day count since 1970-01-01 (inverse of `daysFromCivil`).
    public static func civilFromDays(_ days: Int) -> (year: Int, month: Int, day: Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let day = doy - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }

    /// Days in a month (1 … 12) of the proleptic Gregorian calendar.
    public static func daysInMonth(_ year: Int, _ month: Int) -> Int {
        let next = month == 12 ? daysFromCivil(year + 1, 1, 1) : daysFromCivil(year, month + 1, 1)
        return next - daysFromCivil(year, month, 1)
    }

    /// Compact duration: "72.1 y", "3 d 4 h", "5 h 3 min", "7.8 s", "310 ms"; `parts` consecutive units in the mixed
    /// form (default 2). Negative spans start with "−".
    public static func duration(_ seconds: Double, parts: Int = 2) -> String {
        var s = abs(seconds)
        let year = 31_557_600.0
        let out: String
        if s < 1 {
            out = "\(JSNumber.string(JSNumber.round(s * 1000))) ms"
        } else if s < 10 {
            out = "\(JSNumber.fixed(s, 1)) s"
        } else if s >= year * 2 {
            out = "\(JSNumber.fixed(s / year, 1)) y"
        } else if s >= year {
            out = "\(JSNumber.fixed(s / year, 2)) y"
        } else {
            let units: [(name: String, size: Double)] = [("d", 86_400), ("h", 3600), ("min", 60), ("s", 1)]
            // Only NaN reaches here without a unit (JS then slices nothing and prints "").
            let first = units.firstIndex { s >= $0.size } ?? units.count
            out = units[first..<min(units.count, first + max(0, parts))].map { unit in
                let n = (s / unit.size).rounded(.down)
                s -= n * unit.size
                return "\(JSNumber.string(n)) \(unit.name)"
            }.joined(separator: " ")
        }
        return seconds < 0 ? "−" + out : out
    }

    /// Live countdown: "in 3 d 04 h", "in 12 min 04 s", "in 7.5 s"; negative spans read "3 min 00 s ago".
    public static func countdown(_ seconds: Double) -> String {
        let s = abs(seconds)
        let floor = { (x: Double) in JSNumber.string(x.rounded(.down)) }
        let out: String
        if s < 60 {
            out = "\(s < 10 ? JSNumber.fixed((s * 10).rounded(.down) / 10, 1) : floor(s)) s"
        } else if s < 3600 {
            out = "\(floor(s / 60)) min \(pad(s.truncatingRemainder(dividingBy: 60))) s"
        } else if s < 86_400 {
            out = "\(floor(s / 3600)) h \(pad(s.truncatingRemainder(dividingBy: 3600) / 60)) min"
        } else if s < 31_557_600 {
            out = "\(floor(s / 86_400)) d \(pad(s.truncatingRemainder(dividingBy: 86_400) / 3600)) h"
        } else {
            out = "\(floor(s / 31_557_600)) y \(floor(s.truncatingRemainder(dividingBy: 31_557_600) / 86_400)) d"
        }
        return seconds < 0 ? "\(out) ago" : "in \(out)"
    }

    /// Relative description of t seen from `ref` ("in 3 d 04 h").
    public static func relative(_ t: Double, to ref: Double) -> String { countdown(t - ref) }

    /// format.js `pad`: `String(Math.trunc(Math.abs(n)))` zero-padded to `width` characters ("NaN" stays "NaN").
    static func pad(_ n: Double, width: Int = 2) -> String {
        zeroPadded(JSNumber.string(abs(n).rounded(.towardZero)), width)
    }

    static func pad(_ n: Int, width: Int = 2) -> String {
        zeroPadded(String(n.magnitude), width)
    }

    private static func zeroPadded(_ digits: String, _ width: Int) -> String {
        digits.count >= width ? digits : String(repeating: "0", count: width - digits.count) + digits
    }

    /// JavaScript's Date range: ±8.64e15 ms around 1970, about ±275 760 years.
    static let dateRangeSeconds = 8.64e12
    static let dateRangeYears: UInt = 300_000
}
