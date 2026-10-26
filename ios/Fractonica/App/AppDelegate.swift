#if os(iOS)
import UIKit

/// Launch-time work that must happen before SwiftUI shows a window: background task registration (BackgroundTasks
/// requires it before launch finishes), the notification delegate (likewise) and the features' `launch()` hooks.
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, willFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        AlertsHooks.registerBackgroundTasks()
        HubSyncHooks.registerBackgroundTasks()
        NotificationRouter.install()
        return true
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        AppHooks.launch()
        return true
    }
}
#elseif os(macOS)
import AppKit

/// Launch-time work: the dark appearance for every window (and the menu bar panel), the notification delegate and the
/// features' `launch()` hooks.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationWillFinishLaunching(_ notification: Notification) {
        NSApplication.shared.appearance = NSAppearance(named: .darkAqua)
        NotificationRouter.install()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        AppHooks.launch()
    }
}
#endif
