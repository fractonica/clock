import CoreGraphics
import Foundation

/// An attachment on its way into the composer: its kind (from the moment it is picked), how far it is, and its picture
/// once there is one.
struct PendingMedia: Identifiable {
    enum Stage: Comparable {
        /// From the library (Photos may prepare the file first).
        case loading
        /// Optimised per Settings › Journal (a video re-encoded).
        case converting
        /// Hashed and stored.
        case saving
    }

    let id = UUID()
    /// "photo", "video" or "audio".
    let role: String
    var name: String?
    /// It comes from the library first (a share of the ring for the copy).
    var transfers: Bool
    private(set) var stage: Stage = .loading
    /// The whole way, 0 … 1; it only grows.
    private(set) var fraction: Double = 0
    var preview: CGImage?

    init(role: String, name: String?, transfers: Bool) {
        self.role = role
        self.name = name
        self.transfers = transfers
    }

    /// Where each stage starts and ends on the ring: a video's conversion is the long part, a photo's the copy.
    private var spans: (loading: ClosedRange<Double>, converting: ClosedRange<Double>, saving: ClosedRange<Double>) {
        let loaded = transfers ? (role == "video" ? 0.4 : 0.8) : 0
        return (0...loaded, loaded...0.95, 0.95...1)
    }

    mutating func advance(_ stage: Stage, _ part: Double) {
        guard stage >= self.stage else { return }
        self.stage = stage
        let span = switch stage {
        case .loading: spans.loading
        case .converting: spans.converting
        case .saving: spans.saving
        }
        let p = part.isFinite ? min(1, max(0, part)) : 0
        fraction = max(fraction, span.lowerBound + p * (span.upperBound - span.lowerBound))
    }

    /// "Loading", "Converting", "Saving".
    var stageTitle: String {
        switch stage {
        case .loading: "Loading"
        case .converting: role == "video" ? "Converting" : "Preparing"
        case .saving: "Saving"
        }
    }

    /// "Photo", "Video", "Voice note", "Audio".
    var kindTitle: String {
        switch role {
        case "video": "Video"
        case "audio": name == nil ? "Voice note" : "Audio"
        default: "Photo"
        }
    }

    var systemImage: String {
        switch role {
        case "video": "video"
        case "audio": name == nil ? "mic" : "waveform"
        default: "photo"
        }
    }
}
