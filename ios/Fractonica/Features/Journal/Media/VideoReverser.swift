@preconcurrency import AVFoundation
import Foundation
import VideoToolbox

/// Makes a video's reverse: its frames from the last to the first, each shown as long as it was going forward, and its
/// sound backwards. The frames are read a stretch at a time from the end (`VideoFrameReader`), each stretch held while
/// it is written backwards, so the memory it takes is one stretch's (about 60 MB of pictures) whatever the video's
/// length; the sound is read whole. HEVC at the video's own size and colours (10-bit stays 10-bit), turned as it was,
/// at its own bit rate; the sound AAC as it was. Both are reversed about the picture's end (its last frame first, at
/// zero; sound past the picture's end left out), so they stay together.
enum VideoReverser {
    /// The reversed copy's name among an entry's media (hub/API.md).
    static let name = "reversed"

    enum Failure: LocalizedError {
        case noVideo
        case writer(String)

        var errorDescription: String? {
            switch self {
            case .noVideo: "There is no video in it"
            case .writer(let reason): "Could not write the reversed video: \(reason)"
            }
        }
    }

    /// Writes `url` reversed to `out` (a .mov); `progress` hears 0 … 1. Runs off the main thread.
    static func reverse(_ url: URL, to out: URL, progress: @escaping @Sendable (Double) -> Void = { _ in }) async throws {
        try await Task.detached(priority: .userInitiated) {
            try await make(url, to: out, progress: progress)
        }.value
    }

    private static func make(_ url: URL, to out: URL, progress: @escaping @Sendable (Double) -> Void) async throws {
        let asset = AVURLAsset(url: url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { throw Failure.noVideo }
        let (range, rate, natural, transform, dataRate, formats) = try await track.load(
            .timeRange, .nominalFrameRate, .naturalSize, .preferredTransform, .estimatedDataRate, .formatDescriptions)
        let start = range.start.seconds, end = range.end.seconds
        let fps = Double(max(rate, 1))
        let ext = formats.first.flatMap { CMFormatDescriptionGetExtensions($0) as? [String: Any] } ?? [:]
        let tenBit = (ext[kCMFormatDescriptionExtension_BitsPerComponent as String] as? Int ?? 8) > 8
        let stretch = min(2, max(0.2, 60e6 / (Double(natural.width * natural.height) * (tenBit ? 3 : 1.5) * fps)))

        try? FileManager.default.removeItem(at: out)
        let writer = try AVAssetWriter(outputURL: out, fileType: .mov)
        var compression: [String: Any] = [
            AVVideoAverageBitRateKey: max(Int(dataRate), 2_000_000),
            AVVideoExpectedSourceFrameRateKey: Int(fps.rounded()),
        ]
        if tenBit { compression[AVVideoProfileLevelKey] = kVTProfileLevel_HEVC_Main10_AutoLevel as String }
        var settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: Int(natural.width.rounded()),
            AVVideoHeightKey: Int(natural.height.rounded()),
            AVVideoCompressionPropertiesKey: compression,
        ]
        if let primaries = ext[kCMFormatDescriptionExtension_ColorPrimaries as String] as? String,
           let transfer = ext[kCMFormatDescriptionExtension_TransferFunction as String] as? String,
           let matrix = ext[kCMFormatDescriptionExtension_YCbCrMatrix as String] as? String {
            settings[AVVideoColorPropertiesKey] = [AVVideoColorPrimariesKey: primaries, AVVideoTransferFunctionKey: transfer,
                                                   AVVideoYCbCrMatrixKey: matrix]
        }
        let video = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        video.transform = transform
        video.expectsMediaDataInRealTime = false
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: nil)
        guard writer.canAdd(video) else { throw Failure.writer("no video input") }
        writer.add(video)

        var sound = try await samples(asset, about: end)
        var audio: AVAssetWriterInput?
        if let s = sound {
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: s.rate,
                AVNumberOfChannelsKey: s.channels,
                AVEncoderBitRateKey: s.channels == 1 ? 96_000 : 160_000,
            ], sourceFormatHint: s.format)
            input.expectsMediaDataInRealTime = false
            if writer.canAdd(input) {
                writer.add(input)
                audio = input
            }
        }
        guard writer.startWriting() else { throw Failure.writer(writer.error?.localizedDescription ?? "?") }
        writer.startSession(atSourceTime: .zero)

        // the sound fed along with the picture (a writer holds the one back that runs too far ahead of the other)
        var fed = 0
        func feedAudio(until seconds: Double) {
            guard let audio, let s = sound else { return }
            let limit = min(s.frames, max(0, Int((seconds - s.offset) * s.rate)))
            while fed < limit, audio.isReadyForMoreMediaData {
                let n = min(4096, s.frames - fed)
                guard let buffer = s.buffer(from: fed, count: n) else { break }
                audio.append(buffer)
                fed += n
            }
            if fed >= s.frames, audio.isReadyForMoreMediaData {
                audio.markAsFinished()
                sound = nil
            }
        }

        // the frames, stretch by stretch from the end; each shown from where the frame after it ended
        var next = end
        var b = end
        let pixelFormat = tenBit ? kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        while b > start + 1e-6 {
            try Task.checkCancellation()
            let a = max(start, b - stretch)
            var reader = VideoFrameReader(asset: asset, track: track, from: a, onFrame: a <= start, to: b, frameRate: fps, stretch: b - a + 1, copies: true,
                                          settings: [kCVPixelBufferPixelFormatTypeKey as String: pixelFormat])
            var held: [(time: Double, pixels: CVPixelBuffer)] = []
            while let frame = autoreleasepool(invoking: { reader.next() }) { held.append(frame) }
            for frame in held.reversed() {
                let at = end - next
                next = frame.time
                let waiting = Date.now
                while !video.isReadyForMoreMediaData {
                    if writer.status == .failed { throw Failure.writer(writer.error?.localizedDescription ?? "it failed") }
                    let waited = -waiting.timeIntervalSinceNow
                    feedAudio(until: at + 1 + min(waited, 4))
                    try await Task.sleep(for: .milliseconds(2))
                    if waited > 30 { throw Failure.writer("the video input stalled") }
                }
                feedAudio(until: at + 0.5)
                guard adaptor.append(frame.pixels, withPresentationTime: CMTime(seconds: at, preferredTimescale: 600_000)) else {
                    throw Failure.writer(writer.error?.localizedDescription ?? "a frame was refused")
                }
            }
            b = a
            progress(min(1, (end - b) / max(end - start, 0.001)))
        }
        video.markAsFinished()
        let ending = Date.now
        while sound != nil {
            if writer.status == .failed { throw Failure.writer(writer.error?.localizedDescription ?? "it failed") }
            feedAudio(until: end + 1)
            if sound != nil {
                try await Task.sleep(for: .milliseconds(2))
                if -ending.timeIntervalSinceNow > 30 { throw Failure.writer("the audio input stalled") }
            }
        }
        await writer.finishWriting()
        guard writer.status == .completed else { throw Failure.writer(writer.error?.localizedDescription ?? "?") }
    }

    // MARK: The sound

    /// A sound read whole and reversed: interleaved Float32 frames, where its first frame now goes (seconds), its format.
    private struct Reversed {
        var data: [Float]
        var rate: Double
        var channels: Int
        var offset: Double
        var format: CMAudioFormatDescription

        var frames: Int { data.count / channels }

        /// `count` frames from `from` as a sample buffer at its place in the reversed sound.
        func buffer(from: Int, count: Int) -> CMSampleBuffer? {
            var block: CMBlockBuffer?
            let bytes = count * channels * MemoryLayout<Float>.size
            guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes,
                                                     blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0,
                                                     dataLength: bytes, flags: 0, blockBufferOut: &block) == noErr, let block else { return nil }
            let status = data.withUnsafeBufferPointer { p in
                CMBlockBufferReplaceDataBytes(with: p.baseAddress! + from * channels, blockBuffer: block, offsetIntoDestination: 0,
                                              dataLength: bytes)
            }
            guard status == noErr else { return nil }
            var buffer: CMSampleBuffer?
            let time = CMTime(seconds: offset + Double(from) / rate, preferredTimescale: CMTimeScale(rate))
            CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format,
                                                                 sampleCount: count, presentationTimeStamp: time,
                                                                 packetDescriptions: nil, sampleBufferOut: &buffer)
            return buffer
        }
    }

    /// The asset's sound reversed about `end`, the picture's end (nil without sound).
    private static func samples(_ asset: AVAsset, about end: Double) async throws -> Reversed? {
        guard let track = try await asset.loadTracks(withMediaType: .audio).first else { return nil }
        let (range, formats) = try await track.load(.timeRange, .formatDescriptions)
        let source = formats.first.flatMap { CMAudioFormatDescriptionGetStreamBasicDescription($0)?.pointee }
        let rate = source.map { $0.mSampleRate > 0 ? $0.mSampleRate : 48_000 } ?? 48_000
        let channels = min(2, max(1, Int(source?.mChannelsPerFrame ?? 1)))
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
            AVSampleRateKey: rate,
            AVNumberOfChannelsKey: channels,
        ])
        reader.add(output)
        guard reader.startReading() else { return nil }
        var data: [Float] = []
        var first: Double?
        while let buffer = output.copyNextSampleBuffer() {
            try Task.checkCancellation()
            guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
            if first == nil { first = CMSampleBufferGetPresentationTimeStamp(buffer).seconds }
            let length = CMBlockBufferGetDataLength(block)
            let at = data.count
            data.append(contentsOf: repeatElement(0, count: length / MemoryLayout<Float>.size))
            data.withUnsafeMutableBytes { raw in
                _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: raw.baseAddress! + at * MemoryLayout<Float>.size)
            }
        }
        let frames = data.count / channels
        guard frames > 0 else { return nil }
        // frame by frame, its channels kept in order
        data.withUnsafeMutableBufferPointer { p in
            var i = 0, j = frames - 1
            while i < j {
                for c in 0..<channels { p.swapAt(i * channels + c, j * channels + c) }
                i += 1
                j -= 1
            }
        }
        var asbd = AudioStreamBasicDescription(mSampleRate: rate, mFormatID: kAudioFormatLinearPCM,
                                               mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked,
                                               mBytesPerPacket: UInt32(4 * channels), mFramesPerPacket: 1,
                                               mBytesPerFrame: UInt32(4 * channels), mChannelsPerFrame: UInt32(channels),
                                               mBitsPerChannel: 32, mReserved: 0)
        var format: CMAudioFormatDescription?
        CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &asbd, layoutSize: 0, layout: nil, magicCookieSize: 0,
                                       magicCookie: nil, extensions: nil, formatDescriptionOut: &format)
        guard let format else { return nil }
        // where the sound ended going forward is where it starts going back: what ran past the picture left out
        let soundEnd = (first ?? range.start.seconds) + Double(frames) / rate
        let past = max(0, Int(((soundEnd - end) * rate).rounded()))
        guard past < frames else { return nil }
        if past > 0 { data.removeFirst(past * channels) }
        return Reversed(data: data, rate: rate, channels: channels, offset: max(0, end - soundEnd), format: format)
    }
}
