import SwiftUI

/// The dial's hands, each a still drawing turned on screen: a tick only changes their angles. A hand is redrawn when its
/// angle passes into another 64th of a turn, which is when the light on its facets and the direction of its shadow
/// have visibly moved.
enum AnalogHandKind: Equatable, Sendable {
    /// The Nuclide's rider: a pointer in the Nuclide's colour on the bezel's inner edge, at the 77-Helion ring.
    case nuclide
    /// The Helion: a polished dauphine with a luminous inlay in the Helion's colour.
    case helion
    /// The Preon: a long, thin needle to the Flavon railway, tipped in the Preon's colour, a ring counterweight.
    case preon
    /// The Flavon register's needle, tipped in the Flavon's colour.
    case flavon
    /// The Pentad register's needle, in gold.
    case pentad

    /// Tip and tail, in units of the case radius (the rider: its back, and nothing behind the pivot).
    var length: CGFloat {
        switch self {
        case .nuclide: AnalogGeometry.riderBack
        case .helion: AnalogGeometry.helionHand
        case .preon: AnalogGeometry.preonHand
        case .flavon: AnalogGeometry.flavonRegister.radius * AnalogGeometry.registerHand
        case .pentad: AnalogGeometry.pentadRegister.radius * (AnalogGeometry.registerHand - 0.04)
        }
    }

    var tail: CGFloat {
        switch self {
        case .nuclide: 0
        case .helion: AnalogGeometry.helionTail
        case .preon: AnalogGeometry.preonTail
        case .flavon: AnalogGeometry.flavonRegister.radius * AnalogGeometry.registerTail
        case .pentad: AnalogGeometry.pentadRegister.radius * AnalogGeometry.registerTail
        }
    }

    /// How high above the dial it rides (its shadow's offset), in units.
    var height: CGFloat {
        switch self {
        case .nuclide: 0.006
        case .helion: 0.024
        case .preon: 0.03
        case .flavon, .pentad: 0.009
        }
    }
}

struct AnalogHand: View, Equatable {
    let kind: AnalogHandKind
    /// The case radius in points.
    let unit: CGFloat
    /// The hand's angle in `shades`ths of a turn.
    let shade: Int

    static let shades = 64

    /// The shade of a hand at `turn`.
    static func shade(_ turn: Double) -> Int {
        let s = Int((turn * Double(shades)).rounded()) % shades
        return s < 0 ? s + shades : s
    }

    /// From the pivot to the farthest thing drawn, shadow included, in points.
    var reach: CGFloat { unit * (max(kind.length, kind.tail) + 0.06) }

    var body: some View {
        Canvas { ctx, size in
            draw(&ctx, pivot: CGPoint(x: size.width / 2, y: size.height / 2))
        }
        .frame(width: 2 * reach, height: 2 * reach)
    }

    typealias A = Theme.Analog
    typealias P = AnalogPaint

    private var turn: Double { Double(shade) / Double(Self.shades) }

    private func draw(_ ctx: inout GraphicsContext, pivot o: CGPoint) {
        let u = unit
        // facets either side of the hand's ridge: the left faces turn − ¼, the right turn + ¼
        let lb = AnalogLight.brightness(normal: turn - 0.25)
        let rb = AnalogLight.brightness(normal: turn + 0.25)
        let off = AnalogLight.shadow(u * kind.height, turnedBy: turn)
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: o.x + x * u, y: o.y + y * u) }
        let outline = self.outline(pt)
        ctx.drawLayer { layer in
            layer.addFilter(.shadow(color: .black.opacity(0.7), radius: u * kind.height * 0.9, x: off.width, y: off.height))
            layer.fill(outline, with: .color(A.steelDark))
        }
        switch kind {
        case .nuclide: drawRider(&ctx, pt, lb, rb)
        case .helion: drawHelion(&ctx, pt, lb, rb)
        case .preon: drawPreon(&ctx, pt, lb, rb)
        case .flavon: drawNeedle(&ctx, pt, lb, rb, metal: { A.steel($0) }, tip: Theme.levelColor(10))
        case .pentad: drawNeedle(&ctx, pt, lb, rb, metal: { A.gold($0) }, tip: nil)
        }
        // the cap of a register hand, its highlight towards the light
        if kind == .flavon || kind == .pentad {
            let r = u * 0.017
            let pentad = kind == .pentad
            let metal = { (b: Double) -> Color in pentad ? A.gold(b) : A.steel(b) }
            let hl = AnalogLight.shadow(-r * 0.45, turnedBy: turn)
            ctx.fill(P.circle(o, r), with: .radialGradient(Gradient(colors: [metal(1), metal(0.55), metal(0.15)]),
                                                         center: CGPoint(x: o.x + hl.width, y: o.y + hl.height),
                                                         startRadius: 0, endRadius: r * 1.5))
            ctx.fill(P.circle(o, r * 0.32), with: .color(.black.opacity(0.55)))
        }
    }

    /// The silhouette, for the shadow.
    private func outline(_ pt: (CGFloat, CGFloat) -> CGPoint) -> Path {
        switch kind {
        case .helion:
            var p = helionBlade(pt, side: 0)
            p.addPath(P.circle(pt(0, 0.135), unit * 0.026))
            p.addPath(P.polygon([pt(-0.011, 0), pt(-0.011, 0.13), pt(0.011, 0.13), pt(0.011, 0)]))
            return p
        case .nuclide:
            return rider(pt)
        case .preon:
            var p = preonStem(pt, side: 0)
            p.addPath(P.circle(pt(0, kind.tail - 0.02), unit * 0.03))
            return p
        case .flavon, .pentad:
            var p = needle(pt, side: 0)
            p.addPath(P.circle(pt(0, kind.tail * 0.72), unit * 0.014))
            return p
        }
    }

    // MARK: The Helion hand

    /// A dauphine blade: `side` −1 its left facet, +1 its right, 0 both.
    private func helionBlade(_ pt: (CGFloat, CGFloat) -> CGPoint, side: Int) -> Path {
        let tip = -kind.length
        let shoulder: CGFloat = -0.11, w: CGFloat = 0.036, base: CGFloat = 0.024
        switch side {
        case -1: return P.polygon([pt(0, tip), pt(-w, shoulder), pt(-base, 0.01), pt(0, 0.01)])
        case 1: return P.polygon([pt(0, tip), pt(0, 0.01), pt(base, 0.01), pt(w, shoulder)])
        default: return P.polygon([pt(0, tip), pt(-w, shoulder), pt(-base, 0.01), pt(base, 0.01), pt(w, shoulder)])
        }
    }

    private func drawHelion(_ ctx: inout GraphicsContext, _ pt: (CGFloat, CGFloat) -> CGPoint, _ lb: Double, _ rb: Double) {
        let tip = -kind.length
        // the counterweight: a short bar and a disc
        let bar = P.polygon([pt(-0.011, 0), pt(-0.011, 0.13), pt(0.011, 0.13), pt(0.011, 0)])
        ctx.fill(bar, with: .linearGradient(Gradient(colors: [A.steel(lb), A.steel(rb)]), startPoint: pt(-0.011, 0), endPoint: pt(0.011, 0)))
        let disc = P.circle(pt(0, 0.135), unit * 0.026)
        ctx.fill(disc, with: .linearGradient(Gradient(colors: [A.steel(0.2 + lb * 0.8), A.steel(rb * 0.8)]),
                                             startPoint: pt(-0.026, 0.135), endPoint: pt(0.026, 0.135)))
        ctx.fill(P.circle(pt(0, 0.135), unit * 0.013), with: .color(A.steelDeep.opacity(0.85)))
        // the facets, lit along their length as the blade narrows to its point
        let left = helionBlade(pt, side: -1), right = helionBlade(pt, side: 1)
        ctx.fill(left, with: .linearGradient(Gradient(colors: [A.steel(min(1, lb * 1.1 + 0.05)), A.steel(lb * 0.8)]),
                                             startPoint: pt(0, 0), endPoint: pt(0, tip)))
        ctx.fill(right, with: .linearGradient(Gradient(colors: [A.steel(min(1, rb * 1.1 + 0.05)), A.steel(rb * 0.8)]),
                                              startPoint: pt(0, 0), endPoint: pt(0, tip)))
        // the luminous inlay along the ridge, in the Helion's colour
        let lume = P.polygon([pt(0, tip + 0.13), pt(-0.011, -0.2), pt(-0.008, -0.13), pt(0.008, -0.13), pt(0.011, -0.2)])
        ctx.fill(lume, with: .color(Theme.levelColor(6, lightness: 0.6)))
        ctx.stroke(lume, with: .color(.black.opacity(0.45)), lineWidth: max(0.4, unit * 0.002))
        // the ridge catches the light
        var ridge = Path()
        ridge.move(to: pt(0, tip + 0.13))
        ridge.addLine(to: pt(0, tip))
        ctx.stroke(ridge, with: .color(.white.opacity(0.55)), lineWidth: max(0.4, unit * 0.0025))
        ctx.stroke(helionBlade(pt, side: 0), with: .color(.black.opacity(0.35)), lineWidth: max(0.3, unit * 0.002))
    }

    // MARK: The Nuclide's rider

    /// A pointed shoe on the bezel's inner edge, its point at the ring's ticks.
    private func rider(_ pt: (CGFloat, CGFloat) -> CGPoint) -> Path {
        let w = AnalogGeometry.riderWidth / 2
        return P.polygon([pt(0, -AnalogGeometry.riderTip), pt(-w, -AnalogGeometry.riderBack), pt(w, -AnalogGeometry.riderBack)])
    }

    private func drawRider(_ ctx: inout GraphicsContext, _ pt: (CGFloat, CGFloat) -> CGPoint, _ lb: Double, _ rb: Double) {
        let tip = -AnalogGeometry.riderTip, back = -AnalogGeometry.riderBack
        let w = AnalogGeometry.riderWidth / 2
        let epsilon = Theme.levelColor(4)
        // two facets in the Nuclide's colour either side of a ridge, polished edges
        let halfL = P.polygon([pt(0, tip), pt(-w, back), pt(0, back)])
        let halfR = P.polygon([pt(0, tip), pt(0, back), pt(w, back)])
        ctx.fill(halfL, with: .color(epsilon.mix(with: .white, by: 0.25 * lb).mix(with: .black, by: 0.25 * (1 - lb))))
        ctx.fill(halfR, with: .color(epsilon.mix(with: .white, by: 0.25 * rb).mix(with: .black, by: 0.25 * (1 - rb))))
        ctx.stroke(rider(pt), with: .color(A.steel(0.8)), style: StrokeStyle(lineWidth: max(0.5, unit * 0.003), lineJoin: .round))
    }

    // MARK: The Preon hand

    /// The long needle from its counterweight to its point: `side` −1 its left facet, +1 its right, 0 both.
    private func preonStem(_ pt: (CGFloat, CGFloat) -> CGPoint, side: Int) -> Path {
        let tip = -kind.length, tailEnd = kind.tail - 0.02
        let w: CGFloat = 0.0062, w1: CGFloat = 0.0016
        switch side {
        case -1: return P.polygon([pt(0, tip), pt(-w1, tip + 0.012), pt(-w, tailEnd), pt(0, tailEnd)])
        case 1: return P.polygon([pt(0, tip), pt(0, tailEnd), pt(w, tailEnd), pt(w1, tip + 0.012)])
        default: return P.polygon([pt(0, tip), pt(-w1, tip + 0.012), pt(-w, tailEnd), pt(w, tailEnd), pt(w1, tip + 0.012)])
        }
    }

    private func drawPreon(_ ctx: inout GraphicsContext, _ pt: (CGFloat, CGFloat) -> CGPoint, _ lb: Double, _ rb: Double) {
        let tailEnd = kind.tail - 0.02
        ctx.fill(preonStem(pt, side: -1), with: .color(A.steel(0.25 + lb * 0.75)))
        ctx.fill(preonStem(pt, side: 1), with: .color(A.steel(0.25 + rb * 0.75)))
        // the point's last stretch in the Preon's colour, where it meets the railway
        ctx.drawLayer { layer in
            layer.clip(to: preonStem(pt, side: 0))
            let from = -kind.length + 0.11
            layer.fill(Path(CGRect(x: pt(-0.02, 0).x, y: pt(0, -kind.length - 0.01).y, width: unit * 0.04,
                                   height: (from + kind.length + 0.01) * unit)), with: .color(Theme.levelColor(8)))
        }
        // the ring counterweight
        let ring = P.ring(pt(0, tailEnd), unit * 0.019, unit * 0.03)
        ctx.fill(ring, with: .linearGradient(Gradient(colors: [A.steel(0.15 + lb * 0.85), A.steel(rb * 0.7)]),
                                             startPoint: pt(-0.03, tailEnd), endPoint: pt(0.03, tailEnd)), style: P.eo)
    }

    // MARK: Register needles

    private func needle(_ pt: (CGFloat, CGFloat) -> CGPoint, side: Int) -> Path {
        let tip = -kind.length, tail = kind.tail * 0.72
        let w: CGFloat = 0.0075, w1: CGFloat = 0.0016
        switch side {
        case -1: return P.polygon([pt(0, tip), pt(-w1, tip + 0.01), pt(-w, 0), pt(-w * 0.8, tail), pt(0, tail)])
        case 1: return P.polygon([pt(0, tip), pt(0, tail), pt(w * 0.8, tail), pt(w, 0), pt(w1, tip + 0.01)])
        default: return P.polygon([pt(0, tip), pt(-w1, tip + 0.01), pt(-w, 0), pt(-w * 0.8, tail), pt(w * 0.8, tail), pt(w, 0), pt(w1, tip + 0.01)])
        }
    }

    private func drawNeedle(_ ctx: inout GraphicsContext, _ pt: (CGFloat, CGFloat) -> CGPoint, _ lb: Double, _ rb: Double,
                            metal: (Double) -> Color, tip: Color?) {
        let tail = kind.tail * 0.72
        ctx.fill(needle(pt, side: -1), with: .color(metal(0.1 + lb * 0.9)))
        ctx.fill(needle(pt, side: 1), with: .color(metal(0.1 + rb * 0.9)))
        let weight = P.circle(pt(0, tail), unit * 0.014)
        ctx.fill(weight, with: .linearGradient(Gradient(colors: [metal(0.2 + lb * 0.8), metal(rb * 0.7)]),
                                               startPoint: pt(-0.014, tail), endPoint: pt(0.014, tail)))
        if let tip {
            // the last third of the needle in the cycle's colour
            ctx.drawLayer { layer in
                layer.clip(to: needle(pt, side: 0))
                let from = -kind.length * 0.62
                layer.fill(Path(CGRect(x: pt(-0.02, 0).x, y: pt(0, -kind.length - 0.01).y, width: unit * 0.04,
                                       height: (from + kind.length + 0.01) * unit)), with: .color(tip))
            }
        }
    }
}

/// A hand turning too fast to see (a time-lapse): a faint disc of its sweep, its tip's colour trailing round the rim.
struct AnalogHandBlur: View, Equatable {
    let kind: AnalogHandKind
    let unit: CGFloat

    /// The colour its tip leaves: the cycle's, or the Pentads' gold.
    private var tip: Color {
        switch kind {
        case .nuclide: Theme.levelColor(4)
        case .helion: Theme.levelColor(6)
        case .preon: Theme.levelColor(8)
        case .flavon: Theme.levelColor(10)
        case .pentad: Theme.gold
        }
    }

    var body: some View {
        let r = unit * kind.length
        let metal = kind == .pentad ? Theme.gold : Theme.Analog.steelLight
        ZStack {
            if kind == .nuclide {
                // the rider runs round the bezel: only its band blurs
                Circle()
                    .strokeBorder(tip.opacity(0.3), lineWidth: unit * (AnalogGeometry.riderBack - AnalogGeometry.riderTip))
                    .blur(radius: unit * 0.006)
            } else {
                Circle()
                    .fill(RadialGradient(colors: [metal.opacity(0.26), metal.opacity(0.12), metal.opacity(0.04)],
                                         center: .center, startRadius: 0, endRadius: r))
                Circle()
                    .strokeBorder(tip.opacity(0.24), lineWidth: max(1, r * 0.24))
                    .blur(radius: r * 0.04)
            }
        }
        .frame(width: 2 * r, height: 2 * r)
    }
}

/// The main hands' polished, domed pinion cap (still: its highlight stays towards the light).
struct AnalogPinion: View, Equatable {
    let size: CGSize

    var body: some View {
        Canvas { ctx, size in
            let g = AnalogGeometry(size: size)
            guard g.radius > 4 else { return }
            let c = g.center, r = g.length(0.036)
            ctx.drawLayer { layer in
                let off = AnalogLight.shadow(g.length(0.02))
                layer.addFilter(.shadow(color: .black.opacity(0.6), radius: g.length(0.015), x: off.width, y: off.height))
                layer.fill(AnalogPaint.circle(c, r), with: .color(Theme.Analog.steelDark))
            }
            ctx.fill(AnalogPaint.circle(c, r), with: .radialGradient(
                Gradient(colors: [Theme.Analog.steel(1), Theme.Analog.steel(0.7), Theme.Analog.steel(0.3), Theme.Analog.steel(0.1)]),
                center: CGPoint(x: c.x - r * 0.35, y: c.y - r * 0.45), startRadius: 0, endRadius: r * 1.5))
            ctx.stroke(AnalogPaint.circle(c, r * 0.55), with: .color(.black.opacity(0.25)), lineWidth: g.line(0.003, minimum: 0.4))
            // the jewel-like screw head at the heart
            ctx.fill(AnalogPaint.circle(c, r * 0.3), with: .radialGradient(
                Gradient(colors: [Theme.Analog.rubyLight, Theme.Analog.ruby, Theme.Analog.ruby.mix(with: .black, by: 0.5)]),
                center: CGPoint(x: c.x - r * 0.1, y: c.y - r * 0.12), startRadius: 0, endRadius: r * 0.36))
        }
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(false)
    }
}

/// The hands at a reading, each on its pivot, and the main hands' cap; a hand turning faster than the eye can follow is
/// its blur.
struct AnalogHands: View {
    let size: CGSize
    let reading: AnalogReading
    let blurred: Set<AnalogHandKind>

    var body: some View {
        let g = AnalogGeometry(size: size)
        ZStack {
            hand(.pentad, turn: reading.syncAngle, at: g.point(AnalogGeometry.pentadRegister.center), g)
            hand(.flavon, turn: reading.flavonAngle, at: g.point(AnalogGeometry.flavonRegister.center), g)
            hand(.nuclide, turn: reading.nuclideAngle, at: g.center, g)
            hand(.helion, turn: reading.helionAngle, at: g.center, g)
            hand(.preon, turn: reading.preonAngle, at: g.center, g)
            AnalogPinion(size: size).equatable()
        }
        .frame(width: size.width, height: size.height)
    }

    @ViewBuilder
    private func hand(_ kind: AnalogHandKind, turn: Double, at p: CGPoint, _ g: AnalogGeometry) -> some View {
        if blurred.contains(kind) {
            AnalogHandBlur(kind: kind, unit: g.radius).equatable().position(p)
        } else {
            AnalogHand(kind: kind, unit: g.radius, shade: AnalogHand.shade(turn))
                .equatable()
                .rotationEffect(.degrees(turn * 360))
                .position(p)
        }
    }
}
