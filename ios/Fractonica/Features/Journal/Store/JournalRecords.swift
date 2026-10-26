import Foundation

// Helpers around the hub record (HubRecord.swift keeps the JSON shape; nothing here changes it): building and editing
// journal entries, tombstones, the blobs a record names, file extensions for MIME types, the searchable text (hub/API.md
// "Searchable text by kind") and the generic summary of a record of another kind. Pure logic, checked by Journal/Checks.

extension HubRecord {
    /// A new `journal.entry` written on this device now.
    static func journalEntry(id: String = UUID().uuidString.lowercased(), time: Double, zone: String?,
                             entry: JournalEntry, blobs: [BlobRef], now: Double) -> HubRecord {
        HubRecord(id: id, kind: JournalEntry.kind, time: time, end: nil, zone: zone, data: entry.data, text: nil,
                  tags: nil, blobs: blobs.isEmpty ? nil : blobs, created: now, updated: now, deleted: nil)
    }

    /// This record as the hub's DELETE writes it: `deleted`, empty `data` and `blobs`, `updated` = now. The hub's
    /// fields (source, rev …) stay, so the tombstone still names its creator.
    func tombstone(at now: Double) -> HubRecord {
        var r = self
        r.deleted = true
        r.data = .object([:])
        r.blobs = []
        r.text = nil
        r.tags = nil
        r.updated = max(now, updated)
        return r
    }

    /// Every blob hash the record names: its blobs and their posters.
    var blobHashes: Set<String> {
        var hashes = Set<String>()
        for blob in blobs ?? [] {
            hashes.insert(blob.hash)
            if let poster = blob.poster { hashes.insert(poster) }
        }
        return hashes
    }

    /// The blobs shown as media: everything but the posters, which stand in for their videos.
    var mediaBlobs: [BlobRef] { (blobs ?? []).filter { $0.role != "poster" } }

    /// The blob named `hash`, if the record lists it.
    func blob(_ hash: String) -> BlobRef? { blobs?.first { $0.hash == hash } }

    /// The searchable text by kind (hub/API.md): a journal entry's emoji, title, Markdown and transcript; any other
    /// kind's `text`, else `data.text`, else `data.title` / `data.summary`.
    var searchableText: String {
        if let entry {
            return [entry.emoji, entry.title, entry.markdown, entry.transcript].compactMap { $0 }.joined(separator: "\n")
        }
        if let text, !text.isEmpty { return text }
        if let s = data["text"]?.string { return s }
        return [data["emoji"]?.string, data["title"]?.string, data["summary"]?.string].compactMap { $0 }.joined(separator: "\n")
    }

    /// How a record of another kind shows (hub/API.md "Other kinds are shown generically"): the emoji from
    /// `data.emoji`, `data.title` or the kind, the searchable text and the scalar values of `data` as
    /// "celsius 21.5 · where studio".
    var generic: GenericRecordSummary {
        var facts: [String] = []
        for (key, value) in (data.object ?? [:]).sorted(by: { $0.key < $1.key }) {
            guard !["emoji", "title", "text", "summary", "markdown"].contains(key) else { continue }
            switch value {
            case .number(let n): facts.append("\(key) \(GenericRecordSummary.number(n))")
            case .string(let s) where s.count <= 40: facts.append("\(key) \(s)")
            case .bool(let b): facts.append("\(key) \(b ? "yes" : "no")")
            default: continue
            }
        }
        let text = text ?? data["text"]?.string ?? data["summary"]?.string
        return GenericRecordSummary(
            emoji: data["emoji"]?.string,
            title: data["title"]?.string ?? kind,
            text: text?.isEmpty == false ? text : nil,
            facts: facts.joined(separator: " · ")
        )
    }
}

/// A record of another kind, as a compact row shows it.
struct GenericRecordSummary: Hashable, Sendable {
    var emoji: String?
    var title: String
    var text: String?
    var facts: String

    /// "21.5", "3", "0.0012": short, without a trailing ".0".
    static func number(_ n: Double) -> String {
        if n == n.rounded(), abs(n) < 1e15 { return String(Int64(n)) }
        let s = String(format: "%.4g", n)
        return s
    }
}

/// File extensions for blob MIME types, so a blob's file opens in AVFoundation and ImageIO by its name.
enum JournalMIME {
    private static let table: [(type: String, ext: String)] = [
        ("image/heic", "heic"), ("image/heif", "heif"), ("image/jpeg", "jpg"), ("image/png", "png"),
        ("image/gif", "gif"), ("image/webp", "webp"), ("image/tiff", "tiff"),
        ("video/quicktime", "mov"), ("video/mp4", "mp4"), ("video/x-m4v", "m4v"),
        ("audio/mp4", "m4a"), ("audio/x-m4a", "m4a"), ("audio/m4a", "m4a"), ("audio/aac", "aac"),
        ("audio/mpeg", "mp3"), ("audio/wav", "wav"), ("audio/x-wav", "wav"), ("audio/aiff", "aiff"),
        ("audio/x-aiff", "aiff"), ("audio/x-caf", "caf"), ("audio/flac", "flac"),
        ("application/pdf", "pdf"), ("text/plain", "txt"), ("application/json", "json"),
    ]

    /// "heic" for image/heic; "bin" when the type is unknown.
    static func ext(for type: String?) -> String {
        guard let type = type?.lowercased().split(separator: ";").first.map({ $0.trimmingCharacters(in: .whitespaces) })
        else { return "bin" }
        return table.first { $0.type == type }?.ext ?? "bin"
    }

    /// "image/heic" for heic; nil when unknown.
    static func type(forExtension ext: String) -> String? {
        let ext = ext.lowercased()
        if ext == "jpeg" { return "image/jpeg" }
        return table.first { $0.ext == ext }?.type
    }

    /// The broad role of a MIME type: photo, video or audio (else file).
    static func role(for type: String) -> String {
        if type.hasPrefix("image/") { return "photo" }
        if type.hasPrefix("video/") { return "video" }
        if type.hasPrefix("audio/") { return "audio" }
        return "file"
    }
}

/// Valid record ids and kinds (hub/API.md).
enum JournalValidation {
    static func isValidID(_ id: String) -> Bool {
        guard (1...128).contains(id.count) else { return false }
        return id.unicodeScalars.allSatisfy { CharacterSet.alphanumerics.contains($0) && $0.isASCII || "._:-".unicodeScalars.contains($0) }
    }

    static func isValidHash(_ hash: String) -> Bool {
        hash.count == 64 && hash.allSatisfy { ("0"..."9").contains($0) || ("a"..."f").contains($0) }
    }
}
