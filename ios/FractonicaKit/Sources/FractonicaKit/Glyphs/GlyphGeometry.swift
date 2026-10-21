import CoreGraphics

/// Glyph drawing in design units (SPEC §9.1), identical to `F.CBT.geometry(glyph, {thickness: 0.3})` with the
/// library's default round style.
///
/// Trit i (least significant first) owns the stem from y = 3i to 3i + 3 and attaches its stroke at y = 3i, so the
/// least significant trit is drawn at the top. A 0 trit is a horizontal bar; +1 curves down and right, −1 up and left.
/// Stroke the path with `thickness`, round caps and joins, and fill the dot on falling states.
public enum GlyphGeometry {
    /// One SVG-style path command, in design units (y grows downward).
    public enum Command: Hashable, Sendable {
        case move(x: Double, y: Double)
        case line(x: Double, y: Double)
        case curve(x1: Double, y1: Double, x2: Double, y2: Double, x: Double, y: Double)
    }

    /// Ink thickness (stroke width) in design units.
    public static let thickness = 0.3
    /// Radius of the derivative dot.
    public static let dotRadius = 0.3
    /// Centre of the derivative dot, above the stem.
    public static let dotCenter = (x: 0.0, y: dotY)

    private static let stemHeight = 3.0
    private static let strokeWidth = 2.0
    private static let curvature = 1.0
    private static let zeroStrokeWidth = 2.0
    private static let half = thickness / 2
    private static let dotY = -curvature - half - 2 * dotRadius

    /// The path of a state: every stem segment first, then every stroke, as `geometry().path` orders them. The stroke
    /// count is clamped to `GlyphState.strokeRange`.
    public static func commands(index: Int, strokes: Int) -> [Command] {
        let digits = GlyphState.of(index: index, strokes: strokes).trits.reversed() // least significant (top) first
        var stems: [Command] = []
        var marks: [Command] = []
        for (i, digit) in digits.enumerated() {
            let y = Double(i) * stemHeight
            stems += [.move(x: 0, y: y), .line(x: 0, y: y + stemHeight)]
            if digit == 0 {
                marks += [.move(x: -zeroStrokeWidth / 2, y: y), .line(x: zeroStrokeWidth / 2, y: y)]
            } else {
                let x = Double(digit) * strokeWidth
                let bend = y + Double(digit) * curvature
                marks += [
                    .move(x: 0, y: y),
                    .curve(x1: 0, y1: y, x2: 0, y2: bend, x: x / 2, y: bend),
                    .curve(x1: x, y1: bend, x2: x, y2: y, x: x, y: y),
                ]
            }
        }
        return stems + marks
    }

    /// Ink bounds of any d-stroke glyph, including the dot and half the ink (SPEC §9.1): x ∈ [−2.15, 2.15],
    /// y ∈ [−2.2, 3d + 0.15]. They depend only on the stroke count (clamped like the glyph's), never on the state.
    public static func bounds(strokes: Int) -> (minX: Double, minY: Double, maxX: Double, maxY: Double) {
        let reach = max(strokeWidth, zeroStrokeWidth / 2)
        let d = Double(GlyphState.clampStrokes(strokes))
        return (
            minX: -max(reach + half, dotRadius),
            minY: dotY - dotRadius - half,
            maxX: max(reach + half, dotRadius),
            maxY: max(d * stemHeight, (d - 1) * stemHeight + curvature) + half
        )
    }

    /// The state's path (without the dot) as a CoreGraphics path in design units.
    public static func cgPath(index: Int, strokes: Int) -> CGPath {
        let path = CGMutablePath()
        for command in commands(index: index, strokes: strokes) {
            switch command {
            case let .move(x, y):
                path.move(to: CGPoint(x: x, y: y))
            case let .line(x, y):
                path.addLine(to: CGPoint(x: x, y: y))
            case let .curve(x1, y1, x2, y2, x, y):
                path.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
            }
        }
        return path
    }
}
