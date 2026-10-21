/// Cycle addressing, navigation and search: model.js `addressAt`, `pathToCycle`, `cycleToPath`, `cycleByIndex`,
/// `cycleAt`, `boundaries`, `upcomingEnds` and `stateOccurrences`.
extension FractonicaClock {
    /// The five-level calendar address Alpha … Epsilon at t, 1-based (model.js `addressAt`, the library's
    /// `createCycleCalendar(clock).at`). Alpha is global (1 … 18); each other entry is the cycle's place in its parent.
    public func address(at t: Double) -> [Int]? {
        guard let q = query(t, clampEdge: false) else { return nil }
        let p = exactPosition(q)
        // The calendar clamps each child to its parent's last cycle, so the catalogue's closing instant reads as the
        // end of the last cycle at every level (the library's `periodAt` "closing" rule): ceil(extent·P/4) − 1.
        let closing = p.n == Int64(extent) * p.d
        var parent: Int128 = 0
        return (0...4).map { level -> Int in
            let x = Int128(p.n) * infos[level].prefix
            let cycle = closing ? (x - 1) / (4 * Int128(p.d)) : x / (4 * Int128(p.d))
            defer { parent = cycle }
            guard level > 0 else { return Int(cycle) + 1 }
            return Int(cycle - Int128(Fractonica.sequence[level - 1]) * parent) + 1
        }
    }

    /// Global cycle index at level `path.count − 1` of a path of 1-based places [Alpha, Beta, Gamma, …]: Alpha is
    /// global (1 … 18), every other entry local to its parent (1 … siblings). Nil if out of range.
    public func pathToCycle(_ path: [Int]) -> Int64? {
        guard let first = path.first, Fractonica.supportedLevels.contains(path.count - 1) else { return nil }
        var index = Int128(first) - 1
        guard index >= 0 else { return nil }
        for level in 1..<path.count {
            let siblings = Int128(infos[level].siblings!)
            let local = Int128(path[level]) - 1
            guard local >= 0, local < siblings else { return nil }
            index = index * siblings + local
        }
        return index < counts[path.count - 1] ? Int64(index) : nil
    }

    /// Inverse of `pathToCycle`: the 1-based path of cycle `cycle` at `level` (any level; below 1 the path is just
    /// [cycle + 1]).
    public func cycleToPath(level: Int, cycle: Int64) -> [Int] {
        var index = cycle
        var path: [Int] = []
        for l in stride(from: level, through: 1, by: -1) {
            let siblings = Int64(Fractonica.sequence[(l - 1) % Fractonica.sequence.count])
            path.append(Int(index % siblings) + 1)
            index /= siblings
        }
        path.append(Int(clamping: Int128(index) + 1)) // saturates only for Int64.max, far outside every level
        return path.reversed()
    }

    /// Facts of cycle `index` at `level`; nil outside the catalogue (model.js `cycleByIndex`).
    public func cycle(level: Int, index: Int64) -> CycleFacts? {
        guard Fractonica.supportedLevels.contains(level), index >= 0, Int128(index) < counts[level] else { return nil }
        return facts(level: level, cycle: Int128(index))
    }

    /// Facts of the cycle running at t (model.js `cycleAt`).
    public func cycle(at t: Double, level: Int) -> CycleFacts? {
        guard let reading = self.level(at: t, level) else { return nil }
        return cycle(level: level, index: reading.cycle)
    }

    /// Start times of the cycles of `level` that begin inside [t0, t1], at most `limit` (model.js `boundaries`,
    /// float arithmetic with its 1e-9 / 1e-6 tolerances). Empty for an unsupported level.
    public func boundaries(level: Int, from t0: Double, to t1: Double, limit: Int = 600) -> [Boundary] {
        guard Fractonica.supportedLevels.contains(level), !t0.isNaN, !t1.isNaN else { return [] }
        let info = infos[level]
        let lo = max(t0, tMin)
        let hi = min(t1, tMax)
        guard hi >= lo, let p0 = position(at: lo), let p1 = position(at: hi) else { return [] }
        let prefix = info.prefixDouble
        var i = ((p0 * prefix) / 4 - 1e-9).rounded(.up)
        let last = ((p1 * prefix) / 4 + 1e-9).rounded(.down)
        var out: [Boundary] = []
        while i <= last && out.count < limit {
            defer { i += 1 }
            let index = Int64(i)
            guard let time = cycleStartTime(level: level, index: index) else { break }
            if time < lo - 1e-6 || time > hi + 1e-6 { continue }
            out.append(Boundary(idx: index, local: Int(info.siblings.map { index % Int64($0) } ?? index), time: time))
        }
        return out
    }

    /// The next cycle ends after t, merged across levels `fromLevel … toLevel` (model.js `upcomingEnds`). An end of
    /// level L is also an end of every finer level, so each event names the coarsest level that rolls over (`top`)
    /// and every listed level that ends with it. At most `perLevel` ends per level, `count` events, earliest first.
    public func upcomingEnds(after t: Double, fromLevel: Int = 0, toLevel: Int = 9, count: Int = 12,
                             perLevel: Int = 8) -> [UpcomingEnd] {
        guard let q = query(t, clampEdge: false) else { return [] }
        let p = exactPosition(q)
        let first = max(fromLevel, Fractonica.supportedLevels.lowerBound)
        let last = min(toLevel, Fractonica.supportedLevels.upperBound)
        guard first <= last else { return [] }
        var order: [Ratio] = []
        var levelsAt: [Ratio: [Int]] = [:]
        for level in first...last {
            let prefix = infos[level].prefix
            let current = p.cycle(prefix: prefix)
            for i in stride(from: 1, through: perLevel, by: 1) {
                let end = Ratio((current + Int128(i)) * 4, prefix)
                if !withinExtent(end) { break }
                if levelsAt[end] == nil { order.append(end) }
                levelsAt[end, default: []].append(level)
            }
        }
        let events = order.map { end in
            let listed = levelsAt[end]!
            return UpcomingEnd(time: timestamp(at: end)!.libraryDouble, top: listed[0], levels: listed)
        }
        return Array(events.sorted { $0.time < $1.time }.prefix(max(0, count)))
    }

    /// When the odometer of `level` shows the state `digits` (coarsest first, `strokes`-stroke glyphs):
    /// `direction` +1 for the next occurrences that start after t, −1 for the previous ones (model.js
    /// `stateOccurrences`). Each occurrence lasts from `start` to `end`. Empty for an invalid digit, and for an
    /// odometer of more than 2^80 steps per Saros (as `odometer(at:_:strokes:digits:)` reads nothing for it).
    public func stateOccurrences(level: Int, digits: [Int], around t: Double, strokes: Int = 2, direction: Int = 1,
                                 count: Int = 1) -> [StateOccurrence] {
        guard Fractonica.supportedLevels.contains(level), (1...4).contains(strokes), !digits.isEmpty, !t.isNaN
        else { return [] }
        let m = Int128(GlyphState.extreme(strokes: strokes))
        let base = 4 * m
        var within: Int128 = 0
        for digit in digits {
            guard digit >= 0, Int128(digit) < base, let shifted = product(within, base) else { return [] }
            within = shifted + Int128(digit)
        }
        guard let fine = power(base, digits.count - 1),
              let units = product(infos[level].prefix, m, fine), units <= Self.maxExactDenominator, // steps per Saros
              let perCycle = product(base, fine), // steps in one cycle of the level
              let total = product(Int128(extent), units) else { return [] }
        let clamped = min(tMax, max(tMin, JSNumber.round(t * 1000) / 1000))
        let p = exactPosition(QueryTime(seconds: clamped))
        guard let scaled = product(Int128(p.n), units) else { return [] }
        let current = scaled / Int128(p.d) // the step showing at t
        let diff = current - within
        let step: Int128 = direction >= 0 ? 1 : -1
        // +1: the first cycle whose state starts after `current`; −1: the last one whose state starts before it.
        var c: Int128 = direction >= 0
            ? (diff >= 0 ? diff / perCycle + 1 : 0)
            : (diff > 0 ? (diff - 1) / perCycle : -1)
        var out: [StateOccurrence] = []
        var guardCount = 0
        while out.count < count && guardCount - 2 < count {
            defer {
                guardCount += 1
                c += step
            }
            if c < 0 { break }
            let s0 = c * perCycle + within
            if s0 + 1 > total { break }
            out.append(StateOccurrence(
                start: timestamp(at: Ratio(s0, units))!.libraryDouble,
                end: timestamp(at: Ratio(s0 + 1, units))!.libraryDouble,
                cycle: Int64(c)
            ))
        }
        return out
    }
}
