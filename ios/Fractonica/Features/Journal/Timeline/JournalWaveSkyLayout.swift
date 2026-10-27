import FractonicaKit
import Foundation

// The sky on the journal's wave, as geometry: which events show at a zoom (level of detail by tier, then the most
// notable first wherever marks would collide) and where the Pentads begin on the curve (SPEC §7.5). Pure logic on
// plain numbers, checked by Timeline/Checks; JournalWaveSky draws it.

/// A sky event placed on the wave: the table's index, the event, its point (in the coordinates of the trace it was
/// placed with), its mark's radius and how strongly it shows.
struct JournalSkyMark: Equatable, Sendable {
    let index: Int
    let event: SkyEvent
    let x: Double
    let y: Double
    let radius: Double
    let alpha: Double
}

/// A Pentad's start on the wave: its sync and index (0 … 3, 3 the Hypopentad), its moment, the point on the curve and
/// the curve's outward normal there.
struct JournalPentadTick: Equatable, Sendable {
    let sync: Int
    let index: Int
    let time: Double
    let x: Double
    let y: Double
    let nx: Double
    let ny: Double
    /// Its shape is drawn beside it.
    let labelled: Bool

    /// The Hypopentad, drawn stronger: its four Helions bring the Sun back.
    var isHypopentad: Bool { index == 3 }
}

enum JournalSkyPlacer {
    /// A tier shows once its events come at least this far apart along the axis on average (points), at full strength
    /// from `fullGap`. Total solar eclipses always show (where there is room).
    static let minGap = 20.0
    static let fullGap = 34.0
    static let eclipseRadius = 11.0
    static let radius = 8.0
    /// The most events considered at once (a window always holds fewer at the gaps above).
    static let limit = 2500

    /// How strongly each tier shows at k points per second (0 hides it).
    static func tierAlpha(_ tier: SkyTier, k: Double) -> Double {
        JournalArcs.smoothstep(minGap, fullGap, tier.spacing * k)
    }

    /// How far apart (seconds) events as notable as this one come, nil for those that show at every zoom (where there is
    /// room): total solar eclipses always; the other central eclipses (annular and hybrid solar, total lunar) about
    /// twice a year; partial and penumbral ones with the rest of their tier.
    static func spacing(_ event: SkyEvent) -> Double? {
        guard event.tier == .eclipse, let label = event.specific else { return event.tier.spacing }
        if event.name == "solar-eclipse", label.hasPrefix("Total") { return nil }
        if label.hasPrefix("Total") || label.hasPrefix("Annular") || label.hasPrefix("Hybrid") { return 365.2422 * 86_400 / 2 }
        return event.tier.spacing
    }

    /// How strongly an event shows at k points per second (0 hides it).
    static func alpha(_ event: SkyEvent, k: Double) -> Double {
        spacing(event).map { JournalArcs.smoothstep(minGap, fullGap, $0 * k) } ?? 1
    }

    /// The events of [lo, hi) to draw at k points per second, placed by `trace` (a moment's point on the curve): those
    /// that show (`alpha`), most notable first (total solar eclipses, the other eclipses, then by tier), each taking its
    /// place unless a mark already placed lies within reach (the marks' radii and `gap`). The result is in time order.
    static func place(_ table: SkyEvents, from lo: Double, to hi: Double, k: Double, hidden: Set<SkyFamily>, gap: Double = 3,
                      trace: (Double) -> (x: Double, y: Double)?) -> [JournalSkyMark] {
        let alphas = SkyTier.allCases.map { tierAlpha($0, k: k) }
        let eclipse = SkyTier.eclipse.rawValue
        var candidates: [(index: Int, rank: Int)] = []
        for i in table.indices(from: lo, to: hi) {
            let kind = table.kind(i)
            guard !hidden.contains(SkyKinds.all[kind].family) else { continue }
            let tier = SkyTier(kind: kind).rawValue
            if tier == eclipse {
                // eclipses by how notable each is: total solar ones first
                let event = table.event(i)
                guard alpha(event, k: k) > 0.02 else { continue }
                candidates.append((i, spacing(event) == nil ? 0 : 1))
            } else if alphas[tier] > 0.02 {
                candidates.append((i, tier + 1))
            }
        }
        candidates.sort { a, b in a.rank != b.rank ? a.rank < b.rank : a.index < b.index }
        if candidates.count > limit { candidates.removeLast(candidates.count - limit) }

        // a grid of cells as wide as the largest reach: a new mark only looks at its cell and the eight around it
        let cell = 2 * eclipseRadius + gap
        var grid: [Int64: [Int]] = [:]
        var marks: [JournalSkyMark] = []
        func key(_ cx: Int64, _ cy: Int64) -> Int64 { cx &* 1_000_003 &+ cy }
        for (i, _) in candidates {
            let event = table.event(i)
            guard let p = trace(event.time) else { continue }
            let r = event.tier == .eclipse ? eclipseRadius : radius
            let cx = Int64((p.x / cell).rounded(.down)), cy = Int64((p.y / cell).rounded(.down))
            var free = true
            search: for dx in -1...1 {
                for dy in -1...1 {
                    for j in grid[key(cx + Int64(dx), cy + Int64(dy))] ?? [] {
                        let m = marks[j]
                        if hypot(m.x - p.x, m.y - p.y) < m.radius + r + gap {
                            free = false
                            break search
                        }
                    }
                }
            }
            guard free else { continue }
            grid[key(cx, cy), default: []].append(marks.count)
            marks.append(JournalSkyMark(index: i, event: event, x: p.x, y: p.y, radius: r, alpha: alpha(event, k: k)))
        }
        return marks.sorted { $0.index < $1.index }
    }

    // MARK: The Pentads

    /// About how far apart (seconds) the Pentads begin: a quarter of the sync's 19 mean Helions, about a day.
    static func pentadSeconds(clock: FractonicaClock = .shared) -> Double {
        WaveSolar.syncCycles * clock.levelInfo(WaveSolar.syncLevel).meanSeconds / 4
    }

    /// Ticks show once they come this far apart (points): every Pentad, or only the Hypopentads while the Pentads are
    /// closer; shapes from `labelGap` (Pentads) or `4 · labelGap` apart (Hypopentads alone).
    static let tickGap = 9.0
    static let labelGap = 26.0

    /// The Pentads that begin in [lo, hi] at k points per second, each where `trace` puts it on the curve (with the
    /// normal), latest first; empty when even the Hypopentads would crowd. At most `limit`.
    static func pentadTicks(from lo: Double, to hi: Double, k: Double, clock: FractonicaClock = .shared, limit: Int = 800,
                            trace: (Double) -> (x: Double, y: Double, nx: Double, ny: Double)?) -> [JournalPentadTick] {
        let q = pentadSeconds(clock: clock) * k
        let lo = max(clock.tMin, lo), hi = min(clock.tMax, hi)
        guard 4 * q >= tickGap, hi > lo, (hi - lo) / pentadSeconds(clock: clock) < Double(limit) * (q >= tickGap ? 1 : 4),
              let p = clock.pentad(at: lo) else { return [] }
        let all = q >= tickGap
        let labelled = all ? q >= labelGap : 4 * q >= 4 * labelGap
        // the first start at or after lo, then each next Pentad's
        var sync = p.sync, index = p.index, start = p.start
        if start < lo {
            (sync, index) = index == 3 ? (sync + 1, 0) : (sync, index + 1)
            guard let next = clock.pentad(sync: sync, index: index) else { return [] }
            start = next.start
        }
        var out: [JournalPentadTick] = []
        while start <= hi, out.count < limit {
            if all || index == 3, let c = trace(start) {
                out.append(JournalPentadTick(sync: sync, index: index, time: start, x: c.x, y: c.y, nx: c.nx, ny: c.ny,
                                             labelled: labelled))
            }
            (sync, index) = index == 3 ? (sync + 1, 0) : (sync, index + 1)
            guard let next = clock.pentad(sync: sync, index: index) else { break }
            start = next.start
        }
        return out.reversed()
    }
}
