import AppIntents
import SwiftUI
import WidgetKit

// Controls for Control Center, the Lock Screen and the Action button (iOS), and Control Center on the Mac: each opens
// the app on its screen. Their intents are performed by the app (Fractonica/Features/Intents declares the same types),
// which brings the screen forward; these copies only let the extension name them.

/// Opens Focus: the clock's rhythm as moving light.
struct FocusControl: ControlWidget {
    static let kind = "app.fractonica.clock.control.focus"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenFocusIntent()) {
                Label("Focus", systemImage: Screen.focus.systemImage)
            }
        }
        .displayName("Fractonica Focus")
        .description("Opens Focus: the clock's rhythm as moving light.")
    }
}

/// Opens the Timer.
struct TimerControl: ControlWidget {
    static let kind = "app.fractonica.clock.control.timer"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenTimerIntent()) {
                Label("Timer", systemImage: Screen.timer.systemImage)
            }
        }
        .displayName("Fractonica Timer")
        .description("Opens the Timer.")
    }
}

/// Opens the app in Focus. The app's copy of this type (same name and shape) performs it.
struct OpenFocusIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Focus"
    static let description = IntentDescription("Opens Fractonica in Focus: the clock's rhythm as moving light.")
    static let supportedModes: IntentModes = .foreground(.immediate)

    func perform() async throws -> some IntentResult { .result() }
}

/// Opens the app on the Timer. The app's copy of this type (same name and shape) performs it.
struct OpenTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Timer"
    static let description = IntentDescription("Opens Fractonica on the Timer.")
    static let supportedModes: IntentModes = .foreground(.immediate)

    func perform() async throws -> some IntentResult { .result() }
}
