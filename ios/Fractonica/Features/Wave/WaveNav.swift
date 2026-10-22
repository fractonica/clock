import Foundation

// Navigation decisions of the wave (src/ui/wave/nav.js): which level can be followed, what zoom does, how far through
// a half-arc the displayed time is. Plain numbers, checked against the JavaScript.

enum WaveNav {
    static let maxLevel = 13

    /// The level to focus: the selected one unless its half-arcs would change faster than the eye can follow
    /// (`rate` displayed seconds per real second, 0 when paused); then the deepest level that lasts `minLife`.
    static func followableLevel(_ level: Int, rate: Double, reduced: Bool, meanSeconds: (Int) -> Double) -> Int {
        guard rate != 0 else { return level }
        let minLife = reduced ? 1.5 : 0.5
        var l = level
        while l > 0, meanSeconds(l) / 2 / abs(rate) < minLife { l -= 1 }
        return l
    }

    enum ZoomPlan: Equatable, Sendable {
        /// Select a deeper or coarser level (the focus follows).
        case select(Int)
        /// Leave the catalogue for a level.
        case focus(Int)
        /// Show the whole catalogue.
        case overview
        /// Nothing happens; say why.
        case limit(WaveLimit)
    }

    enum WaveLimit: Equatable, Sendable {
        case outOfRange
        case deepest
        case catalogueShown
    }

    /// What a zoom step does: dir > 0 one level deeper, dir < 0 one level out (α leads to the catalogue). `eff` is the
    /// level actually shown (coarser than the selection while a time-lapse runs too fast to follow it).
    static func zoomPlan(inRange: Bool, overview: Bool, level: Int, eff: Int, dir: Int, max: Int = maxLevel) -> ZoomPlan {
        if !inRange { return .limit(.outOfRange) }
        if dir > 0 {
            if overview { return .focus(0) }
            return level < max ? .select(level + 1) : .limit(.deepest)
        }
        if overview { return .limit(.catalogueShown) }
        let from = min(level, eff)
        return from > 0 ? .select(from - 1) : .overview
    }

    /// Whether zooming in and out can act.
    static func zoomEnabled(inRange: Bool, overview: Bool, level: Int, max: Int = maxLevel) -> (zoomIn: Bool, zoomOut: Bool) {
        (inRange && (overview || level < max), inRange && !overview)
    }

    /// Progress 0…1 through the part of half-arc `d` inside the catalogue; the closing instant counts as complete.
    static func throughOf(_ d: WaveHalfInfo, local: Double, t: Double, tMax: Double) -> Double {
        if t >= tMax - 0.001 { return 1 }
        let p = d.clipped ? local / max(1e-9, d.fraction) : local
        return min(1, max(0, p))
    }
}
