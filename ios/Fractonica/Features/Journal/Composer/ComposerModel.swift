import Foundation
import Observation
import SwiftUI

/// The composer's state: the draft (autosaved a moment after every change, so nothing is lost if the app is killed),
/// media being processed, the voice recorder. Media become blobs in the store as soon as they are added; the draft
/// names them, so they survive with it and go when it is discarded.
@MainActor @Observable
final class ComposerModel {
    var draft: JournalDraft {
        didSet { if draft != oldValue { scheduleAutosave() } }
    }
    /// The draft as it was opened: Cancel offers to keep or discard only when something changed.
    let opened: JournalDraft
    let isNew: Bool
    /// Media being imported or converted.
    private(set) var processing = 0
    var error: String?
    let recorder = VoiceRecorder()

    @ObservationIgnored private let store: JournalStore
    @ObservationIgnored private var autosave: Task<Void, Never>?

    init(request: ComposerRequest, store: JournalStore = .shared, settings: AppSettings = .shared) {
        self.store = store
        let now = Date().timeIntervalSince1970
        let zone = settings.zone ?? TimeZone.current.identifier
        let initial: JournalDraft
        if request.key == JournalDraft.newKey {
            isNew = true
            var draft = store.draft(JournalDraft.newKey)
                ?? JournalDraft(key: JournalDraft.newKey, recordID: UUID().uuidString.lowercased(), time: now, zone: zone)
            if draft.timeChosen != true { draft.time = now }
            initial = draft
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
            initial = JournalDraft(key: JournalDraft.newKey, recordID: UUID().uuidString.lowercased(), time: now, zone: zone)
        }
        draft = initial
        opened = initial
    }

    // MARK: State

    var hasChanges: Bool { draft != opened }
    var canSave: Bool { !draft.isEmpty && processing == 0 && !recorder.isActive }

    /// The attachments shown (posters ride with their videos).
    var media: [BlobRef] { draft.blobs.filter { $0.role != "poster" } }

    // MARK: Saving

    func save() -> HubRecord? {
        guard canSave else { return nil }
        autosave?.cancel()
        let record = store.saveEntry(draft)
        Haptics.play(.success)
        return record
    }

    /// Keeps the draft for later (closing without saving).
    func keepDraft() {
        autosave?.cancel()
        if hasChanges || store.draft(draft.key) != nil { store.saveDraft(draft) }
    }

    /// Throws the changes away: a new entry's draft and its media; an edit's unsaved changes.
    func discard() {
        autosave?.cancel()
        recorder.cancel()
        store.discardDraft(draft.key)
    }

    func flush() {
        autosave?.cancel()
        if hasChanges { store.saveDraft(draft) }
    }

    private func scheduleAutosave() {
        autosave?.cancel()
        autosave = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled, let self else { return }
            self.store.saveDraft(self.draft)
        }
    }

    // MARK: Moment

    func setTime(_ t: Double) {
        draft.time = t
        draft.timeChosen = true
    }

    // MARK: Media

    /// Imports picked or dropped files (copies in the journal's tmp/), each processed per Settings › Journal.
    func add(files: [(url: URL, name: String?)]) {
        let prefs = JournalPreferences.shared
        let disk = store.disk
        for file in files {
            processing += 1
            Task {
                defer { processing -= 1 }
                do {
                    let item = try await JournalMedia.process(file.url, name: file.name, photo: prefs.photoQuality, video: prefs.videoQuality, disk: disk)
                    try? FileManager.default.removeItem(at: file.url)
                    let refs = try await store.adopt(item)
                    withAnimation(.snappy) { draft.blobs.append(contentsOf: refs) }
                } catch {
                    try? FileManager.default.removeItem(at: file.url)
                    self.error = error.localizedDescription
                }
            }
        }
    }

    /// A camera shot.
    func add(_ shot: CameraShot) {
        switch shot {
        case .photo(let url): add(files: [(url, nil)])
        case .movie(let url): add(files: [(url, nil)])
        }
    }

    // MARK: Voice

    func startRecording() {
        Task { await recorder.start(quality: JournalPreferences.shared.audioQuality, disk: store.disk) }
    }

    /// Stops the recorder and adds the voice note.
    func finishRecording() {
        guard let url = recorder.stop() else { return }
        processing += 1
        let disk = store.disk
        Task {
            defer { processing -= 1 }
            do {
                let item = try await JournalMedia.processAudio(url, disk: disk, move: true)
                let refs = try await store.adopt(item)
                withAnimation(.snappy) { draft.blobs.append(contentsOf: refs) }
                Haptics.play(.success)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    // MARK: Arranging

    func remove(_ blob: BlobRef) {
        if JournalAudioPlayer.shared.isCurrent(blob.hash) { JournalAudioPlayer.shared.stop() }
        withAnimation(.snappy) {
            draft.blobs.removeAll { $0.hash == blob.hash || ($0.role == "poster" && $0.hash == blob.poster) }
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
