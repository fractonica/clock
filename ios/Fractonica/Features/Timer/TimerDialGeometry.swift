import CoreGraphics

/// Where the dial's rings go and what they show: pure layout maths, checked by Features/Timer/Checks.
struct TimerDialGeometry {
    let rings: Int
    /// The dial's side in points.
    let side: CGFloat

    /// The radius inside the innermost phase ring, as a fraction of half the dial (room for the readout).
    static func innerRadius(rings: Int) -> CGFloat {
        switch rings {
        case ...2: 0.72
        case 3: 0.69
        default: 0.66
        }
    }

    private var half: CGFloat { side / 2 }
    private var unit: CGFloat { side / 320 }

    var outerRadius: CGFloat { half - 6 * unit }
    var outerWidth: CGFloat { 5 * unit }

    /// The band the phase rings share: from just inside the outer ring to the readout's room.
    private var bandOuter: CGFloat { outerRadius - outerWidth / 2 - 9 * unit }
    private var bandInner: CGFloat { half * Self.innerRadius(rings: rings) + 3 * unit }
    private var pitch: CGFloat { (bandOuter - bandInner) / CGFloat(max(1, rings)) }

    /// A ring's stroke width: a little over half its pitch, at most 9 pt at the reference size.
    var ringWidth: CGFloat { min(pitch * 0.56, 9 * unit) }

    /// The centre line of ring `i` (0 = outermost).
    func ringRadius(_ i: Int) -> CGFloat {
        bandOuter - pitch * (CGFloat(i) + 0.5)
    }

    /// How many segments of `unit`'s ring are lit for `blinks` left (with the fraction of the one being used up): the
    /// count of the unit left inside its parent. `whole` lights exactly the readout's count (Blinks rounded up, as the
    /// countdown shows them). Helions are capped at a full ring; nil or nothing left lights none.
    static func ringValue(blinks: Double?, unit: LadderUnit, whole: Bool) -> Double {
        guard let blinks, blinks.isFinite, blinks > 0 else { return 0 }
        let cap = Double(unit.perParent)
        if whole { return min(cap, Double(LadderSpan(blinks: LadderReadout.ceilBlinks(blinks)).count(unit))) }
        let x = blinks / Double(unit.blinks)
        return unit == .eta ? min(cap, x) : x.truncatingRemainder(dividingBy: cap)
    }
}
