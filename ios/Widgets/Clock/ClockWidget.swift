import FractonicaKit
import SwiftUI
import WidgetKit

/// The clock in a line (medium): the minor clock, the short date, the Helion's pair, the solar odometer.
struct ClockWidget: Widget {
    /// The first widget's kind, kept so widgets placed with it survive the update.
    static let kind = "app.fractonica.clock.now"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: ClockWidgetIntent.self, provider: ClockProvider()) { entry in
            ClockWidgetView(snapshot: entry.snapshot)
                .widgetURL(AppLink(screen: .now).url)
                .fractonicaBackground()
        }
        .configurationDisplayName("Clock")
        .description("The minor clock and the date, the Helion's phase and the solar sync.")
        .supportedFamilies([.systemMedium])
    }
}

struct ClockProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry<ClockSnapshot> {
        SnapshotTimeline.entry { ClockSnapshot(at: $0, words: WidgetWords(pure: false)) }
    }

    func snapshot(for configuration: ClockWidgetIntent, in context: Context) async -> SnapshotEntry<ClockSnapshot> {
        let words = configuration.words
        return SnapshotTimeline.entry { ClockSnapshot(at: $0, words: words) }
    }

    func timeline(for configuration: ClockWidgetIntent, in context: Context) async -> Timeline<SnapshotEntry<ClockSnapshot>> {
        let words = configuration.words
        return SnapshotTimeline.timeline(changes: { _ in ClockSnapshot.changes(words: words) }) {
            ClockSnapshot(at: $0, words: words)
        }
    }
}
