import FractonicaKit
import SwiftUI
import WidgetKit

/// Up next: the next turnover of every unit, the nearest counting down (small, medium, large).
struct UpNextWidget: Widget {
    static let kind = "app.fractonica.clock.upnext"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: UpNextWidgetIntent.self, provider: UpNextProvider()) { entry in
            UpNextEntryView(entry: entry)
        }
        .configurationDisplayName("Up Next")
        .description("When the Helion, the Nuclide, the Delta and the longer cycles turn over.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct UpNextEntryView: View {
    let entry: SnapshotEntry<UpNextSnapshot>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let size: UpNextWidgetView.Size = switch family {
        case .systemSmall: .small
        case .systemMedium: .medium
        default: .large
        }
        UpNextWidgetView(snapshot: entry.snapshot, size: size)
            .widgetURL(AppLink(screen: .ladder).url)
            .fractonicaBackground()
    }
}

struct UpNextProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry<UpNextSnapshot> {
        SnapshotTimeline.entry { UpNextSnapshot(at: $0, words: WidgetWords(pure: false)) }
    }

    func snapshot(for configuration: UpNextWidgetIntent, in context: Context) async -> SnapshotEntry<UpNextSnapshot> {
        let words = configuration.words, finest = configuration.from.level
        return SnapshotTimeline.entry { UpNextSnapshot(at: $0, words: words, finest: finest) }
    }

    func timeline(for configuration: UpNextWidgetIntent, in context: Context) async -> Timeline<SnapshotEntry<UpNextSnapshot>> {
        let words = configuration.words, finest = configuration.from.level
        return SnapshotTimeline.timeline(
            changes: { UpNextSnapshot.changes(at: $0, words: words, finest: finest) },
            snapshot: { UpNextSnapshot(at: $0, words: words, finest: finest) },
            relevance: Self.relevance
        )
    }

    /// Smart Stacks bring the widget forward in the last Preon or so before a Nuclide or a longer cycle turns over.
    static func relevance(_ snapshot: UpNextSnapshot, at t: Double) -> TimelineEntryRelevance? {
        guard let major = snapshot.turnovers.first(where: { $0.level <= 4 }) else { return nil }
        let lead = major.time - t
        return lead <= UpNextSnapshot.relevanceLead + 1
            ? TimelineEntryRelevance(score: 50, duration: max(1, lead + 60))
            : TimelineEntryRelevance(score: 1)
    }
}
