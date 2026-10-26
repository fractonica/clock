import Foundation

// The hub sync layer: request building, decoding API.md's examples, addresses and pairing codes, the vector index,
// the Keychain, and the sync engine against Checks/mockhub.mjs (Node) with HubDemoStore as the journal's store.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Journal/Hub/Checks

@main @MainActor
struct HubChecks {
    static func main() async {
        requestChecks()
        decodingChecks()
        addressChecks()
        await vectorIndexChecks()
        ledgerChecks()
        keychainChecks()
        await engineChecks()
        Checks.finish()
    }
}

// MARK: - Requests

@MainActor
private func requestChecks() {
    let base = URL(string: "http://192.168.1.20:8787")!
    let builder = HubRequestBuilder(base: base, token: "fxh_secret")

    let info = builder.request(.info)
    check(info.url?.absoluteString == "http://192.168.1.20:8787/v1", "GET /v1: \(String(describing: info.url))")
    check(info.httpMethod == "GET", "info is a GET")
    check(info.value(forHTTPHeaderField: "Authorization") == nil, "GET /v1 carries no token")

    let pair = try! builder.request(.pair, json: HubPairRequest(code: "K7QF2MXD", name: "iPhone 17 Pro", platform: "iOS 26.1", device: "6F1C"))
    check(pair.httpMethod == "POST" && pair.url?.path == "/v1/pair", "POST /v1/pair")
    check(pair.value(forHTTPHeaderField: "Authorization") == nil, "pairing carries no token")
    check(pair.value(forHTTPHeaderField: "Content-Type") == "application/json; charset=utf-8", "JSON content type")
    let pairBody = try! JSONSerialization.jsonObject(with: pair.httpBody!) as! [String: Any]
    check(pairBody["code"] as? String == "K7QF2MXD" && pairBody["kind"] as? String == "device"
          && pairBody["device"] as? String == "6F1C" && pairBody["platform"] as? String == "iOS 26.1",
          "pair body: \(pairBody)")

    let me = builder.request(.me)
    check(me.value(forHTTPHeaderField: "Authorization") == "Bearer fxh_secret", "authorized calls send the bearer token")

    let changes = builder.request(.changes(after: 1042, limit: 500, wait: 25, kinds: ["journal.*"]))
    let items = URLComponents(url: changes.url!, resolvingAgainstBaseURL: false)!.queryItems!
    check(changes.url?.path == "/v1/changes", "changes path")
    check(items.contains(URLQueryItem(name: "after", value: "1042")) && items.contains(URLQueryItem(name: "limit", value: "500"))
          && items.contains(URLQueryItem(name: "wait", value: "25")) && items.contains(URLQueryItem(name: "kind", value: "journal.*")),
          "changes query: \(items)")
    check(changes.timeoutInterval >= 55, "a long poll waits longer than its wait: \(changes.timeoutInterval)")
    let clamped = builder.request(.changes(after: 0, wait: 90))
    check(clamped.url!.query!.contains("wait=30"), "wait is clamped to 30 s: \(clamped.url!)")

    let put = builder.request(.putRecord("cpu:studio:1791460800"))
    check(put.httpMethod == "PUT" && put.url?.absoluteString == "http://192.168.1.20:8787/v1/records/cpu:studio:1791460800",
          "record ids keep their colons: \(put.url!)")
    let odd = builder.request(.putRecord("a/b c"))
    check(odd.url?.absoluteString.hasSuffix("/v1/records/a%2Fb%20c") == true, "anything else in an id is escaped: \(odd.url!)")

    let hash = "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"
    check(builder.request(.blob(hash, method: "PUT")).url?.path == "/v1/blobs/\(hash)", "blob path")
    check(builder.url(.thumbnail(hash, px: 4000)).absoluteString == "http://192.168.1.20:8787/v1/blobs/\(hash)?thumb=2048",
          "thumb is clamped to 2048")
    check(builder.url(.thumbnail(hash, px: 10)).query == "thumb=64", "thumb is clamped to 64")
    check(builder.url(.vectors(after: 88, dim: 256, limit: 2000)).query == "after=88&dim=256&limit=2000", "vectors query")

    let prefixed = HubRequestBuilder(base: URL(string: "https://example.com/hub")!, token: nil)
    check(prefixed.url(.info).absoluteString == "https://example.com/hub/v1", "a base path is kept: \(prefixed.url(.info))")

    let unpaired = HubClient(base: base)
    check(unpaired.thumbnailURL(hash: hash, px: 256).absoluteString.hasSuffix("?thumb=256"), "thumbnailURL")
    let authed = HubClient(base: base, token: "t").authorizedRequest(unpaired.thumbnailURL(hash: hash, px: 256))
    check(authed.value(forHTTPHeaderField: "Authorization") == "Bearer t", "authorizedRequest adds the token")

    let embed = try! JSONSerialization.jsonObject(with: try! HubJSON.encoder.encode(HubEmbedRequest(inputs: ["moon"], task: "query", dim: 256))) as! [String: Any]
    check(embed["dim"] as? Int == 256 && embed["task"] as? String == "query" && (embed["inputs"] as? [String]) == ["moon"], "embed body")

    // A record without the hub's fields encodes without them (no nulls the hub would have to ignore).
    let record = HubRecord(id: "r1", kind: "journal.entry", time: 1, end: nil, zone: nil, data: .object(["markdown": .string("x")]),
                           text: nil, tags: nil, blobs: nil, created: 1, updated: 2, deleted: nil, source: nil, editor: nil, rev: nil, fx: nil)
    let encoded = try! JSONSerialization.jsonObject(with: try! HubJSON.encoder.encode(record)) as! [String: Any]
    check(Set(encoded.keys) == ["id", "kind", "time", "data", "created", "updated"], "an unsent record encodes only its fields: \(encoded.keys.sorted())")
}

// MARK: - Decoding API.md's examples

private let recordExample = """
{
  "id": "0b6c1d0e-6a3e-4c1e-9c55-0d1f9f8f2a11",
  "kind": "journal.entry",
  "time": 1791460800.25,
  "end": null,
  "zone": "Europe/Kyiv",
  "data": { "emoji": "🌙", "title": "Night walk", "markdown": "Saw the **moon** rise…" },
  "text": null,
  "tags": ["walk"],
  "blobs": [
    { "hash": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b", "type": "image/heic",
      "size": 1834221, "role": "photo", "width": 4032, "height": 3024 },
    { "hash": "…", "type": "audio/mp4", "size": 412001, "role": "audio", "duration": 61.4 },
    { "hash": "…", "type": "video/quicktime", "size": 22014411, "role": "video", "duration": 12.0,
      "width": 1920, "height": 1080, "poster": "…hash of a jpeg also listed with role poster…" }
  ],
  "created": 1791460800.25,
  "updated": 1791460912.8,
  "deleted": false,

  "source": "c_01K8…",
  "editor": "c_01K8…",
  "rev": 1042,
  "fx": { "stamp": "…", "clock": "34η 29ι 21λ" }
}
"""

@MainActor
private func decodingChecks() {
    func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
        do { return try HubJSON.decoder.decode(T.self, from: Data(json.utf8)) } catch {
            print("decode \(T.self): \(error)")
            return nil
        }
    }

    let info = decode(HubInfo.self, """
    { "hub": { "id": "h_01K8", "name": "Fractonica Hub", "version": "1.0.0" }, "api": 1,
      "embedding": { "model": "google/embeddinggemma-2", "dim": 768, "dims": [768,512,256,128], "worker": true } }
    """)
    check(info?.hub.name == "Fractonica Hub" && info?.workerConnected == true && info?.embedding?.dims == [768, 512, 256, 128],
          "GET /v1 decodes: \(String(describing: info))")
    let noWorker = decode(HubInfo.self, #"{ "hub": { "id": "h", "name": "n" }, "future": { "x": 1 } }"#)
    check(noWorker?.workerConnected == false, "unknown fields are ignored, a missing embedding means no worker")

    let pair = decode(HubPairResponse.self, """
    { "client": { "id": "c_01K8…", "name": "iPhone 17 Pro", "kind": "device", "scopes": ["read","write","search"], "kinds": ["*"] },
      "token": "fxh_…",
      "hub": { "id": "h_01K8…", "name": "Fractonica Hub", "version": "1.0.0" } }
    """)
    check(pair?.token == "fxh_…" && pair?.client.scopes == ["read", "write", "search"] && pair?.hub.id == "h_01K8…", "pair response decodes")

    let record = decode(HubRecord.self, recordExample)
    check(record?.rev == 1042 && record?.blobs?.count == 3 && record?.blobs?[2].poster != nil && record?.fx?.clock == "34η 29ι 21λ",
          "the record example decodes")
    check(record?.entry?.emoji == "🌙" && record?.entry?.title == "Night walk", "its journal entry reads")
    check(record?.isDeleted == false && record?.end == nil, "deleted false, end null")

    let changes = decode(HubChangesPage.self, #"{ "changes": [\#(recordExample)], "cursor": 1042, "more": false }"#)
    check(changes?.changes.count == 1 && changes?.cursor == 1042 && changes?.more == false, "a changes page decodes")
    let stringCursor = decode(HubChangesPage.self, #"{ "changes": [], "cursor": "77", "more": true }"#)
    check(stringCursor?.cursor == 77 && stringCursor?.more == true, "a cursor sent as a string decodes")

    let batch = decode(HubBatchResponse.self, """
    { "results": [ { "id": "a", "status": 201, "record": { } },
                   { "id": "b", "status": 409, "error": { "code": "conflict", "details": { "current": \(recordExample) } } },
                   { "id": "c", "status": 422, "error": { "code": "unprocessable", "message": "missing blobs", "details": { "missing": ["ab12"] } } } ] }
    """)
    check(batch?.results.count == 3, "the batch example decodes (with placeholder records)")
    check(batch?.results[0].status == 201 && batch?.results[0].record == nil, "a placeholder record is nil, not a failure")
    check(batch?.results[1].error?.current?.rev == 1042, "409 details.current decodes")
    check(batch?.results[2].error?.missing == ["ab12"], "422 details.missing decodes")

    let error = HubAPIError(status: 409, data: Data(#"{ "error": { "code": "conflict", "message": "human readable", "details": { } } }"#.utf8))
    check(error.code == .conflict && error.message == "human readable" && error.current == nil, "the error envelope decodes")
    let bare = HubAPIError(status: 503, data: Data("Service Unavailable".utf8), retryAfter: 30)
    check(bare.code == .unavailable && bare.retryAfter == 30, "a non-JSON error maps by status")
    check(HubErrorCode(status: 418, code: "teapot") == .other, "an unknown code is .other")
    check(HubError.api(HubAPIError(status: 401, body: nil)).isUnauthorized, "401 is unauthorized")
    check(HubError.from(URLError(.cannotConnectToHost)).isTransient, "refused connections are transient")
    if case .offline = HubError.from(URLError(.timedOut)) {} else { check(false, "a timeout is offline") }

    let vector = HubVectorCoding.encode([1, -0.5, 0.25, 0])
    check(HubVectorCoding.decode(vector) == [1, -0.5, 0.25, 0], "little-endian float32 base64 round trip")
    check(Data(base64Encoded: vector)!.first == 0x00 && Data(base64Encoded: vector)![3] == 0x3F, "1.0 is 00 00 80 3F on the wire")
    check(HubVectorCoding.decode(vector, dim: 3) == nil, "a vector of the wrong dim is refused")
    check(HubVectorCoding.decode("<base64>") == nil, "a placeholder is not a vector")

    let vectors = decode(HubVectorsPage.self, """
    { "model": "google/embeddinggemma-2", "dim": 256,
      "vectors": [ { "record": "0b6c…", "part": "record", "vector": "<base64>", "vrev": 88 },
                   { "record": "9f00…", "part": null, "vector": null, "vrev": 89 } ],
      "cursor": 89, "more": false }
    """)
    check(vectors?.vectors.count == 2 && vectors?.vectors[1].isForget == true && vectors?.cursor == 89, "the vector feed example decodes")

    let search = decode(HubSearchResponse.self, """
    { "mode": "semantic",
      "results": [ { "record": { }, "score": 0.71, "part": "record" },
                   { "record": \(recordExample), "score": 0.64, "part": "blob:3a7b…" } ] }
    """)
    check(search?.mode == "semantic" && search?.results.count == 1 && search?.results[0].score == 0.64,
          "search decodes, leaving out undecodable results")

    let embed = decode(HubEmbedResponse.self, #"{ "model": "google/embeddinggemma-2", "dim": 4, "vectors": ["\#(vector)"] }"#)
    check(embed?.floats.first??.count == 4, "embed vectors decode at their dim")
}

// MARK: - Addresses and codes

@MainActor
private func addressChecks() {
    func n(_ s: String) -> String? { HubAddress.normalize(s)?.absoluteString }
    check(n("192.168.1.20") == "http://192.168.1.20:8787", "a bare IP gets http and the default port: \(String(describing: n("192.168.1.20")))")
    check(n(" studio.local:9000 ") == "http://studio.local:9000", "host:port")
    check(n("http://localhost:8787/") == "http://localhost:8787", "trailing slash")
    check(n("http://localhost:8787/v1") == "http://localhost:8787", "a pasted /v1 is dropped")
    check(n("https://hub.example.com") == "https://hub.example.com", "https without a port keeps 443")
    check(n("http://myhub.local") == "http://myhub.local", "an explicit scheme without a port keeps 80")
    check(n("ftp://x") == nil && n("") == nil && n("not a url") == nil, "garbage is refused")
    check(HubAddress.display(URL(string: "http://192.168.1.20:8787")!) == "192.168.1.20:8787", "display drops http://")
    check(HubAddress.display(URL(string: "https://hub.example.com")!) == "https://hub.example.com", "display keeps https://")

    check(HubPairingCode.formatted("k7qf2mxd") == "K7QF-2MXD", "codes format XXXX-XXXX")
    check(HubPairingCode.formatted("K7Q") == "K7Q", "a partial code has no dash yet")
    check(HubPairingCode.formatted("k7qf 2mxd-extra") == "K7QF-2MXD", "spaces, dashes and overflow are dropped")
    check(HubPairingCode.characters("K7QF-2MX0") == "K7QF2MX", "characters outside the alphabet (0, 1, I, L, O, U) are dropped")
    check(HubPairingCode.isComplete("k7qf-2mxd") && !HubPairingCode.isComplete("K7QF-2MX"), "completeness")
}

// MARK: - Vector index

@MainActor
private func vectorIndexChecks() async {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vi-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: dir) }
    func unit(_ i: Int, dim: Int = 4) -> [Float] { (0..<dim).map { $0 == i ? 1 : 0 } }
    func entry(_ record: String, _ part: String?, _ v: [Float]?, _ vrev: Int) -> HubVectorsPage.Entry {
        HubVectorsPage.Entry(record: record, part: part, vector: v.map(HubVectorCoding.encode), vrev: vrev)
    }

    func facts(_ index: VectorIndex) async -> (count: Int, cursor: Int, model: String?) {
        (await index.count, await index.cursor, await index.model)
    }

    let index = VectorIndex(directory: dir, dim: 4)
    await index.load()
    var f = await facts(index)
    check(f.count == 0 && f.cursor == 0, "a new index is empty")
    var applied = await index.apply(HubVectorsPage(model: "m1", dim: 4, vectors: [
        entry("a", "record", unit(0), 1), entry("a", "blob:x", unit(1), 2), entry("b", "record", [0.6, 0.8, 0, 0], 3),
        entry("c", "record", [2, 0, 0, 0], 4),       // not normalised: the index normalises
        entry("d", "record", [1, 2, 3], 5),          // wrong dim: skipped
    ], cursor: 5, more: false))
    f = await facts(index)
    check(applied && f.count == 4 && f.cursor == 5 && f.model == "m1", "a page applies: \(f)")
    var ranked = await index.rank(unit(1))
    check(ranked["a"] == 1 && abs((ranked["b"] ?? 0) - 0.8) < 1e-6 && ranked["c"] == 0, "a record scores its best part: \(ranked)")
    ranked = await index.rank(unit(0), limit: 2)
    check(ranked.count == 2 && ranked["a"] == 1 && ranked["c"] == 1, "limit keeps the best: \(ranked)")

    // A changed record: forget, then its new vectors (same page); a deleted one: forget only.
    applied = await index.apply(HubVectorsPage(model: "m1", dim: 4, vectors: [
        entry("a", nil, nil, 6), entry("a", "record", unit(2), 7), entry("b", nil, nil, 8),
    ], cursor: 8, more: false))
    let partsA = await index.parts(of: "a")
    let partsB = await index.parts(of: "b")
    check(partsA == ["record"], "a forget drops the old parts, new ones follow: \(partsA)")
    check(partsB.isEmpty, "a forget alone drops the record")
    ranked = await index.rank(unit(2))
    check(ranked["a"] == 1 && ranked["b"] == nil, "ranking follows: \(ranked)")

    // Forget in one page, new vectors in the next.
    await index.apply(HubVectorsPage(model: "m1", dim: 4, vectors: [entry("c", nil, nil, 9)], cursor: 9, more: true))
    await index.apply(HubVectorsPage(model: "m1", dim: 4, vectors: [entry("c", "record", unit(3), 10)], cursor: 10, more: false))
    let partsC = await index.parts(of: "c")
    ranked = await index.rank(unit(3))
    check(partsC == ["record"] && ranked["c"] == 1, "a forget and its new vectors across pages")

    try? await index.save()
    let reread = VectorIndex(directory: dir, dim: 4)
    await reread.load()
    f = await facts(reread)
    check(f.count == 2 && f.cursor == 10 && f.model == "m1", "the index survives a reload: \(f)")
    ranked = await reread.rank(unit(2))
    check(ranked["a"] == 1, "and ranks the same")

    // Another model: the page is refused until reset.
    let otherModel = await reread.apply(HubVectorsPage(model: "m2", dim: 4, vectors: [], cursor: 1, more: false))
    let otherDim = await reread.apply(HubVectorsPage(model: "m1", dim: 8, vectors: [], cursor: 1, more: false))
    check(!otherModel && !otherDim, "another model's or dim's page is refused")
    await reread.reset(model: "m2")
    f = await facts(reread)
    check(f.count == 0 && f.cursor == 0 && f.model == "m2", "reset starts over")

    // A damaged pair of files loads empty.
    try? Data([1, 2, 3]).write(to: dir.appendingPathComponent("vectors.f32"))
    let damaged = VectorIndex(directory: dir, dim: 4)
    await damaged.load()
    f = await facts(damaged)
    check(f.count == 0 && f.cursor == 0, "floats that do not match the table load as empty")
}

// MARK: - Media ledger

@MainActor
private func ledgerChecks() {
    func blob(_ h: String, _ role: String, _ size: Int) -> BlobRef { BlobRef(hash: h, type: "x", size: size, role: role) }
    func rec(_ id: String, _ blobs: [BlobRef], deleted: Bool = false) -> HubRecord {
        HubRecord(id: id, kind: "journal.entry", time: 1, end: nil, zone: nil, data: .object([:]), text: nil, tags: nil,
                  blobs: blobs, created: 1, updated: 1, deleted: deleted, source: nil, editor: nil, rev: nil, fx: nil)
    }
    var ledger = MediaLedger()
    // Hashes are kept lowercase, whatever case they arrive in.
    ledger.update(rec("r1", [blob("P", "photo", 3_000_000), blob("V", "video", 90_000_000), blob("S", "poster", 100_000)]))
    ledger.update(rec("r2", [blob("a", "audio", 400_000), blob("f", "file", 60_000_000), blob("p", "photo", 3_000_000)]))
    var wanted = ledger.wanted(all: false) { _ in false }.map(\.hash)
    check(wanted == ["s", "a", "p"], "posters, photos and audio eagerly, smallest first, each once: \(wanted)")
    wanted = ledger.wanted(all: true) { $0 == "a" }.map(\.hash)
    check(wanted == ["s", "p", "f", "v"], "all media, skipping what the device has: \(wanted)")
    ledger.markGone("P")
    check(!ledger.wanted(all: false) { _ in false }.map(\.hash).contains("p"), "a gone blob is not wanted")
    ledger.update(rec("r1", [], deleted: true))
    wanted = ledger.wanted(all: true) { _ in false }.map(\.hash)
    check(wanted == ["a", "f"], "a tombstone forgets its media: \(wanted)")
}

// MARK: - Keychain

@MainActor
private func keychainChecks() {
    guard ProcessInfo.processInfo.environment["FX_SKIP_KEYCHAIN"] == nil else {
        print("note: Keychain checks skipped (FX_SKIP_KEYCHAIN)")
        return
    }
    let keychain = HubKeychain(service: "app.fractonica.checks.\(UUID().uuidString)")
    defer { keychain.deleteAll() }
    check(keychain.load() == nil, "a new service has no credentials")
    let id = keychain.deviceId()
    check(UUID(uuidString: id) != nil && keychain.deviceId() == id, "the device id is made once and kept")
    let credentials = HubCredentials(hubURL: URL(string: "http://192.168.1.20:8787")!, token: "fxh_x", clientId: "c_1",
                                     clientName: "iPhone 17 Pro", hubId: "h_1", hubName: "Hub", paired: 1)
    do {
        try keychain.save(credentials)
        check(keychain.load() == credentials, "credentials round-trip through the Keychain")
        var changed = credentials
        changed.token = "fxh_y"
        try keychain.save(changed)
        check(keychain.load()?.token == "fxh_y", "saving again replaces them")
        keychain.delete()
        check(keychain.load() == nil && keychain.deviceId() == id, "unpairing deletes the credentials, not the device id")
    } catch {
        check(false, "Keychain write failed: \(error.localizedDescription)")
    }
}
