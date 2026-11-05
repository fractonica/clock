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
}
