@preconcurrency import AVFoundation
import Foundation

/// A video track's frames in presentation order, read a stretch of a few seconds at a time, each stretch by an
/// `AVAssetReader` of its own. A reader that stops before its stretch's end (on the iPhone one stopped for good ~500
/// frames into a long film, with no error) is opened again just past the last frame it gave, up to three times in a
/// row. With `copies` the pictures are copies, so the decoder never waits for the ones the caller holds a while (not
/// for Core Image: the copies it is given stay with it). Used by the moments' reels (`MomentReelRenderer`) and
/// `VideoReverser`.
///
/// A reader whose range starts inside a frame gives that frame first, its time cut to the range's start. So each
/// stretch's reader reads a few frames past the stretch, to learn where the next frame starts, and the next stretch's
/// reader starts exactly there; a reader that has to start elsewhere (opened again, or after a gap) skips a first frame
/// timed exactly at its start.
struct VideoFrameReader {
    let asset: AVAsset
    let track: AVAssetTrack
    /// The span read, in the track's own seconds.
    let start: Double
    let end: Double
    /// How long each reader reads.
    let stretch: Double
    /// Three frames: how far past a stretch its reader looks, and how short of it the frames may stop.
    let slack: Double
    let settings: [String: Any]
    let copies: Bool

    private var reader: AVAssetReader?
    private var output: AVAssetReaderTrackOutput?
    /// The stretch being read.
    private var stretchStart: Double
    private var stretchEnd: Double
    /// The first frame past the stretch: where the next one starts.
    private var nextStart: CMTime?
    /// A frame timed exactly here is one given already (a reader started inside it).
    private var cut: Double?
    /// The last frame's time: what was read so far.
    private var last: Double?
    private var retries = 0
    /// What went amiss ("stopped at 22.31 s (no error), read again from there").
    private(set) var troubles: [String] = []
    /// Frames given, readers opened, samples without a picture.
    private(set) var frames = 0
    private(set) var readers = 0
    private(set) var empty = 0

    /// Reads `track` from `start` to `end` (seconds), `stretch` seconds a reader, in the pixel format `settings` asks for.
    /// `start` is where a frame starts (the track's own start) when `onFrame`; otherwise a frame it cuts is left out.
    init(asset: AVAsset, track: AVAssetTrack, from start: Double = 0, onFrame: Bool = false, to end: Double, frameRate: Double,
         stretch: Double = 4, copies: Bool = false,
         settings: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]) {
        self.asset = asset
        self.track = track
        self.start = start
        self.end = end
        self.stretch = max(stretch, 0.1)
        slack = 3 / max(frameRate, 1)
        self.settings = settings
        self.copies = copies
        stretchStart = start
        stretchEnd = start
        if onFrame { nextStart = CMTime(seconds: start, preferredTimescale: 600_000) }
    }

    /// Opens `asset`'s first video track for reading, all of it.
    static func open(_ asset: AVAsset, stretch: Double = 4) async throws -> VideoFrameReader? {
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { return nil }
        let (range, rate) = try await track.load(.timeRange, .nominalFrameRate)
        return VideoFrameReader(asset: asset, track: track, from: range.start.seconds, onFrame: true, to: range.end.seconds,
                                frameRate: Double(rate), stretch: stretch)
    }

    /// The next frame: its time in the track and its picture; nil at the end.
    mutating func next() -> (time: Double, pixels: CVPixelBuffer)? {
        while true {
            if let output, let sample = output.copyNextSampleBuffer() {
                guard let pixels = CMSampleBufferGetImageBuffer(sample) else {
                    empty += 1
                    continue
                }
                let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                let t = pts.seconds
                if let c = cut, abs(t - c) < 1e-6 {
                    cut = nil
                    continue
                }
                cut = nil
                if t >= stretchEnd {
                    if nextStart == nil { nextStart = pts }
                    continue
                }
                if t < start - 1e-6 || last.map({ t <= $0 + 1e-6 }) == true { continue }
                last = t
                retries = 0
                frames += 1
                return (t, pixels)
            }
            // this stretch's reader is done: read to the stretch's end, or stopped short of it
            let reached = last ?? stretchStart
            if reader != nil, stretchEnd - reached > slack, reached < end - slack, nextStart == nil {
                let status = reader?.status == .failed ? (reader?.error?.localizedDescription ?? "failed") : "no error"
                if retries < 3 {
                    retries += 1
                    troubles.append(String(format: "stopped at %.2f s (%@), read again from there", reached, status))
                    begin(from: CMTime(seconds: reached + 0.001, preferredTimescale: 600_000), known: false, until: stretchEnd)
                    continue
                }
                // nothing more in this stretch (a stretch the camera filmed nothing in): on with the next
                troubles.append(String(format: "nothing from %.2f to %.2f s", reached, stretchEnd))
                retries = 0
            }
            guard stretchEnd < end - 1e-6 else { return nil }
            let from = nextStart ?? CMTime(seconds: stretchEnd, preferredTimescale: 600_000)
            let known = nextStart != nil
            nextStart = nil
            stretchStart = from.seconds
            begin(from: from, known: known, until: min(stretchStart + stretch, end))
        }
    }

    /// A reader from `from` (a frame's own start when `known`) to past `until`, the stretch's end.
    private mutating func begin(from: CMTime, known: Bool, until: Double) {
        stretchEnd = until
        cut = known ? nil : from.seconds
        reader?.cancelReading()
        reader = nil
        output = nil
        guard let reader = try? AVAssetReader(asset: asset) else {
            troubles.append(String(format: "no reader from %.2f s", from.seconds))
            return
        }
        reader.timeRange = CMTimeRange(start: from, end: CMTime(seconds: until + slack, preferredTimescale: 600_000))
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: settings)
        output.alwaysCopiesSampleData = copies
        guard reader.canAdd(output) else { return }
        reader.add(output)
        readers += 1
        self.reader = reader
        guard reader.startReading() else {
            troubles.append(String(format: "could not read from %.2f s (%@)", from.seconds, reader.error?.localizedDescription ?? "?"))
            return
        }
        self.output = output
    }

    /// How the reading went, in a line: "2490 frames by 29 readers, none without a picture".
    var report: String {
        "\(frames) frames by \(readers) readers, \(empty == 0 ? "none" : "\(empty)") without a picture"
            + (troubles.isEmpty ? "" : "; " + troubles.joined(separator: "; "))
    }
}
