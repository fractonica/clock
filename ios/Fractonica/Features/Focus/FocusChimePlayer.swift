import AudioToolbox
import Foundation

/// Plays the end-of-session chime as a system sound: it mixes with whatever else is playing (music, the Sound
/// feature's drone), follows the ring / silent switch on iPhone and never touches the app's audio session.
@MainActor
enum FocusChimePlayer {
    private static var soundID: SystemSoundID?

    /// Synthesises the chime into the caches folder once and registers it; cheap afterwards.
    static func prepare() {
        guard soundID == nil else { return }
        let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        let url = folder.appendingPathComponent("focus-chime-v1.wav")
        if !FileManager.default.fileExists(atPath: url.path) {
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try FocusChimeSynth.wav().write(to: url, options: .atomic)
            } catch {
                return
            }
        }
        var id: SystemSoundID = 0
        guard AudioServicesCreateSystemSoundID(url as CFURL, &id) == kAudioServicesNoError else { return }
        soundID = id
    }

    static func play() {
        prepare()
        if let soundID { AudioServicesPlaySystemSound(soundID) }
    }
}
