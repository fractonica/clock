import FractonicaKit
import SwiftUI

/// What the gaps beside the solar odometer show (SPEC §8): nothing, the period letters, or the info labels.
enum WatchOverlay: Equatable, Sendable {
    case none, letters, info
}

/// The spec's watch face (SPEC §8–§10, src/ui/face/screen.js): two teal period odometers (depth D over D+1), their
/// sibling counters on the rounded ends, the gold solar odometer in the middle, and in the gaps the period letters or
/// the info labels. Taps arrive through `onTap` (logical points).
struct WatchFaceView: View {
    /// Nil outside the catalogue.
    let frame: WatchFrame?
    let overlay: WatchOverlay
    let outOfRange: (title: [String], range: [String])
    let solarUnavailable: [String]
    /// The level highlighted across the app: its row gets a plate.
    var selectedLevel: Int? = nil
    /// Glyph changes cue with a short cross-fade (off during a time-lapse).
    var animated = true
    var flash = FaceFlash()
    var bounce = 0
    var bounceDirection = 0
    var onTap: ((CGPoint) -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hover: FaceRegion?

    var body: some View {
        GeometryReader { geo in
            let fit = FaceFit(size: geo.size)
            ZStack(alignment: .topLeading) {
                FaceBody(fit: fit, dimmed: frame == nil)
                if let hover, hover != .middle, frame != nil {
                    let edge = hover == .top ? FaceSpace.cy - WatchGeometry.regionHalf : FaceSpace.cy + WatchGeometry.regionHalf
                    RegionWash(fit: fit, region: hover, boundary: edge, color: .white, strength: 0.075)
                        .mask { PillMask(fit: fit) }
                    RegionChevron(fit: fit, region: hover, y: edge)
                }
                ZStack(alignment: .topLeading) {
                    if let frame {
                        readings(frame, fit)
                    } else {
                        outOfRangeView(fit)
                    }
                }
                .keyframeAnimator(initialValue: 0.0, trigger: bounce) { content, dy in
                    content.offset(y: dy)
                } keyframes: { _ in
                    SpringKeyframe(reduceMotion ? 0 : fit.length(CGFloat(-bounceDirection) * 8), duration: 0.12, spring: .snappy)
                    SpringKeyframe(0, duration: 0.42, spring: .bouncy)
                }
                .mask { PillMask(fit: fit) }
                FlashWash(fit: fit, flash: flash, topBoundary: FaceSpace.cy - WatchGeometry.regionHalf,
                          bottomBoundary: FaceSpace.cy + WatchGeometry.regionHalf)
                FaceGlare(fit: fit)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .contentShape(.rect)
            .onTapGesture(coordinateSpace: .local) { location in
                onTap?(fit.logical(location))
            }
            .onContinuousHover(coordinateSpace: .local) { phase in
                switch phase {
                case .active(let location): hover = WatchGeometry.region(at: fit.logical(location))
                case .ended: hover = nil
                }
            }
        }
        .aspectRatio(FaceSpace.aspectRatio, contentMode: .fit)
    }

    // MARK: Readings

    @ViewBuilder
    private func readings(_ f: WatchFrame, _ fit: FaceFit) -> some View {
        plates(f, fit)
        WatchCounters(top: f.top, bottom: f.bottom, fit: fit)
        row(.top, digits: f.top.digits, color: Theme.teal, calm: [f.top.calmCoarse, f.top.calmFine], fit: fit)
        row(.bottom, digits: f.bottom.digits, color: Theme.teal, calm: [f.bottom.calmCoarse, f.bottom.calmFine], fit: fit)
        if let solar = f.solar {
            row(.solar, digits: solar, color: Theme.gold, calm: [true, true, true], fit: fit)
        } else {
            solarUnavailableView(fit)
        }
        if overlay == .letters {
            letters(f, fit).transition(.opacity)
        }
        if overlay == .info, let info = f.info {
            infoLabels(info, fit).transition(.opacity)
        }
    }

    private func plates(_ f: WatchFrame, _ fit: FaceFit) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach([(WatchGeometry.Row.top, f.top.level), (.bottom, f.bottom.level)], id: \.1) { row, level in
                if level == selectedLevel {
                    let r = fit.rect(WatchGeometry.plate(row))
                    RoundedRectangle(cornerRadius: fit.length(WatchGeometry.plateRadius))
                        .fill(Theme.levelColor(level, opacity: 0.06))
                        .strokeBorder(Theme.levelColor(level, opacity: 0.28), lineWidth: max(0.5, fit.length(1)))
                        .frame(width: r.width, height: r.height)
                        .position(x: r.midX, y: r.midY)
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func row(_ row: WatchGeometry.Row, digits: [Int], color: Color, calm: [Bool], fit: FaceFit) -> some View {
        let rect = WatchGeometry.glyphRect(row)
        let dx = WatchGeometry.stemDistance(row)
        let width = 4.3 * WatchGeometry.unit
        return ZStack(alignment: .topLeading) {
            ForEach(Array(digits.enumerated()), id: \.offset) { i, index in
                FaceGlyph(index: index, color: color,
                          rect: CGRect(x: rect.minX + CGFloat(i) * dx, y: rect.minY, width: width, height: rect.height),
                          fit: fit, glow: 0.5, animated: animated && !reduceMotion && calm[min(i, calm.count - 1)])
            }
        }
    }

    // MARK: Overlays

    /// The Greek letters of the two periods with their depths; pure mode names the running cycle under each, on the
    /// side that faces the solar row.
    private func letters(_ f: WatchFrame, _ fit: FaceFit) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach([(f.top, CGFloat(-1)), (f.bottom, CGFloat(1))], id: \.1) { period, side in
                let y = FaceSpace.cy + side * WatchGeometry.labelDY
                FaceText(text: Text(verbatim: period.letter).font(.system(size: fit.length(27), weight: .medium))
                    .foregroundStyle(Theme.teal), fit: fit, x: FaceSpace.cx, y: y, width: 40, height: 34)
                FaceText(text: Text(verbatim: "\(period.level + 1)").font(.code(fit.length(10), weight: .medium))
                    .foregroundStyle(Theme.ink3), fit: fit, x: FaceSpace.cx + 15, y: y + 5, width: 30, height: 14,
                         alignment: .leading)
                if !period.name.isEmpty {
                    FaceText(text: Text(verbatim: period.name).font(.system(size: fit.length(9.5), weight: .medium))
                        .tracking(fit.length(0.3)).foregroundStyle(Theme.ink2),
                             fit: fit, x: FaceSpace.cx, y: y - side * 23, width: 150, height: 14)
                }
            }
        }
        .accessibilityHidden(true)
    }

    /// SPEC §8 info labels: the next threshold of the top period, the next solar threshold and the sync time.
    private func infoLabels(_ m: FaceWords.InfoLabels, _ fit: FaceFit) -> some View {
        let cy = FaceSpace.cy
        let d = WatchGeometry.labelDY
        return ZStack(alignment: .topLeading) {
            caption(m.topCaption, y: cy - d - 9, fit)
            value(m.topValue, color: Theme.teal, y: cy - d + 7, fit)
            if m.solarAvailable {
                caption(m.solarCaption, y: cy + d - 30, fit)
                value(m.solarValue, color: Theme.gold, y: cy + d - 15, fit)
                caption(m.syncCaption, y: cy + d + 5, fit)
                value(m.syncValue, color: Theme.gold.opacity(0.78), y: cy + d + 20, fit)
            }
        }
        .accessibilityHidden(true)
    }

    private func caption(_ s: String, y: CGFloat, _ fit: FaceFit) -> some View {
        FaceText(text: Text(verbatim: s).font(.system(size: fit.length(10), weight: .semibold)).tracking(fit.length(1))
            .foregroundStyle(Theme.ink3), fit: fit, x: FaceSpace.cx, y: y, width: 160, height: 14)
    }

    private func value(_ s: String, color: Color, y: CGFloat, _ fit: FaceFit) -> some View {
        FaceText(text: Text(verbatim: s).font(.code(fit.length(12.5))).foregroundStyle(color),
                 fit: fit, x: FaceSpace.cx, y: y, width: 168, height: 16)
    }

    // MARK: States

    private func solarUnavailableView(_ fit: FaceFit) -> some View {
        let cy = FaceSpace.cy
        return ZStack(alignment: .topLeading) {
            caption("SOLAR SYNC", y: cy - 7, fit)
            ForEach(Array(solarUnavailable.enumerated()), id: \.offset) { i, line in
                FaceText(text: Text(verbatim: line).font(.code(fit.length(11))).foregroundStyle(Theme.ink3),
                         fit: fit, x: FaceSpace.cx, y: cy + 9 + CGFloat(i) * 14, width: 170, height: 14)
            }
        }
        .accessibilityHidden(true)
    }

    private func outOfRangeView(_ fit: FaceFit) -> some View {
        let cy = FaceSpace.cy
        return ZStack(alignment: .topLeading) {
            ForEach(Array(outOfRange.title.enumerated()), id: \.offset) { i, line in
                FaceText(text: Text(verbatim: line).font(.system(size: fit.length(13), weight: .medium)).foregroundStyle(Theme.ink2),
                         fit: fit, x: FaceSpace.cx, y: cy - 26 + CGFloat(i) * 18, height: 18)
            }
            ForEach(Array(outOfRange.range.enumerated()), id: \.offset) { i, line in
                FaceText(text: Text(verbatim: line).font(.code(fit.length(11))).foregroundStyle(Theme.ink3),
                         fit: fit, x: FaceSpace.cx, y: cy + 22 + CGFloat(i) * 16, height: 16)
            }
        }
    }
}

/// The two sibling counters (SPEC §6.1, §8): one dot per cycle of the parent on the arc of each rounded end, lit up to
/// the running one, which glows.
private struct WatchCounters: View {
    let top: WatchFrame.Period
    let bottom: WatchFrame.Period
    let fit: FaceFit

    var body: some View {
        Canvas { context, _ in
            draw(top, isTop: true, in: &context)
            draw(bottom, isTop: false, in: &context)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func draw(_ p: WatchFrame.Period, isTop: Bool, in context: inout GraphicsContext) {
        let s = fit.scale
        for (i, q) in WatchGeometry.counterPositions(count: p.siblings, top: isTop).enumerated() {
            let c = fit.point(q.x, q.y)
            let lit = i <= p.local
            let now = i == p.local
            let r = (now ? 4.1 : lit ? 3.3 : 2.7) * s
            let dot = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
            if now {
                var glow = context
                glow.addFilter(.shadow(color: Theme.teal.opacity(0.85), radius: 3 * s))
                glow.fill(dot, with: .color(Theme.teal))
            } else if lit {
                context.fill(dot, with: .color(Theme.teal))
            } else {
                context.stroke(dot, with: .color(Theme.teal.opacity(0.5)), lineWidth: 1.2 * s)
            }
        }
    }
}
