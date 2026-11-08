import Foundation
import Testing
@testable import FractonicaKit

/// The Saros catalogue (SarosData, made by ios/scripts/make-saros.mjs) and clocks on series other than 141.
@Suite struct SarosCatalogueTests {
    @Test func everyOngoingSeriesIsThere() {
        #expect(SarosCatalogue.all.map(\.number) == Array(SarosCatalogue.ongoing))
        #expect(SarosCatalogue.all.reduce(0) { $0 + $1.eclipses.count } == 2887)
        for series in SarosCatalogue.all {
            #expect(series.eclipses.enumerated().allSatisfy { $0.offset == $0.element.ordinal })
            #expect(zip(series.eclipses, series.eclipses.dropFirst()).allSatisfy { $0.unixMilliseconds < $1.unixMilliseconds })
            // ongoing: one eclipse gone, one to come
            #expect(series.start < 1_793_000_000 && series.end > 1_793_000_000)
            #expect(series.solarAnchor % 4 == 0)
        }
    }

    @Test func everySeriesOfTheCatalogue() {
        #expect(SarosCatalogue.every.map(\.number) == Array(1...180))
        #expect(SarosCatalogue.every.reduce(0) { $0 + $1.eclipses.count } == 13_206)
        #expect(SarosCatalogue.timeline.count == 13_206)
        #expect(zip(SarosCatalogue.timeline, SarosCatalogue.timeline.dropFirst()).allSatisfy { $0.unixMilliseconds <= $1.unixMilliseconds })
        for series in SarosCatalogue.every {
            #expect(series.eclipses.enumerated().allSatisfy { $0.offset == $0.element.ordinal && $0.element.series == series.number })
            #expect(zip(series.eclipses, series.eclipses.dropFirst()).allSatisfy { $0.unixMilliseconds < $1.unixMilliseconds })
        }
        // the ongoing series are the same records
        #expect(SarosCatalogue.series(145) == SarosCatalogue.anySeries(145))
        #expect(SarosCatalogue.series(116) == nil && SarosCatalogue.anySeries(116)?.number == 116)
        #expect(SarosCatalogue.anySeries(0) == nil && SarosCatalogue.anySeries(181) == nil)
        // paths exist from 1582 to 2500 only (saros-geo has 101 … 173)
        #expect(SarosCatalogue.anySeries(100)!.eclipses.allSatisfy { $0.pathRecord == nil })
        #expect(SarosCatalogue.anySeries(116)!.eclipses.contains { $0.pathRecord != nil })
    }

    @Test func nearestEclipses() {
        let list = SarosCatalogue.timeline
        let times = list.map(\.time)
        func brute(_ lo: Double, _ hi: Double, _ n: Int) -> [Int] {
            let d = times.map { $0 < lo ? lo - $0 : $0 > hi ? $0 - hi : 0 }
            return d.indices.sorted { d[$0] != d[$1] ? d[$0] < d[$1] : $0 < $1 }.prefix(n).map { list[$0].id }
        }
        // moments across the catalogue, a day either side of eclipses, and the catalogue's edges
        var moments: [Double] = [times[0] - 1e9, times.last! + 1e9, 0, 1_793_000_000, -5_000_000_000, 30_000_000_000]
        for k in stride(from: 0, to: list.count, by: 997) { moments += [times[k], times[k] + 86_400, times[k] - 43_200] }
        for t in moments {
            #expect(SarosCatalogue.nearest(to: t, count: 3).map(\.id) == brute(t, t, 3))
            #expect(SarosCatalogue.nearest(from: t - 43_200, to: t + 43_200, count: 5).map(\.id) == brute(t - 43_200, t + 43_200, 5))
        }
        // 2017-08-21: the Great American Eclipse, Saros 145 #21
        let aug21 = 1_503_273_600.0 // 2017-08-21 00:00 UTC
        let found = SarosCatalogue.nearest(from: aug21, to: aug21 + 86_400, count: 3)
        #expect(found.first?.series == 145 && found.first?.ordinal == 21)
        #expect(SarosCatalogue.nearest(to: 0, count: 0).isEmpty && SarosCatalogue.nearest(to: .nan, count: 3).isEmpty)
    }

    @Test func helionOfASeries() {
        let s = SarosCatalogue.series(141)!
        let saros = s.eclipses[21].time - s.eclipses[20].time
        #expect(s.helion(near: 20, after: true) == saros * 4 / 125_125)
        #expect(s.helion(near: 21, after: false) == saros * 4 / 125_125)
        // the ends use the Saros on the side there is
        #expect(s.helion(near: 0, after: false) == (s.eclipses[1].time - s.eclipses[0].time) * 4 / 125_125)
        let last = s.eclipses.count - 1
        #expect(s.helion(near: last, after: true) == (s.eclipses[last].time - s.eclipses[last - 1].time) * 4 / 125_125)
        #expect(abs(s.helion(near: 30, after: true) - 18_189) < 30)
    }

    @Test func saros141IsTheLibrarysTable() {
        let s = SarosCatalogue.series(141)!
        #expect(s.unixMilliseconds == Fractonica.saros141UnixMilliseconds)
        #expect(s.solarAnchor == 20)
        #expect(s.eclipses[20].type.label == "A" && s.eclipses[0].type.label == "Pb")
        #expect(s.eclipses[22].latitude == 1.6 && s.eclipses[22].longitude == 69.3)
        #expect(s.eclipses[22].centralDuration == 668 && s.eclipses[22].pathRecord == 22)
        #expect(s.eclipses[60].pathRecord == nil)
    }

    @Test func clocksPerSeries() throws {
        let standard = try #require(FractonicaClock.on(series: 141))
        #expect(standard === FractonicaClock.on(series: 141))
        #expect(standard.catalogue == FractonicaClock.shared.catalogue)
        #expect(standard.solarAnchor == 20)
        let c = try #require(FractonicaClock.on(series: 145))
        let s = SarosCatalogue.series(145)!
        #expect(c.series == 145 && c.extent == s.eclipses.count - 1)
        #expect(c.tMin == s.start && c.tMax == s.end)
        // every eclipse of the series is a whole position, an Alpha every fourth
        for e in s.eclipses.dropLast() {
            #expect(c.position(at: e.time) == Double(e.ordinal))
        }
        let alpha = try #require(c.level(at: s.eclipses[24].time, 0))
        #expect(alpha.phase == 0)
        #expect(FractonicaClock.on(series: 99) == nil)
    }

    @Test func solarSyncCountsFromTheSeriesAnchor() throws {
        let s = SarosCatalogue.series(145)!
        let c = try #require(FractonicaClock.on(series: 145))
        let anchor = s.eclipses[s.solarAnchor].time
        #expect(s.eclipses[s.solarAnchor].unixMilliseconds >= 63_072_000_000)
        #expect(s.solarAnchor < 4 || s.eclipses[s.solarAnchor - 4].unixMilliseconds < 63_072_000_000)
        let sync = try #require(c.solar(at: anchor + 3600))
        #expect(sync.sync == 0 && abs(sync.start - anchor) < 0.001)
        let pentad = try #require(c.pentad(at: anchor + 60))
        #expect(pentad.sync == 0 && pentad.index == 0 && pentad.helion == 1)
    }

    @Test func driftAndLap() throws {
        let now = 1_793_836_800.0 // 2026-11-05T00:00:00Z
        let d141 = try #require(SarosCatalogue.series(141)!.drift(at: now))
        #expect(abs(d141.perSync - -10.081) < 0.001)
        #expect(abs(d141.lap! / (365.2425 * 86_400) - 89.2) < 0.05)
        // SPEC §7.2: from the anchor the lap ends at the sync of 2067-02-01, 93.11 years on
        let s = SarosCatalogue.series(141)!
        let fromAnchor = try #require(s.drift(at: s.eclipses[20].time))
        #expect(abs(fromAnchor.lap! / (365.2425 * 86_400) - 93.11) < 0.005)
        let laps = SarosCatalogue.all.compactMap { $0.drift(at: now) }
        #expect(laps.count == 40)
        let mean = laps.map(\.lapOrEstimate).reduce(0, +) / 40 / (365.2425 * 86_400)
        #expect(abs(mean - 89.3) < 0.2)
        let drift = laps.map(\.perSync).reduce(0, +) / 40
        #expect(abs(drift - -10.765) < 0.005)
        // 152 drifts least, 147 most; 117 ends before its lap
        #expect(laps.max { $0.perSync < $1.perSync }?.series == 152)
        #expect(laps.min { $0.perSync < $1.perSync }?.series == 147)
        #expect(laps.first { $0.series == 117 }?.lap == nil)
        #expect(abs(d141.lapPastAlpha / (365.2425 * 86_400) - 17.1) < 0.1)
    }

    /// No series takes the exact arithmetic past 128 bits (Ratio traps on overflow): every level 0 … 20, odometers, the
    /// solar sync and exact landings, at each series' edges and through its catalogue, on the longest (127, 82
    /// eclipses) and earliest (117, from 792) series too.
    @Test func everySeriesStaysInRange() throws {
        for series in SarosCatalogue.all {
            let clock = try #require(FractonicaClock.on(series: series.number))
            let span = clock.tMax - clock.tMin
            // (the first and last instants themselves can read nil, as in the web model: rounded to the millisecond, F.number's
            // double of one may fall a hair outside the catalogue)
            let times = [clock.tMin + 0.002, clock.tMax - 0.002] + (1..<12).map { clock.tMin + span * Double($0) / 12 + 0.123 }
            for t in times {
                for level in Fractonica.supportedLevels {
                    let reading = clock.level(at: t, level)
                    #expect(reading != nil, "Saros \(series.number) L\(level) at \(t)")
                }
                #expect(clock.odometer(at: t, 13, strokes: 3, digits: 3) != nil)
                _ = clock.solar(at: t)
                _ = clock.pentad(at: t)
            }
            #expect(clock.time(atPositionNumerator: Int128(clock.extent) * 1_000_003 - 1, denominator: 1_000_003) != nil)
        }
    }
}
