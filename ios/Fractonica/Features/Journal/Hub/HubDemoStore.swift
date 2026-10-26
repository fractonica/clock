import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// A small `RecordSyncing` store for the sync engine's checks and for trying the hub page before the journal exists
/// (`-FXHubDemo N`): records as JSON, blobs as files named by their hash, the cursors, all in one folder (or memory).
/// It follows the protocol's rules (pending until accepted, last writer wins by `updated`, tombstones drop the record
/// and media nothing else names), so the engine runs against it as it will against the journal's store.
@MainActor
final class HubDemoStore: RecordSyncing, RecordSyncResetting {
    private(set) var records: [String: HubRecord] = [:]
    private(set) var pending: Set<String> = []
    var changeCursor = 0 { didSet { save() } }
    var vectorCursor = 0 { didSet { save() } }
    private let directory: URL?
    private let blobs: URL

    private struct State: Codable {
        var records: [HubRecord]
        var pending: [String]
        var changeCursor: Int
        var vectorCursor: Int
    }

    /// A store in `directory` (read back if it has one), or in memory with blobs in a temporary folder.
    init(directory: URL?) {
        self.directory = directory
        blobs = (directory ?? FileManager.default.temporaryDirectory.appendingPathComponent("hubdemo-\(UUID().uuidString)"))
            .appendingPathComponent("blobs", isDirectory: true)
        try? FileManager.default.createDirectory(at: blobs, withIntermediateDirectories: true)
        if let url = stateURL, let data = try? Data(contentsOf: url),
           let state = try? JSONDecoder().decode(State.self, from: data) {
            records = Dictionary(state.records.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
            pending = Set(state.pending)
            changeCursor = state.changeCursor
            vectorCursor = state.vectorCursor
        }
    }

    private var stateURL: URL? { directory?.appendingPathComponent("state.json") }

    private func save() {
        guard let stateURL else { return }
        let state = State(records: Array(records.values), pending: Array(pending), changeCursor: changeCursor,
                          vectorCursor: vectorCursor)
        try? JSONEncoder().encode(state).write(to: stateURL, options: .atomic)
    }

    /// Live records, newest `time` first.
    var entries: [HubRecord] { records.values.filter { !$0.isDeleted }.sorted { $0.time > $1.time } }

    // MARK: Local writes

    /// Writes (or edits) a record on this device: it becomes pending.
    func write(_ record: HubRecord) {
        records[record.id] = record
        pending.insert(record.id)
        save()
    }

    /// Deletes on this device: a pending tombstone.
    func delete(_ id: String, at time: Double = Date.now.timeIntervalSince1970) {
        guard var record = records[id] else { return }
        record.deleted = true
        record.data = .object([:])
        record.blobs = []
        record.updated = max(time, record.updated + 0.001)
        write(record)
    }

    /// Adds a file as a blob (by its SHA-256); returns its reference.
    func addBlob(_ data: Data, type: String, role: String, width: Int? = nil, height: Int? = nil,
                 duration: Double? = nil) throws -> BlobRef {
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        try data.write(to: blobs.appendingPathComponent(hash), options: .atomic)
        return BlobRef(hash: hash, type: type, size: data.count, role: role, width: width, height: height, duration: duration)
    }

    // MARK: RecordSyncing

    func pendingRecords() -> [HubRecord] {
        pending.compactMap { records[$0] }.sorted { ($0.updated, $0.id) < ($1.updated, $1.id) }
    }

    func markUploaded(_ record: HubRecord) {
        if let local = records[record.id], local.updated > record.updated { return }
        records[record.id] = record
        pending.remove(record.id)
        if record.isDeleted { forget(record.id) }
        save()
    }

    func applyRemote(_ record: HubRecord) {
        if let local = records[record.id] {
            if local.updated > record.updated { return }
            if local.updated == record.updated && pending.contains(record.id) { return }
        }
        pending.remove(record.id)
        if record.isDeleted {
            records[record.id] = record
            forget(record.id)
        } else {
            records[record.id] = record
        }
        save()
    }

    /// A tombstone keeps its id (so a late copy of the record does not come back) and loses its media.
    private func forget(_ id: String) {
        let named = Set(records.values.filter { !$0.isDeleted }.flatMap { ($0.blobs ?? []).map(\.hash) })
        let files = (try? FileManager.default.contentsOfDirectory(atPath: blobs.path)) ?? []
        for file in files where !named.contains(file) {
            try? FileManager.default.removeItem(at: blobs.appendingPathComponent(file))
        }
    }

    func blobFile(_ hash: String) -> URL? {
        let url = blobs.appendingPathComponent(hash.lowercased())
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    func storeBlob(_ hash: String, from file: URL) throws {
        let url = blobs.appendingPathComponent(hash.lowercased())
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: file)
            return
        }
        try FileManager.default.moveItem(at: file, to: url)
    }

    func markAllPending() {
        pending = Set(records.keys)
        save()
    }

    // MARK: Demo entries

    /// Fills an empty store with `count` journal entries: text, a generated photo on most, a voice note and a video
    /// (random bytes standing in) on a few, so pairing has something to upload.
    func seed(_ count: Int, now: Double = Date.now.timeIntervalSince1970) {
        guard records.isEmpty, count > 0 else { return }
        let lines = [
            ("🌙", "Night walk", "Saw the **moon** rise over the river, huge and orange."),
            ("☕️", "Morning", "Coffee on the balcony; the city still quiet."),
            ("🏔️", "Ridge", "Climbed to the ridge before the storm came in."),
            ("📚", nil, "Finished the book about clocks and calendars."),
            ("🎧", "Studio", "Recorded a sketch of the new melody."),
            ("🌊", "Sea", "Swam far out; the water was cold and clear."),
            ("🍞", nil, "Baked bread for the first time in months."),
            ("🚲", "Ride", "Long ride along the canal at sunset."),
        ]
        for i in 0..<count {
            let (emoji, title, text) = lines[i % lines.count]
            let time = now - Double(count - i) * 5400
            var blobs: [BlobRef] = []
            if i % 3 != 2, let jpeg = Self.photo(seed: i, size: CGSize(width: 1600 + (i % 4) * 400, height: 1200)),
               let ref = try? addBlob(jpeg, type: "image/jpeg", role: "photo", width: 1600 + (i % 4) * 400, height: 1200) {
                blobs.append(ref)
            }
            if i % 5 == 1, let ref = try? addBlob(Self.noise(400_000 + i * 1000), type: "audio/mp4", role: "audio", duration: 24) {
                blobs.append(ref)
            }
            if i % 7 == 3, let poster = Self.photo(seed: 100 + i, size: CGSize(width: 1280, height: 720)),
               let posterRef = try? addBlob(poster, type: "image/jpeg", role: "poster", width: 1280, height: 720),
               var video = try? addBlob(Self.noise(18_000_000 + i), type: "video/quicktime", role: "video",
                                        width: 1920, height: 1080, duration: 12) {
                video.poster = posterRef.hash
                blobs.append(video)
                blobs.append(posterRef)
            }
            let entry = JournalEntry(emoji: emoji, title: title, markdown: text)
            write(HubRecord(id: UUID().uuidString.lowercased(), kind: JournalEntry.kind, time: time, end: nil,
                            zone: TimeZone.current.identifier, data: entry.data, text: nil, tags: nil,
                            blobs: blobs.isEmpty ? nil : blobs, created: time, updated: time, deleted: nil,
                            source: nil, editor: nil, rev: nil, fx: nil))
        }
    }

    /// A JPEG of soft gradients, different for every seed.
    static func photo(seed: Int, size: CGSize) -> Data? {
        let width = Int(size.width), height = Int(size.height)
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        var rng = SplitMix(seed: UInt64(seed + 1))
        func color() -> CGColor {
            CGColor(red: rng.unit(), green: rng.unit(), blue: rng.unit(), alpha: 1)
        }
        let gradient = CGGradient(colorsSpace: space, colors: [color(), color(), color()] as CFArray, locations: [0, 0.5, 1])!
        context.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: width, y: height), options: [])
        for _ in 0..<24 {
            context.setFillColor(color().copy(alpha: 0.35)!)
            let r = rng.unit() * Double(min(width, height)) * 0.3
            context.fillEllipse(in: CGRect(x: rng.unit() * Double(width), y: rng.unit() * Double(height), width: r, height: r))
        }
        guard let image = context.makeImage() else { return nil }
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }
        return data as Data
    }

    /// `count` pseudo-random bytes (a stand-in for audio and video).
    static func noise(_ count: Int) -> Data {
        var rng = SplitMix(seed: UInt64(count))
        var data = Data(count: count)
        data.withUnsafeMutableBytes { raw in
            let words = raw.bindMemory(to: UInt64.self)
            for i in 0..<words.count { words[i] = rng.next() }
        }
        return data
    }

    private struct SplitMix {
        var state: UInt64
        init(seed: UInt64) { state = seed }
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
        mutating func unit() -> Double { Double(next() >> 11) / Double(1 << 53) }
    }
}
