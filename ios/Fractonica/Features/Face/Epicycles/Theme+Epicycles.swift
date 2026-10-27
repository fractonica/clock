import SwiftUI

extension Theme {
    /// The epicycle face's tones: the star face's plate and bezel, so the two drawn dials read as one family. Gold is
    /// the Pentads' only; the arms and their paths take their levels' colours.
    enum Epicycles {
        static let plateCentre = Theme.Star.plateCentre
        static let plateEdge = Theme.Star.plateEdge
        static let bezelLight = Theme.Star.bezelLight
        static let bezelMid = Theme.Star.bezelMid
        static let bezelDark = Theme.Star.bezelDark
        static let engraveLight = Theme.Star.engraveLight
        /// The pen's hot core.
        static let penCore = Theme.Star.penCore

        /// Arm (or path) of `level`, a little lighter than the ladder's colour so it reads on the plate.
        static func arm(_ level: Int, opacity: Double = 1) -> Color { Theme.levelColor(level, opacity: opacity, lightness: 0.7) }

        /// The pen's path: the arms' steel, never a level's colour (μ's and ν's would read as the Pentads' gold).
        static func pen(opacity: Double = 1) -> Color { Theme.ink.opacity(opacity) }

        /// An arm itself: lighter still, so it stands over the paths.
        static func hand(_ level: Int) -> Color { Theme.levelColor(level, lightness: 0.8) }
    }
}
