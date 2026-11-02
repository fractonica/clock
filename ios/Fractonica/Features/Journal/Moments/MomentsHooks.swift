import SwiftUI
import UserNotifications

/// Moments' lifecycle (listed in `AppHooks.all`): the store starts at launch, refills the `moment.` notifications and
/// the alarms on becoming active and on leaving, rings a moment's call for its notification (or shows the Moments
/// screen once it has rung out, and for a missed call), and keeps a call's banner out of the way when its screen rings
/// by itself.
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
        // screenshots and checks (-FXMomentsAuto 0): no call, no banner either
        if store.instant != nil || !store.launch.autoOpen { return [.list] }
        if MomentScheduling.isMissed(identifier) { return [.banner, .list, .badge] }
        // in front, the test call rings by itself
        if identifier == MomentScheduling.testID { return [.list] }
        if store.opensByItself, let index = MomentScheduling.index(ofIdentifier: identifier),
           let m = store.calendar.moment(index), Date.now.timeIntervalSince1970 < store.calendar.ringEnd(of: m) {
            // in front: the call screen rings instead of the banner — or rang already and was picked up
            store.openByItself(m)
            return [.list]
        }
        return [.banner, .list, .sound]
    }

    static func open(_ notification: NotificationResponse) -> Bool {
        guard notification.identifier.hasPrefix(MomentScheduling.prefix) else { return false }
        guard notification.isTap else { return true }
        if MomentScheduling.isMissed(notification.identifier) {
            AppRouter.shared.show(.moments)
        } else if notification.identifier == MomentScheduling.testID {
            MomentStore.shared.ringTest()
        } else {
            MomentStore.shared.openFromNotification(index: MomentScheduling.index(ofIdentifier: notification.identifier))
        }
        return true
    }

    /// The background refresh (Alerts' task) refills the moments too.
    static func refill() async {
        MomentStore.shared.start()
        await MomentStore.shared.refill()
    }
}

/// What Moments presents over the window: a moment's call (full screen on iPhone and iPad, a sheet on the Mac).
/// RootView applies it.
struct MomentsPresentations: ViewModifier {
    @State private var moments = MomentStore.shared

    func body(content: Content) -> some View {
        @Bindable var moments = moments
        content
            #if os(iOS)
            .fullScreenCover(item: $moments.instant) { request in
                MomentCallView(request: request)
            }
            #else
            .sheet(item: $moments.instant) { request in
                MomentCallView(request: request)
            }
            #endif
    }
}
