@preconcurrency import AVFoundation
import Foundation
import Observation

/// The composer's voice recorder: AAC into an .m4a at the quality Settings › Journal chooses, with record, pause,
/// resume and stop, a level meter and the elapsed time. Stopping hands the file over (the composer adopts it as the
/// entry's voice note at once, so it can be played back before the entry is saved and nothing is lost).
@MainActor @Observable
final class VoiceRecorder {
    enum State: Equatable {
        case idle, recording, paused
        case denied
        case failed(String)
    }

    private(set) var state: State = .idle
    /// Recent levels, 0 … 1, newest last (the meter).
    private(set) var levels: [Float] = Array(repeating: 0, count: 48)

    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var file: URL?
    @ObservationIgnored private var meterTask: Task<Void, Never>?

    var isActive: Bool { state == .recording || state == .paused }

    /// Seconds recorded so far.
    var elapsed: Double { recorder?.currentTime ?? 0 }

    /// Asks for the microphone (once) and starts recording into a new file in the journal's tmp/.
    func start(quality: AudioQuality, disk: JournalDisk) async {
        guard !isActive else { return }
        guard await AVAudioApplication.requestRecordPermission() else {
            state = .denied
            return
        }
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
        } catch {
            state = .failed("The microphone is busy.")
            return
        }
        #endif
        JournalAudioPlayer.shared.stop()
        let url = disk.temporaryFile(ext: "m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: quality.sampleRate,
            AVNumberOfChannelsKey: quality.channels,
            AVEncoderBitRateKey: quality.bitRate,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record() else { throw CocoaError(.fileWriteUnknown) }
            self.recorder = recorder
            file = url
            levels = Array(repeating: 0, count: levels.count)
            state = .recording
            startMeter()
        } catch {
            state = .failed("Could not start recording.")
        }
    }

    func pause() {
        guard state == .recording else { return }
        recorder?.pause()
        state = .paused
    }

    func resume() {
        guard state == .paused else { return }
        recorder?.record()
        state = .recording
    }

    /// Stops and returns the recording (nil when it is too short to keep).
    func stop() -> URL? {
        guard let recorder else { return nil }
        let length = recorder.currentTime
        recorder.stop()
        meterTask?.cancel()
        meterTask = nil
        self.recorder = nil
        state = .idle
        Self.restoreSession()
        let url = file
        file = nil
        guard let url, length >= 0.3 else {
            if let url { try? FileManager.default.removeItem(at: url) }
            return nil
        }
        return url
    }

    /// Throws the recording away.
    func cancel() {
        recorder?.stop()
        recorder?.deleteRecording()
        recorder = nil
        meterTask?.cancel()
        meterTask = nil
        file = nil
        state = .idle
        Self.restoreSession()
    }

    private func startMeter() {
        meterTask?.cancel()
        meterTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                guard let self, let recorder = self.recorder else { return }
                guard self.state == .recording else { continue }
                recorder.updateMeters()
                let db = recorder.averagePower(forChannel: 0)
                // -50 dB … 0 dB → 0 … 1
                let level = Float(max(0, min(1, (db + 50) / 50)))
                self.levels.removeFirst()
                self.levels.append(level)
            }
        }
    }

    private static func restoreSession() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        #endif
    }
}
