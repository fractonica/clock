import FractonicaKit
import Foundation

/// A cycle drawn in a lane: its global index, its place in the parent and its start and end.
struct TimelineBlock: Sendable, Equatable {
    let idx: Int64
    let local: Int
    let start: Double
    let end: Double
}

/// Everything the painter needs from the clock, cached so that a frame costs a few array walks instead of engine
/// queries (src/ui/timeline/data.js). Block lists come from `boundaries` on a padded window and are reused while the
/// view slides inside it; axis items are cached per step on a window three times as wide as the view; names and labels
/// are memoised. Not thread-safe: used from the main actor only.
@MainActor
final class TimelineData {
    let clock: FractonicaClock
    let notation: Notation
    let ruler: TimelineRuler
    let limits: TimelineLimits
    /// The α cycles, for the catalogue map.
    let alpha: [TimelineBlock]

    /// The most blocks one query returns; a cycle is never longer than 1.6 × its level's mean.
    static let maxBlocks = 4000
    static let slack = 1.6
    /// Boundary tolerance (s): a cursor exactly on a cycle start still counts as inside that cycle.
    static let eps = 1e-4

    private struct BlockEntry {
        let lo: Double
        let hi: Double
        let blocks: [TimelineBlock]
    }

    private struct ItemEntry<T> {
        let from: Double
        let to: Double
        let items: T
    }

    private var blockCache: [Int: BlockEntry] = [:]
    private var currentCache: [Int: TimelineBlock] = [:]
    private var tickCache: [String: ItemEntry<[TimelineTick]>] = [:]
    private var spanCache: [String: ItemEntry<[TimelineSpan]>] = [:]
    private var nameCache: [Int64: (name: String, short: String)] = [:]

    init(clock: FractonicaClock = .shared, notation: Notation = .standard) {
        self.clock = clock
        self.notation = notation
        ruler = TimelineRuler(clock: clock, notation: notation)
        limits = TimelineLimits(tMin: clock.tMin, tMax: clock.tMax)
        alpha = clock.boundaries(level: 0, from: clock.tMin, to: clock.tMax, limit: 64)
            .filter { $0.time < clock.tMax }
            .map { b in
                TimelineBlock(idx: b.idx, local: b.local, start: b.time,
                              end: clock.cycleStartTime(level: 0, index: b.idx + 1) ?? clock.tMax)
            }
    }

    /// The one cache the app uses (the timeline keeps its window between visits, as the web view's closure does).
    static let shared = TimelineData()

    // MARK: Lanes

    /// The blocks of `level` overlapping [t0, t1], sorted by start; the list may run beyond the window.
    func blocks(_ level: Int, _ t0: Double, _ t1: Double) -> [TimelineBlock] {
        let mean = clock.levelInfo(level).meanSeconds
        let need0 = t0 - Self.slack * mean
        let need1 = t1 + Self.slack * mean
        if let e = blockCache[level], e.lo <= need0, e.hi >= need1 { return e.blocks }
        let span = t1 - t0
        let lo = need0 - span
        let hi = need1 + span
        let bs = clock.boundaries(level: level, from: lo, to: hi, limit: Self.maxBlocks)
        var blocks: [TimelineBlock] = []
        blocks.reserveCapacity(bs.count)
        for b in bs where b.time < clock.tMax { // deep levels list a zero-length cycle at the closing instant
            let end = clock.cycleStartTime(level: level, index: b.idx + 1) ?? clock.tMax
            blocks.append(TimelineBlock(idx: b.idx, local: b.local, start: b.time, end: end))
        }
        let reached = bs.count >= Self.maxBlocks ? (bs.last?.time ?? hi) : hi
        blockCache[level] = BlockEntry(lo: lo, hi: reached, blocks: blocks)
        return blocks
    }

    private func contains(_ c: TimelineBlock, _ t: Double) -> Bool {
        t + Self.eps >= c.start && (t + Self.eps < c.end || (c.end >= clock.tMax && t <= clock.tMax + Self.eps))
    }

    /// The cycle of `level` that contains t, or nil outside the catalogue (cached until t leaves it).
    func cycle(_ level: Int, at t: Double) -> TimelineBlock? {
        if let c = currentCache[level], contains(c, t) { return c }
        guard t + Self.eps >= clock.tMin, t <= clock.tMax + Self.eps else {
            currentCache[level] = nil
            return nil
        }
        let mean = clock.levelInfo(level).meanSeconds
        let bs = clock.boundaries(level: level, from: t - Self.slack * mean, to: t + 0.2 * mean, limit: 8)
        guard let pick = bs.last(where: { $0.time <= t + Self.eps && $0.time < clock.tMax }) else { return nil }
        let end = clock.cycleStartTime(level: level, index: pick.idx + 1) ?? clock.tMax
        let c = TimelineBlock(idx: pick.idx, local: pick.local, start: pick.time, end: end)
        guard contains(c, t) else { return nil }
        currentCache[level] = c
        return c
    }

    /// The time of quarter boundary q (0 … 4) of cycle `idx` of `level` (float).
    func quarterTime(_ level: Int, _ idx: Int64, _ q: Int) -> Double {
        clock.time(atPosition: Double(4 * idx + Int64(q)) / clock.levelInfo(level).prefixDouble)
    }

    // MARK: Names (pure mode)

    /// "Delta Trifracton" / "δ#3", "ε#5 34η" / "34η": the name and short form of a cycle. Memoised (exact arithmetic).
    func names(_ level: Int, _ idx: Int64) -> (name: String, short: String) {
        let key = idx &* 32 &+ Int64(level)
        if let v = nameCache[key] { return v }
        if nameCache.count > 8000 { nameCache.removeAll(keepingCapacity: true) }
        let v = (notation.cycleName(level: level, cycle: idx), notation.cycleShort(level: level, cycle: idx))
        nameCache[key] = v
        return v
    }

    // MARK: Axis

    private func cached<T>(_ cache: inout [String: ItemEntry<T>], _ key: String, _ t0: Double, _ t1: Double,
                           _ make: (Double, Double) -> T) -> T {
        if let e = cache[key], e.from <= t0, e.to >= t1 { return e.items }
        let w = t1 - t0
        let from = t0 - w, to = t1 + w
        let items = make(from, to)
        if cache.count > 64 { cache.removeAll(keepingCapacity: true) }
        cache[key] = ItemEntry(from: from, to: to, items: items)
        return items
    }

    func gregorianTicks(_ step: GregorianStep, _ t0: Double, _ t1: Double, _ fmt: EarthFormatter) -> [TimelineTick] {
        cached(&tickCache, "g|\(fmt.zone)|\(step.id)", t0, t1) { GregorianAxis.ticks(step, from: $0, to: $1, fmt) }
    }

    func gregorianContext(_ step: GregorianStep, _ t0: Double, _ t1: Double, _ fmt: EarthFormatter) -> [TimelineSpan] {
        cached(&spanCache, "g|\(fmt.zone)|\(step.id)", t0, t1) { GregorianAxis.context(step, from: $0, to: $1, fmt) }
    }

    func weekends(_ t0: Double, _ t1: Double, _ fmt: EarthFormatter) -> [TimelineSpan] {
        cached(&spanCache, "w|\(fmt.zone)", t0, t1) { a, b in
            GregorianAxis.spans(.day, from: a, to: b, fmt).filter { $0.weekday == 0 || $0.weekday == 6 }
        }
    }

    func centuries(_ fmt: EarthFormatter) -> [TimelineTick] {
        cached(&tickCache, "c|\(fmt.zone)", limits.d0, limits.d1) { _, _ in
            GregorianAxis.ticks(GregorianStep(unit: .year, n: 100), from: self.limits.d0, to: self.limits.d1, fmt)
        }
    }

    func rulerTicks(_ step: TimelineRuler.Step, _ t0: Double, _ t1: Double) -> [TimelineTick] {
        cached(&tickCache, "r|\(step.id)", t0, t1) { ruler.ticks(step, from: $0, to: $1) }
    }

    func rulerContext(_ step: TimelineRuler.Step, _ t0: Double, _ t1: Double) -> [TimelineSpan] {
        cached(&spanCache, "r|\(step.id)", t0, t1) { ruler.context(step, from: $0, to: $1) }
    }
}
