import FractonicaKit
import SwiftUI

// The parts both faces share: the pill device (rim, glass, glare), the tap feedback washes, glyphs placed in logical
// units with their glow, and the faint chevrons that hint at the tap regions under a pointer. Everything is laid out
// with a `FaceFit` inside a full-size ZStack, so a face is crisp at any size.

/// A tap's visible answer: a wash from the end that was tapped, teal when the step happened, red when there was no
/// further unit or depth. `id` changes with every tap so the same wash can play again.
struct FaceFlash: Equatable, Sendable {
    var id = 0
    var region: FaceRegion = .top
    var refused = false
}

/// The pill: a dark rim, a black well and the glass (src/ui/face/screen.js `face-device`).
struct FaceBody: View {
    let fit: FaceFit
    /// Out of the catalogue: the glass is dimmed.
    var dimmed = false

    var body: some View {
        let screen = fit.screen
        let r = fit.length(FaceSpace.radius)
        ZStack {
            RoundedRectangle(cornerRadius: r + fit.length(5))
                .fill(LinearGradient(stops: [
                    .init(color: Theme.line2, location: 0),
                    .init(color: Theme.panel, location: 0.28),
                    .init(color: Theme.background, location: 0.62),
                    .init(color: Theme.line, location: 1),
                ], startPoint: .topLeading, endPoint: .bottomTrailing))
                .overlay {
                    RoundedRectangle(cornerRadius: r + fit.length(5))
                        .strokeBorder(Color.white.opacity(0.07), lineWidth: max(0.5, fit.length(0.8)))
                }
                .frame(width: screen.width + fit.length(10), height: screen.height + fit.length(10))
            RoundedRectangle(cornerRadius: r + fit.length(1.5))
                .fill(Color.black)
                .frame(width: screen.width + fit.length(3), height: screen.height + fit.length(3))
            RoundedRectangle(cornerRadius: r)
                .fill(EllipticalGradient(colors: [Theme.background, Color.black], center: .center, startRadiusFraction: 0,
                                         endRadiusFraction: 0.72))
                .opacity(dimmed ? 0.55 : 1)
                .frame(width: screen.width, height: screen.height)
        }
        .position(x: screen.midX, y: screen.midY)
        .accessibilityHidden(true)
    }
}

/// The glass's edge highlight, drawn over everything (screen.js `face-glare`).
struct FaceGlare: View {
    let fit: FaceFit

    var body: some View {
        let screen = fit.screen.insetBy(dx: fit.length(0.75), dy: fit.length(0.75))
        RoundedRectangle(cornerRadius: fit.length(FaceSpace.radius - 0.75))
            .stroke(LinearGradient(stops: [
                .init(color: .white.opacity(0.26), location: 0),
                .init(color: .white.opacity(0.05), location: 0.22),
                .init(color: .white.opacity(0), location: 0.55),
                .init(color: .white.opacity(0.05), location: 0.9),
                .init(color: .white.opacity(0.16), location: 1),
            ], startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: max(0.75, fit.length(1.5)))
            .frame(width: screen.width, height: screen.height)
            .position(x: screen.midX, y: screen.midY)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Clips content to the pill.
struct PillMask: View {
    let fit: FaceFit

    var body: some View {
        let screen = fit.screen
        RoundedRectangle(cornerRadius: fit.length(FaceSpace.radius))
            .frame(width: screen.width, height: screen.height)
            .position(x: screen.midX, y: screen.midY)
    }
}

/// A wash over the top or bottom tap region that fades towards the middle. `boundary` is the logical y where it
/// has faded out.
struct RegionWash: View {
    let fit: FaceFit
    let region: FaceRegion
    let boundary: CGFloat
    let color: Color
    let strength: Double

    var body: some View {
        let top = region == .top
        let rect = top
            ? CGRect(x: 0, y: 0, width: FaceSpace.width, height: boundary)
            : CGRect(x: 0, y: boundary, width: FaceSpace.width, height: FaceSpace.height - boundary)
        let r = fit.rect(rect)
        LinearGradient(colors: [color.opacity(strength), color.opacity(0)], startPoint: top ? .top : .bottom,
                       endPoint: top ? .bottom : .top)
            .frame(width: r.width, height: r.height)
            .position(x: r.midX, y: r.midY)
            .allowsHitTesting(false)
    }
}

/// The wash a tap leaves: it flares and fades in under half a second (screen.js `pulseRegion`).
struct FlashWash: View {
    let fit: FaceFit
    let flash: FaceFlash
    /// Logical y where the top region ends and where the bottom one begins.
    let topBoundary: CGFloat
    let bottomBoundary: CGFloat

    var body: some View {
        RegionWash(fit: fit, region: flash.region, boundary: flash.region == .top ? topBoundary : bottomBoundary,
                   color: flash.refused ? Theme.danger : Theme.teal, strength: flash.refused ? 0.26 : 0.3)
            .mask { PillMask(fit: fit) }
            .keyframeAnimator(initialValue: 0.0, trigger: flash.id) { content, opacity in
                content.opacity(opacity)
            } keyframes: { _ in
                LinearKeyframe(1, duration: 0.02)
                CubicKeyframe(0, duration: 0.44)
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// A faint chevron at a region's edge, shown while a pointer rests on that region (screen.js `face-chevron`).
struct RegionChevron: View {
    let fit: FaceFit
    let region: FaceRegion
    /// Logical y of the region's inner edge.
    let y: CGFloat

    var body: some View {
        Path { p in
            let up = region == .top
            let tip = up ? y - 16 : y + 16
            let base = up ? y - 8 : y + 8
            p.move(to: fit.point(88, base))
            p.addLine(to: fit.point(96, tip))
            p.addLine(to: fit.point(104, base))
        }
        .stroke(Theme.ink3.opacity(0.75), style: StrokeStyle(lineWidth: max(1, fit.length(1.6)), lineCap: .round, lineJoin: .round))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// One phase glyph placed by its logical bounds rectangle, with the soft glow of the watch face's ink. A change of
/// state cross-fades when `animated` (a calm glyph), else it simply redraws.
struct FaceGlyph: View {
    let index: Int
    var strokes = 2
    let color: Color
    /// The glyph's bounds in logical units.
    let rect: CGRect
    let fit: FaceFit
    /// Ink width in logical units; nil = 0.3 design units, pixel-snapped.
    var ink: CGFloat? = nil
    var glow: Double = 0.5
    var animated = false

    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let r = fit.rect(rect)
        ZStack {
            GlyphShape(index: index, strokes: strokes, lineWidth: ink.map(fit.length), pixelScale: displayScale)
                .fill(color)
                .shadow(color: color.opacity(glow), radius: fit.length(1.4))
                .id(index)
                .transition(.opacity)
        }
        .frame(width: r.width, height: r.height)
        .position(x: r.midX, y: r.midY)
        .animation(animated ? .easeOut(duration: 0.22) : nil, value: index)
        .accessibilityHidden(true)
    }
}

extension GlyphLayout {
    /// The logical bounds of one glyph of `strokes` strokes, `height` units tall, centred on (x, y).
    static func logicalRect(strokes: Int, height: CGFloat, centerX x: CGFloat, centerY y: CGFloat) -> CGRect {
        let b = bounds(strokes: strokes)
        let width = height * b.width / b.height
        return CGRect(x: x - width / 2, y: y - height / 2, width: width, height: height)
    }
}

/// Text placed at a logical point, sized in logical units.
struct FaceText: View {
    let text: Text
    let fit: FaceFit
    let x: CGFloat
    let y: CGFloat
    /// The box the text may use, in logical units; it shrinks to fit.
    var width: CGFloat = 176
    var height: CGFloat = 30
    var alignment: Alignment = .center

    var body: some View {
        text
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(width: fit.length(width), height: fit.length(height), alignment: alignment)
            .position(fit.point(x + (alignment == .leading ? width / 2 : 0), y))
            .allowsHitTesting(false)
    }
}
