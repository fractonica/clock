import SwiftUI

/// The Fractonica clock app for iPhone, iPad and Mac.
///
/// One clock (`ClockStore`), one set of settings (`AppSettings`), one router (`AppRouter`) and one toast centre are
/// shared by every screen through the environment. iOS has a single window scene; macOS has one main window (a
/// `Window`, so the shared router never drives two copies of the UI), a Focus window that opens full screen, the
/// Settings window and a menu bar clock.
@main
struct FractonicaApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #else
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif
    @Environment(\.scenePhase) private var scenePhase

    private let store = ClockStore.shared
    private let settings = AppSettings.shared
    private let router = AppRouter.shared
    private let toasts = ToastCenter.shared

    init() {
        LaunchOptions.current().apply(store: store, settings: settings, router: router)
    }

    var body: some Scene {
        #if os(iOS)
        WindowGroup {
            shared(RootView())
        }
        .commands { commands }
        .onChange(of: scenePhase) { _, phase in lifecycle(phase) }
        #else
        Window("Fractonica", id: WindowID.main) {
            shared(RootView())
                .frame(minWidth: 760, minHeight: 520)
        }
        .defaultSize(width: 1180, height: 780)
        .commands { commands }
        .onChange(of: scenePhase) { _, phase in lifecycle(phase) }

        Window(Screen.focus.title, id: WindowID.focus) {
            shared(FocusWindow())
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1024, height: 680)
        .defaultLaunchBehavior(.suppressed)
        .restorationBehavior(.disabled)

        Settings {
            shared(NavigationStack { SettingsScreen() })
                .frame(width: 500, height: 640)
        }

        MenuBarExtra {
            shared(MenuBarPanel())
        } label: {
            MenuBarLabel()
        }
        .menuBarExtraStyle(.window)
        #endif
    }

    /// The shared objects, the dark appearance and the teal tint, for every scene's root.
    private func shared(_ content: some View) -> some View {
        content
            .environment(store)
            .environment(settings)
            .environment(router)
            .environment(toasts)
            .preferredColorScheme(.dark)
            .tint(Theme.teal)
    }

    private var commands: ClockCommands {
        ClockCommands(store: store, settings: settings, router: router, toasts: toasts)
    }

    private func lifecycle(_ phase: ScenePhase) {
        switch phase {
        case .active: AppHooks.becameActive()
        case .background: AppHooks.enteredBackground()
        default: break
        }
    }
}

#if os(macOS)
/// The ids of the macOS windows, for `openWindow(id:)`.
enum WindowID {
    static let main = "main"
    static let focus = "focus"
}
#endif
