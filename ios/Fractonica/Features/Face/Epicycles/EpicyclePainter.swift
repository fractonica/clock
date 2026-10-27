import FractonicaKit
import SwiftUI

/// Where the dial sits in a canvas: dial units (its radius 1) and figure units (the arms' reach 1) to canvas points, and
/// line widths that grow a little slower than the dial, so a large face keeps fine lines.
struct EpicycleCanvas {
    let center: CGPoint
    let radius: CGFloat

    init(size: CGSize) {
        center = CGPoint(x: size.width / 2, y: size.height / 2)
        radius = min(size.width, size.height) / 2
    }

    /// One point of line on an iPhone's dial (radius ≈ 187).
    var unit: CGFloat { pow(max(radius, 40) / 187, 0.75) }

    /// Points to the figure's reach.
    var scale: CGFloat { radius * EpicycleDial.reach }

    func dial(_ u: CGPoint) -> CGPoint { CGPoint(x: center.x + u.x * radius, y: center.y + u.y * radius) }

    func dial(turns: Double, radius r: Double) -> CGPoint { dial(epicyclePoint(turns: turns, radius: r)) }

    func figure(_ u: CGPoint) -> CGPoint { CGPoint(x: center.x + u.x * scale, y: center.y + u.y * scale) }

    /// The square around the circle of radius r (in dial radii).
    func circle(_ r: Double) -> CGRect {
        CGRect(x: center.x - r * radius, y: center.y - r * radius, width: 2 * r * radius, height: 2 * r * radius)
    }

    /// A disc of `points` radius around p.
    func disc(_ p: CGPoint, _ points: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: p.x - points, y: p.y - points, width: 2 * points, height: 2 * points))
    }

    /// A line from `first` through figure points and on to `last` (figure units).
    func line(from first: CGPoint? = nil, _ points: ArraySlice<CGPoint>, then last: CGPoint? = nil) -> Path {
        var path = Path()
        var all = first.map { [figure($0)] } ?? []
        all.reserveCapacity(points.count + 2)
        for p in points { all.append(figure(p)) }
        if let last { all.append(figure(last)) }
        guard all.count > 1 else { return path }
        path.addLines(all)
        return path
    }
}

/// The traced prefix: the figure as drawn from the base cycle's start to the step before the pen (redrawn once a
/// step, `EpicycleCadence.traceSteps`).
struct EpicycleTrace: Equatable {
    var figure: EpicycleFigure
    var detail: Int
    var cycle: Int64
    var cut: Double
    var endPhase: Double
    var tips: Bool
    /// The running Pentad's stretch of the cycle (bases of a ζ or longer).
    var stretch: ClosedRange<Double>?
}

/// The moving parts: the arms, the pen, and the paths from the trace's step on to them.
struct EpicycleMotion: Equatable {
    var figure: EpicycleFigure
    var detail: Int
    var phase: Double
    /// Where the traced prefix ends: the tails start there.
    var from: Double
    var tips: Bool
    /// The first arm turning faster than the eye follows (drawn as its blur, with what it carries).
    var blurred: Int?
}

/// The epicycle face's drawing, layer by layer (EpicycleFace puts them together): the plate and the base's scale, the
/// whole figure in ghost, the Pentads on the scale, the traced prefix, and what moves.
enum EpicyclePainter {
    // MARK: - The plate

    /// The plate, its turned bezel (the star face's), the cycle's start inlaid at the top, the base cycle's scale and
    /// its quarters.
    static func plate(_ ctx: inout GraphicsContext, _ c: EpicycleCanvas, scale s: EpicycleScale) {
        let u = c.unit
        // the plate lifts off the background: a soft shadow under it (a gradient, not a filter, which would be
        // rasterized again every time the arms move)
        let shadow = CGPoint(x: c.center.x, y: c.center.y + c.radius * 0.012)
        let reach = EpicycleDial.plate + 0.07
        ctx.fill(c.disc(shadow, c.radius * reach),
                 with: .radialGradient(Gradient(stops: [.init(color: .black.opacity(0.7), location: EpicycleDial.plate / reach - 0.04),
                                                        .init(color: .black.opacity(0), location: 1)]),
                                       center: shadow, startRadius: 0, endRadius: c.radius * reach))
        ctx.fill(Path(ellipseIn: c.circle(EpicycleDial.plate)), with: .color(Theme.Epicycles.plateEdge))
        ctx.fill(Path(ellipseIn: c.circle(EpicycleDial.bezel)),
                 with: .radialGradient(Gradient(colors: [Theme.Epicycles.plateCentre, Theme.Epicycles.plateEdge]),
                                       center: c.dial(CGPoint(x: 0, y: -0.18)), startRadius: 0, endRadius: c.radius * 1.05))
        var ring = Path(ellipseIn: c.circle(EpicycleDial.plate))
        ring.addEllipse(in: c.circle(EpicycleDial.bezel))
        let metal = Gradient(colors: [Theme.Epicycles.bezelMid, Theme.Epicycles.bezelLight, Theme.Epicycles.bezelMid,
                                      Theme.Epicycles.bezelDark, Theme.Epicycles.bezelMid, Theme.Epicycles.bezelLight,
                                      Theme.Epicycles.bezelMid, Theme.Epicycles.bezelDark, Theme.Epicycles.bezelMid])
        ctx.fill(ring, with: .conicGradient(metal, center: c.center, angle: .degrees(-100)), style: FillStyle(eoFill: true))
        for i in 1..<4 {
            let r = EpicycleDial.bezel + (EpicycleDial.plate - EpicycleDial.bezel) * Double(i) / 4
            ctx.stroke(Path(ellipseIn: c.circle(r)), with: .color(.black.opacity(0.22)), lineWidth: 0.5)
        }
        ctx.stroke(Path(ellipseIn: c.circle(EpicycleDial.plate)), with: .color(.black.opacity(0.5)), lineWidth: 0.75)
        ctx.stroke(Path(ellipseIn: c.circle(EpicycleDial.bezel)), with: .color(.black.opacity(0.75)), lineWidth: 1.2 * u)
        ctx.stroke(Path(ellipseIn: c.circle(EpicycleDial.bezel - 0.006)), with: .color(Theme.Epicycles.engraveLight), lineWidth: 0.5)

        // where every base cycle begins: a steel pip inlaid in the bezel at the top (the star's is gold: its sync)
        let mid = (EpicycleDial.plate + EpicycleDial.bezel) / 2
        let half = (EpicycleDial.plate - EpicycleDial.bezel) * 0.42
        var pip = Path()
        pip.move(to: c.dial(CGPoint(x: -half * 0.8, y: -mid - half)))
        pip.addLine(to: c.dial(CGPoint(x: half * 0.8, y: -mid - half)))
        pip.addLine(to: c.dial(CGPoint(x: 0, y: -mid + half)))
        pip.closeSubpath()
        ctx.fill(pip, with: .linearGradient(Gradient(colors: [Theme.ink, Theme.ink3]),
                                            startPoint: c.dial(CGPoint(x: 0, y: -mid - half)), endPoint: c.dial(CGPoint(x: 0, y: -mid + half))))
        ctx.stroke(pip, with: .color(.black.opacity(0.5)), lineWidth: 0.5)

        // the base cycle's scale: its children long, theirs short
        var minor = Path(), major = Path(), lip = Path()
        let per = max(1, s.minors / max(s.majors, 1))
        for i in 0..<s.minors {
            let turns = Double(i) / Double(s.minors)
            let isMajor = i % per == 0
            let a = c.dial(turns: turns, radius: isMajor ? EpicycleDial.tickMajor : EpicycleDial.tickMinor)
            let b = c.dial(turns: turns, radius: EpicycleDial.tickOuter)
            if isMajor {
                major.move(to: a)
                major.addLine(to: b)
            } else {
                minor.move(to: a)
                minor.addLine(to: b)
            }
            lip.move(to: CGPoint(x: a.x, y: a.y + 0.6))
            lip.addLine(to: CGPoint(x: b.x, y: b.y + 0.6))
        }
        ctx.stroke(lip, with: .color(Theme.Epicycles.engraveLight), lineWidth: 0.5)
        ctx.stroke(minor, with: .color(Theme.ink3.opacity(0.42)), lineWidth: 0.55 * u)
        ctx.stroke(major, with: .color(Theme.ink2.opacity(0.75)), style: StrokeStyle(lineWidth: 1.1 * u, lineCap: .round))
        ctx.stroke(Path(ellipseIn: c.circle(EpicycleDial.tickOuter + 0.01)), with: .color(Theme.line2.opacity(0.7)), lineWidth: 0.5)

        // the quarters: the base arm stands right at its peak, down at its node, left at its valley
        for q in 1...3 {
            let p = c.dial(turns: Double(q) / 4, radius: EpicycleDial.quarters)
            let d = 1.5 * u
            var diamond = Path()
            diamond.move(to: CGPoint(x: p.x, y: p.y - d))
            diamond.addLine(to: CGPoint(x: p.x + d, y: p.y))
            diamond.addLine(to: CGPoint(x: p.x, y: p.y + d))
            diamond.addLine(to: CGPoint(x: p.x - d, y: p.y))
            diamond.closeSubpath()
            ctx.fill(diamond, with: .color(Theme.ink3.opacity(0.7)))
        }
    }

    // MARK: - The whole figure

    /// The figure in ghost: the first arm's circle about the hub, the pen's whole closed path (as far as the catalogue
    /// goes), and the band of the arms too fine to draw.
    static func figure(_ ctx: inout GraphicsContext, _ c: EpicycleCanvas, figure f: EpicycleFigure, detail: Int, endPhase: Double) {
        let u = c.unit
        if let first = f.arms.first(where: \.on) {
            let r = first.length * c.scale
            ctx.stroke(c.disc(c.center, r), with: .color(Theme.Epicycles.arm(first.level, opacity: 0.16)), lineWidth: 0.6 * u)
        }
        let curve = f.curve(detail: detail)
        let ghost = c.line(curve.prefix(detail, upTo: endPhase), then: endPhase < 1 ? f.tip(detail, endPhase) : curve.tips[detail].last)
        let band = f.band(after: detail)
        if band > 0 { haze(&ctx, ghost, halfWidth: band * c.scale, opacity: 0.05) }
        ctx.stroke(ghost, with: .color(Theme.Epicycles.pen(opacity: 0.11)),
                   style: StrokeStyle(lineWidth: 0.7 * u, lineCap: .round, lineJoin: .round))
    }

    // MARK: - The Pentads on the scale

    /// For a base of a ζ or longer: where each Pentad begins on the base's scale, by its shape (the running one's
    /// filled), and the running Pentad's stretch as a gold arc outside the scale.
    static func pentads(_ ctx: inout GraphicsContext, _ c: EpicycleCanvas, _ p: EpicyclePentads) {
        let u = c.unit
        let r = EpicycleDial.tickOuter + 0.022
        var arc = Path()
        let steps = max(2, Int((p.to - p.from) * 360))
        for i in 0...steps {
            let q = c.dial(turns: p.from + (p.to - p.from) * Double(i) / Double(steps), radius: r)
            if i == 0 { arc.move(to: q) } else { arc.addLine(to: q) }
        }
        ctx.stroke(arc, with: .color(Theme.gold.opacity(p.pentad == 3 ? 0.85 : 0.6)),
                   style: StrokeStyle(lineWidth: (p.pentad == 3 ? 1.8 : 1.3) * u, lineCap: .round))

        let gap = 2 * Double.pi * EpicycleDial.pentads / Double(max(p.helions, 1))
        for s in p.starts {
            let side = c.radius * min(0.05, max(0.03, gap * 0.75)) * (s.pentad == 3 ? 1.06 : 1)
            let turns = p.phase(ofHelion: s.helion)
            let center = c.dial(turns: turns, radius: EpicycleDial.pentads)
            let rect = CGRect(x: center.x - side / 2, y: center.y - side / 2, width: side, height: side)
            let spin = CGAffineTransform(translationX: center.x, y: center.y).rotated(by: 2 * .pi * turns)
                .translatedBy(x: -center.x, y: -center.y)
            let shape = PentadPolygon(sides: s.pentad == 3 ? 4 : 5).path(in: rect).applying(spin)
            ctx.fill(shape.strokedPath(StrokeStyle(lineWidth: 2.4 * u)), with: .color(Theme.Epicycles.plateEdge))
            ctx.fill(shape, with: .color(Theme.Epicycles.plateEdge))
            if s.pentad == p.pentad && turns >= p.from - 1e-9 && turns < p.to {
                ctx.fill(shape, with: .color(Theme.gold))
            } else {
                ctx.stroke(shape, with: .color(Theme.gold.opacity(s.pentad == 3 ? 0.75 : 0.5)),
                           style: StrokeStyle(lineWidth: (s.pentad == 3 ? 1.0 : 0.8) * u, lineJoin: .round))
            }
        }
    }

    // MARK: - The traced prefix

    /// The figure drawn so far: the running Pentad's stretch glowing gold under the pen's path (ahead of it, a gold
    /// ghost), the tips' paths in their levels' colours, the band of the arms too fine to draw, the pen's path.
    static func trace(_ ctx: inout GraphicsContext, _ c: EpicycleCanvas, _ t: EpicycleTrace) {
        let u = c.unit
        let f = t.figure
        let curve = f.curve(detail: t.detail)
        let cut = min(t.cut, t.endPhase)

        if let stretch = t.stretch {
            let done = min(stretch.upperBound, cut)
            if done > stretch.lowerBound {
                let lit = c.line(from: f.tip(t.detail, stretch.lowerBound), curve.span(t.detail, from: stretch.lowerBound, to: done),
                                 then: f.tip(t.detail, done))
                for (k, o) in [(5.0, 0.1), (3.0, 0.16), (1.6, 0.3)] {
                    ctx.stroke(lit, with: .color(Theme.gold.opacity(o)), style: StrokeStyle(lineWidth: k * u, lineCap: .round, lineJoin: .round))
                }
            }
            let ahead = max(stretch.lowerBound, cut)
            let end = min(stretch.upperBound, t.endPhase)
            if end > ahead {
                let rest = c.line(from: f.tip(t.detail, ahead), curve.span(t.detail, from: ahead, to: end), then: f.tip(t.detail, end))
                ctx.stroke(rest, with: .color(Theme.gold.opacity(0.13)), style: StrokeStyle(lineWidth: 2 * u, lineCap: .round, lineJoin: .round))
            }
        }
        guard cut > 0 else { return }

        if t.tips {
            for i in f.arms.indices where i < t.detail && f.arms[i].on {
                let path = c.line(curve.prefix(i, upTo: cut), then: f.tip(i, cut))
                tipPath(&ctx, path, level: f.arms[i].level, unit: u)
            }
        }
        let path = c.line(curve.prefix(t.detail, upTo: cut), then: f.tip(t.detail, cut))
        let band = f.band(after: t.detail)
        if band > 0 { haze(&ctx, path, halfWidth: band * c.scale, opacity: 0.16) }
        penPath(&ctx, path, unit: u)
    }

    /// The pen's path: a fine steel line with a faint halo, so the coloured arms read over it.
    static func penPath(_ ctx: inout GraphicsContext, _ path: Path, unit u: CGFloat) {
        ctx.stroke(path, with: .color(Theme.Epicycles.pen(opacity: 0.05)),
                   style: StrokeStyle(lineWidth: 2.6 * u, lineCap: .round, lineJoin: .round))
        ctx.stroke(path, with: .color(Theme.Epicycles.pen(opacity: 0.66)),
                   style: StrokeStyle(lineWidth: 0.8 * u, lineCap: .round, lineJoin: .round))
    }

    /// The band the arms too fine to draw sweep along a path: a soft haze as wide as their reach, densest along the
    /// middle. Nested strokes, not a blur: a filter is rasterized again every time the arms above it move.
    static func haze(_ ctx: inout GraphicsContext, _ path: Path, halfWidth: CGFloat, opacity: Double) {
        for k in [1.0, 0.7, 0.4] {
            ctx.stroke(path, with: .color(Theme.Epicycles.pen(opacity: opacity / 3)),
                       style: StrokeStyle(lineWidth: 2 * halfWidth * k, lineCap: .round, lineJoin: .round))
        }
    }

    /// Another tip's path, fainter.
    static func tipPath(_ ctx: inout GraphicsContext, _ path: Path, level: Int, unit u: CGFloat) {
        ctx.stroke(path, with: .color(Theme.Epicycles.arm(level, opacity: 0.3)),
                   style: StrokeStyle(lineWidth: 0.7 * u, lineCap: .round, lineJoin: .round))
    }

    // MARK: - What moves

    /// The paths from the trace's step on to the tips, each arm's circle round its pivot, the arms from the hub out
    /// (a blur where one turns faster than the eye follows, with what it carries), and the pen.
    static func motion(_ ctx: inout GraphicsContext, _ c: EpicycleCanvas, _ m: EpicycleMotion) {
        let u = c.unit
        let f = m.figure
        let joints = f.joints(m.phase)
        let sharp = m.blurred ?? f.arms.count
        let onArms = f.arms.indices.filter { f.arms[$0].on }
        let last = onArms.last ?? 0

        // the tails: the pen's true path (every arm) and the other tips', from the trace's step on
        let span = max(0, m.phase - m.from)
        if span > 0 {
            let fastest = onArms.filter { $0 < sharp }.map { abs(f.arms[$0].turns) }.max() ?? 1
            let n = min(800, max(2, Int(Double(fastest) * span * Double(EpicycleFigure.samplesPerTurn)) + 2))
            var tails = Array(repeating: [CGPoint](), count: f.arms.count)
            for s in 0...n {
                let j = f.joints(m.from + span * Double(s) / Double(n))
                for i in onArms where i < sharp { tails[i].append(c.figure(j[i + 1])) }
            }
            for i in onArms where i < sharp {
                let isPen = i == last
                guard isPen || (m.tips && i < m.detail) else { continue }
                var path = Path()
                path.addLines(tails[i])
                if isPen {
                    penPath(&ctx, path, unit: u)
                } else {
                    tipPath(&ctx, path, level: f.arms[i].level, unit: u)
                }
            }
        }

        // each arm's circle round its pivot: the epicycle its tip runs on
        for i in onArms where i < sharp && i != onArms.first {
            let r = f.arms[i].length * c.scale
            guard r > 1.5 else { continue }
            ctx.stroke(c.disc(c.figure(joints[i]), r), with: .color(Theme.Epicycles.arm(f.arms[i].level, opacity: 0.18)),
                       lineWidth: 0.5 * u)
        }

        // the arms
        let widths: [CGFloat] = [2.6, 2.1, 1.7, 1.4, 1.2, 1.05]
        for (k, i) in onArms.enumerated() {
            let level = f.arms[i].level
            let pivot = c.figure(joints[i])
            if i >= sharp {
                // turning faster than the eye follows: the arm sweeps a disc, what it carries the ring of its reach
                let r = f.arms[i].length * c.scale
                let rest = onArms.filter { $0 > i }.map { f.arms[$0].length }.reduce(0, +) * c.scale
                ctx.fill(c.disc(pivot, r), with: .color(Theme.Epicycles.arm(level, opacity: 0.04)))
                if rest > 0.5 {
                    var reach = c.disc(pivot, r + rest)
                    if r > rest { reach.addPath(c.disc(pivot, r - rest)) }
                    ctx.fill(reach, with: .color(Theme.Epicycles.arm(level, opacity: 0.08)), style: FillStyle(eoFill: true))
                }
                ctx.stroke(c.disc(pivot, r), with: .color(Theme.Epicycles.arm(level, opacity: 0.4)), lineWidth: widths[min(k, 5)] * 0.6 * u)
                break
            }
            var arm = Path()
            arm.move(to: pivot)
            arm.addLine(to: c.figure(joints[i + 1]))
            let w = widths[min(k, 5)] * u
            ctx.stroke(arm, with: .color(.black.opacity(0.45)), style: StrokeStyle(lineWidth: w + 1.4 * u, lineCap: .round))
            ctx.stroke(arm, with: .color(Theme.Epicycles.hand(level)), style: StrokeStyle(lineWidth: w, lineCap: .round))
            if k > 0 {
                let carrier = f.arms[onArms[k - 1]].level
                let r = (widths[min(k - 1, 5)] * 0.5 + 1.1) * u
                ctx.fill(c.disc(pivot, r), with: .color(Theme.Epicycles.plateEdge))
                ctx.stroke(c.disc(pivot, r), with: .color(Theme.Epicycles.arm(carrier)), lineWidth: 0.9 * u)
            }
        }

        // the pen
        if m.blurred == nil {
            let tip = c.figure(joints[last + 1])
            glow(&ctx, at: tip, radius: 7 * u, color: Theme.Epicycles.arm(f.penLevel), opacity: 0.6)
            ctx.fill(c.disc(tip, 1.9 * u), with: .color(Theme.Epicycles.penCore))
        }
    }

    // MARK: - The hub's sync

    /// The sync's 19 Helions round the hub's badge, by Pentad (a gap between Pentads, the Hypopentad's as squares):
    /// those done filled, the running one lit, those to come outlined; the running Pentad's in full gold.
    static func sync(_ ctx: inout GraphicsContext, size: CGSize, radius: CGFloat, pentad: Int, helion: Int, unit u: CGFloat) {
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let gap = 0.9
        let total = 19 + 4 * gap
        for k in 0..<19 {
            let p = min(3, k / 5)
            let turns = (Double(k) + gap * Double(p) + 0.5 + gap / 2) / total
            let a = 2 * Double.pi * turns
            let q = CGPoint(x: center.x + radius * sin(a), y: center.y - radius * cos(a))
            let s = (k == helion ? 1.45 : 1) * max(1.6, radius * 0.075)
            let rect = CGRect(x: q.x - s, y: q.y - s, width: 2 * s, height: 2 * s)
            let shape = p == 3 ? Path(rect.insetBy(dx: s * 0.12, dy: s * 0.12)) : Path(ellipseIn: rect)
            let mine = p == pentad
            if k == helion {
                glow(&ctx, at: q, radius: s * 3.2, color: Theme.gold, opacity: 0.55)
                ctx.fill(shape, with: .color(Theme.gold))
            } else if k < helion {
                ctx.fill(shape, with: .color(Theme.gold.opacity(mine ? 0.85 : 0.4)))
            } else {
                ctx.stroke(shape, with: .color(Theme.gold.opacity(mine ? 0.7 : 0.32)), lineWidth: 0.7 * u)
            }
        }
    }

    /// A soft round glow.
    static func glow(_ ctx: inout GraphicsContext, at p: CGPoint, radius: CGFloat, color: Color, opacity: Double) {
        let rect = CGRect(x: p.x - radius, y: p.y - radius, width: 2 * radius, height: 2 * radius)
        ctx.fill(Path(ellipseIn: rect), with: .radialGradient(Gradient(colors: [color.opacity(opacity), color.opacity(0)]),
                                                              center: p, startRadius: 0, endRadius: radius))
    }
}
