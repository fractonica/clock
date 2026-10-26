import Foundation

/// The sky tags in the journal's store: every local save goes through `SkyTags.normalise` (new entries, edits, moments'
/// instant captures, seeds), and the entries already on the device are tagged once, marked pending so they sync.
@MainActor
enum SkyTagging {
    /// Hooks the tagging into the store; call before the store loads.
    static func install(_ store: JournalStore) {
        store.normalise = SkyTags.normalise
    }

    /// Reads the sky table off the main thread (the first sky query would otherwise read it during a frame).
    nonisolated static func warm() async {
        await Task.detached(priority: .userInitiated) { _ = SkyEvents.shared.count }.value
    }

    /// Tags the entries already on the device once per `SkyTags.version` (after the store loaded). Returns how many
    /// were written again.
    @discardableResult
    static func backfill(_ store: JournalStore) -> Int {
        guard store.isLoaded, store.migrationVersion(SkyTags.migration) < SkyTags.version else { return 0 }
        let changed = SkyTags.outdated(store.entries)
        let written = store.rewrite(changed)
        store.setMigrationVersion(SkyTags.migration, SkyTags.version)
        return written
    }
}
