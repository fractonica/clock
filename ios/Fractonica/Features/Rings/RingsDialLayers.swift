import FractonicaKit
import SwiftUI

// The dial in three stacked canvases (src/ui/rings/dial.js), so a frame repaints only what moved:
//
//   base     tracks, running sectors, sector ticks, quarter notches, funnels, the glow of blurred rings
//            (redrawn when the selection, the range, a running sector or a layer toggle changes)
//   live     progress arcs, quarter beads, hands and the pointer highlight (every frame while the clock runs)
//   labels   ring names along the arcs and the quarter names of the selected ring (when a label changes)
//
// The base and label layers are Equatable views: SwiftUI skips them, and their canvases keep their pixels, while
// their inputs stay the same.

// MARK: - Inputs

/// One ring as the static layers see it.
struct DialRing: Equatable, Sendable {
    let level: Int
    let factor: Int
    let blur: Bool
    /// The running child sector; nil outside the catalogue or while blurred.
    let sector: Int?
    /// "3/5"; nil outside the catalogue or while blurred.
    let counter: String?
}

/// How strongly each ring is selected, 0 … 1 (animated when the selection moves).
struct DialEmphasis: Equatable, Sendable {
    var selected: Int
    var previous: Int?
    /// 0 when the selection has just moved from `previous`, 1 when it has arrived.
    var progress: Double = 1

    func of(_ level: Int) -> Double {
        let p = progress * progress * (3 - 2 * progress)
        if level == selected { return previous == nil ? 1 : p }
        if level == previous { return 1 - p }
        return 0
    }
}

struct DialBaseInput: Equatable, Sendable {
    let layout: RingLayout
    let rings: [DialRing]
    let emphasis: DialEmphasis
    let inRange: Bool
    let layers: RingsLayers
}

struct DialLiveRing: Equatable, Sendable {
    let level: Int
    /// The phase the hand shows (held still under Reduce Motion); nil when there is no hand.
    let phase: Double?
}

/// A ring (or one of its sectors) the pointer or a finger is on.
struct DialHighlight: Equatable, Sendable {
    let ring: Int
    let sector: Int?
}

struct DialLiveInput: Equatable, Sendable {
    let layout: RingLayout
    let rings: [DialLiveRing]
    let factors: [Int]
    let emphasis: DialEmphasis
    let inRange: Bool
    let quarters: Bool
    let highlight: DialHighlight?
    /// The ring a drag is winding.
    let scrubbing: Int?
}

struct DialLabelInput: Equatable, Sendable {
    let layout: RingLayout
    let rings: [DialRing]
    let emphasis: DialEmphasis
    let inRange: Bool
    let quarters: Bool
}

// MARK: - Palette

/// The colours of a level (the `pal` of dial.js).
private struct LevelPalette {
    let level: Int

    func c(_ opacity: Double, _ lightness: Double = 0.64) -> Color {
        Theme.levelColor(level, opacity: opacity, lightness: lightness)
    }

    func mix(_ a: Double, _ b: Double, _ k: Double) -> Double { a + (b - a) * k }
}

private let grey = Theme.ink3

private func angle(_ phase: Double) -> Angle { .radians(phase * RingsMath.tau - .pi / 2) }

private extension Path {
    /// An arc around `c` from dial phase `p0` to `p1`, clockwise on screen when p1 > p0.
    mutating func arc(_ c: CGPoint, _ r: CGFloat, from p0: Double, to p1: Double) {
        addArc(center: c, radius: r, startAngle: angle(p0), endAngle: angle(p1), clockwise: p1 < p0)
    }

    static func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    }

    static func annulus(_ c: CGPoint, outer: CGFloat, inner: CGFloat) -> Path {
        var p = Path.circle(c, outer)
        p.addPath(.circle(c, max(0, inner)))
        return p
    }

    static func wedge(_ c: CGPoint, outer: CGFloat, inner: CGFloat, from p0: Double, to p1: Double) -> Path {
        var p = Path()
        p.arc(c, outer, from: p0, to: p1)
        p.arc(c, inner, from: p1, to: p0)
        p.closeSubpath()
        return p
    }

    mutating func radial(_ layout: RingLayout, from r0: CGFloat, to r1: CGFloat, phase: Double) {
        move(to: layout.point(radius: r0, phase: phase))
        addLine(to: layout.point(radius: r1, phase: phase))
    }
}

// MARK: - Base layer

struct DialBaseLayer: View, Equatable {
    let input: DialBaseInput

    var body: some View {
        Canvas { context, _ in
            Self.draw(&context, input)
        }
        .accessibilityHidden(true)
    }

    static func draw(_ g: inout GraphicsContext, _ s: DialBaseInput) {
        let lay = s.layout
        let c = lay.center
        let n = s.rings.count

        // the hole: a faint stage for the read-out
        g.fill(.circle(c, lay.rHole - 1), with: .radialGradient(
            Gradient(colors: [Theme.ink.opacity(0.035), Theme.ink.opacity(0.01)]),
            center: c, startRadius: lay.rHole * 0.2, endRadius: lay.rHole))

        // funnels sit in the lanes between rings
        if s.inRange && s.layers.funnels {
            for i in 0..<max(0, n - 1) {
                let ring = s.rings[i]
                guard !ring.blur, let sector = ring.sector else { continue }
                let a = lay.track(i)
                let b = lay.track(i + 1)
                let f = Double(ring.factor)
                let p0 = Double(sector) / f
                let p1 = Double(sector + 1) / f
                let curves = RingsMath.funnel(from: a.inner, to: b.outer, p0: p0, p1: p1, steps: 28)
                var path = Path()
                path.move(to: lay.point(radius: a.inner, phase: p0))
                path.arc(c, a.inner, from: p0, to: p1)
                for q in curves.right { path.addLine(to: lay.point(radius: q.r, phase: q.phase)) }
                path.arc(c, b.outer, from: 1, to: 0)
                for q in curves.left.reversed() { path.addLine(to: lay.point(radius: q.r, phase: q.phase)) }
                path.closeSubpath()
                let e = s.emphasis.of(ring.level)
                let next = LevelPalette(level: s.rings[i + 1].level)
                g.fill(path, with: .linearGradient(
                    Gradient(colors: [next.c(0.06 + 0.1 * e), next.c(0.03 + 0.05 * e)]),
                    startPoint: lay.point(radius: a.inner, phase: (p0 + p1) / 2), endPoint: c))
            }
        }

        for (i, ring) in s.rings.enumerated() {
            let p = LevelPalette(level: ring.level)
            let e = s.inRange ? s.emphasis.of(ring.level) : 0
            let (mid, ro, ri) = lay.track(i)

            // track, its edges and its centre line
            g.fill(.annulus(c, outer: ro, inner: ri), with: .color(s.inRange ? p.c(p.mix(0.05, 0.12, e)) : grey.opacity(0.06)), style: FillStyle(eoFill: true))
            var edges = Path.circle(c, ro)
            edges.addPath(.circle(c, ri))
            g.stroke(edges, with: .color(s.inRange ? p.c(p.mix(0.15, 0.72, e)) : grey.opacity(0.18)), lineWidth: 0.75)
            g.stroke(.circle(c, mid), with: .color(s.inRange ? p.c(0.12) : grey.opacity(0.1)), lineWidth: max(1, lay.thick * 0.3))
            guard s.inRange else { continue }

            if ring.blur {
                // far too fast for a hand: a steady glow instead of a strobing line
                g.fill(.annulus(c, outer: ro, inner: ri), with: .color(p.c(0.22)), style: FillStyle(eoFill: true))
            } else if s.layers.sectors, let sector = ring.sector {
                let f = Double(ring.factor)
                g.fill(.wedge(c, outer: ro, inner: ri, from: Double(sector) / f, to: Double(sector + 1) / f), with: .color(p.c(p.mix(0.13, 0.28, e))))
                var ticks = Path()
                for k in 0..<ring.factor { ticks.radial(lay, from: ri, to: ro, phase: Double(k) / f) }
                g.stroke(ticks, with: .color(p.c(p.mix(0.24, 0.6, e))), lineWidth: 0.75)
            }
            if s.layers.quarters {
                var notches = Path()
                notches.radial(lay, from: ri - lay.band * 0.18, to: ro + lay.band * 0.18, phase: 0)
                for q in [0.25, 0.5, 0.75] { notches.radial(lay, from: ri - lay.band * 0.1, to: ro + lay.band * 0.1, phase: q) }
                g.stroke(notches, with: .color(e > 0.5 ? p.c(0.6) : p.c(0.18)), lineWidth: 1.1 + 0.5 * e)
            }
        }
    }

    nonisolated static func == (a: DialBaseLayer, b: DialBaseLayer) -> Bool { a.input == b.input }
}

// MARK: - Live layer

struct DialLiveLayer: View {
    let input: DialLiveInput

    var body: some View {
        Canvas { context, _ in
            Self.draw(&context, input)
        }
        .accessibilityHidden(true)
    }

    static func draw(_ g: inout GraphicsContext, _ s: DialLiveInput) {
        let lay = s.layout
        let c = lay.center
        guard s.inRange else { return }

        for (i, ring) in s.rings.enumerated() {
            guard let ph = ring.phase else { continue }
            let p = LevelPalette(level: ring.level)
            let e = s.emphasis.of(ring.level)
            let mid = lay.track(i).mid
            let width = lay.thick * (0.46 + 0.24 * e)

            if ph > 0.0004 {
                var arc = Path()
                arc.arc(c, mid, from: 0, to: ph)
                if e > 0 {
                    g.stroke(arc, with: .color(p.c(0.13 * e)), style: StrokeStyle(lineWidth: lay.thick * 1.05, lineCap: .butt))
                }
                let gradient = Gradient(stops: [
                    .init(color: p.c(0.24), location: 0),
                    .init(color: p.c(0.5), location: ph * 0.55),
                    .init(color: p.c(0.96, 0.68), location: ph),
                ])
                g.stroke(arc, with: .conicGradient(gradient, center: c, angle: .degrees(-90)), style: StrokeStyle(lineWidth: width, lineCap: .butt))
            }

            // quarter beads: filled once passed, hollow while ahead
            if s.quarters {
                let br = max(1.5, lay.thick * (0.16 + 0.04 * e))
                var passed = Path()
                var ahead = Path()
                for q in [0.25, 0.5, 0.75] {
                    let pt = lay.point(radius: mid, phase: q)
                    let dot = Path.circle(pt, br)
                    if ph >= q { passed.addPath(dot) } else { ahead.addPath(dot) }
                }
                g.fill(passed, with: .color(p.c(0.96, 0.68)))
                g.fill(ahead, with: .color(Theme.background.opacity(0.9)))
                g.stroke(ahead, with: .color(p.c(0.85, 0.7)), lineWidth: 1)
            }

            // the hand: a knob at the head of the arc, with a halo on the selected ring
            let head = lay.point(radius: mid, phase: ph)
            let kr = max(2.6, lay.thick * (0.46 + 0.16 * e))
            if e > 0 {
                g.fill(.circle(head, kr * 3.2), with: .radialGradient(
                    Gradient(colors: [p.c(0.42 * e), p.c(0)]), center: head, startRadius: kr * 0.4, endRadius: kr * 3.2))
            }
            if s.scrubbing == i {
                g.stroke(.circle(head, kr + 4), with: .color(Theme.cursor.opacity(0.9)), lineWidth: 1.5)
            }
            let knob = Path.circle(head, kr)
            g.fill(knob, with: .color(p.c(1, 0.8)))
            g.stroke(knob, with: .color(Theme.background.opacity(0.9)), lineWidth: 1.5)
        }

        // the pointer's ring or sector
        if let h = s.highlight, h.ring < s.rings.count {
            let (_, ro, ri) = lay.track(h.ring)
            let p = LevelPalette(level: s.rings[h.ring].level)
            if let sector = h.sector, h.ring < s.factors.count {
                let f = Double(s.factors[h.ring])
                let wedge = Path.wedge(c, outer: ro + 1, inner: ri - 1, from: Double(sector) / f, to: Double(sector + 1) / f)
                g.fill(wedge, with: .color(Theme.ink.opacity(0.12)))
                g.stroke(wedge, with: .color(p.c(0.72)), lineWidth: 1.4)
            } else {
                g.fill(.annulus(c, outer: ro + 1, inner: ri - 1), with: .color(Theme.ink.opacity(0.07)), style: FillStyle(eoFill: true))
            }
        }
    }
}

// MARK: - Label layer

struct DialLabelLayer: View, Equatable {
    let input: DialLabelInput

    var body: some View {
        Canvas { context, _ in
            Self.draw(&context, input)
        }
        .accessibilityHidden(true)
    }

    /// Ring labels are drawn on every ring when there is room (a band of 11 points or more), else on the selected one.
    static func showsAll(_ layout: RingLayout) -> Bool { layout.band >= 11 }

    static func draw(_ g: inout GraphicsContext, _ s: DialLabelInput) {
        let lay = s.layout
        let fs = min(11.5, max(8.5, lay.band * 0.62))
        let all = showsAll(lay)
        g.drawLayer { layer in
            layer.addFilter(.shadow(color: Theme.background.opacity(0.95), radius: 1.4))
            for (i, ring) in s.rings.enumerated() {
                let e = s.inRange ? s.emphasis.of(ring.level) : 0
                guard all || e > 0.5 else { continue }
                let p = LevelPalette(level: ring.level)
                let name = Fractonica.periodName(ring.level).text
                var segments: [(String, Font, Color)] = [
                    (name, .system(size: fs, weight: .semibold), s.inRange ? p.c(1, 0.76) : grey.opacity(0.9)),
                    (" \(ring.level + 1)", .system(size: fs - 0.5, weight: .medium, design: .monospaced), s.inRange ? p.c(0.85, 0.7) : grey.opacity(0.8)),
                ]
                if s.inRange, let counter = ring.counter {
                    segments.append(("  \(counter)", .system(size: fs - 0.5, weight: .medium, design: .monospaced), Theme.ink.opacity(0.62)))
                }
                // the text ends clear of the hand's knob, which sits at 12 o'clock whenever a cycle turns over
                let kr = max(2.6, lay.thick * (0.46 + 0.16 * e))
                arcText(&layer, segments, center: lay.center, radius: lay.track(i).mid, gap: kr + 3)
            }
            // quarter names on the selected ring (a small dial keeps only its beads: the pills would cover the rings,
            // and the wave beside it names the quarters)
            if s.quarters && s.inRange && lay.size >= 240, let i = s.rings.firstIndex(where: { $0.level == s.emphasis.selected }) {
                let p = LevelPalette(level: s.emphasis.selected)
                let mid = lay.track(i).mid
                let qf = min(11, max(8, lay.thick * 0.75))
                for (q, name) in ["begin", "peak", "node", "valley"].enumerated() {
                    let pt = lay.point(radius: mid, phase: Double(q) * 0.25)
                    pill(&layer, name, at: pt, size: qf, palette: p, leading: q == 0, bounds: lay.size)
                }
            }
        }
    }

    /// Text set along a circle, ending `gap` points before 12 o'clock.
    private static func arcText(_ g: inout GraphicsContext, _ segments: [(String, Font, Color)], center: CGPoint, radius r: CGFloat, gap: CGFloat) {
        guard r > 4 else { return }
        var glyphs: [(GraphicsContext.ResolvedText, CGFloat)] = []
        var total: CGFloat = 0
        for (text, font, color) in segments {
            for ch in text {
                let resolved = g.resolve(Text(String(ch)).font(font).foregroundStyle(color))
                let w = ch == " " ? resolved.measure(in: CGSize(width: 100, height: 100)).width * 0.9 : resolved.measure(in: CGSize(width: 100, height: 100)).width
                glyphs.append((resolved, w))
                total += w
            }
        }
        var a = -(total + gap) / r
        for (resolved, w) in glyphs {
            let mid = a + w / (2 * r)
            var cg = g
            cg.translateBy(x: center.x, y: center.y)
            cg.rotate(by: .radians(Double(mid)))
            cg.draw(resolved, at: CGPoint(x: 0, y: -r), anchor: .center)
            a += w / r
        }
    }

    /// A quarter name in a capsule, kept inside the dial's square (the outermost ring's 3 and 9 o'clock pills would
    /// otherwise hang over its edge).
    private static func pill(_ g: inout GraphicsContext, _ text: String, at pt: CGPoint, size: CGFloat, palette p: LevelPalette, leading: Bool, bounds: CGFloat) {
        let resolved = g.resolve(Text(text).font(.system(size: size, weight: .semibold)).foregroundStyle(p.c(1, 0.76)))
        let ts = resolved.measure(in: CGSize(width: 200, height: 50))
        let w = ts.width + 10
        let h = size + 6
        let x = min(max(leading ? pt.x + 6 : pt.x - w / 2, 1), bounds - w - 1)
        let y = min(max(pt.y - h / 2, 1), bounds - h - 1)
        let rect = CGRect(x: x, y: y, width: w, height: h)
        let shape = Path(roundedRect: rect, cornerRadius: h / 2)
        g.fill(shape, with: .color(Theme.background.opacity(0.92)))
        g.stroke(shape, with: .color(p.c(0.72)), lineWidth: 0.75)
        g.draw(resolved, at: CGPoint(x: rect.midX, y: rect.midY), anchor: .center)
    }

    nonisolated static func == (a: DialLabelLayer, b: DialLabelLayer) -> Bool { a.input == b.input }
}
