import Foundation
import Observation

/// The Journal's own preferences (Settings › Journal), persisted in UserDefaults under `journal.` keys: how media are
/// kept (voice notes, photos, videos), whether records of other kinds show in the timeline, the recent emoji.
@MainActor @Observable
final class JournalPreferences {
    static let shared = JournalPreferences()

    var audioQuality: AudioQuality {
        didSet { defaults.set(audioQuality.rawValue, forKey: Keys.audio) }
    }
    var photoQuality: PhotoQuality {
        didSet { defaults.set(photoQuality.rawValue, forKey: Keys.photo) }
    }
    var videoQuality: VideoQuality {
        didSet { defaults.set(videoQuality.rawValue, forKey: Keys.video) }
    }
    /// Show records of other kinds (other hub clients) in the timeline as compact rows.
    var showsOtherKinds: Bool {
        didSet { defaults.set(showsOtherKinds, forKey: Keys.others) }
    }
    /// Emoji chosen lately, most recent first (at most 24).
    private(set) var recentEmoji: [String]

    @ObservationIgnored private let defaults: UserDefaults

    private enum Keys {
        static let audio = "journal.audioQuality"
        static let photo = "journal.photoQuality"
        static let video = "journal.videoQuality"
        static let others = "journal.showsOtherKinds"
        static let recents = "journal.recentEmoji"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        audioQuality = defaults.string(forKey: Keys.audio).flatMap(AudioQuality.init(rawValue:)) ?? .standard
        photoQuality = defaults.string(forKey: Keys.photo).flatMap(PhotoQuality.init(rawValue:)) ?? .optimised
        videoQuality = defaults.string(forKey: Keys.video).flatMap(VideoQuality.init(rawValue:)) ?? .hevc1080
        showsOtherKinds = JournalLaunch.flag("FXJournalOthers") || defaults.bool(forKey: Keys.others)
        recentEmoji = defaults.stringArray(forKey: Keys.recents) ?? []
    }

    func noteEmoji(_ emoji: String) {
        var list = recentEmoji.filter { $0 != emoji }
        list.insert(emoji, at: 0)
        recentEmoji = Array(list.prefix(24))
        defaults.set(recentEmoji, forKey: Keys.recents)
    }
}

/// How voice notes are recorded: AAC in an .m4a file.
enum AudioQuality: String, CaseIterable, Identifiable, Sendable {
    case low, standard, high

    var id: String { rawValue }

    var title: String {
        switch self {
        case .low: "Low"
        case .standard: "Standard"
        case .high: "High"
        }
    }

    var detail: String {
        switch self {
        case .low: "Speech, mono · 22 kHz · 32 kbps"
        case .standard: "Mono · 44.1 kHz · 64 kbps"
        case .high: "Mono · 48 kHz · 128 kbps"
        }
    }

    var sampleRate: Double {
        switch self {
        case .low: 22_050
        case .standard: 44_100
        case .high: 48_000
        }
    }

    var channels: Int { 1 }

    var bitRate: Int {
        switch self {
        case .low: 32_000
        case .standard: 64_000
        case .high: 128_000
        }
    }

    /// Bytes a minute of recording takes (AAC at a constant bit rate, plus the container's few bytes).
    var bytesPerMinute: Double { Double(bitRate) / 8 * 60 }
}

/// How photos from the library or the camera are kept.
enum PhotoQuality: String, CaseIterable, Identifiable, Sendable {
    case original, optimised

    var id: String { rawValue }

    var title: String {
        switch self {
        case .original: "Original"
        case .optimised: "Optimised"
        }
    }

    var detail: String {
        switch self {
        case .original: "The file as it is, full size"
        case .optimised: "HEIC, at most 2048 pixels on the long side"
        }
    }

    /// The long side of an optimised photo.
    static let longSide = 2048
}

/// How videos from the library or the camera are kept.
enum VideoQuality: String, CaseIterable, Identifiable, Sendable {
    case original, hevc1080, hevc720

    var id: String { rawValue }

    var title: String {
        switch self {
        case .original: "Original"
        case .hevc1080: "1080p HEVC"
        case .hevc720: "720p HEVC"
        }
    }

    var detail: String {
        switch self {
        case .original: "The file as it is"
        case .hevc1080: "Full HD, about a third of the space of 4K"
        case .hevc720: "HD, the smallest files"
        }
    }

    /// The long side of the exported frame; nil keeps the original file.
    var longSide: Int? {
        switch self {
        case .original: nil
        case .hevc1080: 1920
        case .hevc720: 1280
        }
    }
}
