import FractonicaKit
import SwiftUI

/// Pendulums (Features/Face/Pendulums): a cascade from depth 12 up, each swinging twice a period, the slow ones blurred
/// along their way.
///
/// Twelve pendulums hang from one beam, μ (depth 12) on the left to α (depth 1) on the right, each as long as the
/// logarithm of its period (PendulumGeometry.swift). Each follows the swing law A · sin(2π · phase): right to its
/// extreme at the peak, back through the centre at the node, left at the valley, home at the end. A trail behind every
/// bob shows where it is heading and how fast — long through the centre, gone at the turning points — so the slow
/// pendulums, which barely move in real time, still read; the quick ones blur for real, and fan out over their whole
/// swing when a time-lapse outruns the display. The Helion's bob is the running Pentad's gold shape, and the Pentad
/// dial under the cascade shows the solar sync's 19 Helions in their Pentads, the running one filling as the Helion
/// pendulum swings.
///
/// Three layers: what stays (case, beam, arcs, the dial's face) drawn once; the slower pendulums and the dial a few
/// times a displayed second; κ λ μ in a canvas of their own corner at up to 60 frames a second (`.frameRate(60)`);
/// the crystal's glare over all. Reduce Motion: no continuous animation, a redraw a displayed second, the quick
/// pendulums as their fans.
struct PendulumFace: View {
    /// Width over height of the face's frame.
    nonisolated static let aspectRatio: CGFloat = PendulumSpace.aspectRatio
    /// The -FXFaceTime instant, or nil to follow the clock.
    let fixed: Double?

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let fit = PendulumFit(size: geo.size)
            // displayed seconds per real second: a still instant and a paused clock stand still
            let rate = fixed != nil ? 0 : store.isLive ? 1 : store.rate
            ZStack(alignment: .topLeading) {
                Canvas { context, _ in
                    PendulumPainter.drawStill(PendulumLayer.scaled(context, fit))
                }
                .accessibilityHidden(true)
                SlowPendulums(fixed: fixed, fit: fit, rate: rate, reduceMotion: reduceMotion, words: settings.wording)
                FastPendulums(fixed: fixed, fit: fit, rate: rate, reduceMotion: reduceMotion)
                Canvas { context, _ in
                    PendulumPainter.drawGlass(PendulumLayer.scaled(context, fit))
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
    }
}

enum PendulumLayer {
    /// The context in design units.
    static func scaled(_ context: GraphicsContext, _ fit: PendulumFit, region: CGRect? = nil) -> GraphicsContext {
        var g = context
        if let region {
            g.scaleBy(x: fit.scale, y: fit.scale)
            g.translateBy(x: -region.minX, y: -region.minY)
        } else {
            g.translateBy(x: fit.origin.x, y: fit.origin.y)
            g.scaleBy(x: fit.scale, y: fit.scale)
        }
        return g
    }

    /// Draws `specs` (back to front) at t; at rest and dimmed outside the catalogue.
    static func draw(_ g: GraphicsContext, specs: [PendulumSpec], at t: Double, rate: Double, reduceMotion: Bool, pentad: Int?) {
        let swings = PendulumReading.swings(at: t, levels: specs.map(\.level))
        for (i, spec) in specs.enumerated() {
            if let swing = swings?[i] {
                let motion = PendulumMotion.make(phase: swing.phase, duration: swing.duration, amplitude: spec.amplitude,
                                                 rate: rate, reduceMotion: reduceMotion)
                PendulumPainter.drawPendulum(g, spec, angle: swing.angle(amplitude: spec.amplitude), motion: motion, pentad: pentad)
            } else {
                PendulumPainter.drawPendulum(g, spec, angle: 0, motion: PendulumMotion(trail: 0, rodBlur: 0, heading: 1, fan: 0),
                                             pentad: nil, dim: 0.45)
            }
        }
    }
}

/// ι and slower (longest at the back) and the Pentad dial, redrawn every `PendulumReading.slowStep` displayed seconds
/// (at most 60 times a real second in a time-lapse). It carries the face's accessibility.
private struct SlowPendulums: View {
    let fixed: Double?
    let fit: PendulumFit
    let rate: Double
    let reduceMotion: Bool
    let words: Wording

    private static let specs = PendulumLayout.all.filter { !PendulumSpace.fastLevels.contains($0.level) }.reversed().map { $0 }

    var body: some View {
        let step = reduceMotion ? PendulumReading.calmStep : PendulumReading.slowStep
        let outOfRange = FaceWords.outOfRange(words: words)
        NowTimeline(fixed: fixed, minimumStep: reduceMotion ? 1 : 1.0 / 60, next: { $0 + step }) { t in
            let dial = PentadDialState.make(at: t)
            Canvas { context, _ in
                let g = PendulumLayer.scaled(context, fit)
                PendulumPainter.drawDial(g, dial, outOfRange: outOfRange)
                PendulumLayer.draw(g, specs: Self.specs, at: t, rate: rate, reduceMotion: reduceMotion, pentad: dial?.index)
            }
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: PendulumWords.label(at: t, notation: words.notation, outOfRange: outOfRange.title + outOfRange.range)))
            .accessibilityValue(Text(verbatim: PendulumReading.swings(at: t, levels: [4, 6, 8, 10]).map(PendulumWords.value) ?? ""))
            .accessibilityAddTraits(.updatesFrequently)
        }
    }
}

/// κ, λ and μ in a canvas of their corner, at up to 60 frames a second (once a displayed second with Reduce Motion,
/// twice a real second while a time-lapse shows them all as fans).
private struct FastPendulums: View {
    let fixed: Double?
    let fit: PendulumFit
    let rate: Double
    let reduceMotion: Bool

    private static let specs = PendulumLayout.all.filter { PendulumSpace.fastLevels.contains($0.level) }.reversed().map { $0 }

    /// A time-lapse so fast that κ, the slowest of them, shows only its fan: nothing here moves any more.
    private var fanned: Bool {
        PendulumLayout.spec(9).map { PendulumMotion.fansOut(meanPeriod: $0.meanPeriod, rate: rate) } ?? false
    }

    var body: some View {
        let region = PendulumLayout.fastRegion
        let frame = fit.rect(region)
        Group {
            if let fixed {
                canvas(at: fixed, region: region)
            } else if reduceMotion || fanned {
                // once a displayed second, at most once a real second (twice while fanned)
                NowTimeline(fixed: nil, minimumStep: reduceMotion ? 1 : 0.5, next: { $0 + 1 }) { t in canvas(at: t, region: region) }
            } else {
                ClockTimeline(.frameRate(60)) { t in canvas(at: t, region: region) }
            }
        }
        .frame(width: frame.width, height: frame.height)
        .offset(x: frame.minX, y: frame.minY)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func canvas(at t: Double, region: CGRect) -> some View {
        Canvas { context, _ in
            PendulumLayer.draw(PendulumLayer.scaled(context, fit, region: region), specs: Self.specs, at: t, rate: rate,
                               reduceMotion: reduceMotion, pentad: nil)
        }
    }
}
