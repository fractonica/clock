import CoreGraphics
import FractonicaKit
import Foundation

// The pendulum set's geometry in design units: a 360 × 500 case drawn at any size by `PendulumFit`. Twelve pendulums
// hang from one beam, depth 12 (μ, ≈ 1.6 s) on the left down to depth 1 (α, ≈ 72 years) on the right; each is as long
// as the logarithm of its level's period, so the bobs fall in a cascade whose uneven steps are the factor sequence
// (a ×13 step drops further than a ×4 one). Every bob sweeps the same width, so a slow giant swings a few degrees and
// μ thirty. Under the cascade, in the triangle it leaves, the Pentad dial: the solar sync's 19 Helions in four groups.
// No SwiftUI here: checked by Checks/PendulumChecks.swift.

enum PendulumSpace {
    static let width: CGFloat = 360
    static let height: CGFloat = 500
    /// Width over height of the face.
    static let aspectRatio: CGFloat = width / height

    /// The case: its corner and the brushed bezel around the plate.
    static let corner: CGFloat = 36
    static let bezel: CGFloat = 7
    static var bounds: CGRect { CGRect(x: 0, y: 0, width: width, height: height) }
    static var plate: CGRect { bounds.insetBy(dx: bezel, dy: bezel) }

    /// The beam across the case, carrying the level letters; the pivots hang just under it.
    static let beam = CGRect(x: bezel, y: 30, width: width - 2 * bezel, height: 18)
    static let pivotY: CGFloat = 53

    /// The levels shown, left to right: depth 12 (μ) up to depth 1 (α). Finer depths swing faster than a display can
    /// show (ν ≈ 0.3 s); every level up to α is a reading the face can give, so the cascade runs the whole ladder.
    static let levels: [Int] = Array((0...11).reversed())
    static let firstX: CGFloat = 48
    static let pitch: CGFloat = 22.8
    /// The shortest (μ) and longest (α) pendulums.
    static let shortest: CGFloat = 50
    static let longest: CGFloat = 388
    /// How far each bob swings to either side of its pivot.
    static let excursion: CGFloat = 28
    /// The widest swing (μ: its excursion would need more).
    static let maxAmplitude = 30 * Double.pi / 180

    /// The levels redrawn up to 60 times a second (κ, λ, μ); the others a few times a displayed second.
    static let fastLevels: Set<Int> = [9, 10, 11]
    /// The Helion: its bob is the running Pentad's shape.
    static let helionLevel = 6
}

/// One pendulum of the set.
struct PendulumSpec: Equatable, Sendable {
    let level: Int
    /// 0 (μ, left) … 11 (α, right).
    let column: Int
    let pivot: CGPoint
    let length: CGFloat
    /// Radians either side of the vertical.
    let amplitude: Double
    let bobRadius: CGFloat
    /// The level's mean period, seconds.
    let meanPeriod: Double
    /// A unit of the ladder (α β γ δ ε η ι λ), not a depth between units (ζ θ κ μ).
    let isUnit: Bool

    /// Where the rod points at `angle` (radians from the vertical, positive to the right), `radius` from the pivot.
    func point(angle: Double, radius: CGFloat) -> CGPoint {
        CGPoint(x: pivot.x + radius * CGFloat(sin(angle)), y: pivot.y + radius * CGFloat(cos(angle)))
    }

    func bob(angle: Double) -> CGPoint { point(angle: angle, radius: length) }

    /// The bob at rest.
    var rest: CGPoint { bob(angle: 0) }

    /// Everything the pendulum can cover (rod, bob, its trail, a fan and the bob's shadow), in design units.
    var sweptBounds: CGRect {
        let reach = length * CGFloat(sin(amplitude)) + bobRadius * 1.5 + 4
        return CGRect(x: pivot.x - reach, y: pivot.y - 4, width: 2 * reach, height: length + bobRadius * 1.5 + 8)
    }
}

enum PendulumLayout {
    /// The twelve pendulums, left to right.
    static let all: [PendulumSpec] = make(clock: .shared)

    /// The pendulum of `level`.
    static func spec(_ level: Int) -> PendulumSpec? { all.first { $0.level == level } }

    static func make(clock: FractonicaClock) -> [PendulumSpec] {
        let s = PendulumSpace.self
        let periods = s.levels.map { clock.levelInfo($0).meanSeconds }
        let lo = log(periods.first ?? 1), hi = log(periods.last ?? 2)
        return s.levels.enumerated().map { column, level in
            let u = CGFloat((log(periods[column]) - lo) / max(1e-9, hi - lo))
            let length = s.shortest + (s.longest - s.shortest) * u
            let unit = Notation.isUnitLevel(level)
            return PendulumSpec(
                level: level,
                column: column,
                pivot: CGPoint(x: s.firstX + CGFloat(column) * s.pitch, y: s.pivotY),
                length: length,
                amplitude: min(s.maxAmplitude, asin(min(1, Double(s.excursion / length)))),
                // heavier bobs for the slower pendulums; the depths between units a size smaller
                bobRadius: (6.4 + 4.6 * u) * (unit ? 1 : 0.84),
                meanPeriod: periods[column],
                isUnit: unit
            )
        }
    }

    /// The design-unit box the fast pendulums (κ λ μ) can reach: their own canvas, so a display-rate redraw paints
    /// only that corner.
    static let fastRegion: CGRect = all.filter { PendulumSpace.fastLevels.contains($0.level) }
        .map(\.sweptBounds).reduce(CGRect.null) { $0.union($1) }.insetBy(dx: -3, dy: -3).integral
}

/// How a pendulum shows its motion at an instant: a trail behind the bob along its arc (where it is heading and how
/// fast), the rod's own blur over a short shutter, and — when it swings faster than the display can follow (a
/// time-lapse, or Reduce Motion) — a fan over its whole swing instead.
struct PendulumMotion: Equatable, Sendable {
    /// Radians behind the bob, against `heading`.
    var trail: Double
    /// Radians the rod really sweeps during the shutter: the rod's smear over the trail is the stronger for it.
    var rodBlur: Double
    /// +1 the bob moves right on screen, −1 left.
    var heading: Double
    /// 0 a single pendulum … 1 a blurred fan over its whole swing.
    var fan: Double

    /// The trail at full speed, as a share of the amplitude: a slow pendulum shows where it is heading and how fast.
    static let trailGain = 0.8
    /// The exposure of the real motion blur, real seconds.
    static let shutter = 1.0 / 20
    /// Real periods below `fanStart` begin to fan out; below `fanFull` only the fan shows.
    static let fanStart = 0.4
    static let fanFull = 0.18
    /// With Reduce Motion nothing swings continuously: a pendulum quicker than this shows as its fan.
    static let calmPeriod = 12.0

    /// At `rate` a pendulum of this mean period shows only its fan, whatever its running cycle's length (a cycle runs
    /// within a few per cent of the mean): what it draws no longer changes with time.
    static func fansOut(meanPeriod: Double, rate: Double) -> Bool {
        rate != 0 && meanPeriod * 1.1 / abs(rate) < fanFull
    }

    /// `rate`: displayed seconds per real second (0 paused or a still instant, negative backwards).
    static func make(phase: Double, duration: Double, amplitude: Double, rate: Double, reduceMotion: Bool) -> PendulumMotion {
        let speed = Swing.speed(phase: phase)
        let pace = abs(rate)
        let realPeriod = pace > 0 && duration > 0 ? duration / pace : .infinity
        let fan: Double
        if reduceMotion {
            fan = realPeriod < calmPeriod ? 1 : 0
        } else {
            let x = (fanStart - realPeriod) / (fanStart - fanFull)
            let c = min(1, max(0, x))
            fan = c * c * (3 - 2 * c)
        }
        // the real sweep over the shutter: dθ/dt = 2πA·cos(2πφ)/T per displayed second, times the rate
        let real = duration > 0 ? 2 * .pi * pace * shutter / duration : 0
        let trail = min(2 * amplitude, amplitude * speed * max(trailGain, real))
        let rodBlur = reduceMotion ? 0 : min(2 * amplitude, amplitude * speed * real)
        // on screen the bob moves the way real time takes it: backwards in a reversed time-lapse
        let heading = Swing.heading(phase: phase) * (rate < 0 ? -1 : 1)
        return PendulumMotion(trail: trail, rodBlur: rodBlur, heading: heading, fan: fan)
    }
}

/// The Pentad dial in the triangle under the cascade: the running solar sync's 19 Helions as a ring of segments from
/// the top, clockwise, in four groups — Pentad I, II, III (five each) and the Hypopentad (four, drawn bolder) — with a
/// gap between groups; sun marks where a solar day (4¾η) turns, so each Pentad visibly starts ¼η later in its day.
enum PentadDial {
    static let center = CGPoint(x: 99, y: 397)
    /// The ring's middle radius and band width; the Hypopentad's band reaches further out.
    static let radius: CGFloat = 58
    static let band: CGFloat = 9
    static let hypoExtra: CGFloat = 3.5
    /// The recessed disc the dial sits in.
    static let discRadius: CGFloat = 84
    /// Where the small group badges sit, and their size.
    static let badgeRadius: CGFloat = 75
    static let badgeSize: CGFloat = 13
    /// The gap between groups and the hairline between Helions, radians.
    static let groupGap = 8 * Double.pi / 180
    static let hairline = 1.6 * Double.pi / 180
    /// One Helion's share of the ring.
    static let slot = (2 * Double.pi - 4 * groupGap) / 19

    /// The screen angle (radians clockwise from three o'clock) `h` Helions into the sync (0 … 19).
    static func angle(helions h: Double) -> Double {
        let group = min(3, max(0, Int((h / 5).rounded(.down))))
        return -Double.pi / 2 + groupGap / 2 + Double(group) * groupGap + h * slot
    }

    /// The group (0 … 3) of the sync's Helion k (0 … 18).
    static func group(ofHelion k: Int) -> Int { min(3, max(0, k / 5)) }

    /// The arc of the sync's Helion k (0 … 18), without its hairlines.
    static func segment(_ k: Int) -> (start: Double, end: Double) {
        let a = angle(helions: Double(k))
        return (a + hairline / 2, a + slot - hairline / 2)
    }

    /// The middle of group i's arc (0 … 3).
    static func groupMiddle(_ i: Int) -> Double {
        let first = Double(5 * i), count = Double(i == 3 ? 4 : 5)
        return angle(helions: first) + count * slot / 2
    }

    /// Helions into the sync at which a solar day turns: 0, 4¾, 9½, 14¼ (and 19, the next sync's start).
    static let dayTurns: [Double] = [0, 4.75, 9.5, 14.25]

    /// A point at screen `angle` and `radius` from the dial's centre.
    static func point(angle: Double, radius: CGFloat) -> CGPoint {
        CGPoint(x: center.x + radius * CGFloat(cos(angle)), y: center.y + radius * CGFloat(sin(angle)))
    }
}

/// Lays the design space into a view of any size: as large as fits, centred.
struct PendulumFit: Equatable, Sendable {
    let scale: CGFloat
    let origin: CGPoint

    init(size: CGSize) {
        let s = max(0.01, min(size.width / PendulumSpace.width, size.height / PendulumSpace.height))
        scale = s
        origin = CGPoint(x: (size.width - PendulumSpace.width * s) / 2, y: (size.height - PendulumSpace.height * s) / 2)
    }

    /// A design-unit rectangle in view points.
    func rect(_ r: CGRect) -> CGRect {
        CGRect(x: origin.x + r.minX * scale, y: origin.y + r.minY * scale, width: r.width * scale, height: r.height * scale)
    }
}
