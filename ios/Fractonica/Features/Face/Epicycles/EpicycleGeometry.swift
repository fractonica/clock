import CoreGraphics
import FractonicaKit
import Foundation
import os

// The epicycle face's geometry: a ladder of arms, one a level from the base period down, each turning with its own
// period's phase at the tip of the one before. No SwiftUI here: checked by Checks/EpicycleChecks.swift.
//
// A level's phase is linear in Saros position and its cycles subdivide its parent's exactly there, so the phase of
// level k is frac(N_k · φ) for the base's phase φ, N_k being its cycles in one base cycle (the product of the factors
// from the base down to it). Every arm is therefore a function of φ alone, and the pen at the last tip,
// Σ r_k · e^{2πi · turns_k · φ}, closes after exactly one base cycle and starts again.
//
// Angles are in turns, clockwise from the top; points are in units of the figure's reach (the arms' lengths sum to 1),
// y down.

/// One arm of the ladder.
struct EpicycleArm: Equatable, Hashable, Sendable {
    let level: Int
    /// Its cycles in one base cycle: 1 for the base, the product of the factors from the base down to it.
    let cycles: Int
    /// +1 clockwise, −1 anticlockwise.
    let sign: Int
    /// Turns about the dial in one base cycle, signed: its own (`sign · cycles`) in the dial frame; in the carrier
    /// frame its own on top of its carrier's.
    let turns: Int
    /// Its share of the reach: the lengths of the arms that are on sum to 1; 0 when off.
    let length: Double

    var on: Bool { length > 0 }
}

/// The figure a configuration draws: its arms, base first.
struct EpicycleFigure: Equatable, Hashable, Sendable {
    let base: Int
    let arms: [EpicycleArm]
    let frame: EpicycleFrame

    init(_ config: EpicycleConfig, clock: FractonicaClock = .shared) {
        base = config.base
        frame = config.frame
        let total = config.onLevels.map(config.radius).reduce(0, +)
        var cycles = 1
        var carried = 0
        var arms: [EpicycleArm] = []
        for level in config.levels {
            if level > config.base { cycles *= clock.levelInfo(level - 1).factor }
            let sign = config.sign(level) > 0 ? 1 : -1
            let own = sign * cycles
            let turns = config.frame == .dial ? own : carried + own
            carried = turns
            let length = config.isOn(level) && total > 0 ? config.radius(level) / total : 0
            arms.append(EpicycleArm(level: level, cycles: cycles, sign: sign, turns: turns, length: length))
        }
        self.arms = arms
    }

    /// The top level (the pen's arm, on or not).
    var top: Int { arms.last?.level ?? base }

    /// The arms that are on.
    var onArms: [EpicycleArm] { arms.filter(\.on) }

    /// The finest arm that is on: the pen's.
    var penLevel: Int { onArms.last?.level ?? base }

    // MARK: Angles and joints

    /// Arm i's angle `phase` (0 … 1) into the base cycle, in turns (0 ..< 1 for a clockwise arm). In the dial frame it
    /// is the arm's own phase (reversed: 1 − phase).
    func angle(_ i: Int, _ phase: Double) -> Double {
        let x = Double(arms[i].turns) * phase
        return x - x.rounded(.down)
    }

    /// The hub and every arm's tip `phase` into the base cycle: arms.count + 1 points, in reach units, y down.
    func joints(_ phase: Double) -> [CGPoint] {
        var x = 0.0, y = 0.0
        var out = [CGPoint.zero]
        out.reserveCapacity(arms.count + 1)
        for i in arms.indices {
            let r = arms[i].length
            if r > 0 {
                let a = 2 * Double.pi * angle(i, phase)
                x += r * sin(a)
                y -= r * cos(a)
            }
            out.append(CGPoint(x: x, y: y))
        }
        return out
    }

    /// The pen: the last tip.
    func pen(_ phase: Double) -> CGPoint { joints(phase).last ?? .zero }

    /// The tip of arm i.
    func tip(_ i: Int, _ phase: Double) -> CGPoint { joints(phase)[i + 1] }

    // MARK: What the display can show

    /// Loops closer together than this (in points along the path) run into a band.
    static let minSpacing = 2.5
    /// An arm shorter than this (in points) is a wobble of the line, not a loop.
    static let minSize = 0.6
    /// Samples a turn of the fastest arm drawn as a curve, and the most a figure takes.
    static let samplesPerTurn = 24
    static let maxSamples = 19_200
    /// The fastest arm a figure samples (`maxSamples / samplesPerTurn`).
    static var maxTurns: Int { maxSamples / samplesPerTurn }

    /// The index of the finest arm drawn as a curve on a figure `scale` points to the reach: the arms are taken base
    /// first while each one's loops lie at least `minSpacing` apart along its carrier's path and it is at least
    /// `minSize` long; the arms that are on past it fold into a band (`band(after:)`) the display could not resolve.
    func detail(scale: Double) -> Int {
        var sharp = -1
        var length = 0.0 // the sharp curve's length so far, in reach units a base cycle
        for (i, arm) in arms.enumerated() where arm.on {
            let speed = 2 * Double.pi * arm.length * Double(abs(arm.turns))
            if sharp < 0 {
                sharp = i
                length = speed
                continue
            }
            let loops = Double(max(1, abs(arm.turns)))
            guard length * scale / loops >= Self.minSpacing, arm.length * scale >= Self.minSize,
                  abs(arm.turns) <= Self.maxTurns else { break }
            sharp = i
            // two turning parts of incommensurate speeds: on average about the root of their squares
            length = (length * length + speed * speed).squareRoot()
        }
        return max(sharp, 0)
    }

    /// The half-width of the band the arms past `detail` sweep: their lengths together.
    func band(after detail: Int) -> Double {
        arms.indices.filter { $0 > detail }.map { arms[$0].length }.reduce(0, +)
    }

    /// The finest level folded into the band (its colour), nil without a band.
    func bandLevel(after detail: Int) -> Int? {
        arms.indices.last { $0 > detail && arms[$0].on }.map { arms[$0].level }
    }

    /// Samples of a base cycle for a curve whose finest arm is `detail`.
    func sampleCount(detail: Int) -> Int {
        let fastest = arms.prefix(detail + 1).filter(\.on).map { abs($0.turns) }.max() ?? 1
        return min(Self.maxSamples, max(360, fastest * Self.samplesPerTurn))
    }

    // MARK: The whole figure

    /// Every tip's path over a base cycle, arms up to `detail` (cached: the last few figures asked for).
    func curve(detail: Int) -> EpicycleCurve {
        let key = CurveKey(figure: self, detail: detail)
        if let hit = Self.cache.withLock({ entries -> EpicycleCurve? in
            guard let i = entries.firstIndex(where: { $0.key == key }) else { return nil }
            if i > 0 { entries.insert(entries.remove(at: i), at: 0) }
            return entries[0].curve
        }) { return hit }
        let count = sampleCount(detail: detail)
        let sharp = EpicycleFigure(trimmedTo: detail, of: self)
        var tips = Array(repeating: [CGPoint](), count: detail + 1)
        for i in tips.indices { tips[i].reserveCapacity(count + 1) }
        for s in 0...count {
            let j = sharp.joints(Double(s) / Double(count))
            for i in tips.indices { tips[i].append(j[i + 1]) }
        }
        let curve = EpicycleCurve(count: count, tips: tips)
        Self.cache.withLock { entries in
            entries.insert((key, curve), at: 0)
            if entries.count > 6 { entries.removeLast() }
        }
        return curve
    }

    /// The figure's arms up to `detail`, at the same lengths (the band's arms off).
    private init(trimmedTo detail: Int, of figure: EpicycleFigure) {
        base = figure.base
        frame = figure.frame
        arms = figure.arms.enumerated().map { i, a in
            i <= detail ? a : EpicycleArm(level: a.level, cycles: a.cycles, sign: a.sign, turns: a.turns, length: 0)
        }
    }

    private struct CurveKey: Equatable, Sendable {
        let figure: EpicycleFigure
        let detail: Int
    }

    private static let cache = OSAllocatedUnfairLock<[(key: CurveKey, curve: EpicycleCurve)]>(initialState: [])

    // MARK: Speeds

    /// Real turns a second of arm i at `speed` displayed seconds a real one, for a base cycle of `seconds`.
    func spin(_ i: Int, speed: Double, seconds: Double) -> Double {
        guard seconds > 0 else { return 0 }
        return Double(abs(arms[i].turns)) * abs(speed) / seconds
    }

    /// Faster than this a turning arm is drawn as the blur it would be.
    static let blurSpin = 1.2

    /// The first arm (that is on) turning faster than the eye follows; nil when none does.
    func firstBlurred(speed: Double, seconds: Double) -> Int? {
        arms.indices.first { arms[$0].on && spin($0, speed: speed, seconds: seconds) > Self.blurSpin }
    }

    /// The fastest the pen can move, in reach units a displayed second, counting the arms before `blurred` only (what
    /// a blur carries is drawn still).
    func penSpeed(seconds: Double, blurred: Int? = nil) -> Double {
        guard seconds > 0 else { return 0 }
        let upTo = blurred ?? arms.count
        return arms.prefix(upTo).map { 2 * Double.pi * $0.length * Double(abs($0.turns)) }.reduce(0, +) / seconds
    }
}

/// A figure's tips sampled over a base cycle: `tips[i]` is arm i's tip at phases 0, 1/count … 1 (count + 1 points,
/// the last the first again).
final class EpicycleCurve: Sendable {
    let count: Int
    let tips: [[CGPoint]]

    init(count: Int, tips: [[CGPoint]]) {
        self.count = count
        self.tips = tips
    }

    /// The samples of tip i from the cycle's start up to (not including) `phase`.
    func prefix(_ i: Int, upTo phase: Double) -> ArraySlice<CGPoint> {
        let end = min(count, max(0, Int((phase * Double(count)).rounded(.up))))
        return tips[i][0..<end]
    }

    /// The samples of tip i from `from` (not including) to `to` (not including).
    func span(_ i: Int, from: Double, to: Double) -> ArraySlice<CGPoint> {
        let a = min(count, max(0, Int((from * Double(count)).rounded(.down)) + 1))
        let b = min(count, max(a, Int((to * Double(count)).rounded(.up))))
        return tips[i][a..<b]
    }
}

/// The dial's proportions, in its radius (half the dial's width): from the plate's edge in to the hub.
enum EpicycleDial {
    /// The plate and its bezel ring (as the star face's).
    static let plate = 0.99
    static let bezel = 0.955
    /// The base cycle's quarters (peak, node, valley) as small marks inside the bezel.
    static let quarters = 0.928
    /// The base cycle's scale: its children from `tickMajor`, their children from `tickMinor`, out to `tickOuter`.
    static let tickOuter = 0.905
    static let tickMinor = 0.885
    static let tickMajor = 0.866
    /// Where the Pentads stand on the scale (bases of a Nuclide or a ζ: their Helions are on it).
    static let pentads = 0.885
    /// The figure's reach: the arms together.
    static let reach = 0.80
    /// The hub: the running Pentad's badge, and the sync's 19 Helions round it.
    static let hub = 0.12
    static let hubPips = 0.165
}

/// The base cycle's scale round the rim: its children as major ticks, their children as minor ones.
struct EpicycleScale: Equatable, Sendable {
    let majors: Int
    let minors: Int

    init(base: Int, clock: FractonicaClock = .shared) {
        majors = clock.levelInfo(base).factor
        minors = majors * clock.levelInfo(base + 1).factor
    }
}

/// A point at `turns` from the top, clockwise, at `radius` (y down).
func epicyclePoint(turns: Double, radius: Double = 1) -> CGPoint {
    let a = 2 * Double.pi * turns
    return CGPoint(x: radius * sin(a), y: -radius * cos(a))
}
