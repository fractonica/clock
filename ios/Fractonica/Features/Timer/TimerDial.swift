import SwiftUI

/// The countdown dial: an outer teal ring draining with the whole timer, and inside it one ring of ticks per unit of
/// the readout, coarse outside to fine inside. Each ring has as many ticks as the unit has in the next one up (77η in
/// an ε, 36ι in an η, 65λ in an ι, 25ν in a λ), with longer ticks at the depth between (ζ, θ, κ, μ); the lit ticks
/// are the count left, so "02ι 13λ 07ν" lights 2, 13 and 7, and the tick being used up fades as it goes.
struct TimerDial: View {
    /// What is left of the whole timer, 1 … 0.
    let fraction: Double
    /// Blinks left; nil outside the catalogue (the tick rings go dark).
    let blinks: Double?
    /// The readout's units, coarse to fine.
    let units: [LadderUnit]
    var paused = false
    /// Whole ticks only (no fading tick).
    var reduceMotion = false

    /// The radius inside the innermost ring, as a fraction of half the dial, for laying out the readout.
    static func innerRadius(rings: Int) -> CGFloat {
        rings >= 4 ? 0.58 : 0.62
    }

    var body: some View {
        Canvas { context, size in
            draw(in: &context, size: size)
        }
        .accessibilityHidden(true)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let s = min(size.width, size.height)
        guard s > 20 else { return }
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        let unit = s / 320
        let ringRadius = s / 2 - 6 * unit
        let ringWidth = 5 * unit
        if paused { context.opacity = 0.62 }

        // the whole timer
        context.stroke(circle(c, ringRadius), with: .color(Theme.line), lineWidth: ringWidth)
        let f = min(1, max(0, fraction))
        if f > 0 {
            let end = Angle.degrees(-90 + 360 * f)
            var arc = Path()
            arc.addArc(center: c, radius: ringRadius, startAngle: .degrees(-90), endAngle: end, clockwise: false)
            let style = StrokeStyle(lineWidth: ringWidth, lineCap: .round)
            context.drawLayer { glow in
                glow.addFilter(.shadow(color: Theme.teal.opacity(0.55), radius: 7 * unit))
                glow.stroke(arc, with: .color(Theme.teal), style: style)
            }
            let head = point(c, ringRadius, end)
            context.fill(circle(head, ringWidth * 0.62), with: .color(Theme.ink))
        }

        // one ring of ticks per unit
        let outer = ringRadius - 13 * unit
        let inner = s / 2 * Self.innerRadius(rings: units.count) + 4 * unit
        let pitch = (outer - inner) / CGFloat(max(1, units.count))
        for (i, u) in units.enumerated() {
            let r = outer - pitch * CGFloat(i)
            drawRing(u, radius: r, length: pitch * 0.6, unit: unit, center: c, in: &context)
        }
    }

    private func drawRing(_ u: LadderUnit, radius r: CGFloat, length: CGFloat, unit: CGFloat, center c: CGPoint, in context: inout GraphicsContext) {
        let n = u.perParent
        let color = Theme.levelColor(u.level)
        // the count left of this unit inside the next one up, with its fraction
        var value = 0.0
        if let blinks, blinks > 0 {
            let x = blinks / Double(u.blinks)
            value = u == .eta ? min(Double(n), x) : x.truncatingRemainder(dividingBy: Double(n))
            if reduceMotion { value = value.rounded(.up) }
        }
        let whole = Int(value.rounded(.down))
        let part = value - Double(whole)

        var dark = Path(), darkMajor = Path(), lit = Path(), litMajor = Path()
        var fading: (Path, Bool)?
        // lit ticks run their full length; the rest of the ring is a quiet track of dots, a dash at each group
        let mid = r - length / 2
        for k in 0..<n {
            let major = k % u.group == 0
            let a = Angle.degrees(-90 + 360 * (Double(k) + 0.5) / Double(n))
            let len = major ? length : length * 0.72
            var tick = Path()
            tick.move(to: point(c, mid + len / 2, a))
            tick.addLine(to: point(c, mid - len / 2, a))
            if k < whole {
                if major { litMajor.addPath(tick) } else { lit.addPath(tick) }
            } else {
                let short = major ? length * 0.3 : 0.01
                var mark = Path()
                mark.move(to: point(c, mid + short / 2, a))
                mark.addLine(to: point(c, mid - short / 2, a))
                if major { darkMajor.addPath(mark) } else { dark.addPath(mark) }
                if k == whole && part > 0.001 { fading = (tick, major) }
            }
        }
        let thin = StrokeStyle(lineWidth: 1.7 * unit, lineCap: .round)
        let bold = StrokeStyle(lineWidth: 2.5 * unit, lineCap: .round)
        context.stroke(dark, with: .color(Theme.line2.opacity(0.9)), style: StrokeStyle(lineWidth: 1.9 * unit, lineCap: .round))
        context.stroke(darkMajor, with: .color(Theme.ink3.opacity(0.5)), style: thin)
        context.stroke(lit, with: .color(color.opacity(0.85)), style: thin)
        context.stroke(litMajor, with: .color(color), style: bold)
        if let (tick, major) = fading {
            context.stroke(tick, with: .color(color.opacity(0.12 + 0.73 * part)), style: major ? bold : thin)
        }
    }

    private func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    }

    private func point(_ c: CGPoint, _ r: CGFloat, _ a: Angle) -> CGPoint {
        CGPoint(x: c.x + r * CGFloat(cos(a.radians)), y: c.y + r * CGFloat(sin(a.radians)))
    }
}
