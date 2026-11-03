import Foundation
import Observation
#if os(iOS)
import UIKit
#endif

/// An entry's videos reversed on request (a video's menu in the entry: Reverse): the reversed copy (`VideoReverser`) is
/// added to the entry right after the video, named `reversed`, and syncs like any edit. A toast says when it is in, or
/// why not. Each video's progress shows on its tile.
@MainActor @Observable
final class VideoReversals {
    static let shared = VideoReversals()

    /// How far each video being reversed is (0 … 1), by its hash.
    private(set) var progress: [String: Double] = [:]

    func reverse(_ blob: BlobRef, in recordID: String, store: JournalStore = .shared, toasts: ToastCenter = .shared) {
        guard progress[blob.hash] == nil else { return }
        progress[blob.hash] = 0
        Task {
            #if os(iOS)
            // (finishing if the app leaves the front meanwhile, while it may)
            let background = UIApplication.shared.beginBackgroundTask(withName: "Reverse video")
            defer { UIApplication.shared.endBackgroundTask(background) }
            #endif
            defer { progress[blob.hash] = nil }
            let out = store.disk.temporaryFile(ext: "mov")
            defer { try? FileManager.default.removeItem(at: out) }
            do {
                var source = store.blobFile(blob.hash)
                if source == nil, let fetch = JournalHooks.fetchBlob { source = try await fetch(blob.hash) }
                guard let source else { throw VideoReverser.Failure.noVideo }
                let hash = blob.hash
                try await VideoReverser.reverse(source, to: out) { p in
                    Task { @MainActor in VideoReversals.shared.progress[hash] = max(VideoReversals.shared.progress[hash] ?? 0, 0.95 * p) }
                }
                let item = try await JournalMedia.processVideo(out, name: VideoReverser.name, quality: .original, disk: store.disk)
                let refs = try await store.adopt(item)
                guard var record = store.record(recordID), !record.isDeleted else { return }
                var blobs = record.blobs ?? []
                let at = blobs.firstIndex { $0.hash == blob.hash }.map { $0 + 1 } ?? blobs.count
                blobs.insert(contentsOf: refs, at: at)
                record.blobs = blobs
                store.save(record)
                Haptics.play(.success)
                toasts.show("Reversed video added")
            } catch is CancellationError {
            } catch {
                Haptics.play(.warning)
                toasts.show("Couldn’t reverse it: \(error.localizedDescription)", for: 4)
            }
        }
    }
}
