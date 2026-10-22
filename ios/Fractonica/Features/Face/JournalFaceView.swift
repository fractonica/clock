import FractonicaKit
import SwiftUI

/// The journal face (src/ui/face/journal.js, docs/design/10-face.md): the clock read the way the diary addresses it.
///
///     top      the lead unit's phase: a 256-state pair of 2-stroke glyphs and its letter (minor units), or one big
///              3-stroke glyph (Alpha … Delta)
///     middle   "34η 29ι 21λ" / "ε#05 34η 29ι": every count in two digits, one size, numbers white and letters in
///              their level colours; a major period alone in four lines: "5th / Delta / Trifracton / End"
///     bottom   the lead unit's cycle as two half-arcs (left descending, right ascending), quarter dots, a tick at the
///              present phase, the part already run bright, and its letter
///
/// The view only draws: taps arrive through `onTap` (logical points), steps come back as a new `frame`.
struct JournalFaceView: View {
    /// Nil outside the catalogue.
    let frame: JournalFrame?
    let outOfRange: (title: [String], range: [String])
    /// Digits roll and glyphs cross-fade (off during a time-lapse).
    var animated = true
    /// −1 after a step to a longer unit (the new reading arrives from the top), +1 after a shorter one.
    var stepDirection = 0
    var flash = FaceFlash()
    /// A step that was refused at an end of the ladder: the reading bounces.
    var bounce = 0
    var onTap: ((CGPoint) -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hover: FaceRegion?

    var body: some View {
        GeometryReader { geo in
            let fit = FaceFit(size: geo.size)
            ZStack(alignment: .topLeading) {
                FaceBody(fit: fit, dimmed: frame == nil)
                dividers(fit)
                if let hover, let y = hoverEdge(hover) {
                    RegionWash(fit: fit, region: hover, boundary: y, color: .white, strength: 0.06)
                        .mask { PillMask(fit: fit) }
                    RegionChevron(fit: fit, region: hover, y: y)
                }
                ZStack(alignment: .topLeading) {
                    if let frame {
                        JournalReadingView(frame: frame, fit: fit, animated: animated && !reduceMotion)
                            .id(frame.unit)
                            .transition(unitTransition(fit))
                    } else {
                        outOfRangeView(fit)
                    }
                }
                .keyframeAnimator(initialValue: 0.0, trigger: bounce) { content, dy in
                    content.offset(y: dy)
                } keyframes: { _ in
                    SpringKeyframe(reduceMotion ? 0 : fit.length(CGFloat(-stepDirection) * 9), duration: 0.12, spring: .snappy)
                    SpringKeyframe(0, duration: 0.42, spring: .bouncy)
                }
                .mask { PillMask(fit: fit) }
                FlashWash(fit: fit, flash: flash, topBoundary: JournalGeometry.topEnd, bottomBoundary: JournalGeometry.bottomStart)
                FaceGlare(fit: fit)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(.rect)
            .onTapGesture(coordinateSpace: .local) { location in
                onTap?(fit.logical(location))
            }
            .onContinuousHover(coordinateSpace: .local) { phase in
                switch phase {
                case .active(let location):
                    let region = JournalGeometry.region(at: fit.logical(location))
                    hover = region == .middle ? nil : region
                case .ended:
                    hover = nil
                }
            }
        }
        .aspectRatio(FaceSpace.aspectRatio, contentMode: .fit)
    }

    private func hoverEdge(_ region: FaceRegion) -> CGFloat? {
        switch region {
        case .top: JournalGeometry.topEnd
        case .bottom: JournalGeometry.bottomStart
        case .middle: nil
        }
    }

    /// A new unit slides in from the side it came from and the old one fades; Reduce Motion only cross-fades.
    private func unitTransition(_ fit: FaceFit) -> AnyTransition {
        guard !reduceMotion, stepDirection != 0 else { return .opacity }
        return .asymmetric(
            insertion: .modifier(active: SlideFade(dy: fit.length(CGFloat(stepDirection) * 30), opacity: 0, blur: fit.length(2)),
                                 identity: SlideFade(dy: 0, opacity: 1, blur: 0)),
            removal: .modifier(active: SlideFade(dy: fit.length(CGFloat(-stepDirection) * 12), opacity: 0, blur: fit.length(2)),
                               identity: SlideFade(dy: 0, opacity: 1, blur: 0))
        )
    }

    /// The faint lines between the tap thirds.
    private func dividers(_ fit: FaceFit) -> some View {
        Path { p in
            for y in [JournalGeometry.topEnd, JournalGeometry.bottomStart] {
                p.move(to: fit.point(34, y))
                p.addLine(to: fit.point(FaceSpace.width - 34, y))
            }
        }
        .stroke(Color.white.opacity(0.06), lineWidth: max(0.5, fit.length(1)))
        .accessibilityHidden(true)
    }

    private func outOfRangeView(_ fit: FaceFit) -> some View {
        let cy = FaceSpace.cy
        return ZStack(alignment: .topLeading) {
            ForEach(Array(outOfRange.title.enumerated()), id: \.offset) { i, line in
                FaceText(text: Text(line).font(.system(size: fit.length(13), weight: .medium)).foregroundStyle(Theme.ink2),
                         fit: fit, x: FaceSpace.cx, y: cy - 26 + CGFloat(i) * 18, height: 18)
            }
            ForEach(Array(outOfRange.range.enumerated()), id: \.offset) { i, line in
                FaceText(text: Text(line).font(.code(fit.length(11))).foregroundStyle(Theme.ink3),
                         fit: fit, x: FaceSpace.cx, y: cy + 22 + CGFloat(i) * 16, height: 16)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Offset, opacity and blur, for the unit transition.
struct SlideFade: ViewModifier {
    let dy: CGFloat
    let opacity: Double
    let blur: CGFloat

    func body(content: Content) -> some View {
        content.offset(y: dy).opacity(opacity).blur(radius: blur)
    }
}

/// One unit's reading: the lead glyphs, the middle line(s) and the cycle.
private struct JournalReadingView: View {
    let frame: JournalFrame
    let fit: FaceFit
    let animated: Bool

    var body: some View {
        let color = Theme.levelColor(frame.leadLevel)
        ZStack(alignment: .topLeading) {
            top(color)
            middle(color)
            JournalCycle(phase: frame.phase, color: color, fit: fit)
            letter(at: JournalGeometry.bottomLetterY, color)
        }
    }

    // MARK: Top: the lead unit's phase

    @ViewBuilder
    private func top(_ color: Color) -> some View {
        if let glyph = frame.glyph3 {
            FaceGlyph(index: glyph, strokes: 3, color: color,
                      rect: GlyphLayout.logicalRect(strokes: 3, height: JournalGeometry.majorGlyphHeight,
                                                    centerX: FaceSpace.cx, centerY: JournalGeometry.glyphCenterY),
                      fit: fit, ink: 2.8, glow: 0.35, animated: animated && frame.calmGlyphs)
        } else if let pair = frame.pair {
            let h = JournalGeometry.pairGlyphHeight
            let one = GlyphLayout.logicalRect(strokes: 2, height: h, centerX: 0, centerY: 0).width
            let half = (one + JournalGeometry.pairGap) / 2
            ForEach(Array(pair.enumerated()), id: \.offset) { i, index in
                FaceGlyph(index: index, strokes: 2, color: color,
                          rect: GlyphLayout.logicalRect(strokes: 2, height: h, centerX: FaceSpace.cx + (i == 0 ? -half : half),
                                                        centerY: JournalGeometry.glyphCenterY),
                          fit: fit, ink: 2.6, glow: 0.35, animated: animated && frame.calmGlyphs)
            }
            letter(at: JournalGeometry.topLetterY, color)
        }
    }

    private func letter(at y: CGFloat, _ color: Color) -> some View {
        FaceText(text: Text(frame.leadLetter).font(.system(size: fit.length(JournalGeometry.letterSize), weight: .medium))
            .foregroundStyle(color), fit: fit, x: FaceSpace.cx, y: y, width: 40, height: 20)
            .accessibilityHidden(true)
    }

    // MARK: Middle: the reading

    @ViewBuilder
    private func middle(_ color: Color) -> some View {
        if frame.isMajor {
            majorLines(color)
        } else {
            FaceText(text: tokensText.font(.system(size: fit.length(JournalGeometry.minorTextSize), weight: .semibold))
                .monospacedDigit().foregroundStyle(Theme.ink),
                     fit: fit, x: FaceSpace.cx, y: FaceSpace.cy, width: JournalGeometry.middleWidth, height: 40)
                .contentTransition(animated && frame.calmText ? .numericText() : .identity)
                .animation(animated && frame.calmText ? .smooth(duration: 0.45) : nil, value: frame.middleText)
                .accessibilityHidden(true)
        }
    }

    /// "34η 29ι 21λ": white numbers, letters in their level colours.
    private var tokensText: Text {
        var text = Text(verbatim: "")
        for (i, token) in frame.tokens.enumerated() {
            let c = Theme.levelColor(token.level)
            let p = token.parts
            let piece = Text("\(Text(verbatim: p.prefix).foregroundStyle(c))\(Text(verbatim: p.digits))\(Text(verbatim: p.suffix).foregroundStyle(c))")
            text = i == 0 ? piece : Text("\(text) \(piece)")
        }
        return text
    }

    /// "5th / Delta / Trifracton / End": one size for the four lines, from the longest (journal.js `fitSize`).
    private func majorLines(_ color: Color) -> some View {
        let longest = CGFloat(frame.lines.map(\.count).max() ?? 10)
        let size = max(13, min(24, JournalGeometry.middleWidth / (longest * 0.56)))
        let lead = size * 1.3
        let y0 = FaceSpace.cy - lead * CGFloat(frame.lines.count - 1) / 2
        return ZStack(alignment: .topLeading) {
            ForEach(Array(frame.lines.enumerated()), id: \.offset) { i, line in
                let name = i == 1 || i == 2
                FaceText(text: Text(verbatim: line)
                    .font(.system(size: fit.length(name ? size : size * 0.8), weight: name ? .semibold : .regular))
                    .foregroundStyle(name ? color : (i == 0 ? Theme.ink : Theme.ink2)),
                         fit: fit, x: FaceSpace.cx, y: y0 + CGFloat(i) * lead, width: JournalGeometry.middleWidth, height: lead)
                    .contentTransition(animated ? .numericText() : .identity)
            }
        }
        .animation(animated ? .smooth(duration: 0.45) : nil, value: frame.lines)
        .accessibilityHidden(true)
    }
}

/// The lead unit's cycle at the bottom: two half-arcs on an axis, the part already run in full colour and the rest
/// dim, dots at the quarter thresholds and a white tick at the present phase (journal.js, bottom group).
private struct JournalCycle: View {
    let phase: Double
    let color: Color
    let fit: FaceFit

    var body: some View {
        Canvas { context, _ in
            let s = fit.scale
            let r = JournalGeometry.arcRadius
            let y = JournalGeometry.arcY
            var axis = Path()
            axis.move(to: fit.point(FaceSpace.cx - 2 * r - 4, y))
            axis.addLine(to: fit.point(FaceSpace.cx + 2 * r + 4, y))
            context.stroke(axis, with: .color(.white.opacity(0.12)), lineWidth: max(0.5, s))

            let line = StrokeStyle(lineWidth: 2.4 * s, lineCap: .round)
            context.stroke(arc(from: 0, to: 1), with: .color(color.opacity(0.3)), style: line)
            var lit = context
            lit.addFilter(.shadow(color: color.opacity(0.5), radius: 1.6 * s))
            lit.stroke(arc(from: 0, to: phase), with: .color(color), style: line)

            for f in JournalGeometry.quarterMarks {
                let q = fit.point(JournalGeometry.arcPoint(f).point.x, JournalGeometry.arcPoint(f).point.y)
                let d = 1.6 * s
                context.fill(Path(ellipseIn: CGRect(x: q.x - d, y: q.y - d, width: 2 * d, height: 2 * d)),
                             with: .color(f <= phase ? color : color.opacity(0.6)))
            }

            let q = JournalGeometry.arcPoint(phase)
            var tick = Path()
            tick.move(to: fit.point(q.point.x - q.normal.dx * 9, q.point.y - q.normal.dy * 9))
            tick.addLine(to: fit.point(q.point.x + q.normal.dx * 9, q.point.y + q.normal.dy * 9))
            var glow = context
            glow.addFilter(.shadow(color: .white.opacity(0.55), radius: 2.5 * s))
            glow.stroke(tick, with: .color(.white), style: StrokeStyle(lineWidth: 2.2 * s, lineCap: .round))
            let c = fit.point(q.point.x, q.point.y)
            let d = 3.4 * s
            glow.fill(Path(ellipseIn: CGRect(x: c.x - d, y: c.y - d, width: 2 * d, height: 2 * d)), with: .color(.white))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// The double arc from cycle fraction a to b, sampled finely enough to stay smooth at any size.
    private func arc(from a: Double, to b: Double) -> Path {
        var p = Path()
        let lo = max(0, min(1, a))
        let hi = max(lo, min(1, b))
        let steps = max(1, Int(((hi - lo) * 192).rounded(.up)))
        for i in 0...steps {
            let f = lo + (hi - lo) * Double(i) / Double(steps)
            let q = JournalGeometry.arcPoint(f).point
            let v = fit.point(q.x, q.y)
            if i == 0 { p.move(to: v) } else { p.addLine(to: v) }
        }
        return p
    }
}
