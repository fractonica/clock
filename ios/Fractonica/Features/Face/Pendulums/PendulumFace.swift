import FractonicaKit
import SwiftUI

/// Pendulums (Features/Face/Pendulums): a cascade from depth 12 up, each swinging twice a period, the slow ones blurred along their way.
struct PendulumFace: View {
    /// Width over height of the face's frame.
    static let aspectRatio: CGFloat = 1
    /// The -FXFaceTime instant, or nil to follow the clock.
    let fixed: Double?

    var body: some View {
        // (a placeholder until the face is drawn)
        Circle()
            .strokeBorder(Theme.line2, lineWidth: 2)
            .overlay { Text(verbatim: "Pendulums").font(.headline).foregroundStyle(Theme.ink3) }
    }
}
