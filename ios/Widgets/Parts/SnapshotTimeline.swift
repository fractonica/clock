import FractonicaKit
import WidgetKit

/// One timeline entry: what a widget shows from `date` until the next entry; nil outside the catalogue.
struct SnapshotEntry<Snapshot: Sendable>: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
    var relevance: TimelineEntryRelevance?
}

/// Builds every widget's timeline the same way: an entry now, then one exactly at each change the picture follows
/// (`EntrySchedule`), for a day or 150 entries, whichever comes first; then the widget asks again. Outside the
/// catalogue a single tidy entry and no reloads (or one at the catalogue's start).
enum SnapshotTimeline {
    /// How far one timeline reaches.
    static let horizon = 86_400.0

    static func timeline<Snapshot: Sendable>(
        now: Date = .now,
        changes: (Double) -> Set<WidgetChange>,
        snapshot: (Double) -> Snapshot?,
        relevance: (Snapshot, Double) -> TimelineEntryRelevance? = { _, _ in nil }
    ) -> Timeline<SnapshotEntry<Snapshot>> {
        let start = now.timeIntervalSince1970
        let clock = FractonicaClock.shared
        guard clock.inRange(start) else {
            let policy: TimelineReloadPolicy = start < clock.tMin ? .after(Date(timeIntervalSince1970: clock.tMin)) : .never
            return Timeline(entries: [SnapshotEntry(date: now, snapshot: nil)], policy: policy)
        }
        let times = EntrySchedule.times(from: start, horizon: horizon, changes: changes)
        let entries = times.enumerated().map { i, t in
            // a change is read a hair after its instant, so the entry shows the new state
            let s = snapshot(i == 0 ? t : t + WidgetChange.settle)
            return SnapshotEntry(date: Date(timeIntervalSince1970: t), snapshot: s, relevance: s.flatMap { relevance($0, t) })
        }
        let full = times.count >= EntrySchedule.maxEntries
        if !full, start + horizon >= clock.tMax, let last = times.last, last < clock.tMax {
            // the catalogue ends inside this timeline: from that instant on the tidy out-of-range state, for good
            // (rather than the last reading standing, its countdowns at zero, until the next reload)
            let end = SnapshotEntry<Snapshot>(date: Date(timeIntervalSince1970: clock.tMax), snapshot: nil)
            return Timeline(entries: entries + [end], policy: .never)
        }
        let reload = full ? times[times.count - 1] : start + horizon
        return Timeline(entries: entries, policy: .after(Date(timeIntervalSince1970: reload)))
    }

    /// A single entry now (placeholders, the widget gallery).
    static func entry<Snapshot: Sendable>(now: Date = .now, snapshot: (Double) -> Snapshot?) -> SnapshotEntry<Snapshot> {
        SnapshotEntry(date: now, snapshot: snapshot(now.timeIntervalSince1970))
    }
}
