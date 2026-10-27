import SwiftUI

/// The light the dial is drawn under: from the upper left, as a watch photographed under a window.
enum AnalogLight {
    /// Towards the light (unit vector, y down).
    static let toLight = CGVector(dx: -0.5, dy: -0.866)

    /// How lit a surface is whose outward normal points at `turn` (0 up, clockwise): 0 … 1.
    static func brightness(normal turn: Double, contrast: Double = 1) -> Double {
        let a = 2 * Double.pi * turn
        let d = sin(a) * Double(toLight.dx) - cos(a) * Double(toLight.dy)
        return min(1, max(0, 0.5 + 0.5 * d * contrast))
    }

    /// A shadow's offset on screen for a part `height` points above the dial.
    static func shadow(_ height: CGFloat) -> CGSize {
        CGSize(width: -toLight.dx * height, height: -toLight.dy * height)
    }

    /// The same offset in the frame of a part turned by `turn` (its drawing is rotated by that much on screen).
    static func shadow(_ height: CGFloat, turnedBy turn: Double) -> CGSize {
        let s = shadow(height)
        let a = 2 * Double.pi * turn
        let c = CGFloat(cos(a)), n = CGFloat(sin(a))
        return CGSize(width: s.width * c + s.height * n, height: -s.width * n + s.height * c)
    }
}

/// Path and drawing helpers shared by the dial's layers.
enum AnalogPaint {
    static func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    }

    /// An annulus (fill it with `eoFill`).
    static func ring(_ c: CGPoint, _ r0: CGFloat, _ r1: CGFloat) -> Path {
        var p = circle(c, r1)
        p.addPath(circle(c, r0))
        return p
    }

    static let eo = FillStyle(eoFill: true, antialiased: true)

    /// An arc along a circle between two turns (0 up, clockwise).
    static func arc(_ c: CGPoint, _ r: CGFloat, from t0: Double, to t1: Double) -> Path {
        var p = Path()
        p.addArc(center: c, radius: r, startAngle: .radians(2 * .pi * t0 - .pi / 2),
                 endAngle: .radians(2 * .pi * t1 - .pi / 2), clockwise: false)
        return p
    }

    /// A radial segment: from `r0` to `r1` at `turn` around `c` (points).
    static func radial(_ c: CGPoint, _ turn: Double, _ r0: CGFloat, _ r1: CGFloat) -> Path {
        let a = 2 * Double.pi * turn
        let dx = CGFloat(sin(a)), dy = CGFloat(-cos(a))
        var p = Path()
        p.move(to: CGPoint(x: c.x + dx * r0, y: c.y + dy * r0))
        p.addLine(to: CGPoint(x: c.x + dx * r1, y: c.y + dy * r1))
        return p
    }

    /// A polygon from points.
    static func polygon(_ points: [CGPoint]) -> Path {
        var p = Path()
        p.addLines(points)
        p.closeSubpath()
        return p
    }

    /// A shadow cast into a recess (a dial under its flange, a register, an aperture): dark along the edge facing
    /// the light, fading inward.
    static func innerShadow(_ ctx: inout GraphicsContext, _ shape: Path, around c: CGPoint, outer: CGFloat, depth: CGFloat,
                            opacity: Double = 0.85) {
        ctx.drawLayer { clipped in
            clipped.clip(to: shape)
            clipped.drawLayer { layer in
                let off = AnalogLight.shadow(depth)
                layer.addFilter(.shadow(color: .black.opacity(opacity), radius: depth * 1.1, x: off.width, y: off.height))
                var outside = circle(c, outer * 3)
                outside.addPath(shape)
                layer.fill(outside, with: .color(.black), style: eo)
            }
        }
    }

    /// The opposite rim of a recess catches the light: a thin bright crescent on the side away from it.
    static func rimLight(_ ctx: inout GraphicsContext, center c: CGPoint, radius r: CGFloat, width: CGFloat, opacity: Double) {
        let lit = Gradient(stops: [
            .init(color: .white.opacity(0), location: 0),
            .init(color: .white.opacity(opacity), location: 0.12),
            .init(color: .white.opacity(0), location: 0.3),
            .init(color: .white.opacity(0), location: 1),
        ])
        // the brightest point faces the light from the far side: down and to the right (turn ≈ 0.42)
        ctx.stroke(circle(c, r - width / 2), with: .conicGradient(lit, center: c, angle: .degrees(0)), lineWidth: width)
    }

    /// A polished ring (a bezel, a register's applied ring, the aperture's rim): conic reflections.
    static func polishedRing(_ ctx: inout GraphicsContext, center c: CGPoint, r0: CGFloat, r1: CGFloat, steel: Bool = true) {
        func color(_ b: Double) -> Color { steel ? Theme.Analog.steel(b) : Theme.Analog.gold(b) }
        // conic angle 0 is 3 o'clock, clockwise: highlights at 10:30 and 4:30, darks at 1:30 and 7:30
        let stops: [(Double, Double)] = [(0, 0.5), (0.125, 0.72), (0.25, 0.45), (0.375, 0.12), (0.5, 0.45),
                                         (0.625, 0.95), (0.75, 0.6), (0.875, 0.15), (1, 0.5)]
        let gradient = Gradient(stops: stops.map { Gradient.Stop(color: color($0.1), location: $0.0) })
        ctx.fill(ring(c, r0, r1), with: .conicGradient(gradient, center: c, angle: .zero), style: eo)
    }

    /// Text set at a point (centred), in a context.
    static func text(_ ctx: inout GraphicsContext, _ s: String, at p: CGPoint, size: CGFloat, weight: Font.Weight = .medium,
                     color: Color, condensed: Bool = true, design: Font.Design = .default, tracking: CGFloat = 0) {
        var font = Font.system(size: size, weight: weight, design: design)
        if condensed { font = font.width(.condensed) }
        let resolved = ctx.resolve(Text(verbatim: s).font(font).tracking(tracking).foregroundStyle(color))
        ctx.draw(resolved, at: p, anchor: .center)
    }
}
