import AppIntents

// The intents that open the app on a screen, used by the widget extension's controls (Control Center, the Lock
// Screen, the Action button; Control Center on the Mac) and by the app's App Shortcuts. Controls need the very same
// intent type in the extension and in the app: the extension names it, the system brings the app to the front
// (`supportedModes`; on iOS 18, which has no modes, `openAppWhenRun`) and performs it there. One definition here,
// compiled into both; `ScreenIntentHandler` is the per-target part: the app's
// (Fractonica/Features/Intents/OpenScreenIntent.swift) shows the screen, the extension's (Widgets/Controls/Controls.swift)
// does nothing, as the extension never performs these.

/// Opens the app in Focus.
struct OpenFocusIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Focus"
    static let description = IntentDescription("Opens Fractonica in Focus: the clock's rhythm as moving light.")
    @available(iOS 26.0, macOS 26.0, *)
    static let supportedModes: IntentModes = .foreground(.immediate)
    #if os(iOS)
    /// The same for iOS 18; iOS 26 reads `supportedModes`.
    static let openAppWhenRun = true
    #endif

    @MainActor
    func perform() async throws -> some IntentResult {
        ScreenIntentHandler.open(.focus)
        return .result()
    }
}

/// Opens the app on the Timer.
struct OpenTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Timer"
    static let description = IntentDescription("Opens Fractonica on the Timer.")
    @available(iOS 26.0, macOS 26.0, *)
    static let supportedModes: IntentModes = .foreground(.immediate)
    #if os(iOS)
    /// The same for iOS 18; iOS 26 reads `supportedModes`.
    static let openAppWhenRun = true
    #endif

    @MainActor
    func perform() async throws -> some IntentResult {
        ScreenIntentHandler.open(.timer)
        return .result()
    }
}
