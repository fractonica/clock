import CoreGraphics
import FractonicaKit
import Foundation

/// Where everything sits on the analog dial (no SwiftUI: checked by Analog/Checks). Lengths are in units of the
/// polished bezel's radius, from the dial's centre, y down; turns are fractions of a full turn, 0 at the top, clockwise.
///
///     1.13  case edge          the engraved bezel: the Helion's 16 glyph states, each where it begins
///     1.00  polished bezel     down to 0.94, the Nuclide's rider on its inner edge
///     0.94  chapter ring       the Nuclide: 77 Helion ticks, the ζ numbers, its Pentads (an inner track at 0.82)
///     0.80  dial               sunray; the Flavon railway (0.745 … 0.785), the θ numbers (0.70), applied indices
///                              (0.565 … 0.66) with the Preon dots between; the registers, the balance's aperture and
///                              the Helion window inside
struct AnalogGeometry: Equatable, Sendable {
    let size: CGSize
    let center: CGPoint
    /// The polished bezel's radius in points: the unit of every length here (the engraved bezel reaches out to
    /// `caseOuter`).
    let radius: CGFloat

    /// The case (the engraved bezel's edge) fills this much of the frame's half side, its shadow the rest.
    static let caseFraction: CGFloat = 0.98

    init(size: CGSize) {
        self.size = size
        center = CGPoint(x: size.width / 2, y: size.height / 2)
        radius = max(0, min(size.width, size.height) / 2 * Self.caseFraction / Self.caseOuter)
    }

    /// A dial point (units) in points.
    func point(_ u: CGPoint) -> CGPoint {
        CGPoint(x: center.x + u.x * radius, y: center.y + u.y * radius)
    }

    /// A dial length (units) in points.
    func length(_ u: CGFloat) -> CGFloat { u * radius }

    /// A hairline that stays visible: `u` units, never thinner than `minimum` points.
    func line(_ u: CGFloat, minimum: CGFloat = 0.5) -> CGFloat { max(minimum, u * radius) }

    /// The point at `turn` and distance `r` from `c` (all in units).
    static func polar(_ turn: Double, _ r: CGFloat, around c: CGPoint = .zero) -> CGPoint {
        let a = 2 * Double.pi * turn
        return CGPoint(x: c.x + r * CGFloat(sin(a)), y: c.y - r * CGFloat(cos(a)))
    }

    /// The same in points.
    func polar(_ turn: Double, _ r: CGFloat, around c: CGPoint = .zero) -> CGPoint {
        point(Self.polar(turn, r, around: c))
    }

    // MARK: Radii

    /// The engraved bezel, from the polished one out to the case's edge.
    static let caseOuter: CGFloat = 1.13
    static let bezelInner: CGFloat = 0.94
    static let flangeInner: CGFloat = 0.80
    /// The 77 Helion ticks: minor from 0.932 to 0.905, the first of each ζ to 0.885.
    static let ringTickOuter: CGFloat = 0.932
    static let ringTickInner: CGFloat = 0.906
    static let ringTickMajor: CGFloat = 0.884
    /// The ζ numbers (1, 12 … 67).
    static let ringNumbers: CGFloat = 0.857
    /// The ring's Pentad track and its start marks.
    static let ringPentads: CGFloat = 0.819

    /// The Flavon railway, the Preon hand's track: two circles and 65 ticks between.
    static let railOuter: CGFloat = 0.785
    static let railInner: CGFloat = 0.745
    /// The θ numbers (4, 8 … 32).
    static let thetaNumbers: CGFloat = 0.70
    /// The applied θ indices.
    static let indexInner: CGFloat = 0.565
    static let indexOuter: CGFloat = 0.66
    static let indexWidth: CGFloat = 0.036
    /// The top index is double and shorter (the Pentad register stands under it).
    static let topIndexInner: CGFloat = 0.58
    /// The Preons between the indices, as dots (the Helion hand's 36 places with the indices).
    static let preonDots: CGFloat = 0.622
    static let preonDotRadius: CGFloat = 0.0085
    /// The Helion's quarters (peak, node, valley) on the dial, outside the indices.
    static let quarterMarks: CGFloat = 0.712

    // MARK: The engraved glyphs

    /// The glyphs' middle (dot included) and height, and their ink in design units: cut lines, bolder than print's 0.3
    /// (SPEC §9.1), the dot as much larger and as far from the stem.
    static let glyphRadius: CGFloat = 1.066
    static let glyphHeight: CGFloat = 0.104
    static let glyphInk: CGFloat = 0.6
    /// The dot's centre above the stem's top and its radius, in design units.
    static var glyphDot: (y: CGFloat, radius: CGFloat) { (-1 - 2.5 * glyphInk, glyphInk) }
    /// A glyph's extent in design units, from its dot's top to its stem's foot.
    static var glyphSpan: (top: CGFloat, foot: CGFloat) {
        (glyphDot.y - glyphDot.radius, 3 * CGFloat(AnalogDial.glyphStrokes) + glyphInk / 2)
    }

    /// Glyph state k's design units (SPEC §9.1) in units: at the turn where the state begins, its stem along the
    /// radius, the stem's top (and the dot) outward, so the top glyph stands upright and the bottom one on its head.
    static func glyph(_ k: Int) -> CGAffineTransform {
        let span = glyphSpan
        let s = glyphHeight / (span.foot - span.top)
        let a = 2 * Double.pi * Double(k) / Double(AnalogDial.glyphStates)
        let out = CGVector(dx: CGFloat(sin(a)), dy: CGFloat(-cos(a)))
        let along = CGVector(dx: CGFloat(cos(a)), dy: CGFloat(sin(a))) // clockwise
        let top = glyphRadius + (span.top + span.foot) / 2 * s // where the stem's top lands
        return CGAffineTransform(a: s * along.dx, b: s * along.dy, c: -s * out.dx, d: -s * out.dy,
                                 tx: top * out.dx, ty: top * out.dy)
    }

    // MARK: Parts

    /// A round part of the dial: centre and radius in units.
    struct Disc: Equatable, Sendable {
        let center: CGPoint
        let radius: CGFloat

        func contains(_ p: CGPoint, margin: CGFloat = 0) -> Bool {
            hypot(p.x - center.x, p.y - center.y) <= radius + margin
        }
    }

    /// The Pentad register at 12 o'clock: the solar sync's 19 Helions.
    static let pentadRegister = Disc(center: CGPoint(x: 0, y: -0.365), radius: 0.178)
    /// The Flavon register at 6 o'clock: 25 Blinks.
    static let flavonRegister = Disc(center: CGPoint(x: 0, y: 0.372), radius: 0.215)
    /// The balance's aperture at 9 o'clock.
    static let aperture = Disc(center: CGPoint(x: -0.41, y: 0.03), radius: 0.14)
    /// The Helion window at 3 o'clock (its opening).
    static let window = CGRect(x: 0.33, y: -0.062, width: 0.17, height: 0.124)

    /// θ index k (0 … 8) from its inner to its outer end, in units.
    static func index(_ k: Int) -> (inner: CGPoint, outer: CGPoint) {
        let turn = Double(k) / 9
        return (polar(turn, k == 0 ? topIndexInner : indexInner), polar(turn, indexOuter))
    }

    // MARK: Hands (lengths in units of the bezel's radius, or of their register's radius)

    /// The Helion hand reaches the indices and the Preon dots; the Preon hand, long and thin, the railway.
    static let helionHand: CGFloat = 0.645
    static let helionTail: CGFloat = 0.17
    static let preonHand: CGFloat = 0.775
    static let preonTail: CGFloat = 0.21
    /// The Nuclide's rider on the bezel: its point at the Helion ticks, its back on the polished steel.
    static let riderTip: CGFloat = 0.936
    static let riderBack: CGFloat = 0.99
    static let riderWidth: CGFloat = 0.05
    /// Register hands, in units of their register's radius.
    static let registerHand: CGFloat = 0.9
    static let registerTail: CGFloat = 0.28
}
