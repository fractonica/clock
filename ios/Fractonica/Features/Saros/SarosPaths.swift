import Foundation
import FractonicaKit
import Synchronization

/// An eclipse's path on the ground from saros-geo (Resources/Saros/geo-<series>.bin, eclipses from 1582 to 2500): the
/// outline of the central path of a total, annular or hybrid eclipse, or the limits of a partial one, with the figures
/// the catalogue gives at greatest eclipse. `SarosEclipse.pathRecord` says which record is whose.
struct EclipsePath: Sendable {
    /// NASA's type label ("A", "T+", "Pb" …).
    let type: String
    /// TT seconds of greatest eclipse, as the record keeps them (to the second).
    let ttSeconds: Int
    /// Greatest eclipse (°N, °E).
    let latitude: Double
    let longitude: Double
    let sunAltitude: Int
    /// Eclipse magnitude: the fraction of the Sun's diameter covered.
    let magnitude: Double
    /// Least distance of the shadow axis from the Earth's centre, in Earth radii (negative south of it).
    let gamma: Double
    /// Seconds of totality or annularity, and the path's width in km, at greatest eclipse.
    let centralDuration: Int?
    let centralWidthKm: Int?
    /// The outline: rings of (longitude, latitude) in degrees, as stored.
    let rings: [[GeoPoint]]

    /// A partial eclipse's record outlines where it is seen, not a path: drawn as a line.
    var isPartial: Bool { type.hasPrefix("P") }
}

/// Longitude and latitude in degrees.
struct GeoPoint: Sendable, Hashable {
    var lon: Double
    var lat: Double
}

/// Reads saros-geo's files (its codec, saros_geo.js `decodeSeries`, in Swift): a header — u8 count, 3 bytes, then
/// count + 1 u32 LE bit offsets into the payload — and per eclipse a big-endian bit stream: type 5 bits, Unix time 35
/// (signed), latitude and longitude 29 each (sign and 28 bits of millionths of a degree), the Sun's altitude 7,
/// magnitude 14 (×10 000), gamma 15 (sign and 14 bits, ×10 000), a flag and 10 bits of central duration, a flag and 11
/// bits of central width in km, 5 bits of polygon count and per polygon 13 bits of point count and its points
/// (longitude, latitude as above).
enum SarosPaths {
    static let typeNames = ["A", "Am", "Aminus", "An", "Aplus", "As", "H", "H2", "H3", "Hm", "P", "Pb", "Pe", "T", "Tm",
                            "Tminus", "Tplus", "Ts"]

    enum DecodeError: Error { case truncated, badHeader }

    /// Every record of one series' file, in order.
    static func decode(_ data: Data) throws -> [EclipsePath] {
        let bytes = [UInt8](data)
        guard bytes.count >= 4 else { throw DecodeError.badHeader }
        let count = Int(bytes[0])
        let header = 4 + 4 * (count + 1)
        guard bytes.count >= header else { throw DecodeError.badHeader }
        func u32(_ at: Int) -> Int { Int(bytes[at]) | Int(bytes[at + 1]) << 8 | Int(bytes[at + 2]) << 16 | Int(bytes[at + 3]) << 24 }
        let payload = Array(bytes[header...])
        return try (0..<count).map { i in
            var reader = BitReader(bytes: payload, bit: u32(4 + 4 * i))
            return try reader.eclipse()
        }
    }

    /// The paths of `series` from the app's bundle (or `directory`), read once and kept; empty where there is no file.
    static func series(_ series: Int, directory: URL? = nil) -> [EclipsePath] {
        if let hit = cache.withLock({ $0[series] }) { return hit }
        let url = directory?.appendingPathComponent("geo-\(series).bin")
            ?? Bundle.main.url(forResource: "geo-\(series)", withExtension: "bin")
        let paths = url.flatMap { try? Data(contentsOf: $0) }.flatMap { try? decode($0) } ?? []
        cache.withLock { $0[series] = paths }
        return paths
    }

    /// The path of an eclipse, if the data has one.
    static func path(of eclipse: SarosEclipse, directory: URL? = nil) -> EclipsePath? {
        guard let record = eclipse.pathRecord else { return nil }
        let all = series(eclipse.series, directory: directory)
        return record < all.count ? all[record] : nil
    }

    private static let cache = Mutex<[Int: [EclipsePath]]>([:])
}

/// saros_geo.js `BitReader`: MSB-first fields.
private struct BitReader {
    let bytes: [UInt8]
    var bit: Int

    mutating func uint(_ bits: Int) throws -> Int {
        var value = 0
        var remaining = bits
        while remaining > 0 {
            let index = bit >> 3
            guard index < bytes.count else { throw SarosPaths.DecodeError.truncated }
            let can = 8 - (bit & 7)
            let take = min(can, remaining)
            let chunk = (Int(bytes[index]) >> (can - take)) & ((1 << take) - 1)
            value = value << take | chunk
            bit += take
            remaining -= take
        }
        return value
    }

    mutating func int(_ bits: Int) throws -> Int {
        let v = try uint(bits)
        return v >= 1 << (bits - 1) ? v - (1 << bits) : v
    }

    mutating func coordinate() throws -> Double {
        let sign = try uint(1)
        let magnitude = Double(try uint(28)) / 1_000_000
        return sign == 1 ? -magnitude : magnitude
    }

    mutating func eclipse() throws -> EclipsePath {
        let type = try uint(5)
        let time = try int(35)
        let latitude = try coordinate()
        let longitude = try coordinate()
        let altitude = try uint(7)
        let magnitude = Double(try uint(14)) / 10_000
        let gammaSign = try uint(1)
        let gamma = Double(try uint(14)) / 10_000 * (gammaSign == 1 ? -1 : 1)
        let duration = try uint(1) == 1 ? try uint(10) : nil
        let width = try uint(1) == 1 ? try uint(11) : nil
        let polygons = try uint(5)
        var rings: [[GeoPoint]] = []
        for _ in 0..<polygons {
            let n = try uint(13)
            var ring: [GeoPoint] = []
            ring.reserveCapacity(n)
            for _ in 0..<n {
                let lon = try coordinate()
                let lat = try coordinate()
                ring.append(GeoPoint(lon: lon, lat: lat))
            }
            rings.append(ring)
        }
        let name = type < SarosPaths.typeNames.count ? SarosPaths.typeNames[type] : "P"
        return EclipsePath(type: name, ttSeconds: time, latitude: latitude, longitude: longitude, sunAltitude: altitude,
                           magnitude: magnitude, gamma: gamma, centralDuration: duration, centralWidthKm: width, rings: rings)
    }
}
