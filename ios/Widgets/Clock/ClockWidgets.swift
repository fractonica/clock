import FractonicaKit
import SwiftUI
import WidgetKit

/// The clock on the Home Screen, the Lock Screen and the desktop: the minor clock ("34η 29ι", the Helion in its
/// Nuclide and the Preons completed) over the Helion's phase pair and the Delta it falls in. A new entry at every
/// Preon start.
struct ClockWidgets: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.fractonica.clock.now", provider: PreonTimeline()) { entry in
            NowWidgetView(entry: entry)
                .containerBackground(for: .widget) { Backdrop() }
        }
        .configurationDisplayName("Fractonica")
        .description("The Helion, its phase and the Preons completed.")
        .supportedFamilies([.systemSmall])
    }
}

/// One reading of the clock.
struct NowEntry: TimelineEntry {
    let date: Date
}

/// Entries at the start of every Preon (depth 9, about 8.4 minutes) for the next two hours.
struct PreonTimeline: TimelineProvider {
    /// The Preon's level (ι, depth 9).
    private static let preon = 8

    func placeholder(in context: Context) -> NowEntry {
        NowEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (NowEntry) -> Void) {
        completion(NowEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<NowEntry>) -> Void) {
        let now = Date.now.timeIntervalSince1970
        let starts = FractonicaClock.shared.boundaries(level: Self.preon, from: now, to: now + 2 * 3600, limit: 32)
        let entries = [NowEntry(date: .now)] + starts.filter { $0.time > now }.map { NowEntry(date: Date(timeIntervalSince1970: $0.time)) }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct NowWidgetView: View {
    let entry: NowEntry

    var body: some View {
        let t = entry.date.timeIntervalSince1970
        let notation = Notation.standard
        VStack(alignment: .leading, spacing: 8) {
            Text(notation.clockText(at: t, upTo: "iota"))
                .font(.system(size: 26, weight: .semibold).monospacedDigit())
                .foregroundStyle(Theme.ink)
                .minimumScaleFactor(0.6)
            if let helion = FractonicaClock.shared.level(at: t, 6) {
                PairView(fraction: helion.phase, color: Theme.teal, height: 30)
            }
            Spacer(minLength: 0)
            Text(notation.dateText(at: t, upTo: "epsilon"))
                .font(.caption2)
                .foregroundStyle(Theme.ink2)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
