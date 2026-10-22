import Foundation
import UserNotifications

/// Lifecycle entry points of Focus mode: the end-of-session chime, the "session complete" notification while the app
/// is away, and the launch arguments that put Focus into a given state for screenshots.
enum FocusHooks: FeatureHooks {
    /// Identifier of the pending "session complete" notification.
    static let notificationIdentifier = "focus.end"

    static func launch() {
        FocusLaunch.log("launch")
        let model = FocusModel.shared
        model.onComplete = { session, late in
            guard !late else { return }
            FocusChimePlayer.play()
            Haptics.play(.success)
        }
        let options = FocusLaunch.current
        model.applyForThisLaunch(style: options.style, length: options.length)
        if options.inline {
            // Show Focus as the sidebar's screen (iPad, Mac) instead of full screen.
            let router = AppRouter.shared
            if router.launchLink?.screen == .focus { router.launchLink = nil }
            router.selection = .focus
        }
    }

    /// A "session complete" notification is pending (only then does Focus touch the notification center).
    private static var notificationPending = false

    static func becameActive() {
        if notificationPending {
            notificationPending = false
            // The notification center answers over synchronous XPC: never on the main thread.
            let identifier = notificationIdentifier
            Task.detached(priority: .utility) {
                UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
            }
        }
        FocusModel.shared.refresh()
    }

    /// While the app is away the session cannot chime: if notifications are already allowed (Focus never asks), one
    /// says the session is complete at its end.
    static func enteredBackground() {
        let model = FocusModel.shared
        guard let session = model.session, let end = session.end else { return }
        let delay = end - Date.now.timeIntervalSince1970
        guard delay > 1 else { return }
        let content = UNMutableNotificationContent()
        content.title = "Focus session complete"
        content.body = "Your session of \(session.length.name) has ended."
        content.sound = .default
        content.userInfo = AppLink(screen: .focus).userInfo
        let request = UNNotificationRequest(
            identifier: notificationIdentifier,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        )
        notificationPending = true
        Task.detached(priority: .utility) {
            let center = UNUserNotificationCenter.current()
            let status = await center.notificationSettings().authorizationStatus
            guard status == .authorized || status == .provisional else { return }
            try? await center.add(request)
        }
    }

    /// In front, the screen chimes itself.
    static func presentation(ofNotification identifier: String) -> UNNotificationPresentationOptions? {
        identifier.hasPrefix("focus.") ? [] : nil
    }
}

/// Focus's launch arguments, for screenshots and checks (UserDefaults' argument domain; never persisted):
///
///     -FXFocusStyle interference|harmonograph|rings|aurora   the picture
///     -FXFocusLength preon|fourPreons|helion|open             the session length
///     -FXFocusElapsed <s>      the session started that many real seconds ago
///     -FXFocusOverlay 1|0      keep the overlay up / start with it hidden
///     -FXFocusCalm 1           the Reduce Motion variant
///     -FXFocusStats 1          frame statistics on screen and in the log every 3 s
///     -FXFocusTime <unix s>    show this moment, unclamped (outside the catalogue shows the dormant state)
///     -FXFocusInline 1         on iPad and Mac, open Focus as the sidebar's screen rather than full screen
struct FocusLaunch: Sendable {
    var style: FocusStyle?
    var length: FocusLength?
    var elapsed: Double?
    var overlay: Bool?
    var calm = false
    var stats = false
    var time: Double?
    var inline = false

    static let current = FocusLaunch(defaults: .standard)

    /// A diagnostic line on standard error (unbuffered, so `simctl launch --console` shows it at once).
    static func log(_ message: String) {
        FileHandle.standardError.write(Data("[focus] \(message)\n".utf8))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("focus-debug.txt")
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data("\(message)\n".utf8)); try? h.close() } else { try? Data("\(message)\n".utf8).write(to: url) }
    }

    init(defaults: UserDefaults) {
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        func flag(_ key: String) -> Bool? {
            string(key).flatMap { ["1", "yes", "true"].contains($0.lowercased()) ? true : ["0", "no", "false"].contains($0.lowercased()) ? false : nil }
        }
        style = string("FXFocusStyle").flatMap { FocusStyle(rawValue: $0) }
        length = string("FXFocusLength").flatMap { FocusLength(rawValue: $0) }
        elapsed = string("FXFocusElapsed").flatMap(Double.init).flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
        overlay = flag("FXFocusOverlay")
        calm = flag("FXFocusCalm") ?? false
        stats = flag("FXFocusStats") ?? false
        time = string("FXFocusTime").flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil }
        inline = flag("FXFocusInline") ?? false
    }
}

