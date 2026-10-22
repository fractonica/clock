import AppIntents

/// The app's Siri and Spotlight phrases (App Shortcuts), available as soon as the app is installed.
struct FractonicaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: FractonicaTimeIntent(),
            phrases: [
                "What's the \(.applicationName) time",
                "What time is it in \(.applicationName)",
                "\(.applicationName) time",
            ],
            shortTitle: "Fractonica Time",
            systemImageName: "clock"
        )
        AppShortcut(
            intent: OpenFocusIntent(),
            phrases: [
                "Open \(.applicationName) Focus",
                "Start Focus in \(.applicationName)",
            ],
            shortTitle: "Open Focus",
            systemImageName: "sparkles"
        )
        AppShortcut(
            intent: OpenScreenIntent(),
            phrases: [
                "Open \(\.$screen) in \(.applicationName)",
                "Show \(\.$screen) in \(.applicationName)",
            ],
            shortTitle: "Open Screen",
            systemImageName: "square.grid.2x2"
        )
    }
}
