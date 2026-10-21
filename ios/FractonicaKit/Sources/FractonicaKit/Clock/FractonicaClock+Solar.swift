/// The solar sync (SPEC §7): runs of 19 depth-7 cycles compared with 4 civil days, counted from the anchor eclipse
/// (ordinal 20, 1973-12-24). Ports model.js `solarAt` / `solarSyncByNumber` over the library's `solarSync()`.
extension FractonicaClock {
    /// The sync running at t (model.js `solarAt`). Nil outside the catalogue and inside the first and last partial
    /// syncs (about 2.5 days at each end), whose start or end falls outside it.
    public func solar(at t: Double) -> SolarReading? {
        guard let q = query(t, clampEdge: false) else { return nil }
        let c = solarSync
        let prefix = infos[SolarSyncConstants.level].prefix
        let cycle = exactPosition(q).cycle(prefix: prefix)
        let sync = floorDiv(cycle - c.anchorCycle, SolarSyncConstants.cycles)
        let syncStart = { (k: Int128) in Ratio((c.anchorCycle + SolarSyncConstants.cycles * k) * 4, prefix) }
        guard let startTime = timestamp(at: syncStart(sync)),
              let endTime = timestamp(at: syncStart(sync + 1)) else { return nil }
        let nominalStart = c.anchorTime + Ratio(sync * SolarSyncConstants.days * SolarSyncConstants.daySeconds)
        let length = endTime - startTime
        let phase = (q.ratio - startTime) / length
        let quarter = (phase * Ratio(4)).floor
        let thresholdTime = startTime + length * Ratio(quarter + 1, 4)
        return SolarReading(
            sync: Int(sync),
            start: startTime.libraryDouble,
            end: endTime.libraryDouble,
            nominalStart: nominalStart.libraryDouble,
            phase: phase.libraryDouble,
            drift: (startTime - nominalStart).libraryDouble,
            quarter: Int(quarter),
            threshold: Threshold(name: Fractonica.quarterNames[Int(quarter)], time: thresholdTime.libraryDouble),
            digits3: Self.digits(of: phase, base: 16, count: 3),
            digits2x3: Self.digits(of: phase, base: 52, count: 2),
            beforeAnchor: q.seconds < c.anchorSeconds
        )
    }

    /// Start, end and drift of sync number n, any integer (model.js `solarSyncByNumber`); nil outside the catalogue.
    public func solarSync(number n: Int) -> SolarSyncInfo? {
        let c = solarSync
        let prefix = infos[SolarSyncConstants.level].prefix
        let position = { (k: Int128) in Ratio((c.anchorCycle + SolarSyncConstants.cycles * k) * 4, prefix) }
        guard let start = timestamp(at: position(Int128(n))),
              let end = timestamp(at: position(Int128(n) + 1)) else { return nil }
        let startSeconds = start.libraryDouble
        // model.js adds the days in float here (unlike solarAt, which stays exact).
        let nominal = c.anchorSeconds + Double(n * 4 * 86_400)
        return SolarSyncInfo(sync: n, start: startSeconds, end: end.libraryDouble, nominalStart: nominal,
                             drift: startSeconds - nominal)
    }

    /// The odometer digits of a phase 0 ..< 1 (SPEC §7.3): floor(phase · base^count) in base `base`, coarsest first.
    private static func digits(of phase: Ratio, base: Int128, count: Int) -> [Int] {
        var step = (phase * Ratio(power(base, count)!)).floor
        var out = [Int](repeating: 0, count: count)
        for i in stride(from: count - 1, through: 0, by: -1) {
            out[i] = Int(step % base)
            step /= base
        }
        return out
    }
}
