import SwiftUI

/// Menu commands and keyboard shortcuts, mirroring the web app's keys: Space play / pause the time-lapse, N back to
/// live, [ ] previous / next cycle of the selected level, P pure mode, ⌘K jump, ⌘1…⌘9 screens. On macOS they fill
/// the Clock and View menus; on iPad they appear in the menu bar and the keyboard shortcut overlay. On macOS the bare
/// keys yield to a focused text field (AppKit offers a key to the first responder before the menus), so typing a date
/// or a name does not trigger them.
struct ClockCommands: Commands {
    let store: ClockStore
    let settings: AppSettings
    let router: AppRouter
    let toasts: ToastCenter

    #if os(macOS)
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings
    #endif

    /// The screens with ⌘-number shortcuts, in key order.
    private static let numbered: [Screen] = [.now, .rings, .ladder, .wave, .timeline, .converter, .month, .diary, .sound]
    /// The Clock group, on ⌥⌘-number.
    private static let clockScreens: [Screen] = ScreenGroup.clock.screens

    var body: some Commands {
        CommandMenu("Clock") {
            Button("Play or Pause Time-lapse", systemImage: "playpause") {
                if let edge = store.togglePlay() { toasts.show(edge) }
            }
            .keyboardShortcut(.space, modifiers: [])
            Button("Back to Live", systemImage: "arrow.uturn.backward") {
                if store.isLive { toasts.show("Showing the live clock") } else { store.goLive() }
            }
            .keyboardShortcut("n", modifiers: [])
            Divider()
            Button("Previous Cycle", systemImage: "backward.end") { step(-1) }
                .keyboardShortcut("[", modifiers: [])
            Button("Next Cycle", systemImage: "forward.end") { step(1) }
                .keyboardShortcut("]", modifiers: [])
            Divider()
            Toggle("Pure Mode", isOn: Bindable(settings).pure)
                .keyboardShortcut("p", modifiers: [])
            Button("Jump…", systemImage: Screen.jump.systemImage) { show(.jump) }
                .keyboardShortcut("k")
            Button("Focus", systemImage: Screen.focus.systemImage) { show(.focus) }
                .keyboardShortcut("f", modifiers: [.command, .shift])
        }
        CommandGroup(before: .sidebar) {
            ForEach(Array(Self.numbered.enumerated()), id: \.element) { i, screen in
                Button(screen.title) { show(screen) }
                    .keyboardShortcut(KeyEquivalent(Character(String(i + 1))))
            }
            Divider()
            ForEach(Array(Self.clockScreens.enumerated()), id: \.element) { i, screen in
                Button(screen.title) { show(screen) }
                    .keyboardShortcut(KeyEquivalent(Character(String(i + 1))), modifiers: [.command, .option])
            }
            Divider()
        }
    }

    /// Shows a screen. On macOS the commands work with every window closed, so they open the window that shows it:
    /// Focus and Settings are windows of their own, every other screen lives in the main window.
    private func show(_ screen: Screen) {
        #if os(macOS)
        switch screen {
        case .focus: openWindow(id: WindowID.focus)
        case .settings: openSettings()
        default:
            router.show(screen)
            openWindow(id: WindowID.main)
        }
        #else
        router.show(screen)
        #endif
    }

    private func step(_ direction: Int) {
        if let edge = store.step(level: settings.selectedLevel, direction: direction) { toasts.show(edge) }
    }
}
