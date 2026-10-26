import AppIntents
import Foundation

// Intents that open the app on a screen, for App Shortcuts (Siri, Spotlight, the Action button). `OpenFocusIntent` and
// `OpenTimerIntent` live in Shared/OpenIntents.swift, compiled into the widget extension too (its controls name them);
// this is the app's half of them: the system performs them here, in the app, which it brings to the front first.

/// How the shared open intents (Shared/OpenIntents.swift) act in the app: show the screen the way the layout shows it
/// (a tab, a sidebar item, Focus's cover or window).
enum ScreenIntentHandler {
    @MainActor
    static func open(_ screen: Screen) {
        AppRouter.shared.open(AppLink(screen: screen))
    }
}

/// Opens the app on any screen.
struct OpenScreenIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Screen"
    static let description = IntentDescription("Opens Fractonica on a screen: Now, Rings, the Timeline, the Timer …")
    @available(iOS 26.0, macOS 26.0, *)
    static let supportedModes: IntentModes = .foreground(.immediate)
    #if os(iOS)
    /// The same for iOS 18; iOS 26 reads `supportedModes`.
    static let openAppWhenRun = true
    #endif

    @Parameter(title: "Screen", default: .now)
    var screen: OpenScreenOption

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$screen)")
    }

    init() {}

    init(screen: OpenScreenOption) {
        self.screen = screen
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        ScreenIntentHandler.open(screen.screen)
        return .result()
    }
}

/// The screens a shortcut can open (`Screen` without Jump and Settings, which open from inside the app).
enum OpenScreenOption: String, AppEnum {
    case now, journal, rings, ladder, wave, timeline, converter, month, diary, sound, timer, stopwatch, alerts, focus

    var screen: Screen { Screen(rawValue: rawValue) ?? .now }

    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Screen"
    // literal symbol names (the same as `Screen.systemImage`): the App Intents metadata is read at build time
    static let caseDisplayRepresentations: [OpenScreenOption: DisplayRepresentation] = [
        .now: DisplayRepresentation(title: "Now", image: .init(systemName: "clock")),
        .journal: DisplayRepresentation(title: "Journal", image: .init(systemName: "book.pages")),
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
