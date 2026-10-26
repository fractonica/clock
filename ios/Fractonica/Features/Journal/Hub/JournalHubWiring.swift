import Foundation

/// Connects the journal (store, timeline, media views) to the hub sync once the store has loaded: local saves sync,
/// pull to refresh syncs, missing media come from the hub, and search ranks by the hub's vectors when it can.
@MainActor
enum JournalHubWiring {
    static func connect(_ store: JournalStore = .shared, engine: SyncEngine = .shared) {
        store.onLocalChange = { engine.localChanged() }
        JournalHooks.refresh = { await engine.syncNow() }
        JournalHooks.fetchBlob = { hash in try await engine.ensureBlob(hash) }
        JournalHooks.remoteThumbnail = { hash, pixels in
            guard let file = try? await engine.thumbnail(hash: hash, px: pixels) else { return nil }
            return try? Data(contentsOf: file)
        }
        JournalSearch.semantic = { query in await SemanticSearch.shared.search(query) }
        engine.attach(store)
    }
}

extension JournalStore: RecordSyncResetting {}
