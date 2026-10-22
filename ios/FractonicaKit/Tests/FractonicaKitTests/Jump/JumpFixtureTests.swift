import Foundation
import Testing
@testable import FractonicaKit

/// The jump grammars against jump.json: the web app's own `parseJump` and `parsePure` (src/ui/calendar/parse.js,
/// pure-parse.js) over ~1 400 inputs at several displayed times, zones, slash-date orders and selected levels
/// (ios/scripts/make-jump-fixtures.mjs). Every candidate list must match: the number of candidates, each one's kind,
/// its resolved Unix time within 1 ms, the live flag, and the label and detail text exactly.
@Suite("Jump fixtures")
struct JumpFixtureTests {
    static let fixture: JSON = {
        guard let url = Bundle.module.url(forResource: "jump", withExtension: "json", subdirectory: "Fixtures") else {
            preconditionFailure("missing fixture jump.json: run `node ios/scripts/make-jump-fixtures.mjs`")
        }
        do {
            return try JSONDecoder().decode(JSON.self, from: Data(contentsOf: url))
        } catch {
            preconditionFailure("unreadable fixture jump.json: \(error)")
        }
    }()

    /// The resolved times may differ by at most a millisecond (they are landed on whole milliseconds).
    static let timeTolerance = 1e-3

    @Test("Earth box (parseJump): kinds, times, labels and details")
    func earth() {
        run(parsers: ["e", "P>e"], label: "parseJump")
    }

    @Test("Pure box (parsePure): kinds, times, labels and details")
    func pure() {
        run(parsers: ["p", "E>p"], label: "parsePure")
    }

    @Test("Examples and placeholders are the web app's and all read")
    func examples() {
        let earth = Self.fixture["earthInputs"].strings
        let pure = Self.fixture["pureInputs"].strings
        for (text, _) in JumpParser.examples(dayFirst: true) + JumpParser.examples(dayFirst: false) {
            #expect(earth.contains(text), "\(text) is no Earth example of the web app")
        }
        for (text, _) in PureJumpParser.examples {
            #expect(pure.contains(text), "\(text) is no pure example of the web app")
            let out = PureJumpParser.parse(text, PureJumpContext(now: 1_791_460_800, real: 1_791_460_805, level: 6))
            #expect(out.contains { $0.isSelectable }, "\(text) does not read")
        }
        for text in JumpParser.placeholder.components(separatedBy: " · ") {
            let out = JumpParser.parse(text, JumpContext(now: 1_791_460_800, real: 1_791_460_800, zone: "UTC", level: 6))
            #expect(out.contains { $0.isSelectable }, "placeholder piece \(text) does not read")
        }
        for text in PureJumpParser.placeholder.components(separatedBy: " · ") {
            let out = PureJumpParser.parse(text, PureJumpContext(now: 1_791_460_800, real: 1_791_460_805, level: 6))
            #expect(out.contains { $0.isSelectable }, "pure placeholder piece \(text) does not read")
        }
    }

    private func run(parsers: Set<String>, label: String) {
        let f = Self.fixture
        let refs = f["refs"].doubles
        let zones = f["zones"].strings
        let options = f["options"].array
        let earthInputs = f["earthInputs"].strings
        let pureInputs = f["pureInputs"].strings
        let earthReal = f["realOffset"]["earth"].double
        let pureReal = f["realOffset"]["pure"].double
        var check = Checker(label)
        var cases = 0
        for record in f["cases"].array {
            let parser = record[0].string
            guard parsers.contains(parser) else { continue }
            cases += 1
            let input = parser == "e" || parser == "E>p" ? earthInputs[record[1].int] : pureInputs[record[1].int]
            let now = refs[record[2].int]
            let zone = zones[record[3].int]
            let option = options[record[4].int]
            let dayFirst: Bool? = option[0].isNull ? nil : option[0].bool
            let level = option[1].optionalInt
            let got: [JumpCandidate]
            if parser == "e" || parser == "P>e" {
                got = JumpParser.parse(input, JumpContext(now: now, real: now + earthReal, zone: zone, dayFirst: dayFirst, level: level))
            } else {
                got = PureJumpParser.parse(input, PureJumpContext(now: now, real: now + pureReal, level: level))
            }
            let expected = record[5].array
            let what = "[\(parser)] \(input.debugDescription) @\(now) \(zone) dayFirst \(dayFirst.map(String.init) ?? "nil") level \(level.map(String.init) ?? "nil")"
            check.equal(got.count, expected.count, "\(what): candidates \(got.map(\.label))")
            for (i, (g, e)) in zip(got, expected).enumerated() {
                check.equal(g.kind.rawValue, e[0].string, "\(what) #\(i) kind (\(g.label))")
                check.near(g.time, e[1].optionalDouble, Self.timeTolerance, "\(what) #\(i) time (\(g.label))")
                check.equal(g.label, e[2].string, "\(what) #\(i) label")
                check.equal(g.detail, e[3].string, "\(what) #\(i) detail")
                check.equal(g.live, e[4].int == 1, "\(what) #\(i) live")
            }
        }
        #expect(cases > 1000, "\(label): only \(cases) cases")
        print(check.summary + " over \(cases) cases")
        check.report()
    }
}
