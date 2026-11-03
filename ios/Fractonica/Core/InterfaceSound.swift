import AudioToolbox
import Foundation

/// The interface's sounds, honouring the Sounds setting: Half-Life 2's Combine console buttons
/// (ios/scripts/import-sounds.swift, Resources/Sounds/ui-<name>.caf), played as system sounds, so the silent switch
/// silences them (on the Mac the alert volume sets them) and the app's audio session is left alone.
///
///     InterfaceSound.play(.created)
@MainActor
enum InterfaceSound: String, CaseIterable {
    /// The composer opens on a new entry.
    case compose
    /// … on an entry to edit.
    case edit
    /// A new entry is saved.
    case created
    /// An edit is saved.
    case changed
    /// The composer closes without saving: the draft kept, nothing changed.
    case closed
    /// A new entry's draft or an edit's changes are thrown away.
    case discarded

    /// The bundled sound.
    nonisolated var fileName: String { "ui-\(rawValue).caf" }

    static func play(_ sound: InterfaceSound) {
        guard AppSettings.shared.sounds, let id = id(sound) else { return }
        AudioServicesPlaySystemSound(id)
    }

    /// Each sound's system sound, made on its first play.
    private static var ids: [InterfaceSound: SystemSoundID] = [:]

    private static func id(_ sound: InterfaceSound) -> SystemSoundID? {
        if let id = ids[sound] { return id }
        guard let url = Bundle.main.url(forResource: "ui-\(sound.rawValue)", withExtension: "caf") else { return nil }
        var id: SystemSoundID = 0
        guard AudioServicesCreateSystemSoundID(url as CFURL, &id) == noErr else { return nil }
        ids[sound] = id
        return id
    }
}
