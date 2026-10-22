import AppIntents
import FractonicaKit
import Foundation
import WidgetKit

// How each widget is configured (long-press › Edit Widget). The extension cannot read the app's settings (no App
// Group), so wording and zone are chosen per widget, defaulting to the app's own defaults: Earth words in the
// device's zone, the Helion journal face.

// MARK: - Options

/// Fractonica terms only (pure mode, SPEC §15) or with Earth time.
enum WordingOption: String, AppEnum {
    case earth, pure

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Wording"
    static let caseDisplayRepresentations: [WordingOption: DisplayRepresentation] = [
        .earth: DisplayRepresentation(title: "With Earth time", subtitle: "Countdowns and moments in a time zone"),
        .pure: DisplayRepresentation(title: "Fractonica only", subtitle: "Pure mode: no Earth dates or units"),
    ]
}

/// The journal face's lead unit (`Journal.units` 0 … 5).
enum JournalUnitOption: String, AppEnum {
    case alpha, beta, gamma, delta, nuclide, helion

    var unit: Int {
        switch self {
        case .alpha: 0
        case .beta: 1
        case .gamma: 2
        case .delta: 3
        case .nuclide: 4
        case .helion: 5
        }
    }

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Unit"
    static let caseDisplayRepresentations: [JournalUnitOption: DisplayRepresentation] = [
        .alpha: DisplayRepresentation(title: "Alpha", subtitle: "α, the era: its phase and quarter"),
        .beta: DisplayRepresentation(title: "Beta", subtitle: "β: its phase and quarter"),
        .gamma: DisplayRepresentation(title: "Gamma", subtitle: "γ, the year: its phase and quarter"),
        .delta: DisplayRepresentation(title: "Delta", subtitle: "δ, the month: its phase and quarter"),
        .nuclide: DisplayRepresentation(title: "Nuclide", subtitle: "ε η ι: the week, its Helion and Preon"),
        .helion: DisplayRepresentation(title: "Helion", subtitle: "η ι: the hour and its Preons"),
    ]
}

/// Up next's shortest unit: the list starts there and goes up to the Alpha (the web card's importance, α–η … α–γ).
enum UpNextUnitOption: String, AppEnum {
    case helion, nuclide, delta, gamma

    /// The finest level listed (`UpNextSnapshot.levels(from:)`).
    var level: Int {
        switch self {
        case .helion: 6
        case .nuclide: 4
        case .delta: 3
        case .gamma: 2
        }
    }

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Shortest Unit"
    static let caseDisplayRepresentations: [UpNextUnitOption: DisplayRepresentation] = [
        .helion: DisplayRepresentation(title: "Helion", subtitle: "η ε δ γ β α: every Helion and up"),
        .nuclide: DisplayRepresentation(title: "Nuclide", subtitle: "ε δ γ β α: from the Nuclide up"),
        .delta: DisplayRepresentation(title: "Delta", subtitle: "δ γ β α: from the Delta up"),
        .gamma: DisplayRepresentation(title: "Gamma", subtitle: "γ β α: from the Gamma up"),
    ]
}

/// An IANA time zone.
struct TimeZoneEntity: AppEntity {
    let id: String

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Time Zone"
    static let defaultQuery = TimeZoneQuery()

    var displayRepresentation: DisplayRepresentation {
        let city = id.split(separator: "/").last.map { $0.replacingOccurrences(of: "_", with: " ") } ?? id
        let tag = EarthFormatter(zone: id).tag(Date.now.timeIntervalSince1970)
        return DisplayRepresentation(title: "\(city)", subtitle: "\(id) · \(tag)")
    }
}

/// Every zone the system knows, searchable by any part of its identifier.
struct TimeZoneQuery: EntityStringQuery {
    func entities(for identifiers: [TimeZoneEntity.ID]) async throws -> [TimeZoneEntity] {
        identifiers.filter { TimeZone(identifier: $0) != nil }.map(TimeZoneEntity.init(id:))
    }

    func entities(matching string: String) async throws -> [TimeZoneEntity] {
        let needle = string.replacingOccurrences(of: " ", with: "_")
        return TimeZone.knownTimeZoneIdentifiers
            .filter { $0.localizedCaseInsensitiveContains(needle) }
            .map(TimeZoneEntity.init(id:))
    }

    /// This device's zone first, then UTC, then every other zone.
    func suggestedEntities() async throws -> [TimeZoneEntity] {
        let first = [TimeZone.current.identifier, "UTC"]
        let rest = TimeZone.knownTimeZoneIdentifiers.filter { !first.contains($0) }
        return (first + rest).map(TimeZoneEntity.init(id:))
    }
}

// MARK: - Configuration intents

struct JournalWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Journal"
    static let description = IntentDescription("The journal face of the Now screen.")

    @Parameter(title: "Unit", default: .helion)
    var unit: JournalUnitOption

    init() {}

    init(unit: JournalUnitOption) {
        self.unit = unit
    }
}

/// Wording and zone, shared by the widgets that can speak Earth time.
protocol WordingIntent: WidgetConfigurationIntent {
    var wording: WordingOption { get }
    var zone: TimeZoneEntity? { get }
}

extension WordingIntent {
    var words: WidgetWords { WidgetWords(pure: wording == .pure, zone: zone?.id) }
}

struct ClockWidgetIntent: WordingIntent {
    static let title: LocalizedStringResource = "Clock"
    static let description = IntentDescription("The minor clock, the date, the Helion's phase and the solar sync.")

    @Parameter(title: "Wording", default: .earth)
    var wording: WordingOption
    @Parameter(title: "Time Zone", description: "Leave empty for this device's zone.")
    var zone: TimeZoneEntity?

    static var parameterSummary: some ParameterSummary {
        When(\.$wording, .equalTo, .earth) {
            Summary { \.$wording; \.$zone }
        } otherwise: {
            Summary { \.$wording }
        }
    }

    init() {}

    init(wording: WordingOption) {
        self.wording = wording
    }
}

struct UpNextWidgetIntent: WordingIntent {
    static let title: LocalizedStringResource = "Up Next"
    static let description = IntentDescription("The next turnover of every unit, from the Helion to the Alpha.")

    @Parameter(title: "From", description: "The shortest unit listed; longer ones follow.", default: .helion)
    var from: UpNextUnitOption
    @Parameter(title: "Wording", default: .earth)
    var wording: WordingOption
    @Parameter(title: "Time Zone", description: "Leave empty for this device's zone.")
    var zone: TimeZoneEntity?

    static var parameterSummary: some ParameterSummary {
        When(\.$wording, .equalTo, .earth) {
            Summary { \.$from; \.$wording; \.$zone }
        } otherwise: {
            Summary { \.$from; \.$wording }
        }
    }

    init() {}

    init(wording: WordingOption, from: UpNextUnitOption = .helion) {
        self.wording = wording
        self.from = from
    }
}

struct RingsWidgetIntent: WordingIntent {
    static let title: LocalizedStringResource = "Rings"
    static let description = IntentDescription("Every cycle from the Alpha to the Helion at a glance.")

    @Parameter(title: "Wording", default: .earth)
    var wording: WordingOption
    @Parameter(title: "Time Zone", description: "Leave empty for this device's zone.")
    var zone: TimeZoneEntity?

    static var parameterSummary: some ParameterSummary {
        When(\.$wording, .equalTo, .earth) {
            Summary { \.$wording; \.$zone }
        } otherwise: {
            Summary { \.$wording }
        }
    }

    init() {}

    init(wording: WordingOption) {
        self.wording = wording
    }
}

struct OverviewWidgetIntent: WordingIntent {
    static let title: LocalizedStringResource = "Overview"
    static let description = IntentDescription("The clock, every cycle as a dial, and what turns over next.")

    @Parameter(title: "Wording", default: .earth)
    var wording: WordingOption
    @Parameter(title: "Time Zone", description: "Leave empty for this device's zone.")
    var zone: TimeZoneEntity?

    static var parameterSummary: some ParameterSummary {
        When(\.$wording, .equalTo, .earth) {
            Summary { \.$wording; \.$zone }
        } otherwise: {
            Summary { \.$wording }
        }
    }

    init() {}

    init(wording: WordingOption) {
        self.wording = wording
    }
}
