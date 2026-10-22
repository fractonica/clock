import FractonicaKit
import SwiftUI
import WidgetKit

/// The Helion Arc: the running Helion as the journal face's two half-arcs, the running Preon riding it as a wave with
/// the dot on it, and the counts "34η" and "29ι". On the Lock Screen (iPhone and iPad), the Home Screen, in StandBy and
/// on the Mac desktop; always in Fractonica terms.
struct HelionArcWidget: Widget {
    static let kind = "app.fractonica.clock.helionarc"

    #if os(iOS)
    static let families: [WidgetFamily] = [.accessoryRectangular, .systemSmall, .systemMedium]
    #else
    static let families: [WidgetFamily] = [.systemSmall, .systemMedium]
    #endif

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: HelionArcProvider()) { entry in
            HelionArcEntryView(entry: entry)
        }
        .configurationDisplayName("Helion Arc")
        .description("The Helion as a double arc, the running Preon riding it as a wave.")
        .supportedFamilies(Self.families)
    }
}

struct HelionArcEntryView: View {
    let entry: SnapshotEntry<HelionArcSnapshot>
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        #if os(iOS)
        case .accessoryRectangular:
            HelionArcView(snapshot: entry.snapshot, size: .rectangular)
                .widgetURL(AppLink(screen: .wave).url)
                .containerBackground(for: .widget) { Color.clear }
        #endif
        default:
            HelionArcView(snapshot: entry.snapshot, size: family == .systemMedium ? .medium : .small)
                .widgetURL(AppLink(screen: .wave).url)
                .fractonicaBackground()
        }
    }
}

struct HelionArcProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry<HelionArcSnapshot> {
        SnapshotTimeline.entry { HelionArcSnapshot(at: $0) }
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry<HelionArcSnapshot>) -> Void) {
        completion(SnapshotTimeline.entry { HelionArcSnapshot(at: $0) })
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry<HelionArcSnapshot>>) -> Void) {
        // the dot's sixteen steps a Preon; the counts and the wave move on with the first of each
        completion(SnapshotTimeline.timeline(changes: { _ in HelionArcSnapshot.changes }) { HelionArcSnapshot(at: $0) })
    }
}
