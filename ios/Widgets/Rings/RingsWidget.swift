import FractonicaKit
import SwiftUI
import WidgetKit

/// A snapshot of the Rings dial (small and large).
struct RingsWidget: Widget {
    static let kind = "app.fractonica.clock.rings"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: RingsWidgetIntent.self, provider: RingsProvider()) { entry in
            RingsEntryView(entry: entry)
        }
        .configurationDisplayName("Rings")
        .description("Every cycle from the Alpha to the Helion, as nested dials.")
        .supportedFamilies([.systemSmall, .systemLarge])
    }
}

struct RingsEntryView: View {
    let entry: SnapshotEntry<RingsSnapshot>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        RingsWidgetView(snapshot: entry.snapshot, size: family == .systemLarge ? .large : .small)
            .widgetURL(AppLink(screen: .rings).url)
            .fractonicaBackground()
    }
}

struct RingsProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry<RingsSnapshot> {
        SnapshotTimeline.entry { RingsSnapshot(at: $0, words: WidgetWords(pure: false)) }
    }

    func snapshot(for configuration: RingsWidgetIntent, in context: Context) async -> SnapshotEntry<RingsSnapshot> {
        let words = configuration.words
        return SnapshotTimeline.entry { RingsSnapshot(at: $0, words: words) }
    }

    func timeline(for configuration: RingsWidgetIntent, in context: Context) async -> Timeline<SnapshotEntry<RingsSnapshot>> {
        let words = configuration.words
        return SnapshotTimeline.timeline(changes: { _ in RingsSnapshot.changes(words: words) }) {
            RingsSnapshot(at: $0, words: words)
        }
    }
}
