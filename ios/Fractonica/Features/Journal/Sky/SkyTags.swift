import FractonicaKit
import Foundation

/// Sky events near an entry as its tags (hub/API.md): `sky:<event>` for every event within one Helion before or after
/// the entry's `time` — the Helion running at that moment, from the engine (its mean length outside the catalogue) —
/// kept current whenever the entry is saved; the writer's other tags stay as they are. Pure logic, checked by
/// Sky/Checks and Journal/Checks.
///
/// The store applies `normalise` to every local save (JournalHooks sets `JournalStore.normalise`), and `backfill` tags
/// the entries already on the device once (`version`).
enum SkyTags {
    static let prefix = "sky:"
    /// The store's migration key and the version of the tagging rule it ran: raising it tags every entry again.
    static let migration = "skyTags"
    static let version = 1

    /// How far an entry reaches: the length of the Helion running at t (the Helion's mean outside the catalogue).
    static func reach(at t: Double, clock: FractonicaClock = .shared) -> Double {
        if let r = clock.level(at: t, 6) { return r.end - r.start }
        return clock.levelInfo(6).meanSeconds
    }

    /// The events within a Helion of t (both ends included), in time order.
    static func events(near t: Double, events table: SkyEvents = .shared, clock: FractonicaClock = .shared) -> [SkyEvent] {
        let d = reach(at: t, clock: clock)
        return table.indices(through: t + d, from: t - d).map(table.event)
    }

    /// The `sky:` tags for an entry at t: each event name once, in time order.
    static func names(near t: Double, events table: SkyEvents = .shared, clock: FractonicaClock = .shared) -> [String] {
        var seen = Set<String>()
        return events(near: t, events: table, clock: clock).compactMap { seen.insert($0.name).inserted ? prefix + $0.name : nil }
    }

    /// An entry's tags at t: its own (non-sky) tags as they were, then the sky tags. nil stays nil when there is nothing.
    static func tags(_ existing: [String]?, at t: Double, events table: SkyEvents = .shared, clock: FractonicaClock = .shared) -> [String]? {
        let own = (existing ?? []).filter { !$0.hasPrefix(prefix) }
        let all = own + names(near: t, events: table, clock: clock)
        if all.isEmpty { return existing?.isEmpty == true ? existing : nil }
        return all
    }

    /// A record as the store keeps it: a live journal entry with its sky tags current; anything else unchanged.
    static func normalise(_ record: HubRecord) -> HubRecord {
        guard record.kind == JournalEntry.kind, !record.isDeleted else { return record }
        var r = record
        r.tags = tags(record.tags, at: record.time)
        return r
    }

    /// The live journal entries whose sky tags are not current, retagged (for the store's one-off backfill).
    static func outdated(_ records: some Sequence<HubRecord>) -> [HubRecord] {
        records.compactMap { r in
            let n = normalise(r)
            return n.tags != r.tags ? n : nil
        }
    }

    // MARK: Reading tags

    /// The kinds a record's `sky:` tags name, in their order (names the diary does not know are skipped).
    static func kinds(in tags: [String]?) -> [SkyKindInfo] {
        (tags ?? []).compactMap { tag in
            guard tag.hasPrefix(prefix), let i = SkyKinds.index(of: String(tag.dropFirst(prefix.count))) else { return nil }
            return SkyKinds.all[i]
        }
    }

    /// The tags' events near the record's moment, for showing them with their times (an event the table does not
    /// have, or too far, is left out; `kinds(in:)` lists every tag).
    static func events(of record: HubRecord, events table: SkyEvents = .shared, clock: FractonicaClock = .shared) -> [SkyEvent] {
        let names = Set(kinds(in: record.tags).map(\.name))
        guard !names.isEmpty else { return [] }
        return events(near: record.time, events: table, clock: clock).filter { names.contains($0.name) }
    }

    /// What keyword search reads from the sky tags: each event's label and its name as words ("Full Moon full moon").
    static func searchText(_ tags: [String]?) -> String {
        kinds(in: tags).map { "\($0.label) \($0.labelPure) \($0.name.replacingOccurrences(of: "-", with: " "))" }.joined(separator: "\n")
    }
}
