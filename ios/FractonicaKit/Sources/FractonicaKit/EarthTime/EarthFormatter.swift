import Foundation

/// Earth-time formatting bound to one zone: format.js `createFormatter`. Output shapes match the web app
/// (en-GB order, 24-hour clock): "2026-10-08", "14:23:07", "Thu 8 Oct 2026, 14:23:07", "Oct 9 01:34".
public struct EarthFormatter: Sendable {
    /// The IANA identifier in use.
    public let zone: String
    public let timeZone: TimeZone

    /// Bound to an IANA zone; nil or an unknown identifier falls back to the device zone, as in the web app.
    public init(zone identifier: String?) {
        if let identifier, let tz = TimeZone(identifier: identifier) {
            zone = identifier
            timeZone = tz
        } else {
            zone = EarthTime.systemZone
            timeZone = .current
        }
    }

    /// Bound to a Foundation zone; `zone` is its identifier.
    public init(timeZone: TimeZone) {
        zone = timeZone.identifier
        self.timeZone = timeZone
    }

    /// Civil fields of t in this zone (`EarthTime.zonedParts`).
    public func parts(_ t: Double) -> EarthTime.Parts { EarthTime.zonedParts(t, zone: timeZone) }

    /// The instant of civil fields in this zone (`EarthTime.zonedToUnix`).
    public func toUnix(_ fields: EarthTime.CivilTime) -> Double { EarthTime.zonedToUnix(fields, zone: timeZone) }

    /// "2026-10-09"
    public func date(_ t: Double) -> String {
        let p = parts(t)
        return "\(p.year)-\(EarthTime.pad(p.month))-\(EarthTime.pad(p.day))"
    }

    /// "14:23", "14:23:07" or "14:23:07.123"
    public func time(_ t: Double, seconds: Bool = true, ms: Bool = false) -> String {
        let p = parts(t)
        var s = "\(EarthTime.pad(p.hour)):\(EarthTime.pad(p.minute))"
        if seconds { s += ":\(EarthTime.pad(p.second))" }
        if ms { s += ".\(EarthTime.pad(p.ms, width: 3))" }
        return s
    }

    /// "2026-10-09 14:23:07"
    public func dateTime(_ t: Double, seconds: Bool = true, ms: Bool = false) -> String {
        "\(date(t)) \(time(t, seconds: seconds, ms: ms))"
    }

    /// "Fri 9 Oct 2026, 14:23:07"
    public func long(_ t: Double, seconds: Bool = true) -> String {
        let p = parts(t)
        return "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year), "
            + time(t, seconds: seconds)
    }

    /// "Oct 9 14:23", compact; the year is omitted when it equals `refYear`.
    public func short(_ t: Double, refYear: Int? = nil) -> String {
        let p = parts(t)
        let year = refYear == p.year ? "" : " \(p.year)"
        return "\(EarthTime.monthsShort[p.month - 1]) \(p.day)\(year) \(EarthTime.pad(p.hour)):\(EarthTime.pad(p.minute))"
    }

    /// SPEC §8 info label: local time with seconds, or "Mon D HH:MM" when t falls on another local day than `ref`.
    public func label(_ t: Double, ref: Double) -> String {
        let a = parts(t), b = parts(ref)
        if a.year == b.year && a.month == b.month && a.day == b.day { return time(t, seconds: true) }
        return "\(EarthTime.monthsShort[a.month - 1]) \(a.day) \(EarthTime.pad(a.hour)):\(EarthTime.pad(a.minute))"
    }

    /// "UTC+03:00" at t ("UTC" for the UTC zone itself).
    public func tag(_ t: Double) -> String {
        zone == "UTC" ? "UTC" : "UTC" + EarthTime.offsetLabel(Double(parts(t).offset))
    }

    /// ISO 8601 with offset: "2026-10-09T14:23:07+03:00".
    public func iso(_ t: Double) -> String {
        "\(date(t))T\(time(t))\(EarthTime.offsetLabel(Double(parts(t).offset)))"
    }

    /// The value of a date-and-time field: "2026-10-09T14:23:07".
    public func inputValue(_ t: Double) -> String { "\(date(t))T\(time(t))" }

    /// Parse "YYYY-MM-DD", "YYYY-MM-DD HH:MM", "…T HH:MM:SS" or "…:SS.mmm" in this zone; nil if malformed or not a
    /// real date.
    public func parseInput(_ value: String) -> Double? {
        let pattern = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,3}))?)?)?$/
        guard let m = value.trimmingCharacters(in: .whitespacesAndNewlines).wholeMatch(of: pattern) else { return nil }
        let number = { (s: Substring?) in s.map { Int($0)! } ?? 0 }
        let fields = EarthTime.CivilTime(
            year: Int(m.1)!, month: Int(m.2)!, day: Int(m.3)!,
            hour: number(m.4), minute: number(m.5), second: number(m.6),
            ms: m.7.map { Int($0.padding(toLength: 3, withPad: "0", startingAt: 0))! } ?? 0
        )
        guard (1...12).contains(fields.month), fields.day >= 1,
              fields.day <= EarthTime.daysInMonth(fields.year, fields.month),
              fields.hour <= 23, fields.minute <= 59, fields.second <= 59 else { return nil }
        return toUnix(fields)
    }

    /// `EarthTime.duration`: "3 d 4 h" (zone-independent, kept here as createFormatter keeps it).
    public func duration(_ seconds: Double, parts: Int = 2) -> String { EarthTime.duration(seconds, parts: parts) }

    /// `EarthTime.countdown`: "in 12 min 04 s".
    public func countdown(_ seconds: Double) -> String { EarthTime.countdown(seconds) }

    /// `EarthTime.relative`: t seen from `ref`, "in 3 d 04 h".
    public func relative(_ t: Double, to ref: Double) -> String { EarthTime.relative(t, to: ref) }
}
