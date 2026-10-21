// The app's screens and how they group, shared by the apps and the widget extensions (widgets and controls link to
// screens through `AppLink`; the app's router presents them).

/// Every screen of the app. The raw value is its id: in `AppLink` URLs (fractonica://rings) and for the `-FXTab`
/// launch argument.
enum Screen: String, CaseIterable, Identifiable, Sendable {
    case now, rings, ladder, wave, timeline, converter, month, diary, sound, timer, stopwatch, alerts, focus, jump, settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .now: "Now"
        case .rings: "Rings"
        case .ladder: "Ladder"
        case .wave: "Wave"
        case .timeline: "Timeline"
        case .converter: "Converter"
        case .month: "Month"
        case .diary: "Diary"
        case .sound: "Sound"
        case .timer: "Timer"
        case .stopwatch: "Stopwatch"
        case .alerts: "Alerts"
        case .focus: "Focus"
        case .jump: "Jump"
        case .settings: "Settings"
        }
    }

    /// SF Symbol for tabs, sidebar rows and buttons.
    var systemImage: String {
        switch self {
        case .now: "clock"
        case .rings: "circle.circle"
        case .ladder: "chart.bar.doc.horizontal"
        case .wave: "water.waves"
        case .timeline: "calendar.day.timeline.left"
        case .converter: "arrow.left.arrow.right"
        case .month: "calendar"
        case .diary: "book.closed"
        case .sound: "waveform"
        case .timer: "timer"
        case .stopwatch: "stopwatch"
        case .alerts: "bell"
        case .focus: "sparkles"
        case .jump: "magnifyingglass"
        case .settings: "gearshape"
        }
    }

    /// The group the screen shares a tab with on iPhone (behind a segmented control), if any.
    var group: ScreenGroup? {
        ScreenGroup.allCases.first { $0.screens.contains(self) }
    }
}

/// Screens that share one iPhone tab, switched by a segmented control, and one sidebar section on iPad and Mac.
/// (The iPhone tab bar holds four tabs beside the search tab before it folds the rest into "More", which is why the
/// Timeline lives with the other cycle views.)
enum ScreenGroup: String, CaseIterable, Identifiable, Sendable {
    case cycles, calendar, clock

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cycles: "Cycles"
        case .calendar: "Calendar"
        case .clock: "Clock"
        }
    }

    var systemImage: String {
        switch self {
        case .cycles: "circle.circle"
        case .calendar: "calendar"
        case .clock: "timer"
        }
    }

    var screens: [Screen] {
        switch self {
        case .cycles: [.rings, .ladder, .wave, .timeline]
        case .calendar: [.converter, .month, .diary]
        case .clock: [.timer, .stopwatch, .alerts]
        }
    }
}
