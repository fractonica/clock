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

extension View {
    /// The Journal's Moments bar over the timeline (RootView applies it to every screen; only the Journal shows it).
    @ViewBuilder
    func momentsHeader(_ screen: Screen) -> some View {
        if screen == .journal {
            safeAreaInset(edge: .top, spacing: 0) { MomentsBar() }
        } else {
            self
        }
    }
}

/// The Journal's compact Moments header: the streak's flame and count, the next moment and its rarity; a tap opens
/// the Moments sheet. It changes only when a moment passes or the journal changes (it sits in a safe area inset, where
/// anything that ticks would lay the screen out again each time).
struct MomentsBar: View {
    @Environment(AppSettings.self) private var settings
    @State private var moments = MomentStore.shared

    var body: some View {
        Button {
            moments.isSheetPresented = true
        } label: {
            TimelineView(.periodic(from: .now, by: 120)) { context in
                let next = moments.nextMoment(after: context.date.timeIntervalSince1970)
                HStack(spacing: 10) {
                    HStack(spacing: 4) {
                        Image(systemName: "flame.fill")
                            .foregroundStyle(moments.stats.current > 0 ? Theme.gold : Theme.ink3)
                        Text(verbatim: "\(moments.stats.current)")
                            .font(.reading(15, weight: .bold))
                            .foregroundStyle(Theme.ink)
                    }
                    Rectangle().fill(Theme.line2).frame(width: 1, height: 18)
                    if let next {
                        Text(verbatim: next.title(settings.wording.notation))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.levelColor(next.level.kitLevel, lightness: 0.72))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Spacer(minLength: 4)
                        RarityBadge(rarity: next.rarity, compact: true)
                    } else {
                        Text(moments.settings.enabled ? "Moments" : "Moments are off")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.ink2)
                        Spacer(minLength: 4)
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.ink3)
                }
                .padding(.horizontal, 14)
                .frame(height: 38)
                .contentShape(.capsule)
            }
        }
        .buttonStyle(.plain)
        .glassSurface(.regular, in: .capsule)
        .frame(maxWidth: 720)
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity)
        .help("Moments: your streak, the collection and the next moment")
        .accessibilityLabel("Moments, \(moments.stats.current) in a row")
        .accessibilityHint("Opens the streak, the collection and the next moment")
    }
}
