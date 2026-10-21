import SwiftUI

/// The timeline's colours as Core Graphics colours, all derived from `Theme` (its tokens and `levelColor`) and built
/// once: the painter fills hundreds of shapes a frame.
@MainActor
enum TimelinePalette {
    /// The colours of one level's lane.
    struct Lane {
        let fillA: CGColor
        let fillB: CGColor
        let fillCur: CGColor
        let line: CGColor
        let lineStrong: CGColor
        let text: CGColor
        let textDim: CGColor
        let wave: CGColor
        let hatch: CGColor
        let cur: CGColor
        let solid: CGColor
        let tint: CGColor
        let glow: CGColor
    }

    static func cg(_ color: Color) -> CGColor {
        color.resolve(in: EnvironmentValues()).cgColor
    }

    static func cg(_ color: Color, _ opacity: Double) -> CGColor {
        cg(color.opacity(opacity))
    }

    private static var lanes: [Int: Lane] = [:]

    static func lane(_ level: Int) -> Lane {
        if let l = lanes[level] { return l }
        func c(_ o: Double, _ l: Double) -> CGColor { cg(Theme.levelColor(level, opacity: o, lightness: l)) }
        let lane = Lane(
            fillA: c(0.24, 0.56), fillB: c(0.12, 0.56), fillCur: c(0.40, 0.60),
            line: c(0.5, 0.64), lineStrong: c(0.95, 0.70),
            text: c(1, 0.82), textDim: c(0.85, 0.72), wave: c(0.6, 0.74), hatch: c(0.32, 0.60),
            cur: c(1, 0.74), solid: c(1, 0.64), tint: c(0.08, 0.60), glow: c(0.28, 0.66)
        )
        lanes[level] = lane
        return lane
    }

    static let ink = cg(Theme.ink)
    static let ink2 = cg(Theme.ink2)
    static let ink3 = cg(Theme.ink3)
    static let teal = cg(Theme.teal)
    static let now = cg(Theme.now)
    static let cursor = cg(Theme.cursor)
    static let background = cg(Theme.background)
    static let panel = cg(Theme.panel)
    static let line = cg(Theme.line)

    static func ink(_ o: Double) -> CGColor { cg(Theme.ink, o) }
    static func ink2(_ o: Double) -> CGColor { cg(Theme.ink2, o) }
    static func ink3(_ o: Double) -> CGColor { cg(Theme.ink3, o) }
    static func teal(_ o: Double) -> CGColor { cg(Theme.teal, o) }
    static func cursor(_ o: Double) -> CGColor { cg(Theme.cursor, o) }
    static func background(_ o: Double) -> CGColor { cg(Theme.background, o) }
    static func panel(_ o: Double) -> CGColor { cg(Theme.panel, o) }

    /// Frequently used translucent tones.
    static let band = ink(0.025)
    static let bandStrong = ink(0.045)
    static let grid = ink2(0.08)
    static let gridMajor = ink2(0.16)
    static let hatchLine = ink2(0.2)
    static let shade = background(0.6)
    static let chipFill = background(0.9)
    static let weekend = cursor(0.05)
    static let axisBase = ink2(0.25)
    static let minorTick = ink2(0.4)
    static let mutedText = ink2(0.9)
}
