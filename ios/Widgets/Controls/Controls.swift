import AppIntents
import SwiftUI
import WidgetKit

// Controls for Control Center, the Lock Screen and the Action button (iOS), and Control Center on the Mac: each opens
// the app on its screen. Their intents (Shared/OpenIntents.swift) are compiled into the app too, which the system
// brings to the front and performs them in.

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

/// The extension's half of the shared open intents (Shared/OpenIntents.swift): the system performs them in the app
/// (their `supportedModes` bring it to the front), never here, so there is nothing to do.
enum ScreenIntentHandler {
    @MainActor
    static func open(_ screen: Screen) {}
}
