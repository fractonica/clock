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
        if store.instant != nil { return [.list] }
        if store.settings.autoOpen, store.launch.autoOpen,
           let index = MomentScheduling.index(ofIdentifier: identifier), let m = store.calendar.moment(index),
           m.time > Date.now.timeIntervalSince1970 {
            // in front: the instant view opens (and speaks) instead of the banner
            store.openInstant(m)
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

/// What Moments presents over the window: the instant view (full screen on iPhone and iPad, a sheet on the Mac) and
/// the Moments sheet. RootView applies it.
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
            .sheet(isPresented: $moments.isSheetPresented) {
                MomentsSheet()
            }
    }
}

/// The Journal's flame chip: the current streak; it opens the Moments sheet.
struct MomentsToolbar: ToolbarContent {
    let screen: Screen

    @Environment(AppRouter.self) private var router

    var body: some ToolbarContent {
        if screen == .journal {
            ToolbarItem(placement: placement) {
                MomentsChip()
            }
        }
    }

    private var placement: ToolbarItemPlacement {
        #if os(iOS)
        router.isCompact ? .topBarLeading : .topBarTrailing
        #else
        .navigation
        #endif
    }
}

struct MomentsChip: View {
    @State private var moments = MomentStore.shared

    var body: some View {
        Button {
            moments.isSheetPresented = true
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "flame.fill")
                    .foregroundStyle(moments.stats.current > 0 ? Theme.gold : Theme.ink3)
                Text(verbatim: "\(moments.stats.current)")
                    .font(.reading(15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
            }
            .padding(.horizontal, 4)
            .fixedSize()
        }
        .help("Moments: your streak, the collection and the next moment")
        .accessibilityLabel("Moments")
        .accessibilityValue("\(moments.stats.current) in a row")
    }
}
