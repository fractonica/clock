import FractonicaKit
import Foundation

// The Saros search: the eclipses nearest a date, of any of the catalogue's 180 series, and how rare the date is by
// how close the nearest one comes, measured in Helions of that eclipse's own series (a Helion is 4 / 125 125 of the
// Saros it falls in, ≈ 5 h 03 min):
//
//     within 1 Helion        cosmic
//     within 11 Helions      legendary   (a ζ)
//     within 77 Helions      epic        (a Nuclide)
//     within 385 Helions     rare        (a Delta, ≈ 81 days)
//     farther                common
//
// A date without a time is its whole local day: an eclipse during the day is at 0, others as far as the day's nearer
// end. Pure logic, checked by Saros/Checks.

/// What the search measures from: a moment, or a span (a whole local day).
struct SarosQuery: Hashable, Sendable {
    let start: Double
    let end: Double

    /// A moment.
    static func moment(_ t: Double) -> SarosQuery { SarosQuery(start: t, end: t) }

    /// The local day holding t in `zone`: from its midnight to the next.
    static func day(containing t: Double, zone: TimeZone) -> SarosQuery {
        let (start, end) = SarosQuery.dayBounds(t, zone: zone)
        return SarosQuery(start: start, end: end)
    }

    var isDay: Bool { end > start }

    /// The midnights that begin and end the local day holding t (Gregorian calendar; days of 23 or 25 hours where the
    /// clocks change).
    static func dayBounds(_ t: Double, zone: TimeZone) -> (start: Double, end: Double) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let start = calendar.startOfDay(for: Date(timeIntervalSince1970: t))
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)
        return (start.timeIntervalSince1970, end.timeIntervalSince1970)
    }
}

/// How close a date comes to an eclipse, as a rarity (the colours and frames of Moments' rarities; never mythic).
enum SarosProximity {
    /// The rarities and the Helions within which each holds, rarest first.
    static let tiers: [(helions: Double, rarity: MomentRarity)] = [(1, .cosmic), (11, .legendary), (77, .epic), (385, .rare)]

    static func rarity(helions: Double) -> MomentRarity {
        tiers.first { helions <= $0.helions }?.rarity ?? .common
    }

    /// The Helions a rarity holds within ("1", "11", "77", "385"), nil for common.
    static func limit(of rarity: MomentRarity) -> Double? {
        tiers.first { $0.rarity == rarity }?.helions
    }

    /// The span the rarity's limit names: "1 Helion", "11 Helions (a ζ)", "77 Helions (a Nuclide)", "385 Helions (a Delta)".
    static func limitText(of rarity: MomentRarity) -> String? {
        switch rarity {
        case .cosmic: "1 Helion"
        case .legendary: "11 Helions"
        case .epic: "a Nuclide (77 Helions)"
        case .rare: "a Delta (385 Helions)"
        default: nil
        }
    }
}

/// An eclipse the search found: how far it is from the query, in seconds and in its series' Helions, and the rarity
/// that gives.
struct SarosMatch: Identifiable, Hashable, Sendable {
    let eclipse: SarosEclipse
    /// From the query to the eclipse (s): positive when the eclipse comes after it, negative before, 0 during it.
    let offset: Double
    /// |offset| in Helions of the eclipse's series, on the side the query lies.
    let helions: Double

    var id: Int { eclipse.id }
    var rarity: MomentRarity { SarosProximity.rarity(helions: helions) }
    var series: SarosSeries? { SarosCatalogue.anySeries(eclipse.series) }

    init(eclipse: SarosEclipse, query: SarosQuery) {
        self.eclipse = eclipse
        let t = eclipse.time
        offset = t > query.end ? t - query.end : t < query.start ? t - query.start : 0
        // the query after the eclipse lies in the Saros after it, before it in the Saros before
        let helion = SarosCatalogue.anySeries(eclipse.series)?.helion(near: eclipse.ordinal, after: offset < 0)
            ?? 4 * 6_585.32 * 86_400 / 125_125
        helions = abs(offset) / helion
    }
}

enum SarosSearch {
    /// The `count` eclipses nearest the query, nearest first.
    static func matches(_ query: SarosQuery, count: Int = 3) -> [SarosMatch] {
        SarosCatalogue.nearest(from: query.start, to: query.end, count: count).map { SarosMatch(eclipse: $0, query: query) }
    }

    /// The date's rarity: its nearest eclipse's.
    static func rarity(_ query: SarosQuery) -> MomentRarity {
        matches(query, count: 1).first?.rarity ?? .common
    }

    /// The dates the search takes: the years where the app's Gregorian calendar and the catalogue agree (Foundation
    /// counts days before 1582-10-15 in the Julian calendar).
    static let earliest = -12_212_553_600.0 // 1583-01-01 00:00 UTC
    static let latest = 32_503_680_000.0 // 3000-01-01 00:00 UTC
}
