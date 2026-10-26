// The app's screens and how they group, shared by the apps and the widget extensions (widgets and controls link to
// screens through `AppLink`; the app's router presents them).

/// Every screen of the app. The raw value is its id: in `AppLink` URLs (fractonica://rings) and for the `-FXTab`
/// launch argument.
enum Screen: String, CaseIterable, Identifiable, Sendable {
    case now, journal, moments, rings, ladder, wave, timeline, converter, month, diary, sound, timer, stopwatch, alerts, focus, jump, settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .now: "Now"
        case .journal: "Journal"
        case .moments: "Moments"
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
        case .journal: "book.pages"
        case .moments: "flame"
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
/// (The iPhone tab bar holds five tabs — Now, Cycles, Journal, Moments, Clock — before it folds the rest into "More",
/// which is why the Timeline lives with the other cycle views, and the calendar's Month and Converter with the Journal.
/// Jump has no tab on iPhone: the Cycles tab's leading toolbar button opens it as a sheet. The printable Diary is no
/// segment: on iPhone it opens as a sheet, from the Journal's toolbar; iPad and Mac list it in the Journal's sidebar
/// section.)
enum ScreenGroup: String, CaseIterable, Identifiable, Sendable {
    case cycles, journal, clock

    var id: String { rawValue }

    var title: String {
        switch self {
        case .cycles: "Cycles"
        case .journal: "Journal"
        case .clock: "Clock"
        }
    }

    var systemImage: String {
        switch self {
        case .cycles: "circle.circle"
        case .journal: "book.pages"
        case .clock: "timer"
        }
    }

    var screens: [Screen] {
        switch self {
        case .cycles: [.rings, .ladder, .wave, .timeline]
        case .journal: [.journal, .month, .converter]
        case .clock: [.timer, .stopwatch, .alerts]
        }
    }
}
