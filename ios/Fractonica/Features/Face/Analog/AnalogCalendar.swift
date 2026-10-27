import FractonicaKit
import SwiftUI

/// What changes once a Helion (the face redraws it then, never per frame): the Pentads on the 77-Helion ring, the Pentad
/// register's lit pips and badges, the Helion window's number.
struct AnalogCalendar: View, Equatable {
    let size: CGSize
    /// The Helion it shows: the parts of `AnalogReading` that change once a Helion.
    let state: State

    struct State: Equatable, Sendable {
        let eta: Int
        let pentad: Int
        let syncHelion: Int
        let nuclideFirst: Int

        init(_ r: AnalogReading) {
            eta = r.eta
            pentad = r.pentad
            syncHelion = r.syncHelion
            nuclideFirst = r.nuclideFirstInSync
        }
    }

    typealias P = AnalogPaint
    typealias G = AnalogGeometry
    typealias A = Theme.Analog

    var body: some View {
        Canvas { ctx, size in
            let g = AnalogGeometry(size: size)
            guard g.radius > 4 else { return }
            drawRing(&ctx, g)
            drawRegister(&ctx, g)
            drawWindow(&ctx, g)
        }
        .frame(width: size.width, height: size.height)
    }

    // MARK: The ring's Pentads

    /// Each Pentad's stretch of the ring as a gold track, the Hypopentads broad, the running one bright; where a Pentad
    /// starts, its mark: a pentagon (I–III), the Hypopentad's square filled and larger.
    private func drawRing(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius, c = g.center
        let n = Double(AnalogDial.helionsPerNuclide)
        let rr = R * G.ringPentads
        let slot = state.eta - 1
        let arcs = AnalogDial.ringArcs(first: state.nuclideFirst)
        for arc in arcs {
            let running = arc.from <= slot && slot < arc.to
            let hypo = arc.pentad == 3
            let from = (Double(arc.from) + (arc.begins ? 0.32 : 0)) / n
            let to = (Double(arc.to) - (arc.to < AnalogDial.helionsPerNuclide ? 0.32 : 0)) / n
            let path = P.arc(c, rr, from: from, to: to)
            let width = g.line(hypo ? 0.017 : 0.006, minimum: hypo ? 1.6 : 0.8)
            let opacity = running ? 1 : hypo ? 0.7 : 0.4
            if running {
                ctx.drawLayer { glow in
                    glow.addFilter(.blur(radius: R * 0.008))
                    glow.stroke(path, with: .color(Theme.gold.opacity(0.6)), style: StrokeStyle(lineWidth: width * 1.6, lineCap: .butt))
                }
            }
            ctx.stroke(path, with: .color(Theme.gold.opacity(opacity)), style: StrokeStyle(lineWidth: width, lineCap: .butt))
        }
        // the starts
        for arc in arcs where arc.begins {
            let turn = Double(arc.from) / n
            let p = g.polar(turn, G.ringPentads)
            let hypo = arc.pentad == 3
            let s = R * (hypo ? 0.036 : 0.034)
            let box = CGRect(x: p.x - s / 2, y: p.y - s / 2, width: s, height: s)
            let shape = PentadPolygon(index: arc.pentad).path(in: box)
            let running = arc.from <= slot && slot < arc.to
            ctx.fill(shape, with: .color(A.flangeDark))
            if hypo {
                ctx.fill(shape, with: .color(Theme.gold.opacity(running ? 1 : 0.9)))
            } else {
                ctx.stroke(shape, with: .color(Theme.gold.opacity(running ? 1 : 0.75)),
                           style: StrokeStyle(lineWidth: g.line(0.0045, minimum: 0.7), lineJoin: .round))
            }
        }
    }

    // MARK: The Pentad register

    /// The running Pentad's pips lit (those passed half, the running one full), its badge filled; the other badges
    /// outlined, the Hypopentad's always in gold.
    private func drawRegister(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let disc = G.pentadRegister
        let n = Double(AnalogDial.helionsPerSync)
        let first = AnalogDial.pentadFirst[state.pentad]
        let count = AnalogDial.pentadHelions[state.pentad]
        for k in 0..<AnalogDial.helionsPerSync {
            let p = g.point(G.polar((Double(k) + 0.5) / n, AnalogPentadLayout.pip * disc.radius, around: disc.center))
            let inRunning = k >= first && k < first + count
            let dot = P.circle(p, R * 0.0095)
            if k == state.syncHelion {
                ctx.drawLayer { glow in
                    glow.addFilter(.blur(radius: R * 0.01))
                    glow.fill(P.circle(p, R * 0.014), with: .color(Theme.gold.opacity(0.8)))
                }
                ctx.fill(P.circle(p, R * 0.0115), with: .color(Theme.gold))
            } else if inRunning && k < state.syncHelion {
                ctx.fill(dot, with: .color(Theme.gold.opacity(0.55)))
            } else if inRunning {
                ctx.stroke(dot, with: .color(Theme.gold.opacity(0.85)), lineWidth: g.line(0.0035, minimum: 0.6))
            } else {
                ctx.fill(dot, with: .color(A.steelMid.opacity(0.55)))
            }
        }
        for i in 0..<4 {
            let mid = (Double(AnalogDial.pentadFirst[i]) + Double(AnalogDial.pentadHelions[i]) / 2) / n
            let p = g.point(G.polar(mid, AnalogPentadLayout.badge * disc.radius, around: disc.center))
            let running = i == state.pentad
            let hypo = i == 3
            let s = R * disc.radius * AnalogPentadLayout.badgeSize * (hypo ? 1.06 : 1)
            let box = CGRect(x: p.x - s / 2, y: p.y - s / 2, width: s, height: s)
            let shape = PentadPolygon(index: i).path(in: box)
            if running {
                ctx.drawLayer { glow in
                    glow.addFilter(.blur(radius: R * 0.012))
                    glow.fill(shape, with: .color(Theme.gold.opacity(0.55)))
                }
                ctx.fill(shape, with: .linearGradient(Gradient(colors: [A.goldLight, Theme.gold, A.goldDeep]),
                                                      startPoint: CGPoint(x: box.minX, y: box.minY),
                                                      endPoint: CGPoint(x: box.maxX, y: box.maxY)))
            } else if hypo {
                ctx.stroke(shape, with: .color(Theme.gold.opacity(0.8)),
                           style: StrokeStyle(lineWidth: g.line(0.007, minimum: 1), lineJoin: .round))
            } else {
                ctx.stroke(shape, with: .color(A.printDim),
                           style: StrokeStyle(lineWidth: g.line(0.0045, minimum: 0.7), lineJoin: .round))
            }
            let numeral = Notation.pentadNumerals[i]
            if !numeral.isEmpty {
                let color = running ? Theme.background : A.printDim
                P.text(&ctx, numeral, at: CGPoint(x: p.x, y: p.y + s * 0.07), size: s * (i == 2 ? 0.3 : 0.36), weight: .bold,
                       color: color, condensed: false, design: .serif)
            }
        }
    }

    // MARK: The Helion window

    private func drawWindow(_ ctx: inout GraphicsContext, _ g: G) {
        let R = g.radius
        let w = G.window
        let p = g.point(CGPoint(x: w.midX, y: w.midY))
        // a ticker: the reading face, its digits all one width
        let number = ctx.resolve(Text(verbatim: String(state.eta)).font(.reading(R * 0.088, weight: .semibold))
            .foregroundStyle(A.windowInk))
        ctx.draw(number, at: CGPoint(x: p.x, y: p.y + R * 0.003), anchor: .center)
    }
}

