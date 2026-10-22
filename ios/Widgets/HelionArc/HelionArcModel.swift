import CoreGraphics
import FractonicaKit

// The Helion Arc's logic: what it shows at an instant and where it draws it. Pure logic, checked by Widgets/Checks
// (and compiled into the render harness).

// MARK: - Snapshot

/// The Helion Arc at one instant: the running Helion as the journal face draws a cycle, its count on the first
/// half-arc ("34η", the Helion's number in its Nuclide) and on the second ("29ι", the Preons completed in it), two
/// digits each like the journal face; the running Preon rides the arc as one wave, with the dot on it. Fractonica
/// terms only, so it reads the same in either wording. Nil outside the catalogue.
struct HelionArcSnapshot: Hashable, Sendable {
    /// The dot's steps along the Preon's wave: the Preon's 2-stroke glyph, 16 states of about 32 s.
    static let steps = 16

    /// The Helion's number in its Nuclide, 1 … 77.
    let helion: Int
    /// Preons completed in the Helion, 0 … 35: which Preon rides the arc.
    let preon: Int
    /// The sixteenth of the running Preon the moment is in, 0 … 15 (its glyph state).
    let step: Int
    /// "34η" and "29ι".
    let helionToken: CountToken
    let preonToken: CountToken
    /// What VoiceOver reads.
    let accessibility: String

    /// Where the dot stands on the Preon's wave, 0 … 1: the middle of its sixteenth, never more than a thirty-second of
    /// the Preon away from the moment the entry stands for.
    var phase: Double { (Double(step) + 0.5) / Double(Self.steps) }

    /// The dot steps sixteen times a Preon, an entry every ~32 s (each Preon start is one of them: there the counts
    /// and the wave move on too); a timeline's 150 entries last about 9ι.
    static let changes: Set<WidgetChange> = [.glyph2(level: 8)]

    init?(at t: Double, notation: Notation = .standard) {
        guard let c = notation.clock(at: t),
              let digit = notation.model.odometer(at: t, 8, strokes: 2, digits: 1)?.digits.first else { return nil }
        helion = c.eta
        preon = min(HelionArcGeometry.preons - 1, max(0, c.iota))
        step = min(Self.steps - 1, max(0, digit))
        let two = { (n: Int) in n >= 0 && n < 10 ? "0\(n)" : String(n) }
        helionToken = CountToken(level: 6, number: two(c.eta), suffix: "η")
        preonToken = CountToken(level: 8, number: two(c.iota), suffix: "ι")
        accessibility = "Helion \(c.eta) of its Nuclide, \(c.iota) of its 36 Preons complete; the running Preon rides "
            + "the Helion's arc as a wave"
    }
}

// MARK: - Geometry

/// Where the Helion Arc draws, in a frame (y grows downward). The Helion is the journal face's cycle
/// (`Journal.arcPoint`): two half-arcs of radius `r`, the left one below the axis (the first half, descending), the
/// right one above it (ascending). The running Preon rides it as one wave in the same shape: a double arc of its own,
/// bent along the Helion's, its first half on the right of the way the Helion runs (below, where the Helion runs
/// left to right), its second on the left.
///
/// A Preon is a 36th of the Helion: far too short to see a wave in at widget size. So the arc is a lens: the running
/// Preon is drawn `magnification` times as long as the others, the Preons before it share the arc before its wave
/// and those after it the rest. Within a Preon every instant has its place (the wave's ends are the Preon's start and
/// end); at each Preon start the lens moves on by one Preon.
struct HelionArcGeometry: Sendable {
    /// Preons in a Helion (9 θ × 4 ι).
    static let preons = 36
    /// How many times as long as the others the running Preon is drawn.
    static let magnification = 7.0
    /// The share of the double arc the running Preon's wave takes: 5/40.
    static let window = magnification / (Double(preons - 1) + magnification)
    /// The wave's half-arcs in radii of the Helion's: a double arc as long as its stretch of the Helion's (4 of its own
    /// radii across) — how far it reaches off the Helion's arc.
    static let amplitude = window * 2 * .pi / 4
    /// The drawing's width and height in radii: the two half-arcs and the wave's reach around them.
    static let widthInRadii = 4 + 2 * amplitude
    static let heightInRadii = 2 + 2 * amplitude

    /// The Helion's radius and the middle of the drawing (where the two half-arcs meet on the axis).
    let r: Double
    let cx: Double
    let cy: Double

    var cl: Double { cx - r }
    var cr: Double { cx + r }

    init(r: Double, cx: Double, cy: Double) {
        self.r = r
        self.cx = cx
        self.cy = cy
    }

    /// The largest drawing that fits a `width` × `height` frame less `inset` on every side, centred.
    init(width: Double, height: Double, inset: Double = 0) {
        let r = max(0, min((width - 2 * inset) / Self.widthInRadii, (height - 2 * inset) / Self.heightInRadii))
        self.init(r: r, cx: width / 2, cy: height / 2)
    }

    // MARK: The lens

    /// The running Preon's stretch of the double arc, as fractions of its length (0 at its left end, 1 at its right).
    static func window(preon: Int) -> ClosedRange<Double> {
        let start = Double(min(preons - 1, max(0, preon))) / (Double(preons - 1) + magnification)
        return start...(start + window)
    }

    /// Where an instant at phase `phase` of Preon `preon` stands along the double arc (0 … 1).
    static func position(preon: Int, phase: Double) -> Double {
        let w = window(preon: preon)
        return w.lowerBound + min(1, max(0, phase)) * window
    }

    // MARK: Points

    /// The point of the Helion's double arc at fraction f of its length, and the unit normal on the right of the way
    /// it runs: outward on the first half-arc, inward on the second (where the wave's first half bulges).
    func arc(_ f: Double) -> (point: CGPoint, side: CGVector) {
        let q = Journal.arcPoint(f, cl: cl, cr: cr, cy: cy, r: r)
        let side = f <= 0.5 ? CGVector(dx: q.nx, dy: q.ny) : CGVector(dx: -q.nx, dy: -q.ny)
        return (CGPoint(x: q.x, y: q.y), side)
    }

    /// The point of Preon `preon`'s wave at its phase `phase`: the journal's double arc of radius `amplitude · r`
    /// laid along the Helion's arc over the Preon's stretch (angle-linear on each half, like the journal's tick).
    func wave(preon: Int, phase: Double) -> CGPoint {
        // the wave's own double arc, 4 radii across, its first half below the axis (y > 0)
        let local = Journal.arcPoint(phase, cl: 1, cr: 3, cy: 0, r: 1)
        let w = Self.window(preon: preon)
        let carrier = arc(w.lowerBound + local.x / 4 * Self.window)
        let lift = local.y * Self.amplitude * r
        return CGPoint(x: carrier.point.x + carrier.side.dx * lift, y: carrier.point.y + carrier.side.dy * lift)
    }

    /// The wave from phase `from` to `to` as a polyline, about a point every 2° of its half-arcs.
    func wave(preon: Int, from p0: Double, to p1: Double) -> [CGPoint] {
        let a = min(1, max(0, p0)), b = min(1, max(a, p1))
        let n = max(1, Int(((b - a) * 180).rounded(.up)))
        return (0...n).map { wave(preon: preon, phase: a + (b - a) * Double($0) / Double(n)) }
    }

    /// The Helion's arc from f0 to f1 as a polyline, about a point every 2°.
    func arc(from f0: Double, to f1: Double) -> [CGPoint] {
        let a = min(1, max(0, f0)), b = min(1, max(a, f1))
        let n = max(1, Int(((b - a) * 180).rounded(.up)))
        return (0...n).map { arc(a + (b - a) * Double($0) / Double(n)).point }
    }

    // MARK: Labels

    /// Where each count goes: the open side of its half-arc, the first one's above the axis over the left half-arc,
    /// the second one's below it under the right one (the drawing turned half a turn), clear of the arcs and of the
    /// wave wherever it rides. `reach` is how far up (and down) the frame allows from the axis.
    func labelRect(first: Bool, reach: Double) -> CGRect {
        // clear of the second half-arc rising from the middle, and of the wave crossing the axis there
        let gap = (Self.amplitude + 0.12) * r
        let width = 2 * r + Self.amplitude * r - gap
        let height = max(0, reach - 0.1 * r)
        let x0 = cx - 2 * r - Self.amplitude * r
        let rect = CGRect(x: x0, y: cy - 0.1 * r - height, width: width, height: height)
        // the second label is the first turned half a turn about the middle
        return first ? rect : CGRect(x: 2 * cx - rect.maxX, y: 2 * cy - rect.maxY, width: rect.width, height: rect.height)
    }
}
