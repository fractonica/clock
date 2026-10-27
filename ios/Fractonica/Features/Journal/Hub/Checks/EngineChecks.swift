import CryptoKit
import Foundation

// The sync engine against the mock hub: two devices (each an engine with its own HubDemoStore) and the scenarios of
// hub/API.md — pairing, push with blob check and upload, 409 adoption, 422 retry, pull paging, tombstones, cursor
// persistence, long poll, debounced local saves, the vector feed (forget entries, model change), semantic search,
// on-demand media with hash verification, hub restarts, revocation and re-pairing, and pairing with another hub.

@MainActor
func engineChecks() async {
    guard let hub = MockHub(codes: ["K7QF-2MXD", "AAAA-BBBB"]), hub.start() else {
        print("note: engine checks skipped (Node or Checks/mockhub.mjs not found)")
        return
    }
    defer { hub.cleanUp() }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("hubchecks-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }

    // ---- device A: three local entries before any hub exists
    let storeA = HubDemoStore(directory: root.appendingPathComponent("A/store"))
    let photo = try! storeA.addBlob(HubDemoStore.photo(seed: 1, size: CGSize(width: 800, height: 600))!, type: "image/jpeg", role: "photo")
    let poster = try! storeA.addBlob(HubDemoStore.photo(seed: 2, size: CGSize(width: 640, height: 360))!, type: "image/jpeg", role: "poster")
    var video = try! storeA.addBlob(HubDemoStore.noise(3_000_000), type: "video/quicktime", role: "video")
    video.poster = poster.hash
    let audio = try! storeA.addBlob(HubDemoStore.noise(200_000), type: "audio/mp4", role: "audio")
    let t0 = Date.now.timeIntervalSince1970 - 1000
    storeA.write(entry("moon", "🌙", "Saw the moon rise over the river", t0, blobs: [photo, video, poster]))
    storeA.write(entry("coffee", "☕️", "Coffee on the balcony, the city quiet", t0 + 1, blobs: [audio]))
    storeA.write(entry("ridge", "🏔️", "Climbed to the ridge before the storm", t0 + 2))

    let engineA = makeEngine(root.appendingPathComponent("A"), device: "DEVICE-A")
    engineA.attach(storeA)
    check(engineA.status == .unpaired && engineA.pendingCount == 3, "unpaired, three entries pending: \(engineA.status)")

    // ---- address check and pairing
    guard let (url, info) = try? await engineA.checkAddress("127.0.0.1:\(hub.port)") else {
        check(false, "the address check reaches the mock hub")
        return
    }
    check(info.hub.name == "Checks Hub" && info.workerConnected, "GET /v1 through checkAddress: \(info)")
    do {
        try await engineA.pair(url: url, code: "ZZZZ-ZZZZ", name: "A")
        check(false, "a wrong code fails")
    } catch {
        check(HubError.from(error).code == .notFound, "a wrong code is 404: \(error)")
    }
    let pairedA: HubPairResponse
    do {
        pairedA = try await engineA.pair(url: url, code: "k7qf2mxd", name: "Checks iPhone")
    } catch {
        check(false, "pairing works: \(error)")
        return
    }
    check(engineA.isPaired && engineA.credentials?.clientName == "Checks iPhone", "paired")
    await engineA.syncNow()

    var state = await hub.state()
    check(engineA.status == .idle && storeA.pending.isEmpty && engineA.pendingCount == 0, "everything went up: \(engineA.status), \(storeA.pending)")
    check(Set(state["blobs"] as? [String] ?? []) == [photo.hash, poster.hash, video.hash, audio.hash], "all four blobs uploaded")
    check(state["records"] as? Int == 3, "three records on the hub")
    check(storeA.records["moon"]?.source == pairedA.client.id && storeA.records["moon"]?.rev != nil,
          "the hub's copy (source, rev) is kept: \(String(describing: storeA.records["moon"]?.source))")
    check(storeA.changeCursor == state["rev"] as? Int, "the change cursor caught up: \(storeA.changeCursor)")
    check(engineA.vectorRecordCount == 3 && storeA.vectorCursor == state["vrev"] as? Int, "vectors for all three: \(engineA.vectorRecordCount)")
    check(engineA.lastSync != nil && engineA.hubEntryCount == 3, "last sync and counts")

    // ---- semantic search
    let searchA = SemanticSearch(engine: engineA)
    if let scores = await searchA.search("moon river") {
        let best = scores.max { $0.value < $1.value }?.key
        check(best == "moon", "the moon entry ranks first: \(scores)")
    } else {
        check(false, "semantic search answers while the worker is connected")
    }
    check(await searchA.search("   ") == nil, "an empty query has no semantic answer")

    // ---- device B: a new device loads everything
    let storeB = HubDemoStore(directory: root.appendingPathComponent("B/store"))
    let engineB = makeEngine(root.appendingPathComponent("B"), device: "DEVICE-B")
    engineB.attach(storeB)
    _ = try? await engineB.pair(url: url, code: "AAAA-BBBB", name: "Checks Mac")
    await engineB.backgroundSync()
    check(storeB.entries.count == 3, "a new device pulls every entry: \(storeB.entries.count)")
    check(storeB.blobFile(photo.hash) != nil && storeB.blobFile(audio.hash) != nil && storeB.blobFile(poster.hash) != nil,
          "photos, audio and posters download eagerly")
    check(storeB.blobFile(video.hash) == nil, "videos wait until asked for")
    if let file = try? await engineB.ensureBlob(video.hash) {
        check(sha256(file) == video.hash, "ensureBlob downloads and verifies the video")
    } else {
        check(false, "ensureBlob downloads the video")
    }
    check(storeB.records["moon"]?.source == pairedA.client.id, "B sees A as the source")

    // ---- 409: B edits later, A edits with an older clock; A adopts B's
    if var edited = storeB.records["ridge"] {
        edited.data = JournalEntry(emoji: "🏔️", markdown: "Edited on the Mac").data
        edited.updated = t0 + 500
        storeB.write(edited)
        await engineB.syncNow()
    }
    if var stale = storeA.records["ridge"] {
        stale.data = JournalEntry(emoji: "🏔️", markdown: "Edited on the phone, earlier").data
        stale.updated = t0 + 400
        storeA.write(stale)
    }
    await engineA.syncNow()
    check(storeA.records["ridge"]?.entry?.markdown == "Edited on the Mac" && storeA.pending.isEmpty,
          "a 409 adopts the hub's newer copy: \(String(describing: storeA.records["ridge"]?.entry?.markdown))")

    // ---- a tie: same `updated`, other content on each device; both end with the hub's choice
    storeB.write(entry("tie", "🪢", "Tie written on the Mac", t0 + 600))
    storeA.write(entry("tie", "🪢", "Tie written on the phone", t0 + 600))
    await engineB.syncNow()
    await engineA.syncNow()
    await engineB.syncNow()
    let hubTie = try? await engineA.client!.record("tie")
    check(hubTie != nil && storeA.records["tie"]?.entry == hubTie?.entry && storeB.records["tie"]?.entry == hubTie?.entry
          && storeA.pending.isEmpty && storeB.pending.isEmpty,
          "a tie converges on the hub's copy and leaves nothing pending: \(String(describing: hubTie?.entry?.markdown))")

    // ---- 422: the blob check says nothing is missing; the batch says otherwise; the engine uploads and retries
    let late = try! storeA.addBlob(HubDemoStore.photo(seed: 9, size: CGSize(width: 300, height: 200))!, type: "image/jpeg", role: "photo")
    storeA.write(entry("late", "📷", "A photo the hub has not seen", t0 + 3, blobs: [late]))
    await hub.control("_mock/lie", ["count": 1])
    await engineA.syncNow()
    state = await hub.state()
    check((state["blobs"] as? [String] ?? []).contains(late.hash) && storeA.pending.isEmpty && engineA.problem == nil,
          "a 422 uploads the missing blob and retries: pending \(storeA.pending), problem \(String(describing: engineA.problem))")

    // ---- pull paging: B writes 1,203 entries through the API, A reads them 500 at a time
    let clientB = engineB.client!
    var bulk: [HubRecord] = []
    for i in 0..<1203 { bulk.append(entry("bulk-\(i)", "·", "Bulk entry number \(i)", t0 + 10 + Double(i))) }
    for chunk in bulk.hubChunks(of: 500) { _ = try? await clientB.putRecords(chunk) }
    await engineA.syncNow()
    state = await hub.state()
    check(storeA.entries.count == 1208, "1,203 more entries pulled in pages: \(storeA.entries.count)")
    check(storeA.changeCursor == state["rev"] as? Int, "the cursor is the hub's last rev")

    // ---- tombstones: B deletes the moon entry; A drops it, its media and its vectors
    _ = try? await clientB.deleteRecord("moon")
    await engineA.syncNow()
    check(storeA.records["moon"]?.isDeleted == true && !storeA.entries.contains { $0.id == "moon" }, "a tombstone removes the entry")
    check(storeA.blobFile(photo.hash) == nil && storeA.blobFile(video.hash) == nil, "and its media")
    check(await engineA.vectors.parts(of: "moon").isEmpty, "and its vectors (a forget entry)")

    // ---- cursors persist with the store
    let reopened = HubDemoStore(directory: root.appendingPathComponent("A/store"))
    check(reopened.changeCursor == storeA.changeCursor && reopened.vectorCursor == storeA.vectorCursor && reopened.entries.count == storeA.entries.count,
          "the store reopens at its cursors")

    // ---- long poll: B writes, A has it within a moment, without a pass
    engineA.becameActive()
    try? await Task.sleep(for: .milliseconds(300))
    _ = try? await clientB.putRecord(entry("live", "⚡️", "Written while A watches", t0 + 5000))
    check(await eventually { storeA.records["live"] != nil }, "the long poll brings B's entry in")
    engineA.enteredBackground()

    // ---- a local save syncs a moment later by itself
    storeA.write(entry("debounced", "✍️", "Saved on A", t0 + 6000))
    engineA.localChanged()
    check(await eventually {
        guard storeA.pending.isEmpty else { return false }
        return (try? await clientB.record("debounced")) != nil
    },
          "localChanged syncs after its delay")

    // ---- worker away: no semantic answer
    await hub.control("_mock/worker", ["connected": false])
    check(await SemanticSearch(engine: engineA).search("storm ridge") == nil, "no worker: search returns nil (keyword fallback)")
    await hub.control("_mock/worker", ["connected": true])

    // ---- the hub's model changes: the vector feed restarts, the index starts over
    let before = engineA.vectorRecordCount
    await hub.control("_mock/model", ["model": "checks/other-model"])
    await engineA.syncNow()
    state = await hub.state()
    let model = await engineA.vectors.model
    check(model == "checks/other-model" && engineA.vectorRecordCount == before && before == state["live"] as? Int
          && storeA.vectorCursor == state["vrev"] as? Int,
          "a model change rebuilds the index: \(String(describing: model)) \(engineA.vectorRecordCount) vs \(before)")

    // ---- hash verification
    let clip = try! storeB.addBlob(HubDemoStore.noise(500_000), type: "video/mp4", role: "video")
    storeB.write(entry("clip", "🎬", "A clip", t0 + 7000, blobs: [clip]))
    await engineB.syncNow()
    await engineA.syncNow()
    await hub.control("_mock/corrupt", ["hash": clip.hash])
    do {
        _ = try await engineA.ensureBlob(clip.hash)
        check(false, "a damaged download is refused")
    } catch {
        if case .hashMismatch = HubError.from(error) {} else { check(false, "a damaged download is a hash mismatch: \(error)") }
    }
    check(storeA.blobFile(clip.hash) == nil, "and not kept")

    // ---- the hub restarts: offline meanwhile, fine after
    hub.stop()
    await engineA.syncNow()
    check(engineA.status == .offline, "a stopped hub is offline: \(engineA.status)")
    check(hub.restart(), "the hub restarts")
    await engineA.syncNow()
    check(engineA.status == .idle, "after the restart the engine syncs again: \(engineA.status)")

    // ---- revoked: status says so, data stays; pairing again (same device) replaces the client's token
    let revokedId = engineA.credentials!.clientId
    _ = try? await hub.adminClient.with(token: MockHub.admin).session.data(for: {
        var r = URLRequest(url: hub.url.appendingPathComponent("v1/clients/\(revokedId)"))
        r.httpMethod = "DELETE"
        r.setValue("Bearer \(MockHub.admin)", forHTTPHeaderField: "Authorization")
        return r
    }())
    await engineA.syncNow()
    check(engineA.status == .revoked && engineA.statusText == "Hub revoked this device", "a revoked token shows: \(engineA.status)")
    check(storeA.entries.count > 1000 && engineA.isPaired, "local data and the address stay")
    let code = await hub.code()
    if let again = try? await engineA.pair(url: url, code: code, name: "Checks iPhone") {
        check(again.client.id == revokedId, "pairing again with the same device id keeps the client: \(again.client.id)")
        await engineA.syncNow()
        check(engineA.status == .idle, "and syncs: \(engineA.status)")
        let clients = (await hub.state())["clients"] as? [[String: Any]] ?? []
        check(clients.count == 2, "no second client for the same device: \(clients.count)")
    } else {
        check(false, "pairing again works")
    }

    // ---- the hub moves: a new address keeps the pairing; an address where no hub answers, or another hub's, is refused
    do {
        try await engineA.changeAddress("localhost:\(hub.port)")
        check(engineA.credentials?.hubURL.host() == "localhost" && engineA.credentials?.clientId == revokedId,
              "a new address keeps the token and the client: \(String(describing: engineA.credentials))")
        await engineA.syncNow()
        check(engineA.status == .idle, "and syncs there: \(engineA.status)")
    } catch {
        check(false, "changing the address works: \(error)")
    }
    do {
        try await engineA.changeAddress("127.0.0.1:1")
        check(false, "an address where no hub answers is refused")
    } catch {
        check(engineA.credentials?.hubURL.host() == "localhost", "an unreachable address changes nothing: \(error)")
    }
    if let stranger = MockHub(codes: []), stranger.start() {
        defer { stranger.cleanUp() }
        do {
            try await engineA.changeAddress(stranger.url.absoluteString)
            check(false, "another hub's address is refused")
        } catch {
            let refused = if case .otherHub = HubError.from(error) { true } else { false }
            check(refused && engineA.credentials?.hubURL.host() == "localhost", "another hub's address is refused, nothing changes: \(error)")
        }
    } else {
        check(false, "a stranger mock hub starts")
    }

    // ---- unpair keeps the journal; pairing with another hub uploads everything to it
    engineA.unpair()
    check(engineA.status == .unpaired && !engineA.isPaired && storeA.entries.count > 1000, "unpairing keeps local data")
    if let other = MockHub(codes: ["CCCC-DDDD"]), other.start() {
        defer { other.cleanUp() }
        _ = try? await engineA.pair(url: other.url, code: "CCCC-DDDD", name: "Checks iPhone")
        await engineA.syncNow()
        let otherState = await other.state()
        // The clip's video never reached A (its download was damaged): that entry cannot go up, and says so.
        check(storeA.blobFile(clip.hash) == nil && storeA.pending == ["clip"], "only the entry whose media A lacks waits: \(storeA.pending)")
        check(otherState["records"] as? Int == storeA.records.count - 1,
              "another hub gets every other local record: \(String(describing: otherState["records"])) of \(storeA.records.count)")
        check(engineA.status == .idle && engineA.problem?.contains("missing on this device") == true,
              "the held entry is reported: \(String(describing: engineA.problem))")
    } else {
        check(false, "a second mock hub starts")
    }
}

// MARK: - Helpers

@MainActor
private func makeEngine(_ dir: URL, device: String) -> SyncEngine {
    let defaults = UserDefaults(suiteName: "fx.hubchecks.\(UUID().uuidString)")!
    let engine = SyncEngine(secrets: MemorySecretStore(deviceId: device), defaults: defaults,
                            directory: dir.appendingPathComponent("hub"))
    engine.livePollWait = 2
    engine.localChangeDelay = .milliseconds(200)
    return engine
}

private func entry(_ id: String, _ emoji: String, _ text: String, _ time: Double, blobs: [BlobRef] = []) -> HubRecord {
    HubRecord(id: id, kind: JournalEntry.kind, time: time, end: nil, zone: "UTC",
              data: JournalEntry(emoji: emoji, markdown: text).data, text: nil, tags: nil,
              blobs: blobs.isEmpty ? nil : blobs, created: time, updated: time, deleted: nil,
              source: nil, editor: nil, rev: nil, fx: nil)
}

private func sha256(_ file: URL) -> String {
    let data = (try? Data(contentsOf: file)) ?? Data()
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
}

/// Polls `condition` until it holds or `seconds` pass.
@MainActor
private func eventually(_ seconds: Double = 5, _ condition: () async -> Bool) async -> Bool {
    let deadline = Date.now.addingTimeInterval(seconds)
    while Date.now < deadline {
        if await condition() { return true }
        try? await Task.sleep(for: .milliseconds(50))
    }
    return await condition()
}
