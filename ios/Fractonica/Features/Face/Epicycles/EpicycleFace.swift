import SwiftUI

/// The epicycle face (Features/Face/Epicycles): placeholder until the face is drawn.
struct EpicycleFace: View {
    /// Width over height of the face's frame.
    nonisolated static let aspectRatio: CGFloat = 1
    /// The -FXFaceTime instant, or nil to follow the clock.
    let fixed: Double?

    var body: some View {
        Circle().strokeBorder(Theme.line, lineWidth: 1)
    }
}
