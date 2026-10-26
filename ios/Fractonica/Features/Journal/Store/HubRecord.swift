import Foundation

// The hub's record (hub/API.md § Records), as the app stores it and sends it. The journal keeps every record, its own
// and those pulled from the hub, as exactly this JSON on disk, so a record round-trips between the device and the hub
// unchanged. `JournalEntry` reads a `journal.entry` record's `data`.

/// One record: a journal entry, or anything another client wrote (a sensor reading, computer usage).
struct HubRecord: Codable, Hashable, Identifiable, Sendable {
    var id: String
    var kind: String
    var time: Double
    var end: Double?
    var zone: String?
    var data: JSONValue
    var text: String?
    var tags: [String]?
    var blobs: [BlobRef]?
    var created: Double
    var updated: Double
    var deleted: Bool?

    // Set by the hub; nil on records not yet uploaded.
    var source: String?
    var editor: String?
    var rev: Int?
    var fx: FXReading?

    struct FXReading: Codable, Hashable, Sendable {
        var stamp: String?
        var clock: String?
    }

    var isDeleted: Bool { deleted ?? false }
}

/// A file attached to a record, addressed by the SHA-256 of its bytes (lowercase hex).
struct BlobRef: Codable, Hashable, Sendable {
    var hash: String
    /// MIME type: image/heic, image/jpeg, video/quicktime, audio/mp4 …
    var type: String
    var size: Int
    /// photo, video, audio, poster, file, or kind-specific.
    var role: String
    var name: String?
    var width: Int?
    var height: Int?
    var duration: Double?
    /// For a video: the hash of its still, itself listed with role `poster`.
    var poster: String?
}

/// Any JSON value: a record's kind-specific `data`.
enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n): try c.encode(n)
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { o[key] } else { nil }
    }

    var string: String? { if case .string(let s) = self { s } else { nil } }
    var number: Double? { if case .number(let n) = self { n } else { nil } }
    var object: [String: JSONValue]? { if case .object(let o) = self { o } else { nil } }
}

/// The `journal.entry` kind: a post with an emoji header, Markdown text and media (the record's blobs).
struct JournalEntry: Hashable, Sendable {
    static let kind = "journal.entry"

    var emoji: String?
    var title: String?
    var markdown: String
    var transcript: String?

    init(emoji: String? = nil, title: String? = nil, markdown: String = "", transcript: String? = nil) {
        self.emoji = emoji
        self.title = title
        self.markdown = markdown
        self.transcript = transcript
    }

    init(data: JSONValue) {
        self.init(
            emoji: data["emoji"]?.string,
            title: data["title"]?.string,
            markdown: data["markdown"]?.string ?? "",
            transcript: data["transcript"]?.string
        )
    }

    var data: JSONValue {
        var o: [String: JSONValue] = ["markdown": .string(markdown)]
        if let emoji, !emoji.isEmpty { o["emoji"] = .string(emoji) }
        if let title, !title.isEmpty { o["title"] = .string(title) }
        if let transcript, !transcript.isEmpty { o["transcript"] = .string(transcript) }
        return .object(o)
    }
}

extension HubRecord {
    /// The record's journal entry, if it is one.
    var entry: JournalEntry? { kind == JournalEntry.kind ? JournalEntry(data: data) : nil }
}
