import Foundation
import UserNotifications

/// The timer's local notification: scheduled when a timer starts or resumes, so it rings with the app closed;
/// removed when it is paused, cancelled or has rung. Identifiers start with "timer." (NotificationRouter hands them to
/// `TimerHooks`); the timer keeps at most one pending, well inside the system's budget of 64 shared with Alerts.
///
/// The one pending request always has the identifier `pendingID`, so scheduling is a plain `add` (a request with the
/// same identifier replaces the pending one) and cancelling a plain `remove`. Both run in order on a serial queue of
/// our own, never on the main thread: the notification center's calls wait synchronously for its daemon (a simulator
/// whose daemon was stuck froze the app at launch inside `removePendingNotificationRequests`). Reading the pending
/// list first and replacing in its completion, as earlier, raced: a cancel right after a start could read the list
/// before the start's request was added and leave a notification for a timer that no longer runs.
enum TimerNotifications {
    static let prefix = "timer."
    /// The identifier of the timer's one pending notification.
    static let pendingID = prefix + "end"

    /// Where every change to the timer's notifications is made, one after the other.
    private static let queue = DispatchQueue(label: "app.fractonica.timer.notifications", qos: .userInitiated)

    /// What to post.
    struct Plan: Sendable, Equatable {
        /// When it rings (device time).
        var end: Date
        var title: String
        var body: String
        var link: [String: String]
    }

    /// Whether the user lets the app notify.
    enum Access: Sendable, Equatable {
        case unknown, allowed, denied
    }

    /// Schedules `plan` in place of the pending timer notification, or removes it for nil (or a plan already due).
    static func replace(with plan: Plan?) {
        queue.async {
            let center = UNUserNotificationCenter.current()
            let after = plan.map { $0.end.timeIntervalSinceNow } ?? 0
            guard let plan, after > 0 else {
                center.removePendingNotificationRequests(withIdentifiers: [pendingID])
                return
            }
            let content = UNMutableNotificationContent()
            content.title = plan.title
            content.body = plan.body
            content.sound = TimerChime.notificationSound
            content.interruptionLevel = .timeSensitive
            content.userInfo = plan.link
            content.threadIdentifier = "timer"
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(0.5, after), repeats: false)
            center.add(UNNotificationRequest(identifier: pendingID, content: content, trigger: trigger))
        }
    }

    /// Removes pending timer notifications under other identifiers (earlier builds named them after the run), once at
    /// launch.
    static func removeLegacy() {
        UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
            let stale = requests.map(\.identifier).filter { $0.hasPrefix(prefix) && $0 != pendingID }
            guard !stale.isEmpty else { return }
            queue.async { UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: stale) }
        }
    }

    /// Removes the timer's notifications from Notification Center (after the user has seen it ring in the app).
    static func clearDelivered() {
        UNUserNotificationCenter.current().getDeliveredNotifications { delivered in
            let ids = delivered.map(\.request.identifier).filter { $0.hasPrefix(prefix) }
            guard !ids.isEmpty else { return }
            queue.async { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    /// The current permission.
    static func access() async -> Access {
        await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: access(settings.authorizationStatus))
            }
        }
    }

    /// Asks for permission when the user has not been asked yet; returns the resulting permission.
    static func requestIfNeeded() async -> Access {
        let current = await access()
        guard current == .unknown else { return current }
        let granted = await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
                continuation.resume(returning: granted)
            }
        }
        return granted ? .allowed : .denied
    }

    private static func access(_ status: UNAuthorizationStatus) -> Access {
        switch status {
        case .notDetermined: .unknown
        case .denied: .denied
        default: .allowed
        }
    }
}
