/// How a series' Helion grid runs against the civil day (SPEC §7.4): each solar sync of 19 Helions falls a few seconds
/// short of 4 days — retrograde, so every sync lands earlier in the day — and the drift adds up until the sync is back
/// at the same time of day a whole day earlier: a lap. How long that takes depends on the series, since a Helion is
/// 4/125 125 of the Saros interval it falls in and every interval has its own length (where the eclipse falls in
/// Earth's orbit decides most of it): 70 to 114 years among the ongoing series, 89.3 on average, an Alpha (4 Saros,
/// 72.1 years) and about 17 years more.
///
///     let d = SarosCatalogue.series(141)!.drift(at: now)!
///     d.perSync           // −10.081 s (2010–2028 interval)
///     d.lap               // 89.2 years in seconds, walking the intervals as they come
///     d.lapPastAlpha      // ≈ +17.1 years
public struct SarosDrift: Sendable, Hashable {
    /// The series and the instant the drift is read at (Unix seconds).
    public let series: Int
    public let at: Double
    /// Seconds the 19-Helion sync running at `at` falls short of 4 days: 19 · 4 · I / 125 125 − 345 600, I the Unix
    /// length of the Saros interval holding `at` (negative: retrograde).
    public let perSync: Double
    /// The Helion at `at`, 4 · I / 125 125 seconds.
    public let helion: Double
    /// Seconds from `at` until the grid has drifted a whole day, walking the series' real intervals; nil when the series
    /// ends first.
    public let lap: Double?
    /// The instant the lap completes, `at + lap`.
    public let lapEnd: Double?
    /// The lap at `perSync` held constant: 86 400 / |perSync| syncs of 345 600 + perSync seconds.
    public let lapAtPresentRate: Double
    /// Four of the series' mean Saros (an Alpha, depth 1), seconds.
    public let alpha: Double
    /// The drift a sync over the series' whole life, from its mean interval.
    public let lifetimePerSync: Double

    /// The lap, or the lap at the present rate where the series ends first.
    public var lapOrEstimate: Double { lap ?? lapAtPresentRate }

    /// How much longer than an Alpha the lap runs (seconds; about 17 years on average).
    public var lapPastAlpha: Double { lapOrEstimate - alpha }

    /// The drift a civil day, perSync / 4.
    public var perDay: Double { perSync / 4 }

    static let syncSeconds = 4.0 * 86_400
    static let helionsPerSaros = 125_125.0 / 4
}

extension SarosSeries {
    /// The drift at t; nil outside the series (before its first eclipse or from its last on).
    public func drift(at t: Double) -> SarosDrift? {
        let times = eclipses.map(\.time)
        guard let k = times.indices.dropLast().last(where: { times[$0] <= t }), t < times[k + 1] else { return nil }
        let interval = times[k + 1] - times[k]
        let helion = interval / SarosDrift.helionsPerSaros
        let perSync = 19 * helion - SarosDrift.syncSeconds
        let mean = (times[times.count - 1] - times[0]) / Double(times.count - 1)
        let lifetime = 19 * mean / SarosDrift.helionsPerSaros - SarosDrift.syncSeconds
        let lap = Self.lap(times, from: t, interval: k)
        return SarosDrift(
            series: number, at: t, perSync: perSync, helion: helion,
            lap: lap.map { $0 - t }, lapEnd: lap,
            lapAtPresentRate: 86_400 / -perSync * (SarosDrift.syncSeconds + perSync),
            alpha: 4 * mean, lifetimePerSync: lifetime
        )
    }

    /// When the grid has drifted a day from t: D(u) = (u − t) − (H(u) − H(t)) · 4 d / 19 (H in Helions, linear inside
    /// each interval), the seconds civil time has fallen behind the Helions counted since t — negative, as the syncs
    /// come early — reaches −86 400. Nil when the series ends first.
    static func lap(_ times: [Double], from t: Double, interval k0: Int) -> Double? {
        let perHelion = SarosDrift.syncSeconds / 19
        let h = { (k: Int, u: Double) in (Double(k) + (u - times[k]) / (times[k + 1] - times[k])) * SarosDrift.helionsPerSaros }
        let h0 = h(k0, t)
        var u0 = t, d0 = 0.0
        for k in k0..<(times.count - 1) {
            let u1 = times[k + 1]
            let d1 = (u1 - t) - (Double(k + 1) * SarosDrift.helionsPerSaros - h0) * perHelion
            if d1 <= -86_400 { return u0 + (u1 - u0) * (-86_400 - d0) / (d1 - d0) }
            u0 = u1
            d0 = d1
        }
        return nil
    }
}
