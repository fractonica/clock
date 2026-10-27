import FractonicaKit
import Foundation

/// The Pentads (SPEC §7.5) of the selected cycle's five events — begin, peak, node, valley, end — each read just after
/// its moment (where an event meets a Pentad's edge, the Pentad that begins there): the card and the centre lead those
/// moments with them. Kept for the cycle on show, so the readouts that redraw ten times a second read them once a cycle.
/// A plain reference type a view holds in `@State`; never shared across threads. Checked by Checks/RingsChecks.swift.
final class RingsPentads {
    private var level = -1
    private var cycle: Int64 = .min
    private var cached: [Int?] = []

    /// The Pentad index of each of the cycle's five events (nil where an event lies past the catalogue).
    func events(of r: LevelReading) -> [Int?] {
        if r.level == level && r.cycle == cycle { return cached }
        level = r.level
        cycle = r.cycle
        cached = r.thresholds.map { $0.time.flatMap { Pentads.index(at: $0 + 0.001) } }
        return cached
    }

    /// The Pentad of the cycle's start (event 0) and of its end (event 4).
    func start(of r: LevelReading) -> Int? { events(of: r).first ?? nil }
    func end(of r: LevelReading) -> Int? { events(of: r).last ?? nil }
}
