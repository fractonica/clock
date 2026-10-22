import Foundation

/// Gregorian dates and times as people type them: a port of `parseGregorian`, `normalize` and the zone lookup of
/// src/ui/calendar/parse.js.
///
///     2031-06-01 · 2031-06-01 14:30:15.250 · 1 Jun 2031 2pm · 2031-06-01T14:30Z · Thu 8 Oct 2026, 12:00:00
///     2031-06-01 14:30 Moscow (a city or IANA zone after the time) · 06/01/2031 (day/month or month/day)
enum GregorianParser {
    /// Longest input the jump box reads (the field has the same limit).
    static let maxInput = 200

    /// What was read: one or more instants (two for an ambiguous 06/01/2031), or why the text is not a valid date.
    enum Outcome {
        case error(String)
        case results([Reading])
    }

    /// One reading of a date-like text.
    struct Reading {
        var t: Double
        var fields: EarthTime.CivilTime
        var hasTime: Bool
        /// An explicit UTC offset in seconds (Z, +03:00), nil when the text gave none.
        var offset: Int?
        /// A zone named in the text ("Moscow"), when there was no explicit offset.
        var zone: String?
        /// "day", "month", "year" or "time" (a bare time on the reference day).
        var precision: String
        /// "compact", "day first", "month first", "day/month", "month/day".
        var note: String?
    }

    // MARK: - Text

    private static let dashes = JSRegex("[\u{2212}\u{2012}-\u{2015}]")
    private static let spaces = JSRegex("[\u{00A0}\u{2000}-\u{200B}\u{202F}\u{3000}]")
    private static let blanks = JSRegex("\\s+")

    /// NFKC, plain minus signs, one kind of space, collapsed and trimmed (parse.js `normalize`).
    static func normalize(_ text: String) -> String {
        var s = text.precomposedStringWithCompatibilityMapping
        s = dashes.replaceAll(s, "-")
        s = spaces.replaceAll(s, " ")
        s = blanks.replaceAll(s, " ")
        return s.jsTrim
    }

    // MARK: - Zones

    private static let zoneAliases: [(String, String)] = [
        ("kyiv", "Europe/Kyiv"), ("kolkata", "Asia/Kolkata"), ("yangon", "Asia/Yangon"), ("ho chi minh", "Asia/Ho_Chi_Minh"),
        ("sao paulo", "America/Sao_Paulo"),
    ]

    /// IANA zones by lower-case name, "name with spaces" and city; a city two zones share is left out.
    static let zoneIndex: [String: String] = {
        var map: [String: String] = [:]
        var shared = Set<String>()
        func put(_ key: String, _ zone: String) {
            if let existing = map[key], existing != zone { shared.insert(key) } else { map[key] = zone }
        }
        for z in TimeZone.knownTimeZoneIdentifiers.sorted() {
            guard z.contains("/"), !z.hasPrefix("Etc/") else { continue }
            let low = z.lowercased()
            put(low, z)
            put(low.replacingOccurrences(of: "_", with: " "), z)
            put((low.split(separator: "/").last.map(String.init) ?? low).replacingOccurrences(of: "_", with: " "), z)
        }
        for k in shared { map.removeValue(forKey: k) }
        for (alias, z) in zoneAliases where map[alias] == nil && TimeZone(identifier: z) != nil { map[alias] = z }
        return map
    }()

    /// "2031-06-01 14:30 new york" → (America/New_York, "2031-06-01 14:30"); nil when no zone ends the text.
    static func trailingZone(_ s: String) -> (zone: String, rest: String)? {
        let words = s.components(separatedBy: " ")
        guard words.count >= 2 else { return nil }
        for k in stride(from: min(4, words.count - 1), through: 1, by: -1) {
            if let zone = zoneIndex[words.suffix(k).joined(separator: " ")] {
                return (zone, words.dropLast(k).joined(separator: " "))
            }
        }
        return nil
    }

    /// Does the text name an IANA zone or a city ("Moscow", "europe/moscow", "new york")?
    static func mentionsZone(_ text: String) -> Bool {
        let s = normalize(text).jsLower
        guard !s.isEmpty else { return false }
        return zoneIndex[s] != nil || trailingZone(s) != nil
    }

    // MARK: - Locale

    /// Does a locale write the day before the month in a numeric date? nil when it cannot be told.
    static func dayFirst(locale: Locale) -> Bool? {
        guard let format = DateFormatter.dateFormat(fromTemplate: "yMd", options: 0, locale: locale) else { return nil }
        let d = format.firstIndex(of: "d"), m = format.firstIndex(of: "M")
        guard let d, let m else { return nil }
        return d < m
    }

    // MARK: - Parsing

    private static let punctuation = JSRegex("[;,]")
    private static let weekdays = JSRegex("\\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\\b\\.?")
    private static let fillers = JSRegex("\\b(?:at|on|the|of)\\b")
    private static let ordinalSuffix = JSRegex("(\\d)(?:st|nd|rd|th)\\b")
    private static let noon = JSRegex("\\bnoon\\b")
    private static let midnight = JSRegex("\\bmidnight\\b")
    private static let clockTime = JSRegex("(^|[\\st])(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,6}))?)?(?:\\s*(am|pm))?(?![\\d:])")
    private static let hourOnly = JSRegex("(^|\\s)(\\d{1,2})()()()\\s*(am|pm)\\b")
    private static let afterTime = JSRegex("^\\s*(?:(z|utc|gmt)\\s*)?([+-]\\d{1,2}(?::?\\d{2}(?::\\d{2})?)?)?(?=\\s|$)")
    private static let trailingUTC = JSRegex("\\s*\\b(z|utc|gmt)\\s*([+-]\\d{1,2}(?::?\\d{2}(?::\\d{2})?)?)?$")
    private static let offsetText = JSRegex("^([+-])(\\d{1,2})(?::?(\\d{2}))?(?::(\\d{2}))?$")

    static let monthWord = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?"
    private static let monthNumbers = ["jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12]
    private static func monthNum(_ w: String?) -> Int { monthNumbers[(w ?? "").jsSlice(0, 3)] ?? 0 }

    private static let isoDay = JSRegex("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})$")
    private static let isoMonth = JSRegex("^(\\d{4})[-/.](\\d{1,2})$")
    private static let yearOnly = JSRegex("^(\\d{4})$")
    private static let compact = JSRegex("^(\\d{4})(\\d{2})(\\d{2})$")
    private static let numericDMY = JSRegex("^(\\d{1,2})([./-])(\\d{1,2})\\2(\\d{4})$")
    private static let dayMonth = JSRegex("^(\\d{1,2})\\s+\(monthWord)(?:\\s+(\\d{4}))?$")
    private static let monthDay = JSRegex("^\(monthWord)\\s+(\\d{1,2})(?:\\s+(\\d{4}))?$")
    private static let monthYear = JSRegex("^\(monthWord)\\s+(\\d{4})$")
    private static let yearMonth = JSRegex("^(\\d{4})\\s+\(monthWord)(?:\\s+(\\d{1,2}))?$")
    private static let monthOnly = JSRegex("^\(monthWord)$")

    /// "+03:00" / "-0500" / "+3" / "+00:53:28" in seconds; 0 for a bare Z / UTC / GMT; nil when invalid.
    private static func offsetSeconds(_ zoneWord: String?, _ numeric: String?) -> Int? {
        if truthy(numeric) {
            guard let m = offsetText.exec(numeric!) else { return nil }
            let h = Int(m[2]!)!, mi = Int(m[3] ?? "0") ?? 0, s = Int(m[4] ?? "0") ?? 0
            if h > 14 || (truthy(m[3]) && mi > 59) || (truthy(m[4]) && s > 59) { return nil }
            return (m[1] == "-" ? -1 : 1) * (h * 3600 + mi * 60 + s)
        }
        return truthy(zoneWord) ? 0 : nil
    }

    private struct Option {
        var year: Int?
        var month: Int
        var day: Int
        var precision: String
        var note: String?
    }

    /// parse.js `parseGregorian`: nil when the text is not date-like, `.error` when it is but a value is invalid.
    /// Times without an explicit offset are read in `zone`; `ref` supplies a missing year or the day of a bare time.
    static func parse(_ text: String, zone: String = "UTC", ref: (year: Int, month: Int, day: Int)? = nil,
                      dayFirst: Bool? = nil, zoneNames: Bool = false) -> Outcome? {
        if text.jsLength > maxInput { return .error("That is \(text.jsLength) characters: dates and times are at most \(maxInput)") }
        var s = normalize(text).jsLower
        if s.isEmpty { return nil }
        s = punctuation.replaceAll(s, " ")
        s = weekdays.replaceAll(s, " ")
        s = fillers.replaceAll(s, " ")
        s = ordinalSuffix.replaceAll(s, "$1")
        s = noon.replaceAll(s, "12:00")
        s = midnight.replaceAll(s, "00:00")
        s = blanks.replaceAll(s, " ").jsTrim
        var zoneOverride: String?
        if zoneNames && !s.isEmpty, let z = trailingZone(s) {
            zoneOverride = z.zone
            s = z.rest
        }
        if s.isEmpty { return nil }

        // ---- time of day (+ offset)
        var time: (hour: Int, minute: Int, second: Int, ms: Int, ampm: String?)?
        var offset: Int?
        var rest = s
        let m = clockTime.exec(s) ?? hourOnly.exec(s)
        if let m {
            let hasMinute = m[3] != ""
            let frac = m[5]
            time = (
                hour: Int(m[2]!)!,
                minute: hasMinute ? Int(m[3]!)! : 0,
                second: truthy(m[4]) ? Int(m[4]!)! : 0,
                ms: truthy(frac) ? Int(JSNumber.round(Double("0." + frac!)! * 1000)) : 0,
                ampm: m[6]
            )
            var end = m.end
            if let after = afterTime.exec(s.jsSlice(end)), after.text.jsTrim != "" {
                let sec = offsetSeconds(after[1], after[2])
                if sec == nil && truthy(after[2]) {
                    return .error("\"\(after[2]!)\" is not a valid UTC offset (use +03:00, -0500 or Z)")
                }
                offset = sec ?? 0
                end += after.length
            }
            rest = blanks.replaceAll(s.jsSlice(0, m.index) + " " + s.jsSlice(end), " ").jsTrim
        } else if let z = trailingUTC.exec(s), z.index > 0 {
            offset = offsetSeconds(z[1], z[2]) ?? 0
            rest = s.jsSlice(0, z.index).jsTrim
        }
        if var t = time {
            if let ampm = t.ampm {
                if t.hour < 1 || t.hour > 12 { return .error("Hour \(t.hour) does not exist on a 12-hour clock (1–12)") }
                t.hour = t.hour % 12 + (ampm == "pm" ? 12 : 0)
            } else if t.hour > 23 {
                return .error("Hour \(t.hour) does not exist (0–23)")
            }
            if t.minute > 59 { return .error("Minute \(t.minute) does not exist (00–59)") }
            if t.second > 59 { return .error("Second \(t.second) does not exist (00–59)") }
            time = t
        }

        // ---- date
        let d = rest
        var options: [Option] = []
        func push(_ year: Int?, _ month: Int, _ day: Int, _ precision: String, _ note: String? = nil) {
            options.append(Option(year: year, month: month, day: day, precision: precision, note: note))
        }
        let int = { (x: String?) in Int(x ?? "") ?? 0 }
        if d.isEmpty {
            guard time != nil, let ref else { return nil }
            push(ref.year, ref.month, ref.day, "time")
        } else if let r = isoDay.exec(d) {
            push(int(r[1]), int(r[2]), int(r[3]), "day")
        } else if let r = isoMonth.exec(d) {
            push(int(r[1]), int(r[2]), 1, "month")
        } else if let r = yearOnly.exec(d) {
            push(int(r[1]), 1, 1, "year")
        } else if let r = compact.exec(d) {
            push(int(r[1]), int(r[2]), int(r[3]), "day", "compact")
        } else if let r = numericDMY.exec(d) {
            let a = int(r[1]), b = int(r[3]), y = int(r[4])
            if a > 12 && b > 12 { return .error("Neither \(a) nor \(b) can be a month (1–12)") }
            if a > 12 {
                push(y, b, a, "day", "day first")
            } else if b > 12 {
                push(y, a, b, "day", "month first")
            } else if r[2] == "/" || (dayFirst == false && r[2] == "-") {
                // both readings are offered; the locale decides which one comes first (Return takes the first)
                if dayFirst == false {
                    push(y, a, b, "day", "month/day")
                    if a != b { push(y, b, a, "day", "day/month") }
                } else {
                    push(y, b, a, "day", "day/month")
                    if a != b { push(y, a, b, "day", "month/day") }
                }
            } else {
                push(y, b, a, "day", "day first")
            }
        } else if let r = dayMonth.exec(d) {
            push(truthy(r[3]) ? int(r[3]) : ref?.year, monthNum(r[2]), int(r[1]), "day")
        } else if let r = monthDay.exec(d) {
            push(truthy(r[3]) ? int(r[3]) : ref?.year, monthNum(r[1]), int(r[2]), "day")
        } else if let r = monthYear.exec(d) {
            push(int(r[2]), monthNum(r[1]), 1, "month")
        } else if let r = yearMonth.exec(d) {
            push(int(r[1]), monthNum(r[2]), truthy(r[3]) ? int(r[3]) : 1, truthy(r[3]) ? "day" : "month")
        } else if let r = monthOnly.exec(d) {
            push(ref?.year, monthNum(r[1]), 1, "month")
        } else {
            return nil
        }

        var results: [Reading] = []
        var firstError: String?
        for o in options {
            guard let year = o.year else {
                if firstError == nil { firstError = "Add a year, e.g. " + d + " 2031" }
                continue
            }
            if o.month < 1 || o.month > 12 {
                if firstError == nil { firstError = "Month \(o.month) does not exist (1–12)" }
                continue
            }
            if year < 1000 {
                if firstError == nil { firstError = "Year \(year) is not supported (years 1000 to 9999 only)" }
                continue
            }
            let dim = EarthTime.daysInMonth(year, o.month)
            if o.day < 1 {
                if firstError == nil { firstError = "Day \(o.day) does not exist" }
                continue
            }
            if o.day > dim {
                if firstError == nil { firstError = "\(JumpMaths.monthsFull[o.month - 1]) \(year) has only \(dim) days" }
                continue
            }
            let fields = EarthTime.CivilTime(year: year, month: o.month, day: o.day, hour: time?.hour ?? 0,
                                             minute: time?.minute ?? 0, second: time?.second ?? 0, ms: time?.ms ?? 0)
            let t: Double
            if let offset {
                t = JumpMaths.utcSeconds(fields.year, fields.month, fields.day, fields.hour, fields.minute, fields.second)
                    - Double(offset) + Double(fields.ms) / 1000
            } else {
                t = JumpMaths.localToUnix(fields, zoneOverride ?? zone)
            }
            results.append(Reading(t: t, fields: fields, hasTime: time != nil, offset: offset,
                                   zone: offset == nil ? zoneOverride : nil, precision: o.precision, note: o.note))
        }
        if results.isEmpty { return .error(firstError ?? "Not a valid date") }
        return .results(results)
    }
}
