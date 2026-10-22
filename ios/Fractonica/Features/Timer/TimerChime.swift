import AVFoundation
import Foundation
import UserNotifications

/// Plays the timer's chime in the app and names it for notifications. The file is synthesised once (`ChimeSynth`)
/// into Library/Sounds, where `UNNotificationSound(named:)` looks for app sounds.
@MainActor
final class TimerChime {
    static let shared = TimerChime()

    nonisolated static let fileName = "fractonica-timer-v1.wav"

    private var player: AVAudioPlayer?
    private var stopTask: Task<Void, Never>?

    /// Library/Sounds/<fileName>.
    nonisolated static var url: URL? {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask).first?
            .appending(path: "Sounds", directoryHint: .isDirectory)
            .appending(path: fileName, directoryHint: .notDirectory)
    }

    /// Writes the chime if it is not there yet (off the main thread; called at launch).
    nonisolated static func prepare() {
        Task.detached(priority: .utility) {
            guard let url, !FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return }
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? ChimeSynth.wav().write(to: url, options: .atomic)
        }
    }

    /// The chime for notifications, or the system sound while the file is missing.
    nonisolated static var notificationSound: UNNotificationSound {
        guard let url, FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) else { return .default }
        return UNNotificationSound(named: UNNotificationSoundName(fileName))
    }

    /// Rings: once, or (`repeating`) again and again for about half a minute until `stop()`.
    func play(repeating: Bool) {
        stop()
        guard let url = Self.url else { return }
        let data = (try? Data(contentsOf: url)) ?? ChimeSynth.wav()
        guard let player = try? AVAudioPlayer(data: data) else { return }
        #if os(iOS)
        // A timer rings even with the ring switch on silent, as the system Clock does; never interrupts other audio.
        // Only when no other feature has configured the session.
        let session = AVAudioSession.sharedInstance()
        if session.category == .soloAmbient {
            try? session.setCategory(.playback, options: [.mixWithOthers])
        }
        try? session.setActive(true)
        #endif
        player.numberOfLoops = repeating ? 9 : 0
        player.volume = 0.9
        player.play()
        self.player = player
        let seconds = player.duration * Double(player.numberOfLoops + 1) + 0.2
        stopTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.player = nil
        }
    }

    func stop() {
        stopTask?.cancel()
        stopTask = nil
        player?.stop()
        player = nil
    }

    var isPlaying: Bool { player?.isPlaying == true }
}
