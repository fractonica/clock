import Foundation
import Testing
@testable import FractonicaKit

/// What the fixture cannot pin down: the JavaScript regex semantics the port relies on, the zone list of the device,
/// and properties every candidate must have.
@Suite("Jump grammar, native")
struct JumpNativeTests {
    let a = 1_791_460_800.0 // SPEC vector A, 2026-10-08 12:00 UTC

    @Test("Patterns keep JavaScript's ASCII word boundaries and digits")
    func jsRegexSemantics() {
        // a Greek letter is no word character in JavaScript: "εbeat" has a boundary before the b
        #expect(JSRegex("\\bbeats?\\b").test("εbeat"))
        #expect(!JSRegex("\\bbeats?\\b").test("abeat"))
        // \d is ASCII only (Arabic-Indic digits are not digits for the grammars)
        #expect(!JSRegex("^\\d+$").test("\u{0661}\u{0662}"))
        // $ is the end of the input, not the end of a line
        #expect(!JSRegex("^ab$").test("ab\n"))
        // [ and : are literal inside a class
        #expect(JSRegex("^[[(]x[\\])]$").test("[x]"))
        #expect(JSRegex("^p\\s*[:=]?\\s*1$").test("p:1"))
        // sticky matching starts exactly at the offset
        let re = JSRegex("\\s*(\\d+)([a-z]+)")
        #expect(re.sticky("+3d 4h", at: 1)?[1] == "3")
        #expect(re.sticky("+3d 4h", at: 0) == nil)
        #expect(re.sticky("+3d 4h", at: 3)?[2] == "h")
        // UTF-16 offsets, as in JavaScript
        #expect("α#6 β".jsLength == 5)
        #expect("α#6 β#4".jsSlice(4) == "β#4")
        #expect(JumpMaths.clip(String(repeating: "x", count: 50), 10) == "xxxxxxxxx…")
    }

    @Test("Cities read in the device's zone list, including renamed ones")
    func zones() {
        let out = JumpParser.parse("2031-06-01 14:30 Kathmandu", JumpContext(now: a, real: a, zone: "UTC"))
        #expect(out.first?.kind == .date)
        #expect(out.first?.time == 1_938_069_900) // 14:30 at +05:45
        #expect(JumpParser.mentionsZone("Tokyo"))
        #expect(JumpParser.mentionsZone("new york"))
        #expect(!JumpParser.mentionsZone("Gamma Difracton"))
    }

    @Test("The locale decides the slash order")
    func slashOrder() {
        #expect(JumpParser.dayFirst(locale: Locale(identifier: "en_US")) == false)
        #expect(JumpParser.dayFirst(locale: Locale(identifier: "en_GB")) == true)
        #expect(JumpParser.dayFirst(locale: Locale(identifier: "de_DE")) == true)
        let us = JumpParser.parse("06/01/2031", JumpContext(now: a, real: a, zone: "UTC", dayFirst: false))
        #expect(us.first?.label.contains("(month/day)") == true)
        let gb = JumpParser.parse("06/01/2031", JumpContext(now: a, real: a, zone: "UTC", dayFirst: true))
        #expect(gb.first?.label.contains("(day/month)") == true)
    }

    @Test("Every selectable candidate is a whole millisecond inside the catalogue; pure output never speaks Earth")
    func properties() {
        let clock = FractonicaClock.shared
        let earth = ["2031-06-01 14:30", "+3d", "next ε", "α#6 β#3 γ#11", "pos 24.5", "sync 4820", "d7 13,0", "tomorrow 9:30",
                     "ζ 6", "d7#717211", "1791460800", "next peak", "η [13,0]"]
        let pure = ["Delta Trifracton Node", "ε#2 5η", "+2ε 5η", "next Helion", "pos 24.5", "sync 4820 node", "η 13·4",
                    "34η 29ι 21λ", "+4 Blinks", "Gamma Difracton", "d7#717211", "next Delta node", "now"]
        let leaks = try! NSRegularExpression(pattern: "\\b(1[6-9]|2[0-9])\\d\\d-\\d\\d|\\b\\d{1,2}:\\d\\d|UTC|%|\\b(d|h|min|s|y|wk|mo)\\b \\d|\\d (d|h|min|s|y|ms)\\b")
        for now in [a, 946_684_800, clock.tMin + 5, clock.tMax - 5] {
            for text in earth {
                for c in JumpParser.parse(text, JumpContext(now: now, real: now, zone: "Europe/Kyiv", level: 6)) where c.isSelectable {
                    let t = c.time!
                    #expect(clock.inRange(t), "\(text) @\(now): \(t) outside")
                    #expect(abs(t * 1000 - (t * 1000).rounded()) < 1e-3, "\(text) @\(now): \(t) is no whole millisecond")
                }
            }
            for text in pure {
                for c in PureJumpParser.parse(text, PureJumpContext(now: now, real: now + 5, level: 6)) {
                    if let t = c.time {
                        #expect(clock.inRange(t), "\(text) @\(now): \(t) outside")
                    }
                    let shown = c.label + " | " + c.detail
                    let range = NSRange(location: 0, length: (shown as NSString).length)
                    #expect(leaks.firstMatch(in: shown, range: range) == nil, "\(text) @\(now) leaks Earth terms: \(shown)")
                }
            }
        }
    }

    @Test("Long pastes are answered at once")
    func longInput() {
        let huge = String(repeating: "x", count: 100_000)
        let clock = ContinuousClock()
        let elapsed = clock.measure {
            #expect(JumpParser.parse(huge, JumpContext(now: a, real: a)).first?.label.contains("characters") == true)
            #expect(PureJumpParser.parse(huge, PureJumpContext(now: a, real: a)).first?.label.contains("characters") == true)
        }
        #expect(elapsed < .milliseconds(200))
        #expect(JumpParser.parse("   ", JumpContext(now: a, real: a)).isEmpty)
        #expect(PureJumpParser.parse("", PureJumpContext(now: a, real: a)).isEmpty)
    }
}
