@preconcurrency import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import CoreText
import FractonicaKit
import Foundation
import ImageIO
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// One camera's film of a moment (`MomentCamera.record`): a movie file, and the Unix time of its first frame.
struct MomentFilm: Sendable {
    let camera: String
    let url: URL
    /// Unix time of the file's time zero.
    let start: Double
}

/// What a reel shows besides the film: the moment, the clip's centre and half-length, the words.
struct MomentReelScript: Sendable {
    /// The moment's time (Unix): the countdown's zero.
    let moment: Double
    /// The clip's centre (the moment; later for a capture opened after the moment had passed): the slowest frame.
    let center: Double
    /// Half the clip: half a Flavon, in seconds.
    let half: Double
    /// A Preon's length around the moment, in seconds: the countdown's unit.
    let preon: Double
    /// "Helion 61η Descending Node", led by its Pentad.
    let title: String
    let notation: Notation
    /// Pure mode: no Earth time on the frames.
    let pure: Bool
    let zone: TimeZone
    /// The moment's rarity colour (RGB 0 … 1): the countdown at the moment.
    let accent: [Double]
    /// Each camera's square, in pixels.
    let side: Int
}

/// Makes a moment's reel (MomentReel.swift has its arithmetic) from the cameras' films: first every frame of the back
/// camera with the front camera's frame of the same instant over it, as squares (the selfie on top), kept as JPEG files;
/// then the reel at 30 frames a second, each frame the filmed instant `MomentReelTiming` says (two neighbouring frames
/// blended where the slowing shows each for several), with the stamp at the top, the countdown in Preons at the foot,
/// and a click at the moment in each pass. Without films (the Simulator, a Mac without a camera) a drawn film of the
/// same span stands in, so the whole capture runs there. Runs off the main thread; `progress` hears 0 … 1.
enum MomentReelRenderer {
    enum Failure: LocalizedError {
        case writer(String)
        case nothing

        var errorDescription: String? {
            switch self {
            case .writer(let reason): "Could not make the reel: \(reason)"
            case .nothing: "Nothing was filmed"
            }
        }
    }

    /// Filmed frames a second of the drawn stand-in.
    static let standInRate = 60.0

    static func render(films: [MomentFilm], script: MomentReelScript, to url: URL,
                       progress: @escaping @Sendable (Double) -> Void) async throws {
        try await Task.detached(priority: .userInitiated) {
            let dir = FileManager.default.temporaryDirectory.appending(path: "reel-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: dir) }
            let context = CIContext(options: [.cacheIntermediates: false])
            let developed = try await develop(films: films, script: script, dir: dir, context: context) { progress(0.45 * $0) }
            try await write(developed, script: script, dir: dir, to: url, context: context) { progress(0.45 + 0.55 * $0) }
        }.value
    }

    // MARK: Developing: the films as stacked squares, one JPEG per filmed instant

    struct Developed {
        /// Each frame's source time (seconds from the clip's centre), in order.
        var times: [Double]
        /// Both cameras (the frames are two squares high) or one.
        var dual: Bool
    }

    private static func develop(films: [MomentFilm], script: MomentReelScript, dir: URL, context: CIContext,
                                progress: (Double) -> Void) async throws -> Developed {
        // the back camera drives (the frame under), the front one rides on it; drawn stand-ins without films
        let ordered = films.sorted { a, b in a.camera == "back" || (a.camera != "front" && b.camera == "front") }
        var sources: [any ReelSource] = []
        for film in ordered { sources.append(try await FilmSource.open(film, center: script.center)) }
        if sources.isEmpty {
            sources = [StandIn(camera: "back", script: script), StandIn(camera: "front", script: script)]
        }
        let dual = sources.count > 1
        let side = CGFloat(script.side)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        var main = sources[0]
        var rider: (any ReelSource)? = dual ? sources[1] : nil
        var riderNow = rider?.next()
        var riderNext = rider?.next()
        var times: [Double] = []
        let lead = script.half + 0.05
        while let frame = main.next() {
            try Task.checkCancellation()
            if frame.u < -lead { continue }
            if frame.u > lead { break }
            // the front camera's latest frame at or before this one
            while let n = riderNext, n.u <= frame.u + 0.002 {
                riderNow = n
                riderNext = rider?.next()
            }
            var image = square(frame.image, side: side)
            if dual, let top = riderNow?.image {
                image = square(top, side: side).transformed(by: CGAffineTransform(translationX: 0, y: side)).composited(over: image)
            }
            let file = dir.appending(path: String(format: "f%05d.jpg", times.count))
            try context.writeJPEGRepresentation(of: image.cropped(to: CGRect(x: 0, y: 0, width: side, height: dual ? 2 * side : side)),
                                                to: file, colorSpace: space,
                                                options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.85])
            times.append(frame.u)
            progress(min(1, (frame.u + lead) / (2 * lead)))
        }
        guard !times.isEmpty else { throw Failure.nothing }
        return Developed(times: times, dual: dual)
    }

    /// The centre square of a frame, scaled to `side` and moved to the origin.
    private static func square(_ image: CIImage, side: CGFloat) -> CIImage {
        let e = image.extent
        let d = min(e.width, e.height)
        let crop = CGRect(x: e.midX - d / 2, y: e.midY - d / 2, width: d, height: d)
        return image.cropped(to: crop)
            .transformed(by: CGAffineTransform(translationX: -crop.minX, y: -crop.minY))
            .transformed(by: CGAffineTransform(scaleX: side / d, y: side / d))
    }

    // MARK: Writing the reel

    private static let sampleRate = 48_000.0

    private static func write(_ developed: Developed, script: MomentReelScript, dir: URL, to url: URL, context: CIContext,
                              progress: (Double) -> Void) async throws {
        let timing = MomentReelTiming(half: script.half)
        let width = script.side, height = developed.dual ? 2 * script.side : script.side
        try? FileManager.default.removeItem(at: url)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
        let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: width * height * 4],
        ])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
        ])
        var asbd = AudioStreamBasicDescription(mSampleRate: sampleRate, mFormatID: kAudioFormatLinearPCM,
                                               mFormatFlags: kLinearPCMFormatFlagIsFloat | kLinearPCMFormatFlagIsPacked,
                                               mBytesPerPacket: 4, mFramesPerPacket: 1, mBytesPerFrame: 4, mChannelsPerFrame: 1,
                                               mBitsPerChannel: 32, mReserved: 0)
        var format: CMAudioFormatDescription?
        CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0,
                                       magicCookie: nil, extensions: nil, formatDescriptionOut: &format)
        let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
        ], sourceFormatHint: format)
        guard let format, writer.canAdd(video), writer.canAdd(audio) else { throw Failure.writer("no inputs") }
        writer.add(video)
        writer.add(audio)
        guard writer.startWriting() else { throw Failure.writer(writer.error?.localizedDescription ?? "?") }
        writer.startSession(atSourceTime: .zero)

        let sound = clicks(at: timing.moments, duration: timing.duration)
        var heard = 0 // samples appended
        var heardAll = false
        func feedAudio(until seconds: Double) {
            let limit = min(sound.count, Int(seconds * sampleRate))
            while heard < limit, audio.isReadyForMoreMediaData {
                let n = min(4800, sound.count - heard)
                guard let buffer = audioBuffer(sound, from: heard, count: n, format: format) else { break }
                audio.append(buffer)
                heard += n
            }
            // finished as soon as it is all in: the writer otherwise holds the picture's last half second back, waiting
            // for more sound to interleave with it
            if heard >= sound.count, !heardAll {
                audio.markAsFinished()
                heardAll = true
            }
        }

        let frames = FrameStore(dir: dir)
        let overlay = Overlay(script: script, width: width, height: height, dual: developed.dual)
        let space = CGColorSpace(name: CGColorSpace.sRGB)!
        let count = timing.frameCount
        for k in 0..<count {
            try Task.checkCancellation()
            let tau = timing.frameTime(k)
            let (x, backward) = timing.source(at: tau)
            let u = x * script.half
            let pick = MomentReelFrames.pick(developed.times, u)
            var image = try frames.image(pick.a)
            if pick.weight > 0.02, pick.b != pick.a {
                let blend = CIFilter.dissolveTransition()
                blend.inputImage = image
                blend.targetImage = try frames.image(pick.b)
                blend.time = Float(pick.weight)
                image = blend.outputImage ?? image
            }
            guard let pool = adaptor.pixelBufferPool else { throw Failure.writer(writer.error?.localizedDescription ?? "no buffers") }
            var made: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &made)
            guard let buffer = made else { throw Failure.writer("no buffer") }
            context.render(image, to: buffer, bounds: CGRect(x: 0, y: 0, width: width, height: height), colorSpace: space)
            overlay.draw(on: buffer, source: script.center + u, backward: backward)
            // the writer interleaves: audio runs a little ahead of the picture
            var waited = 0
            while !video.isReadyForMoreMediaData {
                if writer.status == .failed { throw Failure.writer(writer.error?.localizedDescription ?? "it failed") }
                feedAudio(until: tau + 1)
                try await Task.sleep(for: .milliseconds(2))
                waited += 1
                if waited > 5000 { throw Failure.writer("the video input stalled at frame \(k) of \(count), \(heard) samples heard") }
            }
            feedAudio(until: tau + 0.5)
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(k), timescale: CMTimeScale(MomentReelTiming.fps)))
            progress(Double(k + 1) / Double(count))
        }
        video.markAsFinished()
        var waited = 0
        while !heardAll {
            if writer.status == .failed { throw Failure.writer(writer.error?.localizedDescription ?? "it failed") }
            feedAudio(until: timing.duration + 1)
            if !heardAll {
                try await Task.sleep(for: .milliseconds(2))
                waited += 1
                if waited > 5000 { throw Failure.writer("the audio input stalled") }
            }
        }
        await writer.finishWriting()
        guard writer.status == .completed else { throw Failure.writer(writer.error?.localizedDescription ?? "?") }
    }

    // MARK: The clicks

    /// The reel's sound: silence with a click at each of `times` (output seconds), mono at 48 kHz.
    private static func clicks(at times: [Double], duration: Double) -> [Float] {
        var out = [Float](repeating: 0, count: Int((duration * sampleRate).rounded(.up)) + 1)
        let length = Int(0.05 * sampleRate)
        var seed: UInt32 = 0x9E37_79B9
        for t in times {
            let start = Int(t * sampleRate)
            for i in 0..<length where start + i < out.count && start + i >= 0 {
                let s = Double(i) / sampleRate
                seed = seed &* 1_664_525 &+ 1_013_904_223
                let noise = Double(Int32(bitPattern: seed)) / Double(Int32.max)
                // a struck tick: a bright ping over a lower knock, a breath of noise at the strike
                let ping = 0.5 * sin(2 * .pi * 2600 * s) * exp(-s / 0.006)
                let knock = 0.4 * sin(2 * .pi * 1100 * s) * exp(-s / 0.012)
                let strike = 0.35 * noise * exp(-s / 0.0015)
                out[start + i] += Float(0.7 * (ping + knock + strike))
            }
        }
        return out
    }

    private static func audioBuffer(_ samples: [Float], from start: Int, count: Int, format: CMAudioFormatDescription) -> CMSampleBuffer? {
        var block: CMBlockBuffer?
        let bytes = count * MemoryLayout<Float>.size
        guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes,
                                                 blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0,
                                                 dataLength: bytes, flags: 0, blockBufferOut: &block) == noErr, let block else { return nil }
        let status = samples.withUnsafeBufferPointer { p in
            CMBlockBufferReplaceDataBytes(with: p.baseAddress! + start, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes)
        }
        guard status == noErr else { return nil }
        var buffer: CMSampleBuffer?
        CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format,
                                                             sampleCount: count,
                                                             presentationTimeStamp: CMTime(value: CMTimeValue(start), timescale: CMTimeScale(sampleRate)),
                                                             packetDescriptions: nil, sampleBufferOut: &buffer)
        return buffer
    }
}

// MARK: - Sources

/// Filmed frames in order: each its time from the clip's centre and its picture.
private protocol ReelSource {
    mutating func next() -> (u: Double, image: CIImage)?
}

/// A camera's film, read frame by frame.
private struct FilmSource: ReelSource {
    let reader: AVAssetReader
    let output: AVAssetReaderTrackOutput
    /// The film's time zero, in seconds from the clip's centre.
    let zero: Double

    static func open(_ film: MomentFilm, center: Double) async throws -> FilmSource {
        let asset = AVURLAsset(url: film.url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw MomentReelRenderer.Failure.nothing }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
        ])
        output.alwaysCopiesSampleData = false
        reader.add(output)
        reader.startReading()
        return FilmSource(reader: reader, output: output, zero: film.start - center)
    }

    mutating func next() -> (u: Double, image: CIImage)? {
        while let sample = output.copyNextSampleBuffer() {
            guard let pixels = CMSampleBufferGetImageBuffer(sample) else { continue }
            let t = CMSampleBufferGetPresentationTimeStamp(sample).seconds
            return (zero + t, CIImage(cvPixelBuffer: pixels))
        }
        return nil
    }
}

/// A drawn film where there is no camera: the moment's colours, a hand sweeping a turn a second and a light gliding
/// across (the back), a ring breathing (the front), so the slowing shows.
private struct StandIn: ReelSource {
    let camera: String
    let script: MomentReelScript
    private var k = 0

    init(camera: String, script: MomentReelScript) {
        self.camera = camera
        self.script = script
    }

    mutating func next() -> (u: Double, image: CIImage)? {
        let u = -script.half - 0.05 + Double(k) / MomentReelRenderer.standInRate
        guard u <= script.half + 0.05 else { return nil }
        k += 1
        return (u, picture(at: u))
    }

    private func picture(at u: Double) -> CIImage {
        let s = CGFloat(script.side)
        let a = script.accent
        let accent = CIColor(red: a[0], green: a[1], blue: a[2])
        let deep = CIColor(red: 0.03, green: 0.04, blue: 0.06)
        let back = camera == "back"
        let ground = CIFilter.linearGradient()
        ground.point0 = CGPoint(x: 0, y: s)
        ground.point1 = CGPoint(x: back ? s * 0.3 : s, y: 0)
        ground.color0 = back ? accent : CIColor(red: 0.31, green: 0.82, blue: 0.77)
        ground.color1 = deep
        var image = ground.outputImage!.cropped(to: CGRect(x: 0, y: 0, width: s, height: s))
        let c = CGPoint(x: s / 2, y: s / 2)
        if back {
            // a hand turning once a second, clockwise from the top
            let hand = CIImage(color: CIColor(red: 1, green: 1, blue: 1, alpha: 0.92))
                .cropped(to: CGRect(x: -s * 0.012, y: 0, width: s * 0.024, height: s * 0.4))
                .transformed(by: CGAffineTransform(rotationAngle: -2 * .pi * CGFloat(u)))
                .transformed(by: CGAffineTransform(translationX: c.x, y: c.y))
            image = hand.composited(over: image)
            // a light gliding to and fro every two seconds
            let glow = CIFilter.radialGradient()
            glow.center = CGPoint(x: c.x + s * 0.34 * CGFloat(sin(.pi * u)), y: s * 0.18)
            glow.radius0 = 0
            glow.radius1 = Float(s * 0.09)
            glow.color0 = CIColor(red: 1, green: 0.95, blue: 0.8, alpha: 1)
            glow.color1 = CIColor(red: 1, green: 1, blue: 1, alpha: 0)
            image = glow.outputImage!.cropped(to: image.extent).composited(over: image)
            let pin = CIFilter.radialGradient()
            pin.center = c
            pin.radius0 = Float(s * 0.02)
            pin.radius1 = Float(s * 0.026)
            pin.color0 = CIColor(red: 1, green: 1, blue: 1, alpha: 1)
            pin.color1 = CIColor(red: 1, green: 1, blue: 1, alpha: 0)
            image = pin.outputImage!.cropped(to: image.extent).composited(over: image)
        } else {
            // a ring breathing three times in two seconds
            let r = s * (0.22 + 0.08 * CGFloat(sin(3 * .pi * u)))
            let ring = CIFilter.radialGradient()
            ring.center = c
            ring.radius0 = Float(r)
            ring.radius1 = Float(r + s * 0.03)
            ring.color0 = CIColor(red: 1, green: 1, blue: 1, alpha: 0.9)
            ring.color1 = CIColor(red: 1, green: 1, blue: 1, alpha: 0)
            let inside = CIFilter.radialGradient()
            inside.center = c
            inside.radius0 = Float(r - s * 0.03)
            inside.radius1 = Float(r)
            inside.color0 = CIColor(red: 1, green: 1, blue: 1, alpha: 0)
            inside.color1 = CIColor(red: 1, green: 1, blue: 1, alpha: 0.9)
            let band = CIFilter.minimumCompositing()
            band.inputImage = ring.outputImage
            band.backgroundImage = inside.outputImage
            image = band.outputImage!.cropped(to: image.extent).composited(over: image)
        }
        return image
    }
}

// MARK: - Developed frames

/// The developed frames, decoded on demand, the last few kept.
private final class FrameStore {
    let dir: URL
    private var cache: [(index: Int, image: CIImage)] = []

    init(dir: URL) { self.dir = dir }

    func image(_ index: Int) throws -> CIImage {
        if let i = cache.firstIndex(where: { $0.index == index }) {
            let hit = cache.remove(at: i)
            cache.insert(hit, at: 0)
            return hit.image
        }
        let url = dir.appending(path: String(format: "f%05d.jpg", index))
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let cg = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
        else { throw MomentReelRenderer.Failure.writer("a developed frame is unreadable") }
        let image = CIImage(cgImage: cg)
        cache.insert((index, image), at: 0)
        if cache.count > 4 { cache.removeLast() }
        return image
    }
}

// MARK: - The words on the frames

/// The stamp at the top (the frame's instant down to the Blink, the moment's name and, outside pure mode, the Earth
/// time to the hundredth) and the countdown in Preons at the foot, drawn straight into each frame.
private struct Overlay {
    let script: MomentReelScript
    let width: Int
    let height: Int
    let dual: Bool
    private let earth: DateFormatter

    init(script: MomentReelScript, width: Int, height: Int, dual: Bool) {
        self.script = script
        self.width = width
        self.height = height
        self.dual = dual
        earth = DateFormatter()
        earth.locale = Locale(identifier: "en_US_POSIX")
        earth.timeZone = script.zone
        earth.dateFormat = "HH:mm:ss.SS"
    }

    func draw(on buffer: CVPixelBuffer, source t: Double, backward: Bool) {
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let base = CVPixelBufferGetBaseAddress(buffer),
              let ctx = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return }
        let w = CGFloat(width), h = CGFloat(height), s = CGFloat(script.side)
        let margin = s * 0.05
        // shades under the words, top and foot
        let shade = CGGradient(colorsSpace: nil, colors: [CGColor(gray: 0, alpha: 0.62), CGColor(gray: 0, alpha: 0)] as CFArray,
                               locations: [0, 1])!
        ctx.drawLinearGradient(shade, start: CGPoint(x: 0, y: h), end: CGPoint(x: 0, y: h - s * 0.24), options: [])
        ctx.drawLinearGradient(shade, start: CGPoint(x: 0, y: 0), end: CGPoint(x: 0, y: s * 0.28), options: [])
        if dual {
            // the seam between the squares
            ctx.setFillColor(CGColor(gray: 0, alpha: 1))
            ctx.fill(CGRect(x: 0, y: s - s * 0.002, width: w, height: s * 0.004))
        }
        ctx.setShadow(offset: CGSize(width: 0, height: -s * 0.002), blur: s * 0.01, color: CGColor(gray: 0, alpha: 0.7))

        // the top: the stamp, then the moment's name and the Earth time
        let stamp = script.notation.stamp(at: t, upTo: "nu")
        let stampFont = Self.font(size: s * 0.046, weight: .semibold, mono: true)
        let stampLine = Self.line(stamp, font: Self.fitting(stamp, font: stampFont, width: w - 2 * margin), color: CGColor(gray: 1, alpha: 1))
        Self.draw(stampLine, in: ctx, centeredAt: w / 2, baseline: h - margin - s * 0.042)
        var second = script.title
        if !script.pure { second += "  ·  " + earth.string(from: Date(timeIntervalSince1970: t)) }
        let secondFont = Self.font(size: s * 0.03, weight: .medium, mono: true)
        let secondLine = Self.line(second, font: Self.fitting(second, font: secondFont, width: w - 2 * margin),
                                   color: CGColor(gray: 1, alpha: 0.82))
        Self.draw(secondLine, in: ctx, centeredAt: w / 2, baseline: h - margin - s * 0.092)

        // the foot: the countdown in Preons, and what it counts
        let offset = t - script.moment
        let count = MomentReelText.countdown(seconds: offset, preon: script.preon)
        let atMoment = abs(offset) < 0.02
        let a = script.accent
        let color = atMoment ? CGColor(red: a[0], green: a[1], blue: a[2], alpha: 1) : CGColor(gray: 1, alpha: 1)
        let countLine = Self.line(count, font: Self.font(size: s * 0.1, weight: .semibold, mono: true), color: color)
        Self.draw(countLine, in: ctx, centeredAt: w / 2, baseline: margin + s * 0.06)
        let caption = (backward ? "◀◀  " : "") + (atMoment ? "THE MOMENT" : offset < 0 ? "PREONS TO THE MOMENT" : "PREONS SINCE THE MOMENT")
        let captionLine = Self.line(caption, font: Self.font(size: s * 0.026, weight: .bold, mono: false), color: CGColor(gray: 1, alpha: 0.75),
                                    kern: s * 0.004)
        Self.draw(captionLine, in: ctx, centeredAt: w / 2, baseline: margin + s * 0.17)
    }

    private static func font(size: CGFloat, weight: PlatformFont.Weight, mono: Bool) -> CTFont {
        let font = mono ? PlatformFont.monospacedDigitSystemFont(ofSize: size, weight: weight) : PlatformFont.systemFont(ofSize: size, weight: weight)
        return font as CTFont
    }

    /// The font, smaller as needed for `text` to fit `width`.
    private static func fitting(_ text: String, font: CTFont, width: CGFloat) -> CTFont {
        let natural = CTLineGetTypographicBounds(line(text, font: font, color: CGColor(gray: 1, alpha: 1)), nil, nil, nil)
        guard natural > width, natural > 0 else { return font }
        return CTFontCreateCopyWithAttributes(font, CTFontGetSize(font) * width / natural, nil, nil)
    }

    private static func line(_ text: String, font: CTFont, color: CGColor, kern: CGFloat = 0) -> CTLine {
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
            NSAttributedString.Key(kCTKernAttributeName as String): kern,
        ]
        return CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
    }

    private static func draw(_ line: CTLine, in ctx: CGContext, centeredAt x: CGFloat, baseline y: CGFloat) {
        let width = CTLineGetTypographicBounds(line, nil, nil, nil)
        ctx.textPosition = CGPoint(x: x - width / 2, y: y)
        CTLineDraw(line, ctx)
    }
}

#if os(iOS)
private typealias PlatformFont = UIFont
#else
private typealias PlatformFont = NSFont
#endif
