import SwiftUI

// The Now screen's faces as pages, in `AppSettings.FaceMode.allCases` order. The journal and watch faces step through
// units or depths (a rail of letters beside them, drags up and down); the analog, pendulum and star faces show a fixed
// set of cycles and fill their page without a rail.

extension AppSettings.FaceMode {
    /// The page this face sits on.
    var page: Int { Self.allCases.firstIndex(of: self) ?? 0 }

    /// The face on `page` (clamped).
    static func at(page: Int) -> Self { allCases[min(max(page, 0), allCases.count - 1)] }

    var title: String {
        switch self {
        case .analog: "Analog"
        case .pendulums: "Pendulums"
        case .star: "Star"
        case .journal: "Journal"
        case .watch: "Watch"
        }
    }

    var systemImage: String {
        switch self {
        case .analog: "clock"
        case .pendulums: "metronome"
        case .star: "star.circle"
        case .journal: "text.line.first.and.arrowtriangle.forward"
        case .watch: "applewatch.watchface"
        }
    }

    /// Width over height of the face's frame.
    var aspectRatio: CGFloat {
        switch self {
        case .analog: AnalogFace.aspectRatio
        case .pendulums: PendulumFace.aspectRatio
        case .star: StarFace.aspectRatio
        case .journal, .watch: FaceSpace.aspectRatio
        }
    }

    /// The face steps through units or depths, with a rail beside it.
    var steps: Bool { self == .journal || self == .watch }

    /// The face draws the Pentads itself, so the Now screen leaves out its Pentad card.
    var showsPentads: Bool { !steps }
}
