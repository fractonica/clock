import Foundation
import UserNotifications

/// The timer's local notification: scheduled when a timer starts or resumes, so it rings with the app closed;
/// removed when it is paused, cancelled or has rung. Identifiers start with "timer." (NotificationRouter hands them to
/// `TimerHooks`); the timer keeps at most one pending, well inside the system's budget of 64 shared with Alerts.
enum TimerNotifications {
    static let prefix = "timer."

    /// What to post: everything Sendable, so the request is built where it is added.
    struct Plan: Sendable {
        var id: String
        var after: TimeInterval
        var title: String
        var body: String
        var link: [String: String]
    }

    /// Whether the user lets the app notify.
    enum Access: Sendable, Equatable {
        case unknown, allowed, denied
    }

    /// Replaces any pending timer notification with `plan` (or just removes them for nil).
    static func replace(with plan: Plan?) {
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let stale = requests.map(\.identifier).filter { $0.hasPrefix(prefix) }
            let center = UNUserNotificationCenter.current()
            if !stale.isEmpty { center.removePendingNotificationRequests(withIdentifiers: stale) }
            guard let plan, plan.after > 0 else { return }
            let content = UNMutableNotificationContent()
            content.title = plan.title
            content.body = plan.body
            content.sound = TimerChime.notificationSound
            content.interruptionLevel = .timeSensitive
            content.userInfo = plan.link
            content.threadIdentifier = "timer"
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(0.5, plan.after), repeats: false)
            center.add(UNNotificationRequest(identifier: plan.id, content: content, trigger: trigger))
        }
    }

    /// Removes the timer's notifications from Notification Center (after the user has seen it ring in the app).
    static func clearDelivered() {
        UNUserNotificationCenter.current().getDeliveredNotifications { delivered in
            let ids = delivered.map(\.request.identifier).filter { $0.hasPrefix(prefix) }
            if !ids.isEmpty { UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ids) }
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
