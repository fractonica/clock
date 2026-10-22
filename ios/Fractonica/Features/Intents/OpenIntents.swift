import AppIntents
import Foundation

// Intents that open the app on a screen: for App Shortcuts (Siri, Spotlight, the Action button) and for the widget
// extension's controls. `OpenFocusIntent` and `OpenTimerIntent` are declared with the same names and shape in
// Widgets/Controls/Controls.swift, as controls require: the system runs them here, in the app, which it brings to the
// front first (`supportedModes`).

/// Opens the app in Focus.
struct OpenFocusIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Focus"
    static let description = IntentDescription("Opens Fractonica in Focus: the clock's rhythm as moving light.")
    static let supportedModes: IntentModes = .foreground(.immediate)

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRouter.shared.open(AppLink(screen: .focus))
        return .result()
    }
}

/// Opens the app on the Timer.
struct OpenTimerIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Timer"
    static let description = IntentDescription("Opens Fractonica on the Timer.")
    static let supportedModes: IntentModes = .foreground(.immediate)

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRouter.shared.open(AppLink(screen: .timer))
        return .result()
    }
}

/// Opens the app on any screen.
struct OpenScreenIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Screen"
    static let description = IntentDescription("Opens Fractonica on a screen: Now, Rings, the Timeline, the Timer …")
    static let supportedModes: IntentModes = .foreground(.immediate)

    @Parameter(title: "Screen", default: .now)
    var screen: ScreenOption

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$screen)")
    }

    init() {}

    init(screen: ScreenOption) {
        self.screen = screen
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppRouter.shared.open(AppLink(screen: screen.screen))
        return .result()
    }
}

/// The screens a shortcut can open (`Screen` without Jump and Settings, which open from inside the app).
enum ScreenOption: String, AppEnum {
    case now, rings, ladder, wave, timeline, converter, month, diary, sound, timer, stopwatch, alerts, focus

    var screen: Screen { Screen(rawValue: rawValue) ?? .now }

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Screen"
    // literal symbol names (the same as `Screen.systemImage`): the App Intents metadata is read at build time
    static let caseDisplayRepresentations: [ScreenOption: DisplayRepresentation] = [
        .now: DisplayRepresentation(title: "Now", image: .init(systemName: "clock")),
        .rings: DisplayRepresentation(title: "Rings", image: .init(systemName: "circle.circle")),
        .ladder: DisplayRepresentation(title: "Ladder", image: .init(systemName: "chart.bar.doc.horizontal")),
        .wave: DisplayRepresentation(title: "Wave", image: .init(systemName: "water.waves")),
        .timeline: DisplayRepresentation(title: "Timeline", image: .init(systemName: "calendar.day.timeline.left")),
        .converter: DisplayRepresentation(title: "Converter", image: .init(systemName: "arrow.left.arrow.right")),
        .month: DisplayRepresentation(title: "Month", image: .init(systemName: "calendar")),
        .diary: DisplayRepresentation(title: "Diary", image: .init(systemName: "book.closed")),
        .sound: DisplayRepresentation(title: "Sound", image: .init(systemName: "waveform")),
        .timer: DisplayRepresentation(title: "Timer", image: .init(systemName: "timer")),
        .stopwatch: DisplayRepresentation(title: "Stopwatch", image: .init(systemName: "stopwatch")),
        .alerts: DisplayRepresentation(title: "Alerts", image: .init(systemName: "bell")),
        .focus: DisplayRepresentation(title: "Focus", image: .init(systemName: "sparkles")),
    ]
}
