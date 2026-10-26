import Foundation

// The sky events of the printable diary (src/diary/astro: moon phases, apsides, nodes, sidereal passages, lunistices,
// equinoxes and solstices, perihelion and aphelion, cross-quarters, eclipses, planets), precomputed by
// scripts/make-sky-events.mjs into Resources/Sky/sky-events.bin (its header documents the format) for 1900 … 2200, and
// answered here by binary search. The kinds' names, families, labels and symbols are SkyEventKinds.swift, generated
// from the same JavaScript. Pure logic (no SwiftUI), checked by Sky/Checks against fresh events() output.

/// One sky event: its moment and kind, and its label (a specific one such as "Total solar eclipse" when it has one).
struct SkyEvent: Hashable, Sendable, Identifiable {
    /// Unix seconds (UTC), whole seconds.
    let time: Double
    /// Index into `SkyKinds.all`.
    let kind: Int
    /// The specific label ("Total solar eclipse", "Moon farthest north 28.4°"), nil for the kind's own.
    let specific: String?

    var info: SkyKindInfo { SkyKinds.all[kind] }
    var name: String { info.name }
    var family: SkyFamily { info.family }
    var symbol: String { info.symbol }
    var label: String { specific ?? info.label }
    var labelPure: String { specific ?? info.labelPure }
    func label(pure: Bool) -> String { pure ? labelPure : label }
    /// How notable it is (0 most): see `SkyTier`.
    var tier: SkyTier { SkyTier(kind: kind) }

    var id: String { "\(name)@\(Int64(time))" }
}

/// How notable a kind of event is, for what shows when there is room for only some: eclipses, then equinoxes and
/// solstices, then new and full moons, then the other phases and the Earth's apsides, then the rest of the Moon's and
/// the planets' events, then the in-between (post-*) states.
enum SkyTier: Int, Comparable, CaseIterable, Sendable {
    case eclipse, season, syzygy, quarter, minor, between

    init(kind: Int) { self = SkyTier.table[kind] }

    static func < (a: SkyTier, b: SkyTier) -> Bool { a.rawValue < b.rawValue }

    private static let table: [SkyTier] = SkyKinds.all.map { info in
        switch info.name {
        case "solar-eclipse", "lunar-eclipse": .eclipse
        case "march-equinox", "june-solstice", "september-equinox", "december-solstice": .season
        case "new-moon", "full-moon": .syzygy
        case "first-quarter", "last-quarter", "perihelion", "aphelion": .quarter
        case _ where info.name.hasPrefix("post-") || info.name.hasPrefix("cross-quarter"): .between
        default: .minor
        }
    }

    /// About how far apart events of this tier and every more notable one come (seconds): what the wave asks of a zoom
    /// before it shows them. Eclipses ≈ 4.5 a year, with the seasons ≈ 8.5, new and full moons ≈ 33, quarters and
    /// apsides ≈ 60, everything but the in-between states ≈ 190, everything ≈ 270.
    var spacing: Double {
        let year = 365.2422 * 86_400
        switch self {
        case .eclipse: return year / 4.5
        case .season: return year / 8.5
        case .syzygy: return year / 33
        case .quarter: return year / 60
        case .minor: return year / 190
        case .between: return year / 270
        }
    }
}

/// The precomputed table: lazily loaded once (`shared`), immutable, safe from any thread.
final class SkyEvents: Sendable {
    /// The bundled table (empty when it cannot be read).
    static let shared = SkyEvents(url: defaultURL) ?? SkyEvents.empty

    /// The table's range: events in [start, end) are all there; outside it nothing is known.
    let start: Double
    let end: Double
    private let times: [Double]
    private let kinds: [UInt8]
    private let labelIndex: [UInt16]
    private let labels: [String]

    var count: Int { times.count }
    /// The moment is inside the table's range.
    func covers(_ t: Double) -> Bool { t >= start && t < end }

    private init(start: Double, end: Double, times: [Double], kinds: [UInt8], labelIndex: [UInt16], labels: [String]) {
        self.start = start
        self.end = end
        self.times = times
        self.kinds = kinds
        self.labelIndex = labelIndex
        self.labels = labels
    }

    static let empty = SkyEvents(start: 0, end: 0, times: [], kinds: [], labelIndex: [], labels: [])

    /// The app's resource, else the repository's file next to these sources (the checks run outside the app).
    static var defaultURL: URL {
        if let url = Bundle.main.url(forResource: "sky-events", withExtension: "bin") { return url }
        return URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../../../Resources/Sky/sky-events.bin")
    }

    /// Reads a table file (format in scripts/make-sky-events.mjs); nil when it is missing or malformed.
    convenience init?(url: URL) {
        guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return nil }
        self.init(data: data)
    }

    convenience init?(data: Data) {
        let parsed: (Double, Double, [Double], [UInt8], [UInt16], [String])? = data.withUnsafeBytes { raw in
            guard raw.count >= 44, raw.prefix(6).elementsEqual(Array("FXSKY\u{1}".utf8)) else { return nil }
            func int64(_ o: Int) -> Int64 { Int64(littleEndian: raw.loadUnaligned(fromByteOffset: o, as: Int64.self)) }
            func uint32(_ o: Int) -> UInt32 { UInt32(littleEndian: raw.loadUnaligned(fromByteOffset: o, as: UInt32.self)) }
            let t0 = int64(8), t1 = int64(16), base = int64(24)
            let n = Int(uint32(32)), k = Int(uint32(36)), l = Int(uint32(40))
            guard k == SkyKinds.all.count else { return nil }
            var o = 44
            var labels: [String] = []
            labels.reserveCapacity(l)
            for _ in 0..<l {
                guard o < raw.count else { return nil }
                let len = Int(raw[o])
                o += 1
                guard o + len <= raw.count else { return nil }
                labels.append(String(decoding: UnsafeRawBufferPointer(rebasing: raw[o..<(o + len)]), as: UTF8.self))
                o += len
            }
            guard o + 7 * n == raw.count else { return nil }
            var t = base
            let times = [Double](unsafeUninitializedCapacity: n) { buffer, count in
                for i in 0..<n {
                    t += Int64(uint32(o + 4 * i))
                    buffer[i] = Double(t)
                }
                count = n
            }
            o += 4 * n
            let kinds = [UInt8](UnsafeRawBufferPointer(rebasing: raw[o..<(o + n)]))
            guard kinds.allSatisfy({ Int($0) < k }) else { return nil }
            o += n
            let index = [UInt16](unsafeUninitializedCapacity: n) { buffer, count in
                for i in 0..<n {
                    buffer[i] = UInt16(littleEndian: raw.loadUnaligned(fromByteOffset: o + 2 * i, as: UInt16.self))
                }
                count = n
            }
            guard index.allSatisfy({ $0 == 0xFFFF || Int($0) < l }) else { return nil }
            return (Double(t0), Double(t1), times, kinds, index, labels)
        }
        guard let parsed else { return nil }
        self.init(start: parsed.0, end: parsed.1, times: parsed.2, kinds: parsed.3, labelIndex: parsed.4, labels: parsed.5)
    }

    // MARK: Queries

    /// The first index whose time is ≥ t.
    func lowerBound(_ t: Double) -> Int {
        var lo = 0, hi = times.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if times[mid] < t { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }

    /// The indices of the events in [t0, t1).
    func indices(from t0: Double, to t1: Double) -> Range<Int> {
        guard t1 > t0 else { return 0..<0 }
        let a = lowerBound(t0)
        return a..<max(a, lowerBound(t1))
    }

    /// The indices of the events in [t0, t1] (both ends included).
    func indices(through t1: Double, from t0: Double) -> Range<Int> {
        guard t1 >= t0 else { return 0..<0 }
        let a = lowerBound(t0)
        var b = lowerBound(t1)
        while b < times.count, times[b] <= t1 { b += 1 }
        return a..<max(a, b)
    }

    func time(_ i: Int) -> Double { times[i] }
    func kind(_ i: Int) -> Int { Int(kinds[i]) }

    func event(_ i: Int) -> SkyEvent {
        let l = labelIndex[i]
        return SkyEvent(time: times[i], kind: Int(kinds[i]), specific: l == 0xFFFF ? nil : labels[Int(l)])
    }

    /// The events in [t0, t1), in time order.
    func events(from t0: Double, to t1: Double) -> [SkyEvent] {
        indices(from: t0, to: t1).map(event)
    }

    /// The events in [t0, t1) whose family is not hidden, in time order.
    func events(from t0: Double, to t1: Double, hiding hidden: Set<SkyFamily>) -> [SkyEvent] {
        guard !hidden.isEmpty else { return events(from: t0, to: t1) }
        return indices(from: t0, to: t1).compactMap { i in
            hidden.contains(SkyKinds.all[Int(kinds[i])].family) ? nil : event(i)
        }
    }

    /// The most notable events of [t0, t1): at most `limit`, by tier then time, and how many others there are.
    func notable(from t0: Double, to t1: Double, limit: Int, hiding hidden: Set<SkyFamily> = []) -> (shown: [SkyEvent], more: Int) {
        let all = events(from: t0, to: t1, hiding: hidden)
        let ranked = all.sorted { a, b in a.tier != b.tier ? a.tier < b.tier : a.time < b.time }
        let shown = Array(ranked.prefix(limit))
        // "+N" counts the events left out that are as notable as the least notable shown (a Beta: more eclipses, not
        // the thousands of lunar phases and nodes under them)
        guard let floor = shown.last?.tier else { return ([], 0) }
        return (shown, ranked.dropFirst(limit).count { $0.tier <= floor })
    }
}

extension SkyKinds {
    /// A kind by its name ("full-moon"), nil when the diary has no such event.
    static func index(of name: String) -> Int? { byName[name] }

    private static let byName: [String: Int] = Dictionary(uniqueKeysWithValues: all.enumerated().map { ($1.name, $0) })
}
