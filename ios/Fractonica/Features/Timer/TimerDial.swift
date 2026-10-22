import SwiftUI

/// The countdown dial: an outer teal ring draining with the whole timer, and inside it one segmented phase ring per
/// unit of the readout, coarse outside to fine inside. A ring has a segment per unit in the next one up (77η in an ε,
/// 36ι in an η, 65λ in an ι, 25ν in a λ), with a wider gap at each depth between (ζ = 11η, θ = 4ι, κ = 13λ, μ = 5ν);
/// the lit segments are the count left, so "02ι 13λ 07ν" lights 2, 13 and 7, and the segment being used up shrinks
/// as it goes. The finest ring turns once per its parent (a Blink ring empties every Flavon), the coarse ones crawl.
struct TimerDial: View {
    /// What is left of the whole timer, 1 … 0.
    let fraction: Double
    /// Blinks left; nil outside the catalogue (the phase rings go dark).
    let blinks: Double?
    /// The readout's units, coarse to fine.
    let units: [LadderUnit]
    var paused = false
    /// Whole segments only (nothing shrinks continuously).
    var reduceMotion = false

    /// The radius inside the innermost ring, as a fraction of half the dial, for laying out the readout.
    static func innerRadius(rings: Int) -> CGFloat {
        TimerDialGeometry.innerRadius(rings: rings)
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
        let geometry = TimerDialGeometry(rings: units.count, side: s)
        if paused { context.opacity = 0.6 }

        // the whole timer
        let ringRadius = geometry.outerRadius
        let ringWidth = geometry.outerWidth
        context.stroke(circle(c, ringRadius), with: .color(Theme.line), lineWidth: ringWidth)
        let f = min(1, max(0, fraction))
        if f > 0 {
            let end = Angle.degrees(-90 + 360 * f)
            var arc = Path()
            arc.addArc(center: c, radius: ringRadius, startAngle: .degrees(-90), endAngle: end, clockwise: false)
            let style = StrokeStyle(lineWidth: ringWidth, lineCap: .round)
            context.drawLayer { glow in
                glow.addFilter(.shadow(color: Theme.teal.opacity(paused ? 0.25 : 0.55), radius: 7 * unit))
                glow.stroke(arc, with: .color(Theme.teal), style: style)
            }
            context.fill(circle(point(c, ringRadius, end), ringWidth * 0.62), with: .color(Theme.ink))
        }

        // one phase ring per unit
        for (i, u) in units.enumerated() {
            drawRing(u, radius: geometry.ringRadius(i), width: geometry.ringWidth, center: c, in: &context)
        }
    }

    private func drawRing(_ u: LadderUnit, radius r: CGFloat, width: CGFloat, center c: CGPoint, in context: inout GraphicsContext) {
        let n = u.perParent
        let color = Theme.levelColor(u.level)
        let value = TimerDialGeometry.ringValue(blinks: blinks, unit: u, whole: reduceMotion)
        let whole = Int(value.rounded(.down))
        let part = value - Double(whole)

        // gaps as arc lengths, so every ring has the same rhythm whatever its count
        let gap = Double(max(2.2, width * 0.42) / r)
        let groupGap = gap * 2.4
        let step = 2 * Double.pi / Double(n)
        var track = Path(), lit = Path(), partial = Path()
        for k in 0..<n {
            let leading = k % u.group == 0 ? groupGap : gap
            let trailing = (k + 1) % u.group == 0 || k + 1 == n ? groupGap : gap
            let a0 = -Double.pi / 2 + Double(k) * step + leading / 2
            let a1 = -Double.pi / 2 + Double(k + 1) * step - trailing / 2
            guard a1 > a0 else { continue }
            // each segment a filled band sector, its own closed subpath (stroked arcs in one path join up)
            if k < whole {
                sector(&lit, c, r, width, a0, a1)
            } else {
                sector(&track, c, r, width, a0, a1)
                if k == whole && part > 0.002 { sector(&partial, c, r, width, a0, a0 + (a1 - a0) * part) }
            }
        }
        context.fill(track, with: .color(Theme.line.opacity(0.8)))
        context.fill(lit, with: .color(color.opacity(0.9)))
        context.fill(partial, with: .color(color.opacity(0.7)))
    }

    /// The band `width` wide around radius `r` from angle `a0` to `a1` (radians, clockwise on screen).
    private func sector(_ path: inout Path, _ c: CGPoint, _ r: CGFloat, _ width: CGFloat, _ a0: Double, _ a1: Double) {
        let ro = r + width / 2, ri = r - width / 2
        path.move(to: point(c, ro, .radians(a0)))
        path.addArc(center: c, radius: ro, startAngle: .radians(a0), endAngle: .radians(a1), clockwise: false)
        path.addLine(to: point(c, ri, .radians(a1)))
        path.addArc(center: c, radius: ri, startAngle: .radians(a1), endAngle: .radians(a0), clockwise: true)
        path.closeSubpath()
    }

    private func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    }

    private func point(_ c: CGPoint, _ r: CGFloat, _ a: Angle) -> CGPoint {
        CGPoint(x: c.x + r * CGFloat(cos(a.radians)), y: c.y + r * CGFloat(sin(a.radians)))
    }
}
