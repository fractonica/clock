@preconcurrency import AVFoundation
import Foundation
import Observation
import SwiftUI

/// The one voice note playing anywhere in the Journal (a card's pill, the detail's player, the composer): starting
/// another stops the first. Real-world playback on the device clock, not the Fractonica clock.
@MainActor @Observable
final class JournalAudioPlayer {
    static let shared = JournalAudioPlayer()

    /// The blob hash of the note loaded, if any.
    private(set) var current: String?
    private(set) var isPlaying = false
    private(set) var duration: Double = 0
    /// Playback speed: 1, 1.25, 1.5, 2 (and 0.75).
    var rate: Float = 1 {
        didSet { player?.rate = rate }
    }

    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var delegate: Delegate?

    /// Where playback stands, in seconds (read it in a `TimelineView` while playing).
    var currentTime: Double { player?.currentTime ?? 0 }

    func isCurrent(_ hash: String) -> Bool { current == hash }

    /// Plays the note, or pauses it when it is the one playing.
    func toggle(_ hash: String) {
        if current == hash, let player {
            if player.isPlaying { pause() } else { resume() }
            return
        }
        play(hash)
    }

    func play(_ hash: String, at time: Double = 0) {
        stop()
        if JournalStore.shared.blobFile(hash) == nil, let fetch = JournalHooks.fetchBlob {
            // not on this device yet: download it, then play (unless something else started meanwhile)
            current = hash
            Task {
                guard (try? await fetch(hash)) != nil, current == hash, player == nil else { return }
                start(hash, at: time)
            }
            return
        }
        start(hash, at: time)
    }

    private func start(_ hash: String, at time: Double) {
        guard let url = JournalStore.shared.blobFile(hash), let player = try? AVAudioPlayer(contentsOf: url) else { return }
        Self.activateSession()
        let delegate = Delegate { [weak self] in self?.finished() }
        player.delegate = delegate
        player.enableRate = true
        player.rate = rate
        player.currentTime = time
        player.prepareToPlay()
        player.play()
        self.player = player
        self.delegate = delegate
        current = hash
        duration = player.duration
        isPlaying = true
    }

    func pause() {
        player?.pause()
        isPlaying = false
    }

    func resume() {
        Self.activateSession()
        player?.play()
        isPlaying = player != nil
    }

    func seek(to time: Double) {
        guard let player else { return }
        player.currentTime = min(max(0, time), player.duration)
    }

    func skip(_ seconds: Double) { seek(to: currentTime + seconds) }

    func stop() {
        player?.stop()
        player = nil
        delegate = nil
        current = nil
        isPlaying = false
    }

    private func finished() {
        isPlaying = false
        player?.currentTime = 0
    }

    /// Playback through the speaker even with the ringer switch silent; leaves the session alone while recording or
    /// while the Sound feature already set it up for playback.
    static func activateSession() {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        if session.category != .playback && session.category != .playAndRecord {
            try? session.setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers])
        }
        try? session.setActive(true)
        #endif
    }

    private final class Delegate: NSObject, AVAudioPlayerDelegate, @unchecked Sendable {
        let onFinish: @MainActor () -> Void
        init(onFinish: @escaping @MainActor () -> Void) { self.onFinish = onFinish }

        nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
            Task { @MainActor in self.onFinish() }
        }
    }
}

/// Peaks of a voice note for its waveform: the loudest sample in each of `count` equal slices, 0 … 1, read off the
/// main thread and cached by hash.
enum AudioWaveform {
    private nonisolated(unsafe) static let cache = NSCache<NSString, NSArray>()

    static func cached(_ hash: String, count: Int) -> [Float]? {
        (cache.object(forKey: "\(hash)#\(count)" as NSString) as? [Float])
    }

    static func peaks(_ hash: String, count: Int) async -> [Float] {
        if let hit = cached(hash, count: count) { return hit }
        guard let url = await JournalStore.shared.blobFile(hash) else { return [] }
        let peaks = await Task.detached(priority: .utility) { read(url, count: count) }.value
        // an unreadable file (still being written) is tried again next time, not remembered as silence
        if !peaks.isEmpty { cache.setObject(peaks as NSArray, forKey: "\(hash)#\(count)" as NSString) }
        return peaks
    }

    static func read(_ url: URL, count: Int) -> [Float] {
        guard let file = try? AVAudioFile(forReading: url), file.length > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 1 << 16) else { return [] }
        let total = file.length
        var peaks = [Float](repeating: 0, count: count)
        var position: AVAudioFramePosition = 0
        while position < total {
            buffer.frameLength = 0
            guard (try? file.read(into: buffer)) != nil, buffer.frameLength > 0, let channel = buffer.floatChannelData?[0] else { break }
            for i in 0..<Int(buffer.frameLength) {
                let slice = min(count - 1, Int(Double(position + AVAudioFramePosition(i)) / Double(total) * Double(count)))
                let v = abs(channel[i])
                if v > peaks[slice] { peaks[slice] = v }
            }
            position += AVAudioFramePosition(buffer.frameLength)
        }
        let top = max(peaks.max() ?? 1, 0.05)
        // a gentle curve, so quiet speech still shows
        return peaks.map { min(1, sqrt($0 / top)) }
    }
}

/// Bars of a waveform, bright up to `progress`.
struct WaveformBars: View {
    let peaks: [Float]
    var progress: Double = 0
    var color: Color = Theme.teal

    var body: some View {
        Canvas { context, size in
            guard !peaks.isEmpty else { return }
            let step = size.width / CGFloat(peaks.count)
            let bar = max(1.5, step * 0.55)
            for (i, peak) in peaks.enumerated() {
                let h = max(2, CGFloat(peak) * size.height)
                let x = CGFloat(i) * step + (step - bar) / 2
                let rect = CGRect(x: x, y: (size.height - h) / 2, width: bar, height: h)
                let played = (Double(i) + 0.5) / Double(peaks.count) <= progress
                context.fill(Path(roundedRect: rect, cornerRadius: bar / 2), with: .color(played ? color : color.opacity(0.35)))
            }
        }
        .accessibilityHidden(true)
    }
}

/// "1:02" — a media length on the device clock (voice notes, videos), or in pure mode on the ladder ("7ι 25λ").
func mediaDuration(_ seconds: Double?, words: Wording, at t: Double) -> String {
    guard let seconds, seconds.isFinite, seconds >= 0 else { return "" }
    if words.pure { return words.duration(max(seconds, 0.4), at: t) }
    let s = Int(seconds.rounded())
    return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
}
