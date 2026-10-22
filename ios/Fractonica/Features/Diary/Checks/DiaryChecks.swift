import FractonicaKit
import Foundation

// The Diary's native logic against the web app's own modules (diary-fixture.json, written by make-diary-fixture.mjs
// from src/diary/options.js, src/diary/plan.js, src/ui/diary/logic.js and src/core/pure.js): option sanitising, the
// Delta range and pickers, the print readouts, the lines-per-Helion hint, the web host's plan message and section
// lookup; plus the scheme handler's file mapping and MIME types, and lenient decoding of stored options.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Diary/Checks

@main
struct DiaryChecks {
    static func main() throws {
        let url = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "diary-fixture.json")
        let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        sanitizeChecks(fixture)
        deltaChecks(fixture)
        printChecks(fixture)
        hintChecks(fixture)
        planChecks(fixture)
        resourceChecks()
        decodingChecks()
        Checks.finish()
    }
}

// MARK: Helpers

private func decode<T: Decodable>(_ type: T.Type, _ object: Any) -> T? {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
}

/// JSON as Foundation objects, without nulls (Swift leaves nil keys out where the web app writes null).
private func plain(_ value: Any) -> Any {
    if let d = value as? [String: Any] {
        return d.filter { !($0.value is NSNull) }.mapValues(plain)
    }
    if let a = value as? [Any] { return a.map(plain) }
    return value
}

private func json<T: Encodable>(_ value: T) -> Any {
    let data = try! JSONEncoder().encode(value)
    return try! JSONSerialization.jsonObject(with: data)
}

private func same(_ a: Any, _ b: Any) -> Bool {
    (plain(a) as AnyObject).isEqual(plain(b))
}

// MARK: Options

private func sanitizeChecks(_ f: [String: Any]) {
    let cases = f["sanitize"] as! [[String: Any]]
    for (i, c) in cases.enumerated() {
        let pure = c["pure"] as! Bool
        guard let input = decode(DiaryOptions.self, c["input"]!) else {
            check(false, "sanitize #\(i): the input decodes")
            continue
        }
        let out = input.sanitized(pure: pure)
        check(same(json(out), c["output"]!), "sanitize #\(i) (pure \(pure)) matches sanitizeDiaryOptions:\n  swift \(plain(json(out)))\n  js    \(plain(c["output"]!))")
        check(out.sanitized(pure: pure) == out, "sanitize #\(i) is idempotent")
    }
    check(DiaryOptions().sanitized() == DiaryOptions(), "the defaults are already clean")
    let defaults = cases.first { ($0["input"] as! [String: Any]).isEmpty && !($0["pure"] as! Bool) }!
    check(same(json(DiaryOptions()), defaults["output"]!), "DiaryOptions() is DIARY_DEFAULTS")
}

// MARK: Deltas

private func deltaChecks(_ f: [String: Any]) {
    let r = f["range"] as! [String: Int]
    let range = DiaryDelta.range()
    check(range == r["first"]!...r["last"]!, "deltaRange: \(range) vs \(r)")

    for c in f["deltaAtCases"] as! [[String: Any]] {
        let t = c["t"] as! Double
        let want = c["delta"] as! Int
        let got = DiaryDelta.index(at: t, range: range)
        check(got == want, "deltaAt(\(t)) = \(got), web \(want)")
    }
    check(DiaryDelta.index(at: .nan, range: range) == range.lowerBound, "deltaAt(NaN) is the first Delta")

    for c in f["paths"] as! [[String: Any]] {
        let idx = c["idx"] as! Int
        let path = c["path"] as! [Int]
        check(DiaryDelta.path(of: idx) == path, "path of \(idx): \(DiaryDelta.path(of: idx)) vs \(path)")
        check(c["logicPath"] as! [Int] == path, "the web's two path functions agree for \(idx)")
        check(DiaryDelta.index(of: path) == idx, "index of \(path) round-trips to \(idx)")
    }

    for c in f["choiceCases"] as! [[String: Any]] {
        let level = c["level"] as! Int
        let path = c["path"] as! [Int]
        let want = (c["choices"] as! [[String: Any]]).map { ($0["ord"] as! Int, $0["ok"] as! Bool) }
        let got = DiaryDelta.choices(level: level, path: path, range: range)
        check(got.count == want.count && zip(got, want).allSatisfy { $0.ordinal == $1.0 && $0.ok == $1.1 },
              "ordinalChoices(\(level), \(path)): \(got.map { "\($0.ordinal)\($0.ok ? "" : "x")" }) vs \(want.map { "\($0.0)\($0.1 ? "" : "x")" })")
    }

    for c in f["clampCases"] as! [[String: Any]] {
        let path = c["path"] as! [Int]
        check(DiaryDelta.clamp(path, range: range) == c["delta"] as! Int, "clampDelta(\(path)) = \(DiaryDelta.clamp(path, range: range)), web \(c["delta"]!)")
    }

    for c in f["spans"] as! [[String: Any]] {
        let idx = c["idx"] as! Int
        let span = DiaryDelta.span(idx)
        check(span?.t0 == c["t0"] as? Double && span?.t1 == c["t1"] as? Double, "span of Delta \(idx): \(String(describing: span)) vs \(c["t0"]!) … \(c["t1"]!)")
        check(DiaryDelta.name(level: 3, ordinal: DiaryDelta.path(of: idx)[3]) == c["name"] as! String, "name of Delta \(idx)")
    }
    check(DiaryDelta.stamp([6, 4, 9, 3]) == "α#6 β#4 γ#9 δ#3", "the stamp of vector A's Delta")
}

// MARK: Print readouts

private func printChecks(_ f: [String: Any]) {
    let options = (f["printOptions"] as! [Any]).map { decode(DiaryOptions.self, $0)! }
    for c in f["print"] as! [[String: Any]] {
        let o = options[c["opt"] as! Int]
        let pages = c["pages"] as! Int
        let tag = "options #\(c["opt"]!), \(pages) pages"
        check(same(json(DiaryPrint.paper(o)), c["paper"]!), "paperSize, \(tag): \(DiaryPrint.paper(o)) vs \(c["paper"]!)")
        check(DiaryPrint.sheets(pages: pages, print: o.print) == c["sheets"] as! Int, "printSheets, \(tag): \(DiaryPrint.sheets(pages: pages, print: o.print)) vs \(c["sheets"]!)")
        let lines = c["lines"] as! [String]
        check(DiaryPrint.printLine(o, pages: pages, pure: false) == lines[0], "printLine, \(tag):\n  \(DiaryPrint.printLine(o, pages: pages, pure: false))\n  \(lines[0])")
        check(DiaryPrint.printLine(o, pages: pages, pure: true) == lines[1], "printLine pure, \(tag):\n  \(DiaryPrint.printLine(o, pages: pages, pure: true))\n  \(lines[1])")
    }
    for (i, c) in (f["labels"] as! [[String: Any]]).enumerated() {
        let o = options[i]
        let shape = DiaryPrint.lockShape(o)
        check(same(json(shape), c["shape"]!), "lockShape #\(i): \(shape)")
        check(DiaryPrint.lockReadout(shape) == c["lockReadout"] as! String, "lockReadout #\(i): \(DiaryPrint.lockReadout(shape))")
        let paper = c["paperLabel"] as! [String]
        let twoUp = c["twoUpLabel"] as! [String]
        for (k, pure) in [false, true].enumerated() {
            check(DiaryPrint.paperLabel(o.page.size, page: o.page, pure: pure) == paper[k], "paperLabel #\(i) pure \(pure): \(DiaryPrint.paperLabel(o.page.size, page: o.page, pure: pure)) vs \(paper[k])")
            check(DiaryPrint.twoUpLabel(o, pure: pure) == twoUp[k], "twoUpLabel #\(i) pure \(pure): \(DiaryPrint.twoUpLabel(o, pure: pure)) vs \(twoUp[k])")
        }
        check(DiaryPrint.pairingWords(o.print) == c["pairing"] as! String, "pairingWords #\(i)")
    }
    for c in f["sizeLabels"] as! [[String: Any]] {
        let size = c["size"] as! String
        var page = DiaryOptions.Page()
        page.width = 120.25
        page.height = 180
        let labels = c["labels"] as! [String]
        check(DiaryPrint.paperLabel(size, page: page, pure: false) == labels[0], "paperLabel \(size): \(DiaryPrint.paperLabel(size, page: page, pure: false)) vs \(labels[0])")
        check(DiaryPrint.paperLabel(size, page: page, pure: true) == labels[1], "paperLabel \(size) pure: \(DiaryPrint.paperLabel(size, page: page, pure: true)) vs \(labels[1])")
    }
    check(abs(DiaryPrint.points(148) - 419.5276) < 1e-3 && abs(DiaryPrint.points(210) - 595.2756) < 1e-3, "A5 in points")
}

// MARK: Hints

private func hintChecks(_ f: [String: Any]) {
    let n = Notation.standard
    for c in f["perLine"] as! [[String: Any]] {
        let lines = c["lines"] as! Int
        let text = "one line per \(n.durationPos(n.cyclePos(6) / Double(lines)))"
        check(text == c["text"] as! String, "lines-per-Helion hint for \(lines): \(text) vs \(c["text"]!)")
    }
}

// MARK: The web host's messages

private func planChecks(_ f: [String: Any]) {
    guard case .plan(let plan)? = DiaryHostMessage(json: f["planMessage"] as! String) else {
        check(false, "the plan message decodes")
        return
    }
    check(plan.token == 7 && plan.pages.count == 210 && plan.delta.stamp == "α#6 β#4 γ#9 δ#3", "the plan message: \(plan.pages.count) pages, \(plan.delta.stamp)")
    check(plan.pages.enumerated().allSatisfy { $0.offset + 1 == $0.element.no }, "pages are numbered in order")
    check(plan.pages.allSatisfy { $0.name == $0.title.split(separator: " · ", maxSplits: 1).dropFirst().joined() }, "page names drop the number")
    check(plan.page(13)?.name == "ε#1 lock 1 pentad 1 · 1η–3η", "page 13 is the first pentad: \(plan.page(13)?.name ?? "nil")")
    check(plan.page(0) == nil && plan.page(211) == nil, "no page outside the book")
    check(plan.zoneCity?.place == "Moscow" && plan.place?.place == "Moscow", "the sky's place is the zone's city")
    check(plan.paper == DiaryPrint.paper(DiaryOptions()) && plan.sheets == 210, "the plan's paper is the native paper")
    check(plan.shape == DiaryPrint.lockShape(DiaryOptions()), "the plan's lock shape is the native one")
    for c in f["sectionAt"] as! [[String: Any]] {
        let no = c["no"] as! Int
        let s = plan.section(at: no)
        check(s?.key == c["key"] as? String && s?.page == c["page"] as? Int, "sectionAt(\(no)): \(s?.key ?? "nil") vs \(c["key"]!)")
    }

    let page = DiaryHostMessage(json: #"{"type":"page","no":12,"pair":[12,13],"spread":true,"wide":true}"#)
    if case .page(let no, let pair, let spread, let wide)? = page {
        check(no == 12 && pair == [12, 13] && spread && wide, "a page message")
    } else {
        check(false, "a page message decodes")
    }
    if case .page(_, let pair, _, _)? = DiaryHostMessage(json: #"{"type":"page","no":1,"pair":[null,1],"spread":true,"wide":true}"#) {
        check(pair == [nil, 1], "the first spread has an empty verso")
    } else {
        check(false, "a first-spread page message decodes")
    }
    if case .error(let token, let message)? = DiaryHostMessage(json: #"{"type":"error","token":3,"message":"boom"}"#) {
        check(token == 3 && message == "boom", "an error message")
    } else {
        check(false, "an error message decodes")
    }
    check(DiaryHostMessage(json: "not json") == nil && DiaryHostMessage(json: #"{"type":"other"}"#) == nil, "unknown messages are dropped")
}

// MARK: Resources

private func resourceChecks() {
    let res = URL(filePath: "/App.app/Resources", directoryHint: .isDirectory)
    func file(_ s: String) -> String? { DiaryResources.file(for: URL(string: s)!, resources: res)?.path }
    check(file("fxdiary://app/diary-host.html") == "/App.app/Resources/diary-host.html", "the host page")
    check(file("fxdiary://app/diary-host.js") == "/App.app/Resources/diary-host.js", "the host script")
    check(file("fxdiary://app/web/src/diary/render.js") == "/App.app/Resources/web/src/diary/render.js", "a web module")
    check(file("fxdiary://app/web/fractonica.js") == "/App.app/Resources/web/fractonica.js", "the library")
    check(file("fxdiary://app/web/src/diary/geo/data/126.bin") == "/App.app/Resources/web/src/diary/geo/data/126.bin", "path data")
    check(file("fxdiary://app/web/../Info.plist") == nil, "no way out of web/")
    check(file("fxdiary://app/web/src/%2E%2E/x.js") == nil || file("fxdiary://app/web/src/%2E%2E/x.js")!.hasPrefix("/App.app/Resources/web/"), "no escaping by encoding")
    check(file("fxdiary://app/Info.plist") == nil, "only the host files at the root")
    check(file("fxdiary://app/web") == nil, "not the folder itself")
    check(file("fxdiary://other/diary-host.html") == nil && file("https://app/diary-host.html") == nil, "only fxdiary://app")
    check(file("fxdiary://app/web/.DS_Store") == nil, "no hidden files")
    check(DiaryResources.mimeType(for: "a/b.js").hasPrefix("text/javascript"), "modules are JavaScript")
    check(DiaryResources.mimeType(for: "x.MJS").hasPrefix("text/javascript"), "MIME by extension, any case")
    check(DiaryResources.mimeType(for: "diary-host.html").hasPrefix("text/html"), "html")
    check(DiaryResources.mimeType(for: "world.json").hasPrefix("application/json"), "json")
    check(DiaryResources.mimeType(for: "126.bin") == "application/octet-stream", "binary path data")
}

// MARK: Decoding stored options

private func decodingChecks() {
    let empty = try? JSONDecoder().decode(DiaryOptions.self, from: Data("{}".utf8))
    check(empty == DiaryOptions(), "an empty object decodes to the defaults")
    let partial = try? JSONDecoder().decode(DiaryOptions.self, from: Data(#"{"page":{"size":"A4"},"lined":{"linesPerHelion":"many"},"sky":{"lat":55.5}}"#.utf8))
    check(partial?.page.size == "A4" && partial?.page.margins == DiaryOptions.Margins(), "a partial page keeps the other defaults")
    check(partial?.lined.linesPerHelion == 12, "an unreadable value takes its default")
    check(partial?.sky.lat == 55.5 && partial?.sky.lon == nil, "coordinates stay optional")
    check(partial?.sanitized().page.width == 210, "sanitising sets a named size's width")
    var o = DiaryOptions()
    o.canvases = [DiaryOptions.Canvas(.dots, count: 300), DiaryOptions.Canvas(.lined, lines: 20)]
    o.sky.place = "Tver"
    let round = try? JSONDecoder().decode(DiaryOptions.self, from: JSONEncoder().encode(o))
    check(round == o, "options round-trip through JSON")
    check(DiaryModelFileName.check(), "file names stay portable")
}

/// `DiaryModel.fileName` without the model (it is @MainActor and UI-bound): the same replacement.
private enum DiaryModelFileName {
    static func check() -> Bool {
        let title = "Diary · Delta Trifracton (α#6 β#4 γ#9 δ#3)"
        let cleaned = String(title.map { "/\\:?*\"<>|".contains($0) ? "-" : $0 })
        return cleaned == title && String("a/b:c".map { "/\\:?*\"<>|".contains($0) ? "-" : $0 }) == "a-b-c"
    }
}
