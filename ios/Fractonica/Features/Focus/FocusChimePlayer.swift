import AudioToolbox
import Foundation

/// Plays the end-of-session chime as a system sound: it mixes with whatever else is playing (music, the Sound
/// feature's drone), follows the ring / silent switch on iPhone and never touches the app's audio session.
@MainActor
enum FocusChimePlayer {
    private static var soundID: SystemSoundID?
    private static var preparing = false
    /// A session ended before the chime was ready: play it as soon as it is.
    private static var playWhenReady = false

    /// Synthesises the chime into the caches folder once (off the main thread: it is a few million samples' worth
    /// of maths) and registers it; cheap afterwards.
    static func prepare() {
        guard soundID == nil, !preparing else { return }
        preparing = true
        Task {
            let url = await Task.detached(priority: .utility) { writtenChime() }.value
            preparing = false
            var id: SystemSoundID = 0
            guard let url, AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError else { return }
            soundID = id
            if playWhenReady {
                playWhenReady = false
                AudioServicesPlaySystemSound(id)
            }
        }
    }

    static func play() {
        if let soundID {
            AudioServicesPlaySystemSound(soundID)
        } else {
            playWhenReady = true
            prepare()
        }
    }

    /// The chime's file, written on first use; nil when it cannot be written.
    private nonisolated static func writtenChime() -> URL? {
        let files = FileManager.default
        let folder = files.urls(for: .cachesDirectory, in: .userDomainMask).first ?? files.temporaryDirectory
        let url = folder.appendingPathComponent("focus-chime-v1.wav")
        if files.fileExists(atPath: url.path) { return url }
        do {
            try files.createDirectory(at: folder, withIntermediateDirectories: true)
            try FocusChimeSynth.wav().write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }
}
