import Foundation

/// The media every record pulled from the hub names, so the sync engine knows what to download (now, or when "Download
/// all media" is turned on later) without asking the store for every record. Kept beside the vector index as
/// `media.json`; rebuilt by a pull from 0.
///
/// Policy: posters, photos and audio download eagerly in the background; other small files (≤ 25 MB) too; videos (and
/// anything larger) only on demand (`SyncEngine.ensureBlob`) unless "Download all media" is on.
struct MediaLedger: Codable, Sendable, Equatable {
    struct Item: Codable, Hashable, Sendable {
        var hash: String
        var role: String
        var type: String
        var size: Int
    }

    /// Blobs of each live record, by record id.
    private(set) var byRecord: [String: [Item]] = [:]
    /// Hashes the hub answered 404 for (gone, or not readable by this device): never asked for again.
    private(set) var gone: Set<String> = []

    static let eagerRoles: Set<String> = ["photo", "audio", "poster"]
    static let eagerSizeLimit = 25 * 1024 * 1024

    static func isEager(_ item: Item) -> Bool {
        if eagerRoles.contains(item.role) { return true }
        if item.role == "video" { return false }
        return item.size <= eagerSizeLimit
    }

    /// Notes a record from the hub: its blobs replace what was known; a tombstone forgets them.
    /// Returns whether anything changed.
    @discardableResult
    mutating func update(_ record: HubRecord) -> Bool {
        let items = record.isDeleted ? [] : (record.blobs ?? []).map {
            Item(hash: $0.hash.lowercased(), role: $0.role, type: $0.type, size: $0.size)
        }
        let before = byRecord[record.id]
        byRecord[record.id] = items.isEmpty ? nil : items
        return before != byRecord[record.id]
    }

    mutating func markGone(_ hash: String) {
        gone.insert(hash.lowercased())
    }

    mutating func removeAll() {
        byRecord = [:]
        gone = []
    }

    /// What to download, each hash once: eager items (and all of them with `all`), smallest first so the screen fills
    /// quickly, skipping what `have` says is on the device and what the hub no longer has.
    func wanted(all: Bool, have: (String) -> Bool) -> [Item] {
        var seen = Set<String>()
        var items: [Item] = []
        for item in byRecord.values.joined() where !seen.contains(item.hash) && !gone.contains(item.hash) {
            seen.insert(item.hash)
            guard all || Self.isEager(item), !have(item.hash) else { continue }
            items.append(item)
        }
        return items.sorted { ($0.size, $0.hash) < ($1.size, $1.hash) }
    }

    var blobCount: Int { Set(byRecord.values.joined().map(\.hash)).count }

    // MARK: Disk

    static func load(from url: URL?) -> MediaLedger {
        guard let url, let data = try? Data(contentsOf: url),
              let ledger = try? JSONDecoder().decode(MediaLedger.self, from: data) else { return MediaLedger() }
        return ledger
    }

    func save(to url: URL?) {
        guard let url else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONEncoder().encode(self).write(to: url, options: .atomic)
    }
}
