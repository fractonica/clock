import FractonicaKit
import QuartzCore
import SwiftUI

/// The balance seen through the aperture at 9 o'clock: a brass wheel with timing screws on a blued hairspring,
/// swinging with the μ cycle (depth 12, ≈ 1.55 s) by the family's swing law (`AnalogDial.balanceAngle`): right at the
/// peak, back through the centre at the node, left at the valley. The rim (whose reflections stay put) is drawn by
/// SwiftUI; the arms, screws and hairspring are Core Animation layers that the render server swings, so the swing costs
/// the app nothing per frame. They are re-synchronised with the clock whenever its time base changes (a jump, a pause,
/// a new speed), when the scene becomes active again and once a Helion. Still under Reduce Motion, while the clock is
/// paused and at a fixed instant; a blur when a time-lapse swings it faster than the eye can follow.
struct AnalogBalance: View {
    let size: CGSize
    let fixed: Double?

    @Environment(ClockStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.displayScale) private var displayScale

    /// The μ cycle's mean length, displayed seconds.
    static let period = FractonicaClock.shared.levelInfo(11).meanSeconds
    /// A swing shorter than this in real seconds would only flicker: blur it.
    static let shortest = 0.14

    var body: some View {
        let g = AnalogGeometry(size: size)
        let disc = AnalogGeometry.aperture
        let side = 2 * g.length(disc.radius)
        let unit = g.radius
        let base = store.base
        let active = scenePhase == .active
        ZStack {
            AnalogBalanceRim(unit: unit).equatable()
            // redrawn once a Helion: the swing is re-synchronised with the clock then
            NowTimeline(fixed: fixed, next: { AnalogDial.calendarChange(after: $0) }) { t in
                AnalogBalanceLayers(unit: unit, side: side, scale: displayScale,
                                    motion: motion(at: t, base: base, active: active))
            }
        }
        .frame(width: side, height: side)
        .clipShape(Circle())
        .position(g.point(disc.center))
        .allowsHitTesting(false)
    }

    private func motion(at t: Double, base: ClockStore.TimeBase, active: Bool) -> AnalogBalanceMotion {
        if reduceMotion { return .still(phase: 0) }
        let rate = fixed == nil ? base.rate : 0
        if AnalogDial.blurred(period: Self.period, rate: rate, shortest: Self.shortest) { return .blurred }
        guard rate != 0, active, let helion = FractonicaClock.shared.level(at: t, 6) else {
            return .still(phase: FractonicaClock.shared.level(at: t, 11)?.phase ?? 0)
        }
        return .swinging(base: base, helion: helion.cycle)
    }
}

/// What the balance's layers do.
enum AnalogBalanceMotion: Equatable {
    /// Held at phase `phase` of the μ cycle (0 at rest).
    case still(phase: Double)
    /// Swinging with the clock: re-synchronised whenever the time base or the Helion changes.
    case swinging(base: ClockStore.TimeBase, helion: Int64)
    /// Faster than the eye: a sweep of faint copies.
    case blurred
}

/// The balance's rim: polished brass, its reflections fixed to the light (a ring looks the same at any angle).
struct AnalogBalanceRim: View, Equatable {
    let unit: CGFloat

    nonisolated static let outer: CGFloat = 0.112
    nonisolated static let inner: CGFloat = 0.097

    var body: some View {
        Canvas { ctx, size in
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let A = Theme.Analog.self
            let stops: [(Double, Double)] = [(0, 0.45), (0.125, 0.8), (0.25, 0.4), (0.375, 0.1), (0.5, 0.4),
                                             (0.625, 1), (0.75, 0.55), (0.875, 0.12), (1, 0.45)]
            let gradient = Gradient(stops: stops.map { Gradient.Stop(color: A.ramp($0.1, [A.brassDark, A.brass, A.brassLight]), location: $0.0) })
            let ring = AnalogPaint.ring(c, unit * Self.inner, unit * Self.outer)
            ctx.drawLayer { layer in
                let off = AnalogLight.shadow(unit * 0.012)
                layer.addFilter(.shadow(color: .black.opacity(0.7), radius: unit * 0.01, x: off.width, y: off.height))
                layer.fill(ring, with: .color(A.brassDark), style: AnalogPaint.eo)
            }
            ctx.fill(ring, with: .conicGradient(gradient, center: c, angle: .zero), style: AnalogPaint.eo)
        }
    }
}

/// The balance's moving parts as paths around `c` (y down), `unit` the bezel's radius.
enum AnalogBalanceParts {
    /// Three arms from the hub to the rim.
    static func arms(_ c: CGPoint, unit: CGFloat) -> Path {
        var p = Path()
        for k in 0..<3 {
            let arm = AnalogPaint.radial(c, Double(k) / 3, 0, unit * (AnalogBalanceRim.inner + 0.004))
            p.addPath(arm.strokedPath(StrokeStyle(lineWidth: unit * 0.013, lineCap: .butt)))
        }
        p.addPath(AnalogPaint.circle(c, unit * 0.022))
        return p
    }

    /// The ten timing screws standing out of the rim.
    static func screws(_ c: CGPoint, unit: CGFloat) -> Path {
        var p = Path()
        for k in 0..<10 {
            let a = 2 * Double.pi * (Double(k) + 0.5) / 10
            let r = unit * (AnalogBalanceRim.outer + 0.004)
            p.addPath(AnalogPaint.circle(CGPoint(x: c.x + CGFloat(sin(a)) * r, y: c.y - CGFloat(cos(a)) * r), unit * 0.0085))
        }
        return p
    }

    /// The hairspring: an Archimedean spiral whose inner end turns with the balance (by `twist` radians, clockwise)
    /// and whose outer end is pinned to its stud, so it winds and unwinds as the balance swings.
    static func spring(_ c: CGPoint, unit: CGFloat, twist: Double) -> Path {
        let r0 = unit * 0.024, r1 = unit * 0.084
        let turns = 6.0
        let steps = 200
        var p = Path()
        for i in 0...steps {
            let s = Double(i) / Double(steps)
            let r = r0 + (r1 - r0) * CGFloat(s)
            let a = 2 * .pi * turns * s + twist * (1 - s) - .pi / 2
            let q = CGPoint(x: c.x + r * CGFloat(cos(a)), y: c.y + r * CGFloat(sin(a)))
            if i == 0 { p.move(to: q) } else { p.addLine(to: q) }
        }
        p.addLine(to: CGPoint(x: c.x, y: c.y - unit * 0.09))
        return p
    }

    /// The hairspring's stud.
    static func stud(_ c: CGPoint, unit: CGFloat) -> Path {
        Path(CGRect(x: c.x - unit * 0.008, y: c.y - unit * 0.096, width: unit * 0.016, height: unit * 0.012))
    }
}

/// The layers that swing, and how they are driven (shared by the iOS and macOS views).
@MainActor
final class AnalogBalanceDriver {
    /// Fills the view; its sublayers' geometry runs y down on both platforms.
    let root = CALayer()
    private let wheel = CALayer()
    private let arms = CAShapeLayer()
    private let screws = CAShapeLayer()
    private let spring = CAShapeLayer()
    private let stud = CAShapeLayer()
    private let ghost = CALayer()
    private var built: [CGFloat]?
    private var applied: AnalogBalanceMotion?

    /// Keyframes per swing period: the rotation's, and the hairspring's shapes.
    private static let turnFrames = 64
    private static let springFrames = 32

    init() {
        root.masksToBounds = true
        for layer in [ghost, wheel, spring, stud] { root.addSublayer(layer) }
        wheel.addSublayer(arms)
        wheel.addSublayer(screws)
    }

    func update(unit: CGFloat, side: CGFloat, scale: CGFloat, motion: AnalogBalanceMotion) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        let key = [unit, side, scale]
        if built != key {
            build(unit: unit, side: side, scale: scale)
            built = key
            applied = nil
        }
        guard motion != applied else { return }
        applied = motion
        apply(motion, unit: unit, side: side)
    }

    private func build(unit: CGFloat, side: CGFloat, scale: CGFloat) {
        let bounds = CGRect(x: 0, y: 0, width: side, height: side)
        let c = CGPoint(x: side / 2, y: side / 2)
        let A = Theme.Analog.self
        root.frame = bounds
        for layer in [ghost, wheel, spring, stud] as [CALayer] {
            layer.bounds = bounds
            layer.position = c
            layer.contentsScale = scale
        }
        for layer in [arms, screws] {
            layer.frame = bounds
            layer.contentsScale = scale
        }
        arms.path = AnalogBalanceParts.arms(c, unit: unit).cgPath
        arms.fillColor = cg(A.brass)
        arms.strokeColor = cg(A.brassDark)
        arms.lineWidth = max(0.3, unit * 0.0015)
        screws.path = AnalogBalanceParts.screws(c, unit: unit).cgPath
        screws.fillColor = cg(Theme.gold)
        screws.strokeColor = cg(A.goldDeep)
        screws.lineWidth = max(0.3, unit * 0.002)
        spring.fillColor = nil
        spring.strokeColor = cg(A.blued.mix(with: A.bluedDark, by: 0.35))
        spring.lineWidth = max(0.4, unit * 0.0024)
        spring.lineJoin = .round
        spring.path = AnalogBalanceParts.spring(c, unit: unit, twist: 0).cgPath
        stud.path = AnalogBalanceParts.stud(c, unit: unit).cgPath
        stud.fillColor = cg(A.steel(0.4))
        // the ghost: faint copies across the swing
        ghost.sublayers?.forEach { $0.removeFromSuperlayer() }
        let copies = 14
        for k in 0..<copies {
            let angle = AnalogDial.balanceAngle(phase: Double(k) / Double(copies)) * .pi / 180
            for (path, color) in [(arms.path, cg(A.brass)), (screws.path, cg(Theme.gold))] {
                let copy = CAShapeLayer()
                copy.frame = bounds
                copy.contentsScale = scale
                copy.path = path
                copy.fillColor = color
                copy.opacity = 0.16
                copy.setAffineTransform(CGAffineTransform(rotationAngle: angle))
                ghost.addSublayer(copy)
            }
        }
    }

    private func apply(_ motion: AnalogBalanceMotion, unit: CGFloat, side: CGFloat) {
        let c = CGPoint(x: side / 2, y: side / 2)
        wheel.removeAllAnimations()
        spring.removeAllAnimations()
        switch motion {
        case .blurred:
            ghost.isHidden = false
            wheel.isHidden = true
            spring.path = AnalogBalanceParts.spring(c, unit: unit, twist: 0).cgPath
        case .still(let phase):
            ghost.isHidden = true
            wheel.isHidden = false
            let angle = AnalogDial.balanceAngle(phase: phase) * .pi / 180
            wheel.setAffineTransform(CGAffineTransform(rotationAngle: angle))
            spring.path = AnalogBalanceParts.spring(c, unit: unit, twist: angle).cgPath
        case .swinging(let base, _):
            ghost.isHidden = true
            wheel.isHidden = false
            // the clock and the render server's clock read at the same moment
            let now = CACurrentMediaTime()
            let t = base.t(atReal: Date.now.timeIntervalSince1970)
            guard let mu = FractonicaClock.shared.level(at: t, 11), mu.duration > 0, base.rate != 0 else {
                return apply(.still(phase: 0), unit: unit, side: side)
            }
            let direction = base.rate > 0 ? 1.0 : -1.0
            let real = mu.duration / abs(base.rate)
            // one period of the swing law starting at the running phase, repeated: forward in time, or backward
            let phase = { (k: Int, n: Int) in mu.phase + direction * Double(k) / Double(n) }
            let angle = { (p: Double) in AnalogDial.balanceAngle(phase: p) * .pi / 180 }
            wheel.setAffineTransform(CGAffineTransform(rotationAngle: angle(mu.phase)))
            spring.path = AnalogBalanceParts.spring(c, unit: unit, twist: angle(mu.phase)).cgPath

            let turn = CAKeyframeAnimation(keyPath: "transform.rotation.z")
            turn.values = (0...Self.turnFrames).map { angle(phase($0, Self.turnFrames)) }
            turn.keyTimes = (0...Self.turnFrames).map { NSNumber(value: Double($0) / Double(Self.turnFrames)) }
            let coil = CAKeyframeAnimation(keyPath: "path")
            coil.values = (0...Self.springFrames).map {
                AnalogBalanceParts.spring(c, unit: unit, twist: angle(phase($0, Self.springFrames))).cgPath
            }
            coil.keyTimes = (0...Self.springFrames).map { NSNumber(value: Double($0) / Double(Self.springFrames)) }
            for (animation, layer) in [(turn, wheel as CALayer), (coil, spring as CALayer)] {
                animation.duration = real
                animation.repeatCount = .infinity
                animation.calculationMode = .linear
                animation.beginTime = layer.convertTime(now, from: nil)
                animation.isRemovedOnCompletion = false
                layer.add(animation, forKey: "swing")
            }
        }
    }

    private func cg(_ color: Color) -> CGColor {
        color.resolve(in: EnvironmentValues()).cgColor
    }
}

#if os(iOS)
import UIKit

/// The swinging layers in a view.
struct AnalogBalanceLayers: UIViewRepresentable {
    let unit: CGFloat
    let side: CGFloat
    let scale: CGFloat
    let motion: AnalogBalanceMotion

    func makeUIView(context: Context) -> BalanceView { BalanceView() }

    func updateUIView(_ view: BalanceView, context: Context) {
        view.driver.update(unit: unit, side: side, scale: scale, motion: motion)
    }

    final class BalanceView: UIView {
        let driver = AnalogBalanceDriver()

        override init(frame: CGRect) {
            super.init(frame: frame)
            isUserInteractionEnabled = false
            backgroundColor = .clear
            layer.addSublayer(driver.root)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
    }
}
#else
import AppKit

/// The swinging layers in a view.
struct AnalogBalanceLayers: NSViewRepresentable {
    let unit: CGFloat
    let side: CGFloat
    let scale: CGFloat
    let motion: AnalogBalanceMotion

    func makeNSView(context: Context) -> BalanceView { BalanceView() }

    func updateNSView(_ view: BalanceView, context: Context) {
        view.driver.update(unit: unit, side: side, scale: scale, motion: motion)
    }

    final class BalanceView: NSView {
        let driver = AnalogBalanceDriver()

        override init(frame: NSRect) {
            super.init(frame: frame)
            wantsLayer = true
            // the backing layer runs y up: the root flips its sublayers to run y down, as on iOS
            driver.root.isGeometryFlipped = true
            layer?.addSublayer(driver.root)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}
#endif
