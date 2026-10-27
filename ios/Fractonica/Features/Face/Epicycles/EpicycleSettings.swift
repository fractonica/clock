import Foundation
import Observation

/// The epicycle face's configuration on this device (UserDefaults `epicycles.v1`, one JSON value), validated like
/// `AppSettings`: garbage in storage falls back field by field, an invalid write is ignored. The launch hooks
/// (`EpicycleLaunch`) are shown for the launch and never saved; a change the person makes is saved on top of what was
/// stored. Also holds whether the editor is open, so the face (a long press) and the Now screen's menu can open it.
@MainActor @Observable
final class EpicycleSettings {
    static let shared = EpicycleSettings()

    /// What the face shows.
    private(set) var config: EpicycleConfig
    /// The editor is open (the Now screen presents it while the epicycle face shows).
    var editing: Bool

    /// What is saved: `config` without the launch hooks.
    @ObservationIgnored private var stored: EpicycleConfig
    @ObservationIgnored private let defaults: UserDefaults
    static let key = "epicycles.v1"

    init(defaults: UserDefaults = .standard, launch: EpicycleLaunch? = nil) {
        self.defaults = defaults
        let loaded = defaults.data(forKey: Self.key).flatMap { try? JSONDecoder().decode(EpicycleConfig.self, from: $0) } ?? EpicycleConfig()
        let hooks = launch ?? EpicycleLaunch(arguments: UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain))
        stored = loaded
        config = hooks.applied(to: loaded)
        editing = hooks.edit
    }

    /// Changes the configuration (validated) and saves the same change on top of what is stored.
    func update(_ change: (inout EpicycleConfig) -> Void) {
        var next = config
        change(&next)
        next = next.sanitized(keeping: config)
        if next != config { config = next }
        var save = stored
        change(&save)
        save = save.sanitized(keeping: stored)
        guard save != stored else { return }
        stored = save
        if let data = try? JSONEncoder().encode(save) { defaults.set(data, forKey: Self.key) }
    }

    /// The face as it ships, shown and saved.
    func reset() {
        config = EpicycleConfig()
        stored = EpicycleConfig()
        defaults.removeObject(forKey: Self.key)
    }

    /// Whether the shown configuration is the default one.
    var isStandard: Bool { config == EpicycleConfig() }

    // MARK: The editor's bindings

    func setBase(_ level: Int) { update { $0.setBase(level) } }
    func setTop(_ level: Int) { update { $0.top = level } }
    func setRadius(_ r: Double, level: Int) { update { $0.radii[level] = min(max(r, EpicycleConfig.radiusRange.lowerBound), EpicycleConfig.radiusRange.upperBound) } }

    func setOn(_ on: Bool, level: Int) {
        update { v in
            if on { v.off.remove(level) } else { v.off.insert(level) }
        }
    }

    func setReversed(_ reversed: Bool, level: Int) {
        update { v in
            if reversed { v.reversed.insert(level) } else { v.reversed.remove(level) }
        }
    }

    func setFrame(_ frame: EpicycleFrame) { update { $0.frame = frame } }
    func setTips(_ tips: Bool) { update { $0.tips = tips } }
}
