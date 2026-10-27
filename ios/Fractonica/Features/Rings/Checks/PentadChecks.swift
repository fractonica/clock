import FractonicaKit
import Foundation

// The Pentads the Rings card and centre lead a cycle's moments with (RingsPentads): each event's Pentad read just
// after it, kept for the cycle on show.

func ringsPentadChecks() {
    let clock = FractonicaClock.shared
    let a = 1_791_460_800.0 // vector A: Pentad II, 2nd Helion
    let memo = RingsPentads()
    guard let helion = clock.level(at: a, 6), let zeta = clock.level(at: a, 5) else {
        return check(false, "readings at vector A")
    }
    let events = memo.events(of: helion)
    check(events.count == 5, "five events")
    check(events.dropLast().allSatisfy { $0 == 1 }, "a Helion inside Pentad II: its begin … valley are in Pentad II (\(events))")
    check(memo.start(of: helion) == 1 && memo.end(of: helion) == Pentads.index(at: helion.end + 0.001),
          "start and end are the first and last events")
    for (k, e) in zeta.thresholds.enumerated() {
        let want = e.time.flatMap { Pentads.index(at: $0 + 0.001) }
        check(memo.events(of: zeta)[k] == want, "ζ event \(k) in its Pentad")
    }
    // a ζ (11 Helions) runs through more than one Pentad
    check(Set(memo.events(of: zeta).compactMap { $0 }).count > 1, "an 11-Helion cycle spans several Pentads")
    // the memo answers the cycle on show, and moves on with it
    let next = clock.level(at: helion.end + 1, 6)!
    check(memo.events(of: next) == next.thresholds.map { $0.time.flatMap { Pentads.index(at: $0 + 0.001) } },
          "the next Helion's events")
}
