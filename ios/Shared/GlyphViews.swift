import FractonicaKit
import SwiftUI

// The phase glyphs of SPEC §4 and §9 as SwiftUI views: one glyph, an odometer row and the 256-state pair of pure
// mode. The geometry comes from FractonicaKit (identical to the library's `F.CBT.geometry`); this file only places
// it. Compiled into the apps and the widget extensions.
//
//   GlyphView(index: 20, strokes: 3)                        one glyph, fitted into its frame
//   OdometerView(digits: reading.digits, color: Theme.gold) k glyphs side by side (SPEC §5, §7.3)
//   PairView(fraction: helion.phase, height: 22)            two 2-stroke glyphs, 16 × 16 = 256 states (SPEC §15.3)
//
// Ink is 0.3 design units (SPEC §9.1) with round caps and joins, unless `lineWidth` (points) overrides it. Without an
// override the scale is snapped so that stems, bars and the stroke width land on whole device pixels (SPEC §9.2):
// glyphs stay crisp at any size, at the cost of filling their frame up to one pixel per stem segment less exactly.

// MARK: - Layout

/// Where a row of glyphs sits inside a rectangle: design units (SPEC §9.1, y down, the least significant trit at the
/// top) mapped to points.
struct GlyphLayout {
    /// The design-unit bounds of one glyph of `strokes` strokes; they depend on the stroke count only, never on the
    /// state (SPEC §9.1).
    static func bounds(strokes: Int) -> CGRect {
        let b = GlyphGeometry.bounds(strokes: strokes)
        return CGRect(x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY)
    }

    /// The size of a row of `count` glyphs in design units, `spacing` design units between neighbouring bounds.
    static func designSize(count: Int, strokes: Int, spacing: Double) -> CGSize {
        let b = bounds(strokes: strokes)
        let n = CGFloat(max(count, 1))
        return CGSize(width: n * b.width + (n - 1) * spacing, height: b.height)
    }

    /// Width ÷ height of such a row: frame a row with `.aspectRatio(_, contentMode: .fit)`.
    static func aspectRatio(count: Int, strokes: Int, spacing: Double) -> CGFloat {
        let size = designSize(count: count, strokes: strokes, spacing: spacing)
        return size.width / size.height
    }

    /// Points per design unit.
    let scale: CGFloat
    /// Ink width in points.
    let lineWidth: CGFloat
    /// Where each glyph's design origin (the top of its stem) lands, left to right.
    let origins: [CGPoint]

    /// Fits a row of `count` glyphs into `rect`, centred.
    /// - Parameters:
    ///   - lineWidth: ink width in points; nil uses the design thickness (0.3 units) at the fitted scale.
    ///   - pixelScale: device pixels per point; when given (and `lineWidth` is nil) the scale, the ink width and the
    ///     origins are snapped to the pixel grid.
    init(count: Int, strokes: Int, spacing: Double, in rect: CGRect, lineWidth: CGFloat? = nil, pixelScale: CGFloat? = nil) {
        let b = Self.bounds(strokes: strokes)
        let size = Self.designSize(count: count, strokes: strokes, spacing: spacing)
        var s = max(0, min(rect.width / size.width, rect.height / size.height))
        var ink = lineWidth ?? GlyphGeometry.thickness * s
        var snap: (CGFloat) -> CGFloat = { $0 }
        if lineWidth == nil, let px = pixelScale, px > 0 {
            // whole pixels per stem segment (3 units) put every bar on the same sub-pixel phase as the origin
            let segment = (3 * s * px + 1e-9).rounded(.down)
            if segment >= 3 {
                s = segment / (3 * px)
                let inkPixels = max(1, (GlyphGeometry.thickness * segment / 3).rounded())
                ink = inkPixels / px
                // an odd ink width is centred on a pixel centre, an even one on a pixel edge
                let odd = Int(inkPixels) % 2 == 1
                snap = { v in odd ? ((v * px).rounded(.down) + 0.5) / px : (v * px).rounded() / px }
            }
        }
        let left = rect.minX + (rect.width - size.width * s) / 2
        let top = rect.minY + (rect.height - size.height * s) / 2
        scale = s
        self.lineWidth = ink
        origins = (0..<max(count, 0)).map { i in
            CGPoint(
                x: snap(left + (-b.minX + CGFloat(i) * (b.width + spacing)) * s),
                y: snap(top - b.minY * s)
            )
        }
    }

    /// Design units of glyph `i` to points.
    func transform(glyph i: Int) -> CGAffineTransform {
        CGAffineTransform(translationX: origins[i].x, y: origins[i].y).scaledBy(x: scale, y: scale)
    }
}

// MARK: - Shapes

/// A row of phase glyphs as one fillable outline (ink and falling-branch dots), laid out by `GlyphLayout`.
/// Fill it: `GlyphRowShape(digits: [5, 6], strokes: 2).fill(Theme.teal)`.
struct GlyphRowShape: Shape {
    /// Glyph indices, 0 … 4M−1 each (SPEC §4.1); out-of-range values are clamped.
    var digits: [Int]
    var strokes: Int = 2
    /// Design units between neighbouring glyph bounds.
    var spacing: Double = 1.1
    /// Ink width in points; nil = 0.3 design units.
    var lineWidth: CGFloat? = nil
    /// Device pixels per point for pixel snapping; nil = no snapping.
    var pixelScale: CGFloat? = nil

    func path(in rect: CGRect) -> Path {
        let layout = GlyphLayout(count: digits.count, strokes: strokes, spacing: spacing, in: rect, lineWidth: lineWidth, pixelScale: pixelScale)
        let states = GlyphState.states(strokes: strokes)
        let style = StrokeStyle(lineWidth: layout.lineWidth, lineCap: .round, lineJoin: .round)
        var out = Path()
        for (i, raw) in digits.enumerated() {
            let index = min(max(raw, 0), states - 1)
            let t = layout.transform(glyph: i)
            out.addPath(Path(GlyphGeometry.cgPath(index: index, strokes: strokes)).applying(t).strokedPath(style))
            if GlyphState.of(index: index, strokes: strokes).dotted {
                let c = CGPoint(x: GlyphGeometry.dotCenter.x, y: GlyphGeometry.dotCenter.y).applying(t)
                let r = GlyphGeometry.dotRadius * layout.scale
                out.addEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
            }
        }
        return out
    }
}

/// One glyph as a shape: `GlyphShape(index: 13, strokes: 2).fill(Theme.teal)`.
struct GlyphShape: Shape {
    var index: Int
    var strokes: Int = 2
    var lineWidth: CGFloat? = nil
    var pixelScale: CGFloat? = nil

    func path(in rect: CGRect) -> Path {
        GlyphRowShape(digits: [index], strokes: strokes, spacing: 0, lineWidth: lineWidth, pixelScale: pixelScale).path(in: rect)
    }
}

// MARK: - Views

/// One phase glyph in a colour, fitted into its frame at the glyph's own aspect ratio and pixel-snapped.
struct GlyphView: View {
    var index: Int
    var strokes: Int = 2
    var color: Color = Theme.teal
    /// Ink width in points; nil = 0.3 design units (pixel-snapped).
    var lineWidth: CGFloat? = nil

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        GlyphShape(index: index, strokes: strokes, lineWidth: lineWidth, pixelScale: displayScale)
            .fill(color)
            .aspectRatio(GlyphLayout.aspectRatio(count: 1, strokes: strokes, spacing: 0), contentMode: .fit)
            .accessibilityElement()
            .accessibilityLabel(Text("glyph state \(index) of 0–\(GlyphState.states(strokes: strokes) - 1)"))
    }
}

/// An odometer read-out (SPEC §5): `digits` glyphs side by side, the most significant on the left.
struct OdometerView: View {
    var digits: [Int]
    var strokes: Int = 2
    var color: Color = Theme.teal
    /// Design units between neighbouring glyphs.
    var spacing: Double = 1.1
    var lineWidth: CGFloat? = nil

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        GlyphRowShape(digits: digits, strokes: strokes, spacing: spacing, lineWidth: lineWidth, pixelScale: displayScale)
            .fill(color)
            .aspectRatio(GlyphLayout.aspectRatio(count: digits.count, strokes: strokes, spacing: spacing), contentMode: .fit)
            .accessibilityElement()
            .accessibilityLabel(Text("odometer \(digits.map(String.init).joined(separator: " "))"))
    }
}

/// The 256-state phase pair of pure mode (SPEC §15.3, `pure.drawPair` in src/core/pure.js): a fraction of a cycle
/// as two 2-stroke glyphs, the coarse one on the left.
struct PairView: View {
    /// 0…1 through the cycle.
    var fraction: Double
    var color: Color = Theme.teal
    /// Glyph height in points; nil fits the frame.
    var height: CGFloat? = nil

    /// Design units between the two glyphs (as `drawPair`).
    static let gap = 1.1

    /// The width the pair takes at a given height (for layout before drawing).
    static func width(forHeight height: CGFloat) -> CGFloat {
        height * GlyphLayout.aspectRatio(count: 2, strokes: 2, spacing: gap)
    }

    var body: some View {
        let pair = Notation.pair(fraction)
        OdometerView(digits: [pair.hi, pair.lo], strokes: 2, color: color, spacing: Self.gap)
            .frame(width: height.map(Self.width(forHeight:)), height: height)
            .accessibilityLabel(Text("phase \(pair.hi) and \(pair.lo) of 256"))
    }
}
