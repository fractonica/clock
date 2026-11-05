import Foundation

/// The solar Saros series running now, 117 … 156, and every eclipse of each, from NASA's catalogue (Espenak and Meeus,
/// through saros-eclipse 0.1.0; `SarosData`, made by ios/scripts/make-saros.mjs). Any of them can carry the clock
/// (`FractonicaClock.on(series:)`); Saros 141 is the reference by default (`SarosReference`).
///
///     let series = SarosCatalogue.series(145)!          // 77 eclipses, 1639 … 3009
///     series.eclipses[23].time                          // 2017-08-21 18:25:32 UTC, Unix seconds
///     series.stats(at: now).driftPerSync                // −11.217 s
public enum SarosCatalogue {
    /// The series with eclipses still to come and gone (the 40 ongoing ones).
    public static let ongoing = 117...156

    /// Every ongoing series, by number.
    public static let all: [SarosSeries] = decode()

    /// Series `number`; nil outside `ongoing`.
    public static func series(_ number: Int) -> SarosSeries? {
        ongoing.contains(number) ? all[number - ongoing.lowerBound] : nil
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
