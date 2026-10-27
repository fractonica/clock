import SwiftUI

extension Theme {
    /// The star face's own tones: the plate, its bezel's metal and the light of the Sun and the pens. Everything else
    /// is the theme's: gold for the Sun and the Pentads, the level colours for the rose's arms.
    enum Star {
        /// The plate: a little lifted at its centre, falling to the window's background at its edge.
        static let plateCentre = Color(hex: 0x121A23)
        static let plateEdge = Color(hex: 0x080B10)
        /// The bezel's turned metal: light where it catches the light, dark where it turns away.
        static let bezelLight = Color(hex: 0x4A5A6B)
        static let bezelMid = Color(hex: 0x223040)
        static let bezelDark = Color(hex: 0x0C1218)
        /// An engraved line's lit lower lip.
        static let engraveLight = Color(hex: 0xE7EDF3, opacity: 0.07)
        /// The hot cores of the Sun and the pen (gold run to white).
        static let sunCore = Color(hex: 0xFFF3C4)
        static let penCore = Color(hex: 0xFFFBEA)

        /// The rose (the running Helion): the η colour; its arms in their levels' colours.
        static func rose(opacity: Double = 1) -> Color { Theme.levelColor(6, opacity: opacity) }
    }
}
