import CoreGraphics
import Foundation

/// Where the pitch ring puts things (src/ui/sound/ring.js): the angle is the pitch class folded into one octave (the
/// ground at the top, clockwise, twelve spokes of 100 cents), the radius the depth (α outside, ξ inside). Levels that
/// share a pitch class (θ and ι) sit on one spoke at different radii. Pure geometry, so the logic checks can hit-test it.
struct SoundRingGeometry: Sendable {
    let center: CGPoint
    /// Radius of α's ring and of ξ's.
    let outer: CGFloat
    let inner: CGFloat
    let levels: Int

    /// `labelRoom`: space kept outside α's ring for the spoke labels.
    init(size: CGSize, labelRoom: CGFloat, levels: Int = SoundTuning.levelCount) {
        center = CGPoint(x: size.width / 2, y: size.height / 2)
        outer = max(10, min(size.width, size.height) / 2 - labelRoom)
        inner = outer * 0.44
        self.levels = levels
    }

    func radius(_ level: Int) -> CGFloat {
        outer - (outer - inner) * CGFloat(level) / CGFloat(max(1, levels - 1))
    }

    /// Radians of a pitch class, the ground at the top, clockwise.
    func angle(cents: Double) -> Double { -Double.pi / 2 + cents / 1200 * 2 * Double.pi }

    func point(radius r: CGFloat, cents: Double) -> CGPoint {
        let a = angle(cents: cents)
        return CGPoint(x: center.x + CGFloat(cos(a)) * r, y: center.y + CGFloat(sin(a)) * r)
    }

    func point(level: Int, cents: Double) -> CGPoint { point(radius: radius(level), cents: cents) }

    /// The level whose dot lies within `slop` points of `p`, the nearest one; nil when none does.
    func hit(_ p: CGPoint, cents: [Double], slop: CGFloat = 22) -> Int? {
        var best: Int?
        var bestDistance = slop * slop
        for (level, c) in cents.enumerated() {
            let q = point(level: level, cents: c)
            let d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y)
            if d <= bestDistance {
                best = level
                bestDistance = d
            }
        }
        return best
    }
}

/// Which labels of a row of ticks have room: walk them left to right and label one when it stands more than `gap`
/// points right of the last label (scope.js `labelSlots`; the ticks come in level order, not in frequency order).
func soundLabelSlots(_ items: [(key: Int, x: CGFloat)], gap: CGFloat = 13) -> Set<Int> {
    var out = Set<Int>()
    var last = -CGFloat.infinity
    for item in items.sorted(by: { $0.x < $1.x }) where item.x - last > gap {
        out.insert(item.key)
        last = item.x
    }
    return out
}
