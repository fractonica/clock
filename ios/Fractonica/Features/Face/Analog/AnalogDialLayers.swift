import SwiftUI

// The still parts of the dial, each drawn once for a size (Equatable views around a Canvas, so a tick of the clock
// never redraws them): under the moving parts the case, chapter ring, sunray dial, railway, applied indices, the two
// registers' recesses and the aperture's movement plate; over them the aperture's rim and balance bridge and the
// Helion window's frame; on top of everything the crystal's glare.

/// Case, crown, chapter ring, dial, railway, indices, registers, the aperture's plate and the window's disc.
struct AnalogDialUnder: View, Equatable {
    let size: CGSize

    var body: some View {
        Canvas { ctx, size in
            let g = AnalogGeometry(size: size)
            guard g.radius > 4 else { return }
            AnalogDialUnder.drawCase(&ctx, g)
            AnalogDialUnder.drawFlange(&ctx, g)
            AnalogDialUnder.drawDial(&ctx, g)
            AnalogDialUnder.drawRailway(&ctx, g)
            AnalogDialUnder.drawPentadRegister(&ctx, g)
            AnalogDialUnder.drawPreonRegister(&ctx, g)
            AnalogDialUnder.drawAperture(&ctx, g)
            AnalogDialUnder.drawWindow(&ctx, g)
            AnalogDialUnder.drawIndices(&ctx, g)
            AnalogDialUnder.drawPrint(&ctx, g)
        }
        .frame(width: size.width, height: size.height)
    }

    typealias P = AnalogPaint
    typealias G = AnalogGeometry
    typealias A = Theme.Analog

    // MARK: Case

    static func drawCase(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius, c = g.center
        drawCrown(&ctx, g)
        // the case's shadow on the backdrop
        ctx.drawLayer { layer in
            let off = AnalogLight.shadow(R * 0.035)
            layer.addFilter(.shadow(color: .black.opacity(0.8), radius: R * 0.05, x: off.width, y: off.height))
            layer.fill(P.circle(c, R), with: .color(A.caseDark))
        }
        // the polished bezel, domed: conic reflections, darker towards both edges
        P.polishedRing(&ctx, center: c, r0: R * G.bezelInner, r1: R)
        let dome = Gradient(stops: [
            .init(color: .black.opacity(0.65), location: 0),
            .init(color: .black.opacity(0), location: 0.35),
            .init(color: .white.opacity(0.06), location: 0.55),
            .init(color: .black.opacity(0), location: 0.75),
            .init(color: .black.opacity(0.55), location: 1),
        ])
        ctx.fill(P.ring(c, R * G.bezelInner, R), with: .radialGradient(dome, center: c, startRadius: R * G.bezelInner, endRadius: R),
                 style: P.eo)
        ctx.stroke(P.circle(c, R - g.line(0.003) / 2), with: .color(.black.opacity(0.6)), lineWidth: g.line(0.004))
    }

    /// The crown at 3 o'clock: a knurled cylinder on its tube, lit from above.
    static func drawCrown(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius, c = g.center
        let half = (g.size.width / 2) - R // room beside the case
        guard half > R * 0.03 else { return }
        let length = min(half * 0.92, R * 0.075)
        let tube = CGRect(x: c.x + R * 0.97, y: c.y - R * 0.045, width: R * 0.05 + length * 0.2, height: R * 0.09)
        let crown = CGRect(x: c.x + R * 1.0 + length * 0.15, y: c.y - R * 0.085, width: length * 0.85, height: R * 0.17)
        let shaded = { (rect: CGRect) -> GraphicsContext.Shading in
            .linearGradient(Gradient(stops: [
                .init(color: A.steel(0.55), location: 0),
                .init(color: A.steel(0.95), location: 0.22),
                .init(color: A.steel(0.5), location: 0.5),
                .init(color: A.steel(0.12), location: 0.85),
                .init(color: A.steel(0.25), location: 1),
            ]), startPoint: CGPoint(x: rect.midX, y: rect.minY), endPoint: CGPoint(x: rect.midX, y: rect.maxY))
        }
        ctx.drawLayer { layer in
            let off = AnalogLight.shadow(R * 0.02)
            layer.addFilter(.shadow(color: .black.opacity(0.7), radius: R * 0.02, x: off.width, y: off.height))
            layer.fill(Path(roundedRect: tube, cornerRadius: R * 0.01), with: shaded(tube))
            layer.fill(Path(roundedRect: crown, cornerRadius: R * 0.02), with: shaded(crown))
        }
        // knurling along the crown's axis
        var knurl = Path()
        let n = 9
        for k in 1..<n {
            let y = crown.minY + crown.height * CGFloat(k) / CGFloat(n)
            knurl.move(to: CGPoint(x: crown.minX + R * 0.01, y: y))
            knurl.addLine(to: CGPoint(x: crown.maxX - R * 0.004, y: y))
        }
        ctx.stroke(knurl, with: .color(.black.opacity(0.45)), lineWidth: g.line(0.004))
        // the crown's end cap catches the light
        let cap = CGRect(x: crown.maxX - R * 0.012, y: crown.minY + R * 0.01, width: R * 0.01, height: crown.height - R * 0.02)
        ctx.fill(Path(roundedRect: cap, cornerRadius: R * 0.005), with: .color(.white.opacity(0.12)))
    }

    // MARK: Chapter ring (the Nuclide)

    static func drawFlange(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius, c = g.center
        let ring = P.ring(c, R * G.flangeInner, R * G.bezelInner)
        // a slope rising outward, lit from the upper left
        ctx.fill(ring, with: .linearGradient(Gradient(colors: [A.flangeLight, A.flangeDark]),
                                             startPoint: g.point(CGPoint(x: -0.7, y: -0.8)), endPoint: g.point(CGPoint(x: 0.7, y: 0.8))),
                 style: P.eo)
        ctx.fill(ring, with: .radialGradient(Gradient(colors: [.black.opacity(0.35), .clear, .white.opacity(0.03)]), center: c,
                                             startRadius: R * G.flangeInner, endRadius: R * G.bezelInner), style: P.eo)
        // the crystal's gasket against the bezel
        ctx.stroke(P.circle(c, R * G.bezelInner), with: .color(.black.opacity(0.7)), lineWidth: g.line(0.008))
        P.innerShadow(&ctx, P.circle(c, R * G.bezelInner), around: c, outer: R, depth: R * 0.012, opacity: 0.6)

        // 77 Helion ticks, one at the middle of each Helion's slot; the first of each ζ long and bright
        var minor = Path(), major = Path()
        for k in 0..<AnalogDial.helionsPerNuclide {
            let turn = (Double(k) + 0.5) / Double(AnalogDial.helionsPerNuclide)
            if k % AnalogDial.helionsPerZeta == 0 {
                major.addPath(P.radial(c, turn, R * G.ringTickMajor, R * G.ringTickOuter))
            } else {
                minor.addPath(P.radial(c, turn, R * G.ringTickInner, R * G.ringTickOuter))
            }
        }
        ctx.stroke(minor, with: .color(A.print.opacity(0.62)), style: StrokeStyle(lineWidth: g.line(0.0055, minimum: 0.6), lineCap: .butt))
        ctx.stroke(major, with: .color(A.print), style: StrokeStyle(lineWidth: g.line(0.013, minimum: 1), lineCap: .butt))
        // the 7 ζ numbered by their first Helion, under its tick
        for (z, number) in AnalogDial.zetaNumbers.enumerated() {
            let turn = (Double(z * AnalogDial.helionsPerZeta) + 0.5) / Double(AnalogDial.helionsPerNuclide)
            P.text(&ctx, String(number), at: g.polar(turn, G.ringNumbers), size: R * 0.056, weight: .semibold, color: A.print)
        }
        // the ring's name at its foot, between 34 and 45
        P.text(&ctx, "NUCLIDE", at: g.polar(0.5, G.ringNumbers + 0.004), size: R * 0.03, weight: .semibold,
               color: A.printDim, condensed: false, tracking: R * 0.006)
        // the Pentad track's bed, under the Pentads the calendar layer draws
        ctx.stroke(P.circle(c, R * G.ringPentads), with: .color(.black.opacity(0.35)), lineWidth: g.line(0.02))
    }

    // MARK: Dial

    static func drawDial(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius, c = g.center
        let rd = R * G.flangeInner
        let dial = P.circle(c, rd)
        ctx.fill(dial, with: .radialGradient(Gradient(colors: [A.dialCentre, A.dialCentre, A.dialEdge]), center: c,
                                             startRadius: 0, endRadius: rd))
        ctx.drawLayer { sun in
            sun.clip(to: dial)
            // sunray: the light lies along the brushing, a bow tie through the centre towards the light
            let sheen = Gradient(stops: [
                .init(color: A.dialSheen.opacity(0.10), location: 0),
                .init(color: A.dialSheen.opacity(0.55), location: 0.125),
                .init(color: A.dialSheen.opacity(0.08), location: 0.25),
                .init(color: A.dialSheen.opacity(0.0), location: 0.375),
                .init(color: A.dialSheen.opacity(0.10), location: 0.5),
                .init(color: A.dialSheen.opacity(0.62), location: 0.625),
                .init(color: A.dialSheen.opacity(0.08), location: 0.75),
                .init(color: A.dialSheen.opacity(0.0), location: 0.875),
                .init(color: A.dialSheen.opacity(0.10), location: 1),
            ])
            sun.fill(dial, with: .conicGradient(sheen, center: c, angle: .zero))
            // the brushing: fine radial lines, alternately catching and losing the light
            var light = Path(), dark = Path()
            let lines = 720
            for k in 0..<lines {
                let turn = Double(k) / Double(lines)
                let seg = P.radial(c, turn, R * 0.02, rd)
                // an irregular rhythm, like real brushing
                let v = (k * 7919) % 11
                if v < 4 { light.addPath(seg) } else if v > 7 { dark.addPath(seg) }
            }
            sun.stroke(light, with: .color(.white.opacity(0.035)), lineWidth: g.line(0.0025, minimum: 0.3))
            sun.stroke(dark, with: .color(.black.opacity(0.10)), lineWidth: g.line(0.0025, minimum: 0.3))
            // darker towards the rim, where the dial curves away
            sun.fill(dial, with: .radialGradient(Gradient(stops: [
                .init(color: .clear, location: 0.6),
                .init(color: .black.opacity(0.35), location: 1),
            ]), center: c, startRadius: 0, endRadius: rd))
        }
        // the flange's wall casts its shadow on the dial
        P.innerShadow(&ctx, dial, around: c, outer: rd, depth: R * 0.018, opacity: 0.9)
        P.rimLight(&ctx, center: c, radius: rd, width: g.line(0.006), opacity: 0.25)
    }

    // MARK: Railway (the Preons)

    static func drawRailway(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius, c = g.center
        let ink = A.print
        ctx.stroke(P.circle(c, R * G.railOuter), with: .color(ink.opacity(0.7)), lineWidth: g.line(0.004))
        ctx.stroke(P.circle(c, R * G.railInner), with: .color(ink.opacity(0.7)), lineWidth: g.line(0.004))
        var minor = Path(), major = Path()
        for k in 0..<AnalogDial.preonsPerHelion {
            let turn = Double(k) / Double(AnalogDial.preonsPerHelion)
            if k % AnalogDial.preonsPerTheta == 0 {
                major.addPath(P.radial(c, turn, R * (G.railInner - 0.01), R * (G.railOuter + 0.004)))
            } else {
                minor.addPath(P.radial(c, turn, R * G.railInner, R * G.railOuter))
            }
        }
        ctx.stroke(minor, with: .color(ink.opacity(0.8)), lineWidth: g.line(0.0055, minimum: 0.6))
        ctx.stroke(major, with: .color(ink), lineWidth: g.line(0.012, minimum: 1))
        // the θ numbers: Preons at each index
        for n in AnalogDial.thetaNumbers {
            let turn = Double(n) / Double(AnalogDial.preonsPerHelion)
            P.text(&ctx, String(n), at: g.polar(turn, G.thetaNumbers), size: R * 0.052, weight: .semibold, color: ink)
        }
        // the Helion's quarters: peak, node, valley, as small pointers in the Helion's colour
        let eta = Theme.levelColor(6)
        for q in AnalogDial.quarters {
            let a = 2 * Double.pi * q
            let across = CGPoint(x: CGFloat(cos(a)) * 0.011, y: CGFloat(sin(a)) * 0.011)
            let tip = G.polar(q, G.quarterMarks + 0.016)
            let base = G.polar(q, G.quarterMarks - 0.01)
            let tri = P.polygon([g.point(tip), g.point(CGPoint(x: base.x - across.x, y: base.y - across.y)),
                                 g.point(CGPoint(x: base.x + across.x, y: base.y + across.y))])
            ctx.fill(tri, with: .color(eta))
        }
    }

    // MARK: Applied indices (θ)

    /// The 9 θ indices; the top one double, shorter over the Pentad register.
    static func drawIndices(_ ctx: inout GraphicsContext, _ g: G) {
        for k in 0..<9 {
            let turn = Double(k) / 9
            if k == 0 {
                let w = G.indexWidth * 0.72
                let gap = G.indexWidth * 0.55
                for side in [-1.0, 1.0] {
                    let shift = (w + gap) / 2 * CGFloat(side)
                    baton(&ctx, g, turn: turn, inner: G.topIndexInner, outer: G.indexOuter, width: w, shift: shift)
                }
            } else {
                baton(&ctx, g, turn: turn, inner: G.indexInner, outer: G.indexOuter, width: G.indexWidth, shift: 0)
            }
        }
    }

    /// An applied baton: two polished facets either side of a ridge, a bevelled end, its shadow on the dial.
    static func baton(_ ctx: inout GraphicsContext, _ g: G, turn: Double, inner: CGFloat, outer: CGFloat, width: CGFloat,
                      shift: CGFloat) {
        let R = g.radius
        let a = 2 * Double.pi * turn
        let along = CGVector(dx: CGFloat(sin(a)), dy: CGFloat(-cos(a)))
        let across = CGVector(dx: CGFloat(cos(a)), dy: CGFloat(sin(a))) // to the right of the baton (seen pointing out)
        let base = CGPoint(x: g.center.x + across.dx * shift * R, y: g.center.y + across.dy * shift * R)
        func at(_ r: CGFloat, _ x: CGFloat) -> CGPoint {
            CGPoint(x: base.x + along.dx * r * R + across.dx * x * R, y: base.y + along.dy * r * R + across.dy * x * R)
        }
        let h = width / 2
        let bevel = width * 0.42
        let outline = P.polygon([at(inner, -h), at(outer - bevel, -h), at(outer, 0), at(outer - bevel, h), at(inner, h)])
        // its shadow
        ctx.drawLayer { layer in
            let off = AnalogLight.shadow(R * 0.009)
            layer.addFilter(.shadow(color: .black.opacity(0.85), radius: R * 0.009, x: off.width, y: off.height))
            layer.fill(outline, with: .color(A.steelDark))
        }
        // the facets: left of the ridge faces turn − ¼, right faces turn + ¼
        let left = P.polygon([at(inner, -h), at(outer - bevel, -h), at(outer, 0), at(inner, 0)])
        let right = P.polygon([at(inner, 0), at(outer, 0), at(outer - bevel, h), at(inner, h)])
        let lb = AnalogLight.brightness(normal: turn - 0.25)
        let rb = AnalogLight.brightness(normal: turn + 0.25)
        ctx.fill(left, with: .linearGradient(Gradient(colors: [A.steel(lb * 0.9 + 0.05), A.steel(lb * 0.75)]),
                                             startPoint: at(inner, 0), endPoint: at(outer, 0)))
        ctx.fill(right, with: .linearGradient(Gradient(colors: [A.steel(rb * 0.9 + 0.05), A.steel(rb * 0.75)]),
                                              startPoint: at(inner, 0), endPoint: at(outer, 0)))
        // the inner end's chamfer catches light when it faces it
        let eb = AnalogLight.brightness(normal: turn + 0.5)
        let end = P.polygon([at(inner, -h), at(inner, h), at(inner + width * 0.22, h * 0.6), at(inner + width * 0.22, -h * 0.6)])
        ctx.fill(end, with: .color(A.steel(eb).opacity(0.85)))
        // the ridge
        var ridge = Path()
        ridge.move(to: at(inner + width * 0.22, 0))
        ridge.addLine(to: at(outer, 0))
        ctx.stroke(ridge, with: .color(.white.opacity(0.35)), lineWidth: g.line(0.0025, minimum: 0.4))
        ctx.stroke(outline, with: .color(.black.opacity(0.35)), lineWidth: g.line(0.002, minimum: 0.3))
    }

    // MARK: Registers

    /// A recessed register: snailed (fine concentric grooves catching a sheen), its wall's shadow, an applied ring.
    static func recess(_ ctx: inout GraphicsContext, _ g: G, _ disc: G.Disc) {
        let R = g.radius
        let c = g.point(disc.center)
        let r = disc.radius * R
        let shape = P.circle(c, r)
        ctx.fill(shape, with: .color(A.register))
        ctx.drawLayer { snail in
            snail.clip(to: shape)
            let pitch = max(0.75, R * 0.0055)
            var light = Path(), dark = Path()
            var k = 0
            var rr = pitch
            while rr < r {
                if k % 2 == 0 { light.addPath(P.circle(c, rr)) } else { dark.addPath(P.circle(c, rr)) }
                rr += pitch
                k += 1
            }
            let sheen = Gradient(stops: [
                .init(color: A.registerSheen.opacity(0.15), location: 0),
                .init(color: A.registerSheen.opacity(0.75), location: 0.125),
                .init(color: A.registerSheen.opacity(0.1), location: 0.25),
                .init(color: A.registerSheen.opacity(0.0), location: 0.375),
                .init(color: A.registerSheen.opacity(0.15), location: 0.5),
                .init(color: A.registerSheen.opacity(0.85), location: 0.625),
                .init(color: A.registerSheen.opacity(0.1), location: 0.75),
                .init(color: A.registerSheen.opacity(0.0), location: 0.875),
                .init(color: A.registerSheen.opacity(0.15), location: 1),
            ])
            // the snailing's sheen runs across the light (a cross, unlike the sunray's bow tie)
            snail.stroke(light, with: .conicGradient(sheen, center: c, angle: .degrees(90)), lineWidth: pitch * 0.5)
            snail.stroke(dark, with: .color(.black.opacity(0.22)), lineWidth: pitch * 0.5)
        }
        P.innerShadow(&ctx, shape, around: c, outer: r, depth: R * 0.012, opacity: 0.95)
        P.rimLight(&ctx, center: c, radius: r, width: g.line(0.005), opacity: 0.22)
        P.polishedRing(&ctx, center: c, r0: r, r1: r + g.line(0.009))
    }

    /// The Pentad register: the sync's 19 Helions around it, Pentads parted by fine lines, the Hypopentad's stretch of
    /// rim in gold. The calendar layer lights the pips and the badges.
    static func drawPentadRegister(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let disc = G.pentadRegister
        recess(&ctx, g, disc)
        let c = g.point(disc.center)
        let r = disc.radius * R
        let n = Double(AnalogDial.helionsPerSync)
        // sockets for the 19 pips
        for k in 0..<AnalogDial.helionsPerSync {
            let p = AnalogGeometry.polar((Double(k) + 0.5) / n, AnalogPentadLayout.pip * disc.radius, around: disc.center)
            ctx.fill(P.circle(g.point(p), R * 0.0125), with: .color(.black.opacity(0.55)))
        }
        // the Pentads' borders
        var borders = Path()
        for first in AnalogDial.pentadFirst {
            borders.addPath(P.radial(c, Double(first) / n, r * 0.66, r * 0.94))
        }
        ctx.stroke(borders, with: .color(A.print.opacity(0.75)), lineWidth: g.line(0.005, minimum: 0.6))
        // each Pentad's stretch of rim: I–III fine, the Hypopentad broad and gold
        for (i, first) in AnalogDial.pentadFirst.enumerated() {
            let from = (Double(first) + 0.12) / n
            let to = (Double(first + AnalogDial.pentadHelions[i]) - 0.12) / n
            let arc = P.arc(c, r * 0.935, from: from, to: to)
            if i == 3 {
                ctx.stroke(arc, with: .color(Theme.gold.opacity(0.85)), style: StrokeStyle(lineWidth: g.line(0.016), lineCap: .butt))
            } else {
                ctx.stroke(arc, with: .color(Theme.gold.opacity(0.32)), style: StrokeStyle(lineWidth: g.line(0.005), lineCap: .butt))
            }
        }
    }

    /// The Preon register: 65 Flavon ticks, the 5 κ long, numbered in Flavons.
    static func drawPreonRegister(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let disc = G.preonRegister
        recess(&ctx, g, disc)
        let c = g.point(disc.center)
        let r = disc.radius * R
        var minor = Path(), major = Path()
        for k in 0..<AnalogDial.flavonsPerPreon {
            let turn = Double(k) / Double(AnalogDial.flavonsPerPreon)
            if k % AnalogDial.flavonsPerKappa == 0 {
                major.addPath(P.radial(c, turn, r * 0.72, r * 0.95))
            } else {
                minor.addPath(P.radial(c, turn, r * 0.84, r * 0.95))
            }
        }
        ctx.stroke(minor, with: .color(A.print.opacity(0.75)), lineWidth: g.line(0.0045, minimum: 0.5))
        ctx.stroke(major, with: .color(A.print), lineWidth: g.line(0.011, minimum: 1))
        for n in AnalogDial.kappaNumbers {
            let turn = Double(n) / Double(AnalogDial.flavonsPerPreon)
            let p = G.polar(turn, disc.radius * 0.54, around: disc.center)
            P.text(&ctx, String(n), at: g.point(p), size: R * 0.042, weight: .semibold, color: A.print)
        }
        // the unit it counts, in the Preon's colour
        P.text(&ctx, "ι", at: g.point(CGPoint(x: disc.center.x, y: disc.center.y + disc.radius * 0.3)), size: R * 0.05,
               weight: .medium, color: Theme.levelColor(8), condensed: false)
    }

    // MARK: Aperture (the movement under the dial)

    static func drawAperture(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let disc = G.aperture
        let c = g.point(disc.center)
        let r = disc.radius * R
        let hole = P.circle(c, r)
        ctx.fill(hole, with: .radialGradient(Gradient(colors: [A.plateLight, A.plate]), center: c, startRadius: 0, endRadius: r))
        ctx.drawLayer { plate in
            plate.clip(to: hole)
            // perlage: overlapping grained circles, each lighter at its heart
            let step = R * 0.04
            let spot = Gradient(stops: [
                .init(color: .white.opacity(0.16), location: 0),
                .init(color: .white.opacity(0.05), location: 0.55),
                .init(color: .black.opacity(0.18), location: 0.95),
                .init(color: .black.opacity(0), location: 1),
            ])
            var row = 0
            var y = c.y - r - step
            while y < c.y + r + step {
                var x = c.x - r - step + (row % 2 == 0 ? 0 : step / 2)
                while x < c.x + r + step {
                    let p = CGPoint(x: x, y: y)
                    plate.fill(P.circle(p, step * 0.62), with: .radialGradient(spot, center: p, startRadius: 0, endRadius: step * 0.62))
                    x += step
                }
                y += step * 0.75
                row += 1
            }
            // a wheel of the train, beyond the balance
            let wheel = CGPoint(x: c.x + r * 0.62, y: c.y + r * 0.62)
            let wr = r * 0.5
            plate.fill(P.ring(wheel, wr * 0.82, wr), with: .color(A.brassDark.opacity(0.9)), style: P.eo)
            var teeth = Path()
            for k in 0..<30 { teeth.addPath(P.radial(wheel, Double(k) / 30, wr, wr * 1.08)) }
            plate.stroke(teeth, with: .color(A.brassDark), lineWidth: g.line(0.006))
        }
        P.innerShadow(&ctx, hole, around: c, outer: r, depth: R * 0.016, opacity: 0.95)
    }

    // MARK: The Helion window

    static func drawWindow(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let w = G.window
        let rect = CGRect(x: g.center.x + w.minX * R, y: g.center.y + w.minY * R, width: w.width * R, height: w.height * R)
        let disc = rect.insetBy(dx: -R * 0.01, dy: -R * 0.01)
        // the disc under the dial: a lacquered wheel, its curve shading top and bottom
        ctx.fill(Path(disc), with: .linearGradient(Gradient(stops: [
            .init(color: A.windowDisc.mix(with: .black, by: 0.35), location: 0),
            .init(color: A.windowDisc, location: 0.3),
            .init(color: A.windowDisc, location: 0.7),
            .init(color: A.windowDisc.mix(with: .black, by: 0.3), location: 1),
        ]), startPoint: CGPoint(x: disc.midX, y: disc.minY), endPoint: CGPoint(x: disc.midX, y: disc.maxY)))
    }

    // MARK: Printing

    static func drawPrint(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        // the name, under the Pentad register
        P.text(&ctx, "FRACTONICA", at: g.point(CGPoint(x: 0, y: -0.135)), size: R * 0.04, weight: .semibold,
               color: A.print, condensed: false, tracking: R * 0.012)
        // what the hand reads, above the Preon register
        P.text(&ctx, "HELION", at: g.point(CGPoint(x: 0, y: 0.115)), size: R * 0.028, weight: .medium,
               color: A.printDim, condensed: false, tracking: R * 0.01)
        // the window's unit
        let w = G.window
        P.text(&ctx, "η", at: g.point(CGPoint(x: w.midX, y: w.maxY + 0.05)), size: R * 0.045, weight: .medium,
               color: Theme.levelColor(6), condensed: false)
    }
}

/// Over the moving parts: the aperture's polished rim and the balance bridge with its jewel, the window's frame.
struct AnalogDialOver: View, Equatable {
    let size: CGSize

    typealias P = AnalogPaint
    typealias G = AnalogGeometry
    typealias A = Theme.Analog

    var body: some View {
        Canvas { ctx, size in
            let g = AnalogGeometry(size: size)
            guard g.radius > 4 else { return }
            AnalogDialOver.drawCock(&ctx, g)
            AnalogDialOver.drawApertureRim(&ctx, g)
            AnalogDialOver.drawWindowFrame(&ctx, g)
        }
        .frame(width: size.width, height: size.height)
    }

    static func drawApertureRim(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let disc = G.aperture
        let c = g.point(disc.center)
        let r = disc.radius * R
        P.polishedRing(&ctx, center: c, r0: r, r1: r + g.line(0.014))
        ctx.stroke(P.circle(c, r + g.line(0.014)), with: .color(.black.opacity(0.5)), lineWidth: g.line(0.003))
    }

    /// The balance bridge: a brushed rhodium bar across the aperture on two screwed feet, swelling over the balance's
    /// staff into the gold chaton of its jewel.
    static func drawCock(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let disc = G.aperture
        let c = g.point(disc.center)
        let r = disc.radius * R
        let hole = P.circle(c, r)
        let turn = 0.69 // from the lower left to the upper right, a little off the horizontal
        let a = 2 * Double.pi * turn
        let along = CGVector(dx: CGFloat(sin(a)), dy: CGFloat(-cos(a)))
        let across = CGVector(dx: CGFloat(cos(a)), dy: CGFloat(sin(a)))
        func at(_ d: CGFloat, _ x: CGFloat) -> CGPoint {
            CGPoint(x: c.x + along.dx * d + across.dx * x, y: c.y + along.dy * d + across.dy * x)
        }
        let w = R * 0.052, boss = R * 0.04, span = r * 1.3
        let band = P.polygon([at(-span, -w / 2), at(span, -w / 2), at(span, w / 2), at(-span, w / 2)])
        let bridge = band.union(P.circle(c, boss))
        ctx.drawLayer { layer in
            layer.clip(to: hole)
            layer.drawLayer { shadowed in
                let off = AnalogLight.shadow(R * 0.014)
                shadowed.addFilter(.shadow(color: .black.opacity(0.8), radius: R * 0.012, x: off.width, y: off.height))
                shadowed.fill(bridge, with: .color(A.steelDark))
            }
            layer.drawLayer { top in
                top.clip(to: bridge)
                top.fill(bridge, with: .linearGradient(Gradient(colors: [A.steel(0.62), A.steel(0.42), A.steel(0.3)]),
                                                       startPoint: at(-span, -w), endPoint: at(span, w)))
                // Côtes de Genève: broad bands across the bar, alternately catching the light
                var bands = Path()
                var d: CGFloat = -span
                while d < span {
                    bands.move(to: at(d, -w))
                    bands.addLine(to: at(d + R * 0.012, w))
                    d += R * 0.022
                }
                top.stroke(bands, with: .color(.white.opacity(0.08)), lineWidth: R * 0.009)
                // the bevel: bright towards the light, dark away from it
                top.stroke(bridge, with: .linearGradient(Gradient(colors: [.white.opacity(0.45), .black.opacity(0.5)]),
                                                         startPoint: g.point(CGPoint(x: disc.center.x - disc.radius, y: disc.center.y - disc.radius)),
                                                         endPoint: g.point(CGPoint(x: disc.center.x + disc.radius, y: disc.center.y + disc.radius))),
                           lineWidth: g.line(0.008))
            }
            // the feet's screws (blued, slotted)
            for d in [-r * 0.74, r * 0.74] {
                let screw = at(d, 0)
                let sr = R * 0.016
                layer.fill(P.circle(screw, sr), with: .radialGradient(Gradient(colors: [A.blued.mix(with: .white, by: 0.25), A.blued, A.bluedDark]),
                                                                      center: CGPoint(x: screw.x - sr * 0.4, y: screw.y - sr * 0.4),
                                                                      startRadius: 0, endRadius: sr * 1.4))
                var slot = Path()
                slot.move(to: at(d - sr * 0.8, sr * 0.2))
                slot.addLine(to: at(d + sr * 0.8, -sr * 0.2))
                layer.stroke(slot, with: .color(.black.opacity(0.7)), lineWidth: sr * 0.32)
            }
            // the jewel in its gold chaton, over the balance staff
            layer.fill(P.circle(c, R * 0.022), with: .radialGradient(Gradient(colors: [A.goldLight, Theme.gold, A.goldDeep]),
                                                                    center: CGPoint(x: c.x - R * 0.008, y: c.y - R * 0.008),
                                                                    startRadius: 0, endRadius: R * 0.032))
            layer.fill(P.circle(c, R * 0.012), with: .radialGradient(Gradient(colors: [A.rubyLight, A.ruby, A.ruby.mix(with: .black, by: 0.5)]),
                                                                     center: CGPoint(x: c.x - R * 0.004, y: c.y - R * 0.004),
                                                                     startRadius: 0, endRadius: R * 0.014))
            layer.fill(P.circle(CGPoint(x: c.x - R * 0.004, y: c.y - R * 0.004), R * 0.003), with: .color(.white.opacity(0.8)))
        }
    }

    /// The window's bevelled frame: four facets, the upper and left ones towards the light.
    static func drawWindowFrame(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let w = G.window
        let inner = CGRect(x: g.center.x + w.minX * R, y: g.center.y + w.minY * R, width: w.width * R, height: w.height * R)
        let b = R * 0.014
        let outer = inner.insetBy(dx: -b, dy: -b)
        ctx.drawLayer { layer in
            let off = AnalogLight.shadow(R * 0.006)
            layer.addFilter(.shadow(color: .black.opacity(0.7), radius: R * 0.008, x: off.width, y: off.height))
            var frame = Path(outer)
            frame.addPath(Path(inner))
            layer.fill(frame, with: .color(A.steelMid), style: P.eo)
        }
        let facets: [(Path, Double)] = [
            (P.polygon([CGPoint(x: outer.minX, y: outer.minY), CGPoint(x: outer.maxX, y: outer.minY),
                        CGPoint(x: inner.maxX, y: inner.minY), CGPoint(x: inner.minX, y: inner.minY)]), 0.5),
            (P.polygon([CGPoint(x: outer.maxX, y: outer.minY), CGPoint(x: outer.maxX, y: outer.maxY),
                        CGPoint(x: inner.maxX, y: inner.maxY), CGPoint(x: inner.maxX, y: inner.minY)]), 0.75),
            (P.polygon([CGPoint(x: outer.maxX, y: outer.maxY), CGPoint(x: outer.minX, y: outer.maxY),
                        CGPoint(x: inner.minX, y: inner.maxY), CGPoint(x: inner.maxX, y: inner.maxY)]), 0.0),
            (P.polygon([CGPoint(x: outer.minX, y: outer.maxY), CGPoint(x: outer.minX, y: outer.minY),
                        CGPoint(x: inner.minX, y: inner.minY), CGPoint(x: inner.minX, y: inner.maxY)]), 0.25),
        ]
        // a bevel's facet faces inward and up: its normal is the opening's centre direction, reversed
        for (path, inward) in facets {
            ctx.fill(path, with: .color(A.steel(0.15 + 0.8 * AnalogLight.brightness(normal: inward))))
        }
        // the dial's edge casts a shadow into the opening
        ctx.drawLayer { layer in
            layer.clip(to: Path(inner))
            layer.fill(Path(CGRect(x: inner.minX, y: inner.minY, width: inner.width, height: R * 0.018)),
                       with: .linearGradient(Gradient(colors: [.black.opacity(0.45), .clear]),
                                             startPoint: CGPoint(x: inner.midX, y: inner.minY),
                                             endPoint: CGPoint(x: inner.midX, y: inner.minY + R * 0.018)))
            layer.fill(Path(CGRect(x: inner.minX, y: inner.minY, width: R * 0.012, height: inner.height)),
                       with: .linearGradient(Gradient(colors: [.black.opacity(0.3), .clear]),
                                             startPoint: CGPoint(x: inner.minX, y: inner.midY),
                                             endPoint: CGPoint(x: inner.minX + R * 0.012, y: inner.midY)))
        }
    }
}

/// The crystal over everything: a soft reflection of the window light and a bright arc along the upper left edge.
struct AnalogGlass: View, Equatable {
    let size: CGSize

    var body: some View {
        Canvas { ctx, size in
            let g = AnalogGeometry(size: size)
            guard g.radius > 4 else { return }
            let R = g.radius, c = g.center
            let crystal = AnalogPaint.circle(c, R * AnalogGeometry.bezelInner)
            ctx.drawLayer { glass in
                glass.clip(to: crystal)
                // a broad, faint reflection across the upper left
                var sweep = Path()
                sweep.addEllipse(in: CGRect(x: c.x - R * 1.35, y: c.y - R * 1.55, width: R * 2.0, height: R * 1.75))
                glass.fill(sweep, with: .linearGradient(Gradient(colors: [.white.opacity(0.07), .white.opacity(0.0)]),
                                                        startPoint: g.point(CGPoint(x: -0.6, y: -0.8)),
                                                        endPoint: g.point(CGPoint(x: 0.1, y: 0.05))))
                glass.addFilter(.blur(radius: R * 0.01))
                glass.stroke(AnalogPaint.arc(c, R * 0.915, from: 0.74, to: 0.9), with: .color(.white.opacity(0.16)),
                             style: StrokeStyle(lineWidth: R * 0.012, lineCap: .round))
            }
        }
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(false)
    }
}

/// Where the Pentad register's parts sit, in units of its radius.
enum AnalogPentadLayout {
    /// The 19 pips.
    static let pip: CGFloat = 0.8
    /// The four badges, at their Pentads' middles.
    static let badge: CGFloat = 0.43
    static let badgeSize: CGFloat = 0.36
}
