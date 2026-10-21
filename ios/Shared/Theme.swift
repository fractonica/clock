import SwiftUI

/// The palette and type of the native apps: the web app's tokens (src/core/theme.js, src/styles/app.css) as SwiftUI
/// values. Dark, minimal, precise: teal for period glyphs, gold for the solar sync, one hue per level for cycles.
/// Every colour on screen comes from here; nothing else hard-codes a hex value.
///
/// Compiled into the apps and the widget extensions.
enum Theme {
    // MARK: Surfaces and ink

    /// The window background (#07090d).
    static let background = Color(hex: 0x07090D)
    /// A slightly lifted background, for large secondary areas.
    static let background2 = Color(hex: 0x0B1015)
    /// Cards and grouped rows.
    static let panel = Color(hex: 0x10161D)
    static let panel2 = Color(hex: 0x151D26)
    static let panel3 = Color(hex: 0x1B2531)
    /// Hairlines, grids, tracks.
    static let line = Color(hex: 0x1F2A36)
    static let line2 = Color(hex: 0x2B3A4A)
    /// Primary, secondary and tertiary text.
    static let ink = Color(hex: 0xE7EDF3)
    static let ink2 = Color(hex: 0xA3B1BF)
    static let ink3 = Color(hex: 0x7D8D9D)

    // MARK: Signals

    /// Period glyphs (SPEC §8).
    static let teal = Color(hex: 0x4FD1C5)
    static let tealDim = Color(hex: 0x1D5A55)
    /// The solar sync (SPEC §8).
    static let gold = Color(hex: 0xFFD60A)
    static let goldDim = Color(hex: 0x6B5A07)
    /// The real "now" while the displayed time is elsewhere.
    static let now = Color(hex: 0xFF5D73)
    /// The displayed time while travelling.
    static let cursor = Color(hex: 0x8AB4FF)
    /// The LIVE indicator.
    static let live = Color(hex: 0x5BD88A)
    static let danger = Color(hex: 0xFF6B6B)

    // MARK: Levels

    /// The hue of a level in degrees: violet for α (the longest cycle) through teal and amber to orange for ξ.
    static func levelHue(_ level: Int) -> Double {
        (268 - Double(min(max(level, 0), 13)) * 238 / 13).rounded()
    }

    /// The colour of a level: HSL(levelHue, 68 %, `lightness`), as `levelColor` in src/core/theme.js.
    /// - Parameters:
    ///   - opacity: 0…1.
    ///   - lightness: 0…1; 0.64 is the standard ink, lower values make tracks and fills.
    static func levelColor(_ level: Int, opacity: Double = 1, lightness: Double = 0.64) -> Color {
        Color(hue: levelHue(level), saturation: 0.68, lightness: lightness, opacity: opacity)
    }
}

// MARK: - Type

extension Font {
    /// A reading that ticks (times, counts, countdowns): the system face with monospaced digits, so a changing
    /// number never shifts the layout.
    static func reading(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight).monospacedDigit()
    }

    /// An identifier set in the monospaced face: positions, stamps, cycle indices ("pos 22.927850", "d7#717211").
    static func code(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

// MARK: - Colour construction

extension Color {
    /// An opaque sRGB colour from a 0xRRGGBB literal.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }

    /// A colour from CSS-style HSL: `hue` in degrees, `saturation` and `lightness` 0…1.
    init(hue: Double, saturation: Double, lightness: Double, opacity: Double = 1) {
        let c = (1 - abs(2 * lightness - 1)) * saturation
        let h = (hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 60
        let x = c * (1 - abs(h.truncatingRemainder(dividingBy: 2) - 1))
        let (r, g, b): (Double, Double, Double) =
            switch h {
            case ..<1: (c, x, 0)
            case ..<2: (x, c, 0)
            case ..<3: (0, c, x)
            case ..<4: (0, x, c)
            case ..<5: (x, 0, c)
            default: (c, 0, x)
            }
        let m = lightness - c / 2
        self.init(.sRGB, red: r + m, green: g + m, blue: b + m, opacity: opacity)
    }
}
