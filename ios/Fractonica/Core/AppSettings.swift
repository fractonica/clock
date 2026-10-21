import Foundation
import Observation

/// The settings every screen shares (the settings half of src/core/store.js), persisted in UserDefaults as one JSON
/// value. Every value is validated like the web store: an unknown time zone, a non-integer or out-of-range depth is
/// ignored and never saved, garbage in storage falls back to the defaults, and `minDepth` never exceeds `maxDepth`.
///
/// Read and bind it from the environment:
///
///     @Environment(AppSettings.self) private var settings
///     Toggle("Pure mode", isOn: Bindable(settings).pure)
@MainActor @Observable
final class AppSettings {
    /// The app's settings. Views read them from the environment; non-view code uses this instance.
    static let shared = AppSettings()

    /// The clock face of the Now screen.
    enum FaceMode: String, Codable, CaseIterable, Sendable {
        /// Units as the diary writes them ("34η 29ι 21λ"), src/ui/face/journal.js.
        case journal
        /// The spec's watch face (SPEC §8–§10).
        case watch
    }

    /// Valid ranges (src/core/store.js `VALID`).
    nonisolated static let journalUnits = 0...6
    nonisolated static let topDepths = 2...11
    nonisolated static let levels = 0...13
    nonisolated static let depths = 1...14

    /// Pure mode: Fractonica terms only, no Gregorian dates, Earth time units or percentages (SPEC §15).
    var pure: Bool {
        get { values.pure }
        set { update { $0.pure = newValue } }
    }

    /// IANA time zone identifier; nil follows the system zone.
    var zone: String? {
        get { values.zone }
        set { update { $0.zone = newValue } }
    }

    var faceMode: FaceMode {
        get { values.faceMode }
        set { update { $0.faceMode = newValue } }
    }

    /// The journal face's first unit: 0 α … 3 δ, 4 ε, 5 η, 6 ι (`Journal.units`).
    var journalUnit: Int {
        get { values.journalUnit }
        set { update { $0.journalUnit = newValue } }
    }

    /// Depth of the upper period on the watch face (SPEC §10: 2…11).
    var topDepth: Int {
        get { values.topDepth }
        set { update { $0.topDepth = newValue } }
    }

    /// The level (0-based) highlighted across screens and stepped by ◀︎ ▶︎; depth = level + 1.
    var selectedLevel: Int {
        get { values.selectedLevel }
        set { update { $0.selectedLevel = newValue } }
    }

    /// The depth range (1…14) the rings, ladder and timeline lanes show.
    var minDepth: Int {
        get { values.minDepth }
        set { update { $0.minDepth = newValue } }
    }

    var maxDepth: Int {
        get { values.maxDepth }
        set { update { $0.maxDepth = newValue } }
    }

    /// Period letters shown permanently on the watch face (SPEC §8).
    var showLetters: Bool {
        get { values.showLetters }
        set { update { $0.showLetters = newValue } }
    }

    /// Haptic feedback on steps, turnovers and selections (`Haptics`).
    var haptics: Bool {
        get { values.haptics }
        set { update { $0.haptics = newValue } }
    }

    /// The zone Earth times are shown in.
    var timeZone: TimeZone {
        values.zone.flatMap(TimeZone.init(identifier:)) ?? .current
    }

    /// What screens see (observed as a whole: any change redraws its readers, and settings change rarely).
    private(set) var values: Values
    /// What is saved: `values` without the launch overrides.
    @ObservationIgnored private var stored: Values
    @ObservationIgnored private let defaults: UserDefaults
    private static let key = "settings.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let loaded = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(Values.self, from: $0) } ?? Values()
        values = loaded
        stored = loaded
    }

    /// Settings for this launch only (the `-FXPure` / `-FXZone` test hooks): shown, never saved.
    func override(pure: Bool? = nil, zone: String? = nil) {
        update(persist: false) { v in
            if let pure { v.pure = pure }
            if let zone { v.zone = zone }
        }
    }

    private func update(persist: Bool = true, _ change: (inout Values) -> Void) {
        var next = values
        change(&next)
        next = next.sanitized(keeping: values)
        if next != values { values = next }
        guard persist else { return }
        var save = stored
        change(&save)
        save = save.sanitized(keeping: stored)
        guard save != stored else { return }
        stored = save
        if let data = try? JSONEncoder().encode(save) { defaults.set(data, forKey: Self.key) }
    }
}

extension AppSettings {
    /// The stored settings with the web app's defaults.
    struct Values: Codable, Equatable, Sendable {
        var pure = false
        var zone: String? = nil
        var faceMode = FaceMode.journal
        var journalUnit = 5
        var topDepth = 7
        var selectedLevel = 6
        var minDepth = 1
        var maxDepth = 10
        var showLetters = false
        var haptics = true

        init() {}

        /// Reads what it can: a missing, mistyped or invalid value keeps its default.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            func read<T: Decodable>(_ key: CodingKeys, _ type: T.Type) -> T? { (try? c.decodeIfPresent(type, forKey: key)) ?? nil }
            var v = Values()
            if let x = read(.pure, Bool.self) { v.pure = x }
            if let x = read(.zone, String.self) { v.zone = x }
            if let x = read(.faceMode, FaceMode.self) { v.faceMode = x }
            if let x = read(.journalUnit, Int.self) { v.journalUnit = x }
            if let x = read(.topDepth, Int.self) { v.topDepth = x }
            if let x = read(.selectedLevel, Int.self) { v.selectedLevel = x }
            if let x = read(.minDepth, Int.self) { v.minDepth = x }
            if let x = read(.maxDepth, Int.self) { v.maxDepth = x }
            if let x = read(.showLetters, Bool.self) { v.showLetters = x }
            if let x = read(.haptics, Bool.self) { v.haptics = x }
            self = v.sanitized(keeping: Values())
        }

        /// Every invalid field takes its value from `fallback`; then `minDepth` ≤ `maxDepth` is restored by moving
        /// `minDepth` (to its fallback when that fits, else down to `maxDepth`).
        func sanitized(keeping fallback: Values) -> Values {
            var v = self
            if let z = v.zone, TimeZone(identifier: z) == nil { v.zone = fallback.zone }
            if !AppSettings.journalUnits.contains(v.journalUnit) { v.journalUnit = fallback.journalUnit }
            if !AppSettings.topDepths.contains(v.topDepth) { v.topDepth = fallback.topDepth }
            if !AppSettings.levels.contains(v.selectedLevel) { v.selectedLevel = fallback.selectedLevel }
            if !AppSettings.depths.contains(v.minDepth) { v.minDepth = fallback.minDepth }
            if !AppSettings.depths.contains(v.maxDepth) { v.maxDepth = fallback.maxDepth }
            if v.minDepth > v.maxDepth { v.minDepth = fallback.minDepth <= v.maxDepth ? fallback.minDepth : v.maxDepth }
            return v
        }
    }
}
