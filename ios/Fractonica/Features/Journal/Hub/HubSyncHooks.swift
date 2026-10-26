import Foundation
#if os(iOS)
import BackgroundTasks
import Synchronization
import UIKit
#endif

/// Lifecycle of the hub sync: a pass and the long poll while the app is in front, the long poll stopped in the
/// background (with a little time to finish a pass), and a background refresh task on iOS.
///
/// Test hooks (launch arguments, never persisted):
///
///     -FXHubSettings 1     present the hub settings page over the app (before the journal UI links to it)
///     -FXHubDemo <n>       attach HubDemoStore (Application Support/HubDemo) as the journal's store, seeded with n
///                          entries with generated photos, voice notes and videos when empty (0 attaches it as it is)
///     -FXHubScheme light   the hub page in light (or dark) appearance, for screenshots
enum HubSyncHooks: FeatureHooks {
    /// The background refresh task in Info.plist (`BGTaskSchedulerPermittedIdentifiers`).
    static let refreshTaskIdentifier = "app.fractonica.clock.hubsync"

    static func launch() {
        #if DEBUG
        attachDemoStoreIfAsked()
        pairIfAsked()
        #endif
    }

    static func becameActive() {
        SyncEngine.shared.becameActive()
    }

    static func enteredBackground() {
        SyncEngine.shared.enteredBackground()
        #if os(iOS)
        finishInBackground()
        if SyncEngine.shared.isPaired { BackgroundSync.submit(refreshTaskIdentifier) }
        #endif
    }

    #if DEBUG
    /// `-FXHubPair <hub URL> -FXHubCode <code>`: pairs at launch without the confirmation sheet (scripted end-to-end
    /// runs, where nothing can tap Pair).
    private static func pairIfAsked() {
        let defaults = UserDefaults.standard
        guard let address = defaults.string(forKey: "FXHubPair"), let url = URL(string: address),
              let code = defaults.string(forKey: "FXHubCode") else { return }
        Task {
            do {
                try await SyncEngine.shared.pair(url: url, code: code, name: HubDevice.defaultName)
            } catch {
                print("FXHubPair: \(error)")
            }
        }
    }

    /// The demo store for `-FXHubDemo`, kept alive here.
    private static var demoStore: HubDemoStore?

    private static func attachDemoStoreIfAsked() {
        let args = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        guard let value = (args["FXHubDemo"] as? String) ?? (args["FXHubDemo"] as? NSNumber)?.stringValue,
              let count = Int(value),
              let support = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                         appropriateFor: nil, create: true) else { return }
        let directory = support.appendingPathComponent("HubDemo", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let store = HubDemoStore(directory: directory)
        store.seed(count)
        demoStore = store
        SyncEngine.shared.attach(store)
    }
    #endif

    #if os(iOS)
    /// Asks iOS for a little time so a pass under way (an upload) can finish after the app leaves the front.
    private static func finishInBackground() {
        guard SyncEngine.shared.isSyncing else { return }
        let application = UIApplication.shared
        var identifier = UIBackgroundTaskIdentifier.invalid
        identifier = application.beginBackgroundTask(withName: "Hub sync") {
            application.endBackgroundTask(identifier)
            identifier = .invalid
        }
        Task { @MainActor in
            await SyncEngine.shared.syncNow()
            if identifier != .invalid { application.endBackgroundTask(identifier) }
        }
    }

    /// Registers the `BGAppRefreshTask` handler. The app calls it while launching, before launch finishes.
    static func registerBackgroundTasks() {
        BackgroundSync.register(refreshTaskIdentifier)
    }
    #endif
}

#if os(iOS)
/// The background refresh: one pass (push, pull, vectors) and the eager media downloads, cancelled when iOS says time
/// is up.
private enum BackgroundSync {
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
                submit(identifier)
                await SyncEngine.shared.backgroundSync()
                box.complete(success: !Task.isCancelled)
            }
            task.expirationHandler = {
                work.cancel()
                box.complete(success: false)
            }
        }
    }

    /// The next refresh: no sooner than 30 minutes from now (the system decides when it really runs).
    static func submit(_ identifier: String) {
        let request = BGAppRefreshTaskRequest(identifier: identifier)
        request.earliestBeginDate = Date.now.addingTimeInterval(30 * 60)
        BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: identifier)
        try? BGTaskScheduler.shared.submit(request)
    }
}
#endif
