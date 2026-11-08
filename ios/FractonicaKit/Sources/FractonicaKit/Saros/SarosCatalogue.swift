import Foundation

/// The solar Saros series and every eclipse of each, from NASA's catalogue (Espenak and Meeus, through saros-eclipse
/// 0.1.0; `SarosData`, made by ios/scripts/make-saros.mjs): all 180, −2000 … 3000, the 40 running now (117 … 156) among
/// them. Any running series can carry the clock (`FractonicaClock.on(series:)`); Saros 141 is the reference by default
/// (`SarosReference`). Every eclipse of every series can be searched by time (`nearest(to:count:)`).
///
///     let series = SarosCatalogue.series(145)!          // 77 eclipses, 1639 … 3009
///     series.eclipses[21].time                          // 2017-08-21 18:25:32 UTC, Unix seconds
///     series.stats(at: now).driftPerSync                // −11.217 s
///     SarosCatalogue.nearest(to: t, count: 3)           // the three eclipses closest to t, of any series
public enum SarosCatalogue {
    /// The series with eclipses still to come and gone (the 40 ongoing ones).
    public static let ongoing = 117...156

    /// Every series of the catalogue, by number (1 … 180).
    public static let every: [SarosSeries] = decode()

    /// Every ongoing series, by number.
    public static let all: [SarosSeries] = every.filter { ongoing.contains($0.number) }

    /// Series `number`; nil outside `ongoing`.
    public static func series(_ number: Int) -> SarosSeries? {
        ongoing.contains(number) ? all[number - ongoing.lowerBound] : nil
    }

    /// Series `number` of the whole catalogue, ended or still to begin too; nil outside 1 … 180.
    public static func anySeries(_ number: Int) -> SarosSeries? {
        every.indices.contains(number - 1) ? every[number - 1] : nil
    }

    /// Every eclipse of every series in order of time (13 206 of them).
    public static let timeline: [SarosEclipse] = every.flatMap(\.eclipses).sorted { $0.unixMilliseconds < $1.unixMilliseconds }
    /// `timeline`'s times (Unix seconds).
    static let timelineTimes: [Double] = timeline.map(\.time)

    /// The `count` eclipses closest to the span `from` … `to` (Unix seconds; a moment when they are equal), of any
    /// series, closest first: an eclipse inside the span is at distance 0, others as far as the span's nearer end.
    /// Ties go to the earlier eclipse.
    public static func nearest(from start: Double, to end: Double, count: Int) -> [SarosEclipse] {
        let times = timelineTimes
        guard count > 0, !times.isEmpty, !start.isNaN, !end.isNaN else { return [] }
        let lo = min(start, end), hi = max(start, end)
        func distance(_ i: Int) -> Double { times[i] < lo ? lo - times[i] : times[i] > hi ? times[i] - hi : 0 }
        // the first eclipse at or after `lo`, then walk outwards from both sides taking the nearer each time (the
        // earlier on a tie)
        var a = 0, b = times.count
        while a < b {
            let m = (a + b) / 2
            if times[m] < lo { a = m + 1 } else { b = m }
        }
        var left = a - 1, right = a
        var picked: [Int] = []
        while picked.count < count, left >= 0 || right < times.count {
            if right >= times.count || (left >= 0 && distance(left) <= distance(right)) {
                picked.append(left)
                left -= 1
            } else {
                picked.append(right)
                right += 1
            }
        }
        // inside the span every eclipse is at 0: in time order
        return picked.sorted { distance($0) != distance($1) ? distance($0) < distance($1) : $0 < $1 }.map { timeline[$0] }
    }

    /// The `count` eclipses closest to the moment t, closest first.
    public static func nearest(to t: Double, count: Int) -> [SarosEclipse] {
        nearest(from: t, to: t, count: count)
    }

    private static func decode() -> [SarosSeries] {
        let bytes = [UInt8](Data(base64Encoded: SarosData.blob.joined()) ?? Data())
        var at = 0
        func u8() -> Int { defer { at += 1 }; return Int(bytes[at]) }
        func u16() -> Int { defer { at += 2 }; return Int(bytes[at]) | Int(bytes[at + 1]) << 8 }
        func i16() -> Int { Int(Int16(truncatingIfNeeded: u16())) }
        func i64() -> Int64 {
            var v: UInt64 = 0
            for k in 0..<8 { v |= UInt64(bytes[at + k]) << (8 * UInt64(k)) }
            at += 8
            return Int64(bitPattern: v)
        }
        var out: [SarosSeries] = []
        while at + 4 <= bytes.count {
            let number = u16(), count = u16()
            var eclipses: [SarosEclipse] = []
            eclipses.reserveCapacity(count)
            for ordinal in 0..<count {
                let ms = i64()
                let lat = i16(), lon = i16(), duration = u16(), type = u8(), altitude = u8(), path = u8()
                at += 1
                eclipses.append(SarosEclipse(
                    series: number, ordinal: ordinal, unixMilliseconds: ms,
                    latitude: Double(lat) / 10, longitude: Double(lon) / 10,
                    centralDuration: duration == 0xFFFF ? nil : duration,
                    type: SarosEclipseType(code: type), sunAltitude: altitude,
                    pathRecord: path == 0xFF ? nil : path
                ))
            }
            out.append(SarosSeries(number: number, eclipses: eclipses))
        }
        return out
    }
}

/// One Saros series: its eclipses in order, one Saros apart (ordinal 0 is the first, a partial eclipse near a pole).
public struct SarosSeries: Sendable, Identifiable, Hashable {
    public let number: Int
    public let eclipses: [SarosEclipse]

    public var id: Int { number }

    /// Unix milliseconds of each eclipse, the clock's catalogue when the series carries it.
    public var unixMilliseconds: [Int64] { eclipses.map(\.unixMilliseconds) }

    /// The first and last eclipse (Unix seconds).
    public var start: Double { eclipses[0].time }
    public var end: Double { eclipses[eclipses.count - 1].time }

    /// The last eclipse at or before t and the first after it (either nil beyond the series).
    public func neighbours(of t: Double) -> (last: SarosEclipse?, next: SarosEclipse?) {
        let next = eclipses.firstIndex { $0.time > t }
        switch next {
        case nil: return (eclipses.last, nil)
        case 0: return (nil, eclipses[0])
        case let k?: return (eclipses[k - 1], eclipses[k])
        }
    }

    /// The ordinal whose eclipse starts the solar sync's count (SPEC §7.1): the first Alpha (every fourth eclipse,
    /// ordinal ≡ 0 mod 4, so A · P(6) / 4 is whole) to begin in the UTC era, on or after 1972-01-01, where Unix times
    /// are exact. Saros 141's is ordinal 20, 1973-12-24 (SPEC §7.2). A series whose Alphas all began before 1972 counts
    /// from its last.
    public var solarAnchor: Int {
        let alphas = stride(from: 0, to: eclipses.count, by: 4)
        return alphas.first { eclipses[$0].unixMilliseconds >= SarosSeries.utcEra * 1000 } ?? alphas.reversed().first!
    }

    /// 1972-01-01T00:00:00Z, when UTC took its present form (SPEC §2.1).
    static let utcEra: Int64 = 63_072_000

    /// The length of a Helion (4 / 125 125 of a Saros) on a clock this series carries, around its eclipse `ordinal`:
    /// of the Saros after it (`after`) or before it, else the one on the other side at the series' ends.
    public func helion(near ordinal: Int, after: Bool) -> Double {
        guard eclipses.count > 1 else { return 4 * 6_585.32 * 86_400 / 125_125 }
        let k = min(eclipses.count - 2, max(0, after ? ordinal : ordinal - 1))
        return (eclipses[k + 1].time - eclipses[k].time) * 4 / 125_125
    }

    /// How eclipses of each kind the series has: partial, annular, total, hybrid.
    public var kinds: [SarosEclipseType.Kind: Int] {
        eclipses.reduce(into: [:]) { $0[$1.type.kind, default: 0] += 1 }
    }
}

/// One eclipse of a Saros series, at its greatest eclipse.
public struct SarosEclipse: Sendable, Identifiable, Hashable {
    public let series: Int
    /// 0-based position in the series (its position on a clock the series carries).
    public let ordinal: Int
    public let unixMilliseconds: Int64
    /// Where the eclipse is greatest (°N, °E).
    public let latitude: Double
    public let longitude: Double
    /// Seconds of totality or annularity on the central line at greatest eclipse; nil for a partial eclipse.
    public let centralDuration: Int?
    public let type: SarosEclipseType
    /// The Sun's altitude at greatest eclipse (°).
    public let sunAltitude: Int
    /// The record of the eclipse's path in the app's geo-<series>.bin (saros-geo, eclipses from 1582 to 2500); nil
    /// where the path data has none.
    public let pathRecord: Int?

    public var id: Int { series * 1000 + ordinal }

    /// Unix seconds, converted as the clock's catalogue converts them (the library's `F.number`, which is not always
    /// the nearest double), so an eclipse is exactly a whole position of a clock on its series.
    public var time: Double { Ratio(Int128(unixMilliseconds), 1000).libraryDouble }
}

/// An eclipse's type, as NASA's catalogue gives it: the kind (A annular, H hybrid, P partial, T total) and a qualifier —
/// m the middle eclipse of its series, n / s central with no northern or southern limit, + / − not central (the shadow
/// axis misses the Earth) with no northern or southern limit, 2 / 3 a hybrid that begins total or annular, b / e the
/// partial eclipse that begins or ends the series.
public struct SarosEclipseType: Sendable, Hashable {
    /// saros-eclipse's `SolarEclipseType` code (0 … 18).
    public let code: Int

    public enum Kind: Int, Sendable, CaseIterable, Comparable {
        case partial, annular, hybrid, total

        public static func < (a: Kind, b: Kind) -> Bool { a.rawValue < b.rawValue }

        public var title: String {
            switch self {
            case .partial: "Partial"
            case .annular: "Annular"
            case .hybrid: "Hybrid"
            case .total: "Total"
            }
        }

        /// "P", "A", "H", "T".
        public var letter: String { String(title.prefix(1)) }
    }

    static let labels = ["A", "A+", "A−", "Am", "An", "As", "H", "H2", "H3", "Hm", "P", "Pb", "Pe", "T", "T+", "T−", "Tm", "Tn", "Ts"]

    /// NASA's label: "A", "T+", "Pb" …
    public var label: String { code < Self.labels.count ? Self.labels[code] : "P" }

    public var kind: Kind {
        switch code {
        case 0...5: .annular
        case 6...9: .hybrid
        case 13...18: .total
        default: .partial
        }
    }

    /// Whether the Moon's shadow axis meets the Earth, so the eclipse has a central line (not a partial eclipse, nor
    /// an A+ / A− / T+ / T−, whose shadow only grazes a pole).
    public var isCentral: Bool { kind != .partial && ![1, 2, 14, 15].contains(code) }
}
