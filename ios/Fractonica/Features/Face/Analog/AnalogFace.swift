import FractonicaKit
import SwiftUI

/// A mechanical dial (Features/Face/Analog): the Helion's 36 Preons, a Preon's 65 Flavons in a sub-dial, the Nuclide's 77 Helions on the outer ring.
struct AnalogFace: View {
    /// Width over height of the face's frame.
    static let aspectRatio: CGFloat = 1
    /// The -FXFaceTime instant, or nil to follow the clock.
    let fixed: Double?

    var body: some View {
        // (a placeholder until the face is drawn)
        Circle()
            .strokeBorder(Theme.line2, lineWidth: 2)
            .overlay { Text(verbatim: "Analog").font(.headline).foregroundStyle(Theme.ink3) }
    }
}
