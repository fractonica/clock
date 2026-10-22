import FractonicaKit
import SwiftUI
import WidgetKit

/// The journal face on the Home Screen, the desktop and in StandBy (small and large), mirroring the Now screen.
struct JournalWidget: Widget {
    static let kind = "app.fractonica.clock.journal"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: Self.kind, intent: JournalWidgetIntent.self, provider: JournalProvider()) { entry in
            JournalEntryView(entry: entry)
        }
        .configurationDisplayName("Journal")
        .description("The journal face: the lead unit's phase, its counts and its cycle.")
        .supportedFamilies([.systemSmall, .systemLarge])
    }
}

struct JournalEntryView: View {
    let entry: SnapshotEntry<JournalSnapshot>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        JournalWidgetView(snapshot: entry.snapshot, size: family == .systemLarge ? .large : .small)
            .widgetURL(AppLink(screen: .now).url)
            .fractonicaBackground()
    }
}

struct JournalProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry<JournalSnapshot> {
        SnapshotTimeline.entry { JournalSnapshot(at: $0, unit: JournalUnitOption.helion.unit) }
    }

    func snapshot(for configuration: JournalWidgetIntent, in context: Context) async -> SnapshotEntry<JournalSnapshot> {
        SnapshotTimeline.entry { JournalSnapshot(at: $0, unit: configuration.unit.unit) }
    }

    func timeline(for configuration: JournalWidgetIntent, in context: Context) async -> Timeline<SnapshotEntry<JournalSnapshot>> {
        let unit = configuration.unit.unit
        return SnapshotTimeline.timeline(changes: { _ in JournalSnapshot.changes(unit: unit) }) {
            JournalSnapshot(at: $0, unit: unit)
        }
    }
}
