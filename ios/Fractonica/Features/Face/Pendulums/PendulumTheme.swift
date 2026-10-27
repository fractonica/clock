import SwiftUI

extension Theme {
    /// The pendulum set's metals: the brushed case and beam, polished steel rods and pins, the Pentads' gold in light
    /// and shade around `Theme.gold`. Bobs take their level's colour (`Theme.levelColor`) at several lightnesses.
    enum Pendulums {
        /// The case's brushed bezel, light to dark.
        static let bezelLight = Color(hex: 0x6A7480)
        static let bezelMid = Color(hex: 0x2C343E)
        static let bezelDark = Color(hex: 0x13181E)
        /// The plate under the pendulums: lit from the top.
        static let plateTop = Color(hex: 0x121A23)
        static let plateBottom = Color(hex: 0x030507)
        /// The beam: gunmetal with a bevelled top edge.
        static let beamTop = Color(hex: 0x737F8C)
        static let beamMid = Color(hex: 0x3B4550)
        static let beamBottom = Color(hex: 0x1A2128)
        /// Rods, pins and hangers: polished steel.
        static let steel = Color(hex: 0xC3CDD7)
        static let steelMid = Color(hex: 0x8692A0)
        static let steelDark = Color(hex: 0x46515D)
        /// The Pentads' gold: a highlight and a shade.
        static let goldLight = Color(hex: 0xFFF2B0)
        static let goldDeep = Color(hex: 0x9C7400)
    }
}

/// One level's inks for a moving pendulum, worked out once (a frame draws the quick ones up to 60 times a second): its
/// rod (steel with a breath of the level's hue), the bob's lit sphere, halo and trail.
struct PendulumInk: Sendable {
    let rod: Color
    let rodLight: Color
    let smear: Color
    let halo: Color
    /// The sphere from its highlight to its shaded rim.
    let body: [Color]
    let trailHead: Color
    let trailMid: Color
    let clear: Color

    static func of(_ level: Int) -> PendulumInk { all[min(max(level, 0), all.count - 1)] }

    private static let all: [PendulumInk] = (0...13).map { level in
        let hue = Theme.levelHue(level)
        return PendulumInk(
            rod: Color(hue: hue, saturation: 0.32, lightness: 0.5),
            rodLight: Color(hue: hue, saturation: 0.3, lightness: 0.82),
            smear: Color(hue: hue, saturation: 0.3, lightness: 0.75),
            halo: Theme.levelColor(level, opacity: 0.2),
            body: [0.88, 0.64, 0.4, 0.2].map { Theme.levelColor(level, lightness: $0) },
            trailHead: Theme.levelColor(level, opacity: 0.85, lightness: 0.7),
            trailMid: Theme.levelColor(level, opacity: 0.38, lightness: 0.62),
            clear: Theme.levelColor(level, opacity: 0)
        )
    }
}
