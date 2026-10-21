import FractonicaKit
import SwiftUI
import WidgetKit

/// The extra-large overview on iPad and the Mac desktop: clock, dial and up next.
struct OverviewWidget: Widget {
    static let kind = "app.fractonica.clock.overview"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: ClockWidgetIntent.self, provider: OverviewProvider()) { entry in
            OverviewWidgetView(snapshot: entry.snapshot)
                .widgetURL(AppLink(screen: .now).url)
                .fractonicaBackground()
        }
        .configurationDisplayName("Overview")
        .description("The clock, every cycle as a dial, and what turns over next.")
        .supportedFamilies([.systemExtraLarge])
    }
}

struct OverviewProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry<OverviewSnapshot> {
        SnapshotTimeline.entry { OverviewSnapshot(at: $0, words: WidgetWords(pure: false)) }
    }

    func snapshot(for configuration: ClockWidgetIntent, in context: Context) async -> SnapshotEntry<OverviewSnapshot> {
        let words = configuration.words
        return SnapshotTimeline.entry { OverviewSnapshot(at: $0, words: words) }
    }

    func timeline(for configuration: ClockWidgetIntent, in context: Context) async -> Timeline<SnapshotEntry<OverviewSnapshot>> {
        let words = configuration.words
        return SnapshotTimeline.timeline(changes: { OverviewSnapshot.changes(at: $0, words: words) }) {
            OverviewSnapshot(at: $0, words: words)
        }
    }
}
