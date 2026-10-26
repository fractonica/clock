import UserNotifications

/// App lifecycle entry points of a feature. A feature that must act outside its screens (schedule notifications, keep
/// audio running, end a Live Activity) declares an enum conforming to this protocol in its folder and is listed in
/// `AppHooks.all`; the app calls every hook from the main actor:
///
///     launch()             once, when the app has finished launching (before any window appears)
///     becameActive()       whenever the app comes to the foreground (and after launch)
///     enteredBackground()  whenever the app leaves the foreground
///
///     presentation(ofNotification:)  a notification arrives while the app is in front: how to show it
///     open(_:)                       the user tapped a notification (or one of its actions)
///
/// Hooks reach shared state through `ClockStore.shared`, `AppSettings.shared` and `AppRouter.shared`. Every method has
/// an empty default: implement only what the feature needs.
@MainActor
protocol FeatureHooks {
    static func launch()
    static func becameActive()
    static func enteredBackground()

    /// How a notification this feature posted shows while the app is in front, or nil when it is not this
    /// feature's. Features recognise their notifications by the request identifier's prefix ("timer.", "alert.").
    /// Notifications no feature claims show as a banner with sound.
    static func presentation(ofNotification identifier: String) -> UNNotificationPresentationOptions?

    /// The user opened a notification or chose one of its actions; true when this feature handled it. A notification
    /// nobody handles opens the `AppLink` it carries (`AppLink.userInfo`), if any.
    static func open(_ notification: NotificationResponse) -> Bool
}

extension FeatureHooks {
    static func launch() {}
    static func becameActive() {}
    static func enteredBackground() {}
    static func presentation(ofNotification identifier: String) -> UNNotificationPresentationOptions? { nil }
    static func open(_ notification: NotificationResponse) -> Bool { false }
}

/// The features with lifecycle hooks, in call order.
@MainActor
enum AppHooks {
    static var all: [any FeatureHooks.Type] {
        [AlertsHooks.self, TimerHooks.self, SoundHooks.self, FocusHooks.self, HubSyncHooks.self]
    }

    static func launch() { for hooks in all { hooks.launch() } }
    static func becameActive() { for hooks in all { hooks.becameActive() } }
    static func enteredBackground() { for hooks in all { hooks.enteredBackground() } }

    /// The first feature's answer, else a banner with sound (in the list, too).
    static func presentation(ofNotification identifier: String) -> UNNotificationPresentationOptions {
        for hooks in all {
            if let options = hooks.presentation(ofNotification: identifier) { return options }
        }
        return [.banner, .list, .sound]
    }

    /// Offers the response to every feature in turn; returns whether one handled it.
    static func open(_ notification: NotificationResponse) -> Bool {
        all.contains { $0.open(notification) }
    }
}
