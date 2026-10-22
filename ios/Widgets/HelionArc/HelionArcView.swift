import FractonicaKit
import SwiftUI
import WidgetKit

/// The Helion Arc in a widget: the running Helion as two half-arcs (the journal face's cycle), bright up to the
/// running Preon, which rides it as one wave in the Wave screen's manner with the dot on it; "34η" on the first
/// half-arc's open side, "29ι" on the second's. On the Lock Screen (and wherever the system tints the widget) the
/// drawing is one ink in two strengths; in full colour the Helion and the Preon take their levels' colours.
struct HelionArcView: View {
    enum Size: Sendable { case rectangular, small, medium }

    var snapshot: HelionArcSnapshot?
    var size: Size

    var body: some View {
        if let s = snapshot {
            GeometryReader { geo in
                let g = HelionArcGeometry(width: geo.size.width, height: geo.size.height, inset: inset)
                ZStack(alignment: .topLeading) {
                    HelionArcDrawing(geometry: g, preon: s.preon, phase: s.phase)
                    ArcLabel(token: s.helionToken, rect: g.labelRect(first: true, reach: g.cy), first: true)
                    ArcLabel(token: s.preonToken, rect: g.labelRect(first: false, reach: g.cy), first: false)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Helion Arc: \(s.accessibility)")
        } else if size == .rectangular {
            Text("outside the catalogue").font(.caption)
        } else {
            OutOfRangeView(compact: size == .small)
        }
    }

    /// Room kept around the drawing for the dot's glow and round line ends.
    private var inset: Double { size == .rectangular ? 2 : 4 }
}

/// A count on the open side of its half-arc: the number in ink, the letter in its level's colour (in one ink, the
/// letter a step quieter). The first sits low in its space, by the axis; the second high, the drawing turned half a
/// turn.
private struct ArcLabel: View {
    var token: CountToken
    var rect: CGRect
    var first: Bool
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let size = min(rect.height * 0.86, rect.width / 1.95)
        let full = mode == .fullColor
        let number = Text(verbatim: token.number).foregroundStyle(full ? Theme.ink : .white)
        let letter = Text(verbatim: token.suffix).foregroundStyle(full ? Theme.levelColor(token.level) : .white.opacity(0.62))
        Text("\(number)\(letter)")
            .font(.reading(size, weight: .semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(width: rect.width, height: rect.height, alignment: first ? .bottom : .top)
            .offset(x: rect.minX, y: rect.minY)
    }
}

/// The drawing: the Helion's double arc in two strengths with a faint axis, the running Preon's wave on it and the
/// dot. Two layers, so the wave and the dot can take the accent on a tinted Home Screen.
struct HelionArcDrawing: View {
    var geometry: HelionArcGeometry
    var preon: Int
    var phase: Double
    @Environment(\.widgetRenderingMode) private var mode

    var body: some View {
        let style = Style(r: geometry.r, full: mode == .fullColor)
        ZStack {
            Canvas { context, _ in helion(&context, style) }
            Canvas { context, _ in wave(&context, style) }
                .widgetAccentable()
        }
        .accessibilityHidden(true)
    }

    /// Line weights in the journal face's units (its radius is 38) and the two inks.
    struct Style {
        let line: Double
        let dot: Double
        let full: Bool
        let helion: Color
        let preon: Color
        /// The Preon's travelled wave: a step lighter than the Helion's line it continues.
        let preonBright: Color

        init(r: Double, full: Bool) {
            let u = r / 38
            line = max(2.1, 2.6 * u)
            dot = max(2.4, 3.4 * u)
            self.full = full
            helion = full ? Theme.levelColor(6) : .white
            preon = full ? Theme.levelColor(8) : .white
            preonBright = full ? Theme.levelColor(8, lightness: 0.74) : .white
        }
    }

    private func path(_ points: [CGPoint]) -> Path {
        var p = Path()
        p.addLines(points)
        return p
    }

    private func stroke(_ context: inout GraphicsContext, _ path: Path, _ color: Color, _ width: Double) {
        context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
    }

    private func circle(_ p: CGPoint, _ radius: Double) -> Path {
        Path(ellipseIn: CGRect(x: p.x - radius, y: p.y - radius, width: 2 * radius, height: 2 * radius))
    }

    /// Clears a ring around the dot, so it stands apart from any line under it (a gap, not dark paint, so it stays a
    /// gap when the system tints the widget).
    private func clearDot(_ context: inout GraphicsContext, _ s: Style) {
        var cut = context
        cut.blendMode = .destinationOut
        cut.fill(circle(geometry.wave(preon: preon, phase: phase), s.dot + max(1.3, 0.45 * s.dot)), with: .color(.black))
    }

    /// The Helion: bright up to the Preon's wave, faint under it (the wave's own axis), dim after it. The wave's stretch
    /// holds the moment's true place, so outside it the arc is bright exactly up to the Helion's progress.
    private func helion(_ context: inout GraphicsContext, _ s: Style) {
        let g = geometry
        let w = HelionArcGeometry.window(preon: preon)
        let bright = HelionArcGeometry.brightEnd(preon: preon)
        var axis = Path()
        axis.move(to: CGPoint(x: g.cx - (2 + HelionArcGeometry.amplitude) * g.r, y: g.cy))
        axis.addLine(to: CGPoint(x: g.cx + (2 + HelionArcGeometry.amplitude) * g.r, y: g.cy))
        context.stroke(axis, with: .color(s.helion.opacity(s.full ? 0.16 : 0.22)), lineWidth: 1)
        stroke(&context, path(g.arc(from: w.upperBound, to: 1)), s.helion.opacity(s.full ? 0.34 : 0.38), s.line * 0.8)
        stroke(&context, path(g.arc(from: w.lowerBound, to: w.upperBound)), s.helion.opacity(s.full ? 0.18 : 0.25), s.line * 0.6)
        if bright > 0 {
            let done = path(g.arc(from: 0, to: bright))
            if s.full {
                // the Wave screen's travelled arc: a soft glow under the line
                stroke(&context, done, s.helion.opacity(0.12), s.line * 3.2)
                stroke(&context, done, s.helion.opacity(0.22), s.line * 1.9)
            }
            stroke(&context, done, s.helion, s.line)
        }
        clearDot(&context, s)
    }

    /// The running Preon: its wave bright up to the dot and dim after it, and the dot (the Wave screen's marker).
    private func wave(_ context: inout GraphicsContext, _ s: Style) {
        let g = geometry
        stroke(&context, path(g.wave(preon: preon, from: phase, to: 1)), s.preon.opacity(0.44), s.line * 0.8)
        stroke(&context, path(g.wave(preon: preon, from: 0, to: phase)), s.preonBright, s.line)
        let p = g.wave(preon: preon, phase: phase)
        if s.full {
            let glow = s.dot * 3.4
            context.fill(circle(p, glow), with: .radialGradient(
                Gradient(colors: [Theme.levelColor(8, opacity: 0.55, lightness: 0.7), Theme.levelColor(8, opacity: 0, lightness: 0.7)]),
                center: p, startRadius: 0, endRadius: glow))
        }
        clearDot(&context, s)
        if s.full {
            context.fill(circle(p, s.dot), with: .color(Theme.levelColor(8, lightness: 0.72)))
            context.fill(circle(p, s.dot * 0.36), with: .color(.white))
        } else {
            context.fill(circle(p, s.dot), with: .color(s.preon))
        }
    }
}
