import SwiftUI

// The analog dial's materials: gunmetal case, slate sunray dial, polished steel for indices and hands, the movement
// seen through the aperture (rhodium plate, brass balance, blued hairspring, ruby jewels). Pentads stay in
// `Theme.gold`, cycles in `Theme.levelColor`. The only colour literals of the face.

extension Theme {
    enum Analog {
        // MARK: Case

        static let caseHighlight = Color(hex: 0xC4CDD6)
        static let caseLight = Color(hex: 0x7C8794)
        static let caseMid = Color(hex: 0x3D4650)
        static let caseDark = Color(hex: 0x14191F)

        // MARK: Dial

        static let dialCentre = Color(hex: 0x1C2734)
        static let dialEdge = Color(hex: 0x0A0F15)
        static let dialSheen = Color(hex: 0x4A6178)
        static let flangeLight = Color(hex: 0x1E2933)
        static let flangeDark = Color(hex: 0x0C1218)
        static let register = Color(hex: 0x0D131A)
        static let registerSheen = Color(hex: 0x33475A)
        /// Printing on the dial.
        static let print = Color(hex: 0xC9D3DD)
        static let printDim = Color(hex: 0x7F8E9D)

        // MARK: Polished steel

        static let steelHighlight = Color(hex: 0xF7F9FB)
        static let steelLight = Color(hex: 0xC6CFD8)
        static let steelMid = Color(hex: 0x7D8996)
        static let steelDark = Color(hex: 0x323B45)
        static let steelDeep = Color(hex: 0x161B21)

        /// Polished steel lit at `brightness` (0 facing away from the light … 1 facing it).
        static func steel(_ brightness: Double) -> Color {
            ramp(brightness, [steelDeep, steelDark, steelMid, steelLight, steelHighlight])
        }

        // MARK: Gold (the Pentads' metal)

        static let goldLight = Color(hex: 0xFFF1A6)
        static let goldDeep = Color(hex: 0x7A5D00)

        /// Polished gold lit at `brightness`.
        static func gold(_ brightness: Double) -> Color {
            ramp(brightness, [goldDeep, Theme.goldDim, Theme.gold, goldLight])
        }

        // MARK: The movement

        static let plate = Color(hex: 0x2B323B)
        static let plateLight = Color(hex: 0x56616D)
        static let brass = Color(hex: 0xD9B56E)
        static let brassLight = Color(hex: 0xF6E2B0)
        static let brassDark = Color(hex: 0x6F5220)
        static let blued = Color(hex: 0x4B7BE0)
        static let bluedDark = Color(hex: 0x1D3577)
        static let ruby = Color(hex: 0xC8174F)
        static let rubyLight = Color(hex: 0xFF8AAE)

        // MARK: The Helion window

        static let windowDisc = Color(hex: 0xE9EDF1)
        static let windowInk = Color(hex: 0x10161D)

        /// A colour along evenly spaced stops, `t` 0 … 1.
        static func ramp(_ t: Double, _ stops: [Color]) -> Color {
            guard stops.count > 1 else { return stops.first ?? .clear }
            let x = min(max(t, 0), 1) * Double(stops.count - 1)
            let i = min(Int(x), stops.count - 2)
            return stops[i].mix(with: stops[i + 1], by: x - Double(i))
        }
    }
}
