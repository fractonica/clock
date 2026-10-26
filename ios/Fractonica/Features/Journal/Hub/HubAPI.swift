import Foundation

// The hub's wire format (hub/API.md): the bodies the app sends and reads, the endpoints, the errors, and the small
// helpers that turn what a person types (an address, a pairing code) into what the API wants. Pure Foundation, so the
// Hub checks compile it on the Mac.

// MARK: - Endpoints

/// One API call: method, path under the hub's base URL, query, and whether it carries the bearer token.
struct HubEndpoint: Sendable, Equatable {
    var method: String
    var path: String
    var query: [URLQueryItem] = []
    /// Seconds before the request gives up (a long poll adds its `wait`).
    var timeout: TimeInterval = 30
    var authorized = true

    /// `GET /v1` (no auth): the hub's name, version and embedding worker.
    static let info = HubEndpoint(method: "GET", path: "/v1", timeout: 10, authorized: false)
    /// `POST /v1/pair` (no auth): redeem a pairing code.
    static let pair = HubEndpoint(method: "POST", path: "/v1/pair", authorized: false)
    static let me = HubEndpoint(method: "GET", path: "/v1/me")
    static let batch = HubEndpoint(method: "POST", path: "/v1/records/batch", timeout: 120)
    static let blobsCheck = HubEndpoint(method: "POST", path: "/v1/blobs/check")
    static let embed = HubEndpoint(method: "POST", path: "/v1/embed", timeout: 15)
    static let search = HubEndpoint(method: "POST", path: "/v1/search", timeout: 20)
    static let kinds = HubEndpoint(method: "GET", path: "/v1/kinds")

    static func putRecord(_ id: String) -> HubEndpoint {
        HubEndpoint(method: "PUT", path: "/v1/records/\(segment(id))")
    }

    static func record(_ id: String) -> HubEndpoint {
        HubEndpoint(method: "GET", path: "/v1/records/\(segment(id))")
    }

    static func deleteRecord(_ id: String) -> HubEndpoint {
        HubEndpoint(method: "DELETE", path: "/v1/records/\(segment(id))")
    }

    /// `GET /v1/changes`: the sync feed after `after`; `wait` (≤ 30 s) holds the request open until something changes.
    static func changes(after: Int, limit: Int? = nil, wait: Int? = nil, kinds: [String] = []) -> HubEndpoint {
        var query = [URLQueryItem(name: "after", value: String(after))]
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let wait { query.append(URLQueryItem(name: "wait", value: String(min(max(wait, 0), 30)))) }
        query += kinds.map { URLQueryItem(name: "kind", value: $0) }
        return HubEndpoint(method: "GET", path: "/v1/changes", query: query, timeout: 30 + Double(wait ?? 0))
    }

    /// `PUT /v1/blobs/{hash}` (upload) or `GET` (download).
    static func blob(_ hash: String, method: String = "GET") -> HubEndpoint {
        HubEndpoint(method: method, path: "/v1/blobs/\(segment(hash))", timeout: 120)
    }

    /// `GET /v1/blobs/{hash}?thumb=<px>`: a JPEG whose long side is at most `px` (clamped to 64 … 2048).
    static func thumbnail(_ hash: String, px: Int) -> HubEndpoint {
        HubEndpoint(method: "GET", path: "/v1/blobs/\(segment(hash))",
                    query: [URLQueryItem(name: "thumb", value: String(min(max(px, 64), 2048)))])
    }

    /// `GET /v1/vectors`: the vector feed after `after`, at `dim` dimensions.
    static func vectors(after: Int, dim: Int = 256, limit: Int? = nil, kinds: [String] = []) -> HubEndpoint {
        var query = [URLQueryItem(name: "after", value: String(after)), URLQueryItem(name: "dim", value: String(dim))]
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        query += kinds.map { URLQueryItem(name: "kind", value: $0) }
        return HubEndpoint(method: "GET", path: "/v1/vectors", query: query, timeout: 60)
    }

    /// A path segment: ids are `[A-Za-z0-9._:-]`, hashes hex, but escape anything else rather than trust it.
    private static func segment(_ text: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "._:-~")
        return text.addingPercentEncoding(withAllowedCharacters: allowed) ?? text
    }
}

/// Builds `URLRequest`s for a hub: its base URL plus the token, if paired.
struct HubRequestBuilder: Sendable, Equatable {
    var base: URL
    var token: String?

    func url(_ endpoint: HubEndpoint) -> URL {
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false) ?? URLComponents()
        let prefix = components.percentEncodedPath.hasSuffix("/") ? String(components.percentEncodedPath.dropLast()) : components.percentEncodedPath
        components.percentEncodedPath = prefix + endpoint.path
        components.queryItems = endpoint.query.isEmpty ? nil : endpoint.query
        return components.url ?? base
    }

    /// `url(endpoint)` with the token as `?token=`: only blob GETs (and the event stream) accept it, for players and
    /// image views that cannot send a header.
    func tokenURL(_ endpoint: HubEndpoint) -> URL {
        var copy = endpoint
        if let token { copy.query.append(URLQueryItem(name: "token", value: token)) }
        return url(copy)
    }

    /// The request for `endpoint`; `body` goes with `contentType` (JSON unless said otherwise).
    func request(_ endpoint: HubEndpoint, body: Data? = nil, contentType: String = "application/json; charset=utf-8") -> URLRequest {
        var request = URLRequest(url: url(endpoint), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: endpoint.timeout)
        request.httpMethod = endpoint.method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if endpoint.authorized, let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = body
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    /// A JSON request for an `Encodable` body.
    func request(_ endpoint: HubEndpoint, json: some Encodable) throws -> URLRequest {
        request(endpoint, body: try HubJSON.encoder.encode(json))
    }
}

enum HubJSON {
    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.withoutEscapingSlashes]
        return encoder
    }

    static var decoder: JSONDecoder { JSONDecoder() }
}

// MARK: - Bodies

/// `GET /v1`.
struct HubInfo: Codable, Sendable, Equatable {
    struct Hub: Codable, Sendable, Equatable {
        var id: String
        var name: String
        var version: String?
    }

    struct Embedding: Codable, Sendable, Equatable {
        var model: String?
        var dim: Int?
        var dims: [Int]?
        var worker: Bool?
    }

    var hub: Hub
    var api: Int?
    var embedding: Embedding?

    /// An embedding worker is connected: semantic search and `embed` work.
    var workerConnected: Bool { embedding?.worker ?? false }
}

/// `POST /v1/pair` body.
struct HubPairRequest: Codable, Sendable, Equatable {
    var code: String
    var name: String
    var kind = "device"
    var platform: String
    /// The app's stable install identifier: pairing again with it replaces this device's client instead of adding one.
    var device: String
}

/// A client as the hub describes it (`GET /v1/me`, the pairing answer).
struct HubClientInfo: Codable, Sendable, Equatable {
    var id: String
    var name: String
    var kind: String?
    var platform: String?
    var scopes: [String]?
    var kinds: [String]?
    var created: Double?
    var lastSeen: Double?
}

/// `POST /v1/pair` answer.
struct HubPairResponse: Codable, Sendable, Equatable {
    var client: HubClientInfo
    var token: String
    var hub: HubInfo.Hub
}

/// `GET /v1/changes`: oldest change first, tombstones included.
struct HubChangesPage: Decodable, Sendable {
    var changes: [HubRecord]
    var cursor: Int
    var more: Bool

    init(changes: [HubRecord], cursor: Int, more: Bool) {
        self.changes = changes
        self.cursor = cursor
        self.more = more
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        changes = try c.decode([HubRecord].self, forKey: .changes)
        cursor = try c.decodeFlexibleInt(forKey: .cursor) ?? 0
        more = try c.decodeIfPresent(Bool.self, forKey: .more) ?? false
    }

    private enum CodingKeys: String, CodingKey { case changes, cursor, more }
}

/// `POST /v1/records/batch` answer: one result per record, each decided as its own `PUT`.
struct HubBatchResponse: Decodable, Sendable {
    struct Item: Decodable, Sendable {
        var id: String
        var status: Int
        var record: HubRecord?
        var error: HubErrorBody?

        init(id: String, status: Int, record: HubRecord? = nil, error: HubErrorBody? = nil) {
            self.id = id
            self.status = status
            self.record = record
            self.error = error
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            status = try c.decode(Int.self, forKey: .status)
            record = try? c.decodeIfPresent(HubRecord.self, forKey: .record)
            error = try? c.decodeIfPresent(HubErrorBody.self, forKey: .error)
        }

        private enum CodingKeys: String, CodingKey { case id, status, record, error }
    }

    var results: [Item]
}

struct HubBatchRequest: Encodable, Sendable {
    var records: [HubRecord]
}

/// The `error` object of a non-2xx answer (and of a failed batch item).
struct HubErrorBody: Decodable, Sendable {
    var code: String?
    var message: String?
    /// `details.missing` of a 422: the blobs the hub does not have.
    var missing: [String]?
    /// `details.current` of a 409: the stored, newer record to adopt.
    var current: HubRecord?

    init(code: String? = nil, message: String? = nil, missing: [String]? = nil, current: HubRecord? = nil) {
        self.code = code
        self.message = message
        self.missing = missing
        self.current = current
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        code = try? c.decodeIfPresent(String.self, forKey: .code)
        message = try? c.decodeIfPresent(String.self, forKey: .message)
        if let details = try? c.nestedContainer(keyedBy: DetailKeys.self, forKey: .details) {
            missing = try? details.decodeIfPresent([String].self, forKey: .missing)
            current = try? details.decodeIfPresent(HubRecord.self, forKey: .current)
        }
    }

    private enum CodingKeys: String, CodingKey { case code, message, details }
    private enum DetailKeys: String, CodingKey { case missing, current }
}

struct HubErrorEnvelope: Decodable, Sendable {
    var error: HubErrorBody
}

struct HubBlobCheckRequest: Codable, Sendable { var hashes: [String] }
struct HubBlobCheckResponse: Codable, Sendable { var missing: [String] }

/// `POST /v1/embed`.
struct HubEmbedRequest: Codable, Sendable, Equatable {
    var inputs: [String]
    /// `query` (the SearchQuery prompt) or `document`.
    var task: String
    var dim: Int
}

struct HubEmbedResponse: Decodable, Sendable {
    var model: String
    var dim: Int
    var vectors: [String]

    /// The vectors as floats, in input order (nil for one that does not decode at `dim`).
    var floats: [[Float]?] { vectors.map { HubVectorCoding.decode($0, dim: dim) } }
}

/// `GET /v1/vectors`.
struct HubVectorsPage: Decodable, Sendable {
    struct Entry: Decodable, Sendable, Equatable {
        var record: String
        /// `record`, `blob:<hash>`; nil with a nil vector: forget every vector of `record`.
        var part: String?
        var vector: String?
        var vrev: Int

        var isForget: Bool { part == nil || vector == nil }
    }

    var model: String
    var dim: Int
    var vectors: [Entry]
    var cursor: Int
    var more: Bool

    init(model: String, dim: Int, vectors: [Entry], cursor: Int, more: Bool) {
        self.model = model
        self.dim = dim
        self.vectors = vectors
        self.cursor = cursor
        self.more = more
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        dim = try c.decodeIfPresent(Int.self, forKey: .dim) ?? 256
        vectors = try c.decode([Entry].self, forKey: .vectors)
        cursor = try c.decodeFlexibleInt(forKey: .cursor) ?? 0
        more = try c.decodeIfPresent(Bool.self, forKey: .more) ?? false
    }

    private enum CodingKeys: String, CodingKey { case model, dim, vectors, cursor, more }
}

/// `POST /v1/search`.
struct HubSearchRequest: Codable, Sendable, Equatable {
    var query: String
    /// `semantic`, `keyword` or `auto`.
    var mode = "auto"
    var kinds: [String]?
    var since: Double?
    var until: Double?
    var limit: Int?
}

struct HubSearchResponse: Decodable, Sendable {
    struct Result: Decodable, Sendable {
        var record: HubRecord
        var score: Double
        var part: String?
    }

    var mode: String
    /// One per record; a result whose record does not decode is left out.
    var results: [Result]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? "keyword"
        results = try c.decode([HubLossy<Result>].self, forKey: .results).compactMap(\.value)
    }

    private enum CodingKeys: String, CodingKey { case mode, results }
}

/// An array element that may fail to decode without failing the array.
private struct HubLossy<T: Decodable & Sendable>: Decodable, Sendable {
    var value: T?

    init(from decoder: Decoder) throws {
        value = try? T(from: decoder)
    }
}

/// `GET /v1/kinds`.
struct HubKindsResponse: Decodable, Sendable {
    struct Kind: Decodable, Sendable {
        var kind: String
        var count: Int
    }

    var kinds: [Kind]
}

extension KeyedDecodingContainer {
    /// A cursor: a JSON number, or a string holding one ("opaque or numeric").
    func decodeFlexibleInt(forKey key: Key) throws -> Int? {
        if let n = try? decodeIfPresent(Int.self, forKey: key) { return n }
        if let d = try? decodeIfPresent(Double.self, forKey: key), d.isFinite { return Int(d) }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Int(s) }
        return nil
    }
}

// MARK: - Vectors on the wire

/// Little-endian Float32, base64 (API.md § Search and vectors).
enum HubVectorCoding {
    static func decode(_ base64: String, dim: Int? = nil) -> [Float]? {
        guard let data = Data(base64Encoded: base64), data.count % 4 == 0, !data.isEmpty else { return nil }
        let count = data.count / 4
        if let dim, dim != count { return nil }
        var floats = [Float](repeating: 0, count: count)
        data.withUnsafeBytes { raw in
            for i in 0..<count {
                let bits = raw.loadUnaligned(fromByteOffset: i * 4, as: UInt32.self)
                floats[i] = Float(bitPattern: UInt32(littleEndian: bits))
            }
        }
        return floats
    }

    static func encode(_ floats: [Float]) -> String {
        var data = Data(capacity: floats.count * 4)
        for f in floats {
            var bits = f.bitPattern.littleEndian
            withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
        }
        return data.base64EncodedString()
    }
}

// MARK: - Errors

/// The API's error codes (API.md § Conventions).
enum HubErrorCode: String, Sendable {
    case badRequest = "bad_request"
    case unauthorized
    case forbidden
    case notFound = "not_found"
    case conflict
    case tooLarge = "too_large"
    case unprocessable
    case rateLimited = "rate_limited"
    case unavailable
    case other

    init(status: Int, code: String?) {
        if let code, let known = HubErrorCode(rawValue: code) {
            self = known
            return
        }
        switch status {
        case 400: self = .badRequest
        case 401: self = .unauthorized
        case 403: self = .forbidden
        case 404: self = .notFound
        case 409: self = .conflict
        case 413: self = .tooLarge
        case 422: self = .unprocessable
        case 429: self = .rateLimited
        case 503: self = .unavailable
        default: self = .other
        }
    }
}

/// A non-2xx answer.
struct HubAPIError: Error, Sendable {
    var status: Int
    var code: HubErrorCode
    var message: String
    /// 422: the blobs the hub lacks.
    var missing: [String]
    /// 409: the stored record.
    var current: HubRecord?
    /// `Retry-After` of a 429 or 503, seconds.
    var retryAfter: Double?

    init(status: Int, body: HubErrorBody?, retryAfter: Double? = nil) {
        self.status = status
        code = HubErrorCode(status: status, code: body?.code)
        message = body?.message ?? HTTPURLResponse.localizedString(forStatusCode: status)
        missing = body?.missing ?? []
        current = body?.current
        self.retryAfter = retryAfter
    }

    /// Reads an error answer's body (`{ "error": { … } }`), tolerating anything else.
    init(status: Int, data: Data, retryAfter: Double? = nil) {
        let body = try? HubJSON.decoder.decode(HubErrorEnvelope.self, from: data).error
        self.init(status: status, body: body, retryAfter: retryAfter)
    }
}

/// Everything a `HubClient` call throws.
enum HubError: Error, Sendable, LocalizedError {
    /// The address is not an http(s) URL.
    case invalidAddress(String)
    /// The call needs a token and the device is not paired.
    case notPaired
    /// The hub cannot be reached (no network, connection refused, timed out, lost).
    case offline(URLError)
    /// A blob transfer may not use the cellular network (the "Upload media on cellular" setting).
    case cellularNotAllowed
    /// Another transport failure (TLS, bad server response …).
    case transport(URLError)
    /// The hub answered with an error.
    case api(HubAPIError)
    /// The hub's answer did not decode.
    case decoding(String)
    /// A downloaded blob is not the bytes its hash names.
    case hashMismatch(expected: String, actual: String)
    /// A local file could not be read or written.
    case file(String)
    case cancelled

    var code: HubErrorCode? {
        if case .api(let error) = self { error.code } else { nil }
    }

    var isUnauthorized: Bool { code == .unauthorized }

    /// Worth trying again later by itself (network, hub restarting, worker away, rate limit, 5xx).
    var isTransient: Bool {
        switch self {
        case .offline, .transport, .cellularNotAllowed: true
        case .api(let error): error.status >= 500 || error.code == .rateLimited
        default: false
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidAddress(let text): "“\(text)” is not a hub address"
        case .notPaired: "This device is not paired with a hub"
        case .offline: "Can’t reach the hub"
        case .cellularNotAllowed: "Waiting for Wi-Fi to upload media"
        case .transport(let error): error.localizedDescription
        case .api(let error):
            switch error.code {
            case .unauthorized: "The hub revoked this device"
            case .notFound where error.message.isEmpty: "Not found"
            case .rateLimited: "Too many attempts; try again in a minute"
            case .unavailable: "The hub’s search worker is not connected"
            default: error.message
            }
        case .decoding(let what): "Unexpected answer from the hub (\(what))"
        case .hashMismatch: "A downloaded file was damaged"
        case .file(let what): what
        case .cancelled: "Cancelled"
        }
    }

    /// Maps any error from URLSession, decoding or files to a `HubError`.
    static func from(_ error: any Error) -> HubError {
        if let error = error as? HubError { return error }
        if error is CancellationError { return .cancelled }
        if let error = error as? URLError {
            if error.code == .cancelled { return .cancelled }
            if error.networkUnavailableReason == .cellular { return .cellularNotAllowed }
            switch error.code {
            case .notConnectedToInternet, .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost,
                 .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .callIsActive:
                return .offline(error)
            default:
                return .transport(error)
            }
        }
        if error is DecodingError { return .decoding(String(describing: error).prefix(200).description) }
        if let error = error as? HubAPIError { return .api(error) }
        return .file(error.localizedDescription)
    }
}

// MARK: - What people type

/// A hub address as typed ("192.168.1.20", "studio.local:8787", "http://localhost:8787/") made into the base URL.
enum HubAddress {
    /// The hub's default port, assumed when an address has neither scheme nor port.
    static let defaultPort = 8787

    static func normalize(_ text: String) -> URL? {
        var text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !text.contains(" ") else { return nil }
        let hadScheme = text.contains("://")
        if !hadScheme { text = "http://" + text }
        guard var components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = components.host, !host.isEmpty else { return nil }
        components.scheme = scheme
        if components.port == nil && !hadScheme { components.port = defaultPort }
        var path = components.path
        while path.hasSuffix("/") { path.removeLast() }
        if path.hasSuffix("/v1") { path.removeLast(3) }
        components.path = path
        components.query = nil
        components.fragment = nil
        components.user = nil
        components.password = nil
        return components.url
    }

    /// The address as people read it: "192.168.1.20:8787", "https://hub.example.com".
    static func display(_ url: URL) -> String {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
        if components.scheme == "http" {
            components.scheme = nil
            let text = components.string ?? url.absoluteString
            return text.hasPrefix("//") ? String(text.dropFirst(2)) : text
        }
        return url.absoluteString
    }

    /// Just the host, for "Pair with Fractonica Hub at 192.168.1.20?".
    static func host(_ url: URL) -> String { url.host() ?? display(url) }
}

/// Pairing codes: 8 characters from `23456789ABCDEFGHJKMNPQRSTVWXYZ`, shown `XXXX-XXXX`, typed in any case with or
/// without the dash and spaces.
enum HubPairingCode {
    static let alphabet = Set("23456789ABCDEFGHJKMNPQRSTVWXYZ")
    static let length = 8

    /// The code's characters as the hub wants them (uppercase, no dash), dropping anything outside the alphabet.
    static func characters(_ text: String) -> String {
        String(text.uppercased().filter { alphabet.contains($0) }.prefix(length))
    }

    /// `K7QF-2MXD` as the person types it: uppercase, the dash after four characters.
    static func formatted(_ text: String) -> String {
        let chars = characters(text)
        guard chars.count > 4 else { return chars }
        return "\(chars.prefix(4))-\(chars.dropFirst(4))"
    }

    static func isComplete(_ text: String) -> Bool { characters(text).count == length }
}
