import CoreGraphics
import Foundation

/// The Now screen's own test hooks, read from the launch arguments (UserDefaults' argument domain: never saved). They
/// set what the screen shows until the first interaction that changes it, and never touch the stored settings:
///
///     -FXFace journal|watch      the face shown
///     -FXFaceUnit 0…6            the journal face's unit (0 α … 3 δ, 4 ε η ι, 5 η ι λ, 6 ι λ ν)
///     -FXFaceDepth 2…11          the watch face's top depth
///     -FXFaceOverlay letters|info  the watch face's letters or info labels, kept until a tap
///     -FXFaceTime <unix s>       the screen reads this instant, unclamped (shows the out-of-catalogue state)
///     -FXFaceGuide 1             open "How to read"
///     -FXFaceTip top|solar|bottom  show that watch row's press-and-hold card under the face (to look at it)
///     -FXFaceCanvas <W>x<H>      the screen lays itself out in a W × H point box, outlined (to check landscape and Mac
///                                window layouts on a portrait simulator)
///
///     ios/scripts/shoot.sh … -FXTab now -FXFace watch -FXFaceDepth 9 -FXFaceOverlay info
struct FaceLaunch: Equatable, Sendable {
    var face: AppSettings.FaceMode?
    var unit: Int?
    var depth: Int?
    var overlay: WatchOverlay?
    var time: Double?
    var canvas: CGSize?
    var guide = false
    var tip: WatchGeometry.Row?

    /// The hooks this process was launched with.
    static let current = FaceLaunch(defaults: .standard)

    init(face: AppSettings.FaceMode? = nil, unit: Int? = nil, depth: Int? = nil, overlay: WatchOverlay? = nil, time: Double? = nil) {
        self.face = face
        self.unit = unit
        self.depth = depth
        self.overlay = overlay
        self.time = time
    }

    init(defaults: UserDefaults) {
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        face = string("FXFace").flatMap { AppSettings.FaceMode(rawValue: $0.lowercased()) }
        unit = string("FXFaceUnit").flatMap(Int.init).flatMap { FaceStepper.units.contains($0) ? $0 : nil }
        depth = string("FXFaceDepth").flatMap(Int.init).flatMap { FaceStepper.depths.contains($0) ? $0 : nil }
        overlay = string("FXFaceOverlay").flatMap { ["letters": WatchOverlay.letters, "info": .info][$0.lowercased()] }
        time = string("FXFaceTime").flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil }
        guide = string("FXFaceGuide") == "1"
        tip = string("FXFaceTip").flatMap { ["top": WatchGeometry.Row.top, "solar": .solar, "bottom": .bottom][$0.lowercased()] }
        canvas = string("FXFaceCanvas").flatMap { value in
            let parts = value.lowercased().split(separator: "x").compactMap { Double($0) }
            return parts.count == 2 && parts.allSatisfy({ $0 > 0 && $0 < 10_000 }) ? CGSize(width: parts[0], height: parts[1]) : nil
        }
    }
}
