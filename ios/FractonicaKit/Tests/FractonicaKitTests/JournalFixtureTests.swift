import Testing
@testable import FractonicaKit

/// The journal face reading against journal.json (src/ui/face/journal.js).
@Suite("Journal fixtures")
struct JournalFixtureTests {
    let fixture = Fixtures.journal

    @Test("Units, clamping and ordinals")
    func basics() {
        var check = Checker("journal basics")
        check.equal(Journal.units.map(\.level), fixture["units"].array.map { $0[0].int }, "unit levels")
        check.equal(Journal.units.map(\.id), fixture["units"].array.map { $0[1].string }, "unit ids")
        check.equal(Journal.maxUnit, fixture["maxUnit"].int, "maxUnit")
        for row in fixture["clampUnit"].array {
            let input = row[0].optionalDouble ?? .nan // null stands for NaN
            check.equal(Journal.clampUnit(input), row[1].int, "clampUnit(\(input))")
            if input == input.rounded() { check.equal(Journal.clampUnit(Int(input)), row[1].int, "clampUnit(Int \(input))") }
        }
        for row in fixture["ordinal"].array { check.equal(Journal.ordinal(row[0].int), row[1].string, "ordinal \(row[0].int)") }
        check.report()
    }

    @Test("Readings for every unit")
    func readings() {
        var check = Checker("journal readings")
        for row in fixture["readings"].array {
            let t = row["t"].double, u = row["u"].int
            let what = "t=\(t) u=\(u)"
            let r = Journal.reading(at: t, unit: u), e = row["r"]
            guard check.presence(r != nil, !e.isNull, what), let r else { continue }
            check.equal(r.unit, e["unit"].int, "\(what) unit")
            check.equal(r.levels, e["levels"].ints, "\(what) levels")
            check.equal(r.leadLevel, e["lead"]["level"].int, "\(what) lead level")
            check.equal(r.leadLetter, e["lead"]["letter"].string, "\(what) lead letter")
            check.fraction(r.leadPhase, e["lead"]["phase"].double, "\(what) lead phase")
            check.equal(r.tokens, e["tokens"].isNull ? nil : e["tokens"].array.map { Journal.Token(level: $0["level"].int, text: $0["text"].string) },
                        "\(what) tokens")
            check.equal(r.major, e["major"].isNull ? nil : Journal.Major(level: e["major"]["level"].int, lines: e["major"]["lines"].strings,
                                                                         index3: e["major"]["index3"].int), "\(what) major")
        }
        check.report()
    }

    @Test("Arc points")
    func arcs() {
        let g = fixture["geometry"]
        var check = Checker("arcPoint")
        for row in fixture["arcs"].array {
            let f = row[0].double
            let p = Journal.arcPoint(f, cl: g["cl"].double, cr: g["cr"].double, cy: g["cy"].double, r: g["R"].double)
            // cos / sin may differ from V8's in the last ulp
            for (actual, key) in [(p.x, "x"), (p.y, "y"), (p.nx, "nx"), (p.ny, "ny")] {
                check.near(actual, row[1][key].double, 1e-9, "arcPoint(\(f)).\(key)")
            }
        }
        check.report()
    }
}
