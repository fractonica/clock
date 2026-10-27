import FractonicaKit
import SwiftUI

/// The solar day's star (Features/Face/Star): the sync's 19 Helions as the chords of {19/4}, by Pentad.
struct StarFace: View {
    /// Width over height of the face's frame.
    static let aspectRatio: CGFloat = 1
    /// The -FXFaceTime instant, or nil to follow the clock.
    let fixed: Double?

    var body: some View {
        // (a placeholder until the face is drawn)
        Circle()
            .strokeBorder(Theme.line2, lineWidth: 2)
            .overlay { Text(verbatim: "Star").font(.headline).foregroundStyle(Theme.ink3) }
    }
}
