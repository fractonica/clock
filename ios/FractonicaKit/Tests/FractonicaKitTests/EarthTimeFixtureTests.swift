import Foundation
import Testing
@testable import FractonicaKit

/// Earth-time formatting against format.json (src/core/format.js, run under Node's Intl with the same tz database
/// family as Foundation's `TimeZone`).
@Suite("Earth time fixtures")
struct EarthTimeFixtureTests {
    let fixture = Fixtures.format

    private func zone(_ id: String) -> TimeZone { TimeZone(identifier: id)! }

    @Test("Names, offsets, civil days and durations")
    func basics() {
        var check = Checker("format basics")
        check.equal(EarthTime.monthsShort, fixture["monthsShort"].strings, "monthsShort")
        check.equal(EarthTime.monthsLong, fixture["monthsLong"].strings, "monthsLong")
        check.equal(EarthTime.weekdaysShort, fixture["weekdaysShort"].strings, "weekdaysShort")
        for row in fixture["offsets"].array { check.equal(EarthTime.offsetLabel(row[0].double), row[1].string, "offsetLabel \(row[0].double)") }
        for row in fixture["civil"].array {
            let (y, m, d) = (row[0].int, row[1].int, row[2].int)
            check.equal(EarthTime.daysFromCivil(y, m, d), row[3].int, "daysFromCivil \(y)-\(m)-\(d)")
            let back = EarthTime.civilFromDays(row[3].int)
            check.equal([back.year, back.month, back.day], [y, m, d], "civilFromDays \(row[3].int)")
        }
        for row in fixture["daysInMonth"].array {
            check.equal(EarthTime.daysInMonth(row[0].int, row[1].int), row[2].int, "daysInMonth \(row[0].int)-\(row[1].int)")
        }
        for row in fixture["durations"].array {
            let s = row[0].double
            check.equal(EarthTime.duration(s), row[1].string, "duration \(s)")
            check.equal(EarthTime.duration(s, parts: 1), row[2].string, "duration \(s) parts 1")
            check.equal(EarthTime.duration(s, parts: 3), row[3].string, "duration \(s) parts 3")
            check.equal(EarthTime.duration(s, parts: 4), row[4].string, "duration \(s) parts 4")
            check.equal(EarthTime.countdown(s), row[5].string, "countdown \(s)")
        }
        for row in fixture["relative"].array {
            check.equal(EarthTime.relative(row[0].double, to: row[1].double), row[2].string, "relative \(row[0].double)")
        }
        check.report()
    }

    @Test("zonedParts / zonedToUnix in five zones")
    func zones() {
        var check = Checker("zones")
        for row in fixture["parts"].array {
            let z = row["zone"].string, t = row["t"].double, e = row["p"]
            let p = EarthTime.zonedParts(t, zone: zone(z))
            check.equal([p.year, p.month, p.day, p.hour, p.minute, p.second, p.ms, p.weekday, p.offset],
                        ["year", "month", "day", "hour", "minute", "second", "ms", "weekday", "offset"].map { e[$0].int },
                        "\(z) \(t)")
        }
        for row in fixture["toUnix"].array {
            let z = row["zone"].string, f = row["f"]
            let fields = EarthTime.CivilTime(
                year: f["year"].int, month: f["month"].int, day: f["day"].int,
                hour: f["hour"].optionalInt ?? 0, minute: f["minute"].optionalInt ?? 0,
                second: f["second"].optionalInt ?? 0, ms: f["ms"].optionalInt ?? 0
            )
            check.equal(EarthTime.zonedToUnix(fields, zone: zone(z)), row["t"].double, "\(z) \(fields)")
        }
        check.report()
    }

    @Test("Formatter methods in five zones")
    func formatter() {
        var check = Checker("formatter")
        for row in fixture["formatters"].array {
            let z = row["zone"].string, t = row["t"].double, ref = row["ref"].double
            let f = EarthFormatter(zone: z)
            let year = f.parts(t).year
            let what = "\(z) \(t)"
            check.equal(f.zone, z, "\(what) zone")
            check.equal(f.date(t), row["date"].string, "\(what) date")
            check.equal(f.time(t), row["time"].string, "\(what) time")
            check.equal(f.time(t, seconds: false), row["timeShort"].string, "\(what) time no seconds")
            check.equal(f.time(t, ms: true), row["timeMs"].string, "\(what) time ms")
            check.equal(f.dateTime(t), row["dateTime"].string, "\(what) dateTime")
            check.equal(f.dateTime(t, ms: true), row["dateTimeMs"].string, "\(what) dateTime ms")
            check.equal(f.long(t), row["long"].string, "\(what) long")
            check.equal(f.long(t, seconds: false), row["longShort"].string, "\(what) long no seconds")
            check.equal(f.short(t), row["short"].string, "\(what) short")
            check.equal(f.short(t, refYear: year), row["shortSameYear"].string, "\(what) short same year")
            check.equal(f.short(t, refYear: year + 1), row["shortOtherYear"].string, "\(what) short other year")
            check.equal(f.label(t, ref: ref), row["label"].string, "\(what) label")
            check.equal(f.label(t, ref: t), row["labelSelf"].string, "\(what) label self")
            check.equal(f.tag(t), row["tag"].string, "\(what) tag")
            check.equal(f.iso(t), row["iso"].string, "\(what) iso")
            check.equal(f.inputValue(t), row["inputValue"].string, "\(what) inputValue")
        }
        for row in fixture["parseInput"].array {
            let z = row["zone"].string, s = row["s"].string
            check.equal(EarthFormatter(zone: z).parseInput(s), row["t"].optionalDouble, "\(z) parse \"\(s)\"")
        }
        check.equal(EarthFormatter(zone: "Not/AZone").zone, EarthTime.systemZone, "unknown zone falls back to the device zone")
        check.report()
    }
}
