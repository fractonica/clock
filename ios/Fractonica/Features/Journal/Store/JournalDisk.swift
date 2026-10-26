import CryptoKit
import Foundation

/// The journal's files, under one root (by default `Application Support/Journal`; `-FXJournalStore <dir>` points it
/// elsewhere):
///
///     records/<id>.json     every record, own and from the hub, any kind: exactly the API JSON (atomic writes)
///     blobs/<hash>.<ext>    attached files by SHA-256, the extension from the MIME type (AVFoundation plays them)
///     drafts/<key>.json     the composer's autosaved drafts ("new", or the id of the entry being edited)
///     state.json            pending ids and the two sync cursors
///     tmp/                  recordings and exports in progress (emptied at launch)
///
/// Plain value type, safe to use from any thread: the store loads through it off the main thread and writes through it
/// on the main actor (records and state are small).
struct JournalDisk: Sendable {
    let root: URL

    var records: URL { root.appending(path: "records", directoryHint: .isDirectory) }
    var blobs: URL { root.appending(path: "blobs", directoryHint: .isDirectory) }
    var drafts: URL { root.appending(path: "drafts", directoryHint: .isDirectory) }
    var tmp: URL { root.appending(path: "tmp", directoryHint: .isDirectory) }
    var stateFile: URL { root.appending(path: "state.json") }

    /// `Application Support/Journal`, or the folder `-FXJournalStore` names.
    static var standard: JournalDisk {
        if let path = UserDefaults.standard.string(forKey: "FXJournalStore"), !path.isEmpty {
            return JournalDisk(root: URL(filePath: (path as NSString).expandingTildeInPath, directoryHint: .isDirectory))
        }
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true))
            ?? FileManager.default.temporaryDirectory
        return JournalDisk(root: base.appending(path: "Journal", directoryHint: .isDirectory))
    }

    func prepare() {
        for dir in [records, blobs, drafts, tmp] {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    // MARK: Loading

    /// Everything on disk: the records, the state, the blob files by hash and the drafts.
    struct Snapshot: Sendable {
        var records: [HubRecord] = []
        var state = JournalState()
        var blobFiles: [String: String] = [:]
        var drafts: [JournalDraft] = []
    }

    func load() -> Snapshot {
        prepare()
        var snapshot = Snapshot()
        let fm = FileManager.default
        let decoder = JSONDecoder()
        for url in (try? fm.contentsOfDirectory(at: records, includingPropertiesForKeys: nil)) ?? [] where url.pathExtension == "json" {
            if let data = try? Data(contentsOf: url), let record = try? decoder.decode(HubRecord.self, from: data) {
                snapshot.records.append(record)
            }
        }
        if let data = try? Data(contentsOf: stateFile), let state = try? decoder.decode(JournalState.self, from: data) {
            snapshot.state = state
        }
        for url in (try? fm.contentsOfDirectory(at: blobs, includingPropertiesForKeys: nil)) ?? [] {
            let name = url.lastPathComponent
            let hash = String(name.prefix { $0 != "." })
            if JournalValidation.isValidHash(hash) { snapshot.blobFiles[hash] = name }
        }
        for url in (try? fm.contentsOfDirectory(at: drafts, includingPropertiesForKeys: nil)) ?? [] where url.pathExtension == "json" {
            if let data = try? Data(contentsOf: url), let draft = try? decoder.decode(JournalDraft.self, from: data) {
                snapshot.drafts.append(draft)
            }
        }
        // whatever was recording or exporting when the app last stopped
        try? fm.removeItem(at: tmp)
        try? fm.createDirectory(at: tmp, withIntermediateDirectories: true)
        return snapshot
    }

    // MARK: Writing

    private static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return e
    }

    func recordFile(_ id: String) -> URL { records.appending(path: "\(id).json") }

    func write(_ record: HubRecord) throws {
        try Self.encoder().encode(record).write(to: recordFile(record.id), options: .atomic)
    }

    func removeRecord(_ id: String) {
        try? FileManager.default.removeItem(at: recordFile(id))
    }

    func write(_ state: JournalState) throws {
        try Self.encoder().encode(state).write(to: stateFile, options: .atomic)
    }

    func draftFile(_ key: String) -> URL { drafts.appending(path: "\(key).json") }

    func write(_ draft: JournalDraft) throws {
        try Self.encoder().encode(draft).write(to: draftFile(draft.key), options: .atomic)
    }

    func removeDraft(_ key: String) {
        try? FileManager.default.removeItem(at: draftFile(key))
    }

    /// A fresh file in tmp/ with this extension.
    func temporaryFile(ext: String) -> URL {
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        return tmp.appending(path: "\(UUID().uuidString.lowercased()).\(ext)")
    }

    // MARK: Sizes

    /// Bytes used by the records (and state, drafts) and by the media.
    func usage() -> (records: Int64, media: Int64) {
        func size(of dir: URL) -> Int64 {
            let urls = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey])) ?? []
            return urls.reduce(0) { $0 + Int64((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
        }
        return (size(of: records) + size(of: drafts), size(of: blobs))
    }

    // MARK: Hashing

    /// The lowercase hex SHA-256 of a file, read in 1 MB pieces (videos can be large).
    static func sha256(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    static func fileSize(_ url: URL) -> Int {
        (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    }
}

/// state.json: what is waiting to reach the hub and where the feeds stand.
struct JournalState: Codable, Hashable, Sendable {
    var pending: [String] = []
    var changeCursor = 0
    var vectorCursor = 0
}

/// A composer's work in progress, autosaved so nothing is lost if the app is killed. Its media are blobs already in
/// the store (imported as they are added); the store keeps them while a draft names them.
struct JournalDraft: Codable, Hashable, Sendable {
    /// "new", or the id of the entry being edited.
    var key: String
    /// The id the saved record takes.
    var recordID: String
    var emoji: String?
    var title: String = ""
    var markdown: String = ""
    var transcript: String?
    var time: Double
    /// The moment was chosen by hand; otherwise a new entry takes the moment it is saved.
    var timeChosen: Bool?
    var zone: String?
    var blobs: [BlobRef] = []
    /// When it was last autosaved.
    var saved: Double = 0

    static let newKey = "new"

    var entry: JournalEntry {
        JournalEntry(emoji: emoji, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                     markdown: markdown, transcript: transcript)
    }

    /// Nothing typed, chosen or attached.
    var isEmpty: Bool {
        (emoji ?? "").isEmpty && title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && blobs.isEmpty
    }

    var blobHashes: Set<String> {
        Set(blobs.flatMap { [$0.hash] + ($0.poster.map { [$0] } ?? []) })
    }
}
