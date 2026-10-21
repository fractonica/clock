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

    @ScaledMetric(relativeTo: .body) private var side = 38.0

    var body: some View {
        let color = Theme.levelColor(level)
        VStack(spacing: -2) {
            Text(LadderText.letter(level))
                .font(.system(size: side * 0.47, weight: .semibold))
            Text("\(level + 1)")
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
            Text("\(level + 1)").font(.caption2.weight(.medium).monospacedDigit()).opacity(0.75)
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
    static let barHeight: CGFloat = 6
    static let overhang: CGFloat = 3

    var body: some View {
        Canvas { context, size in draw(in: &context, size: size) }
            .frame(height: Self.barHeight + 2 * Self.overhang)
            .accessibilityHidden(true)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let n = max(1, factor)
        let gap: CGFloat = size.width / CGFloat(n) > 10 ? 2 : 1
        let width = (size.width - gap * CGFloat(n - 1)) / CGFloat(n)
        let y = Self.overhang
        let h = Self.barHeight
        let radius = min(2, h / 2, width / 2)
        let color = Theme.levelColor(level)
        let x = { (i: Int) in CGFloat(i) * (width + gap) }
        /// Where a phase falls along the bar, gaps included.
        let position = { (p: Double) -> CGFloat in
            let s = LadderText.segment(phase: p, factor: n)
            return x(s.index) + CGFloat(s.frac) * width
        }
        let seg = phase.map { LadderText.segment(phase: $0, factor: n) }
        let clipX = clip.map(position)

        for i in 0..<n {
            let rect = CGRect(x: x(i), y: y, width: width, height: h)
            let shape = Path(roundedRect: rect, cornerRadius: radius, style: .continuous)
            guard let seg else {
                context.fill(shape, with: .color(Theme.line))
                continue
            }
            if let clipX, rect.minX >= clipX {
                context.stroke(shape.strokedPath(StrokeStyle(lineWidth: 0.75, dash: [2, 2])), with: .color(Theme.line2))
                continue
            }
            if still {
                context.fill(shape, with: .color(Theme.levelColor(level, opacity: 0.32)))
                continue
            }
            context.fill(shape, with: .color(Theme.levelColor(level, opacity: i < seg.index ? 0.5 : 0.13)))
            if i == seg.index, seg.frac > 0 {
                var part = context
                part.clip(to: Path(CGRect(x: rect.minX, y: rect.minY, width: rect.width * CGFloat(seg.frac), height: h)))
                part.fill(shape, with: .color(color))
            }
        }

        // quarter thresholds: hairline ticks below (and, on the selected row, above) the bar
        let tick = Theme.ink3.opacity(emphasized ? 0.9 : 0.45)
        for q in 1...3 {
            let qx = (position(Double(q) / 4) * 2).rounded() / 2
            var path = Path()
            path.move(to: CGPoint(x: qx, y: y + h + 0.5))
            path.addLine(to: CGPoint(x: qx, y: y + h + Self.overhang))
            if emphasized {
                path.move(to: CGPoint(x: qx, y: 0))
                path.addLine(to: CGPoint(x: qx, y: y - 0.5))
            }
            context.stroke(path, with: .color(tick), lineWidth: 1)
        }

        if let clipX {
            var end = Path()
            end.move(to: CGPoint(x: clipX, y: 0))
            end.addLine(to: CGPoint(x: clipX, y: size.height))
            context.stroke(end, with: .color(Theme.danger), lineWidth: 1.5)
        }

        // the displayed instant
        if let phase, !still {
            let px = position(phase)
            let marker = Path(roundedRect: CGRect(x: px - 0.75, y: 0.5, width: 1.5, height: size.height - 1), cornerRadius: 0.75)
            context.fill(marker, with: .color(Theme.ink))
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
