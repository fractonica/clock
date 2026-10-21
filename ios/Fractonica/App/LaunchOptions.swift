import Foundation

/// Test hooks for screenshots and UI checks, read from the launch arguments (UserDefaults' argument domain, so they
/// never persist):
///
///     -FXTab <screen>    open a screen, presenting it as a sheet or cover where that is how it appears:
///                        now rings ladder wave timeline converter month diary sound timer stopwatch alerts focus jump settings
///     -FXTime <unix s>   start travelling, paused at that moment (e.g. 1791460800, SPEC §12 vector A)
///     -FXPure 1|0        pure mode on / off for this launch
///     -FXZone <IANA id>  time zone for this launch (e.g. UTC), for reproducible Earth times
///     -FXLink <url>      open an `AppLink` as a widget or notification tap does (fractonica://rings?t=1791460800);
///                        it replaces -FXTab, and its moment replaces -FXTime
///
///     xcrun simctl launch booted app.fractonica.clock -FXTab rings -FXTime 1791460800 -FXZone UTC
struct LaunchOptions: Sendable {
    var screen: Screen?
    var time: Double?
    var pure: Bool?
    var zone: String?
    var link: AppLink?

    /// The options this process was launched with.
    static func current(_ defaults: UserDefaults = .standard) -> LaunchOptions {
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        return LaunchOptions(
            screen: string("FXTab").flatMap { Screen(rawValue: $0.lowercased()) },
            time: string("FXTime").flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil },
            pure: string("FXPure").flatMap { ["1", "yes", "true"].contains($0.lowercased()) ? true : ["0", "no", "false"].contains($0.lowercased()) ? false : nil },
            zone: string("FXZone"),
            link: string("FXLink").flatMap(URL.init(string:)).flatMap(AppLink.init(url:))
        )
    }

    /// Applies the options before the first window appears.
    @MainActor
    func apply(store: ClockStore, settings: AppSettings, router: AppRouter) {
        settings.override(pure: pure, zone: zone)
        if let time { store.travel(to: time, rate: 0) }
        router.launchLink = link ?? screen.map { AppLink(screen: $0) }
    }
}
