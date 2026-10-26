import AVFoundation
import Foundation
import ImageIO
import SwiftUI

/// Downsampled images of blobs for the timeline and the composer: ImageIO thumbnails (never the full image in memory),
/// made off the main thread and cached by hash and size. A video shows its poster (or, without one, its first frame).
final class Thumbnails: Sendable {
    static let shared = Thumbnails()

    private final class Entry: @unchecked Sendable {
        let image: CGImage
        init(_ image: CGImage) { self.image = image }
    }

    private nonisolated(unsafe) let cache: NSCache<NSString, Entry> = {
        let cache = NSCache<NSString, Entry>()
        cache.totalCostLimit = 96 << 20
        return cache
    }()

    /// A cached thumbnail, without waiting.
    func cached(_ key: String, pixels: Int) -> CGImage? {
        cache.object(forKey: "\(key)@\(pixels)" as NSString)?.image
    }

    /// A thumbnail of the image (or video) at `url`, its long side at most `pixels`.
    func image(_ url: URL, key: String, pixels: Int, video: Bool = false) async -> CGImage? {
        let cacheKey = "\(key)@\(pixels)" as NSString
        if let hit = cache.object(forKey: cacheKey) { return hit.image }
        let image: CGImage?
        if video {
            image = await Self.frame(url, pixels: pixels)
        } else {
            image = await Task.detached(priority: .userInitiated) { Self.downsample(url, pixels: pixels) }.value
        }
        if let image { cache.setObject(Entry(image), forKey: cacheKey, cost: image.bytesPerRow * image.height) }
        return image
    }

    /// A thumbnail from image bytes (a remote thumbnail), cached under `key`.
    func image(_ data: Data, key: String, pixels: Int) async -> CGImage? {
        let cacheKey = "\(key)@\(pixels)" as NSString
        if let hit = cache.object(forKey: cacheKey) { return hit.image }
        let image = await Task.detached(priority: .userInitiated) { () -> CGImage? in
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
            return Self.downsample(source, pixels: pixels)
        }.value
        if let image { cache.setObject(Entry(image), forKey: cacheKey, cost: image.bytesPerRow * image.height) }
        return image
    }

    static func downsample(_ url: URL, pixels: Int) -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        return downsample(source, pixels: pixels)
    }

    static func downsample(_ source: CGImageSource, pixels: Int) -> CGImage? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: pixels,
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    private static func frame(_ url: URL, pixels: Int) async -> CGImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: pixels, height: pixels)
        return try? await generator.image(at: .zero).image
    }
}

/// A blob's picture filling its frame (aspect fill, clipped by the caller): a photo, or a video's poster. A soft
/// placeholder shows while it loads or when the file is missing (not downloaded yet).
struct BlobImage: View {
    let blob: BlobRef
    /// The long side to load, in points (scaled by the display).
    var points: CGFloat = 120
    var contentMode: ContentMode = .fill
    /// Download the whole photo when the device lacks it (`JournalHooks.fetchBlob`), not just the hub's thumbnail.
    var fetchesFull = false

    @Environment(\.displayScale) private var displayScale
    @State private var image: CGImage?

    var body: some View {
        let pixels = Int(points * displayScale)
        ZStack {
            if let image = image ?? cachedImage(pixels) {
                Image(decorative: image, scale: displayScale)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
            } else {
                Rectangle().fill(Theme.panel3)
                    .overlay {
                        Image(systemName: blob.role == "video" ? "video" : "photo")
                            .font(.title3)
                            .foregroundStyle(Theme.ink3.opacity(0.6))
                    }
            }
        }
        .task(id: "\(blob.hash)@\(pixels)") {
            guard image == nil || image.map({ max($0.width, $0.height) }) ?? 0 < pixels / 2 else { return }
            image = await load(pixels)
        }
    }

    private var source: (url: URL, key: String, video: Bool)? {
        let store = JournalStore.shared
        if blob.role == "video" {
            if let poster = blob.poster, let url = store.blobFile(poster) { return (url, poster, false) }
            if let url = store.blobFile(blob.hash) { return (url, blob.hash, true) }
            return nil
        }
        return store.blobFile(blob.hash).map { ($0, blob.hash, false) }
    }

    private func cachedImage(_ pixels: Int) -> CGImage? {
        source.flatMap { Thumbnails.shared.cached($0.key, pixels: pixels) }
    }

    private func load(_ pixels: Int) async -> CGImage? {
        if let source {
            return await Thumbnails.shared.image(source.url, key: source.key, pixels: pixels, video: source.video)
        }
        // not on this device yet: a full photo when asked for one (the gallery), else the hub's thumbnail
        if fetchesFull, blob.role == "photo", let fetch = JournalHooks.fetchBlob, let url = try? await fetch(blob.hash) {
            return await Thumbnails.shared.image(url, key: blob.hash, pixels: pixels)
        }
        let key = blob.role == "video" ? (blob.poster ?? blob.hash) : blob.hash
        guard let remote = JournalHooks.remoteThumbnail, let data = await remote(key, min(2048, max(64, pixels))) else { return nil }
        return await Thumbnails.shared.image(data, key: "remote:\(key)", pixels: pixels)
    }
}
