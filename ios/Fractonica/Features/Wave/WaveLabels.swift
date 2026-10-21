import Foundation

/// Puts labels next to points on the side that is free (src/ui/wave/draw.js `placeLabel`), so labels never sit on
/// each other or on the dots while there is room, and stay put from frame to frame.
///
/// Each label tries the outward normal first, then the inward one, the tangents and the diagonals, near and far, and
/// keeps the spot that overlaps the least with what is already placed (and stays on the stage). Steadiness: the width
/// is measured on a stand-in with every digit as "0" (a ticking time never changes size); a label keeps its spot,
/// found again by its key next frame, until that spot is genuinely blocked; and when it moves it glides there.
struct WaveLabelPlacer {
    /// Weighted area (pt²) of overlap a label tolerates at its current spot before it moves.
    static let keep = 90.0
    /// Extra distance from the point, nearest first.
    static let gaps = [0.0, 12, 26]
    /// The weight of quiet labels (loop numbers, event names) when a label looks for room.
    static let soft = 0.2
    /// Time constant of a label's glide to a new spot (seconds) and the most it moves per frame (points).
    static let glide = 0.07
    static let maxStep = 14.0
    static let halfHeight = 8.0

    struct Spot {
        /// The centre of the text.
        var center: WavePoint
        var rect: WaveRect
        /// Which candidate it took.
        var slot: Int
        var cost: Double
    }

    private struct Memory {
        var slot: Int
        var ox: Double
        var oy: Double
        var t: Double
    }

    private var stage = WaveRect(x0: 4, y0: 4, x1: 396, y1: 296)
    private var occupied: [(rect: WaveRect, weight: Double)] = []
    private var memory: [String: Memory] = [:]
    private var now = 0.0
    /// A label is still gliding: the next frame has to be drawn too.
    private(set) var settling = false

    /// Starts a frame on a stage (labels keep 4 points from its edges); `now` in seconds.
    mutating func begin(stage: WaveRect, now: Double) {
        self.stage = stage.inset(by: 4)
        self.now = now
        occupied.removeAll(keepingCapacity: true)
        settling = false
    }

    /// Forgets every remembered spot (a new vocabulary, a new size).
    mutating func forget() { memory.removeAll() }

    /// Marks a rectangle as taken (a dot, a label placed without the placer).
    mutating func occupy(_ rect: WaveRect, weight: Double = 1) {
        occupied.append((rect, weight))
    }

    /// The cost of a candidate rectangle: what pokes out of the stage, and the weighted overlap with what is placed.
    private func cost(_ box: WaveRect) -> Double {
        let area = box.width * box.height
        var c = 3 * (area - box.overlap(stage))
        for o in occupied { c += o.weight * box.overlap(o.rect) }
        return c
    }

    /// Places a label `width` points wide next to `point`, starting along the unit `normal`, at least `clearance`
    /// points from it, and marks it taken with `weight`.
    mutating func place(key: String, text: String, width: Double, at point: WavePoint, normal: WavePoint,
                        clearance: Double = 12, weight: Double = 1) -> Spot {
        let hw = width / 2 + 3
        let hh = Self.halfHeight
        let nx = normal.x
        let ny = normal.y
        let dirs: [(Double, Double)] = [
            (nx, ny), (-nx, -ny), (-ny, nx), (ny, -nx),
            ((nx - ny) * 0.71, (ny + nx) * 0.71), ((-nx - ny) * 0.71, (-ny + nx) * 0.71),
            ((nx + ny) * 0.71, (ny - nx) * 0.71), ((-nx + ny) * 0.71, (-ny - nx) * 0.71),
        ]
        let x = point.x
        let y = point.y
        func spot(_ i: Int, margin: Double) -> Spot {
            let gap = Self.gaps[i / dirs.count]
            let (dx, dy) = dirs[i % dirs.count]
            // the nearest the rectangle can sit along (dx, dy) without touching the point's clearance box
            let s = min(abs(dx) > 1e-6 ? (hw + clearance) / abs(dx) : .infinity, abs(dy) > 1e-6 ? (hh + clearance) / abs(dy) : .infinity)
            // slid back onto the stage when it would poke out
            let cx = max(stage.x0 + hw, min(stage.x1 - hw, x + dx * (s + gap)))
            let cy = max(stage.y0 + hh, min(stage.y1 - hh, y + dy * (s + gap)))
            let rect = WaveRect(x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh)
            let box = margin > 0 ? rect.inset(by: -margin) : rect
            return Spot(center: WavePoint(x: cx, y: cy), rect: rect, slot: i, cost: cost(box) + gap * 0.01)
        }
        let n = Self.gaps.count * dirs.count
        let last = memory[key]
        let held = last.map { spot($0.slot, margin: 0) }
        var best: Spot
        if let held, held.cost < Self.keep {
            best = held
        } else {
            // the nearest spot free with room around it, else the one that collides least
            var found: Spot?
            for i in 0..<n {
                let c = spot(i, margin: 5)
                if c.cost < 1 {
                    found = c
                    break
                }
            }
            if let found {
                best = found
            } else {
                var least = spot(0, margin: 0)
                for i in 1..<n {
                    let c = spot(i, margin: 0)
                    if c.cost < least.cost { least = c }
                }
                // everything collides: do not hop for a marginal gain
                if let held, held.cost - least.cost < Self.keep / 2 { least = held }
                best = least
            }
        }
        occupied.append((best.rect, weight))
        // ease towards the spot, measured from the point so that following the point costs no lag
        let tx = best.center.x - x
        let ty = best.center.y - y
        var ox = tx
        var oy = ty
        if let last {
            let dist = hypot(tx - last.ox, ty - last.oy)
            if dist > 0, dist < 160, now > last.t, now - last.t < 0.4 {
                let k = min(1, Self.maxStep / dist, 1 - exp(-(now - last.t) / Self.glide))
                ox = last.ox + (tx - last.ox) * k
                oy = last.oy + (ty - last.oy) * k
            }
        }
        if hypot(ox - tx, oy - ty) > 0.4 { settling = true }
        memory[key] = Memory(slot: best.slot, ox: ox, oy: oy, t: now)
        if memory.count > 200 { memory.removeAll() }
        return Spot(center: WavePoint(x: x + ox, y: y + oy), rect: best.rect, slot: best.slot, cost: best.cost)
    }
}
