import FractonicaKit
import Foundation

/// The Delta a diary covers: its index among the Deltas that lie wholly inside the catalogue, the α β γ δ path of
/// fracton ordinals that names it, and the pickers' arithmetic (src/diary/plan.js `deltaRange` / `deltaAt` /
/// `deltaPath`, src/ui/diary/logic.js `rawDeltaIndex` / `pathOfIndex` / `ordinalChoices` / `clampDelta`).
enum DiaryDelta {
    static let level = 3
    /// Ordinals per parent below Alpha: β in α, γ in β, δ in γ (SPEC §3.1).
    static let siblings = [0, 5, 13, 5]
    static let letters = ["α", "β", "γ", "δ"]

    /// Indices of the Deltas wholly inside the catalogue (the last, clipped Delta of the catalogue has no diary).
    static func range(clock: FractonicaClock = .shared) -> ClosedRange<Int> {
        var last = Int(clock.count(level)) - 1
        while last > 0, clock.cycle(level: level, index: Int64(last))?.clipped == true { last -= 1 }
        return 0...max(0, last)
    }

    /// The Delta holding `t`, clamped into the range (a moment outside the catalogue gives the nearest Delta).
    static func index(at t: Double, clock: FractonicaClock = .shared, range: ClosedRange<Int>) -> Int {
        guard t.isFinite else { return range.lowerBound }
        let cycle = clock.level(at: clock.clamp(t), level).map { Int($0.cycle) } ?? range.lowerBound
        return min(range.upperBound, max(range.lowerBound, cycle))
    }

    /// Global Delta index of ordinals [α, β, γ, δ] (1-based), without a range check.
    static func index(of path: [Int]) -> Int {
        (((path[0] - 1) * 5 + (path[1] - 1)) * 13 + (path[2] - 1)) * 5 + (path[3] - 1)
    }

    /// Ordinals [α, β, γ, δ] of a global Delta index.
    static func path(of index: Int) -> [Int] {
        let i = max(0, index)
        return [i / 325 + 1, (i / 65) % 5 + 1, (i / 5) % 13 + 1, i % 5 + 1]
    }

    /// The ordinals a picker of `level` (0 α … 3 δ) offers under the ordinals above it, each with whether some Delta
    /// under that choice lies in `range`.
    static func choices(level: Int, path: [Int], range: ClosedRange<Int>) -> [(ordinal: Int, ok: Bool)] {
        let count = level == 0 ? Self.path(of: range.upperBound)[0] : siblings[level]
        return (1...max(1, count)).map { ord in
            let lo = Array((Array(path.prefix(level)) + [ord, 1, 1, 1]).prefix(4))
            let hi = Array((Array(path.prefix(level)) + [ord] + siblings.dropFirst(level + 1)).prefix(4))
            return (ord, index(of: hi) >= range.lowerBound && index(of: lo) <= range.upperBound)
        }
    }

    /// A path changed at one level: the nearest Delta inside the range.
    static func clamp(_ path: [Int], range: ClosedRange<Int>) -> Int {
        min(range.upperBound, max(range.lowerBound, index(of: path.map { max(1, $0) })))
    }

    /// "Delta Trifracton"; `level` 0 … 3 names the Alpha … Delta of the path.
    static func name(level: Int, ordinal: Int) -> String {
        Notation.periodName(level: level, ordinal: ordinal)
    }

    /// "α#6 β#4 γ#9 δ#3".
    static func stamp(_ path: [Int]) -> String {
        zip(letters, path).map { "\($0)#\($1)" }.joined(separator: " ")
    }

    /// Start and end of a Delta (Unix seconds).
    static func span(_ index: Int, clock: FractonicaClock = .shared) -> (t0: Double, t1: Double)? {
        clock.cycle(level: level, index: Int64(index)).map { ($0.start, $0.end) }
    }
}

/// Readouts of the options and the print (src/diary/options.js `lockShape` / `paperSize`, src/ui/diary/logic.js
/// `printSheets` / `paperLabel` / `twoUpLabel` / `printLine` / `lockReadout`), word for word.
enum DiaryPrint {
    struct LockShape: Codable, Equatable, Sendable {
        var perLock: Int
        var locks: Int
        var retro: Int
    }

    struct Paper: Codable, Equatable, Sendable {
        var width: Double
        var height: Double
        var name: String?
        var twoUp: Bool
        var cell: Double
    }

    /// Helions per lock and how a Nuclide (77 Helions) splits into locks and leftover (retrospection) Helions.
    static func lockShape(_ o: DiaryOptions) -> LockShape {
        let perLock = max(1, o.lock.sheets.reduce(0) { $0 + $1.reduce(0, +) })
        let locks = 77 / perLock
        return LockShape(perLock: perLock, locks: locks, retro: 77 - locks * perLock)
    }

    private static let twoUpPaper: [(name: String, width: Double, height: Double)] = [
        ("A4", 297, 210), ("A5", 210, 148), ("A3", 420, 297), ("B4", 353, 250), ("Letter", 279.4, 215.9),
    ]

    /// The paper a print needs: one page, or with two-up printing two pages side by side (two A5 on A4 landscape).
    static func paper(_ o: DiaryOptions) -> Paper {
        let w = o.page.width
        let h = o.page.height
        guard o.print.twoUp else { return Paper(width: w, height: h, name: nil, twoUp: false, cell: w) }
        if let hit = twoUpPaper.first(where: { abs($0.height - h) < 1.01 && $0.width >= 2 * w - 0.01 && $0.width - 2 * w < 2.5 }) {
            return Paper(width: hit.width, height: hit.height, name: hit.name, twoUp: true, cell: hit.width / 2)
        }
        return Paper(width: 2 * w, height: h, name: nil, twoUp: true, cell: w)
    }

    /// Pages of the PDF for a diary of `pages` pages.
    static func sheets(pages: Int, print: DiaryOptions.Print) -> Int {
        guard print.twoUp else { return pages }
        if print.pairing == "duplex" {
            let leaves = (pages + 1) / 2
            return 2 * ((leaves + 1) / 2)
        }
        return print.pairing == "sequential" ? (pages + 1) / 2 : (pages + 2) / 2
    }

    private static func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
        "\(n) \(n == 1 ? one : many ?? one + "s")"
    }

    /// "19 Helions per lock · 4 locks + 1 retrospection Helion".
    static func lockReadout(_ s: LockShape) -> String {
        let tail = s.retro > 0 ? "+ \(plural(s.retro, "retrospection Helion"))" : "· no retrospection Helion"
        return "\(plural(s.perLock, "Helion")) per lock · \(plural(s.locks, "lock")) \(tail)"
    }

    /// "A5 · 148 × 210 mm"; pure mode leaves the ISO names out ("148 × 210 mm · A series").
    static func paperLabel(_ size: String, page: DiaryOptions.Page, pure: Bool) -> String {
        let known = PaperSize(rawValue: size)
        let dims = known?.dimensions ?? (page.width, page.height)
        let d = "\(DiaryMath.mm(dims.width)) × \(DiaryMath.mm(dims.height)) mm"
        if size == PaperSize.custom.rawValue || known == nil { return "Custom · \(d)" }
        if size.count == 2, let series = size.first, "AB".contains(series), size.last?.isNumber == true {
            return pure ? "\(d) · \(series) series" : "\(size) · \(d)"
        }
        return "\(size) · \(d)"
    }

    private static func orientation(_ w: Double, _ h: Double) -> String { w > h ? "landscape" : "portrait" }

    /// "2 × A5 on A4 landscape (297 × 210 mm)" · pure "2 pages on 297 × 210 mm, landscape".
    static func twoUpLabel(_ o: DiaryOptions, pure: Bool) -> String {
        var t = o
        t.print.twoUp = true
        let p = paper(t)
        let dims = "\(DiaryMath.mm(p.width)) × \(DiaryMath.mm(p.height)) mm"
        if !pure, let name = p.name, o.page.size != PaperSize.custom.rawValue {
            return "2 × \(o.page.size) on \(name) \(orientation(p.width, p.height)) (\(dims))"
        }
        return "2 pages on \(dims), \(orientation(p.width, p.height))"
    }

    /// How two-up pages are paired, in words.
    static func pairingWords(_ print: DiaryOptions.Print) -> String {
        switch print.pairing {
        case "sequential": "in order"
        case "duplex": "double-sided, cut and stack"
        default: "facing pages"
        }
    }

    /// "PDF: 210 pages of A5 · 148 × 210 mm" / "PDF: 106 pages of A4 landscape · 297 × 210 mm, two diary pages each …".
    static func printLine(_ o: DiaryOptions, pages: Int, pure: Bool) -> String {
        let p = paper(o)
        let n = sheets(pages: pages, print: o.print)
        let dims = "\(DiaryMath.mm(p.width)) × \(DiaryMath.mm(p.height)) mm"
        guard p.twoUp else {
            let named = !pure && o.page.size != PaperSize.custom.rawValue ? "\(o.page.size) · " : ""
            return "PDF: \(n) pages of \(named)\(dims)"
        }
        let sheet = !pure && p.name != nil ? "\(p.name!) \(orientation(p.width, p.height)) · \(dims)" : "\(dims) \(orientation(p.width, p.height))"
        let how = o.print.pairing == "duplex"
            ? "double-sided: \(n / 2) sheets, the odd pages on the fronts, the even ones on the backs"
            : pairingWords(o.print)
        return "PDF: \(n) pages of \(sheet), two diary pages each (\(how))"
    }

    /// The paper of a PDF page in PostScript points.
    static func points(_ mm: Double) -> Double { mm * 72 / 25.4 }
}
