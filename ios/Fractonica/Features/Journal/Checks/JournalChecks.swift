import FractonicaKit
import Foundation

// The journal's logic: the store against RecordSyncing's contract (pending, last writer wins, tombstones, blob files and
// their collection, cursors and pending surviving a relaunch), the record helpers, keyword ranking and the merge with
// semantic scores, the Helion grouping, the Markdown block parser and the formatting bar's edits.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Journal/Checks

@main @MainActor
struct JournalChecks {
    static func main() async {
        await storeChecks()
        await remoteChecks()
        await blobChecks()
        await draftChecks()
        recordChecks()
        rankingChecks()
        dayChecks()
        markdownChecks()
        editingChecks()
        Checks.finish()
    }
}

// MARK: - Helpers

@MainActor
private final class Clock {
    var t = 1_791_460_800.0
    func tick(_ s: Double = 10) -> Double { t += s; return t }
}

@MainActor
private func freshStore(_ root: URL? = nil) -> (JournalStore, Clock, URL) {
    let root = root ?? FileManager.default.temporaryDirectory.appending(path: "fx-journal-checks-\(UUID().uuidString)", directoryHint: .isDirectory)
    let store = JournalStore(disk: JournalDisk(root: root))
    let clock = Clock()
    store.now = { clock.t }
    store.loadNow()
    return (store, clock, root)
}

private func entry(_ id: String, time: Double, title: String, markdown: String = "", emoji: String? = nil, blobs: [BlobRef] = [], updated: Double) -> HubRecord {
    var r = HubRecord.journalEntry(id: id, time: time, zone: "UTC", entry: JournalEntry(emoji: emoji, title: title, markdown: markdown), blobs: blobs, now: updated)
    r.updated = updated
    return r
}

private func blobFile(_ text: String, in dir: URL) throws -> (URL, String) {
    let url = dir.appending(path: UUID().uuidString)
    try Data(text.utf8).write(to: url)
    return (url, try JournalDisk.sha256(of: url))
}

// MARK: - Store: local writes, pending, persistence

@MainActor
private func storeChecks() async {
    let (store, clock, root) = freshStore()
    defer { try? FileManager.default.removeItem(at: root) }
    var changes = 0
    store.onLocalChange = { changes += 1 }

    check(store.isLoaded && store.entries.isEmpty && store.pendingRecords().isEmpty, "a fresh store is empty and loaded")

    var draft = JournalDraft(key: JournalDraft.newKey, recordID: "a1", emoji: "🌙", title: "Night walk", markdown: "Saw the **moon**", time: 1_791_400_000, zone: "Europe/Kyiv")
    clock.t = 1_791_460_800
    let a = store.saveEntry(draft)
    check(a.created == 1_791_460_800 && a.updated == 1_791_460_800, "a new entry is created and updated now: \(a.created) \(a.updated)")
    check(a.kind == "journal.entry" && a.time == 1_791_400_000 && a.zone == "Europe/Kyiv", "kind, time and zone are the draft's")
    check(a.entry == JournalEntry(emoji: "🌙", title: "Night walk", markdown: "Saw the **moon**"), "the entry's data round-trips")
    check(store.isPending("a1") && store.pendingRecords().map(\.id) == ["a1"], "a local save is pending")
    check(changes == 1, "onLocalChange fires once per save: \(changes)")

    // the file is the API JSON
    let json = try? JSONSerialization.jsonObject(with: Data(contentsOf: store.disk.recordFile("a1"))) as? [String: Any]
    check(json?["kind"] as? String == "journal.entry" && (json?["data"] as? [String: Any])?["emoji"] as? String == "🌙", "records/<id>.json holds the API JSON")
    check(json?["source"] == nil && json?["rev"] == nil && json?["deleted"] == nil, "unset hub fields are left out of the JSON")

    // edit
    _ = clock.tick()
    draft.key = "a1"
    draft.title = "Night walk, again"
    let a2 = store.saveEntry(draft)
    check(a2.created == a.created && a2.updated == clock.t, "an edit keeps created and sets updated")
    check(store.entries.count == 1 && store.entries[0].entry?.title == "Night walk, again", "the edit replaces the entry")
    check(changes == 2, "onLocalChange fires for the edit")

    // a second entry; pending order is oldest updated first
    _ = clock.tick()
    store.save(entry("b2", time: 1_791_450_000, title: "Second", updated: 0))
    check(store.pendingRecords().map(\.id) == ["a1", "b2"], "pending: oldest updated first")
    check(store.entries.map(\.id) == ["b2", "a1"], "entries: newest time first")

    // upload acknowledgements
    var accepted = store.record("a1")!
    accepted.source = "c_1"; accepted.rev = 41; accepted.fx = HubRecord.FXReading(stamp: "s", clock: "34η")
    store.markUploaded(accepted)
    check(!store.isPending("a1") && store.record("a1")?.rev == 41 && store.record("a1")?.source == "c_1", "markUploaded stores the hub's copy and clears pending")

    // edited again while uploading: the stale acknowledgement keeps the local edit pending
    let uploading = store.record("b2")!
    _ = clock.tick()
    var b = store.record("b2")!
    b.data = JournalEntry(title: "Second, edited").data
    store.save(b)
    var staleAck = uploading
    staleAck.rev = 42
    store.markUploaded(staleAck)
    check(store.isPending("b2") && store.record("b2")?.entry?.title == "Second, edited" && store.record("b2")?.rev == nil, "a stale acknowledgement leaves a newer local edit pending")

    // cursors
    store.changeCursor = 1042
    store.vectorCursor = 88

    // delete: tombstone, pending, hidden
    _ = clock.tick()
    store.delete("a1")
    check(store.record("a1") == nil && !store.entries.contains { $0.id == "a1" }, "a deleted entry leaves the journal at once")
    let tomb = store.pendingRecords().first { $0.id == "a1" }
    check(tomb?.deleted == true && tomb?.blobs == [] && tomb?.data == .object([:]) && tomb?.updated == clock.t, "the deletion is a pending tombstone with empty data and blobs")
    check(tomb?.source == "c_1", "the tombstone keeps the creator")
    check(changes == 5, "onLocalChange fires for every local write: \(changes)")

    // relaunch: everything survives
    let (again, _, _) = freshStore(root)
    check(again.entries.map(\.id) == ["b2"], "entries survive a relaunch")
    check(Set(again.pendingRecords().map(\.id)) == ["a1", "b2"], "pending survives a relaunch")
    check(again.pendingRecords().first { $0.id == "a1" }?.isDeleted == true, "the tombstone survives a relaunch")
    check(again.changeCursor == 1042 && again.vectorCursor == 88, "the cursors survive a relaunch")

    // the uploaded tombstone goes away
    again.markUploaded(tomb!)
    check(!again.isPending("a1") && again.records["a1"] == nil && !FileManager.default.fileExists(atPath: again.disk.recordFile("a1").path),
          "an uploaded tombstone is dropped with its file")

    // async load off the main thread
    let loaded = JournalStore(disk: JournalDisk(root: root))
    await loaded.load()
    check(loaded.isLoaded && loaded.entries.map(\.id) == ["b2"] && loaded.pendingRecords().map(\.id) == ["b2"], "load() reads the same index")
}

// MARK: - Store: remote records, last writer wins

@MainActor
private func remoteChecks() async {
    let (store, clock, root) = freshStore()
    defer { try? FileManager.default.removeItem(at: root) }
    var changes = 0
    store.onLocalChange = { changes += 1 }

    // a new remote record of another kind
    var sensor = HubRecord(id: "temp:studio:1", kind: "sensor.temperature", time: 1_791_000_000, end: nil, zone: nil,
                           data: .object(["celsius": .number(21.5), "where": .string("studio")]), text: nil, tags: nil,
                           blobs: nil, created: 1_791_000_000, updated: 1_791_000_000, deleted: nil)
    sensor.rev = 7
    store.applyRemote(sensor)
    check(store.otherRecords.map(\.id) == ["temp:studio:1"] && store.entries.isEmpty, "other kinds are kept apart from entries")
    check(!store.isPending("temp:studio:1") && changes == 0, "a remote record is never pending and fires no local change")

    // LWW: newer remote wins, older loses
    clock.t = 100
    store.save(entry("e1", time: 50, title: "local", updated: 0))
    store.applyRemote(entry("e1", time: 50, title: "older remote", updated: 90))
    check(store.record("e1")?.entry?.title == "local" && store.isPending("e1"), "an older remote version loses")
    store.applyRemote(entry("e1", time: 50, title: "newer remote", updated: 110))
    check(store.record("e1")?.entry?.title == "newer remote" && !store.isPending("e1"), "a newer remote version wins and clears pending")

    // ties: pending local wins, otherwise the hub's
    clock.t = 200
    store.save(entry("e2", time: 60, title: "local tie", updated: 0))
    store.applyRemote(entry("e2", time: 60, title: "remote tie", updated: 200))
    check(store.record("e2")?.entry?.title == "local tie" && store.isPending("e2"), "a tie keeps the pending local copy")
    var ack = store.record("e2")!; ack.rev = 3
    store.markUploaded(ack)
    store.applyRemote(entry("e2", time: 60, title: "remote tie", updated: 200))
    check(store.record("e2")?.entry?.title == "remote tie", "a tie with nothing pending takes the hub's copy")

    // a remote tombstone removes the record
    var tombstone = store.record("e2")!.tombstone(at: 300)
    tombstone.rev = 9
    store.applyRemote(tombstone)
    check(store.record("e2") == nil && store.records["e2"] == nil && !FileManager.default.fileExists(atPath: store.disk.recordFile("e2").path),
          "a remote tombstone removes the record and its file")
    // an older remote copy cannot bring it back once a newer tombstone is pending locally
    clock.t = 400
    store.delete("e1")
    store.applyRemote(entry("e1", time: 50, title: "stale", updated: 150))
    check(store.record("e1") == nil && store.isPending("e1"), "an older remote copy does not undo a local delete")
    // a tombstone for a record never seen is ignored
    store.applyRemote(entry("zz", time: 1, title: "x", updated: 1).tombstone(at: 5))
    check(store.records["zz"] == nil, "a tombstone of an unknown record stores nothing")
    // markUploaded for a record gone meanwhile stores nothing
    store.markUploaded(entry("gone", time: 1, title: "x", updated: 1))
    check(store.records["gone"] == nil, "markUploaded of a record no longer here stores nothing")
}

// MARK: - Store: blobs

@MainActor
private func blobChecks() async {
    let (store, clock, root) = freshStore()
    defer { try? FileManager.default.removeItem(at: root) }
    let scratch = root.appending(path: "scratch", directoryHint: .isDirectory)
    try? FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)

    let (photoURL, photoHash) = (try? blobFile("photo bytes", in: scratch))!
    check(JournalValidation.isValidHash(photoHash), "the hash is 64 lowercase hex digits: \(photoHash)")
    // a known vector: SHA-256("abc")
    let abc = scratch.appending(path: "abc")
    try? Data("abc".utf8).write(to: abc)
    check((try? JournalDisk.sha256(of: abc)) == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256 of \"abc\"")

    let photo = try? await store.importBlob(photoURL, type: "image/heic", role: "photo", width: 4032, height: 3024)
    check(photo?.hash == photoHash && photo?.size == 11 && photo?.width == 4032, "importBlob hashes, sizes and keeps the metadata")
    check(store.blobFile(photoHash)?.lastPathComponent == "\(photoHash).heic", "blobs/<hash>.<ext>, the extension from the MIME type")
    check(!FileManager.default.fileExists(atPath: photoURL.path), "the imported file is moved, not copied")

    let (audioURL, _) = (try? blobFile("audio bytes", in: scratch))!
    let audio = try! await store.importBlob(audioURL, type: "audio/mp4", role: "audio", duration: 61.4)
    check(store.blobFile(audio.hash)?.pathExtension == "m4a", "audio/mp4 is .m4a")

    let (videoURL, _) = (try? blobFile("video bytes", in: scratch))!
    let (posterURL, _) = (try? blobFile("poster bytes", in: scratch))!
    let poster = try! await store.importBlob(posterURL, type: "image/jpeg", role: "poster")
    let video = try! await store.importBlob(videoURL, type: "video/quicktime", role: "video", duration: 12, poster: poster.hash)

    clock.t = 10
    let draft = JournalDraft(key: JournalDraft.newKey, recordID: "m1", title: "Media", time: 5, blobs: [photo!, audio, video, poster])
    store.saveDraft(draft)
    let saved = store.saveEntry(draft)
    check(saved.blobs?.count == 4 && saved.mediaBlobs.map(\.role) == ["photo", "audio", "video"], "posters are blobs but not media")
    check(saved.blobHashes == [photoHash, audio.hash, video.hash, poster.hash], "blobHashes includes the poster")
    check(store.draft(JournalDraft.newKey) == nil, "saving discards the draft")

    // a second record shares the photo
    store.save(entry("m2", time: 6, title: "Shares the photo", blobs: [photo!], updated: 0))

    // edit m1 removing the audio: its file goes
    var edited = store.record("m1")!
    edited.blobs = [photo!, video, poster]
    clock.t = 20
    store.save(edited)
    check(store.blobFile(audio.hash) == nil, "a blob an edit drops is removed from disk")
    check(store.blobFile(photoHash) != nil && store.blobFile(video.hash) != nil, "blobs still named stay")

    // delete m1: video and poster go, the shared photo stays
    clock.t = 30
    store.delete("m1")
    check(store.blobFile(video.hash) == nil && store.blobFile(poster.hash) == nil, "a deleted entry's media go")
    check(store.blobFile(photoHash) != nil, "a blob another record names stays")

    // a remote tombstone of m2 frees the photo
    store.applyRemote(store.record("m2")!.tombstone(at: 100))
    check(store.blobFile(photoHash) == nil, "a remote tombstone frees its media")

    // storeBlob from the sync engine before its record: .bin, renamed when the record arrives
    let (dl, dlHash) = (try? blobFile("downloaded", in: scratch))!
    try? store.storeBlob(dlHash, from: dl)
    check(store.blobFile(dlHash)?.pathExtension == "bin", "a blob of unknown type is stored as .bin")
    let remote = entry("r1", time: 7, title: "Remote photo", blobs: [BlobRef(hash: dlHash, type: "image/jpeg", size: 10, role: "photo")], updated: 50)
    store.applyRemote(remote)
    check(store.blobFile(dlHash)?.pathExtension == "jpg", "the record's MIME type renames it: \(store.blobFile(dlHash)?.lastPathComponent ?? "-")")
    // storing a blob already present keeps one file
    let (dup, _) = (try? blobFile("downloaded", in: scratch))!
    try? store.storeBlob(dlHash, from: dup)
    check(store.blobFile(dlHash)?.pathExtension == "jpg" && !FileManager.default.fileExists(atPath: dup.path), "a blob stored twice keeps one file")

    // usage
    let usage = await store.usage()
    check(usage.records > 0 && usage.media == 10, "usage counts records and media: \(usage)")
}

// MARK: - Drafts

@MainActor
private func draftChecks() async {
    let (store, clock, root) = freshStore()
    defer { try? FileManager.default.removeItem(at: root) }
    clock.t = 1
    var draft = JournalDraft(key: JournalDraft.newKey, recordID: "d1", time: 1)
    store.saveDraft(draft)
    check(store.draft(JournalDraft.newKey) == nil, "an empty new draft is not kept")
    draft.markdown = "half a thought"
    let scratch = root.appending(path: "scratch", directoryHint: .isDirectory)
    try? FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    let (url, _) = (try? blobFile("draft photo", in: scratch))!
    let photo = try! await store.importBlob(url, type: "image/png", role: "photo")
    draft.blobs = [photo]
    store.saveDraft(draft)
    let (again, _, _) = freshStore(root)
    check(again.draft(JournalDraft.newKey)?.markdown == "half a thought" && again.draft(JournalDraft.newKey)?.blobs == [photo], "a draft survives a relaunch")
    check(again.blobFile(photo.hash) != nil, "a draft's media survive the launch sweep")
    var removed = again.draft(JournalDraft.newKey)!
    removed.blobs = []
    again.saveDraft(removed)
    check(again.blobFile(photo.hash) == nil, "media a draft drops are removed")
    again.discardDraft(JournalDraft.newKey)
    check(again.draft(JournalDraft.newKey) == nil && !FileManager.default.fileExists(atPath: again.disk.draftFile("new").path), "discarding removes the draft file")
}

// MARK: - Records

private func recordChecks() {
    let e = JournalEntry(emoji: "🌙", title: "", markdown: "x", transcript: nil)
    check(e.data == .object(["markdown": .string("x"), "emoji": .string("🌙")]), "empty title and transcript are left out of data")
    let r = HubRecord.journalEntry(time: 1, zone: nil, entry: e, blobs: [], now: 2)
    check(r.id == r.id.lowercased() && UUID(uuidString: r.id) != nil, "new ids are lowercase UUIDs: \(r.id)")
    check(r.blobs == nil && r.created == 2 && r.updated == 2, "no blobs is nil; created = updated = now")

    var sensor = r
    sensor.kind = "sensor.temperature"
    sensor.data = .object(["celsius": .number(21.5), "where": .string("studio"), "ok": .bool(true), "nested": .object([:])])
    let g = sensor.generic
    check(g.facts == "celsius 21.5 · ok yes · where studio" && g.title == "sensor.temperature" && g.emoji == nil, "generic summary: \(g.facts)")
    sensor.data = .object(["emoji": .string("💻"), "title": .string("Usage"), "minutes": .number(42)])
    check(sensor.generic.emoji == "💻" && sensor.generic.title == "Usage" && sensor.generic.facts == "minutes 42", "generic emoji and title from data")
    sensor.text = "typed text"
    check(sensor.searchableText == "typed text", "other kinds search their text first")

    check(JournalMIME.ext(for: "image/heic") == "heic" && JournalMIME.ext(for: "video/quicktime") == "mov"
        && JournalMIME.ext(for: "audio/mp4") == "m4a" && JournalMIME.ext(for: "image/jpeg") == "jpg"
        && JournalMIME.ext(for: "IMAGE/PNG; q=1") == "png" && JournalMIME.ext(for: "application/x-thing") == "bin", "MIME extensions")
    check(JournalMIME.type(forExtension: "JPEG") == "image/jpeg" && JournalMIME.type(forExtension: "mov") == "video/quicktime", "extensions back to MIME")
    check(JournalValidation.isValidID("cpu:studio:1791460800") && !JournalValidation.isValidID("a b") && !JournalValidation.isValidID(""), "record ids")

    // the record JSON round-trips through JSONValue
    let json = #"{"id":"x","kind":"a.b","time":1.5,"data":{"n":[1,true,null,"s",{"k":2.25}]},"created":1,"updated":2,"source":"c","rev":5,"fx":{"clock":"34η"},"unknown":1}"#
    let decoded = try? JSONDecoder().decode(HubRecord.self, from: Data(json.utf8))
    check(decoded?.data["n"] == .array([.number(1), .bool(true), .null, .string("s"), .object(["k": .number(2.25)])]) && decoded?.rev == 5 && decoded?.fx?.clock == "34η",
          "records decode, unknown fields ignored")
}

// MARK: - Ranking

private func rankingChecks() {
    let a = entry("a", time: 10, title: "Night walk", markdown: "Saw the moon over the café", emoji: "🌙", updated: 1)
    let b = entry("b", time: 20, title: "Breakfast", markdown: "Coffee, then a walk to the river", updated: 1)
    let c = entry("c", time: 30, title: "Walk walk walk", markdown: "walking", updated: 1)
    let ids = JournalRanking.keyword([a, b, c], query: "walk").map(\.id)
    check(ids == ["c", "a", "b"], "keyword: more hits and title hits first: \(ids)")
    check(JournalRanking.keyword([a, b, c], query: "CAFE moon").map(\.id) == ["a"], "every term must match, case and accents folded")
    check(JournalRanking.keyword([a, b, c], query: "🌙").map(\.id) == ["a"], "an emoji finds its entry")
    check(JournalRanking.keyword([a, b, c], query: "   ").isEmpty, "a blank query finds nothing")
    let kw = JournalRanking.keyword([a, b, c], query: "walk")
    check(JournalRanking.merge(keyword: kw, semantic: nil, known: ["a", "b", "c"]) == ["c", "a", "b"], "no semantic scores: keyword order")
    check(JournalRanking.merge(keyword: kw, semantic: ["b": 0.8, "a": 0.5, "zz": 0.9], known: ["a", "b", "c"]) == ["b", "a", "c"],
          "semantic scores rank first, unknown ids dropped, keyword-only hits after")
}

// MARK: - Days

private func dayChecks() {
    let clock = FractonicaClock.shared
    let t = 1_791_460_800.0
    guard let h = clock.level(at: t, JournalDays.level) else { return check(false, "η reading at vector A") }
    let records = [
        entry("1", time: h.end - 1, title: "", updated: 1),
        entry("2", time: h.start + 1, title: "", updated: 1),
        entry("3", time: h.start - 1, title: "", updated: 1),
        entry("4", time: -20_000_000_000, title: "", updated: 1),
    ]
    let days = JournalDays.group(records, clock: clock)
    check(days.map(\.ids) == [["1", "2"], ["3"], ["4"]], "records group by Helion, in order: \(days.map(\.ids))")
    check(days[0].id == "h\(h.cycle)" && abs(days[0].start - h.start) < 1e-3 && days[2].cycle == nil, "a day is its Helion; outside the catalogue none: \(days[0].id) \(days[0].start) \(h.start) \(String(describing: days[2].cycle))")
    let names = days[0].names()
    check(names?.helion.hasSuffix("η") == true && names?.nuclide.hasPrefix("ε#") == true && names?.delta.hasPrefix("Delta") == true, "day names: \(String(describing: names))")
    check(h.duration > 4 * 3600 && h.duration < 6 * 3600, "a Helion lasts about five hours: \(h.duration)")
}

// MARK: - Markdown blocks

private func markdownChecks() {
    let source = """
    # Night walk
    The **moon** rose
    over the hill.

    - [ ] buy film
    - [x] call Ana
      with a continuation
    - plain

    1. one
    2. two
       - nested

    > quoted *text*
    > - quoted item

    ```swift
    let x = 1
    ```
    ---
    Title
    =====
        indented code
    """
    let blocks = MarkdownBlock.parse(source)
    let expected: [MarkdownBlock] = [
        .heading(level: 1, text: "Night walk"),
        .paragraph("The **moon** rose\nover the hill."),
        .list(ordered: false, start: 1, items: [
            MarkdownListItem(text: "buy film", task: false, depth: 0),
            MarkdownListItem(text: "call Ana\nwith a continuation", task: true, depth: 0),
            MarkdownListItem(text: "plain", task: nil, depth: 0),
        ]),
        .list(ordered: true, start: 1, items: [
            MarkdownListItem(text: "one", task: nil, depth: 0),
            MarkdownListItem(text: "two", task: nil, depth: 0),
            MarkdownListItem(text: "nested", task: nil, depth: 1),
        ]),
        .quote([.paragraph("quoted *text*"), .list(ordered: false, start: 1, items: [MarkdownListItem(text: "quoted item", task: nil, depth: 0)])]),
        .code(language: "swift", text: "let x = 1"),
        .rule,
        .heading(level: 1, text: "Title"),
        .code(language: nil, text: "indented code"),
    ]
    check(blocks.count == expected.count, "block count: \(blocks.count) of \(expected.count): \(blocks)")
    for (i, (got, want)) in zip(blocks, expected).enumerated() {
        check(got == want, "block \(i): \(got) ≠ \(want)")
    }
    check(MarkdownBlock.parse("") == [], "empty text has no blocks")
    check(MarkdownBlock.parse("## Heading ##") == [.heading(level: 2, text: "Heading")], "closing hashes go")
    check(MarkdownBlock.parse("#hashtag") == [.paragraph("#hashtag")], "a hashtag is not a heading")
    check(MarkdownBlock.parse("3) third\n4) fourth") == [.list(ordered: true, start: 3, items: [MarkdownListItem(text: "third", task: nil, depth: 0), MarkdownListItem(text: "fourth", task: nil, depth: 0)])], "numbered lists keep their start")
    check(MarkdownBlock.parse("* * *") == [.rule] && MarkdownBlock.parse("___") == [.rule], "rules of * and _")
    check(MarkdownBlock.parse("```\nunclosed") == [.code(language: nil, text: "unclosed")], "an unclosed fence runs to the end")
    check(MarkdownBlock.parse("text\n---") == [.heading(level: 2, text: "text")], "--- under a paragraph is a setext heading")
    check(MarkdownInline.strip("**bold** and *it* with [a link](https://x.y) and `code`") == "bold and it with a link and code", "inline stripping: \(MarkdownInline.strip("**bold** and *it* with [a link](https://x.y) and `code`"))")
    check(MarkdownBlock.plainText("# Hi\n- [x] done\n- todo") == "Hi\n☑︎ done\n• todo", "plain text excerpt: \(MarkdownBlock.plainText("# Hi\n- [x] done\n- todo"))")
}

// MARK: - Formatting bar

private func editingChecks() {
    func run(_ action: MarkdownAction, _ text: String, _ sel: Range<Int>) -> (String, Range<Int>) {
        let r = action.apply(to: text, selection: sel)
        return (r.text, r.selection)
    }
    var r = run(.bold, "a moon b", 2..<6)
    check(r.0 == "a **moon** b" && r.1 == 4..<8, "bold wraps the selection: \(r)")
    r = run(.bold, r.0, r.1)
    check(r.0 == "a moon b" && r.1 == 2..<6, "bold again unwraps: \(r)")
    r = run(.bold, "ab", 1..<1)
    check(r.0 == "a****b" && r.1 == 3..<3, "bold with no selection puts the cursor between the markers: \(r)")
    r = run(.italic, "moon ", 0..<5)
    check(r.0 == "*moon* " && r.1 == 1..<5, "a trailing space stays outside: \(r)")
    r = run(.italic, "**moon**", 2..<6)
    check(r.0 == "***moon***", "italic inside bold adds its own markers: \(r)")
    r = run(.code, "x", 0..<1)
    check(r.0 == "`x`", "inline code")
    r = run(.code, "a\nb", 0..<3)
    check(r.0 == "```\na\nb\n```" && r.1 == 4..<7, "code over lines fences them: \(r)")
    r = run(.link, "see moon", 4..<8)
    check(r.0 == "see [moon](https://)" && r.1 == 19..<19, "link: the cursor after https://: \(r)")
    r = run(.link, "", 0..<0)
    check(r.0 == "[link](https://)" && r.1 == 1..<5, "link with no selection selects the label: \(r)")
    r = run(.heading, "title\nbody", 2..<2)
    check(r.0 == "# title\nbody" && r.1 == 4..<4, "heading 1: \(r)")
    r = run(.heading, r.0, r.1)
    check(r.0 == "## title\nbody", "heading 2")
    r = run(.heading, "### t", 5..<5)
    check(r.0 == "t" && r.1 == 1..<1, "heading 3 cycles back to none: \(r)")
    r = run(.list, "a\nb\nc", 0..<3)
    check(r.0 == "- a\n- b\nc" && r.1 == 2..<7, "list prefixes every touched line: \(r)")
    r = run(.list, r.0, r.1)
    check(r.0 == "a\nb\nc", "list again removes them: \(r)")
    r = run(.checklist, "- a", 3..<3)
    check(r.0 == "- [ ] a", "checklist replaces a bullet: \(r)")
    r = run(.checklist, "- [x] a", 3..<3)
    check(r.0 == "a", "checklist on a checked task removes it: \(r)")
    r = run(.quote, "", 0..<0)
    check(r.0 == "> " && r.1 == 2..<2, "quote on an empty line: \(r)")
    r = run(.bold, "abc", 5..<9)
    check(r.0 == "abc****", "a selection past the end is clamped: \(r)")
}
