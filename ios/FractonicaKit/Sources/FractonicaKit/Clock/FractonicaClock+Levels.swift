/// Level readings: model.js `levelAt`, `odometerAt` and the cycle facts behind them (the library's `phaseAt`,
/// `phaseDigits`, `period` and `nextThreshold`).
extension FractonicaClock {
    /// Full reading of `level` at time t (model.js `levelAt`); nil outside the catalogue or for an unsupported level
    /// or stroke count (1 … 4).
    public func level(at t: Double, _ level: Int, strokes: Int = 2) -> LevelReading? {
        guard Fractonica.supportedLevels.contains(level), (1...4).contains(strokes),
              let q = query(t, clampEdge: true) else { return nil }
        let p = exactPosition(q)
        let info = infos[level]
        let x = Int128(p.n) * info.prefix
        let quad = 4 * Int128(p.d)
        let cycle = x / quad
        let rem = x - cycle * quad
        let phase = Double(rem) / Double(quad)

        let m = Int128(GlyphState.extreme(strokes: strokes))
        let glyph = GlyphState.of(index: Int(floorMod(x * m / Int128(p.d), 4 * m)), strokes: strokes)

        let facts = facts(level: level, cycle: cycle == counts[level] ? cycle - 1 : cycle)
        let span = facts.end - facts.start
        let progress = span > 0 ? min(1, max(0, (q.seconds - facts.start) / span)) : 0
        // The next quarter boundary strictly after the position (SPEC §6.2): event k sits at (4·cycle + k) / P,
        // which is after n / d exactly when k·d > n·P − 4·cycle·d = rem.
        let k = min(4, Int(rem / Int128(p.d)) + 1)
        let next = Threshold(name: Fractonica.quarterNames[k - 1], time: facts.events[k].time)

        return LevelReading(
            level: level,
            depth: info.depth,
            name: info.text,
            factor: info.factor,
            siblings: info.siblings ?? Int(counts[0]),
            cycle: Int64(cycle),
            local: info.siblings.map { Int(cycle % Int128($0)) } ?? Int(cycle),
            phase: phase,
            progress: progress,
            quarter: min(3, Int((phase * 4).rounded(.down))),
            index: glyph.index,
            value: glyph.value,
            derivative: glyph.derivative,
            dotted: glyph.dotted,
            trits: glyph.trits,
            states: GlyphState.states(strokes: strokes),
            strokes: strokes,
            start: facts.start,
            end: facts.end,
            duration: facts.duration,
            clipped: facts.clipped,
            remaining: max(0, facts.end - q.seconds),
            next: next,
            thresholds: facts.events
        )
    }

    /// Odometer read-out of `level` (SPEC §5, model.js `odometerAt`): `digits` glyph indices of `strokes` strokes,
    /// coarsest first, and when the finest next changes. Nil outside the catalogue, for an unsupported level or stroke
    /// count, or if there are more than 2^80 steps per Saros (`maxExactDenominator`: only odometers far longer than
    /// any display needs, such as four 4-stroke glyphs at depth 21).
    public func odometer(at t: Double, _ level: Int, strokes: Int = 2, digits: Int = 2) -> OdometerReading? {
        guard Fractonica.supportedLevels.contains(level), (1...4).contains(strokes), digits >= 1,
              let q = query(t, clampEdge: true) else { return nil }
        let p = exactPosition(q)
        let m = Int128(GlyphState.extreme(strokes: strokes))
        let base = 4 * m
        guard let fine = power(base, digits - 1),
              let units = product(infos[level].prefix, m, fine), units <= Self.maxExactDenominator,
              let raw = product(Int128(p.n), units).map({ $0 / Int128(p.d) }),
              let cycleSteps = product(base, fine) else { return nil }
        var rest = raw % cycleSteps
        var out = [Int](repeating: 0, count: digits)
        for i in stride(from: digits - 1, through: 0, by: -1) {
            out[i] = Int(rest % base)
            rest /= base
        }
        let next = Ratio(raw + 1, units)
        return OdometerReading(
            digits: out,
            states: Int(base),
            nextTime: withinExtent(next) ? timestamp(at: next)?.libraryDouble : nil
        )
    }

    /// Cycle index, place in the parent and phase of several levels at t: the cheap part of `level(at:)`, with the
    /// same 1 ms rounding and EDGE rule (the notation's clocks and dates read only these). Nil outside the catalogue
    /// or if a level is unsupported.
    func cycleStates(at t: Double, levels: [Int]) -> [CycleState]? {
        guard levels.allSatisfy(Fractonica.supportedLevels.contains), let q = query(t, clampEdge: true) else { return nil }
        let p = exactPosition(q)
        let quad = 4 * Int128(p.d)
        return levels.map { level in
            let info = infos[level]
            let x = Int128(p.n) * info.prefix
            let cycle = x / quad
            return CycleState(
                cycle: Int64(cycle),
                local: info.siblings.map { Int(cycle % Int128($0)) } ?? Int(cycle),
                phase: Double(x - cycle * quad) / Double(quad)
            )
        }
    }

    // MARK: - Cycle facts

    /// Start, end and events of a cycle, cached (model.js `cycleFacts`, the library's `period`).
    func facts(level: Int, cycle: Int128) -> CycleFacts {
        let key = FactsKey(level: level, cycle: Int64(cycle))
        if let hit = factsCache.withLock({ $0[key] }) { return hit }
        let made = makeFacts(level: level, cycle: cycle)
        factsCache.withLock { cache in
            if cache.count >= 4096 { cache.removeAll(keepingCapacity: true) }
            cache[key] = made
        }
        return made
    }

    /// The names of a cycle's events, begin … end.
    private static let eventNames = ["begin"] + Fractonica.quarterNames

    private func makeFacts(level: Int, cycle: Int128) -> CycleFacts {
        let prefix = infos[level].prefix
        let nominalEnd = Ratio(4 * (cycle + 1), prefix)
        let clipped = Ratio(Int128(extent)) < nominalEnd
        let end = clipped ? Ratio(Int128(extent)) : nominalEnd
        let startTime = timestamp(at: Ratio(4 * cycle, prefix))!
        let endTime = timestamp(at: end)!
        let start = startTime.libraryDouble, finish = endTime.libraryDouble
        // Event k sits at (4·cycle + k) / P. The first is the start and, unless the catalogue clips the cycle, the
        // last is the end: the same exact times, so they reuse those conversions.
        let events = Self.eventNames.enumerated().map { k, name in
            let at = Ratio(4 * cycle + Int128(k), prefix)
            let time: Double?
            if k == 0 { time = start }
            else if k == 4 && !clipped { time = finish }
            else { time = end < at ? nil : timestamp(at: at)!.libraryDouble }
            return Threshold(name: name, time: time)
        }
        return CycleFacts(
            level: level,
            cycle: Int64(cycle),
            start: start,
            end: finish,
            duration: (endTime - startTime).libraryDouble,
            clipped: clipped,
            events: events
        )
    }
}

/// a · b · c …, or nil if the product leaves `Int128`.
func product(_ factors: Int128...) -> Int128? {
    var p: Int128 = 1
    for f in factors {
        let (r, overflow) = p.multipliedReportingOverflow(by: f)
        if overflow { return nil }
        p = r
    }
    return p
}

/// base^exponent (exponent ≥ 0), or nil if it leaves `Int128`.
func power(_ base: Int128, _ exponent: Int) -> Int128? {
    var p: Int128 = 1
    for _ in 0..<exponent {
        guard let next = product(p, base) else { return nil }
        p = next
    }
    return p
}
