import CoreGraphics
import Foundation

// The star face's geometry (SPEC §7.5): the solar day as a circle and the solar sync's 19 Helions as the chords of the
// star polygon {19/4}; inside it the running Helion as an epicyclic rose of 9 θ and 36 ι. No SwiftUI here: checked by
// Checks/StarChecks.swift.
//
// A solar day is 4¾ = 19/4 Helions, so a quarter Helion is a 19th of the day: the rim carries 19 points ¼η apart in the
// time of day (and 171 Preon ticks, 9 to a quarter Helion: 171ι are a day). Helion k of the sync begins (4k mod 19)
// points after the sync's own time of day, so joining the Helions' boundaries in turn steps 4 points at a time: the
// sync's 19 Helions draw {19/4} exactly once and close, and each chord spans the arc the Sun travels in its Helion.
// Pentad I's five chords wind 20/19 of a turn, one point (¼η) past where they began, where Pentad II begins, and so on;
// the Hypopentad's four wind 16/19 and close the figure on the next sync's start.
//
// Angles are in turns, clockwise from the top; points are in a unit frame with y down (a view scales them).

enum StarGeometry {
    /// Points on the rim: quarter Helions in a solar day.
    static let points = 19
    /// Points a Helion spans (4 quarters).
    static let step = 4
    /// Helions in a solar sync.
    static let helions = 19
    /// Preons in a quarter Helion (36 / 4): the rim's fine ticks.
    static let ticksPerPoint = 9
    /// Preon ticks in a solar day (171ι = 4¾η).
    static var ticks: Int { points * ticksPerPoint }
    /// The Helions of each Pentad (5, 5, 5, the Hypopentad 4).
    static let pentadHelions = [5, 5, 5, 4]

    /// The rim point where boundary k of the sync lies (the start of Helion k; k = 19 is the next sync's start, at 0).
    static func vertex(ofBoundary k: Int) -> Int {
        ((step * k) % points + points) % points
    }

    /// The Helion (0 … 18) of the sync that begins at rim point j: the inverse of 4k mod 19 (4 · 5 = 20 ≡ 1).
    static func helion(startingAt j: Int) -> Int {
        ((5 * j) % points + points) % points
    }

    /// The Pentad (0 … 3) of Helion k of the sync (0 … 18).
    static func pentad(ofHelion k: Int) -> Int { min(3, max(0, k) / 5) }

    /// The Pentad whose Helion begins at rim point j. Around the rim they run I II III ◻ I II III ◻ … I II III: the four
    /// Pentads begin ¼η apart at the same time of day, and the Hypopentad, a Helion short, has no fifth point.
    static func pentad(ofVertex j: Int) -> Int { pentad(ofHelion: helion(startingAt: j)) }

    /// Helion k's place in its Pentad, 1 … 5.
    static func place(ofHelion k: Int) -> Int { k - 5 * pentad(ofHelion: k) + 1 }

    /// The Helions (chords) of Pentad i: 0 ..< 5, 5 ..< 10, 10 ..< 15, 15 ..< 19.
    static func helions(ofPentad i: Int) -> Range<Int> {
        let first = 5 * min(max(i, 0), 3)
        return first ..< first + pentadHelions[min(max(i, 0), 3)]
    }

    /// The rim points of chord k: from the start of Helion k to its end.
    static func chord(_ k: Int) -> (from: Int, to: Int) {
        (vertex(ofBoundary: k), vertex(ofBoundary: k + 1))
    }

    /// Turns from the top of rim point j.
    static func turns(ofVertex j: Int) -> Double { Double(j) / Double(points) }

    /// Turns a Helion's chord subtends: the Sun's travel in a Helion, 4/19 of the day.
    static let chordTurns = Double(step) / Double(points)

    /// The turns Pentad i winds: 20/19 for Pentads I–III (a turn and the ¼η slip), 16/19 for the Hypopentad.
    static func winding(ofPentad i: Int) -> Double {
        Double(pentadHelions[min(max(i, 0), 3)]) * chordTurns
    }

    /// Where the Sun stands in the day, in turns from the sync's start, `phase` (0 ..< 1) into Helion k of the sync: it
    /// travels each Helion's arc while the Helion runs, so it meets the pen at every boundary.
    static func sunTurns(helion k: Int, phase: Double) -> Double {
        let t = (Double(k) + phase) * chordTurns
        return t - t.rounded(.down)
    }

    /// A point on the circle of `radius` at `turns` from the top, clockwise (y down).
    static func point(turns: Double, radius: Double = 1) -> CGPoint {
        let a = 2 * Double.pi * turns
        return CGPoint(x: radius * sin(a), y: -radius * cos(a))
    }

    /// Rim point j on the unit circle.
    static func vertexPoint(_ j: Int, radius: Double = 1) -> CGPoint {
        point(turns: turns(ofVertex: j), radius: radius)
    }

    /// The pen `phase` along chord k (straight, linear in the Helion's phase).
    static func pen(helion k: Int, phase: Double, radius: Double = 1) -> CGPoint {
        let (a, b) = chord(k)
        let p = vertexPoint(a, radius: radius), q = vertexPoint(b, radius: radius)
        let s = min(max(phase, 0), 1)
        return CGPoint(x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s)
    }

    /// The distance of every chord from the centre (they are all tangent to this circle): cos(π · 4/19) ≈ 0.789.
    static let chordDistance = cos(Double.pi * chordTurns)

    /// The rim points of Pentad i's figure: its Helions' starts and the point where the next Pentad begins.
    static func figure(ofPentad i: Int) -> [Int] {
        let range = helions(ofPentad: i)
        return range.map { vertex(ofBoundary: $0) } + [vertex(ofBoundary: range.upperBound)]
    }
}

/// The running Helion as an epicyclic rose (an orrery of three arms): the η arm turns once a Helion about the centre;
/// the θ arm, carried at its tip, turns the other way 9 times a Helion against it; the ι arm, carried at the θ arm's
/// tip, turns back 4 times a θ against that. The pen at the last tip traces, in one Helion, a ring of 9 cells (the θ)
/// of 4 cusps each (the ι): 36 Preons. All three arms point up at the Helion's start and line up again at every θ,
/// at a tip of the 9-pointed figure; the absolute turns per Helion, 1, −8 and 28, are all 1 mod 9, so each θ draws
/// the same cell a ninth of a turn on.
///
/// As on the pendulums, each arm stands at the top at its cycle's start and, turning clockwise in its carrier's frame
/// (the η and ι arms; the θ arm mirrors), crosses the right at its peak (¼), the bottom at its node (½), the left at its
/// valley (¾).
enum StarRose {
    /// Absolute turns of each arm per Helion (η, θ, ι).
    static let frequencies: [Double] = [1, -8, 28]
    /// Turns of each arm per Helion against the arm that carries it.
    static let relative: [Double] = [1, -9, 36]
    /// Arm lengths, in the face's half-size (the star's radius is `StarDial.starRadius`).
    static let radii: [Double] = [0.36, 0.135, 0.04]

    /// The farthest the pen gets from the centre (at every θ boundary).
    static var outerRadius: Double { radii.reduce(0, +) }
    /// The nearest (the figure's open middle).
    static var innerRadius: Double { radii[0] - radii[1] - radii[2] }

    /// The tips of the arms `phase` (0 … 1) into the Helion: [centre, η tip, θ tip, pen], in face half-sizes, y down.
    static func joints(_ phase: Double) -> [CGPoint] {
        var x = 0.0, y = 0.0
        var out = [CGPoint.zero]
        for (f, r) in zip(frequencies, radii) {
            let a = 2 * Double.pi * f * phase
            x += r * sin(a)
            y -= r * cos(a)
            out.append(CGPoint(x: x, y: y))
        }
        return out
    }

    /// The pen `phase` into the Helion.
    static func pen(_ phase: Double) -> CGPoint { joints(phase)[3] }

    /// Samples of the whole figure: `perPreon` steps a Preon (the cusps need about 32), first and last the same point.
    static let perPreon = 40
    static let sampleCount = 36 * perPreon
    static let samples: [CGPoint] = (0...sampleCount).map { pen(Double($0) / Double(sampleCount)) }

    /// The θ boundaries' points: the figure's 9 tips.
    static let tips: [CGPoint] = (0..<9).map { pen(Double($0) / 9) }
}

/// The dial's proportions, in its radius (half the dial's width): from the plate's edge in to the hub.
enum StarDial {
    /// The plate and its bezel ring.
    static let plate = 0.99
    static let bezel = 0.955
    /// The civil hours around the rim (Earth mode only).
    static let hours = 0.912
    /// The Preon ticks: the 19 quarter-Helion marks run from `tickMajor`, the others from `tickMinor`, out to `tickOuter`.
    static let tickOuter = 0.872
    static let tickMinor = 0.847
    static let tickMajor = 0.828
    /// The star's circle: the rim points, the Sun's track.
    static let starRadius = 0.80
    /// The Helion's scale inside the star: 36 Preon ticks out to `scaleOuter`, the 9 θ from `scaleMajor`.
    static let scaleOuter = 0.598
    static let scaleMinor = 0.579
    static let scaleMajor = 0.565
    /// The Flavon's spark's orbit around the rose's pen.
    static let sparkOrbit = 0.042
    /// The hub's Pentad badge (its size, a fraction of the radius).
    static let hub = 0.165

    /// The clear disc inside the star (every chord is tangent to it).
    static var clearRadius: Double { starRadius * StarGeometry.chordDistance }
}
