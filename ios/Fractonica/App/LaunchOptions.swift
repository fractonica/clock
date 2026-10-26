import Foundation

/// Test hooks for screenshots and UI checks, read from the launch arguments (UserDefaults' argument domain, so they
/// never persist):
///
///     -FXTab <screen>    open a screen, presenting it as a sheet or cover where that is how it appears:
///                        now journal rings ladder wave timeline converter month diary sound timer stopwatch alerts focus jump
///                        settings (the Journal adds its own: -FXJournalSeed, -FXJournalStore … see JournalLaunch)
///     -FXTime <unix s>   start travelling, paused at that moment (e.g. 1791460800, SPEC §12 vector A; negative values
///                        before 1970 work too)
///     -FXPure 1|0        pure mode on / off for this launch
///     -FXZone <IANA id>  time zone for this launch (e.g. UTC), for reproducible Earth times
///     -FXLink <url>      open an `AppLink` as a widget or notification tap does (fractonica://rings?t=1791460800);
///                        it replaces -FXTab, and its moment replaces -FXTime
///     -FXRate <rate>     run a time-lapse at that many displayed seconds per real second (from -FXTime, or from now;
///                        3600 is Play's default; negative values run backwards), for profiling and animated shots
///     -FXHubSettings 1   present the hub settings page (Features/Journal/Hub) as a sheet; with it, HubSyncHooks reads
///                        -FXHubDemo <n> (a demo journal store with n entries to sync) and HubPresentations reads
///                        -FXHubScheme light|dark (the hub sheets' appearance)
///     -FXHubPair <url>   with -FXHubCode <code>: pair with that hub at launch, no confirmation (debug builds)
///
///     xcrun simctl launch booted app.fractonica.clock -FXTab rings -FXTime 1791460800 -FXZone UTC
struct LaunchOptions: Sendable {
    var screen: Screen?
    var time: Double?
    var pure: Bool?
    var zone: String?
    var link: AppLink?
    var rate: Double?
    var hubSettings = false

    /// The options this process was launched with.
    static func current(_ defaults: UserDefaults = .standard, arguments: [String] = CommandLine.arguments) -> LaunchOptions {
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        // The argument domain reads "-FXTime -11253795000" as two flags, so a time before 1970 is taken from the raw
        // arguments: the token after -FXTime, whatever its sign.
        func raw(_ flag: String) -> String? {
            arguments.firstIndex(of: flag).flatMap { i in i + 1 < arguments.count ? arguments[i + 1] : nil }
        }
        func number(_ text: String?) -> Double? { text.flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil } }
        return LaunchOptions(
            screen: string("FXTab").flatMap { Screen(rawValue: $0.lowercased()) },
            time: number(raw("-FXTime") ?? string("FXTime")),
            pure: string("FXPure").flatMap { ["1", "yes", "true"].contains($0.lowercased()) ? true : ["0", "no", "false"].contains($0.lowercased()) ? false : nil },
            zone: string("FXZone"),
            link: string("FXLink").flatMap(URL.init(string:)).flatMap(AppLink.init(url:)),
            rate: number(raw("-FXRate") ?? string("FXRate")).flatMap { $0 != 0 ? $0 : nil },
            hubSettings: string("FXHubSettings").map { ["1", "yes", "true"].contains($0.lowercased()) } ?? false
        )
    }

    /// Applies the options before the first window appears.
    @MainActor
    func apply(store: ClockStore, settings: AppSettings, router: AppRouter) {
        settings.override(pure: pure, zone: zone)
        if let time { store.travel(to: time, rate: 0) }
        if let rate {
            if time == nil { store.travel(to: store.time(), rate: 0) }
            store.setRate(rate)
        }
        router.launchLink = link ?? screen.map { AppLink(screen: $0) }
        router.isHubSettingsPresented = hubSettings
    }
}
