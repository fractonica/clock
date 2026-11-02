@preconcurrency import AVFoundation
import CoreImage
import CoreImage.CIFilterBuiltins
import CoreText
import FractonicaKit
import Foundation
import ImageIO
import os
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// The reel's own log (Moments' category; checked on its own, without MomentStore's).
private let reelLog = Logger(subsystem: "app.fractonica.clock", category: "moments")

/// One camera's film of a moment (`MomentCamera.record`), or the microphone's (`sound`): a file, and the Unix time of its
/// first sample.
struct MomentFilm: Sendable {
    let camera: String
    let url: URL
    /// Unix time of the file's time zero.
    let start: Double
    /// How the filming went ("back: 466 kept, 3 refused by the writer"), and the share of frames lost.
    var report: String?
    var lost = 0.0
}

/// What a reel shows besides the film: the clip's centre and half-length, its frame, the words, the colours.
struct MomentReelScript: Sendable {
    /// The clip's centre (the moment; a late film's middle): the slowest frame.
    let center: Double
    /// Seconds filmed before the centre and after it.
    let before: Double
    let after: Double
    /// The slowing's scale: half a Flavon.
    let half: Double
    /// A frame's length, filmed and shown: a Sub-blink.
    var frame = MomentReelTiming.subBlink
    let notation: Notation
    /// The moment's rarity colour (RGB 0 … 1): the drawn stand-in's.
    let accent: [Double]
    /// Each camera's square, in pixels.
    let side: Int
    /// A click at the moment in each pass (none for a film that missed its moment).
    var clicks = true
    /// Filmed after the moment had passed: marked so in red.
    var missed = false

    init(center: Double, before: Double, after: Double, half: Double, notation: Notation, accent: [Double], side: Int,
         clicks: Bool = true, missed: Bool = false) {
        self.center = center
        self.before = before
        self.after = after
        self.half = half
        self.notation = notation
        self.accent = accent
        self.side = side
        self.clicks = clicks
        self.missed = missed
    }

    /// Filmed `half` either side of the moment.
    init(center: Double, half: Double, notation: Notation, accent: [Double], side: Int) {
        self.init(center: center, before: half, after: half, half: half, notation: notation, accent: accent, side: side)
    }

    var timing: MomentReelTiming { MomentReelTiming(before: before, after: after, half: half, frame: frame) }
}

/// Makes a moment's reel (MomentReel.swift has its arithmetic) from the cameras' films: first every frame of the back
/// camera with the front camera's frame of the same instant over it, as squares (the selfie on top), kept as JPEG files;
/// then the reel a frame each Sub-blink, each frame the filmed one at the instant `MomentReelTiming` says (held where
/// the slowing shows it for several), its date and its time down to the ξ at the top; its sound the microphone's,
/// played at the picture's speed (lower as it slows, backwards going back), a click at the moment in each pass.
/// Without films (the Simulator, a Mac without a camera) a drawn film of the same span stands in, so the whole capture
/// runs there. Runs off the main thread; `progress` hears 0 … 1. Returns what went amiss in the films (a stretch
/// without frames), for the saved screen.
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

    @discardableResult
    static func render(films: [MomentFilm], script: MomentReelScript, to url: URL,
                       progress: @escaping @Sendable (Double) -> Void) async throws -> [String] {
        try await Task.detached(priority: .userInitiated) {
            let dir = FileManager.default.temporaryDirectory.appending(path: "reel-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            defer { try? FileManager.default.removeItem(at: dir) }
            let context = CIContext(options: [.cacheIntermediates: false])
            let pictures = films.filter { $0.camera != "sound" }
            var heard: Heard?
            if let sound = films.first(where: { $0.camera == "sound" }) { heard = try await samples(of: sound, center: script.center) }
            let developed = try await develop(films: pictures, script: script, dir: dir, context: context) { progress(0.45 * $0) }
            try await write(developed, heard: heard, script: script, dir: dir, to: url, context: context) { progress(0.45 + 0.55 * $0) }
            return developed.gaps
        }.value
    }

    // MARK: Developing: the films as stacked squares, one JPEG per filmed instant

    struct Developed {
        /// Each frame's source time (seconds from the clip's centre), in order.
        var times: [Double]
        /// Both cameras (the frames are two squares high) or one.
        var dual: Bool
        /// Stretches a film went without frames ("the back film has no frames for 2.9 s from +0.5 s").
        var gaps: [String] = []
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
        // each film's longest stretch without a frame: (length, from)
        var gap = [(0.0, 0.0), (0.0, 0.0)]
        var last: [Double?] = [nil, riderNow?.u]
        func note(_ i: Int, _ u: Double) {
            if let l = last[i], u - l > gap[i].0 { gap[i] = (u - l, l) }
            last[i] = u
        }
        while let frame = main.next() {
            try Task.checkCancellation()
            if frame.u < -script.before - 0.05 { continue }
            if frame.u > script.after + 0.05 { break }
            note(0, frame.u)
            // the front camera's latest frame at or before this one
            while let n = riderNext, n.u <= frame.u + 0.002 {
                riderNow = n
                note(1, n.u)
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
            progress(min(1, (frame.u + script.before) / max(script.before + script.after, 0.1)))
        }
        guard !times.isEmpty else { throw Failure.nothing }
        let names = films.isEmpty ? ["drawn", "drawn"] : ordered.map(\.camera)
        let gaps = gap.indices.compactMap { i -> String? in
            guard i < names.count, gap[i].0 > 4 * script.frame else { return nil }
            return String(format: "the %@ film has no frames for %.2f s from %+.2f s", names[i], gap[i].0, gap[i].1)
        }
        for g in gaps { reelLog.error("\(g)") }
        reelLog.info("developed \(times.count) frames, \(String(format: "%+.2f", times.first ?? 0)) … \(String(format: "%+.2f", times.last ?? 0)) s")
        return Developed(times: times, dual: dual, gaps: gaps)
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

    private static func write(_ developed: Developed, heard: Heard?, script: MomentReelScript, dir: URL, to url: URL,
                              context: CIContext, progress: (Double) -> Void) async throws {
        let timing = script.timing
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

        let sound = soundtrack(heard, timing: timing, clicks: script.clicks)
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
        let first = script.center + (developed.times.first ?? 0)
        for k in 0..<count {
            try Task.checkCancellation()
            let tau = timing.frameTime(k)
            let u = timing.source(at: tau).u
            // the filmed frame showing at u, whole: its words are its own Sub-blink's
            let shown = MomentReelFrames.pick(developed.times, u).a
            let image = try frames.image(shown)
            guard let pool = adaptor.pixelBufferPool else { throw Failure.writer(writer.error?.localizedDescription ?? "no buffers") }
            var made: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &made)
            guard let buffer = made else { throw Failure.writer("no buffer") }
            context.render(image, to: buffer, bounds: CGRect(x: 0, y: 0, width: width, height: height), colorSpace: space)
            overlay.draw(on: buffer, at: MomentReelText.readAt(script.center + developed.times[shown], first: first, frame: script.frame))
            // the writer interleaves: audio runs a little ahead of the picture, further the longer the picture waits
            // (a busy encoder, or a writer holding the picture for more sound)
            let waiting = Date.now
            while !video.isReadyForMoreMediaData {
                if writer.status == .failed { throw Failure.writer(writer.error?.localizedDescription ?? "it failed") }
                let waited = -waiting.timeIntervalSinceNow
                feedAudio(until: tau + 1 + min(waited, 4))
                try await Task.sleep(for: .milliseconds(2))
                if waited > 30 { throw Failure.writer("the video input stalled at frame \(k) of \(count), \(heard) samples heard") }
            }
            feedAudio(until: tau + 0.5)
            adaptor.append(buffer, withPresentationTime: CMTime(seconds: tau, preferredTimescale: 600_000))
            progress(Double(k + 1) / Double(count))
        }
        video.markAsFinished()
        let ending = Date.now
        while !heardAll {
            if writer.status == .failed { throw Failure.writer(writer.error?.localizedDescription ?? "it failed") }
            feedAudio(until: timing.duration + 1)
            if !heardAll {
                try await Task.sleep(for: .milliseconds(2))
                if -ending.timeIntervalSinceNow > 30 { throw Failure.writer("the audio input stalled") }
            }
        }
        await writer.finishWriting()
        guard writer.status == .completed else { throw Failure.writer(writer.error?.localizedDescription ?? "?") }
    }

    // MARK: The sound

    /// The microphone's film as samples at the reel's rate, mono, and the source time of the first.
    struct Heard {
        var first: Double
        var samples: [Float]
    }

    private static func samples(of film: MomentFilm, center: Double) async throws -> Heard? {
        let asset = AVURLAsset(url: film.url)
        guard let track = try await asset.loadTracks(withMediaType: .audio).first else { return nil }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: 1,
        ])
        reader.add(output)
        guard reader.startReading() else { return nil }
        var samples: [Float] = []
        var first: Double?
        while let buffer = output.copyNextSampleBuffer() {
            try Task.checkCancellation()
            guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
            if first == nil { first = CMSampleBufferGetPresentationTimeStamp(buffer).seconds }
            let length = CMBlockBufferGetDataLength(block)
            var chunk = [Float](repeating: 0, count: length / MemoryLayout<Float>.size)
            chunk.withUnsafeMutableBytes { raw in
                _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress!)
            }
            samples += chunk
        }
        guard !samples.isEmpty else { return nil }
        return Heard(first: film.start - center + (first ?? 0), samples: samples)
    }

    /// The reel's sound, mono at 48 kHz: the heard sound read at the picture's pace (each output sample takes the
    /// source instant its time shows, between two samples by their nearness: lower and slower as the picture slows,
    /// backwards going back), and a click at each moment (`clicks`).
    private static func soundtrack(_ heard: Heard?, timing: MomentReelTiming, clicks: Bool) -> [Float] {
        var out = [Float](repeating: 0, count: Int((timing.duration * sampleRate).rounded(.up)) + 1)
        if let heard, heard.samples.count > 1 {
            let last = heard.samples.count - 1
            heard.samples.withUnsafeBufferPointer { s in
                for i in out.indices {
                    let u = timing.source(at: Double(i) / sampleRate).u
                    let p = (u - heard.first) * sampleRate
                    guard p >= 0, p < Double(last) else { continue }
                    let j = Int(p)
                    let f = Float(p - Double(j))
                    out[i] = s[j] + (s[j + 1] - s[j]) * f
                }
            }
        }
        if clicks { addClicks(&out, at: timing.moments) }
        for i in out.indices { out[i] = min(1, max(-1, out[i])) }
        return out
    }

    /// A click at each of `times` (output seconds), over what is there.
    private static func addClicks(_ out: inout [Float], at times: [Double]) {
        let length = Int(0.05 * sampleRate)
        var seed: UInt32 = 0x9E37_79B9
        for t in times {
            let start = Int(t * sampleRate)
            for i in 0..<length where start + i < out.count && start + i >= 0 {
                let s = Double(i) / sampleRate
                seed = seed &* 1_664_525 &+ 1_013_904_223
                let noise = Double(Int32(bitPattern: seed)) / Double(Int32.max)
                // a soft tick: a short ping over a lower knock, a breath of noise at the strike
                let ping = 0.5 * sin(2 * .pi * 2000 * s) * exp(-s / 0.003)
                let knock = 0.4 * sin(2 * .pi * 900 * s) * exp(-s / 0.007)
                let strike = 0.2 * noise * exp(-s / 0.001)
                out[start + i] += Float(0.28 * (ping + knock + strike))
            }
        }
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
        let u = -script.before - 0.05 + Double(k) * script.frame
        guard u <= script.after + 0.05 else { return nil }
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

/// The frame's instant at the top, drawn straight into each frame: its date ("α6 β4 γ9 δ4 ε1") over its time down to
/// the Sub-blink ("62η 4ι 29λ 4ν 3ξ").
private struct Overlay {
    let script: MomentReelScript
    let width: Int
    let height: Int
    let dual: Bool

    func draw(on buffer: CVPixelBuffer, at t: Double) {
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let base = CVPixelBufferGetBaseAddress(buffer),
              let ctx = CGContext(data: base, width: width, height: height, bitsPerComponent: 8,
                                  bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        else { return }
        let w = CGFloat(width), h = CGFloat(height), s = CGFloat(script.side)
        let margin = s * 0.05
        // a shade under the words
        let shade = CGGradient(colorsSpace: nil, colors: [CGColor(gray: 0, alpha: 0.62), CGColor(gray: 0, alpha: 0)] as CFArray,
                               locations: [0, 1])!
        ctx.drawLinearGradient(shade, start: CGPoint(x: 0, y: h), end: CGPoint(x: 0, y: h - s * 0.27), options: [])
        if dual {
            // the seam between the squares
            ctx.setFillColor(CGColor(gray: 0, alpha: 1))
            ctx.fill(CGRect(x: 0, y: s - s * 0.002, width: w, height: s * 0.004))
        }
        ctx.setShadow(offset: CGSize(width: 0, height: -s * 0.002), blur: s * 0.01, color: CGColor(gray: 0, alpha: 0.7))

        // the date, then the time
        let date = MomentReelText.date(at: t, notation: script.notation)
        let dateFont = Self.font(size: s * 0.04, weight: .medium, mono: true)
        Self.draw(Self.line(date, font: Self.fitting(date, font: dateFont, width: w - 2 * margin), color: CGColor(gray: 1, alpha: 0.82)),
                  in: ctx, centeredAt: w / 2, baseline: h - margin - s * 0.035)
        let time = MomentReelText.time(at: t, notation: script.notation)
        let timeFont = Self.font(size: s * 0.075, weight: .semibold, mono: true)
        Self.draw(Self.line(time, font: Self.fitting(time, font: timeFont, width: w - 2 * margin), color: CGColor(gray: 1, alpha: 1)),
                  in: ctx, centeredAt: w / 2, baseline: h - margin - s * 0.125)
        if script.missed {
            // a red tag under the time: filmed after the moment had passed
            ctx.setShadow(offset: .zero, blur: 0, color: nil)
            let tag = Self.line(MomentReelText.missed, font: Self.font(size: s * 0.036, weight: .heavy, mono: false),
                                color: CGColor(gray: 1, alpha: 1), kern: s * 0.006)
            let width = CTLineGetTypographicBounds(tag, nil, nil, nil) + s * 0.05
            let pill = CGRect(x: w / 2 - width / 2, y: h - margin - s * 0.215, width: width, height: s * 0.058)
            ctx.setFillColor(CGColor(red: 0.92, green: 0.18, blue: 0.2, alpha: 0.95))
            ctx.addPath(CGPath(roundedRect: pill, cornerWidth: pill.height / 2, cornerHeight: pill.height / 2, transform: nil))
            ctx.fillPath()
            Self.draw(tag, in: ctx, centeredAt: w / 2, baseline: pill.minY + pill.height * 0.3)
        }
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
