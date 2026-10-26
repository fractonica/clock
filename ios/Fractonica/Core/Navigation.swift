import Observation
import SwiftUI

/// Which screen is showing and what is presented over it. One per app (the app has a single main window).
///
///     @Environment(AppRouter.self) private var router
///     Button("Show on the timeline") { router.show(.timeline) }
///
/// `show(_:)` picks the right presentation for the layout: a tab, a segment of a grouped tab, a sheet (Sound on
/// iPhone, Settings on iOS) or full screen (Focus; on iPad and Mac the sidebar also lists Focus as a screen of its
/// own, shown inside the window).
@MainActor @Observable
final class AppRouter {
    static let shared = AppRouter()

    /// The screen in the content area: a sidebar item on iPad and Mac, a tab (and its segment) on iPhone.
    var selection: Screen = .now
    /// The screen each iPhone group shows when its tab is selected.
    private(set) var groupSelection: [ScreenGroup: Screen] = [.cycles: .rings, .calendar: .converter, .clock: .timer]
    /// Set by the root view: the iPhone layout (tabs with groups) is showing.
    var isCompact = false

    /// Focus mode over everything (a full-screen cover on iOS, its own window on macOS).
    var isFocusPresented = false
    /// Settings as a sheet (iOS); macOS opens its Settings window instead.
    var isSettingsPresented = false
    /// Sound as a sheet over Now (iPhone only; iPad and Mac show it as a screen).
    var isSoundPresented = false
    /// The time-travel sheet of the transport bar (iOS; macOS uses a popover).
    var isTransportPresented = false
    /// A hub pairing link (`fractonica://pair?hub=…&code=…`) waiting for the person to confirm (HubPresentations).
    var hubPairing: AppLink.Pairing?
    /// The hub settings page as a sheet (`-FXHubSettings 1`; the journal's settings will link to it).
    var isHubSettingsPresented = false
    /// A link to open as soon as the root knows its layout (the `-FXTab` and `-FXLink` launch arguments).
    @ObservationIgnored var launchLink: AppLink?

    /// Opens `launchLink`, once.
    func openLaunchLink() {
        guard let link = launchLink else { return }
        launchLink = nil
        open(link)
    }

    /// Bring a screen forward.
    func show(_ screen: Screen) {
        switch screen {
        case .focus:
            isFocusPresented = true
        case .settings:
            isSettingsPresented = true
        case .sound where isCompact:
            isSoundPresented = true
        default:
            if let group = screen.group { groupSelection[group] = screen }
            selection = screen
        }
    }

    /// Opens a link (a widget, a notification, a URL): shows its moment, if it has one, then its screen.
    func open(_ link: AppLink, store: ClockStore = .shared) {
        if let pairing = link.pairing {
            hubPairing = pairing
            return
        }
        if let time = link.time { store.travel(to: time) }
        show(link.screen)
    }

    /// The screen a group's tab shows.
    func screen(in group: ScreenGroup) -> Screen {
        groupSelection[group] ?? group.screens[0]
    }
}

extension EnvironmentValues {
    /// True where a screen fills the whole display (Focus in its full-screen cover or window); false where it is one
    /// screen among others inside the main window. Immersive screens offer their own way out (`dismiss`).
    @Entry var isImmersive = false
}
