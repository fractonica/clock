import CryptoKit
import Foundation
import Synchronization

/// The hub's HTTP API (hub/API.md), one call per endpoint the app uses. A value type holding the base URL, the token
/// and a session: make one per hub and pass it anywhere (it is `Sendable`). Every call is `async`, runs off the main
/// actor and throws `HubError`.
///
///     let client = HubClient(base: URL(string: "http://192.168.1.20:8787")!)
///     let info = try await client.info()
///     let paired = try await client.pair(code: "K7QF-2MXD", name: "iPhone 17 Pro", platform: "iOS 26.1", device: id)
///     let authed = client.with(token: paired.token)
///     let page = try await authed.changes(after: 0, limit: 500)
struct HubClient: Sendable {
    let builder: HubRequestBuilder
    let session: URLSession

    init(base: URL, token: String? = nil, session: URLSession = HubClient.defaultSession) {
        builder = HubRequestBuilder(base: base, token: token)
        self.session = session
    }

    var base: URL { builder.base }

    func with(token: String?) -> HubClient { HubClient(base: base, token: token, session: session) }

    /// One session for every hub call: no cache (blobs are cached by the journal's store), fails fast when offline
    /// (the sync engine retries), up to six connections (a long poll, downloads and an upload at once).
    static let defaultSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpMaximumConnectionsPerHost = 6
        configuration.timeoutIntervalForResource = 24 * 3600
        return URLSession(configuration: configuration)
    }()

    // MARK: Hub and pairing

    /// `GET /v1`: what the hub is, and whether its embedding worker is connected. No token needed.
    func info() async throws -> HubInfo {
        try await json(builder.request(.info))
    }

    /// `POST /v1/pair`: redeems a code (any case, with or without the dash) for a token.
    func pair(code: String, name: String, platform: String, device: String) async throws -> HubPairResponse {
        let body = HubPairRequest(code: HubPairingCode.characters(code), name: name, platform: platform, device: device)
        return try await json(try builder.request(.pair, json: body))
    }

    /// `GET /v1/me`.
    func me() async throws -> HubClientInfo {
        try await json(authorized(.me))
    }

    // MARK: Records

    /// `PUT /v1/records/{id}`: the stored record (201 new, 200 replaced or unchanged). A newer stored copy throws
    /// `.api` with code `.conflict` and `current`; missing blobs throw `.unprocessable` with `missing`.
    func putRecord(_ record: HubRecord) async throws -> HubRecord {
        var request = try authorized(.putRecord(record.id))
        request.httpBody = try HubJSON.encoder.encode(record)
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        return try await json(request)
    }

    /// `POST /v1/records/batch`: up to 500 records, each decided as its own `PUT`.
    func putRecords(_ records: [HubRecord]) async throws -> [HubBatchResponse.Item] {
        var request = try authorized(.batch)
        request.httpBody = try HubJSON.encoder.encode(HubBatchRequest(records: records))
        request.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        let response: HubBatchResponse = try await json(request)
        return response.results
    }

    /// `GET /v1/records/{id}` (tombstones too).
    func record(_ id: String) async throws -> HubRecord {
        try await json(authorized(.record(id)))
    }

    /// `DELETE /v1/records/{id}`: the tombstone.
    func deleteRecord(_ id: String) async throws -> HubRecord {
        try await json(authorized(.deleteRecord(id)))
    }

    /// `GET /v1/changes`: the feed after `after`. With `wait` the hub holds the request until something changes (or
    /// answers with an empty page when the time runs out).
    func changes(after: Int, limit: Int? = nil, wait: Int? = nil, kinds: [String] = []) async throws -> HubChangesPage {
        try await json(authorized(.changes(after: after, limit: limit, wait: wait, kinds: kinds)))
    }

    /// `GET /v1/kinds`.
    func kinds() async throws -> HubKindsResponse {
        try await json(authorized(.kinds))
    }

    // MARK: Blobs

    /// `POST /v1/blobs/check`: which of `hashes` the hub lacks.
    func missingBlobs(_ hashes: [String]) async throws -> [String] {
        guard !hashes.isEmpty else { return [] }
        let request = try builder.request(.blobsCheck, json: HubBlobCheckRequest(hashes: hashes))
        let response: HubBlobCheckResponse = try await json(try authorize(request, .blobsCheck))
        return response.missing
    }

    /// `PUT /v1/blobs/{hash}`, streamed from `file`. `progress` gets (bytes sent, bytes in all) a few times a second,
    /// on a background queue. Returns true when the hub did not have it (201).
    @discardableResult
    func uploadBlob(hash: String, type: String, file: URL, allowsCellular: Bool = true,
                    progress: (@Sendable (Int64, Int64) -> Void)? = nil) async throws -> Bool {
        var request = try authorized(.blob(hash, method: "PUT"))
        request.setValue(type.isEmpty ? "application/octet-stream" : type, forHTTPHeaderField: "Content-Type")
        request.allowsCellularAccess = allowsCellular
        let delegate = progress.map(TransferProgress.init)
        do {
            let (data, response) = try await session.upload(for: request, fromFile: file, delegate: delegate)
            let http = try Self.check(data, response)
            return http.statusCode == 201
        } catch {
            throw HubError.from(error)
        }
    }

    /// `GET /v1/blobs/{hash}` to a temporary file of its own, verified against `hash` (SHA-256); the caller moves or
    /// deletes it.
    func downloadBlob(hash: String, allowsCellular: Bool = true) async throws -> URL {
        var request = try authorized(.blob(hash))
        request.allowsCellularAccess = allowsCellular
        let file: URL
        do {
            let (downloaded, response) = try await session.download(for: request)
            if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                let data = (try? Data(contentsOf: downloaded, options: .mappedIfSafe)) ?? Data()
                try? FileManager.default.removeItem(at: downloaded)
                throw HubError.api(HubAPIError(status: http.statusCode, data: data, retryAfter: Self.retryAfter(http)))
            }
            file = FileManager.default.temporaryDirectory.appendingPathComponent("hub-\(UUID().uuidString)")
            try FileManager.default.moveItem(at: downloaded, to: file)
        } catch {
            throw HubError.from(error)
        }
        let actual: String
        do {
            actual = try await Self.sha256(of: file)
        } catch {
            try? FileManager.default.removeItem(at: file)
            throw HubError.file("Could not read a downloaded file")
        }
        guard actual == hash.lowercased() else {
            try? FileManager.default.removeItem(at: file)
            throw HubError.hashMismatch(expected: hash, actual: actual)
        }
        return file
    }

    /// The URL of a hub-made preview (`?thumb=`). It needs the token: load it with `authorizedRequest(_:)` (an
    /// `AsyncImage` cannot send it) or `thumbnail(hash:px:)`.
    func thumbnailURL(hash: String, px: Int) -> URL {
        builder.url(.thumbnail(hash, px: px))
    }

    /// `url` (one of this hub's) with the bearer token.
    func authorizedRequest(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
        if let token = builder.token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return request
    }

    /// A JPEG preview whose long side is at most `px`; `.api` `.notFound` when the hub cannot make one (fall back to
    /// the blob or its poster).
    func thumbnail(hash: String, px: Int) async throws -> Data {
        let (data, _) = try await send(try authorized(.thumbnail(hash, px: px)))
        return data
    }

    // MARK: Search

    /// `POST /v1/embed`: query or document vectors at `dim`. `.api` `.unavailable` (503) when no worker is connected.
    func embed(_ inputs: [String], task: String = "query", dim: Int = 256) async throws -> HubEmbedResponse {
        let request = try builder.request(.embed, json: HubEmbedRequest(inputs: inputs, task: task, dim: dim))
        return try await json(try authorize(request, .embed))
    }

    /// `GET /v1/vectors`: the vector feed after `after`.
    func vectors(after: Int, dim: Int = 256, limit: Int? = nil, kinds: [String] = []) async throws -> HubVectorsPage {
        try await json(authorized(.vectors(after: after, dim: dim, limit: limit, kinds: kinds)))
    }

    /// `POST /v1/search`: the hub ranks (semantic when its worker is connected, else keyword).
    func search(_ query: HubSearchRequest) async throws -> HubSearchResponse {
        let request = try builder.request(.search, json: query)
        return try await json(try authorize(request, .search))
    }

    // MARK: Plumbing

    private func authorized(_ endpoint: HubEndpoint) throws -> URLRequest {
        try authorize(builder.request(endpoint), endpoint)
    }

    private func authorize(_ request: URLRequest, _ endpoint: HubEndpoint) throws -> URLRequest {
        if endpoint.authorized && builder.token == nil { throw HubError.notPaired }
        return request
    }

    private func json<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, _) = try await send(request)
        do {
            return try HubJSON.decoder.decode(T.self, from: data)
        } catch {
            throw HubError.decoding("\(T.self)")
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            return (data, try Self.check(data, response))
        } catch {
            throw HubError.from(error)
        }
    }

    private static func check(_ data: Data, _ response: URLResponse) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse else { throw HubError.decoding("not HTTP") }
        guard (200..<300).contains(http.statusCode) else {
            throw HubError.api(HubAPIError(status: http.statusCode, data: data, retryAfter: retryAfter(http)))
        }
        return http
    }

    private static func retryAfter(_ response: HTTPURLResponse) -> Double? {
        response.value(forHTTPHeaderField: "Retry-After").flatMap(Double.init)
    }

    /// The lowercase hex SHA-256 of a file, read in 1 MB pieces off the main actor.
    @concurrent
    static func sha256(of file: URL) async throws -> String {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

/// Reports an upload's bytes to a closure, at most ten times a second (and always the last).
private final class TransferProgress: NSObject, URLSessionTaskDelegate, Sendable {
    private let report: @Sendable (Int64, Int64) -> Void
    private let last = Mutex<ContinuousClock.Instant?>(nil)

    init(_ report: @escaping @Sendable (Int64, Int64) -> Void) {
        self.report = report
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                    totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        let now = ContinuousClock.now
        let due = last.withLock { last in
            if let previous = last, now - previous < .milliseconds(100), totalBytesSent < totalBytesExpectedToSend {
                return false
            }
            last = now
            return true
        }
        if due { report(totalBytesSent, totalBytesExpectedToSend) }
    }
}
