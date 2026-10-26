import Foundation

/// Semantic search on the device: the hub embeds only the query (`POST /v1/embed`, 256 dimensions), and the device ranks
/// it against its own copy of every record's vectors (`VectorIndex`, kept by the sync engine from the vector feed).
///
///     if let scores = await SemanticSearch.shared.search("the night the moon was huge") {
///         // record id → cosine similarity of its best part (the whole record, or one photo)
///     } else {
///         // unpaired, offline, no worker, or no vectors yet: search by keyword
///     }
@MainActor
final class SemanticSearch {
    static let shared = SemanticSearch(engine: .shared)

    private let engine: SyncEngine
    /// Recent query vectors, so typing back and forth does not ask the hub again.
    private var cache: [String: [Float]] = [:]
    private var cacheOrder: [String] = []
    private let cacheSize = 32

    init(engine: SyncEngine) {
        self.engine = engine
    }

    /// Record id → score (cosine similarity, −1…1; the best of the record's parts) for the `limit` records closest to
    /// `query`. Nil when there is no semantic answer: not paired, the hub unreachable, no embedding worker connected,
    /// or no vectors on the device yet. Fall back to keyword search then.
    func search(_ query: String, limit: Int = 100) async -> [String: Double]? {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let client = engine.client, engine.status != .revoked else { return nil }
        let key = text.lowercased()
        var vector = cache[key]
        if vector == nil {
            // Catch up with the vector feed while the hub embeds the query (both are network waits).
            async let refreshed: Void = engine.refreshVectorsQuietly()
            let embedded = try? await client.embed([text], task: "query", dim: engine.vectors.dim)
            await refreshed
            guard let floats = embedded?.floats.first, let floats else { return nil }
            remember(key, floats)
            vector = floats
        }
        guard let vector, await engine.vectors.count > 0 else { return nil }
        return await engine.vectors.rank(vector, limit: limit)
    }

    private func remember(_ key: String, _ vector: [Float]) {
        cache[key] = vector
        cacheOrder.removeAll { $0 == key }
        cacheOrder.append(key)
        if cacheOrder.count > cacheSize { cache[cacheOrder.removeFirst()] = nil }
    }
}
