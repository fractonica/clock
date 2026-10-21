import UserNotifications

/// The app's one `UNUserNotificationCenter` delegate, for every feature that posts local notifications (Timer,
/// Alerts …). While the app is in front it asks the features how to show a notification (`FeatureHooks
/// .presentation(ofNotification:)`, a banner with sound by default); when the user opens one it offers the response to
/// the features (`FeatureHooks.open(_:)`) and otherwise opens the `AppLink` the notification carries.
///
/// Features never set the delegate themselves; they tag what they post:
///
///     content.userInfo = AppLink(screen: .timer).userInfo      // a tap opens the Timer
///     UNNotificationRequest(identifier: "timer.\(id)", content: content, trigger: trigger)
final class NotificationRouter: NSObject, UNUserNotificationCenterDelegate, Sendable {
    static let shared = NotificationRouter()

    /// Installs the router. Called while the app launches: UserNotifications delivers the tap that launched the app
    /// only to a delegate set before launch finishes.
    static func install() {
        UNUserNotificationCenter.current().delegate = shared
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions
    {
        let identifier = notification.request.identifier
        return await AppHooks.presentation(ofNotification: identifier)
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let opened = NotificationResponse(
            identifier: response.notification.request.identifier,
            action: response.actionIdentifier,
            link: AppLink(userInfo: response.notification.request.content.userInfo)
        )
        await MainActor.run {
            guard !AppHooks.open(opened), opened.isTap, let link = opened.link else { return }
            AppRouter.shared.open(link)
        }
    }
}

/// A notification the user opened or acted on, in the terms features need: the request identifier they posted it
/// under, the action chosen and the link it carries.
struct NotificationResponse: Sendable {
    let identifier: String
    /// `UNNotificationDefaultActionIdentifier` for a plain tap, `UNNotificationDismissActionIdentifier` for a dismissal
    /// (categories with `.customDismissAction` only), else the identifier of a `UNNotificationAction`.
    let action: String
    let link: AppLink?

    /// The user tapped the notification itself.
    var isTap: Bool { action == UNNotificationDefaultActionIdentifier }
}
