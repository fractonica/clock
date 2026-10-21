import Foundation

/// A link into the app, for widgets, controls, notifications, Shortcuts and shared moments (the native counterpart of
/// the web app's `?view=…&t=…` URL parameters):
///
///     fractonica://rings                    open a screen (its `Screen` raw value; empty or unknown opens Now)
///     fractonica://now?t=1791460800         … showing that moment (time travel, paused; clamped to the catalogue)
///
///     Link(destination: AppLink(screen: .timer).url) { … }             // a widget
///     content.userInfo = AppLink(screen: .alerts).userInfo             // a notification: a tap opens it
///
/// The app opens links in `RootView` (`.onOpenURL`) and in the notification router; the scheme is registered in
/// project.yml (`CFBundleURLTypes`).
struct AppLink: Hashable, Sendable {
    static let scheme = "fractonica"
    /// The key of a notification's `userInfo` that holds the link its tap opens.
    static let userInfoKey = "fx.link"

    var screen: Screen
    /// A moment to show, Unix seconds; nil leaves the displayed time alone.
    var time: Double?

    init(screen: Screen, time: Double? = nil) {
        self.screen = screen
        self.time = time
    }

    /// Reads a `fractonica:` URL; nil for any other scheme.
    init?(url: URL) {
        guard url.scheme?.lowercased() == Self.scheme else { return nil }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        screen = url.host().flatMap { Screen(rawValue: $0.lowercased()) } ?? .now
        time = items.first { $0.name == "t" }?.value.flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil }
    }

    /// Reads the link a notification carries (`userInfo`), if any.
    init?(userInfo: [AnyHashable: Any]) {
        guard let string = userInfo[Self.userInfoKey] as? String, let url = URL(string: string) else { return nil }
        self.init(url: url)
    }

    var url: URL {
        var components = URLComponents()
        components.scheme = Self.scheme
        components.host = screen.rawValue
        if let time { components.queryItems = [URLQueryItem(name: "t", value: String(time))] }
        return components.url!
    }

    /// The `userInfo` of a notification whose tap opens this link.
    var userInfo: [String: String] { [Self.userInfoKey: url.absoluteString] }
}
