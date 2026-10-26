@preconcurrency import AVFoundation
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Media as the journal keeps them, made from what the user picks, shoots or records, per Settings › Journal: photos
/// as the original file or optimised (HEIC, long side 2048); videos as the original or re-encoded to 1080p / 720p HEVC
/// with a JPEG poster; voice notes as recorded (AAC .m4a). Every result knows its MIME type, pixel size and duration,
/// for the record's `BlobRef`. All of it runs off the main thread; a video's conversion reports its progress. The
/// capture date survives optimisation (a photo's EXIF dates, a video's creation date), for `MediaCapture`.
enum JournalMedia {
    /// A file ready to become a blob, with what its `BlobRef` says about it.
    struct Item: Sendable {
        var file: URL
        var type: String
        var role: String
        var name: String?
        var width: Int?
        var height: Int?
        var duration: Double?
        /// A video's still.
        var poster: Box?
    }

    /// `Item` inside `Item` (a poster).
    final class Box: Sendable {
        let item: Item
        init(_ item: Item) { self.item = item }
    }

    enum Failure: LocalizedError {
        case unreadable(String)
        case export(String)

        var errorDescription: String? {
            switch self {
            case .unreadable(let name): "Could not read \(name)."
            case .export(let reason): "Could not convert the video: \(reason)"
            }
        }
    }

    /// What a file is, by its extension: "photo", "video" or "audio".
    static func role(of url: URL) -> String {
        let type = UTType(filenameExtension: url.pathExtension) ?? .data
        if type.conforms(to: .movie) || type.conforms(to: .video) { return "video" }
        if type.conforms(to: .audio) { return "audio" }
        return "photo"
    }

    /// Imports a picked file of any supported kind: image, movie or audio, by its type. `progress` hears a video's
    /// conversion, 0 … 1.
    static func process(_ url: URL, name: String? = nil, photo: PhotoQuality, video: VideoQuality, disk: JournalDisk,
                        progress: @escaping @Sendable (Double) -> Void = { _ in }) async throws -> Item {
        let type = UTType(filenameExtension: url.pathExtension) ?? .data
        if type.conforms(to: .movie) || type.conforms(to: .video) {
            return try await processVideo(url, name: name, quality: video, disk: disk, progress: progress)
        }
        if type.conforms(to: .audio) {
            return try await processAudio(url, name: name, disk: disk)
        }
        return try await processImage(url, name: name, quality: photo, disk: disk)
    }

    // MARK: Photos

    static func processImage(_ url: URL, name: String? = nil, quality: PhotoQuality, disk: JournalDisk) async throws -> Item {
        try await Task.detached(priority: .userInitiated) {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else {
                throw Failure.unreadable(url.lastPathComponent)
            }
            let size = pixelSize(source)
            let utType = CGImageSourceGetType(source).flatMap { UTType($0 as String) } ?? UTType(filenameExtension: url.pathExtension)
            let mime = utType?.preferredMIMEType ?? "image/jpeg"
            let longSide = max(size.width, size.height)
            // the original file when asked for, or when it is already a small HEIC
            if quality == .original || (mime == "image/heic" && longSide <= PhotoQuality.longSide) {
                let target = disk.temporaryFile(ext: JournalMIME.ext(for: mime) == "bin" ? url.pathExtension : JournalMIME.ext(for: mime))
                try FileManager.default.copyItem(at: url, to: target)
                return Item(file: target, type: mime, role: "photo", name: name, width: size.width, height: size.height)
            }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: min(longSide, PhotoQuality.longSide),
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                throw Failure.unreadable(url.lastPathComponent)
            }
            // the optimised copy keeps when the photo was taken (and nothing else of its metadata)
            let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
            return try encodePhoto(image, name: name, disk: disk, metadata: MediaCapture.dateProperties(props))
        }.value
    }

    /// A still (a camera shot, a generated sample) as an optimised HEIC (JPEG where HEIC cannot be written).
    static func encodePhoto(_ image: CGImage, name: String? = nil, disk: JournalDisk, quality: Double = 0.8,
                            metadata: [CFString: Any] = [:]) throws -> Item {
        for (uti, mime) in [(UTType.heic, "image/heic"), (UTType.jpeg, "image/jpeg")] {
            let target = disk.temporaryFile(ext: JournalMIME.ext(for: mime))
            guard let destination = CGImageDestinationCreateWithURL(target as CFURL, uti.identifier as CFString, 1, nil) else { continue }
            var properties = metadata
            properties[kCGImageDestinationLossyCompressionQuality] = quality
            CGImageDestinationAddImage(destination, image, properties as CFDictionary)
            if CGImageDestinationFinalize(destination) {
                return Item(file: target, type: mime, role: "photo", name: name, width: image.width, height: image.height)
            }
            try? FileManager.default.removeItem(at: target)
        }
        throw Failure.unreadable(name ?? "the photo")
    }

    /// The displayed pixel size of an image (its orientation applied).
    private static func pixelSize(_ source: CGImageSource) -> (width: Int, height: Int) {
        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
        let w = props[kCGImagePropertyPixelWidth] as? Int ?? 0
        let h = props[kCGImagePropertyPixelHeight] as? Int ?? 0
        let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
        return orientation >= 5 ? (h, w) : (w, h)
    }

    // MARK: Videos

    static func processVideo(_ url: URL, name: String? = nil, quality: VideoQuality, disk: JournalDisk,
                             progress: @escaping @Sendable (Double) -> Void = { _ in }) async throws -> Item {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        var size = try await displaySize(asset)
        var file: URL
        var mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "video/quicktime"
        if let longSide = quality.longSide {
            file = try await export(asset, longSide: longSide, size: size, disk: disk, progress: progress)
            mime = "video/quicktime"
            size = try await displaySize(AVURLAsset(url: file))
        } else {
            file = disk.temporaryFile(ext: JournalMIME.ext(for: mime) == "bin" ? url.pathExtension : JournalMIME.ext(for: mime))
            try FileManager.default.copyItem(at: url, to: file)
        }
        try Task.checkCancellation()
        let poster = try? await makePoster(AVURLAsset(url: file), disk: disk)
        return Item(file: file, type: mime, role: "video", name: name, width: Int(size.width.rounded()), height: Int(size.height.rounded()),
                    duration: duration.isFinite ? duration : nil, poster: poster.map(Box.init))
    }

    /// The size a video shows at: its natural size turned by its preferred transform.
    private static func displaySize(_ asset: AVURLAsset) async throws -> CGSize {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { return .zero }
        let (natural, transform) = try await track.load(.naturalSize, .preferredTransform)
        let r = CGRect(origin: .zero, size: natural).applying(transform)
        return CGSize(width: abs(r.width), height: abs(r.height))
    }

    /// Re-encodes to HEVC with the long side at most `longSide`, keeping the creation date; `progress` hears how far it
    /// is. Cancelling the task cancels the export.
    private static func export(_ asset: AVURLAsset, longSide: Int, size: CGSize, disk: JournalDisk,
                               progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        let preset = AVAssetExportPresetHEVC1920x1080
        guard let session = AVAssetExportSession(asset: asset, presetName: preset) else {
            throw Failure.export("HEVC is not available")
        }
        let long = max(size.width, size.height)
        if long > CGFloat(longSide), longSide < 1920, long > 0 {
            // 720p: the 1080p preset with a composition that scales every frame (there is no 720p HEVC preset)
            session.videoComposition = try await scaledComposition(asset, scale: CGFloat(longSide) / long, size: size)
        }
        if let items = try? await asset.load(.metadata) {
            let dates = items.filter { $0.identifier == .quickTimeMetadataCreationDate || $0.commonKey == .commonKeyCreationDate }
            if !dates.isEmpty { session.metadata = dates }
        }
        let target = disk.temporaryFile(ext: "mov")
        let states = session.states(updateInterval: 0.1)
        let watcher = Task {
            for await state in states {
                if case .exporting(let p) = state { progress(p.fractionCompleted) }
            }
        }
        defer { watcher.cancel() }
        do {
            try await session.export(to: target, as: .mov)
        } catch {
            try? FileManager.default.removeItem(at: target)
            try Task.checkCancellation()
            throw Failure.export(error.localizedDescription)
        }
        return target
    }

    /// A composition that shows the video turned upright (its preferred transform) and scaled by `scale`.
    private static func scaledComposition(_ asset: AVURLAsset, scale: CGFloat, size: CGSize) async throws -> AVVideoComposition? {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { return nil }
        let (transform, fps) = try await track.load(.preferredTransform, .nominalFrameRate)
        let duration = try await asset.load(.duration)
        let scaled = transform.concatenating(CGAffineTransform(scaleX: scale, y: scale))
        let renderSize = CGSize(width: (size.width * scale / 2).rounded() * 2, height: (size.height * scale / 2).rounded() * 2)
        let frame = CMTime(value: 1, timescale: CMTimeScale(max(1, min(120, fps.rounded()))))
        let range = CMTimeRange(start: .zero, duration: duration)
        if #available(iOS 26.0, macOS 26.0, *) {
            var layer = AVVideoCompositionLayerInstruction.Configuration(assetTrack: track)
            layer.setTransform(scaled, at: .zero)
            let instruction = AVVideoCompositionInstruction(configuration: .init(
                layerInstructions: [AVVideoCompositionLayerInstruction(configuration: layer)], timeRange: range))
            return AVVideoComposition(configuration: .init(frameDuration: frame, instructions: [instruction], renderSize: renderSize))
        } else {
            #if os(iOS)
            let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
            layer.setTransform(scaled, at: .zero)
            let instruction = AVMutableVideoCompositionInstruction()
            instruction.timeRange = range
            instruction.layerInstructions = [layer]
            let composition = AVMutableVideoComposition()
            composition.instructions = [instruction]
            composition.renderSize = renderSize
            composition.frameDuration = frame
            return composition
            #else
            return nil
            #endif
        }
    }

    /// The first frame as a JPEG, long side at most 1280.
    static func makePoster(_ asset: AVURLAsset, disk: JournalDisk) async throws -> Item {
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 1280, height: 1280)
        generator.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)
        let image = try await generator.image(at: CMTime(seconds: 0.1, preferredTimescale: 600)).image
        let target = disk.temporaryFile(ext: "jpg")
        guard let destination = CGImageDestinationCreateWithURL(target as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw Failure.unreadable("the poster")
        }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.75] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw Failure.unreadable("the poster") }
        return Item(file: target, type: "image/jpeg", role: "poster", width: image.width, height: image.height)
    }

    // MARK: Audio

    static func processAudio(_ url: URL, name: String? = nil, disk: JournalDisk, move: Bool = false) async throws -> Item {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration).seconds
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType.map { $0 == "audio/x-m4a" ? "audio/mp4" : $0 } ?? "audio/mp4"
        let target = disk.temporaryFile(ext: JournalMIME.ext(for: mime) == "bin" ? url.pathExtension : JournalMIME.ext(for: mime))
        if move { try FileManager.default.moveItem(at: url, to: target) } else { try FileManager.default.copyItem(at: url, to: target) }
        return Item(file: target, type: mime, role: "audio", name: name, duration: duration.isFinite ? duration : nil)
    }
}

extension JournalStore {
    /// Adopts a processed item (and its poster first) as blobs; the references in display order: the item, then its
    /// poster.
    func adopt(_ item: JournalMedia.Item) async throws -> [BlobRef] {
        var poster: BlobRef?
        if let p = item.poster?.item {
            poster = try await importBlob(p.file, type: p.type, role: "poster", width: p.width, height: p.height)
        }
        let main = try await importBlob(item.file, type: item.type, role: item.role, name: item.name, width: item.width,
                                        height: item.height, duration: item.duration, poster: poster?.hash)
        return [main] + (poster.map { [$0] } ?? [])
    }
}
