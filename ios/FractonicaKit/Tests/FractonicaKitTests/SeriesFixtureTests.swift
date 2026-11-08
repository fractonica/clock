import Testing
@testable import FractonicaKit

/// Clocks on other Saros series against series.json (ios/scripts/make-series-fixtures.mjs): the web model built on each
/// series' catalogue and solar anchor, read at sample times — position, every level 0 … 13, the solar sync, the Pentad.
@Suite("Series fixtures")
struct SeriesFixtureTests {
    @Test("Catalogue, anchor and readings on Saros 117, 128, 145, 152")
    func series() throws {
        for file in Fixtures.series["series"].array {
            let n = file["series"].int
            let clock = try #require(FractonicaClock.on(series: n))
            var check = Checker("Saros \(n)")
            check.equal(clock.solarAnchor, file["anchor"].int, "anchor")
            check.equal(SarosCatalogue.series(n)?.solarAnchor, file["anchor"].int, "series anchor")
            check.equal(clock.extent, file["extent"].int, "extent")
            check.equal(clock.catalogue, file["catalogue"].doubles, "catalogue")
            check.equal(clock.meanSaros, file["meanSaros"].double, "meanSaros")
            for (level, count) in file["counts"].strings.enumerated() {
                check.equal(String(clock.count(level)), count, "count L\(level)")
            }
            for sample in file["samples"].array {
                let t = sample["t"].double
                let at = "Saros \(n) t=\(t)"
                check.equal(clock.position(at: t), sample["pos"].optionalDouble, "\(at) position")
                for (level, record) in sample["levels"].array.enumerated() {
                    let r = clock.level(at: t, level)
                    let what = "\(at) L\(level)"
                    guard check.presence(r != nil, !record.isNull, what), let r else { continue }
                    let f = record.array
                    check.equal(r.cycle, Int64(f[0].int), "\(what) cycle")
                    check.equal(r.local, f[1].int, "\(what) local")
                    check.fraction(r.phase, f[2].double, "\(what) phase")
                    check.equal(r.quarter, f[3].int, "\(what) quarter")
                    check.equal(r.index, f[4].int, "\(what) index")
                    check.time(r.start, f[5].double, "\(what) start")
                    check.time(r.end, f[6].double, "\(what) end")
                    check.equal(r.clipped, f[7].bool, "\(what) clipped")
                    check.equal(r.next.name, f[8].string, "\(what) next")
                    check.time(r.next.time, f[9].optionalDouble, "\(what) next time")
                }
                let s = clock.solar(at: t), e = sample["solar"]
                if check.presence(s != nil, !e.isNull, "\(at) solar"), let s {
                    check.equal(s.sync, e["sync"].int, "\(at) sync")
                    check.time(s.start, e["start"].double, "\(at) sync start")
                    check.time(s.end, e["end"].double, "\(at) sync end")
                    check.time(s.nominalStart, e["nominalStart"].double, "\(at) nominal")
                    check.fraction(s.phase, e["phase"].double, "\(at) sync phase")
                    check.time(s.drift, e["drift"].double, "\(at) drift")
                    check.equal(s.quarter, e["quarter"].int, "\(at) sync quarter")
                    check.equal(s.digits3, e["digits3"].ints, "\(at) digits")
                    check.equal(s.beforeAnchor, e["beforeAnchor"].bool, "\(at) before anchor")
                }
                let p = clock.pentad(at: t), q = sample["pentad"]
                if check.presence(p != nil, !q.isNull, "\(at) pentad"), let p {
                    check.equal([p.sync, p.index, p.helion, p.helions],
                                [q["sync"].int, q["index"].int, q["helion"].int, q["helions"].int], "\(at) pentad")
                    check.time(p.start, q["start"].double, "\(at) pentad start")
                    check.time(p.end, q["end"].double, "\(at) pentad end")
                }
            }
            check.report()
        }
    }
}
