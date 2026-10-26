import Foundation

/// A link into the app, for widgets, controls, notifications, Shortcuts and shared moments (the native counterpart of
/// the web app's `?view=…&t=…` URL parameters):
///
///     fractonica://rings                    open a screen (its `Screen` raw value; empty or unknown opens Now)
///     fractonica://now?t=1791460800         … showing that moment (time travel, paused; clamped to the catalogue)
///     fractonica://pair?hub=<url>&code=<c>  pair with a hub (its web page's QR code): the app asks first
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
    /// A hub to pair with (`fractonica://pair?hub=…&code=…`); the app confirms before pairing.
    var pairing: Pairing?

    /// The hub address and pairing code of a pairing link, as the hub wrote them.
    struct Pairing: Hashable, Sendable, Identifiable {
        var hub: String
        var code: String
        var id: String { hub + "#" + code }
    }

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
        if url.host()?.lowercased() == "pair", let hub = items.first(where: { $0.name == "hub" })?.value, !hub.isEmpty,
           let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty {
            pairing = Pairing(hub: hub, code: code)
        }
    }

    /// Reads the link a notification carries (`userInfo`), if any.
    init?(userInfo: [AnyHashable: Any]) {
        guard let string = userInfo[Self.userInfoKey] as? String, let url = URL(string: string) else { return nil }
        self.init(url: url)
    }

    var url: URL {
        var components = URLComponents()
        components.scheme = Self.scheme
        if let pairing {
            components.host = "pair"
            components.queryItems = [URLQueryItem(name: "hub", value: pairing.hub), URLQueryItem(name: "code", value: pairing.code)]
            return components.url!
        }
        components.host = screen.rawValue
        if let time { components.queryItems = [URLQueryItem(name: "t", value: String(time))] }
        return components.url!
    }

    /// The `userInfo` of a notification whose tap opens this link.
    var userInfo: [String: String] { [Self.userInfoKey: url.absoluteString] }
}
