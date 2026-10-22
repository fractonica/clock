import FractonicaKit
import SwiftUI

// The small parts the ladder and Up next are built from: the depth chips, the segmented progress bar, the phase mark
// at the end of a row and a countdown that speeds up by itself near its end.

// MARK: - Chips

/// A level's chip: its letter in the level colour over a tinted tile, the depth number beneath.
struct LevelChip: View {
    let level: Int
    var prominent = false
    var dimmed = false
    /// The side at the default text size (the ladder's 38, the Up next hero's 54); it follows Dynamic Type.
    var baseSide: CGFloat = 38

    @ScaledMetric(relativeTo: .body) private var scale = 1.0

    var body: some View {
        let side = baseSide * scale
        let color = Theme.levelColor(level)
        VStack(spacing: -2) {
            Text(LadderText.letter(level))
                .font(.system(size: side * 0.47, weight: .semibold))
            Text(verbatim: "\(level + 1)")
                .font(.system(size: side * 0.24, weight: .medium).monospacedDigit())
                .foregroundStyle(Theme.ink3)
        }
        .foregroundStyle(color)
        .frame(width: side, height: side)
        .background {
            RoundedRectangle(cornerRadius: side * 0.26, style: .continuous)
                .fill(Theme.levelColor(level, opacity: prominent ? 0.24 : 0.11))
        }
        .overlay {
            RoundedRectangle(cornerRadius: side * 0.26, style: .continuous)
                .strokeBorder(Theme.levelColor(level, opacity: prominent ? 0.75 : 0), lineWidth: 1)
        }
        .opacity(dimmed ? 0.45 : 1)
        .accessibilityHidden(true)
    }
}

/// "ε 5" in a capsule, for lists and captions.
struct MiniChip: View {
    let level: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(LadderText.letter(level)).font(.subheadline.weight(.semibold))
            Text(verbatim: "\(level + 1)").font(.caption2.weight(.medium).monospacedDigit()).opacity(0.75)
        }
        .foregroundStyle(Theme.levelColor(level))
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(Theme.levelColor(level, opacity: 0.14), in: .capsule)
        .accessibilityHidden(true)
    }
}

// MARK: - Segmented bar

/// A cycle's progress as one segment per child cycle (lib.js `segmentState`): the finished children filled, the
/// current one filled up to the exact phase, a hairline at the displayed instant and ticks at the quarter thresholds.
///
/// The track is drawn once per segment (`SegmentTrack`); what moves inside the current segment — its fill and the
/// hairline — is laid out over it (`SegmentProgress`), so a tick moves two layers instead of redrawing the canvas
/// (a canvas renders on the main thread, a texture per redraw).
struct SegmentBar: View {
    let level: Int
    let factor: Int
    /// Position-linear phase 0 … 1; nil draws the empty track (outside the catalogue).
    let phase: Double?
    /// Draw the bar as a blur, without a position: cycles too fast to follow.
    var still = false
    /// Stronger quarter ticks (the selected row).
    var emphasized = false
    /// The phase where the catalogue ends inside this cycle, if it does.
    var clip: Double? = nil

    /// The bar's own height; ticks and the hairline reach `overhang` beyond it.
    nonisolated static let barHeight: CGFloat = 6
    nonisolated static let overhang: CGFloat = 3

    var body: some View {
        let current = phase.map { LadderText.segment(phase: $0, factor: max(1, factor)).index }
        SegmentTrack(level: level, factor: factor, current: current, still: still, emphasized: emphasized, clip: clip)
            .overlay {
                SegmentProgress(level: level, factor: factor, phase: still ? nil : phase, clip: clip)
            }
            .frame(height: Self.barHeight + 2 * Self.overhang)
            .accessibilityHidden(true)
    }
}

/// Where the segments of a bar fall, shared by the track and what moves over it.
private struct SegmentGeometry {
    let n: Int
    let gap: CGFloat
    /// One segment's width.
    let width: CGFloat
    let radius: CGFloat

    init(barWidth: CGFloat, factor: Int) {
        n = max(1, factor)
        gap = barWidth / CGFloat(n) > 10 ? 2 : 1
        width = (barWidth - gap * CGFloat(n - 1)) / CGFloat(n)
        radius = min(2, SegmentBar.barHeight / 2, width / 2)
    }

    func x(_ i: Int) -> CGFloat { CGFloat(i) * (width + gap) }

    /// Where a phase falls along the bar, gaps included.
    func position(_ p: Double) -> CGFloat {
        let s = LadderText.segment(phase: p, factor: n)
        return x(s.index) + CGFloat(s.frac) * width
    }
}

/// The bar without what moves inside the current segment: every segment's ground (the finished ones filled), what lies
/// past the end of the catalogue and the quarter ticks. Its inputs change only when the current segment does.
private struct SegmentTrack: View {
    let level: Int
    let factor: Int
    /// The segment the displayed time is in; nil draws the empty track (outside the catalogue).
    let current: Int?
    let still: Bool
    let emphasized: Bool
    let clip: Double?

    var body: some View {
        Canvas { context, size in draw(in: &context, size: size) }
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let geometry = SegmentGeometry(barWidth: size.width, factor: factor)
        let y = SegmentBar.overhang
        let h = SegmentBar.barHeight
        let clipX = clip.map(geometry.position)

        for i in 0..<geometry.n {
            let rect = CGRect(x: geometry.x(i), y: y, width: geometry.width, height: h)
            let shape = Path(roundedRect: rect, cornerRadius: geometry.radius, style: .continuous)
            var g = context
            guard let current else {
                g.fill(shape, with: .color(Theme.line))
                continue
            }
            if let clipX, rect.maxX > clipX {
                // past the end of the catalogue: an outline of what would have been
                var beyond = context
                beyond.clip(to: Path(CGRect(x: clipX, y: 0, width: size.width, height: size.height)))
                beyond.stroke(shape.strokedPath(StrokeStyle(lineWidth: 0.75, dash: [2, 2])), with: .color(Theme.line2))
                if rect.minX >= clipX { continue }
                g.clip(to: Path(CGRect(x: 0, y: 0, width: clipX, height: size.height)))
            }
            if still {
                g.fill(shape, with: .color(Theme.levelColor(level, opacity: 0.32)))
                continue
            }
            g.fill(shape, with: .color(Theme.levelColor(level, opacity: i < current ? 0.5 : 0.13)))
        }

        // quarter thresholds: hairline ticks below (and, on the selected row, above) the bar
        let tick = Theme.ink3.opacity(emphasized ? 0.9 : 0.45)
        for q in 1...3 {
            let qx = (geometry.position(Double(q) / 4) * 2).rounded() / 2
            var path = Path()
            path.move(to: CGPoint(x: qx, y: y + h + 0.5))
            path.addLine(to: CGPoint(x: qx, y: y + h + SegmentBar.overhang))
            if emphasized {
                path.move(to: CGPoint(x: qx, y: 0))
                path.addLine(to: CGPoint(x: qx, y: y - 0.5))
            }
            context.stroke(path, with: .color(tick), lineWidth: 1)
        }
    }
}

/// What moves over the track: the current segment filled up to the phase, the end of the catalogue and the hairline
/// at the displayed instant, as shapes of a fixed size that only change place, so a tick redraws nothing.
private struct SegmentProgress: View {
    let level: Int
    let factor: Int
    /// nil: no fill and no hairline (outside the catalogue, or too fast to follow).
    let phase: Double?
    let clip: Double?

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let geometry = SegmentGeometry(barWidth: size.width, factor: factor)
            ZStack(alignment: .topLeading) {
                if let phase {
                    let seg = LadderText.segment(phase: phase, factor: geometry.n)
                    if seg.frac > 0 {
                        // the segment's own shape, uncovered from its leading edge up to the phase
                        RoundedRectangle(cornerRadius: geometry.radius, style: .continuous)
                            .fill(Theme.levelColor(level))
                            .frame(width: geometry.width, height: SegmentBar.barHeight)
                            .mask(alignment: .leading) {
                                Rectangle().frame(width: geometry.width * CGFloat(seg.frac))
                            }
                            .offset(x: geometry.x(seg.index), y: SegmentBar.overhang)
                    }
                }
                if let clip {
                    Rectangle()
                        .fill(Theme.danger)
                        .frame(width: 1.5, height: size.height)
                        .offset(x: geometry.position(clip) - 0.75)
                }
                if let phase {
                    RoundedRectangle(cornerRadius: 0.75)
                        .fill(Theme.ink)
                        .frame(width: 1.5, height: max(0, size.height - 1))
                        .offset(x: geometry.position(phase) - 0.75, y: 0.5)
                }
            }
        }
    }
}

// MARK: - Phase marks

/// Four pips for a major period's quarter (pure mode never draws a major's phase): the passed ones filled, the
/// current one lit.
struct QuarterPips: View {
    /// 0 … 3; nil leaves all four blank.
    let quarter: Int?
    var color: Color = Theme.teal

    @ScaledMetric(relativeTo: .caption) private var pip = 5.0

    var body: some View {
        HStack(spacing: pip * 0.6) {
            ForEach(0..<4, id: \.self) { i in
                let state = quarter.map { i < $0 ? 0 : i == $0 ? 1 : 2 } ?? 2
                RoundedRectangle(cornerRadius: pip * 0.3, style: .continuous)
                    .fill(state == 0 ? color.opacity(0.45) : state == 1 ? color : .clear)
                    .overlay {
                        RoundedRectangle(cornerRadius: pip * 0.3, style: .continuous)
                            .strokeBorder(state == 2 ? Theme.ink3.opacity(0.7) : .clear, lineWidth: 1)
                    }
                    .frame(width: pip, height: pip * (state == 1 ? 2.2 : 1.6))
            }
        }
        .accessibilityElement()
        .accessibilityLabel(quarter.map { "\(Notation.quarterWords[$0]) quarter, \($0 + 1) of 4" } ?? "no quarter")
    }
}

/// The phase at the end of a ladder row: the level's glyph (Earth), the 256-state pair of a minor cycle or the quarter
/// pips of a major one (pure).
struct PhaseMark: View {
    let reading: LevelReading?
    let pure: Bool

    @ScaledMetric(relativeTo: .body) private var glyphHeight = 22.0

    var body: some View {
        Group {
            if let reading {
                if pure, Notation.isMajor(reading.level) {
                    QuarterPips(quarter: reading.quarter)
                } else if pure {
                    PairView(fraction: reading.phase, color: Theme.teal, height: glyphHeight * 0.72)
                } else {
                    GlyphView(index: reading.index, strokes: 2, color: Theme.teal)
                        .frame(height: glyphHeight)
                }
            } else {
                Color.clear
            }
        }
        .frame(width: glyphHeight * 1.5)
    }
}

// MARK: - Countdowns

/// A countdown that refreshes with its container and, near its end, faster by itself: Earth tenths below 10 s, pure
/// decimal Blinks below ten Blinks (`LadderCadence.countdown`).
struct LiveCountdown: View {
    /// When the countdown ends.
    let target: Double
    /// The displayed time of the container's tick.
    let t: Double
    /// The container's cadence (displayed seconds); nil when it already redraws every frame.
    let container: Double?
    let pure: Bool
    /// The text at a displayed time.
    let text: (Double) -> String

    var body: some View {
        if let container,
           let fine = LadderCadence.countdown(remaining: target - t, pure: pure, blinkSeconds: Notation.standard.blinkSeconds, container: container) {
            ClockTimeline(.periodic(fine)) { now in
                Text(text(LadderLaunch.shown(now)))
            }
        } else {
            Text(text(t))
        }
    }
}

// MARK: - Styles

/// A row that dims while pressed, like a list row, without the list's whole-row button behaviour.
struct LadderPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// A small caption above a value in the details: "ENDS", "THROUGH".
struct DetailKey: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(Theme.ink3)
    }
}
