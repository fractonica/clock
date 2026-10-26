import SwiftUI
import UserNotifications

/// Moments' lifecycle (listed in `AppHooks.all`): the store starts at launch, refills the `moment.` notifications on
/// becoming active and on leaving, opens the instant view for a moment's notification (or the composer when the
/// moment has passed), and keeps a moment's banner out of the way when the instant view opens by itself.
@MainActor
enum MomentsHooks: FeatureHooks {
    static func launch() {
        MomentStore.shared.start()
    }

    static func becameActive() {
        MomentStore.shared.becameActive()
    }

    static func enteredBackground() {
        MomentStore.shared.enteredBackground()
    }

    static func presentation(ofNotification identifier: String) -> UNNotificationPresentationOptions? {
        guard identifier.hasPrefix(MomentScheduling.prefix) else { return nil }
        let store = MomentStore.shared
        // screenshots and checks (-FXMomentsAuto 0): no instant view, no banner either
        if store.instant != nil || !store.launch.autoOpen { return [.list] }
        if store.opensByItself, let index = MomentScheduling.index(ofIdentifier: identifier),
           let m = store.calendar.moment(index), m.time > Date.now.timeIntervalSince1970 {
            // in front: the instant view opens (and speaks) instead of the banner — or opened already and was closed
            store.openByItself(m)
            return [.list]
        }
        return [.banner, .list, .sound]
    }

    static func open(_ notification: NotificationResponse) -> Bool {
        guard notification.identifier.hasPrefix(MomentScheduling.prefix) else { return false }
        guard notification.isTap else { return true }
        MomentStore.shared.openFromNotification(index: MomentScheduling.index(ofIdentifier: notification.identifier))
        return true
    }

    /// The background refresh (Alerts' task) refills the moments too.
    static func refill() async {
        MomentStore.shared.start()
        await MomentStore.shared.refill()
    }
}

/// What Moments presents over the window: the instant view (full screen on iPhone and iPad, a sheet on the Mac).
/// RootView applies it.
struct MomentsPresentations: ViewModifier {
    @State private var moments = MomentStore.shared

    func body(content: Content) -> some View {
        @Bindable var moments = moments
        content
            #if os(iOS)
            .fullScreenCover(item: $moments.instant) { request in
                InstantView(request: request)
            }
            #else
            .sheet(item: $moments.instant) { request in
                InstantView(request: request)
            }
            #endif
    }
}
