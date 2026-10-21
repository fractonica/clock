import FractonicaKit
import SwiftUI
import WidgetKit

// Drawing parts the widgets share: coloured counts, the journal face's cycle arc, a ring dial, level chips and the
// out-of-range state. Everything is static per timeline entry (the system shows each entry as a still picture);
// only `Text(timerInterval:)` and `ProgressView(timerInterval:)` move by themselves.

// MARK: - Counts

/// A reading such as "34η 29ι": numbers in ink, letters (and the Nuclide's "ε#") in their levels' colours, one line,
/// monospaced digits so a changing count never shifts the layout.
struct TokensText: View {
    var tokens: [CountToken]
    var size: CGFloat
    var weight: Font.Weight = .semibold
    var ink: Color = Theme.ink

    var body: some View {
        tokens.enumerated().reduce(Text(verbatim: "")) { text, item in
            let (i, token) = item
            let color = Theme.levelColor(token.level)
            let prefix = Text(verbatim: token.prefix).foregroundStyle(color)
            let number = Text(verbatim: token.number).foregroundStyle(ink)
            let suffix = Text(verbatim: token.suffix).foregroundStyle(color)
            return Text("\(text)\(i == 0 ? "" : " ")\(prefix)\(number)\(suffix)")
        }
        .font(.reading(size, weight: weight))
        .lineLimit(1)
        .minimumScaleFactor(0.5)
        .accessibilityLabel(tokens.map(\.text).joined(separator: " "))
    }
}

// MARK: - The journal face's cycle

/// The lead cycle of the journal face (src/ui/face/journal.js, bottom): two half-arcs, the left one below the axis
/// (descending), the right one above it (ascending), dots at the five quarter thresholds and a white tick with a knob
/// at the present phase. Fits its frame at the face's proportions (`aspectRatio`).
struct JournalArc: View {
    var phase: Double
    var color: Color
    var tickColor: Color = .white

    /// Width ÷ height of the drawing: four radii across plus the tick's reach on each side.
    static let aspectRatio: CGFloat = (4 + 2 * tickReach) / (2 + 2 * tickReach)
    /// The face's proportions, in radii (R = 38 units there: tick ±9, line 2.4, knob 3.4, dots 1.6).
    static let tickReach: CGFloat = 9.0 / 38
    private static let line: CGFloat = 2.4 / 38
    private static let knob: CGFloat = 3.4 / 38
    private static let dot: CGFloat = 1.6 / 38

    var body: some View {
        Canvas { context, size in
            let r = min(size.width / (4 + 2 * Self.tickReach), size.height / (2 + 2 * Self.tickReach))
            let cx = size.width / 2, cy = size.height / 2
            let cl = cx - r, cr = cx + r
            let line = max(1.6, Self.line * r)
            // the axis
            var axis = Path()
            axis.move(to: CGPoint(x: cx - 2 * r - 0.1 * r, y: cy))
            axis.addLine(to: CGPoint(x: cx + 2 * r + 0.1 * r, y: cy))
            context.stroke(axis, with: .color(tickColor.opacity(0.14)), lineWidth: 1)
            // left half below the axis, right half above it (y grows downward)
            var arcs = Path()
            arcs.addArc(center: CGPoint(x: cl, y: cy), radius: r, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
            arcs.addArc(center: CGPoint(x: cr, y: cy), radius: r, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: false)
            context.stroke(arcs, with: .color(color), style: StrokeStyle(lineWidth: line, lineCap: .round))
            // quarter thresholds
            let dot = max(1.3, Self.dot * r)
            for f in [0, 0.25, 0.5, 0.75, 1.0] {
                let q = Journal.arcPoint(f, cl: cl, cr: cr, cy: cy, r: r)
                context.fill(Path(ellipseIn: CGRect(x: q.x - dot, y: q.y - dot, width: 2 * dot, height: 2 * dot)),
                             with: .color(color.opacity(0.65)))
            }
            // the present
            let q = Journal.arcPoint(phase, cl: cl, cr: cr, cy: cy, r: r)
            let reach = Self.tickReach * r
            var tick = Path()
            tick.move(to: CGPoint(x: q.x - q.nx * reach, y: q.y - q.ny * reach))
            tick.addLine(to: CGPoint(x: q.x + q.nx * reach, y: q.y + q.ny * reach))
            context.stroke(tick, with: .color(tickColor), style: StrokeStyle(lineWidth: max(1.5, 0.92 * line), lineCap: .round))
            let knob = max(2.2, Self.knob * r)
            context.fill(Path(ellipseIn: CGRect(x: q.x - knob, y: q.y - knob, width: 2 * knob, height: 2 * knob)), with: .color(tickColor))
        }
        .aspectRatio(Self.aspectRatio, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

// MARK: - Ring dial

/// Concentric rings, the longest cycle outermost (the Rings screen, docs/design/20-rings.md): a faint track with a
/// tick per child cycle, the cycle's progress swept clockwise from 12 o'clock in the level's colour, a knob at its
/// head. `inner` is the radius left free in the middle, as a fraction of the dial's.
struct RingDial: View {
    var rings: [RingsSnapshot.Ring]
    var inner: CGFloat = 0.42
    var showsTicks = true

    var body: some View {
        Canvas { context, size in
            let outer = min(size.width, size.height) / 2
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let n = CGFloat(max(rings.count, 1))
            let pitch = outer * (1 - inner) / n
            let width = max(1.5, pitch * 0.5)
            for (i, ring) in rings.enumerated() {
                let r = outer - pitch * (CGFloat(i) + 0.5)
                let color = Theme.levelColor(ring.level)
                var track = Path()
                track.addArc(center: center, radius: r, startAngle: .zero, endAngle: .degrees(360), clockwise: false)
                context.stroke(track, with: .color(color.opacity(0.16)), lineWidth: width)
                if showsTicks && ring.factor > 1 {
                    // one tick per child cycle, across the track
                    var ticks = Path()
                    for k in 0..<ring.factor {
                        let a = Double(k) / Double(ring.factor) * 2 * .pi - .pi / 2
                        let d = CGPoint(x: cos(a), y: sin(a))
                        ticks.move(to: CGPoint(x: center.x + d.x * (r - width / 2), y: center.y + d.y * (r - width / 2)))
                        ticks.addLine(to: CGPoint(x: center.x + d.x * (r + width / 2), y: center.y + d.y * (r + width / 2)))
                    }
                    context.stroke(ticks, with: .color(Theme.background.opacity(0.9)), lineWidth: max(0.75, width * 0.18))
                }
                let end = Angle.degrees(-90 + 360 * ring.phase)
                var arc = Path()
                arc.addArc(center: center, radius: r, startAngle: .degrees(-90), endAngle: end, clockwise: false)
                context.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .butt))
                let head = CGPoint(x: center.x + r * cos(end.radians), y: center.y + r * sin(end.radians))
                let knob = width * 0.78
                context.fill(Path(ellipseIn: CGRect(x: head.x - knob, y: head.y - knob, width: 2 * knob, height: 2 * knob)), with: .color(color))
                context.fill(Path(ellipseIn: CGRect(x: head.x - knob * 0.42, y: head.y - knob * 0.42, width: knob * 0.84, height: knob * 0.84)), with: .color(Theme.background))
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }
}

// MARK: - Small parts

/// A level's letter in its colour on a tinted capsule: "η", "δ".
struct LevelChip: View {
    var level: Int
    var size: CGFloat = 13

    var body: some View {
        Text(Fractonica.periodName(level).text)
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(Theme.levelColor(level))
            .frame(minWidth: size * 1.6, minHeight: size * 1.5)
            .background(Theme.levelColor(level, opacity: 0.16), in: .capsule)
            .accessibilityLabel(WidgetWords.levelWord(level))
    }
}

/// The phase pair (two 2-stroke glyphs, 256 states) from odometer digits.
struct PairGlyphs: View {
    var digits: [Int]
    var color: Color = Theme.teal
    /// Ink width in points; nil is the design's 0.3 units (pixel-snapped). Small pairs on the Lock Screen need more.
    var lineWidth: CGFloat? = nil

    var body: some View {
        OdometerView(digits: digits, strokes: 2, color: color, spacing: PairView.gap, lineWidth: lineWidth)
            .accessibilityLabel(Text("phase \(digits.first ?? 0) and \(digits.last ?? 0) of 256"))
    }
}

/// A live bar from `range.lowerBound` to `range.upperBound`, advanced by the system between timeline entries.
struct LiveBar: View {
    var range: ClosedRange<Double>
    var color: Color
    var thickness: CGFloat = 3

    var body: some View {
        let start = Date(timeIntervalSince1970: range.lowerBound)
        let end = Date(timeIntervalSince1970: max(range.upperBound, range.lowerBound + 0.001))
        #if WIDGET_RENDER
        // the Mac render harness (Widgets/Checks/Render): ImageRenderer cannot draw a timer progress view
        let f = min(1, max(0, RenderClock.now.timeIntervalSince(start) / end.timeIntervalSince(start)))
        Capsule().fill(color.opacity(0.22))
            .overlay(alignment: .leading) { GeometryReader { g in Capsule().fill(color).frame(width: g.size.width * f) } }
            .frame(height: thickness)
        #else
        ProgressView(timerInterval: start...end, countsDown: false) {
            EmptyView()
        } currentValueLabel: {
            EmptyView()
        }
        .progressViewStyle(.linear)
        .tint(color)
        .labelsHidden()
        .frame(height: thickness)
        .clipShape(.capsule)
        .accessibilityHidden(true)
        #endif
    }
}

/// A countdown the system runs by itself: "56:12", "1:05:12".
struct LiveCountdown: View {
    var end: Double
    var size: CGFloat
    var weight: Font.Weight = .semibold
    var color: Color = Theme.ink

    var body: some View {
        #if WIDGET_RENDER
        // the render harness draws what the timer reads at the rendered instant
        let left = max(0, Int(end - RenderClock.now.timeIntervalSince1970))
        let mm = String(format: "%02d", left / 60 % 60), ss = String(format: "%02d", left % 60)
        Text(left >= 3600 ? "\(left / 3600):\(mm):\(ss)" : "\(left / 60):\(ss)")
            .font(.reading(size, weight: weight))
            .foregroundStyle(color)
            .lineLimit(1)
        #else
        let now = Date.now
        Text(timerInterval: now...max(now, Date(timeIntervalSince1970: end)), countsDown: true)
            .font(.reading(size, weight: weight))
            .foregroundStyle(color)
            .lineLimit(1)
        #endif
    }
}

/// A tap target inside a medium or large widget.
struct WidgetLink<Content: View>: View {
    var link: AppLink
    @ViewBuilder var content: Content

    var body: some View {
        #if WIDGET_RENDER
        content // ImageRenderer cannot draw a Link
        #else
        Link(destination: link.url) { content }
        #endif
    }
}

#if WIDGET_RENDER
/// The instant the render harness draws live parts at (the widgets themselves always count from the real now).
enum RenderClock {
    nonisolated(unsafe) static var now = Date.now
}
#endif

/// What every widget shows outside the catalogue (1613 … 2857): it never extrapolates.
struct OutOfRangeView: View {
    var compact = false

    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "circle.dashed")
                .font(.system(size: compact ? 16 : 22, weight: .light))
                .foregroundStyle(Theme.ink3)
            Text("outside the catalogue")
                .font(.system(size: compact ? 11 : 13))
                .foregroundStyle(Theme.ink2)
                .multilineTextAlignment(.center)
            if !compact {
                Text(Notation.standard.catalogueText())
                    .font(.code(11))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

extension View {
    /// The widgets' background: the app's backdrop, which StandBy and the tinted Home Screen may remove.
    func fractonicaBackground() -> some View {
        containerBackground(for: .widget) { Backdrop() }
    }
}
