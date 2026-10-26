import CoreGraphics
import Foundation
import FractonicaKit
import Observation
import PhotosUI
import SwiftUI

/// The composer's state: the draft (autosaved a moment after every change, so nothing is lost if the app is killed),
/// media on their way in, the voice recorder. Media become blobs in the store as soon as they are ready; the draft
/// names them, so they survive with it and go when it is discarded.
///
/// An attachment shows the moment it is picked: a tile of its kind (`PendingMedia`) with a ring that fills as the file
/// comes from the library, is converted and stored, its picture as soon as there is one; it can be cancelled, and
/// Save waits for whatever is still coming (`isWaitingToSave`).
@MainActor @Observable
final class ComposerModel {
    var draft: JournalDraft {
        didSet { if draft != oldValue { scheduleAutosave() } }
    }
    /// The draft as it was opened: Cancel offers to keep or discard only when something changed.
    let opened: JournalDraft
    let isNew: Bool
    /// The emoji a new entry started with (picked at random), which alone does not make the entry worth saving.
    let autoEmoji: String?
    /// Media on their way in, in the order they were added.
    private(set) var pending: [PendingMedia] = []
    /// Save was asked for while media were still coming: the entry saves (`saved`) as soon as the last one is in.
    private(set) var isWaitingToSave = false
    /// The record Save wrote (the view closes then).
    private(set) var saved: HubRecord?
    var error: String?
    let recorder = VoiceRecorder()
    /// Capture moments read from the files of attachments the draft has no moment for (an entry made elsewhere, an
    /// older draft): offered too, but not part of the draft, so opening an entry changes nothing.
    private(set) var readDates: [String: Double] = [:]

    @ObservationIgnored private let store: JournalStore
    @ObservationIgnored private let zone: TimeZone
    @ObservationIgnored private var autosave: Task<Void, Never>?
    @ObservationIgnored private var tasks: [UUID: Task<Void, Never>] = [:]
    /// Saved or discarded: nothing autosaves any more.
    @ObservationIgnored private var closed = false

    init(request: ComposerRequest, store: JournalStore = .shared, settings: AppSettings = .shared) {
        self.store = store
        self.zone = settings.timeZone
        let now = Date().timeIntervalSince1970
        let zone = settings.zone ?? TimeZone.current.identifier
        let initial: JournalDraft
        var autoEmoji: String?
        if request.key == JournalDraft.newKey {
            isNew = true
            if var draft = store.draft(JournalDraft.newKey) {
                if draft.timeChosen != true { draft.time = now }
                initial = draft
            } else {
                // a new entry starts with an emoji of its own, any of them
                autoEmoji = JournalLaunch.string("FXJournalEmojiPick") ?? EmojiCatalog.random()
                initial = JournalDraft(key: JournalDraft.newKey, recordID: UUID().uuidString.lowercased(), emoji: autoEmoji, time: now, zone: zone)
            }
        } else if let saved = store.draft(request.key) {
            isNew = false
            initial = saved
        } else if let record = store.record(request.key) {
            isNew = false
            let entry = record.entry ?? JournalEntry()
            initial = JournalDraft(key: record.id, recordID: record.id, emoji: entry.emoji, title: entry.title ?? "",
                                 markdown: entry.markdown, transcript: entry.transcript, time: record.time, timeChosen: true,
                                 zone: record.zone ?? zone, blobs: record.blobs ?? [])
        } else {
            isNew = true
            autoEmoji = EmojiCatalog.random()
            initial = JournalDraft(key: JournalDraft.newKey, recordID: UUID().uuidString.lowercased(), emoji: autoEmoji, time: now, zone: zone)
        }
        self.autoEmoji = autoEmoji
        draft = initial
        opened = initial
        readCaptureDates()
    }

    // MARK: State

    var hasChanges: Bool { draft != opened }

    /// Something worth saving: text, a title, an emoji chosen by hand, media (in or on the way).
    var hasContent: Bool {
        var content = draft
        if autoEmoji != nil, content.emoji == autoEmoji { content.emoji = nil }
        return !content.isEmpty || !pending.isEmpty
    }

    var canSave: Bool { hasContent && !recorder.isActive && !isWaitingToSave }

    /// The attachments shown (posters ride with their videos).
    var media: [BlobRef] { draft.blobs.filter { $0.role != "poster" } }

    /// The attachments' capture moments, for the moment picker.
    var captureOptions: [MediaCapture.Option] {
        let clock = FractonicaClock.shared
        let captured = readDates.merging(draft.captured ?? [:]) { _, own in own }
        return MediaCapture.options(draft.blobs, captured: captured, within: clock.tMin...clock.tMax)
    }

    // MARK: Saving

    /// Saves the entry; with media still coming, waits for them (`isWaitingToSave`) and saves when they are in.
    @discardableResult
    func save() -> HubRecord? {
        guard canSave else { return nil }
        if !pending.isEmpty {
            isWaitingToSave = true
            return nil
        }
        autosave?.cancel()
        closed = true
        let record = store.saveEntry(draft)
        Haptics.play(.success)
        saved = record
        return record
    }

    /// Stops waiting for the media to save (the entry stays open).
    func stopWaiting() {
        isWaitingToSave = false
    }

    /// Keeps the draft for later (closing without saving); media still coming are dropped.
    func keepDraft() {
        autosave?.cancel()
        cancelAllPending()
        guard !closed else { return }
        closed = true
        if hasChanges || store.draft(draft.key) != nil { store.saveDraft(draft) }
    }

    /// Throws the changes away: a new entry's draft and its media; an edit's unsaved changes.
    func discard() {
        autosave?.cancel()
        cancelAllPending()
        closed = true
        recorder.cancel()
        store.discardDraft(draft.key)
    }

    func flush() {
        autosave?.cancel()
        guard !closed else { return }
        if hasChanges { store.saveDraft(draft) }
    }

    private func scheduleAutosave() {
        autosave?.cancel()
        autosave = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self, !self.closed else { return }
            self.store.saveDraft(self.draft)
        }
    }

    // MARK: Moment

    func setTime(_ t: Double) {
        draft.time = t
        draft.timeChosen = true
    }

    /// Capture moments of attachments the draft does not know yet (an entry made elsewhere, an older draft), read
    /// from their files in the background.
    private func readCaptureDates() {
        let known = draft.captured ?? [:]
        let missing = media.filter { known[$0.hash] == nil && $0.role != "audio" }
            .compactMap { blob in store.blobFile(blob.hash).map { (blob.hash, $0, blob.role == "video") } }
        guard !missing.isEmpty else { return }
        let zone = zone
        Task {
            var found: [String: Double] = [:]
            for (hash, url, video) in missing {
                if let t = await MediaCapture.date(of: url, video: video, zone: zone) { found[hash] = t }
            }
            if !found.isEmpty { readDates = found }
        }
    }

    // MARK: Media

    /// Photos and videos from the library: each shows at once and fills its ring as it arrives and is converted.
    func add(picked items: [PhotosPickerItem]) {
        for item in items {
            let movie = item.supportedContentTypes.contains { $0.conforms(to: .movie) || $0.conforms(to: .video) }
            let id = begin(role: movie ? "video" : "photo", name: nil, transfers: true)
            tasks[id] = Task {
                do {
                    let url = try await transfer(item, movie: movie, id: id)
                    await process(id, url: url, name: nil, captured: nil)
                } catch {
                    fail(id, error, message: "That item could not be read from the library.")
                }
            }
        }
    }

    /// Imports picked or dropped files (copies in the journal's tmp/), each processed per Settings › Journal.
    /// `captured`: when they were taken, when the caller knows (a camera shot, a voice note).
    func add(files: [(url: URL, name: String?)], captured: Double? = nil) {
        for file in files {
            let id = begin(role: JournalMedia.role(of: file.url), name: file.name, transfers: false)
            tasks[id] = Task { await process(id, url: file.url, name: file.name, captured: captured) }
        }
    }

    /// A camera shot.
    func add(_ shot: CameraShot) {
        let now = Date().timeIntervalSince1970
        switch shot {
        case .photo(let url): add(files: [(url, nil)], captured: now)
        case .movie(let url): add(files: [(url, nil)], captured: now)
        }
    }

    /// Stops an attachment on its way in and forgets it.
    func cancel(_ id: UUID) {
        tasks[id]?.cancel()
        tasks[id] = nil
        withAnimation(.snappy) { pending.removeAll { $0.id == id } }
        settle()
    }

    private func cancelAllPending() {
        for task in tasks.values { task.cancel() }
        tasks = [:]
        pending = []
        isWaitingToSave = false
    }

    private func begin(role: String, name: String?, transfers: Bool) -> UUID {
        let item = PendingMedia(role: role, name: name, transfers: transfers)
        withAnimation(.snappy) { pending.append(item) }
        return item.id
    }

    /// The library's file, copied into tmp/, reporting how far the copy (or Photos' own preparation) is.
    private func transfer(_ item: PhotosPickerItem, movie: Bool, id: UUID) async throws -> URL {
        let (results, sink) = AsyncStream<Result<URL?, Error>>.makeStream()
        let progress: Progress
        if movie {
            progress = item.loadTransferable(type: PickedMovie.self) { result in
                sink.yield(result.map { $0?.url })
                sink.finish()
            }
        } else {
            progress = item.loadTransferable(type: PickedImage.self) { result in
                sink.yield(result.map { $0?.url })
                sink.finish()
            }
        }
        let watcher = Task { [weak self] in
            while !Task.isCancelled {
                self?.advance(id, stage: .loading, progress.fractionCompleted)
                try? await Task.sleep(for: .milliseconds(100))
            }
        }
        defer { watcher.cancel() }
        let result = await withTaskCancellationHandler {
            var iterator = results.makeAsyncIterator()
            return await iterator.next()
        } onCancel: {
            progress.cancel()
        }
        try Task.checkCancellation()
        switch result {
        case .success(let url?)?: return url
        case .failure(let error)?: throw error
        default: throw JournalMedia.Failure.unreadable("the item")
        }
    }

    /// Converts and stores a local file, then adds it to the draft in place of its pending tile.
    private func process(_ id: UUID, url: URL, name: String?, captured known: Double?) async {
        let prefs = JournalPreferences.shared
        let disk = store.disk
        let role = JournalMedia.role(of: url)
        advance(id, stage: .converting, 0)
        Task { [weak self] in await self?.makePreview(id, url: url, role: role) }
        let captured: Double?
        if let known {
            captured = known
        } else if role == "audio" {
            captured = nil
        } else {
            captured = await MediaCapture.date(of: url, video: role == "video", zone: zone)
        }
        do {
            let item: JournalMedia.Item
            if role == "audio" && name == nil {
                item = try await JournalMedia.processAudio(url, disk: disk, move: true)   // a voice note
            } else {
                item = try await JournalMedia.process(url, name: name, photo: prefs.photoQuality, video: prefs.videoQuality, disk: disk) { [weak self] fraction in
                    Task { @MainActor in self?.advance(id, stage: .converting, fraction) }
                }
                try? FileManager.default.removeItem(at: url)
            }
            try Task.checkCancellation()
            advance(id, stage: .saving, 0)
            let refs = try await store.adopt(item)
            try Task.checkCancellation()
            guard pending.contains(where: { $0.id == id }) else { return }
            withAnimation(.snappy) {
                pending.removeAll { $0.id == id }
                draft.blobs.append(contentsOf: refs)
                if let captured, let main = refs.first {
                    var dates = draft.captured ?? [:]
                    dates[main.hash] = captured
                    draft.captured = dates
                }
            }
            tasks[id] = nil
            settle()
        } catch {
            try? FileManager.default.removeItem(at: url)
            fail(id, error, message: nil)
        }
    }

    private func makePreview(_ id: UUID, url: URL, role: String) async {
        guard role != "audio" else { return }
        let image: CGImage? = await Thumbnails.gate.run {
            role == "video" ? await Thumbnails.frame(url, pixels: 320) : Thumbnails.downsample(url, pixels: 320)
        } ?? nil
        guard let image, let i = pending.firstIndex(where: { $0.id == id }) else { return }
        pending[i].preview = image
    }

    private func advance(_ id: UUID, stage: PendingMedia.Stage, _ fraction: Double) {
        guard let i = pending.firstIndex(where: { $0.id == id }) else { return }
        pending[i].advance(stage, fraction)
    }

    private func fail(_ id: UUID, _ error: Error, message: String?) {
        tasks[id] = nil
        guard pending.contains(where: { $0.id == id }) else { return }   // cancelled meanwhile
        withAnimation(.snappy) { pending.removeAll { $0.id == id } }
        if !(error is CancellationError) {
            self.error = message ?? error.localizedDescription
            isWaitingToSave = false   // the entry stays open: the user decides
        }
        settle()
    }

    /// The last attachment is in: a waiting Save saves now.
    private func settle() {
        guard pending.isEmpty, isWaitingToSave else { return }
        isWaitingToSave = false
        save()
    }

    // MARK: Voice

    func startRecording() {
        Task { await recorder.start(quality: JournalPreferences.shared.audioQuality, disk: store.disk) }
    }

    /// Stops the recorder and adds the voice note (its moment: when the recording began).
    func finishRecording() {
        let started = recorder.startedAt
        guard let url = recorder.stop() else { return }
        add(files: [(url, nil)], captured: started)
        Haptics.play(.success)
    }

    // MARK: Arranging

    func remove(_ blob: BlobRef) {
        if JournalAudioPlayer.shared.isCurrent(blob.hash) { JournalAudioPlayer.shared.stop() }
        withAnimation(.snappy) {
            draft.blobs.removeAll { $0.hash == blob.hash || ($0.role == "poster" && $0.hash == blob.poster) }
            if draft.captured?[blob.hash] != nil { draft.captured?[blob.hash] = nil }
        }
    }

    /// Moves an attachment (among the shown ones) to another place; its poster follows.
    func move(_ hash: String, to target: String) {
        var shown = media
        guard let from = shown.firstIndex(where: { $0.hash == hash }), let to = shown.firstIndex(where: { $0.hash == target }), from != to else { return }
        let item = shown.remove(at: from)
        shown.insert(item, at: to)
        withAnimation(.snappy) { draft.blobs = arrange(shown) }
    }

    func move(_ blob: BlobRef, by offset: Int) {
        var shown = media
        guard let from = shown.firstIndex(where: { $0.hash == blob.hash }) else { return }
        let to = min(max(0, from + offset), shown.count - 1)
        guard to != from else { return }
        shown.swapAt(from, to)
        withAnimation(.snappy) { draft.blobs = arrange(shown) }
    }

    /// The shown attachments with each video's poster right after it.
    private func arrange(_ shown: [BlobRef]) -> [BlobRef] {
        shown.flatMap { blob -> [BlobRef] in
            guard let poster = blob.poster, let p = draft.blobs.first(where: { $0.hash == poster && $0.role == "poster" }) else { return [blob] }
            return [blob, p]
        }
    }
}
