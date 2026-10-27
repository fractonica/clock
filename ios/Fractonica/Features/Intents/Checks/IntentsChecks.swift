import FractonicaKit
import Foundation

// Checks of "What's the Fractonica time?" (ios/scripts/check.sh ios/Fractonica/Features/Intents/Checks).

@main
enum IntentsChecks {
    static func main() {
        let a = 1_791_460_800.0 // SPEC §12 vector A
        let utc = TimeZone(identifier: "UTC")!
        let reply = FractonicaTimeReply(at: a, pure: false, zone: utc)
        check(reply?.clockText == "34η 29ι 21λ", "minor clock: \(reply?.clockText ?? "nil")")
        check(reply?.date == "Delta Trifracton End · ε#5", "date: \(reply?.date ?? "nil")")
        check(reply?.stamp == "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ", "stamp (SPEC §15.6): \(reply?.stamp ?? "nil")")
        check(reply?.helionPair == [13, 0], "Helion pair")
        check(reply?.spoken == "It's Pentad II: Helion 34, Preon 29, Flavon 21 of the 5th Nuclide of Delta Trifracton, in its End quarter.",
              "spoken, led by the Pentad (SPEC §7.5): \(reply?.spoken ?? "nil")")
        check(reply?.pentad == 1 && reply?.pentadName == "Pentad II", "vector A is in Pentad II")
        check(reply?.supporting == "Pentad II · 34η 29ι 21λ · Delta Trifracton End · ε#5", "supporting: \(reply?.supporting ?? "nil")")
        check(reply?.stamp.contains("Pentad") == false, "the stamp stays the readable address, without the Pentad")
        // the Hypopentad
        var h = a
        while let p = FractonicaClock.shared.pentad(at: h), p.index != 3 { h = p.end + 1 }
        let hypo = FractonicaTimeReply(at: h, pure: true, zone: utc)
        check(hypo?.spoken.hasPrefix("It's Hypopentad: Helion ") == true, "the Hypopentad leads too: \(hypo?.spoken ?? "nil")")
        // Foundation names the UTC zone "GMT", so the tag reads as an offset
        check(reply?.earth == "Thu 8 Oct 2026, 12:00:00 · UTC+00:00", "Earth: \(reply?.earth ?? "nil")")
        let moscow = FractonicaTimeReply(at: a, pure: false, zone: TimeZone(identifier: "Europe/Moscow")!)
        check(moscow?.earth == "Thu 8 Oct 2026, 15:00:00 · UTC+03:00", "Earth in a zone: \(moscow?.earth ?? "nil")")

        let pure = FractonicaTimeReply(at: a, pure: true, zone: utc)
        check(pure?.earth == nil, "pure mode has no Earth moment")
        let forbidden = [#"\d:\d\d"#, "UTC", #"\b(Oct|Thu)\b"#, #"\b20\d\d\b"#, "%", "hour", "minute", "second"]
        for text in [pure?.spoken, pure?.date, pure?.stamp, pure?.clockText, pure?.supporting].compactMap({ $0 }) {
            for pattern in forbidden {
                check(text.range(of: pattern, options: .regularExpression) == nil, "pure leak \(pattern) in \(text)")
            }
        }
        let clock = FractonicaClock.shared
        check(FractonicaTimeReply(at: clock.tMax + 1, pure: true, zone: utc) == nil, "nothing past the catalogue")
        check(FractonicaTimeReply(at: clock.tMin - 1, pure: false, zone: utc) == nil, "nothing before it")
        Checks.finish()
    }
}
