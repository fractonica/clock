import FractonicaKit
import Foundation

// What the Timer says about a moment: the ring time in notifications, toasts and the Live Activity leads with its
// Pentad (SPEC §7.5), in words, as a date with its weekday.

func timerWordsChecks() {
    let a = 1_791_460_800.0 // SPEC vector A: Pentad II
    let real = RealClock()
    let start = Date(timeIntervalSince1970: a)
    for pure in [true, false] {
        let words = TimerWords(words: Wording(pure: pure, zone: "UTC"), clock: real, now: start)
        guard case .success(let run) = TimerRun.start(.ladder(LadderSpan(iota: 4)), at: start, clock: real),
              let end = run.end else {
            check(false, "a 4ι timer starts at vector A")
            continue
        }
        let body = words.notificationBody(run)
        check(body.hasPrefix("4ι · rang at Pentad II · "), "the notification names the Pentad first: \(body)")
        check(!body.contains("\u{2B20}") && !body.contains("\u{25FB}"), "notifications stay plain text: \(body)")
        check(words.pentad(end) == 1 && words.led("x", at: end) == "Pentad II · x", "the end's Pentad")
        check(words.led("x", at: end, form: .ascii) == "P2 · x", "the short form where room is short (the Live Activity)")
        if pure {
            check(body == "4ι · rang at Pentad II · 34η 33ι 21λ", "pure: \(body)")
        }
    }
    // a timer that rings in the next Pentad names that one
    if let p = Pentads.at(a) {
        let words = TimerWords(words: Wording(pure: true, zone: "UTC"), clock: real, now: start)
        let later = Date(timeIntervalSince1970: p.end + 60)
        check(words.led("x", at: later) == "Pentad III · x", "a moment in the next Pentad: \(words.led("x", at: later))")
    }
}
