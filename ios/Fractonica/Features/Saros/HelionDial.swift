import Foundation
import FractonicaKit

/// The Helions of a solar sync laid on an ordinary clock dial: where in the local day each Helion starts (its
/// ascending node), reaches its middle (its descending node) and ends, and which Pentad it belongs to. A Helion is
/// 4/125 125 of a Saros (≈ 5 h 03 min): 4¾ of them make a day, so a Helion's nodes come a quarter Helion (≈ 1 h 16 min)
/// later in the day each day, and after 4 days — 19 Helions, one solar sync, the Pentads I, II, III and the
/// Hypopentad — the grid is back at the same times of day, a few seconds earlier (SPEC §7.2, §7.5).
///
/// The dial is a spiral: the angle is the local time of day (one turn a day, or two on a 12-hour dial), the radius the
/// time since the sync began, so the sync's four days lie as four (or eight) turns from the centre outwards.
struct HelionDial: Sendable {
    struct Helion: Sendable, Identifiable, Hashable {
        /// Global Helion index (level 6).
        let cycle: Int64
        let start: Double
        /// The descending node, half way.
        let node: Double
        let end: Double
        /// "34η": its number in its Nuclide.
        let label: String
        /// 0 … 3 (3 is the Hypopentad) and the Helion's place in it from 1.
        let pentad: Int
        let place: Int

        var id: Int64 { cycle }
    }

    /// A node: a Helion's start (ascending) or middle (descending).
    struct Node: Sendable, Hashable, Identifiable {
        let helion: Helion
        let ascending: Bool
        let time: Double

        var id: Double { time }
        /// The Pentad this node begins, when it is the first Helion's start of one.
        var beginsPentad: Int? { ascending && helion.place == 1 ? helion.pentad : nil }
    }

    let series: Int
    let sync: Int
    /// The sync's first Helion's start and its last Helion's end (inside the catalogue).
    let start: Double
    let end: Double
    let helions: [Helion]
    let earth: EarthFormatter

    static let helionLevel = 6
    static let helionsPerSync: Int64 = 19

    /// The sync running at t on `clock`, read in `earth`'s zone; nil outside the catalogue.
    init?(clock: FractonicaClock, at t: Double, earth: EarthFormatter, sync offset: Int = 0) {
        guard let here = clock.level(at: t, Self.helionLevel) else { return nil }
        let anchor = Int64(clock.solarAnchor / 4) * 125_125
        let k = here.cycle - anchor
        let sync = Int((k >= 0 ? k / 19 : -((-k + 18) / 19))) + offset
        let first = anchor + Int64(sync) * Self.helionsPerSync
        let notation = Notation(clock: clock)
        let helions: [Helion] = (0..<Self.helionsPerSync).compactMap { i in
            guard let facts = clock.cycle(level: Self.helionLevel, index: first + i) else { return nil }
            let counts = notation.countsAtStart(level: Self.helionLevel, cycle: facts.cycle)
            let pentad = min(3, Int(i) / 5)
            return Helion(cycle: facts.cycle, start: facts.start, node: facts.events[2].time ?? (facts.start + facts.end) / 2,
                          end: facts.end, label: "\(counts.eta)η", pentad: pentad, place: Int(i) - 5 * pentad + 1)
        }
        guard let firstHelion = helions.first, let lastHelion = helions.last else { return nil }
        self.series = clock.series
        self.sync = sync
        self.helions = helions
        self.start = firstHelion.start
        self.end = lastHelion.end
        self.earth = earth
    }

    /// The local time of day at t as a fraction of a day (0 at midnight), in the dial's zone.
    func dayFraction(_ t: Double) -> Double {
        let p = earth.parts(t)
        return (Double(p.hour * 3600 + p.minute * 60 + p.second) + Double(p.ms) / 1000) / 86_400
    }

    /// Where t points on a dial of `hours` (24 or 12): radians clockwise from the top (midnight, or 12 o'clock).
    func angle(_ t: Double, hours: Int) -> Double {
        let turns = dayFraction(t) * 24 / Double(hours)
        return (turns - turns.rounded(.down)) * 2 * .pi
    }

    /// How far through the sync t is, 0 … 1 (the spiral's radius).
    func progress(_ t: Double) -> Double {
        min(1, max(0, (t - start) / (end - start)))
    }

    /// Every node of the sync, in order.
    var nodes: [Node] {
        helions.flatMap { [Node(helion: $0, ascending: true, time: $0.start), Node(helion: $0, ascending: false, time: $0.node)] }
    }

    /// The `count` nodes from t on, running on into the following syncs.
    static func nodes(clock: FractonicaClock, after t: Double, count: Int, earth: EarthFormatter) -> [Node] {
        var out: [Node] = []
        var offset = 0
        while out.count < count, offset < 4, let dial = HelionDial(clock: clock, at: t, earth: earth, sync: offset) {
            out += dial.nodes.filter { $0.time > t }
            offset += 1
        }
        return Array(out.prefix(count))
    }
}
