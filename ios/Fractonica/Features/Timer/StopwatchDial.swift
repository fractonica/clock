import SwiftUI

/// The stopwatch as an analog dial on the ladder: the long hand sweeps once per Flavon over 25 Blinks (longer marks at
/// every μ = 5ν, hairlines at every ξ, a seventh of a Blink); the upper sub-dial turns once per Preon over its 65
/// Flavons (κ marks every 13), the lower once per Helion over its 36 Preons (θ marks every 4). A thin second hand
/// shows the running lap.
struct StopwatchDial: View {
    /// Blinks elapsed.
    let elapsed: Double
    /// Blinks into the running lap, once there are laps.
    var lap: Double?
    /// The hands step per Blink instead of sweeping.
    var reduceMotion = false

    var body: some View {
        // the face is drawn once (its marks and numerals do not move); only the hands redraw with the time
        ZStack {
            StopwatchDialFace()
            Canvas { context, size in
                drawHands(in: &context, size: size)
            }
        }
        .accessibilityHidden(true)
    }

    private func drawHands(in context: inout GraphicsContext, size: CGSize) {
        let s = min(size.width, size.height)
        guard s > 40 else { return }
        let g = StopwatchDialFace.Layout(size: size)
        let c = g.center, u = g.unit, r = g.radius
        let e = reduceMotion ? elapsed.rounded(.down) : elapsed

        subHand(center: g.upper, radius: g.subRadius, turn: e / Double(LadderUnit.iota.blinks), u: u, in: &context)
        subHand(center: g.lower, radius: g.subRadius, turn: e / Double(LadderUnit.eta.blinks), u: u, in: &context)

        // the lap hand
        if let lap {
            let l = reduceMotion ? lap.rounded(.down) : lap
            let a = angle(l / 25)
            var hand = Path()
            hand.move(to: c)
            hand.addLine(to: point(c, r - 14 * u, a))
            context.stroke(hand, with: .color(Theme.cursor.opacity(0.85)), style: StrokeStyle(lineWidth: 1.4 * u, lineCap: .round))
        }

        // the Flavon hand, with a soft glow drawn as wider faint strokes (a shadow filter would render offscreen
        // every frame)
        let a = angle(e / 25)
        var hand = Path()
        hand.move(to: point(c, 20 * u, a + .degrees(180)))
        hand.addLine(to: point(c, r - 8 * u, a))
        context.stroke(hand, with: .color(Theme.teal.opacity(0.1)), style: StrokeStyle(lineWidth: 9 * u, lineCap: .round))
        context.stroke(hand, with: .color(Theme.teal.opacity(0.18)), style: StrokeStyle(lineWidth: 5 * u, lineCap: .round))
        context.stroke(hand, with: .color(Theme.teal), style: StrokeStyle(lineWidth: 2.2 * u, lineCap: .round))
        context.fill(circle(c, 5.5 * u), with: .color(Theme.teal))
        context.fill(circle(c, 2 * u), with: .color(Theme.background))
    }

    private func subHand(center c: CGPoint, radius r: CGFloat, turn: Double, u: CGFloat, in context: inout GraphicsContext) {
        let a = angle(turn.truncatingRemainder(dividingBy: 1))
        var hand = Path()
        hand.move(to: c)
        hand.addLine(to: point(c, r - 6 * u, a))
        context.stroke(hand, with: .color(Theme.ink), style: StrokeStyle(lineWidth: 1.5 * u, lineCap: .round))
        context.fill(circle(c, 2.4 * u), with: .color(Theme.ink))
    }

    private func angle(_ turn: Double) -> Angle { StopwatchDialFace.angle(turn) }
    private func circle(_ c: CGPoint, _ r: CGFloat) -> Path { StopwatchDialFace.circle(c, r) }
    private func point(_ c: CGPoint, _ r: CGFloat, _ a: Angle) -> CGPoint { StopwatchDialFace.point(c, r, a) }
}

/// The stopwatch dial's still face: the marks, numerals and sub-dials, without hands.
struct StopwatchDialFace: View {
    /// Where everything goes in a dial of `size`.
    struct Layout {
        let center: CGPoint
        let unit: CGFloat
        let radius: CGFloat

        init(size: CGSize) {
            let s = min(size.width, size.height)
            center = CGPoint(x: size.width / 2, y: size.height / 2)
            unit = s / 320
            radius = s / 2 - 3 * unit
        }

        var subRadius: CGFloat { radius * 0.26 }
        /// The Preon sub-dial (a Preon of Flavons) above the centre, the Helion one (a Helion of Preons) below.
        var upper: CGPoint { CGPoint(x: center.x, y: center.y - radius * 0.4) }
        var lower: CGPoint { CGPoint(x: center.x, y: center.y + radius * 0.4) }
    }

    var body: some View {
        Canvas { context, size in
            draw(in: &context, size: size)
        }
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let s = min(size.width, size.height)
        guard s > 40 else { return }
        let g = Layout(size: size)
        let c = g.center, u = g.unit, r = g.radius

        // the face
        let face = circle(c, r)
        context.fill(face, with: .radialGradient(Gradient(colors: [Theme.panel2, Theme.background2]), center: c, startRadius: 0, endRadius: r))
        context.stroke(face, with: .color(Theme.line), lineWidth: 1)

        // ξ hairlines, ν marks, μ marks
        let nuColor = Theme.levelColor(LadderUnit.nu.level)
        var hair = Path(), nu = Path(), mu = Path()
        for k in 0..<175 {
            let a = angle(Double(k) / 175)
            if k % 35 == 0 {
                mu.move(to: point(c, r - 6 * u, a)); mu.addLine(to: point(c, r - 22 * u, a))
            } else if k % 7 == 0 {
                nu.move(to: point(c, r - 6 * u, a)); nu.addLine(to: point(c, r - 15 * u, a))
            } else {
                hair.move(to: point(c, r - 6 * u, a)); hair.addLine(to: point(c, r - 10 * u, a))
            }
        }
        context.stroke(hair, with: .color(Theme.ink3.opacity(0.45)), style: StrokeStyle(lineWidth: 0.8 * u, lineCap: .round))
        context.stroke(nu, with: .color(nuColor.opacity(0.8)), style: StrokeStyle(lineWidth: 1.6 * u, lineCap: .round))
        context.stroke(mu, with: .color(Theme.ink), style: StrokeStyle(lineWidth: 2.6 * u, lineCap: .round))
        for n in stride(from: 0, to: 25, by: 5) {
            let label = context.resolve(Text(verbatim: "\(n)").font(.reading(15 * u, weight: .medium)).foregroundStyle(Theme.ink2))
            context.draw(label, at: point(c, r - 36 * u, angle(Double(n) / 25)))
        }
        let unitLabel = context.resolve(Text(verbatim: "λ").font(.system(size: 13 * u, weight: .medium)).foregroundStyle(nuColor))
        context.draw(unitLabel, at: CGPoint(x: c.x + r * 0.42, y: c.y))

        subDial(center: g.upper, radius: g.subRadius, ticks: 65, group: 13, labels: [0, 13, 26, 39, 52],
                color: Theme.levelColor(LadderUnit.lambda.level), letter: "ι", u: u, in: &context)
        subDial(center: g.lower, radius: g.subRadius, ticks: 36, group: 4, labels: [0, 12, 24],
                color: Theme.levelColor(LadderUnit.iota.level), letter: "η", u: u, in: &context)
    }

    private func subDial(center c: CGPoint, radius r: CGFloat, ticks: Int, group: Int, labels: [Int], color: Color,
                         letter: String, u: CGFloat, in context: inout GraphicsContext) {
        context.fill(circle(c, r), with: .color(Theme.background.opacity(0.55)))
        context.stroke(circle(c, r), with: .color(Theme.line), lineWidth: 1)
        var minor = Path(), major = Path()
        for k in 0..<ticks {
            let a = angle(Double(k) / Double(ticks))
            if k % group == 0 {
                major.move(to: point(c, r - 2 * u, a)); major.addLine(to: point(c, r - 8 * u, a))
            } else {
                minor.move(to: point(c, r - 2 * u, a)); minor.addLine(to: point(c, r - 5 * u, a))
            }
        }
        context.stroke(minor, with: .color(color.opacity(0.55)), style: StrokeStyle(lineWidth: 0.9 * u, lineCap: .round))
        context.stroke(major, with: .color(color), style: StrokeStyle(lineWidth: 1.8 * u, lineCap: .round))
        for n in labels {
            let label = context.resolve(Text(verbatim: "\(n)").font(.reading(8.5 * u)).foregroundStyle(Theme.ink3))
            context.draw(label, at: point(c, r - 15 * u, angle(Double(n) / Double(ticks))))
        }
        let name = context.resolve(Text(verbatim: letter).font(.system(size: 11 * u, weight: .medium)).foregroundStyle(color))
        context.draw(name, at: CGPoint(x: c.x, y: c.y + r * 0.5))
    }

    private func angle(_ turn: Double) -> Angle { Self.angle(turn) }
    private func circle(_ c: CGPoint, _ r: CGFloat) -> Path { Self.circle(c, r) }
    private func point(_ c: CGPoint, _ r: CGFloat, _ a: Angle) -> CGPoint { Self.point(c, r, a) }

    /// A fraction of a turn, clockwise from the top.
    static func angle(_ turn: Double) -> Angle {
        .degrees(-90 + 360 * turn.truncatingRemainder(dividingBy: 1))
    }

    static func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    }

    static func point(_ c: CGPoint, _ r: CGFloat, _ a: Angle) -> CGPoint {
        CGPoint(x: c.x + r * CGFloat(cos(a.radians)), y: c.y + r * CGFloat(sin(a.radians)))
    }
}
