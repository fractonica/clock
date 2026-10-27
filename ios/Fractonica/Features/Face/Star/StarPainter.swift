import FractonicaKit
import SwiftUI

/// Where the dial sits in a canvas: unit points (y down, the dial's radius 1) to canvas points, and line widths that
/// grow a little slower than the dial, so a large face keeps fine lines.
struct StarFrame {
    let center: CGPoint
    let radius: CGFloat

    init(size: CGSize) {
        center = CGPoint(x: size.width / 2, y: size.height / 2)
        radius = min(size.width, size.height) / 2
    }

    /// One point of line on an iPhone's dial (radius ≈ 187).
    var unit: CGFloat { pow(max(radius, 40) / 187, 0.75) }

    func point(_ u: CGPoint) -> CGPoint {
        CGPoint(x: center.x + u.x * radius, y: center.y + u.y * radius)
    }

    func point(turns: Double, radius r: Double) -> CGPoint {
        point(StarGeometry.point(turns: turns, radius: r))
    }

    /// The square around the circle of radius r (in dial radii).
    func circle(_ r: Double) -> CGRect {
        CGRect(x: center.x - r * radius, y: center.y - r * radius, width: 2 * r * radius, height: 2 * r * radius)
    }

    /// A disc of `points` radius around p.
    func disc(_ p: CGPoint, _ points: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: p.x - points, y: p.y - points, width: 2 * points, height: 2 * points))
    }
}

/// The parts of the dial that move with the clock, `phase` into Helion `helion` of the sync.
struct StarMotion: Equatable {
    var helion: Int
    var pentad: Int
    var phase: Double
    /// The phase the rose and its arms are drawn at: the start of the step (`StarCadence.motionSteps`), where the
    /// spark's layer finds the pen too.
    var rosePhase: Double
    /// Displayed seconds per real second (0 when still): arms that turn faster than the eye follows blur into discs.
    var speed: Double
    /// The Helion's length in seconds (for the arms' real turning rates).
    var helionSeconds: Double
    /// The Flavon's spark is shown (not with Reduce Motion), on a layer of its own (`spark(_:size:orbit:blink:unit:)`).
    var spark: Bool

    init(_ r: StarReading, steps: Int, speed: Double, spark: Bool) {
        helion = r.helion
        pentad = r.pentad
        phase = r.phase
        rosePhase = r.steppedPhase(steps)
        self.speed = speed
        helionSeconds = max(1, r.end - r.start)
        self.spark = spark
    }

    /// Real turns a second of something that turns `perHelion` times a Helion.
    func spin(_ perHelion: Double) -> Double { abs(perHelion) * speed / helionSeconds }

    /// Faster than this, a turning part is drawn as the blur it would be.
    static let blurSpin = 1.2

    /// The Flavon's spark turns too fast to follow: its orbit is drawn as a ring instead.
    var sparkBlurred: Bool { spin(2_340) > Self.blurSpin }
}

/// The star face's drawing, layer by layer (StarFace puts them together): the plate that never changes, what changes
/// once a Helion (the drawn chords, the rim's Pentad points, the hours), and what moves (the pen, the Sun, the rose).
enum StarPainter {
    // MARK: - The plate

    /// The plate, its turned bezel, the Preon ticks, and the whole figure in ghost: the 19 chords and the Helion's rose.
    static func plate(_ ctx: inout GraphicsContext, _ f: StarFrame) {
        let u = f.unit
        // the plate lifts off the background: a soft shadow under it
        ctx.drawLayer { layer in
            layer.addFilter(.shadow(color: .black.opacity(0.7), radius: f.radius * 0.035, y: f.radius * 0.012))
            layer.fill(Path(ellipseIn: f.circle(StarDial.plate)), with: .color(Theme.Star.plateEdge))
        }
        // the dial: a little lifted towards the top
        ctx.fill(Path(ellipseIn: f.circle(StarDial.bezel)),
                 with: .radialGradient(Gradient(colors: [Theme.Star.plateCentre, Theme.Star.plateEdge]),
                                       center: f.point(CGPoint(x: 0, y: -0.18)), startRadius: 0, endRadius: f.radius * 1.05))
        // the bezel: a ring of turned metal catching the light at the top left and bottom right
        var ring = Path(ellipseIn: f.circle(StarDial.plate))
        ring.addEllipse(in: f.circle(StarDial.bezel))
        let metal = Gradient(colors: [Theme.Star.bezelMid, Theme.Star.bezelLight, Theme.Star.bezelMid, Theme.Star.bezelDark,
                                      Theme.Star.bezelMid, Theme.Star.bezelLight, Theme.Star.bezelMid, Theme.Star.bezelDark,
                                      Theme.Star.bezelMid])
        ctx.fill(ring, with: .conicGradient(metal, center: f.center, angle: .degrees(-100)), style: FillStyle(eoFill: true))
        // its turning: fine concentric lines
        for i in 1..<4 {
            let r = StarDial.bezel + (StarDial.plate - StarDial.bezel) * Double(i) / 4
            ctx.stroke(Path(ellipseIn: f.circle(r)), with: .color(.black.opacity(0.22)), lineWidth: 0.5)
        }
        // engraved edges: dark into the plate, a lit lip below
        ctx.stroke(Path(ellipseIn: f.circle(StarDial.plate)), with: .color(.black.opacity(0.5)), lineWidth: 0.75)
        ctx.stroke(Path(ellipseIn: f.circle(StarDial.bezel)), with: .color(.black.opacity(0.75)), lineWidth: 1.2 * u)
        ctx.stroke(Path(ellipseIn: f.circle(StarDial.bezel - 0.006)), with: .color(Theme.Star.engraveLight), lineWidth: 0.5)
        // a gold pip inlaid in the bezel at the top: where every sync begins, the Sun's place at its start
        let mid = (StarDial.plate + StarDial.bezel) / 2
        let half = (StarDial.plate - StarDial.bezel) * 0.42
        var pip = Path()
        pip.move(to: f.point(CGPoint(x: -half * 0.8, y: -mid - half)))
        pip.addLine(to: f.point(CGPoint(x: half * 0.8, y: -mid - half)))
        pip.addLine(to: f.point(CGPoint(x: 0, y: -mid + half)))
        pip.closeSubpath()
        ctx.fill(pip, with: .linearGradient(Gradient(colors: [Theme.Star.sunCore, Theme.gold]),
                                            startPoint: f.point(CGPoint(x: 0, y: -mid - half)), endPoint: f.point(CGPoint(x: 0, y: -mid + half))))
        ctx.stroke(pip, with: .color(.black.opacity(0.5)), lineWidth: 0.5)

        ticks(&ctx, f)

        // the star's circle
        ctx.stroke(Path(ellipseIn: f.circle(StarDial.starRadius)), with: .color(Theme.line2.opacity(0.8)), lineWidth: 0.6 * u)
        // the Helion's own scale inside the star: 36 Preons, the 9 θ longer (the η arm reads on it)
        helionScale(&ctx, f, upTo: nil)

        // the whole sync in ghost: every chord yet to be drawn
        for k in 0..<StarGeometry.helions {
            strokeChord(&ctx, f, k, shading: .color(Theme.gold.opacity(StarGeometry.pentad(ofHelion: k) == 3 ? 0.15 : 0.11)),
                        width: 0.7 * u)
        }
        // the whole Helion in ghost: its rose, the θ tips
        ctx.stroke(rose(f, upTo: 1), with: .color(Theme.Star.rose(opacity: 0.11)), lineWidth: 0.7 * u)
        for tip in StarRose.tips {
            ctx.fill(f.disc(f.point(tip), 1.1 * u), with: .color(Theme.levelColor(7, opacity: 0.35)))
        }
    }

    /// 171 Preon ticks: a solar day; the 19 longer ones are the quarter Helions, the rim points.
    private static func ticks(_ ctx: inout GraphicsContext, _ f: StarFrame) {
        let u = f.unit
        var minor = Path(), major = Path(), lip = Path()
        for i in 0..<StarGeometry.ticks {
            let turns = Double(i) / Double(StarGeometry.ticks)
            let isMajor = i % StarGeometry.ticksPerPoint == 0
            let a = f.point(turns: turns, radius: isMajor ? StarDial.tickMajor : StarDial.tickMinor)
            let b = f.point(turns: turns, radius: StarDial.tickOuter)
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
        ctx.stroke(lip, with: .color(Theme.Star.engraveLight), lineWidth: 0.5)
        ctx.stroke(minor, with: .color(Theme.ink3.opacity(0.42)), lineWidth: 0.55 * u)
        ctx.stroke(major, with: .color(Theme.ink2.opacity(0.75)), style: StrokeStyle(lineWidth: 1.1 * u, lineCap: .round))
        ctx.stroke(Path(ellipseIn: f.circle(StarDial.tickOuter + 0.01)), with: .color(Theme.line2.opacity(0.7)), lineWidth: 0.5)
    }

    /// The Helion's scale: 36 Preon ticks on a circle just inside the chords, every 4th (a θ, where a tip of the rose
    /// points) longer. In ghost on the plate; with `upTo` the Preons completed, lit (the moving layer).
    static func helionScale(_ ctx: inout GraphicsContext, _ f: StarFrame, upTo preons: Int?) {
        let u = f.unit
        var minor = Path(), major = Path()
        for q in 0..<(preons.map { $0 + 1 } ?? 36) {
            let turns = Double(q) / 36
            let isMajor = q % 4 == 0
            let a = f.point(turns: turns, radius: isMajor ? StarDial.scaleMajor : StarDial.scaleMinor)
            let b = f.point(turns: turns, radius: StarDial.scaleOuter)
            if isMajor {
                major.move(to: a)
                major.addLine(to: b)
            } else {
                minor.move(to: a)
                minor.addLine(to: b)
            }
        }
        if preons == nil {
            ctx.stroke(Path(ellipseIn: f.circle(StarDial.scaleOuter + 0.008)), with: .color(Theme.line2.opacity(0.75)), lineWidth: 0.5)
            ctx.stroke(minor, with: .color(Theme.levelColor(8, opacity: 0.2)), lineWidth: 0.6 * u)
            ctx.stroke(major, with: .color(Theme.levelColor(7, opacity: 0.4)), style: StrokeStyle(lineWidth: 1.0 * u, lineCap: .round))
        } else {
            ctx.stroke(minor, with: .color(Theme.levelColor(8, opacity: 0.75)), lineWidth: 0.7 * u)
            ctx.stroke(major, with: .color(Theme.levelColor(7, opacity: 0.9)), style: StrokeStyle(lineWidth: 1.1 * u, lineCap: .round))
        }
    }

    // MARK: - Once a Helion

    /// What changes once a Helion: the sync's drawn chords (the running Pentad's bright, the earlier ones dimmer), the
    /// running Pentad's figure, the rim's Pentad points and, in Earth mode, the civil hours (`midnight` turns).
    static func helion(_ ctx: inout GraphicsContext, _ f: StarFrame, helion k: Int, pentad p: Int, midnight: Double?) {
        let u = f.unit
        // the running Pentad's figure, faintly filled: its Helions' starts and the next Pentad's
        var figure = Path()
        for (i, j) in StarGeometry.figure(ofPentad: p).enumerated() {
            let q = f.point(StarGeometry.vertexPoint(j, radius: StarDial.starRadius))
            if i == 0 { figure.move(to: q) } else { figure.addLine(to: q) }
        }
        figure.closeSubpath()
        ctx.fill(figure, with: .color(Theme.gold.opacity(p == 3 ? 0.03 : 0.018)))

        // the sync so far: the running Pentad's chords glow
        let own = StarGeometry.helions(ofPentad: p).filter { $0 < k }
        if !own.isEmpty {
            ctx.drawLayer { layer in
                layer.addFilter(.blur(radius: 3.5 * u))
                for c in own { strokeChord(&layer, f, c, shading: .color(Theme.gold.opacity(0.75)), width: 3 * u) }
            }
        }
        for c in 0..<k {
            let mine = StarGeometry.pentad(ofHelion: c) == p
            strokeChord(&ctx, f, c, shading: .color(Theme.gold.opacity(mine ? 0.95 : 0.42)), width: (mine ? 1.35 : 0.9) * u)
        }

        rimPoints(&ctx, f, pentad: p, helion: k)
        if let midnight { hours(&ctx, f, midnight: midnight) }
    }

    /// The 19 rim points as the Pentads' shapes: around the day they run I II III ◻ … — each point is where a Helion of
    /// that Pentad begins. The running Pentad's points are filled; the Hypopentad's squares stand out a little always.
    private static func rimPoints(_ ctx: inout GraphicsContext, _ f: StarFrame, pentad p: Int, helion k: Int) {
        let u = f.unit
        let running = StarGeometry.vertex(ofBoundary: k)
        for j in 0..<StarGeometry.points {
            let q = StarGeometry.pentad(ofVertex: j)
            let side = f.radius * (q == 3 ? 0.056 : 0.052) * (q == p ? 1.1 : 1)
            let c = f.point(StarGeometry.vertexPoint(j, radius: StarDial.starRadius))
            let rect = CGRect(x: c.x - side / 2, y: c.y - side / 2, width: side, height: side)
            // standing on the rim, the pentagon's point (the square's side) outward
            let turn = 2 * Double.pi * StarGeometry.turns(ofVertex: j)
            let spin = CGAffineTransform(translationX: c.x, y: c.y).rotated(by: turn).translatedBy(x: -c.x, y: -c.y)
            let shape = PentadPolygon(sides: q == 3 ? 4 : 5).path(in: rect).applying(spin)
            ctx.fill(shape, with: .color(Theme.Star.plateEdge))
            if q == p {
                if j == running {
                    ctx.fill(f.disc(c, side * 0.95), with: .radialGradient(Gradient(colors: [Theme.gold.opacity(0.45), Theme.gold.opacity(0)]),
                                                                             center: c, startRadius: 0, endRadius: side * 0.95))
                }
                ctx.fill(shape, with: .color(Theme.gold))
            } else {
                ctx.stroke(shape, with: .color(Theme.gold.opacity(q == 3 ? 0.7 : 0.45)),
                           style: StrokeStyle(lineWidth: (q == 3 ? 1.0 : 0.8) * u, lineJoin: .round))
            }
        }
    }

    /// The civil hours (Earth mode): a dot each hour, the numeral every third, where the Sun will stand at them.
    private static func hours(_ ctx: inout GraphicsContext, _ f: StarFrame, midnight: Double) {
        let u = f.unit
        let size = max(7, f.radius * 0.046)
        for h in 0..<24 {
            let turns = midnight + Double(h) / 24
            let p = f.point(turns: turns, radius: StarDial.hours)
            if h % 3 == 0 {
                let label = Text(verbatim: String(h))
                    .font(.system(size: size, weight: .medium).monospacedDigit())
                    .foregroundStyle(Theme.ink3)
                ctx.draw(label, at: p, anchor: .center)
            } else {
                ctx.fill(f.disc(p, 0.9 * u), with: .color(Theme.ink3.opacity(0.5)))
            }
        }
    }

    // MARK: - What moves

    /// The running chord drawn up to the pen, the pen, the Sun on the rim and its daylight, the Preons completed on the
    /// Helion's scale, the rose drawn so far with its arms (a disc where one turns too fast to see), and the Flavon's
    /// orbit as a ring while a time-lapse blurs its spark.
    static func motion(_ ctx: inout GraphicsContext, _ f: StarFrame, _ m: StarMotion) {
        let u = f.unit
        let gold = Theme.gold
        let fast = StarMotion.blurSpin

        // the running chord, drawn as far as the Helion has gone
        let hypo = StarGeometry.pentad(ofHelion: m.helion) == 3
        strokeChord(&ctx, f, m.helion, upTo: m.phase, shading: .color(gold.opacity(hypo ? 0.16 : 0.22)), width: (hypo ? 3.2 : 5) * u)
        strokeChord(&ctx, f, m.helion, upTo: m.phase, shading: .color(gold), width: 1.7 * u)
        let pen = f.point(StarGeometry.pen(helion: m.helion, phase: m.phase, radius: StarDial.starRadius))
        glow(&ctx, at: pen, radius: 10 * u, color: gold, opacity: 0.55)
        ctx.fill(f.disc(pen, 2.1 * u), with: .color(Theme.Star.penCore))

        // the Sun, on the rim at the time of day
        let sunTurns = StarGeometry.sunTurns(helion: m.helion, phase: m.phase)
        let sun = f.point(turns: sunTurns, radius: StarDial.starRadius)
        // its daylight across the plate
        ctx.fill(Path(ellipseIn: f.circle(StarDial.bezel)),
                 with: .radialGradient(Gradient(colors: [Theme.Star.sunCore.opacity(0.05), Theme.Star.sunCore.opacity(0.012), Theme.Star.sunCore.opacity(0)]),
                                       center: sun, startRadius: 0, endRadius: f.radius * 1.15))
        glow(&ctx, at: sun, radius: f.radius * 0.13, color: gold, opacity: 0.32)
        ctx.fill(f.disc(sun, f.radius * 0.03), with: .radialGradient(Gradient(colors: [Theme.Star.sunCore, gold]), center: sun,
                                                                       startRadius: 0, endRadius: f.radius * 0.03))
        ctx.stroke(f.disc(sun, f.radius * 0.03 + 1.4 * u), with: .color(gold.opacity(0.5)), lineWidth: 0.6 * u)

        // the Preons completed on the Helion's scale, and the rose so far
        helionScale(&ctx, f, upTo: min(35, Int((m.phase * 36).rounded(.down))))
        let trace = rose(f, upTo: m.rosePhase)
        ctx.stroke(trace, with: .color(Theme.Star.rose(opacity: 0.1)), style: StrokeStyle(lineWidth: 3 * u, lineCap: .round, lineJoin: .round))
        ctx.stroke(trace, with: .color(Theme.Star.rose(opacity: 0.78)), style: StrokeStyle(lineWidth: 0.9 * u, lineCap: .round, lineJoin: .round))

        // the arms: η, θ, ι, each carried at the tip of the one before
        let joints = StarRose.joints(m.rosePhase).map(f.point)
        let widths: [CGFloat] = [2.4, 1.8, 1.3]
        var blurred = false
        for i in 0..<3 {
            let level = 6 + i
            let color = Theme.levelColor(level, lightness: 0.7)
            if blurred { break }
            if m.spin(StarRose.relative[i]) > fast {
                // turning faster than the eye follows: the arm is a disc, and what it carries a blur within it
                let r = StarRose.radii[i] * f.radius
                let rest = StarRose.radii[(i + 1)...].reduce(0, +) * f.radius
                // the arm sweeps a faint disc, what it carries the ring of its reach
                ctx.fill(f.disc(joints[i], r), with: .color(Theme.levelColor(level, opacity: 0.035)))
                var reach = f.disc(joints[i], r + rest)
                if r > rest { reach.addPath(f.disc(joints[i], r - rest)) }
                ctx.fill(reach, with: .color(Theme.levelColor(level, opacity: 0.07)), style: FillStyle(eoFill: true))
                ctx.stroke(f.disc(joints[i], r), with: .color(Theme.levelColor(level, opacity: 0.35)), lineWidth: widths[i] * 0.6 * u)
                blurred = true
                continue
            }
            var arm = Path()
            arm.move(to: joints[i])
            arm.addLine(to: joints[i + 1])
            ctx.stroke(arm, with: .color(.black.opacity(0.45)), style: StrokeStyle(lineWidth: (widths[i] + 1.4) * u, lineCap: .round))
            ctx.stroke(arm, with: .color(color), style: StrokeStyle(lineWidth: widths[i] * u, lineCap: .round))
            // a pivot where it carries the next
            if i > 0 {
                ctx.fill(f.disc(joints[i], (widths[i - 1] + 0.9) * u), with: .color(Theme.Star.plateEdge))
                ctx.stroke(f.disc(joints[i], (widths[i - 1] + 0.9) * u), with: .color(Theme.levelColor(level - 1, lightness: 0.7)), lineWidth: 0.9 * u)
            }
        }
        if !blurred {
            let tip = joints[3]
            glow(&ctx, at: tip, radius: 7 * u, color: Theme.Star.rose(), opacity: 0.6)
            ctx.fill(f.disc(tip, 1.9 * u), with: .color(Theme.Star.penCore))
            // the Flavon's orbit, blurred into a ring when the clock runs too fast to follow its spark (which
            // StarFace draws on its own, stepping once a Blink: `spark(_:size:orbit:blink:unit:)`)
            if m.spark && m.sparkBlurred {
                ctx.stroke(f.disc(tip, f.radius * StarDial.sparkOrbit), with: .color(Theme.levelColor(10, opacity: 0.4)), lineWidth: 1.1 * u)
            }
        }
    }

    /// The Flavon's spark on its orbit (of `orbit` points) around the rose's pen at the canvas's centre, `blink`
    /// (0 … 24) Blinks into the Flavon: it steps once a Blink, 25 to the turn.
    static func spark(_ ctx: inout GraphicsContext, size: CGSize, orbit: CGFloat, blink: Int, unit u: CGFloat) {
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        let ring = Path(ellipseIn: CGRect(x: c.x - orbit, y: c.y - orbit, width: 2 * orbit, height: 2 * orbit))
        ctx.stroke(ring, with: .color(Theme.levelColor(10, opacity: 0.16)), lineWidth: 0.5)
        let a = 2 * Double.pi * Double(blink) / 25
        let spark = CGPoint(x: c.x + orbit * sin(a), y: c.y - orbit * cos(a))
        glow(&ctx, at: spark, radius: 5 * u, color: Theme.levelColor(10), opacity: 0.7)
        let core = 1.6 * u
        ctx.fill(Path(ellipseIn: CGRect(x: spark.x - core, y: spark.y - core, width: 2 * core, height: 2 * core)),
                 with: .color(Theme.levelColor(10, lightness: 0.82)))
    }

    // MARK: - Parts

    /// Chord k of the sync from its start to `upTo` of its length; the Hypopentad's as a double rule.
    static func strokeChord(_ ctx: inout GraphicsContext, _ f: StarFrame, _ k: Int, upTo s: Double = 1,
                            shading: GraphicsContext.Shading, width: CGFloat) {
        let (j, _) = StarGeometry.chord(k)
        let a = f.point(StarGeometry.vertexPoint(j, radius: StarDial.starRadius))
        let b = f.point(StarGeometry.pen(helion: k, phase: s, radius: StarDial.starRadius))
        guard s > 0 else { return }
        var path = Path()
        if StarGeometry.pentad(ofHelion: k) == 3 {
            // the Hypopentad: two fine rules, as an engraver marks what closes the figure
            let dx = b.x - a.x, dy = b.y - a.y
            let length = max(hypot(dx, dy), 0.001)
            let gap = max(1.1, width * 0.9)
            let n = CGPoint(x: -dy / length * gap, y: dx / length * gap)
            for sign in [-1.0, 1.0] {
                path.move(to: CGPoint(x: a.x + sign * n.x, y: a.y + sign * n.y))
                path.addLine(to: CGPoint(x: b.x + sign * n.x, y: b.y + sign * n.y))
            }
            ctx.stroke(path, with: shading, style: StrokeStyle(lineWidth: width * 0.8, lineCap: .round))
        } else {
            path.move(to: a)
            path.addLine(to: b)
            ctx.stroke(path, with: shading, style: StrokeStyle(lineWidth: width, lineCap: .round))
        }
    }

    /// The rose from the Helion's start to `phase` (the whole figure at 1).
    static func rose(_ f: StarFrame, upTo phase: Double) -> Path {
        var path = Path()
        let samples = StarRose.samples
        let end = min(max(phase, 0), 1) * Double(StarRose.sampleCount)
        let whole = Int(end.rounded(.down))
        path.move(to: f.point(samples[0]))
        if whole >= 1 {
            for i in 1...whole { path.addLine(to: f.point(samples[i])) }
        }
        if Double(whole) < end { path.addLine(to: f.point(StarRose.pen(phase))) }
        return path
    }

    /// A soft round glow.
    static func glow(_ ctx: inout GraphicsContext, at p: CGPoint, radius: CGFloat, color: Color, opacity: Double) {
        let rect = CGRect(x: p.x - radius, y: p.y - radius, width: 2 * radius, height: 2 * radius)
        ctx.fill(Path(ellipseIn: rect), with: .radialGradient(Gradient(colors: [color.opacity(opacity), color.opacity(0)]),
                                                              center: p, startRadius: 0, endRadius: radius))
    }
}
