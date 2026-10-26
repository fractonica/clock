import Foundation
import UserNotifications
#if os(iOS)
import BackgroundTasks
import Synchronization
#endif

/// Lifecycle entry points of Alerts: notifications for the clock events the user chooses. The store refills the
/// pending `alert.` requests on launch, whenever the app becomes active, in the background refresh task (iOS) or a
/// background activity (macOS), periodically while the app runs and whenever rules or settings change.
enum AlertsHooks: FeatureHooks {
    /// The background app refresh task declared in Info.plist (`BGTaskSchedulerPermittedIdentifiers`).
    static let refreshTaskIdentifier = "app.fractonica.clock.refresh"

    static func launch() {
        AlertStore.shared.start()
    }

    static func becameActive() {
        AlertStore.shared.becameActive()
    }

    static func enteredBackground() {
        AlertStore.shared.enteredBackground()
        #if os(iOS)
        submitRefresh()
        #endif
    }

    static func presentation(ofNotification identifier: String) -> UNNotificationPresentationOptions? {
        guard identifier.hasPrefix(AlertPlanner.prefix) else { return nil }
        AlertStore.shared.alertArrived()
        return AlertStore.shared.presentation(of: identifier)
    }

    /// Opening an alert selects its level everywhere; the router then opens the link it carries (the ladder or Now,
    /// at the event's moment when the alert came ahead of it).
    static func open(_ notification: NotificationResponse) -> Bool {
        guard notification.identifier.hasPrefix(AlertPlanner.prefix) else { return false }
        if let level = AlertStore.shared.level(ofNotification: notification.identifier),
           AppSettings.levels.contains(level) {
            AppSettings.shared.selectedLevel = level
        }
        return false
    }

    #if os(iOS)
    /// Registers the `BGAppRefreshTask` handler for `refreshTaskIdentifier`. The app calls it while launching, before
    /// launch finishes, as BackgroundTasks requires.
    static func registerBackgroundTasks() {
        BackgroundRefresh.register(refreshTaskIdentifier)
    }

    /// Asks for the next background refresh: when about half of what is queued will have fired, between a quarter of
    /// an hour and half a day from now (the system decides when it really runs).
    static func submitRefresh() {
        let now = Date.now.timeIntervalSince1970
        let fires = AlertStore.shared.scheduled.map(\.fire).filter { $0 > now }
        let half = fires.isEmpty ? now + 6 * 3600 : fires[fires.count / 2]
        let earliest = min(now + 12 * 3600, max(now + 15 * 60, half))
        BackgroundRefresh.submit(refreshTaskIdentifier, earliest: Date(timeIntervalSince1970: earliest))
    }
    #endif
}

#if os(iOS)
/// The background refresh task, outside the main actor: BackgroundTasks calls the handler on its own queue.
private enum BackgroundRefresh {
    /// A BGTask handed to the main actor, completed exactly once: when the refill is done, or at once when the system
    /// says time is up (a late completion gets the app killed and its refreshes rationed).
    private final class TaskBox: @unchecked Sendable {
        private let task: BGTask
        private let done = Mutex(false)

        init(_ task: BGTask) { self.task = task }

        func complete(success: Bool) {
            let first = done.withLock { done in
                defer { done = true }
                return !done
            }
            if first { task.setTaskCompleted(success: success) }
        }
    }

    static func register(_ identifier: String) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: nil) { task in
            let box = TaskBox(task)
            let work = Task { @MainActor in
                // The request that woke us is spent: ask for the next one first, so an expiry cannot lose it.
                AlertsHooks.submitRefresh()
                AlertStore.shared.start()
                await AlertStore.shared.refill()
                await MomentsHooks.refill()
                AlertsHooks.submitRefresh()
                box.complete(success: !Task.isCancelled)
            }
            task.expirationHandler = {
                work.cancel()
                box.complete(success: false)
            }
        }
    }

    static func submit(_ identifier: String, earliest: Date) {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = earliest
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        try? BGTaskScheduler.shared.submit(request)
    }
}
#endif
