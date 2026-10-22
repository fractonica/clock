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

    /// The segments of `unit`'s ring at radius `r` with band `width`: one per unit in the next one up, from the top
    /// clockwise, as angle ranges in radians (0 at three o'clock, growing clockwise on screen). Gaps are arc lengths, so
    /// every ring has the same rhythm whatever its count; the gap at each depth between (ζ θ κ μ) is wider.
    static func segments(_ unit: LadderUnit, radius r: CGFloat, width: CGFloat) -> [ClosedRange<Double>] {
        (0..<unit.perParent).map { segment(unit, $0, radius: r, width: width) }
    }

    /// Segment `k` of `unit`'s ring alone (no allocation, for drawing every frame).
    static func segment(_ unit: LadderUnit, _ k: Int, radius r: CGFloat, width: CGFloat) -> ClosedRange<Double> {
        let n = unit.perParent
        let gap = Double(max(2.2, width * 0.42) / max(1, r))
        let groupGap = gap * 2.4
        let step = 2 * Double.pi / Double(n)
        let leading = k % unit.group == 0 ? groupGap : gap
        let trailing = (k + 1) % unit.group == 0 || k + 1 == n ? groupGap : gap
        let a0 = -Double.pi / 2 + Double(k) * step + leading / 2
        let a1 = -Double.pi / 2 + Double(k + 1) * step - trailing / 2
        return a0...max(a0, a1)
    }

    /// The value a ring shows every frame: `ringValue` with the readout's thousandth-of-a-Blink slack (`ceilBlinks`),
    /// so that its whole part is exactly `steadySegments` and the two layers always fit together.
    static func movingValue(blinks: Double?, unit: LadderUnit) -> Double {
        guard let blinks, blinks.isFinite, blinks > 1e-3 else { return 0 }
        return ringValue(blinks: blinks - 1e-3, unit: unit, whole: false)
    }

    /// Segments that stay fully lit for the whole Blink now running (`blinks` left, the readout showing it rounded up):
    /// the count left once this Blink is used up. The segment being used up is drawn by itself, shrinking.
    static func steadySegments(blinks: Double?, unit: LadderUnit) -> Int {
        guard let blinks, blinks.isFinite, blinks > 0 else { return 0 }
        let after = Double(max(0, LadderReadout.ceilBlinks(blinks) - 1))
        return Int(ringValue(blinks: after, unit: unit, whole: false).rounded(.down))
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
