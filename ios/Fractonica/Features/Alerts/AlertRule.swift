import FractonicaKit
import Foundation

// The rules of Alerts: what the user wants to be told about, persisted as one JSON value (`AlertsConfig`). Pure data
// and validation, free of UI and of UserNotifications, so the logic checks (Checks/) compile it on the Mac.

/// What a rule listens to.
enum AlertSubject: Hashable, Sendable, Codable {
    /// The cycles of one level (0 … 13; depth = level + 1).
    case level(Int)
    /// The solar sync (SPEC §7): 19 Helions, about 4 days, with its quarters about a day apart.
    case solar
    /// The catalogue's eclipses: the greatest eclipses of Saros 141 (#0 … #69).
    case eclipse

    /// The level of a level subject.
    var level: Int? {
        if case .level(let level) = self { return level }
        return nil
    }

    /// Eclipses have a single event; levels and the sync have five.
    var hasEvents: Bool { self != .eclipse }

    /// How important a moment of this subject is when two rules fire together: the lower wins and names the
    /// notification (an eclipse, then α … ξ, the sync ranking between ε and its 19 Helions).
    var rank: Double {
        switch self {
        case .eclipse: -1
        case .level(let level): Double(level)
        case .solar: 5.5
        }
    }
}

/// The moments of a cycle (SPEC §6.2): it begins, reaches its peak, node and valley at the quarters, and ends where the
/// next one begins.
enum AlertEvent: String, CaseIterable, Codable, Sendable, Comparable {
    case begin, peak, node, valley, end

    /// Index into `CycleFacts.events` (begin, peak, node, valley, end).
    var index: Int { Self.allCases.firstIndex(of: self)! }

    /// begin and end are turnovers; the three others are quarter thresholds inside a cycle.
    var isTurnover: Bool { self == .begin || self == .end }

    static func < (a: AlertEvent, b: AlertEvent) -> Bool { a.index < b.index }
}

/// A unit a lead time is counted in: Earth units (normal mode) or Fractonica units (pure mode).
enum LeadUnit: String, CaseIterable, Codable, Sendable {
    case minute, hour, day
    case flavon, preon, helion, nuclide

    static let earth: [LeadUnit] = [.minute, .hour, .day]
    static let fractonica: [LeadUnit] = [.flavon, .preon, .helion, .nuclide]

    /// Counted on the Fractonica ladder (λ ι η ε).
    var isFractonica: Bool { level != nil }

    /// The level whose cycle is one unit (λ 10, ι 8, η 6, ε 4).
    var level: Int? {
        switch self {
        case .minute, .hour, .day: nil
        case .flavon: 10
        case .preon: 8
        case .helion: 6
        case .nuclide: 4
        }
    }

    /// Seconds in one Earth unit.
    var seconds: Double? {
        switch self {
        case .minute: 60
        case .hour: 3600
        case .day: 86_400
        default: nil
        }
    }

    /// "λ", "ι", "η", "ε"; Earth units have no symbol.
    var symbol: String? { level.map { Fractonica.periodName($0).text } }
}

/// How long before an event its notification comes: `count` units, 0 for the moment itself.
struct AlertLead: Hashable, Codable, Sendable {
    var count: Int
    var unit: LeadUnit

    static let atMoment = AlertLead(count: 0, unit: .minute)
    static let counts = 0...999

    var isAtMoment: Bool { count <= 0 }

    /// The lead in seconds, roughly (Fractonica units by their mean length): for searching, never for firing.
    func estimatedSeconds(_ clock: FractonicaClock) -> Double {
        guard count > 0 else { return 0 }
        if let seconds = unit.seconds { return Double(count) * seconds }
        return Double(count) * clock.levelInfo(unit.level!).meanSeconds
    }
}

/// One alert rule: a subject, which of its events, filters, a lead, the message and how it is delivered.
struct AlertRule: Identifiable, Hashable, Codable, Sendable {
    var id: UUID
    /// What the list calls the rule ("Each Helion begins").
    var name: String
    var subject: AlertSubject
    /// Which events notify (ignored for eclipses).
    var events: Set<AlertEvent>
    /// Only the cycle with this 1-based place in its parent (the 5th δ of its γ); nil for every cycle. Levels only.
    var ordinal: Int?
    /// Only when this coarser level turns over at the same moment; nil for every turnover. Levels only, and only
    /// begin and end can coincide with a coarser turnover.
    var coarser: Int?
    var lead: AlertLead
    /// Message templates with tokens ({name} {event} {ordinal} {unit} {when} {time}).
    var title: String
    var body: String
    var sound: Bool
    var enabled: Bool
    /// Rings even during quiet hours.
    var ignoresQuietHours: Bool

    init(id: UUID = UUID(), name: String, subject: AlertSubject, events: Set<AlertEvent>, ordinal: Int? = nil,
         coarser: Int? = nil, lead: AlertLead = .atMoment, title: String = AlertRule.defaultTitle,
         body: String = AlertRule.defaultBody, sound: Bool = true, enabled: Bool = true, ignoresQuietHours: Bool = false) {
        self.id = id
        self.name = name
        self.subject = subject
        self.events = events
        self.ordinal = ordinal
        self.coarser = coarser
        self.lead = lead
        self.title = title
        self.body = body
        self.sound = sound
        self.enabled = enabled
        self.ignoresQuietHours = ignoresQuietHours
    }

    static let defaultTitle = "{name} {event}"
    static let defaultBody = "{when} · {time}"
    static let levels = 0...Fractonica.maxLevel

    /// The rule made valid: a level inside 0 … 13, an ordinal its parent has, a coarser level above it (with only
    /// begin and end then), at least one event, a lead inside 0 … 999, a name. Filters that do not apply are dropped.
    func sanitized(clock: FractonicaClock = .shared) -> AlertRule {
        var r = self
        switch subject {
        case .level(let level):
            let level = min(Self.levels.upperBound, max(Self.levels.lowerBound, level))
            r.subject = .level(level)
            if let n = r.ordinal {
                let places = Self.places(level: level, clock: clock)
                r.ordinal = (1...places).contains(n) ? n : nil
            }
            if let c = r.coarser, !(0..<level).contains(c) { r.coarser = nil }
            if r.coarser != nil {
                r.events = r.events.filter(\.isTurnover)
                if r.events.isEmpty { r.events = [.begin] }
            }
        case .solar:
            r.ordinal = nil
            r.coarser = nil
        case .eclipse:
            r.ordinal = nil
            r.coarser = nil
            r.events = [.begin]
        }
        if r.events.isEmpty { r.events = [.begin] }
        r.lead.count = min(Self.leadCounts.upperBound, max(0, r.lead.count))
        r.name = r.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if r.name.isEmpty { r.name = "Alert" }
        return r
    }

    static let leadCounts = AlertLead.counts

    /// How many places a level's cycles have in their parent (Alpha: the catalogue's 18 Alphas).
    static func places(level: Int, clock: FractonicaClock = .shared) -> Int {
        clock.levelInfo(level).siblings ?? Int(clock.count(0))
    }

    /// Whether the filters can ever be met together: with a coarser turnover, a beginning cycle is always the first
    /// in its parent and an ending one the last.
    func filtersCanMeet(clock: FractonicaClock = .shared) -> Bool {
        guard case .level(let level) = subject, coarser != nil, let ordinal else { return true }
        let places = Self.places(level: level, clock: clock)
        return (events.contains(.begin) && ordinal == 1) || (events.contains(.end) && ordinal == places)
    }
}

// MARK: - Quiet hours

/// A nightly window (local wall-clock minutes in the settings' time zone) during which alerts stay silent or are held
/// back. Stored in Earth terms because sleep follows the local day; pure mode shows it inside the solar quarter.
struct QuietHours: Hashable, Codable, Sendable {
    enum Mode: String, Codable, CaseIterable, Sendable {
        /// Delivered to the notification list without sound or banner.
        case silence
        /// Not delivered at all.
        case skip
    }

    var enabled = false
    /// Minutes after local midnight, 0 ..< 1440.
    var start = 22 * 60 + 30
    var end = 7 * 60
    var mode = Mode.silence

    static let minutesPerDay = 1440

    /// Whether `t` falls inside the window in `zone`. A window that wraps midnight (22:30 – 07:00) holds both ends;
    /// an empty window (start == end) holds nothing.
    func contains(_ t: Double, zone: TimeZone) -> Bool {
        guard enabled, start != end else { return false }
        let p = EarthTime.zonedParts(t, zone: zone)
        let m = p.hour * 60 + p.minute
        return start < end ? (m >= start && m < end) : (m >= start || m < end)
    }

    init(enabled: Bool = false, start: Int = 22 * 60 + 30, end: Int = 7 * 60, mode: Mode = .silence) {
        self.enabled = enabled
        self.start = start
        self.end = end
        self.mode = mode
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = QuietHours()
        enabled = (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? d.enabled
        start = (try? c.decodeIfPresent(Int.self, forKey: .start)) ?? d.start
        end = (try? c.decodeIfPresent(Int.self, forKey: .end)) ?? d.end
        mode = (try? c.decodeIfPresent(Mode.self, forKey: .mode)) ?? d.mode
    }

    private enum CodingKeys: String, CodingKey { case enabled, start, end, mode }

    func sanitized() -> QuietHours {
        var q = self
        q.start = ((start % Self.minutesPerDay) + Self.minutesPerDay) % Self.minutesPerDay
        q.end = ((end % Self.minutesPerDay) + Self.minutesPerDay) % Self.minutesPerDay
        return q
    }
}

// MARK: - Persistence

/// Everything Alerts keeps: the rules in list order and the quiet hours. Saved as one JSON value under
/// `alerts.v1`; unknown or broken data falls back to no rules, and each rule is sanitized on the way in.
struct AlertsConfig: Hashable, Codable, Sendable {
    var rules: [AlertRule] = []
    var quiet = QuietHours()

    init(rules: [AlertRule] = [], quiet: QuietHours = QuietHours()) {
        self.rules = rules
        self.quiet = quiet
    }

    /// Lenient: a rule that cannot be read is dropped, not the whole list; broken quiet hours take the defaults.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rules = ((try? c.decodeIfPresent([Lossy<AlertRule>].self, forKey: .rules)) ?? []).compactMap(\.value)
        quiet = (try? c.decodeIfPresent(QuietHours.self, forKey: .quiet)) ?? QuietHours()
    }

    private enum CodingKeys: String, CodingKey { case rules, quiet }

    static let key = "alerts.v1"
    /// More rules than this would starve each other of the 60 notification slots.
    static let maxRules = 30

    static func load(from defaults: UserDefaults) -> AlertsConfig {
        guard let data = defaults.data(forKey: key) else { return AlertsConfig() }
        return decode(data) ?? AlertsConfig()
    }

    static func decode(_ data: Data) -> AlertsConfig? {
        guard let raw = try? JSONDecoder().decode(AlertsConfig.self, from: data) else { return nil }
        return raw.sanitized()
    }

    func save(to defaults: UserDefaults) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }

    func sanitized() -> AlertsConfig {
        var seen = Set<UUID>()
        let rules = rules.filter { seen.insert($0.id).inserted }.prefix(Self.maxRules).map { $0.sanitized() }
        return AlertsConfig(rules: Array(rules), quiet: quiet.sanitized())
    }
}

/// Decodes a value or nothing, so one broken element does not fail its array.
private struct Lossy<Value: Decodable>: Decodable {
    let value: Value?

    init(from decoder: Decoder) throws {
        value = try? Value(from: decoder)
    }
}

extension AlertRule {
    private enum CodingKeys: String, CodingKey {
        case id, name, subject, events, ordinal, coarser, lead, title, body, sound, enabled, ignoresQuietHours
    }

    /// Lenient: a missing field takes its default, so older or newer saves still load.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decodeIfPresent(UUID.self, forKey: .id) ?? UUID(),
            name: try c.decodeIfPresent(String.self, forKey: .name) ?? "Alert",
            subject: try c.decode(AlertSubject.self, forKey: .subject),
            events: Set((try? c.decodeIfPresent([AlertEvent].self, forKey: .events)) ?? [.begin]),
            ordinal: try? c.decodeIfPresent(Int.self, forKey: .ordinal),
            coarser: try? c.decodeIfPresent(Int.self, forKey: .coarser),
            lead: (try? c.decodeIfPresent(AlertLead.self, forKey: .lead)) ?? .atMoment,
            title: (try? c.decodeIfPresent(String.self, forKey: .title)) ?? Self.defaultTitle,
            body: (try? c.decodeIfPresent(String.self, forKey: .body)) ?? Self.defaultBody,
            sound: (try? c.decodeIfPresent(Bool.self, forKey: .sound)) ?? true,
            enabled: (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? true,
            ignoresQuietHours: (try? c.decodeIfPresent(Bool.self, forKey: .ignoresQuietHours)) ?? false
        )
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(subject, forKey: .subject)
        try c.encode(events.sorted(), forKey: .events)
        try c.encodeIfPresent(ordinal, forKey: .ordinal)
        try c.encodeIfPresent(coarser, forKey: .coarser)
        try c.encode(lead, forKey: .lead)
        try c.encode(title, forKey: .title)
        try c.encode(body, forKey: .body)
        try c.encode(sound, forKey: .sound)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(ignoresQuietHours, forKey: .ignoresQuietHours)
    }
}

// MARK: - Presets

/// Starting points for new rules.
enum AlertPreset: String, CaseIterable, Identifiable, Sendable {
    case helion, nuclide, deltaQuarters, solarQuarters, majors, eclipse

    var id: String { rawValue }

    var title: String {
        switch self {
        case .helion: "Each Helion begins"
        case .nuclide: "Nuclide turns over"
        case .deltaQuarters: "Delta quarters"
        case .solarQuarters: "Solar sync quarters"
        case .majors: "Gamma, Beta and Alpha turns"
        case .eclipse: "Next eclipse of Saros 141"
        }
    }

    /// What the preset does; pure mode says it in Fractonica terms only.
    func detail(pure: Bool) -> String {
        switch self {
        case .helion: pure ? "The basic unit: 36ι each, 77 to a Nuclide." : "The basic unit, about 5 hours: 77 to a Nuclide."
        case .nuclide: pure ? "A new Nuclide: 77η each, 5 to a Delta." : "A new Nuclide, about 16 days: 5 to a Delta."
        case .deltaQuarters: "Peak, node, valley and end of each Delta."
        case .solarQuarters: pure ? "The sync begins, peaks, nodes and reaches its valley: 19η in all."
            : "The sync's four quarters, about a day apart."
        case .majors: "Each new Gamma, and the Beta or Alpha that turns with it."
        case .eclipse: pure ? "The catalogue's next greatest eclipse, 5η ahead." : "The catalogue's next greatest eclipse, a day ahead."
        }
    }

    var subject: AlertSubject {
        switch self {
        case .helion: .level(6)
        case .nuclide: .level(4)
        case .deltaQuarters: .level(3)
        case .solarQuarters: .solar
        case .majors: .level(2)
        case .eclipse: .eclipse
        }
    }

    /// A new rule from this preset; leads are counted in the units of the mode it is made in.
    func rule(pure: Bool) -> AlertRule {
        switch self {
        case .helion:
            AlertRule(name: title, subject: subject, events: [.begin], title: "{name} begins", body: "A new Helion · {time}")
        case .nuclide:
            AlertRule(name: title, subject: subject, events: [.begin], title: "{name} begins",
                      body: "A new Nuclide · {time}")
        case .deltaQuarters:
            AlertRule(name: title, subject: subject, events: [.peak, .node, .valley, .end], body: "{when} · {time}")
        case .solarQuarters:
            AlertRule(name: title, subject: subject, events: [.begin, .peak, .node, .valley], body: "{when} · {time}")
        case .majors:
            AlertRule(name: title, subject: subject, events: [.begin], title: "{name} begins",
                      body: "Every finer cycle begins with it · {time}")
        case .eclipse:
            AlertRule(name: title, subject: subject, events: [.begin],
                      lead: pure ? AlertLead(count: 5, unit: .helion) : AlertLead(count: 1, unit: .day),
                      title: "Saros 141 eclipse {name}", body: "Greatest eclipse {when} · {time}", ignoresQuietHours: true)
        }
    }
}

// MARK: - Pure-mode helpers

extension AlertLead {
    /// The nearest lead counted on the Fractonica ladder (pure mode cannot show minutes): the longest of ε η ι λ that
    /// fits at least once, by mean length. Fractonica leads come back unchanged.
    func inFractonicaUnits(clock: FractonicaClock = .shared) -> AlertLead {
        guard let seconds = unit.seconds, count > 0 else { return self }
        let span = Double(count) * seconds
        for unit in LeadUnit.fractonica.reversed() {
            let n = (span / clock.levelInfo(unit.level!).meanSeconds).rounded()
            if n >= 1 { return AlertLead(count: min(AlertLead.counts.upperBound, Int(n)), unit: unit) }
        }
        return AlertLead(count: 1, unit: .flavon)
    }
}

/// The solar quarter running at an instant: a quarter of the solar sync, 4η 27ι = 171ι, which keeps step with the
/// civil day (SPEC §7). Pure mode places quiet hours in it, since it cannot show a time of day.
struct SolarQuarter: Hashable, Sendable {
    /// Preons in a quarter: 19 Helions / 4 = 4.75η = 171ι.
    static let preons = 171

    let start: Double
    let length: Double

    init?(at t: Double, clock: FractonicaClock = .shared) {
        guard let s = clock.solar(at: t) else { return nil }
        length = (s.end - s.start) / 4
        start = s.start + Double(s.quarter) * length
    }

    /// Where local minute `minute` of the day falls in this quarter, in Preons from its start (0 ..< 171): its first
    /// occurrence at or after the quarter's start.
    func preons(ofMinute minute: Int, zone: TimeZone) -> Double {
        let p = EarthTime.zonedParts(start, zone: zone)
        let m = ((minute % QuietHours.minutesPerDay) + QuietHours.minutesPerDay) % QuietHours.minutesPerDay
        var t = EarthTime.zonedToUnix(EarthTime.CivilTime(year: p.year, month: p.month, day: p.day, hour: m / 60,
                                                          minute: m % 60), zone: zone)
        if t < start {
            let next = EarthTime.civilFromDays(EarthTime.daysFromCivil(p.year, p.month, p.day) + 1)
            t = EarthTime.zonedToUnix(EarthTime.CivilTime(year: next.year, month: next.month, day: next.day, hour: m / 60,
                                                          minute: m % 60), zone: zone)
        }
        let offset = min(length, max(0, t - start))
        return offset / length * Double(Self.preons)
    }

    /// The local minute of the day at `preons` Preons into this quarter, to the nearest minute.
    func minute(atPreons preons: Double, zone: TimeZone) -> Int {
        let p = EarthTime.zonedParts(start + preons / Double(Self.preons) * length + 30, zone: zone)
        return p.hour * 60 + p.minute
    }

    /// "+2η 8ι", "+27ι", "+0ι": an offset into the quarter in Helions and Preons.
    static func label(preons: Int) -> String {
        let eta = preons / 36, iota = preons % 36
        return eta > 0 ? (iota > 0 ? "+\(eta)η \(iota)ι" : "+\(eta)η") : "+\(iota)ι"
    }
}
