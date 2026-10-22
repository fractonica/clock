#if os(iOS)
import FractonicaKit
import SwiftUI
import WidgetKit

/// The Lock Screen accessories (iPhone and iPad): the Helion gauge, the date with the pair, the minor clock in a
/// line. Always in Fractonica terms.
struct AccessoryWidget: Widget {
    static let kind = "app.fractonica.clock.lock"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: AccessoryProvider()) { entry in
            AccessoryEntryView(entry: entry)
        }
        .configurationDisplayName("Fractonica")
        .description("The Helion and its phase, the date, the minor clock.")
        .supportedFamilies([.accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct AccessoryEntryView: View {
    let entry: SnapshotEntry<AccessorySnapshot>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            switch family {
            case .accessoryCircular: HelionGaugeView(snapshot: entry.snapshot)
            case .accessoryRectangular: ClockRectangularView(snapshot: entry.snapshot)
            default: ClockInlineView(snapshot: entry.snapshot)
            }
        }
        .widgetURL(AppLink(screen: .now).url)
        .containerBackground(for: .widget) { Color.clear }
    }
}

struct AccessoryProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry<AccessorySnapshot> {
        SnapshotTimeline.entry { AccessorySnapshot(at: $0) }
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry<AccessorySnapshot>) -> Void) {
        completion(SnapshotTimeline.entry { AccessorySnapshot(at: $0) })
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry<AccessorySnapshot>>) -> Void) {
        // the inline accessory needs only the Preons; the gauge and the pair follow the Helion's 256 steps
        completion(SnapshotTimeline.timeline(changes: { _ in AccessorySnapshot.changes }) { AccessorySnapshot(at: $0) })
    }
}
#endif
