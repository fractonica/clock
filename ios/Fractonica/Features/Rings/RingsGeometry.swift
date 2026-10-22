import CoreGraphics
import FractonicaKit

// Pure geometry and cycle maths of the Rings screen (src/ui/rings/geometry.js): no views, no drawing, checked by
// Checks/RingsChecks.swift.
//
// Conventions
//  - A "phase" is the position inside a cycle, 0 ..< 1.
//  - Dial angles run clockwise from 12 o'clock, in phase units (0 ..< 1) unless a name says radians.
//  - Ring 0 is the outermost ring (the shallowest depth shown).

// MARK: - Dial layout

/// The radial slot of one ring: `outer` … `inner`, `mid` its centre line.
struct RingSlot: Equatable, Sendable {
    let outer: CGFloat
    let inner: CGFloat
    var mid: CGFloat { (outer + inner) / 2 }
}

/// What lies under a point of the dial.
enum RingHit: Equatable, Sendable {
    /// Inside the innermost ring, where the read-out sits.
    case hole
    /// On ring `index` (0 = outermost) at dial phase `phase`; `radial` is 0 at the slot's inner edge, 1 at its outer.
    case ring(index: Int, phase: Double, radial: Double)
}

/// Concentric layout of `count` rings in a square (geometry.js `ringLayout` with `dialLayoutOptions`): each ring owns a
/// radial slot of `band` points and is drawn `thick` points wide inside it, so the lane left over carries the funnels.
struct RingLayout: Equatable, Sendable {
    let size: CGFloat
    let center: CGPoint
    let rOuter: CGFloat
    let rHole: CGFloat
    let band: CGFloat
    let thick: CGFloat
    let rings: [RingSlot]

    var count: Int { rings.count }

    /// - Parameters:
    ///   - size: side of the square, points.
    ///   - holeFraction: smallest hole radius as a fraction of the outer radius; a few rings are fat (at most
    ///     `maxBand` each), many share the room the hole leaves. Defaults follow the web dial (0.44 on small dials,
    ///     0.52 from 420 points).
    init(size: CGFloat, count: Int, pad: CGFloat? = nil, holeFraction: CGFloat? = nil, maxBand: CGFloat = 26) {
        let n = max(1, count)
        let small = size < 420
        let pad = pad ?? (small ? 4 : 6)
        let frac = holeFraction ?? (small ? 0.44 : 0.52)
        self.size = size
        center = CGPoint(x: size / 2, y: size / 2)
        let outerRadius = max(8, size / 2 - pad)
        let hole = max(outerRadius * frac, outerRadius - CGFloat(n) * maxBand)
        let slot = (outerRadius - hole) / CGFloat(n)
        rOuter = outerRadius
        rHole = hole
        band = slot
        thick = slot * 0.62
        rings = (0..<n).map { i in
            let outer = outerRadius - CGFloat(i) * slot
            return RingSlot(outer: outer, inner: outer - slot)
        }
    }

    /// The drawn track of ring `i`: its centre line and the radii of its two edges.
    func track(_ i: Int) -> (mid: CGFloat, outer: CGFloat, inner: CGFloat) {
        let mid = rings[i].mid
        return (mid, mid + thick / 2, mid - thick / 2)
    }

    /// The point at `radius` and dial `phase`.
    func point(radius: CGFloat, phase: Double) -> CGPoint {
        RingsMath.point(around: center, radius: radius, phase: phase)
    }

    /// What is under `p` (geometry.js `hitTest`); nil outside the dial.
    func hit(_ p: CGPoint, slack: CGFloat = 1) -> RingHit? {
        let dx = p.x - center.x
        let dy = p.y - center.y
        let r = (dx * dx + dy * dy).squareRoot()
        if r > rOuter + slack { return nil }
        if r < rHole { return .hole }
        let i = min(max(Int(((rOuter - r) / band).rounded(.down)), 0), count - 1)
        let slot = rings[i]
        let radial = min(max((r - slot.inner) / band, 0), 1)
        return .ring(index: i, phase: RingsMath.phase(of: p, around: center), radial: Double(radial))
    }
}

// MARK: - Screen layout

/// How the Rings screen shares its window between the dial and the cycle card.
struct RingsScreenLayout: Equatable, Sendable {
    /// Side of the dial.
    let dial: CGFloat
    /// Width of the card column (wide layouts).
    let card: CGFloat
    let spacing: CGFloat
    /// The window is too short for the ring strip under the dial (iPhone in landscape): the dial takes the whole
    /// height and the strip heads the card column.
    let stripWithCard: Bool

    /// Below this height a wide window keeps the strip with the card.
    static let shortHeight: CGFloat = 480

    /// Side by side when there is width to spare and the window is not tall.
    static func isWide(_ size: CGSize) -> Bool {
        size.width >= 600 && size.width > size.height * 1.05
    }

    /// The dial of the scrolling (tall) layout: the full width, but never taller than the window.
    static func tallDial(_ size: CGSize) -> CGFloat {
        max(200, min(size.width - 24, 720, size.height * 0.92))
    }

    /// The side-by-side layout: the dial never taller than the window (with its strip under it when there is room).
    static func wide(_ size: CGSize) -> RingsScreenLayout {
        if size.height < shortHeight {
            let spacing: CGFloat = 16
            let dial = max(120, min(size.height - 8, size.width * 0.5))
            let card = max(260, min(520, size.width - dial - spacing - 16))
            return RingsScreenLayout(dial: dial, card: card, spacing: spacing, stripWithCard: true)
        }
        let spacing: CGFloat = 24
        let card = min(440, max(320, size.width * 0.36))
        let dial = max(160, min(size.height - 64, size.width - card - spacing - 40))
        return RingsScreenLayout(dial: dial, card: card, spacing: spacing, stripWithCard: false)
    }
}

// MARK: - Plain maths

enum RingsMath {
    static let tau = Double.pi * 2

    /// The point at `radius` around `c` at dial `phase` (0 = 12 o'clock, clockwise).
    static func point(around c: CGPoint, radius r: CGFloat, phase: Double) -> CGPoint {
        let a = phase * tau
        return CGPoint(x: c.x + r * CGFloat(sin(a)), y: c.y - r * CGFloat(cos(a)))
    }

    /// Dial phase (0 ..< 1, clockwise from 12 o'clock) of `p` around `c`.
    static func phase(of p: CGPoint, around c: CGPoint) -> Double {
        var a = atan2(Double(p.x - c.x), -Double(p.y - c.y))
        if a < 0 { a += tau }
        let phase = a / tau
        return phase >= 1 ? 0 : phase
    }

    /// The child sector a phase falls in.
    static func sector(of phase: Double, factor: Int) -> Int {
        min(max(Int((phase * Double(factor)).rounded(.down)), 0), max(0, factor - 1))
    }

    /// The funnel between ring A (outer edge radius `ra`) and ring B (`rb`) for the sector [p0, p1] of ring A: the
    /// sector's edges open smoothly until they cover the whole of ring B, the "zoom" from a cycle into its child.
    /// `left` runs from (ra, p0) to (rb, 0), `right` from (ra, p1) to (rb, 1).
    static func funnel(from ra: CGFloat, to rb: CGFloat, p0: Double, p1: Double, steps: Int = 24)
        -> (left: [(r: CGFloat, phase: Double)], right: [(r: CGFloat, phase: Double)]) {
        var left: [(r: CGFloat, phase: Double)] = []
        var right: [(r: CGFloat, phase: Double)] = []
        for k in 0...steps {
            let s = Double(k) / Double(steps)
            let e = s * s * (3 - 2 * s)
            let r = ra + (rb - ra) * CGFloat(s)
            left.append((r, p0 * (1 - e)))
            right.append((r, p1 + (1 - p1) * e))
        }
        return (left, right)
    }

    /// Extreme value M of a glyph of `strokes` strokes (SPEC §4.1): 4 for two strokes.
    static func glyphExtreme(strokes: Int = 2) -> Int {
        var p = 1
        for _ in 0..<strokes { p *= 3 }
        return (p - 1) / 2
    }

    /// The normalised triangle wave of a cycle: 0 → +1 (peak) → 0 (node) → −1 (valley) → 0.
    static func triangle(_ phase: Double) -> Double {
        let p = min(max(phase, 0), 1)
        if p < 0.25 { return 4 * p }
        if p < 0.75 { return 2 - 4 * p }
        return 4 * p - 4
    }

    /// Signed value of glyph state `index` (0 ..< 4M) of the ascending family (SPEC §4.1).
    static func stateValue(_ index: Int, m: Int = 4) -> Int {
        if index <= m { return index }
        if index <= 3 * m { return 2 * m - index }
        return index - 4 * m
    }

    /// A ring so fast that a crisp hand would only strobe: its turn takes less than half a second of real time.
    /// `speed` is displayed seconds per real second (1 live, 0 paused: nothing moves, nothing blurs).
    static func isBlur(meanSeconds: Double, speed: Double) -> Bool {
        speed > 0 && meanSeconds / speed < 0.5
    }

    /// A ring whose hand Reduce Motion freezes: a turn shorter than two seconds of real time.
    static func isFast(meanSeconds: Double, speed: Double) -> Bool {
        speed > 0 && meanSeconds / speed < 2
    }

    /// How many redraws per real second keep the fastest moving hand honest: each frame moves it at most `step`
    /// points along its ring. Blurred rings have no hand; under Reduce Motion fast rings hold still. 0 when nothing
    /// moves.
    static func redrawRate(rings: [(meanSeconds: Double, radius: CGFloat)], speed: Double, frozenWhenFast: Bool, step: Double = 0.5) -> Double {
        guard speed > 0 else { return 0 }
        var fastest = 0.0
        for ring in rings {
            if isBlur(meanSeconds: ring.meanSeconds, speed: speed) { continue }
            if frozenWhenFast && isFast(meanSeconds: ring.meanSeconds, speed: speed) { continue }
            let turn = ring.meanSeconds / speed // real seconds per turn
            fastest = max(fastest, tau * Double(ring.radius) / turn)
        }
        return fastest / step
    }

    /// A drag that starts at `start` and has moved by `translation` runs along the rings (around `center`) rather than
    /// across them: the tangential part of the motion outweighs the radial one. Radial drags belong to the page scroll.
    static func isTangentialDrag(start: CGPoint, translation: CGSize, center: CGPoint) -> Bool {
        let rx = Double(start.x - center.x)
        let ry = Double(start.y - center.y)
        let len = (rx * rx + ry * ry).squareRoot()
        guard len > 1 else { return false }
        let ux = rx / len
        let uy = ry / len
        let dx = Double(translation.width)
        let dy = Double(translation.height)
        let radial = abs(dx * ux + dy * uy)
        let tangential = abs(dx * uy - dy * ux)
        return tangential > radial * 0.9
    }

    /// Whether a drag that starts on a ring winds its hand. It must run along the ring; in a page that scrolls
    /// vertically it must also not start steeply upwards or downwards, so that a thumb scrolling over the dial's 3 and
    /// 9 o'clock sides (where a ring runs vertically) still scrolls the page instead of moving the time. Once a winding
    /// has begun it may go any way round.
    static func beginsWinding(start: CGPoint, translation: CGSize, center: CGPoint, inVerticalScroll: Bool) -> Bool {
        guard isTangentialDrag(start: start, translation: translation, center: center) else { return false }
        guard inVerticalScroll else { return true }
        return abs(translation.height) < abs(translation.width) * 1.5
    }

    /// A drag that moves sideways by more than `slop` and more than it moves vertically (a scrub, not a scroll).
    static func isHorizontalDrag(_ translation: CGSize, slop: CGFloat = 6) -> Bool {
        abs(translation.width) > slop && abs(translation.width) > abs(translation.height)
    }

    /// The signed step from phase `a` to phase `b` the short way round, in (−0.5, 0.5]: a hand dragged past
    /// 12 o'clock moves on by a little, it does not jump back by a whole turn.
    static func unwrappedStep(from a: Double, to b: Double) -> Double {
        var d = b - a
        d -= d.rounded()
        return d == -0.5 ? 0.5 : d
    }
}

// MARK: - Waveform plot

/// Plot rectangle and axis mappings of the waveform inset (geometry.js `waveLayout`): `x` by phase, `y` by the
/// normalised value −1 … 1.
struct WaveLayout: Equatable, Sendable {
    let x0: CGFloat
    let x1: CGFloat
    let y0: CGFloat
    let y1: CGFloat

    init(width: CGFloat, height: CGFloat, left: CGFloat = 30, right: CGFloat = 12, top: CGFloat = 24, bottom: CGFloat = 30) {
        x0 = left
        x1 = max(left + 40, width - right)
        y0 = top
        y1 = max(top + 40, height - bottom)
    }

    var yMid: CGFloat { (y0 + y1) / 2 }
    var amplitude: CGFloat { (y1 - y0) / 2 * 0.9 }

    func x(_ phase: Double) -> CGFloat { x0 + CGFloat(min(max(phase, 0), 1)) * (x1 - x0) }
    func phase(atX x: CGFloat) -> Double { Double(min(max((x - x0) / (x1 - x0), 0), 1)) }
    func y(_ value: Double) -> CGFloat { yMid - CGFloat(value) * amplitude }
}

// MARK: - Depth range

/// The rings the dial shows: levels `minLevel … maxLevel` (depths minLevel + 1 …), outermost first.
struct DepthRange: Equatable, Sendable {
    var minLevel: Int
    var maxLevel: Int

    static let deepest = Fractonica.maxLevel

    /// From the shared depth settings (1 … 14), made safe whatever they hold.
    init(minDepth: Int, maxDepth: Int) {
        minLevel = min(max(minDepth - 1, 0), Self.deepest)
        maxLevel = min(max(maxDepth - 1, minLevel), Self.deepest)
    }

    init(minLevel: Int, maxLevel: Int) {
        self.minLevel = min(max(minLevel, 0), Self.deepest)
        self.maxLevel = min(max(maxLevel, self.minLevel), Self.deepest)
    }

    var levels: [Int] { Array(minLevel...maxLevel) }
    var count: Int { maxLevel - minLevel + 1 }
    var minDepth: Int { minLevel + 1 }
    var maxDepth: Int { maxLevel + 1 }

    func contains(_ level: Int) -> Bool { level >= minLevel && level <= maxLevel }

    /// The smallest range that holds this one and `level`.
    func widened(to level: Int) -> DepthRange {
        DepthRange(minLevel: min(minLevel, level), maxLevel: max(maxLevel, level))
    }

    /// One step of a range control: `outer` moves the outermost ring (−1 shows one more outer ring), else the
    /// innermost (+1 shows one more inner ring). The range never empties.
    func stepped(outer: Bool, by d: Int) -> DepthRange {
        if outer { return DepthRange(minLevel: min(max(minLevel + d, 0), maxLevel), maxLevel: maxLevel) }
        return DepthRange(minLevel: minLevel, maxLevel: min(max(maxLevel + d, minLevel), Self.deepest))
    }

    /// `level` moved inside the range (the selection follows a range that leaves it behind).
    func clamp(_ level: Int) -> Int { min(max(level, minLevel), maxLevel) }
}

// MARK: - Cycles on the clock

/// A child cycle (level + 1) of a cycle: a sector of a ring.
struct ChildCycle: Equatable, Sendable {
    let level: Int
    /// Global cycle index at `level`.
    let index: Int64
    /// Its place in the parent, 0-based (the sector).
    let local: Int
    let start: Double
    let end: Double
    /// The catalogue ends inside it.
    let clipped: Bool
    var duration: Double { end - start }
}

/// Where a quarter-threshold control sends the clock (geometry.js `thresholdJump`).
enum ThresholdJump: Equatable, Sendable {
    /// 1 ms past an instant before (`back`) or after (`ahead`) the displayed time.
    case back(Double)
    case ahead(Double)
    /// The clock stands at the catalogue's closing instant already.
    case end
    /// The clock stands there already.
    case here
    /// The threshold lies beyond the catalogue.
    case void

    var time: Double? {
        switch self {
        case .back(let t), .ahead(let t): t
        default: nil
        }
    }
}

/// Cycle ↔ time helpers on the clock (geometry.js `timeAtPhase`, `phaseLimit`, `childCycle`, `scrubTime`).
struct RingsCycles: Sendable {
    let clock: FractonicaClock

    init(clock: FractonicaClock = .shared) {
        self.clock = clock
    }

    /// The time at fractional position `phase` of cycle `cycle` of `level`, linear in Saros position (so it follows
    /// the uneven catalogue intervals); model.js `cycleStartTime` with a fractional index. Nil beyond the catalogue.
    func time(level: Int, cycle: Int64, phase: Double) -> Double? {
        guard Fractonica.supportedLevels.contains(level), cycle >= 0 else { return nil }
        let p = clock.levelInfo(level).prefixDouble
        let n = (Double(cycle) + min(max(phase, 0), 1)) * 4
        let k = (n / p).rounded(.down)
        let extent = Double(clock.extent)
        if k > extent { return nil }
        if k == extent { return n - k * p == 0 ? clock.tMax : nil }
        guard k >= 0 else { return nil }
        let i = Int(k)
        let f = (n - k * p) / p
        return clock.catalogue[i] + f * (clock.catalogue[i + 1] - clock.catalogue[i])
    }

    /// Highest phase the catalogue reaches inside cycle `cycle` of `level`: 1 for a whole cycle, less for the last,
    /// clipped one.
    func phaseLimit(level: Int, cycle: Int64) -> Double {
        let total = Double(clock.extent) * clock.levelInfo(level).prefixDouble / 4
        let room = total - Double(cycle)
        return room >= 1 ? 1 : min(max(room, 0), 1)
    }

    /// Child `j` (0-based sector) of cycle `cycle` of `level`; nil when it starts at or beyond the catalogue's end or is
    /// finer than the deepest level shown.
    func child(level: Int, cycle: Int64, sector j: Int, maxLevel: Int = Fractonica.maxLevel) -> ChildCycle? {
        let cl = level + 1
        guard cl <= maxLevel else { return nil }
        let factor = clock.levelInfo(level).factor
        guard j >= 0, j < factor else { return nil }
        let index = cycle * Int64(factor) + Int64(j)
        guard let start = clock.cycleStartTime(level: cl, index: index), start < clock.tMax else { return nil }
        let next = clock.cycleStartTime(level: cl, index: index + 1)
        return ChildCycle(level: cl, index: index, local: j, start: start, end: next ?? clock.tMax, clipped: next == nil)
    }

    /// Where a scrub lands: position `phase` of cycle `cycle` of `level`, kept strictly inside that cycle on the
    /// clock's 1 ms grid (a bare `end − ε` of a short cycle would otherwise round into the next one). `snap` lands just
    /// past the exact instant, so the state that starts there shows. Nil beyond the catalogue.
    func scrubTime(level: Int, cycle: Int64, phase: Double, snap: Bool = false) -> Double? {
        let limit = phaseLimit(level: level, cycle: cycle)
        let p = min(max(phase, 0), limit)
        guard var t = time(level: level, cycle: cycle, phase: p) else { return nil }
        if snap || p < 1e-6 { t += 0.001 }
        let endT = limit >= 1 ? (time(level: level, cycle: cycle, phase: 1) ?? clock.tMax) : clock.tMax
        let endMs = endT * 1000
        let onGrid = abs(endMs - endMs.rounded()) < 1e-3
        let latest = (onGrid ? endMs.rounded() - 1 : endMs.rounded(.down)) / 1000
        let startT = time(level: level, cycle: cycle, phase: 0) ?? t
        return max(startT, min(t, latest))
    }

    /// Where a scrub by a continuous cycle position lands: `position` counts cycles of `level` (cycle index plus
    /// phase), so a hand dragged on past 12 o'clock moves into the next cycle. Clamped to the catalogue.
    func scrubTime(level: Int, position: Double) -> Double? {
        let total = Double(clock.extent) * clock.levelInfo(level).prefixDouble / 4
        let pos = min(max(position, 0), total)
        // the catalogue's closing instant is the last moment of the last (possibly clipped) cycle
        let cycle = min(pos.rounded(.down), max(0, total.rounded(.up) - 1))
        guard let index = Int64(exactly: cycle) else { return nil }
        return scrubTime(level: level, cycle: index, phase: pos - cycle)
    }

    /// geometry.js `thresholdJump`: 1 ms past the threshold so the state that starts there shows; a threshold already
    /// passed in the cycle on show is a jump back to it. Only the catalogue's closing instant is a dead end.
    func thresholdJump(_ threshold: Double?, now: Double) -> ThresholdJump {
        guard let threshold, threshold.isFinite else { return .void }
        let time = min(threshold + 0.001, clock.tMax)
        if abs(time - now) < 1e-6 { return time >= clock.tMax - 1e-6 ? .end : .here }
        return time < now ? .back(time) : .ahead(time)
    }
}
