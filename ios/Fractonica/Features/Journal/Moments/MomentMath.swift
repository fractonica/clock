import FractonicaKit
import Foundation

// Moments: BeReal-style captures on the clock's own boundaries. A **moment** is every Helion quarter boundary — Preon
// 0 (a Helion's start), 9 (its peak), 18 (its node) and 27 (its valley). Every quarter boundary of a longer period
// (Nuclide, Delta, Gamma, Beta, Alpha) falls on one of them, so each moment is labelled by the longest level for which
// it is a start or a quarter boundary; that level gives its rarity (hub/API.md, `journal.entry` `capture`). The app
// prompts 11 Flavons before each moment the settings ask for — a Helion's node and every quarter boundary of a Delta
// or longer (`MomentSettings.asks`) — opens the instant view and captures at the exact moment.
//
// Everything here is pure logic on FractonicaKit (no UI), checked by Moments/Checks. Moments are numbered by their
// Helion quarter count from the catalogue's start: moment q sits at position q / P(η) Saros, exactly.

/// The periods a moment can belong to, shortest first (ζ, which is not a unit, folds into the Helion).
enum MomentLevel: String, CaseIterable, Codable, Sendable {
    case helion, nuclide, delta, gamma, beta, alpha

    /// The engine's level (η 6, ε 4, δ 3, γ 2, β 1, α 0).
    var kitLevel: Int {
        switch self {
        case .helion: 6
        case .nuclide: 4
        case .delta: 3
        case .gamma: 2
        case .beta: 1
        case .alpha: 0
        }
    }

    var name: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
    var letter: String { Fractonica.periodName(kitLevel).text }

    var rarity: MomentRarity {
        switch self {
        case .helion, .nuclide: .rare
        case .delta: .epic
        case .gamma: .legendary
        case .beta: .mythic
        case .alpha: .cosmic
        }
    }

    /// Longest first: the order a moment's label is looked for in.
    static let longestFirst: [MomentLevel] = [.alpha, .beta, .gamma, .delta, .nuclide, .helion]
}

/// Which quarter boundary of its period a moment is (a period's end is the next one's start).
enum MomentBoundary: String, CaseIterable, Codable, Sendable {
    case start, peak, node, valley

    /// From the event index inside a cycle: 0 start, 1 peak, 2 node, 3 valley.
    init(quarter k: Int) {
        self = [.start, .peak, .node, .valley][((k % 4) + 4) % 4]
    }

    var word: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }

    /// The Preon of the Helion it falls on: 0, 9, 18, 27.
    var preon: Int { [0, 9, 18, 27][MomentBoundary.allCases.firstIndex(of: self)!] }
}

/// How rare a journal entry is, by what it captured: entries without a capture are common.
enum MomentRarity: String, CaseIterable, Codable, Comparable, Sendable {
    case common, rare, epic, legendary, mythic, cosmic

    var title: String { rawValue.prefix(1).uppercased() + rawValue.dropFirst() }
    var rank: Int { Self.allCases.firstIndex(of: self)! }

    static func < (a: MomentRarity, b: MomentRarity) -> Bool { a.rank < b.rank }

    /// The rarity a level gives, by the level's API name ("delta" → epic); nil for an unknown name.
    init?(level: String) {
        guard let level = MomentLevel(rawValue: level) else { return nil }
        self = level.rarity
    }
}

/// One moment: a Helion quarter boundary and what it is the boundary of.
struct Moment: Hashable, Identifiable, Sendable {
    /// Helion quarters since the catalogue's start: the moment sits at position `index / P(η)` Saros.
    let index: Int64
    /// The exact time (Unix seconds).
    let time: Double
    /// The longest period with a quarter boundary here.
    let level: MomentLevel
    let boundary: MomentBoundary
    /// The global cycle index, at `level`, of the cycle the boundary belongs to (for a start: the cycle that begins).
    let cycle: Int64

    var id: Int64 { index }
    var rarity: MomentRarity { level.rarity }
    var capture: MomentCapture { MomentCapture(at: time, level: level.rawValue, boundary: boundary.rawValue, rarity: rarity) }

    /// "Delta Trifracton Node", "Nuclide ε#3 Start", "Helion 34η Peak".
    func title(_ notation: Notation = .standard) -> String {
        "\(periodName(notation)) \(boundary.word)"
    }

    /// "Delta Trifracton", "Nuclide ε#3", "Helion 34η": the period whose boundary it is.
    func periodName(_ notation: Notation = .standard) -> String {
        switch level {
        case .alpha, .beta, .gamma, .delta:
            Notation.periodName(level: level.kitLevel, ordinal: notation.ordinalOf(level: level.kitLevel, cycle: cycle))
        case .nuclide:
            "Nuclide \(notation.cycleShort(level: 4, cycle: cycle))"
        case .helion:
            "Helion \(notation.cycleShort(level: 6, cycle: cycle))"
        }
    }

    /// What the announcement says: "A new Delta begins", "Gamma node".
    var spoken: String {
        boundary == .start ? "A new \(level.name) begins" : "\(level.name) \(boundary.rawValue)"
    }

    /// The bundled announcement for this kind of moment ("moment-delta-node", a .caf in Resources/Moments).
    var soundName: String { "moment-\(level.rawValue)-\(boundary.rawValue)" }
}

/// The `capture` of a journal entry made on a moment (hub/API.md): `{ at, level, boundary, rarity }`.
struct MomentCapture: Hashable, Sendable {
    var at: Double
    var level: String
    var boundary: String
    var rarity: MomentRarity

    var json: JSONValue {
        .object(["at": .number(at), "level": .string(level), "boundary": .string(boundary), "rarity": .string(rarity.rawValue)])
    }

    init(at: Double, level: String, boundary: String, rarity: MomentRarity) {
        self.at = at
        self.level = level
        self.boundary = boundary
        self.rarity = rarity
    }

    /// Reads `data.capture`; the rarity follows from the level when it is missing or unknown.
    init?(json: JSONValue?) {
        guard let o = json?.object, let at = o["at"]?.number else { return nil }
        let level = o["level"]?.string ?? "helion"
        self.at = at
        self.level = level
        boundary = o["boundary"]?.string ?? "start"
        rarity = o["rarity"]?.string.flatMap(MomentRarity.init(rawValue:)) ?? MomentRarity(level: level) ?? .rare
    }

    var momentLevel: MomentLevel? { MomentLevel(rawValue: level) }
    var momentBoundary: MomentBoundary? { MomentBoundary(rawValue: boundary) }
}

extension HubRecord {
    /// The moment this journal entry captured, if it was made on one.
    var capture: MomentCapture? {
        guard kind == JournalEntry.kind else { return nil }
        return MomentCapture(json: data["capture"])
    }

    /// How rare the entry is: its capture's rarity, else common.
    var rarity: MomentRarity { capture?.rarity ?? .common }
}

extension JSONValue {
    /// This object with `capture` set (an entry's `data` with its moment).
    func with(capture: MomentCapture) -> JSONValue {
        var o = object ?? [:]
        o["capture"] = capture.json
        return .object(o)
    }
}

/// Every moment of the catalogue, by number or by time.
struct MomentCalendar: Sendable {
    /// How long before a moment it is announced: 11 Flavons (≈ 85 s).
    static let leadFlavons = 11

    let clock: FractonicaClock
    /// P(L) for each level 0 … 10.
    private let prefixes: [Int128]

    init(clock: FractonicaClock = .shared) {
        self.clock = clock
        prefixes = (0...10).map { clock.levelInfo($0).prefix }
    }

    private var helionPrefix: Int128 { prefixes[6] }
    /// Flavons per Helion quarter, × 4 (= P(λ) / P(η)): Flavon positions are counted in quarters of a Flavon.
    private var flavonsPerQuarter: Int128 { prefixes[10] / prefixes[6] }

    /// The moment numbered `index`; nil outside the catalogue.
    func moment(_ index: Int64) -> Moment? {
        guard index >= 0, let time = time(of: index),
              clock.inRange(time), Int128(index) < clock.count(6) * 4 else { return nil }
        let (level, j) = label(index)
        return Moment(index: index, time: time, level: level, boundary: MomentBoundary(quarter: Int(j % 4)), cycle: Int64(j / 4))
    }

    /// The longest level with a quarter boundary at moment `index`, and the boundary's number at that level
    /// (4 · cycle + quarter).
    func label(_ index: Int64) -> (MomentLevel, Int128) {
        let q = Int128(index)
        for level in MomentLevel.longestFirst {
            let ratio = helionPrefix / prefixes[level.kitLevel]
            if q % ratio == 0 { return (level, q / ratio) }
        }
        return (.helion, q)
    }

    /// The number of the moment nearest to `t` (rounded); nil outside the catalogue.
    func index(near t: Double) -> Int64? {
        guard let p = clock.position(at: t) else { return nil }
        return Int64((p * Double(helionPrefix)).rounded())
    }

    /// The number of the first moment strictly after `t`; nil outside the catalogue.
    func index(after t: Double) -> Int64? {
        guard let p = clock.position(at: t) else { return nil }
        var q = max(0, Int64((p * Double(helionPrefix)).rounded(.down)))
        // the float position is within a hair of the exact one: settle on the exact times
        while let m = time(of: q), m <= t { q += 1 }
        while q > 0, let m = time(of: q - 1), m > t { q -= 1 }
        return q
    }

    /// The exact time of moment `index`.
    func time(of index: Int64) -> Double? {
        guard index >= 0, let exact = clock.time(atPositionNumerator: Int128(index), denominator: helionPrefix) else { return nil }
        return settled(exact, index: index)
    }

    /// The first millisecond at which the engine reads the moment as reached. The engine reads time to the
    /// millisecond, and the exact boundary usually falls between two: a record stamped a hair early would read as the
    /// end of the previous period ("ε#5 77η 35ι" for a Delta's start).
    private func settled(_ exact: Double, index: Int64) -> Double {
        var t = (exact * 1000).rounded(.up) / 1000
        for _ in 0..<4 {
            guard let r = clock.level(at: t, 6) else { return t }
            if r.cycle * 4 + Int64(r.quarter) >= index { return t }
            t += 0.001
        }
        return t
    }

    /// When moment `m` is announced: `leadFlavons` Flavons before it, exactly.
    func promptTime(of m: Moment) -> Double {
        let n = Int128(m.index) * flavonsPerQuarter - 4 * Int128(Self.leadFlavons)
        return clock.time(atPositionNumerator: n, denominator: prefixes[10]) ?? m.time - 85.5
    }

    /// When moment `m`'s capture `offset` Flavons from it happens: exactly that many Flavons away in position, on the
    /// first millisecond at or after the exact instant (the moment itself for 0).
    func captureTime(of m: Moment, offset: Int) -> Double {
        if offset == 0 { return m.time }
        let n = Int128(m.index) * flavonsPerQuarter + 4 * Int128(offset)
        guard let exact = clock.time(atPositionNumerator: n, denominator: prefixes[10]) else {
            return m.time + Double(offset) * clock.levelInfo(10).meanSeconds
        }
        return (exact * 1000).rounded(.up) / 1000
    }

    /// Flavons (with their fraction) from `t` to moment `m`, measured in position as the clock counts them.
    func flavons(from t: Double, to m: Moment) -> Double {
        guard let p = clock.position(at: t) else { return (m.time - t) / clock.levelInfo(10).meanSeconds }
        return (Double(m.index) / Double(helionPrefix) - p) * Double(prefixes[10]) / 4
    }

    /// The first moment strictly after `t` that is a quarter boundary of `level` (so labelled `level` or longer),
    /// found by arithmetic: Alpha's quarters are tens of thousands of moments apart.
    func next(atLeast level: MomentLevel, after t: Double) -> Moment? {
        guard let q0 = index(after: t) else { return nil }
        let ratio = helionPrefix / prefixes[level.kitLevel]
        let q = (Int128(q0) + ratio - 1) / ratio * ratio
        return q <= Int128(Int64.max) ? moment(Int64(q)) : nil
    }

    /// The last moment at or before `t` that is a quarter boundary of `level`.
    func previous(atLeast level: MomentLevel, atOrBefore t: Double) -> Moment? {
        guard let q0 = index(after: t).map({ $0 - 1 }), q0 >= 0 else { return nil }
        let ratio = helionPrefix / prefixes[level.kitLevel]
        return moment(Int64(Int128(q0) / ratio * ratio))
    }

    /// The next `count` moments after `t` that `include` accepts, soonest first, looking at most `scan` moments ahead.
    func upcoming(after t: Double, count: Int, scan: Int = 400, where include: (Moment) -> Bool = { _ in true }) -> [Moment] {
        guard count > 0, var q = index(after: t) else { return [] }
        var out: [Moment] = []
        var looked = 0
        while out.count < count, looked < scan, let m = moment(q) {
            if include(m) { out.append(m) }
            q += 1
            looked += 1
        }
        return out
    }

    /// The most recent moment at or before `t` that `include` accepts, looking back at most `scan` moments.
    func previous(atOrBefore t: Double, scan: Int = 400, where include: (Moment) -> Bool = { _ in true }) -> Moment? {
        guard var q = index(after: t).map({ $0 - 1 }) else { return nil }
        var looked = 0
        while q >= 0, looked < scan, let m = moment(q) {
            if include(m) { return m }
            q -= 1
            looked += 1
        }
        return nil
    }
}

// MARK: - Settings

/// Earth hours in which moments are not announced (and do not break the streak): 23:00 – 07:00 by default.
struct MomentQuietHours: Hashable, Codable, Sendable {
    var enabled = true
    /// Minutes after local midnight.
    var start = 23 * 60
    var end = 7 * 60

    /// Whether `t` falls inside the window in `zone`; a window that wraps midnight holds both ends.
    func contains(_ t: Double, zone: TimeZone) -> Bool {
        guard enabled, start != end else { return false }
        let p = EarthTime.zonedParts(t, zone: zone)
        let m = p.hour * 60 + p.minute
        return start < end ? (m >= start && m < end) : (m >= start || m < end)
    }
}

/// Which Helion moments are announced; Delta and longer always are. Only a Helion's node (its mid point, Preon 18)
/// is a rare moment: its start, peak and valley, and a Nuclide's start, are not announced and do not count for the
/// streak (unless a Delta or longer has a quarter boundary there).
enum HelionPrompts: String, CaseIterable, Codable, Sendable {
    /// Every Helion's node (about every 5 hours).
    case nodes
    /// None: only Delta and longer.
    case none

    var title: String {
        switch self {
        case .nodes: "Helion nodes"
        case .none: "Delta and longer only"
        }
    }

    func includes(_ boundary: MomentBoundary) -> Bool {
        switch self {
        case .nodes: boundary == .node
        case .none: false
        }
    }
}

/// Moments' preferences, persisted as one JSON value under `moments.v1`.
struct MomentSettings: Hashable, Codable, Sendable {
    var enabled = true
    var helion = HelionPrompts.nodes
    var quiet = MomentQuietHours()
    /// Spoken announcements: the notification's sound and the instant view's greeting.
    var voice = true
    /// Open the instant view by itself when a moment is announced while the app is in front.
    var autoOpen = true
    /// How many times a moment is captured, one Flavon apart and centred on it (`MomentCaptures`): 1, 3 or 5.
    var captures = MomentCaptures.defaultCount

    init() {}

    /// Lenient: a field that cannot be read takes its default.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = MomentSettings()
        enabled = (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? d.enabled
        helion = (try? c.decodeIfPresent(HelionPrompts.self, forKey: .helion)) ?? d.helion
        quiet = (try? c.decodeIfPresent(MomentQuietHours.self, forKey: .quiet)) ?? d.quiet
        voice = (try? c.decodeIfPresent(Bool.self, forKey: .voice)) ?? d.voice
        autoOpen = (try? c.decodeIfPresent(Bool.self, forKey: .autoOpen)) ?? d.autoOpen
        captures = (try? c.decodeIfPresent(Int.self, forKey: .captures)).flatMap { $0 }
            .flatMap { MomentCaptures.choices.contains($0) ? $0 : nil } ?? d.captures
    }

    private enum CodingKeys: String, CodingKey { case enabled, helion, quiet, voice, autoOpen, captures }

    /// Whether the settings ask for this kind of moment (quiet hours aside).
    func asks(_ m: Moment) -> Bool {
        guard enabled else { return false }
        switch m.level {
        case .helion: return helion.includes(m.boundary)
        case .nuclide: return false
        default: return true
        }
    }

    /// Whether moment `m` is announced: asked for and outside quiet hours. Only these count for the streak.
    func prompts(_ m: Moment, zone: TimeZone) -> Bool {
        asks(m) && !quiet.contains(m.time, zone: zone)
    }
}

// MARK: - Captures

/// The captures of one moment: `count` of them one Flavon apart, centred on the moment (3: one Flavon before, at the
/// moment, one Flavon after), each the front and back cameras at once. Their photos are named as hub/API.md says:
/// `front` and `back` for a single capture; `front@-1`, `back@-1`, `front@0` … (the offset from the moment in Flavons)
/// for several.
enum MomentCaptures {
    static let choices = [1, 3, 5]
    static let defaultCount = 3

    /// The offsets in Flavons, earliest first: [0], [-1, 0, 1], [-2, -1, 0, 1, 2]. A count that is not one of the
    /// choices takes the default.
    static func offsets(count: Int) -> [Int] {
        let n = choices.contains(count) ? count : defaultCount
        return Array(-(n / 2)...(n / 2))
    }

    /// A photo's name: the camera ("front", "back"; "camera" on a Mac), with the offset after "@" when there are
    /// several captures.
    static func photoName(camera: String, offset: Int, count: Int) -> String {
        count <= 1 ? camera : "\(camera)@\(offset)"
    }

    /// Reads a photo's name: its camera and, for one of several captures, its offset ("front@-1" → front, -1). Nil for
    /// a name whose "@" is not followed by a whole number.
    static func parse(_ name: String) -> (camera: String, offset: Int?)? {
        guard let at = name.lastIndex(of: "@") else { return (name, nil) }
        guard let offset = Int(name[name.index(after: at)...]) else { return nil }
        return (String(name[..<at]), offset)
    }

    /// The order photos keep in a record (its display order): the back camera's captures from the earliest on, then
    /// the front camera's, so a card's first pictures run through the moment; any other name last.
    static func sortKey(_ name: String?) -> (Int, Int, String) {
        guard let name, let p = parse(name) else { return (3, 0, name ?? "") }
        let camera = p.camera == "back" ? 0 : p.camera == "front" ? 1 : 2
        return (camera, p.offset ?? 0, name)
    }

    static func sorted(_ names: [String]) -> [String] {
        names.sorted { sortKey($0) < sortKey($1) }
    }

    /// The offset in words: "1λ before", "At the moment", "2λ after".
    static func offsetLabel(_ offset: Int) -> String {
        offset == 0 ? "At the moment" : offset < 0 ? "\(-offset)λ before" : "\(offset)λ after"
    }

    /// The offset as a short tag: "−1λ", "0", "+2λ".
    static func offsetTag(_ offset: Int) -> String {
        offset == 0 ? "0" : offset < 0 ? "\u{2212}\(-offset)λ" : "+\(offset)λ"
    }
}

/// The photos of one capture of a moment: its offset in Flavons and its photos by camera.
struct MomentCaptureGroup<Item> {
    var offset: Int
    var items: [(camera: String, item: Item)]

    /// The back camera's photo, else the first.
    var main: Item? { (items.first { $0.camera == "back" } ?? items.first)?.item }
    /// The other camera's photo (the front one, BeReal's inset), when there are two.
    var inset: Item? {
        guard items.count > 1 else { return nil }
        let main = items.firstIndex { $0.camera == "back" } ?? 0
        return items.indices.first { $0 != main }.map { items[$0].item }
    }

    /// Groups named items by capture, earliest first; nil unless every item's name says which of several captures it
    /// belongs to (a single capture's `front` and `back`, or other media, show as they are).
    static func grouped(_ list: [Item], name: (Item) -> String?) -> [MomentCaptureGroup]? {
        var groups: [Int: [(camera: String, item: Item)]] = [:]
        for item in list {
            guard let n = name(item), let p = MomentCaptures.parse(n), let offset = p.offset else { return nil }
            groups[offset, default: []].append((p.camera, item))
        }
        guard !groups.isEmpty else { return nil }
        return groups.keys.sorted().map { offset in
            MomentCaptureGroup(offset: offset, items: groups[offset]!.sorted {
                MomentCaptures.sortKey($0.camera) < MomentCaptures.sortKey($1.camera)
            })
        }
    }
}

// MARK: - Streak and collection

/// What the journal's captures add up to: the current and best streaks of announced moments captured in a row, and
/// how many entries there are of each rarity.
struct MomentStats: Hashable, Sendable {
    var current = 0
    var best = 0
    var totals: [MomentRarity: Int] = [:]
    /// The numbers of the captured moments.
    var captured: Set<Int64> = []
    /// The latest captured moment's time.
    var lastCapture: Double?

    func total(_ rarity: MomentRarity) -> Int { totals[rarity] ?? 0 }
    var capturedCount: Int { captured.count }

    /// Walks the moments from the first capture to `now`: a captured moment adds one to the run, an announced one
    /// that was missed ends it; moments that were not announced (quiet hours, not asked for) neither add nor break.
    /// A moment that is announced but still running its 11 Flavons (or has just passed, `grace` seconds) does not
    /// break the run yet.
    static func make(entries: [HubRecord], calendar: MomentCalendar, settings: MomentSettings, zone: TimeZone,
                     now: Double, grace: Double = 60) -> MomentStats {
        var stats = MomentStats()
        for record in entries where record.kind == JournalEntry.kind && !record.isDeleted {
            stats.totals[record.rarity, default: 0] += 1
            if let c = record.capture, let q = calendar.index(near: c.at), let t = calendar.time(of: q), abs(t - c.at) < 1 {
                stats.captured.insert(q)
                stats.lastCapture = max(stats.lastCapture ?? c.at, c.at)
            }
        }
        guard let first = stats.captured.min(), let next = calendar.index(after: now) else { return stats }
        var run = 0
        var q = first
        while q < next {
            if stats.captured.contains(q) {
                run += 1
                stats.best = max(stats.best, run)
            } else if let m = calendar.moment(q), m.time < now - grace, settings.prompts(m, zone: zone) {
                run = 0
            }
            q += 1
        }
        stats.current = run
        return stats
    }
}
