import FractonicaKit
import SwiftUI

/// Draws the pendulum set into a `Canvas` whose context is already scaled to design units (`PendulumFit`): the case,
/// the beam and the swing arcs once; the pendulums and the Pentad dial as the clock moves.
enum PendulumPainter {
    private typealias Space = PendulumSpace
    private typealias Metal = Theme.Pendulums

    // MARK: - What stays

    /// The case, the plate, the Pentad dial's disc and ring, every pendulum's swing arc, the beam with its letters.
    static func drawStill(_ ctx: GraphicsContext) {
        drawCase(ctx)
        drawDialFace(ctx)
        for spec in PendulumLayout.all { drawArc(ctx, spec) }
        drawBeam(ctx)
    }

    private static func drawCase(_ ctx: GraphicsContext) {
        let outer = Path(roundedRect: Space.bounds, cornerRadius: Space.corner, style: .continuous)
        ctx.fill(outer, with: .linearGradient(Gradient(stops: [
            .init(color: Metal.bezelLight, location: 0),
            .init(color: Metal.bezelMid, location: 0.28),
            .init(color: Metal.bezelDark, location: 0.62),
            .init(color: Metal.bezelMid, location: 0.88),
            .init(color: Metal.bezelLight.opacity(0.85), location: 1),
        ]), startPoint: .zero, endPoint: CGPoint(x: Space.width, y: Space.height)))
        ctx.stroke(Path(roundedRect: Space.bounds.insetBy(dx: 0.5, dy: 0.5), cornerRadius: Space.corner - 0.5, style: .continuous),
                   with: .color(.white.opacity(0.14)), lineWidth: 1)

        let plateRect = Space.plate
        let plate = Path(roundedRect: plateRect, cornerRadius: Space.corner - Space.bezel, style: .continuous)
        ctx.fill(plate, with: .linearGradient(Gradient(colors: [Metal.plateTop, Theme.background, Metal.plateBottom]),
                                              startPoint: CGPoint(x: 0, y: plateRect.minY), endPoint: CGPoint(x: 0, y: plateRect.maxY)))
        // a lamp above the beam
        ctx.fill(plate, with: .radialGradient(Gradient(colors: [.white.opacity(0.06), .white.opacity(0)]),
                                              center: CGPoint(x: Space.width * 0.55, y: 40), startRadius: 0, endRadius: 330))
        // the bezel's inner chamfer: in shade at the top, catching the lamp at the bottom
        ctx.stroke(Path(roundedRect: plateRect.insetBy(dx: -0.8, dy: -0.8), cornerRadius: Space.corner - Space.bezel + 0.8, style: .continuous),
                   with: .linearGradient(Gradient(colors: [.black.opacity(0.75), .white.opacity(0.16)]),
                                         startPoint: CGPoint(x: 0, y: plateRect.minY), endPoint: CGPoint(x: 0, y: plateRect.maxY)),
                   lineWidth: 1.6)
    }

    private static func drawBeam(_ ctx: GraphicsContext) {
        let beam = Space.beam
        // its shadow on the plate
        ctx.fill(Path(CGRect(x: beam.minX, y: beam.maxY, width: beam.width, height: 9)),
                 with: .linearGradient(Gradient(colors: [.black.opacity(0.6), .black.opacity(0)]),
                                       startPoint: CGPoint(x: 0, y: beam.maxY), endPoint: CGPoint(x: 0, y: beam.maxY + 9)))
        // the hangers under it
        for spec in PendulumLayout.all {
            let x = spec.pivot.x
            var hanger = Path()
            hanger.move(to: CGPoint(x: x - 3.4, y: beam.maxY))
            hanger.addLine(to: CGPoint(x: x + 3.4, y: beam.maxY))
            hanger.addLine(to: CGPoint(x: x + 1.5, y: spec.pivot.y))
            hanger.addLine(to: CGPoint(x: x - 1.5, y: spec.pivot.y))
            hanger.closeSubpath()
            ctx.fill(hanger, with: .linearGradient(Gradient(colors: [Metal.steelMid, Metal.steelDark]),
                                                   startPoint: CGPoint(x: x - 3, y: 0), endPoint: CGPoint(x: x + 3, y: 0)))
        }
        let body = Path(beam)
        ctx.fill(body, with: .linearGradient(Gradient(stops: [
            .init(color: Metal.beamTop, location: 0),
            .init(color: Metal.beamMid, location: 0.38),
            .init(color: Metal.beamBottom, location: 1),
        ]), startPoint: CGPoint(x: 0, y: beam.minY), endPoint: CGPoint(x: 0, y: beam.maxY)))
        // brushed grain
        for (i, y) in stride(from: beam.minY + 3, to: beam.maxY - 1, by: 2.3).enumerated() {
            ctx.stroke(Path { p in
                p.move(to: CGPoint(x: beam.minX, y: y))
                p.addLine(to: CGPoint(x: beam.maxX, y: y))
            }, with: .color(.white.opacity(i % 2 == 0 ? 0.035 : 0.02)), lineWidth: 0.5)
        }
        ctx.stroke(Path { p in
            p.move(to: CGPoint(x: beam.minX, y: beam.minY + 0.5))
            p.addLine(to: CGPoint(x: beam.maxX, y: beam.minY + 0.5))
        }, with: .color(.white.opacity(0.4)), lineWidth: 1)
        ctx.stroke(Path { p in
            p.move(to: CGPoint(x: beam.minX, y: beam.maxY - 0.4))
            p.addLine(to: CGPoint(x: beam.maxX, y: beam.maxY - 0.4))
        }, with: .color(.black.opacity(0.7)), lineWidth: 0.8)
        // the screws that hold it in the case
        for x in [beam.minX + 9, beam.maxX - 9] { drawScrew(ctx, at: CGPoint(x: x, y: beam.midY), radius: 3.6) }
        // the letters, engraved above each pivot
        for spec in PendulumLayout.all {
            let letter = Fractonica.periodName(spec.level).text
            let size: CGFloat = spec.isUnit ? 11.5 : 9.5
            let at = CGPoint(x: spec.pivot.x, y: beam.midY + 0.3)
            ctx.draw(Text(verbatim: letter).font(.system(size: size, weight: .bold)).foregroundStyle(Color.black.opacity(0.85)),
                     at: CGPoint(x: at.x, y: at.y + 0.8))
            ctx.draw(Text(verbatim: letter).font(.system(size: size, weight: .bold))
                .foregroundStyle(Theme.levelColor(spec.level, opacity: spec.isUnit ? 1 : 0.85, lightness: 0.72)), at: at)
        }
    }

    private static func drawScrew(_ ctx: GraphicsContext, at c: CGPoint, radius r: CGFloat) {
        let head = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
        ctx.fill(head, with: .radialGradient(Gradient(colors: [Metal.steel, Metal.steelMid, Metal.steelDark]),
                                             center: CGPoint(x: c.x - r * 0.4, y: c.y - r * 0.4), startRadius: 0, endRadius: r * 1.6))
        ctx.stroke(head, with: .color(.black.opacity(0.55)), lineWidth: 0.5)
        let a = 0.55
        ctx.stroke(Path { p in
            p.move(to: CGPoint(x: c.x - r * 0.75 * cos(a), y: c.y - r * 0.75 * sin(a)))
            p.addLine(to: CGPoint(x: c.x + r * 0.75 * cos(a), y: c.y + r * 0.75 * sin(a)))
        }, with: .color(Metal.steelDark), lineWidth: 0.9)
    }

    /// A pendulum's swing range: its arc in the level's colour, ticks at the peak (right) and valley (left), a dot under
    /// the centre (start, node, end).
    private static func drawArc(_ ctx: GraphicsContext, _ spec: PendulumSpec) {
        let a = spec.amplitude
        let color = Theme.levelColor(spec.level, opacity: spec.isUnit ? 0.34 : 0.24)
        var arc = Path()
        let steps = 28
        for i in 0...steps {
            let p = spec.bob(angle: -a + 2 * a * Double(i) / Double(steps))
            if i == 0 { arc.move(to: p) } else { arc.addLine(to: p) }
        }
        ctx.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: 0.8, lineCap: .round))
        let tick = Theme.levelColor(spec.level, opacity: spec.isUnit ? 0.7 : 0.5)
        // the turning points cross the arc; the centre (start, node, end) is a notch under it
        for (side, inner, outer) in [(-1.0, 3.5, 3.5), (1.0, 3.5, 3.5), (0.0, 0.0, 3.0)] {
            ctx.stroke(Path { p in
                p.move(to: spec.point(angle: side * a, radius: spec.length - inner))
                p.addLine(to: spec.point(angle: side * a, radius: spec.length + outer))
            }, with: .color(tick), style: StrokeStyle(lineWidth: 0.9, lineCap: .round))
        }
    }

    /// The dial's recessed disc, its 19 Helion cells outlined (the Hypopentad's bolder), the sun marks where a solar day
    /// turns and the four group badges.
    private static func drawDialFace(_ ctx: GraphicsContext) {
        let d = PentadDial.self
        let c = d.center
        let disc = Path(ellipseIn: CGRect(x: c.x - d.discRadius, y: c.y - d.discRadius, width: 2 * d.discRadius, height: 2 * d.discRadius))
        ctx.fill(disc, with: .radialGradient(Gradient(colors: [Metal.plateTop.opacity(0.9), Metal.plateBottom]),
                                             center: CGPoint(x: c.x, y: c.y - 20), startRadius: 0, endRadius: d.discRadius * 1.1))
        // fine turned rings
        for r in stride(from: CGFloat(6), to: d.discRadius - 2, by: 3) {
            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)),
                       with: .color(.white.opacity(0.022)), lineWidth: 0.5)
        }
        // recessed: shaded edge at the top, lit at the bottom
        ctx.stroke(disc, with: .linearGradient(Gradient(colors: [.black.opacity(0.85), .white.opacity(0.13)]),
                                               startPoint: CGPoint(x: c.x, y: c.y - d.discRadius), endPoint: CGPoint(x: c.x, y: c.y + d.discRadius)),
                   lineWidth: 1.6)

        for k in 0..<19 {
            let hypo = d.group(ofHelion: k) == 3
            let cell = dialCell(k)
            ctx.fill(cell, with: .color(Theme.gold.opacity(hypo ? 0.08 : 0.05)))
            ctx.stroke(cell, with: .color(Theme.gold.opacity(hypo ? 0.5 : 0.24)), lineWidth: hypo ? 0.9 : 0.7)
        }
        // where a solar day turns: each Pentad begins ¼η later in its day
        for h in d.dayTurns {
            let p = d.point(angle: d.angle(helions: h), radius: d.radius + d.band / 2 + d.hypoExtra + 4)
            ctx.fill(Path(ellipseIn: CGRect(x: p.x - 1.5, y: p.y - 1.5, width: 3, height: 3)), with: .color(Theme.gold.opacity(0.8)))
            ctx.stroke(Path(ellipseIn: CGRect(x: p.x - 3, y: p.y - 3, width: 6, height: 6)), with: .color(Theme.gold.opacity(0.3)), lineWidth: 0.5)
        }
        for i in 0..<4 { drawGroupBadge(ctx, i, lit: false) }
    }

    /// The small badge of group `i` outside the ring; `lit` for the running Pentad.
    private static func drawGroupBadge(_ ctx: GraphicsContext, _ i: Int, lit: Bool) {
        let d = PentadDial.self
        let hypo = i == 3
        let size = d.badgeSize * (hypo ? 1.12 : 1)
        let c = d.point(angle: d.groupMiddle(i), radius: d.badgeRadius)
        drawBadge(ctx, index: i, center: c, size: size, filled: lit, strength: lit ? 1 : (hypo ? 0.75 : 0.5))
    }

    /// A Pentad's shape with its numeral (none in the Hypopentad's square), filled in polished gold or outlined.
    static func drawBadge(_ ctx: GraphicsContext, index i: Int, center c: CGPoint, size: CGFloat, filled: Bool,
                          strength: Double = 1, rotation: Double = 0) {
        var g = ctx
        g.translateBy(x: c.x, y: c.y)
        if rotation != 0 { g.rotate(by: .radians(rotation)) }
        let box = CGRect(x: -size / 2, y: -size / 2, width: size, height: size)
        let shape = PentadPolygon(index: i).path(in: box)
        if filled {
            g.fill(shape, with: .linearGradient(Gradient(stops: [
                .init(color: Metal.goldLight, location: 0),
                .init(color: Theme.gold, location: 0.42),
                .init(color: Metal.goldDeep, location: 1),
            ]), startPoint: CGPoint(x: -size / 2, y: -size / 2), endPoint: CGPoint(x: size / 2, y: size / 2)))
            g.stroke(shape, with: .color(Metal.goldDeep), style: StrokeStyle(lineWidth: max(0.5, size / 40), lineJoin: .round))
        } else {
            g.fill(shape, with: .color(Theme.gold.opacity(0.06 * strength)))
            g.stroke(shape, with: .color(Theme.gold.opacity(0.85 * strength)), style: StrokeStyle(lineWidth: max(0.6, size / 18), lineJoin: .round))
        }
        let numeral = Notation.pentadNumerals[min(max(i, 0), 3)]
        if !numeral.isEmpty {
            let text = Text(verbatim: numeral)
                .font(.system(size: size * (i == 2 ? 0.31 : 0.37), weight: .bold, design: .serif))
                .foregroundStyle(filled ? Theme.background : Theme.gold.opacity(0.9 * strength))
            g.draw(text, at: CGPoint(x: 0, y: size * 0.07))
        }
    }

    /// The cell of the sync's Helion k on the ring (the Hypopentad's reaches further out).
    private static func dialCell(_ k: Int, upTo fraction: Double = 1) -> Path {
        let d = PentadDial.self
        let span = d.segment(k)
        let outer = d.radius + d.band / 2 + (d.group(ofHelion: k) == 3 ? d.hypoExtra : 0)
        return ring(center: d.center, inner: d.radius - d.band / 2, outer: outer, from: span.start,
                    to: span.start + (span.end - span.start) * min(max(fraction, 0), 1))
    }

    /// An annular sector between screen angles a0 and a1 (clockwise from three o'clock).
    private static func ring(center c: CGPoint, inner: CGFloat, outer: CGFloat, from a0: Double, to a1: Double) -> Path {
        let steps = max(2, Int(abs(a1 - a0) / 0.05))
        var path = Path()
        for i in 0...steps {
            let a = a0 + (a1 - a0) * Double(i) / Double(steps)
            let p = CGPoint(x: c.x + outer * CGFloat(cos(a)), y: c.y + outer * CGFloat(sin(a)))
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        for i in stride(from: steps, through: 0, by: -1) {
            let a = a0 + (a1 - a0) * Double(i) / Double(steps)
            path.addLine(to: CGPoint(x: c.x + inner * CGFloat(cos(a)), y: c.y + inner * CGFloat(sin(a))))
        }
        path.closeSubpath()
        return path
    }

    /// The crystal over the plate: its edge catching the lamp at the top left and, more faintly, the bottom right, and
    /// a broad soft sheen across the top corner.
    static func drawGlass(_ ctx: GraphicsContext) {
        let plateRect = Space.plate
        let radius = Space.corner - Space.bezel
        let plate = Path(roundedRect: plateRect, cornerRadius: radius, style: .continuous)
        ctx.fill(plate, with: .linearGradient(Gradient(stops: [
            .init(color: .white.opacity(0.045), location: 0),
            .init(color: .white.opacity(0), location: 0.34),
        ]), startPoint: CGPoint(x: plateRect.minX, y: plateRect.minY), endPoint: CGPoint(x: plateRect.maxX, y: plateRect.maxY)))
        ctx.stroke(Path(roundedRect: plateRect.insetBy(dx: 0.7, dy: 0.7), cornerRadius: radius - 0.7, style: .continuous),
                   with: .linearGradient(Gradient(stops: [
                       .init(color: .white.opacity(0.26), location: 0),
                       .init(color: .white.opacity(0.05), location: 0.22),
                       .init(color: .white.opacity(0), location: 0.55),
                       .init(color: .white.opacity(0.05), location: 0.88),
                       .init(color: .white.opacity(0.15), location: 1),
                   ]), startPoint: CGPoint(x: plateRect.minX, y: plateRect.minY), endPoint: CGPoint(x: plateRect.maxX, y: plateRect.maxY)),
                   lineWidth: 1.2)
    }

    // MARK: - The Pentad dial

    /// The running sync on the dial: the Helions run (dim gold), the running one filling with its progress, a marker at
    /// the moment, the running group's badge lit and the Pentad itself in the middle. Out of the catalogue: the words.
    static func drawDial(_ ctx: GraphicsContext, _ state: PentadDialState?, outOfRange: (title: [String], range: [String])) {
        let d = PentadDial.self
        let c = d.center
        guard let s = state else {
            let lines = outOfRange.title.map { ($0, Theme.ink2, CGFloat(9.5)) } + outOfRange.range.map { ($0, Theme.ink3, CGFloat(8)) }
            for (i, line) in lines.enumerated() {
                ctx.draw(Text(verbatim: line.0).font(.system(size: line.2, weight: i < 2 ? .semibold : .regular)).foregroundStyle(line.1),
                         at: CGPoint(x: c.x, y: c.y - 21 + CGFloat(i) * 13 + (i >= 2 ? 3 : 0)))
            }
            return
        }
        if s.isHypopentad {
            // the Hypopentad, a Helion short, brings the Sun back: the dial glows while it runs
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - d.discRadius, y: c.y - d.discRadius, width: 2 * d.discRadius, height: 2 * d.discRadius)),
                     with: .radialGradient(Gradient(colors: [Theme.gold.opacity(0), Theme.gold.opacity(0.1), Theme.gold.opacity(0)]),
                                           center: c, startRadius: d.radius - 20, endRadius: d.discRadius))
        }
        for k in 0..<s.within {
            ctx.fill(dialCell(k), with: .color(Theme.gold.opacity(d.group(ofHelion: k) == 3 ? 0.42 : 0.3)))
        }
        let running = dialCell(s.within)
        ctx.fill(running, with: .color(Theme.gold.opacity(0.12)))
        ctx.fill(dialCell(s.within, upTo: s.progress), with: .color(Theme.gold.opacity(0.95)))
        ctx.stroke(running, with: .color(Theme.gold), lineWidth: 0.9)

        // the moment: a gold pointer on the ring's outer edge
        let a = d.angle(helions: s.position)
        let edge = d.radius + d.band / 2 + (s.isHypopentad ? d.hypoExtra : 0)
        var pointer = Path()
        pointer.move(to: d.point(angle: a, radius: edge + 0.5))
        pointer.addLine(to: d.point(angle: a - 0.05, radius: edge + 6))
        pointer.addLine(to: d.point(angle: a + 0.05, radius: edge + 6))
        pointer.closeSubpath()
        ctx.fill(pointer, with: .color(Metal.goldLight))

        drawGroupBadge(ctx, s.index, lit: true)

        // the Pentad in the middle
        let size: CGFloat = s.isHypopentad ? 38 : 40
        let mid = CGPoint(x: c.x, y: c.y - 8)
        ctx.fill(Path(ellipseIn: CGRect(x: mid.x - size, y: mid.y - size, width: 2 * size, height: 2 * size)),
                 with: .radialGradient(Gradient(colors: [Theme.gold.opacity(s.isHypopentad ? 0.34 : 0.2), Theme.gold.opacity(0)]),
                                       center: mid, startRadius: 0, endRadius: size))
        if s.isHypopentad {
            let ring = PentadPolygon(index: 3).path(in: CGRect(x: mid.x - size / 2 - 5, y: mid.y - size / 2 - 5, width: size + 10, height: size + 10))
            ctx.stroke(ring, with: .color(Theme.gold.opacity(0.7)), lineWidth: 1)
        }
        drawBadge(ctx, index: s.index, center: mid, size: size, filled: true)
        let name = PentadWords.name(s.index).uppercased()
        ctx.draw(Text(verbatim: name).font(.system(size: 8.5, weight: .semibold)).tracking(1.1).foregroundStyle(Theme.gold.opacity(0.9)),
                 at: CGPoint(x: c.x, y: c.y + 24))
        ctx.draw(Text(verbatim: "\(PentadWords.ordinal(s.helion)) Helion of \(s.helions)").font(.system(size: 8)).foregroundStyle(Theme.ink3),
                 at: CGPoint(x: c.x, y: c.y + 35))
    }

    // MARK: - The pendulums

    /// One pendulum at `angle`: its fan (fast in a time-lapse), the rod's blur, the trail behind the bob, the rod and the
    /// bob — a polished sphere, or for the Helion the running Pentad's gold shape. `dim` fades it (out of the catalogue).
    static func drawPendulum(_ ctx: GraphicsContext, _ spec: PendulumSpec, angle: Double, motion: PendulumMotion,
                             pentad: Int?, dim: Double = 1) {
        if motion.fan > 0.001 { drawFan(ctx, spec, amount: motion.fan * dim) }
        let clear = (1 - motion.fan) * dim
        if clear > 0.001 {
            var g = ctx
            g.opacity = clear
            if motion.trail > 0.002 {
                // the rod smears over the trail's sweep, faintly where the motion is only told, more where it is real
                let real = min(1, motion.rodBlur / motion.trail)
                drawRodBlur(g, spec, angle: angle, sweep: motion.trail, heading: motion.heading, strength: 0.12 + 0.16 * real)
                drawTrail(g, spec, angle: angle, sweep: motion.trail, heading: motion.heading)
            }
            drawRod(g, spec, angle: angle)
            if let pentad, spec.level == Space.helionLevel {
                drawPentadBob(g, spec, angle: angle, index: pentad)
            } else {
                drawBob(g, spec, at: spec.bob(angle: angle))
            }
        }
        drawPin(ctx, spec.pivot)
    }

    private static func drawRod(_ ctx: GraphicsContext, _ spec: PendulumSpec, angle: Double) {
        let end = spec.bob(angle: angle)
        let rod = Path { p in
            p.move(to: spec.pivot)
            p.addLine(to: end)
        }
        var shadow = ctx
        shadow.translateBy(x: 1.2, y: 2.2)
        shadow.stroke(rod, with: .color(.black.opacity(0.4)), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
        // steel with a breath of the level's hue, so a rod that crosses another can be followed to its letter
        let ink = PendulumInk.of(spec.level)
        ctx.stroke(rod, with: .color(ink.rod), style: StrokeStyle(lineWidth: 1.7, lineCap: .round))
        var light = ctx
        light.translateBy(x: -0.35 * CGFloat(cos(angle)), y: 0.35 * CGFloat(sin(angle)))
        light.stroke(rod, with: .color(ink.rodLight), style: StrokeStyle(lineWidth: 0.6, lineCap: .round))
    }

    private static func drawPin(_ ctx: GraphicsContext, _ c: CGPoint) {
        let r: CGFloat = 2.3
        let pin = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
        ctx.fill(pin, with: .radialGradient(Gradient(colors: [Metal.steel, Metal.steelDark]),
                                            center: CGPoint(x: c.x - 0.8, y: c.y - 0.8), startRadius: 0, endRadius: r * 1.5))
        ctx.stroke(pin, with: .color(.black.opacity(0.6)), lineWidth: 0.5)
    }

    /// A polished bob in the level's colour: its shadow on the plate, a faint halo, the lit sphere and a highlight.
    private static func drawBob(_ ctx: GraphicsContext, _ spec: PendulumSpec, at c: CGPoint) {
        let r = spec.bobRadius
        let ink = PendulumInk.of(spec.level)
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - r * 1.05 + 1.8, y: c.y - r * 0.95 + 3.2, width: 2.1 * r, height: 1.9 * r)),
                 with: .radialGradient(Gradient(colors: [.black.opacity(0.55), .black.opacity(0)]),
                                       center: CGPoint(x: c.x + 1.8, y: c.y + 3.2), startRadius: r * 0.3, endRadius: r * 1.1))
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - 2 * r, y: c.y - 2 * r, width: 4 * r, height: 4 * r)),
                 with: .radialGradient(Gradient(colors: [ink.halo, ink.clear]),
                                       center: c, startRadius: r * 0.8, endRadius: r * 2))
        let body = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
        ctx.fill(body, with: .radialGradient(Gradient(stops: zip(ink.body, [0, 0.32, 0.72, 1]).map { .init(color: $0, location: $1) }), center: CGPoint(x: c.x - r * 0.36, y: c.y - r * 0.4), startRadius: 0, endRadius: r * 1.6))
        // the lamp's reflection, and the plate's faint light from below
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - r * 0.68, y: c.y - r * 0.72, width: r * 0.62, height: r * 0.46)),
                 with: .radialGradient(Gradient(colors: [.white.opacity(0.9), .white.opacity(0)]),
                                       center: CGPoint(x: c.x - r * 0.37, y: c.y - r * 0.49), startRadius: 0, endRadius: r * 0.34))
        ctx.stroke(Path { p in
            p.addArc(center: c, radius: r * 0.8, startAngle: .degrees(20), endAngle: .degrees(110), clockwise: false)
        }, with: .color(.white.opacity(0.16)), style: StrokeStyle(lineWidth: r * 0.14, lineCap: .round))
        ctx.stroke(body, with: .color(.black.opacity(0.5)), lineWidth: 0.6)
    }

    /// The Helion's bob: the running Pentad's shape in polished gold, hanging from its rod (it turns with the swing).
    private static func drawPentadBob(_ ctx: GraphicsContext, _ spec: PendulumSpec, angle: Double, index: Int) {
        let c = spec.bob(angle: angle)
        let hypo = index == 3
        let size = spec.bobRadius * (hypo ? 2.5 : 2.6)
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - size / 2 + 1.8, y: c.y - size / 2 + 3.2, width: size, height: size)),
                 with: .radialGradient(Gradient(colors: [.black.opacity(0.55), .black.opacity(0)]),
                                       center: CGPoint(x: c.x + 1.8, y: c.y + 3.2), startRadius: size * 0.2, endRadius: size * 0.6))
        let halo = size * (hypo ? 1.35 : 1.05)
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - halo, y: c.y - halo, width: 2 * halo, height: 2 * halo)),
                 with: .radialGradient(Gradient(colors: [Theme.gold.opacity(hypo ? 0.4 : 0.24), Theme.gold.opacity(0)]),
                                       center: c, startRadius: size * 0.3, endRadius: halo))
        if hypo {
            var g = ctx
            g.translateBy(x: c.x, y: c.y)
            g.rotate(by: .radians(-angle))
            let ring = PentadPolygon(index: 3).path(in: CGRect(x: -size / 2 - 3.5, y: -size / 2 - 3.5, width: size + 7, height: size + 7))
            g.stroke(ring, with: .color(Theme.gold.opacity(0.75)), lineWidth: 0.8)
        }
        drawBadge(ctx, index: index, center: c, size: size, filled: true, rotation: -angle)
    }

    /// The trail behind a bob along its arc: a comet in the level's colour, longest at full speed through the centre
    /// and gone at the turning points, pointing the way the bob is heading.
    private static func drawTrail(_ ctx: GraphicsContext, _ spec: PendulumSpec, angle: Double, sweep: Double, heading: Double) {
        // a few points per side suffice: the sweep is at most two amplitudes (≤ 60°, μ) and mostly a few degrees
        let n = 8
        let w = spec.bobRadius * 0.95
        var outer: [CGPoint] = [], inner: [CGPoint] = []
        outer.reserveCapacity(n + 1)
        inner.reserveCapacity(n + 1)
        for i in 0...n {
            let s = Double(i) / Double(n)
            let a = angle - heading * sweep * s
            let half = w * CGFloat(1 - 0.8 * s)
            let dx = CGFloat(sin(a)), dy = CGFloat(cos(a))
            outer.append(CGPoint(x: spec.pivot.x + (spec.length + half) * dx, y: spec.pivot.y + (spec.length + half) * dy))
            inner.append(CGPoint(x: spec.pivot.x + (spec.length - half) * dx, y: spec.pivot.y + (spec.length - half) * dy))
        }
        var comet = Path()
        comet.addLines(outer + inner.reversed())
        comet.closeSubpath()
        let head = spec.bob(angle: angle), tail = spec.bob(angle: angle - heading * sweep)
        let ink = PendulumInk.of(spec.level)
        ctx.fill(comet, with: .linearGradient(Gradient(stops: [
            .init(color: ink.trailHead, location: 0),
            .init(color: ink.trailMid, location: 0.4),
            .init(color: ink.clear, location: 1),
        ]), startPoint: head, endPoint: tail))
    }

    /// The rod's blur: the wedge it sweeps behind the bob.
    private static func drawRodBlur(_ ctx: GraphicsContext, _ spec: PendulumSpec, angle: Double, sweep: Double, heading: Double,
                                    strength: Double) {
        var wedge = Path()
        wedge.move(to: spec.pivot)
        let n = 6
        for i in 0...n {
            wedge.addLine(to: spec.point(angle: angle - heading * sweep * Double(i) / Double(n), radius: spec.length + spec.bobRadius * 0.6))
        }
        wedge.closeSubpath()
        let tint = PendulumInk.of(spec.level).smear
        ctx.fill(wedge, with: .linearGradient(Gradient(colors: [tint.opacity(strength), tint.opacity(0)]),
                                              startPoint: spec.bob(angle: angle), endPoint: spec.bob(angle: angle - heading * sweep)))
    }

    /// A pendulum swinging faster than the display can show: its whole swing as a translucent fan, densest at the
    /// turning points where it lingers (the long exposure of a pendulum).
    private static func drawFan(_ ctx: GraphicsContext, _ spec: PendulumSpec, amount: Double) {
        let a = spec.amplitude
        let left = spec.bob(angle: -a), right = spec.bob(angle: a)
        let n = 24
        var g = ctx
        g.opacity = amount
        var wedge = Path()
        wedge.move(to: spec.pivot)
        for i in 0...n { wedge.addLine(to: spec.bob(angle: -a + 2 * a * Double(i) / Double(n))) }
        wedge.closeSubpath()
        // a sine dwells at its ends: the density of its positions is 1/√(1 − x²)
        let density: [(Double, Double)] = [(0, 1), (0.04, 0.62), (0.12, 0.4), (0.25, 0.3), (0.5, 0.26), (0.75, 0.3), (0.88, 0.4), (0.96, 0.62), (1, 1)]
        g.fill(wedge, with: .linearGradient(Gradient(stops: density.map { .init(color: Metal.steel.opacity(0.2 * $0.1), location: $0.0) }),
                                            startPoint: left, endPoint: right))
        var band = Path()
        let w = spec.bobRadius * 0.92
        band.move(to: spec.point(angle: -a, radius: spec.length + w))
        for i in 1...n { band.addLine(to: spec.point(angle: -a + 2 * a * Double(i) / Double(n), radius: spec.length + w)) }
        for i in stride(from: n, through: 0, by: -1) { band.addLine(to: spec.point(angle: -a + 2 * a * Double(i) / Double(n), radius: spec.length - w)) }
        band.closeSubpath()
        g.fill(band, with: .linearGradient(Gradient(stops: density.map {
            .init(color: Theme.levelColor(spec.level, opacity: 0.75 * $0.1, lightness: 0.62), location: $0.0)
        }), startPoint: left, endPoint: right))
        for end in [left, right] {
            let r = spec.bobRadius
            g.fill(Path(ellipseIn: CGRect(x: end.x - r, y: end.y - r, width: 2 * r, height: 2 * r)),
                   with: .radialGradient(Gradient(colors: [Theme.levelColor(spec.level, opacity: 0.5, lightness: 0.7), Theme.levelColor(spec.level, opacity: 0)]),
                                         center: end, startRadius: 0, endRadius: r * 1.2))
        }
    }
}
