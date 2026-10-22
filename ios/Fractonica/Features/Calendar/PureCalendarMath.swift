import FractonicaKit
import Foundation

// Pure-mode calendar maths (no SwiftUI, no Earth units), ported from src/ui/calendar/pure-conv.js: the nine entries of
// a pure date, editing them the odometer way, reading a typed date back to its first millisecond, and the geometry of
// the Delta page (5 Nuclide rows × 7 columns of 11 Helions). Everything is computed in Saros position, where the
// hierarchy is exactly aligned; only the last step converts to the Unix seconds the app runs on. Vocabulary: SPEC §15,
// docs/design/80-pure.md. Checked by Checks/CalendarChecks.swift.

/// One entry of a pure date, coarse to fine: α β γ δ ε are ordinals (from 1), η is numbered from 1 in its Nuclide,
/// ι λ ν are counts (from 0).
enum PureEntry: Int, CaseIterable, Identifiable, Sendable, Comparable {
    case alpha, beta, gamma, delta, epsilon, eta, iota, lambda, nu

    var id: Int { rawValue }
    static func < (a: PureEntry, b: PureEntry) -> Bool { a.rawValue < b.rawValue }

    var unit: FUnit { Notation.units[rawValue] }
    var sym: String { unit.sym }
    var level: Int { unit.level }
    /// α β γ δ: said in words, with a fracton name and a quarter word.
    var isMajor: Bool { rawValue <= 3 }
    /// Numbered from 1 (the ordinals and the Helion).
    var isNumbered: Bool { rawValue <= 5 }
    /// "Alpha", "Nuclide", "Helion" …
    var name: String { isMajor ? Notation.levelNames[level] : unit.name }

    /// The printed range, derived from the hierarchy: α 1–18, β 1–5, γ 1–13, δ 1–5, ε 1–5, η 1–77, ι 0–35, λ 0–64, ν 0–24.
    func range(_ clock: FractonicaClock) -> ClosedRange<Int> {
        if self == .alpha { return 1...Int(clock.count(0)) }
        let parent = PureEntry(rawValue: rawValue - 1)!
        let n = Int((Notation.standard.unitPos(parent.unit) / Notation.standard.unitPos(unit)).rounded())
        return isNumbered ? 1...n : 0...(n - 1)
    }

    /// "δ#3", "34η", "29ι"; a major in words: "Delta Trifracton".
    func text(_ n: Int, words: Bool = false) -> String {
        if isMajor, words { return Notation.periodName(level: level, ordinal: n) }
        return rawValue <= 4 ? "\(sym)#\(n)" : "\(n)\(sym)"
    }

    /// What the entry counts inside, in words ("a Nuclide").
    var parentWords: String {
        ["the catalogue", "an Alpha", "a Beta", "a Gamma", "a Delta", "a Nuclide", "a Helion", "a Preon", "a Flavon"][rawValue]
    }
}

/// The pure date and clock at a moment (`Notation.date` + `Notation.clock`), entry by entry.
struct PureCounters: Hashable, Sendable {
    var values: [Int]
    /// The quarter (0 Peak … 3 End) of the four major periods.
    var quarters: [Int]

    subscript(entry: PureEntry) -> Int { values[entry.rawValue] }

    init?(_ notation: Notation, at t: Double) {
        guard let d = notation.date(at: t), let c = notation.clock(at: t) else { return nil }
        values = [d.alpha, d.beta, d.gamma, d.delta, d.epsilon, c.eta, c.iota, c.lambda, c.nu]
        quarters = [d.quarter.alpha, d.quarter.beta, d.quarter.gamma, d.quarter.delta].map {
            Notation.quarterWords.firstIndex(of: $0) ?? 0
        }
    }
}

/// A date entry as typed: an entry, its number and, for a major period, an optional quarter word (0 Peak … 3 End).
struct PurePart: Hashable, Sendable {
    let entry: PureEntry
    let n: Int
    var quarter: Int? = nil
}

enum PureMath {
    static let epsPos = 1e-12

    static func length(_ entry: PureEntry) -> Double { Notation.standard.unitPos(entry.unit) }

    /// Move t by k units of an entry (k may be negative); nil when it leaves the catalogue.
    static func shift(_ clock: FractonicaClock, _ t: Double, by k: Double, of entry: PureEntry) -> Double? {
        guard let pos = clock.position(at: CalMath.r3(t)) else { return nil }
        let p = pos + k * length(entry)
        guard p >= 0, p < Double(clock.extent) else { return nil }
        return CalMath.r3(clock.time(atPosition: p))
    }

    /// Edit one entry in place: what is finer keeps its place (the odometer way); the moment moves by whole units.
    static func set(_ clock: FractonicaClock, _ t: Double, _ entry: PureEntry, to n: Int) -> Result<Double, CalendarError> {
        let notation = Notation.standard
        guard let current = PureCounters(notation, at: t) else { return .failure(CalendarError("This moment is outside the catalogue")) }
        let range = entry.range(clock)
        guard range.contains(n) else {
            if entry.isMajor {
                return .failure(CalendarError("\(entry.name) runs \(Notation.ordinalName(range.lowerBound)) … \(Notation.ordinalName(range.upperBound))"))
            }
            return .failure(CalendarError("\(entry.sym) \(entry.isNumbered ? "is numbered" : "counts") \(range.lowerBound)–\(range.upperBound)"))
        }
        if n == current[entry] { return .success(CalMath.r3(t)) }
        guard var out = shift(clock, t, by: Double(n - current[entry]), of: entry) else {
            return .failure(CalendarError("That lies outside the catalogue \(notation.catalogueText())"))
        }
        for _ in 0..<3 where PureCounters(notation, at: out)?[entry] != n { out = CalMath.r3(out + 0.001) }
        return .success(out)
    }

    /// A date read back as a moment (pure-conv.js `resolveParts`): `parts` are consecutive entries coarse to fine; the
    /// entries above the first come from `ref`. The result is the FIRST MILLISECOND that shows the finest entry. A
    /// quarter word on a major entry only has to meet the date; on the finest entry it is the start of that quarter.
    static func resolve(_ clock: FractonicaClock, parts: [PurePart], ref: Double?) -> Result<Double, CalendarError> {
        let notation = Notation.standard
        guard let firstPart = parts.first, let finestPart = parts.last else { return .failure(CalendarError("Nothing to read")) }
        for i in 1..<max(1, parts.count) {
            let a = parts[i - 1].entry, b = parts[i].entry
            if b <= a { return .failure(CalendarError("Write the entries from the longest to the shortest, e.g. α#6 β#4 γ#9 δ#3 ε#5 34η")) }
            if b.rawValue != a.rawValue + 1 {
                return .failure(CalendarError("\(PureEntry(rawValue: a.rawValue + 1)!.sym) is missing between \(a.sym) and \(b.sym)"))
            }
        }
        let first = firstPart.entry
        let finest = finestPart.entry
        var values = PureEntry.allCases.map { $0.isNumbered ? 1 : 0 }
        if first > .alpha {
            guard let ref, let base = PureCounters(notation, at: ref) else {
                return .failure(CalendarError("The shown moment is outside the catalogue: start the date with the Alpha, e.g. α#6 β#4 γ#9"))
            }
            for e in PureEntry.allCases where e < first { values[e.rawValue] = base[e] }
        }
        for p in parts {
            let range = p.entry.range(clock)
            guard range.contains(p.n) else {
                if p.entry == .alpha { return .failure(CalendarError("The catalogue holds only \(range.upperBound) Alphas (\(notation.catalogueText()))")) }
                if p.entry.isMajor {
                    return .failure(CalendarError("\(p.entry.name) \(Notation.ordinalName(p.n)): \(p.entry.parentWords) holds \(range.upperBound) \(p.entry.name)s"))
                }
                let why = p.entry == .eta && p.n < range.lowerBound ? ": Helions are numbered from 1" : ""
                return .failure(CalendarError("\(p.entry.text(p.n)): \(p.entry.sym) \(p.entry.isNumbered ? "is numbered" : "counts") \(range.lowerBound)–\(range.upperBound) inside \(p.entry.parentWords)\(why)"))
            }
            values[p.entry.rawValue] = p.n
        }
        guard let gamma = clock.pathToCycle([values[0], values[1], values[2]]) else {
            return .failure(CalendarError("Gamma \(Notation.ordinalName(values[2])) of Alpha \(Notation.ordinalName(values[0])), Beta \(Notation.ordinalName(values[1])) begins after the catalogue ends"))
        }
        let pGamma = clock.levelInfo(2).prefixDouble
        var pos = Double(gamma) * 4 / pGamma + Double(values[3] - 1) * length(.delta) + Double(values[4] - 1) * length(.epsilon)
        let nuclide = (pos / length(.epsilon)).rounded()
        pos = nuclide * length(.epsilon)
        let bare = first >= .eta
        let unitStart = pos + Double(values[5] - 1) * length(.eta) + Double(values[6]) * length(.iota)
            + Double(values[7]) * length(.lambda) + Double(values[8]) * length(.nu)
        var lo = unitStart
        var hi = unitStart + length(finest)
        let quartered = parts.filter { $0.entry.isMajor && $0.quarter != nil }
        for p in quartered {
            let ml = length(p.entry)
            let ms = ((unitStart + epsPos) / ml).rounded(.down) * ml
            lo = max(lo, ms + Double(p.quarter!) * ml / 4)
            hi = min(hi, ms + Double(p.quarter! + 1) * ml / 4)
        }
        if !quartered.isEmpty, !(hi - lo > epsPos) {
            let p = quartered[0]
            let ml = length(p.entry)
            let ms = ((unitStart + epsPos) / ml).rounded(.down) * ml
            let q0 = min(3, Int(((unitStart - ms) / ml * 4 + 1e-9).rounded(.down)))
            return .failure(CalendarError("\(p.entry.text(p.n, words: true)) \(Notation.quarterWords[p.quarter!]) and the rest of the date do not meet: it lies in the \(Notation.quarterWords[q0]) quarter"))
        }
        let target = lo
        guard target >= 0, target < Double(clock.extent) else {
            return .failure(CalendarError("That moment lies after the catalogue ends \(notation.catalogueText())"))
        }
        let given = PureEntry.allCases.filter { $0 >= (bare ? .eta : .alpha) && $0 <= finest }
        let want = { (c: Double) -> Bool in
            guard let cs = PureCounters(notation, at: c) else { return false }
            if bare, clock.level(at: c, 4)?.cycle != Int64(nuclide) { return false }
            for p in quartered where notation.quarter(at: c, level: p.entry.level) != p.quarter { return false }
            return given.allSatisfy { cs[$0] == values[$0.rawValue] }
        }
        let estimate = clock.time(atPosition: target)
        return .success(CalMath.firstMs(estimate, want) ?? clock.clamp((estimate * 1000).rounded(.up) / 1000))
    }

    /// What one cycle of a depth is made of, in the next unit down (pure-conv.js `madeOf`): "5ε" for a Delta, "77η" for a
    /// Nuclide, "11η" for a ζ, "4ι" for a θ; "" for the Blink, the finest unit.
    static func madeOf(level: Int) -> String {
        let units = Notation.units
        guard let i = units.firstIndex(where: { $0.level == level }) else { return Notation.standard.cycleLength(level: level) }
        guard i + 1 < units.count else { return "" }
        let n = Notation.standard
        return "\(Int((n.unitPos(units[i]) / n.unitPos(units[i + 1])).rounded()))\(units[i + 1].sym)"
    }

    /// Solar drift and spans are said by `Notation`; the eclipse distances in position.
    static func eclipseSpans(_ clock: FractonicaClock, at t: Double) -> (previous: (k: Int, text: String)?, next: (k: Int, text: String)?) {
        guard let pos = clock.position(at: CalMath.r3(t)) else { return (nil, nil) }
        let k = Int((pos + epsPos).rounded(.down))
        let make = { (e: Int) -> (k: Int, text: String)? in
            guard e >= 0, e <= clock.extent else { return nil }
            return (e, Notation.standard.durationPos(abs(Double(e) - pos), parts: 2))
        }
        return (make(k), make(k + 1))
    }
}

// MARK: - Reading typed pure dates

/// What a pure input names: a moment, or why it could not be read. A subset of the web app's pure jump grammar
/// (pure-parse.js) that fits a converter field: the stamp or any tail of it (`α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν`,
/// `δ#3 ε#5 34η`, `34η 29ι`), majors in words with an optional quarter (`Delta Trifracton Node ε#2 5η`), `a6 b4 g9`,
/// `6.4.9`, a position (`pos 22.9278`) and a solar sync (`sync 4820`, `S4820 node`).
enum PureInput {
    static func read(_ text: String, clock: FractonicaClock, ref: Double?) -> Result<Double, CalendarError> {
        let raw = String(text.prefix(200)).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return .failure(CalendarError("Type a date, e.g. δ#3 ε#5 34η 29ι")) }
        if raw.contains(/\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}|\d{1,2}:\d{2}/) {
            return .failure(CalendarError("Dates and clock times are off in pure mode: write α#6 β#4 γ#9 δ#3 ε#5 34η"))
        }
        let lower = raw.lowercased()
        // a position
        if let m = lower.wholeMatch(of: /(?:pos(?:ition)?|p|saros)\s*(\d+(?:\.\d*)?)/) {
            return CalMath.time(clock, positionText: String(m.1))
        }
        // a solar sync, optionally with a quarter
        if let m = lower.wholeMatch(of: /(?:sync\s*|s)(-?\d+)(?:\s+(start|peak|node|valley|end))?/) {
            guard let n = Int(m.1), let s = clock.solarSync(number: n) else {
                return .failure(CalendarError("That solar sync is not entirely inside the catalogue"))
            }
            let q = ["start": 0, "peak": 1, "node": 2, "valley": 3, "end": 4][m.2.map(String.init) ?? "start"] ?? 0
            let t = s.start + Double(q) / 4 * (s.end - s.start)
            return .success((t * 1000).rounded(.up) / 1000)
        }
        // 6.4.9: ordinals from the Alpha
        if lower.wholeMatch(of: /\d+(\.\d+){2,4}/) != nil {
            let numbers = lower.split(separator: ".").compactMap { Int($0) }
            let parts = numbers.enumerated().map { PurePart(entry: PureEntry(rawValue: $0.offset)!, n: $0.element) }
            return PureMath.resolve(clock, parts: parts, ref: ref)
        }
        switch parts(raw) {
        case .failure(let e): return .failure(e)
        case .success(let parts): return PureMath.resolve(clock, parts: parts, ref: ref)
        }
    }

    private static let majorWords = ["alpha": PureEntry.alpha, "beta": .beta, "gamma": .gamma, "delta": .delta]
    private static let latin: [Character: PureEntry] = ["a": .alpha, "b": .beta, "g": .gamma, "d": .delta, "e": .epsilon]
    private static let greek: [String: PureEntry] = ["α": .alpha, "β": .beta, "γ": .gamma, "δ": .delta, "ε": .epsilon]
    private static let counts: [String: PureEntry] = ["η": .eta, "ι": .iota, "λ": .lambda, "ν": .nu]

    /// The entries of a date in letters or words.
    static func parts(_ text: String) -> Result<[PurePart], CalendarError> {
        let tokens = text.split(whereSeparator: { $0 == " " || $0 == "," || $0 == "\t" || $0 == "›" }).map(String.init)
        var out: [PurePart] = []
        var i = 0
        while i < tokens.count {
            let token = tokens[i]
            let lower = token.lowercased()
            if let entry = majorWords[lower] {
                guard i + 1 < tokens.count else { return .failure(CalendarError("\(entry.name) needs its fracton name, e.g. \(entry.name) Trifracton")) }
                let name = tokens[i + 1].lowercased()
                guard let n = Notation.ordinalNames.firstIndex(where: { $0.lowercased() == name && !$0.isEmpty }) else {
                    return .failure(CalendarError("“\(String(tokens[i + 1].prefix(24)))” is not a fracton name (Monofracton, Difracton, Trifracton …)"))
                }
                var part = PurePart(entry: entry, n: n)
                i += 2
                if i < tokens.count, let q = Notation.quarterWords.firstIndex(where: { $0.lowercased() == tokens[i].lowercased() }) {
                    part.quarter = q
                    i += 1
                }
                out.append(part)
                continue
            }
            if ["epsilon", "eta", "iota", "lambda", "nu", "zeta", "theta", "kappa", "mu"].contains(lower) {
                return .failure(CalendarError("Only Alpha, Beta, Gamma and Delta have fracton names: write ε#2, 34η, 29ι"))
            }
            if let m = token.wholeMatch(of: /([αβγδε])#?(\d+)/), let entry = greek[String(m.1)], let n = Int(m.2) {
                out.append(PurePart(entry: entry, n: n))
            } else if let m = lower.wholeMatch(of: /([abgde])#?(\d+)/), let entry = latin[m.1.first!], let n = Int(m.2) {
                out.append(PurePart(entry: entry, n: n))
            } else if let m = token.wholeMatch(of: /(\d+)([ηιλν])/), let entry = counts[String(m.2)], let n = Int(m.1) {
                out.append(PurePart(entry: entry, n: n))
            } else if token.wholeMatch(of: /[ζθκμ]#?\d+|\d+[ζθκμ]/) != nil {
                return .failure(CalendarError("ζ θ κ μ are depths, not units: a ζ is 11η, a θ 4ι, a κ 13λ, a μ 5ν"))
            } else {
                return .failure(CalendarError("Not understood: “\(String(token.prefix(24)))”. Write α#6 β#4 γ#9 δ#3 ε#5 34η 29ι, Delta Trifracton Node, pos 22.9 or sync 4820"))
            }
            i += 1
        }
        return out.isEmpty ? .failure(CalendarError("Nothing to read")) : .success(out)
    }
}

// MARK: - The Delta page

/// The pure month page: one Delta = 5 Nuclide rows (ε#1–5) × 7 columns of 11 Helions (the ζ cycles, labelled by their
/// first Helion 1η 12η … 67η). Pages are global Delta indices. Quarters of the Delta fall at 1¼, 2½ and 3¾ Nuclides;
/// eclipse k sits at k × 2843.75 cells (pure-conv.js `buildPureGrid`).
struct DeltaPage: Sendable {
    static let rows = 5
    static let columns = 7
    static let cells = 35
    static let helionsPerCell = 11
    /// The first Helion of each column, numbered from 1 in the Nuclide.
    static let columnHelion = (0..<columns).map { $0 * helionsPerCell + 1 }
    /// Pages in one Gamma, Beta and Alpha.
    static let pagesPerGamma = 5
    static let pagesPerBeta = 65
    static let pagesPerAlpha = 325

    struct Cell: Identifiable, Hashable, Sendable {
        let index: Int
        let row: Int
        let column: Int
        /// The global ζ index.
        let z: Int64
        let pos0: Double
        let pos1: Double
        let inRange: Bool
        /// Where the catalogue ends inside the cell (1 when it does not).
        let cut: Double
        /// The first millisecond that shows the cell, and the next cell's.
        let start: Double
        let end: Double
        let eclipse: Int?
        let eclipseFraction: Double
        let syncs: [Mark]
        /// The Delta quarter(s) the cell lies in, as pieces of it.
        let quarters: [QuarterPiece]

        var id: Int { index }
        var epsilon: Int { row + 1 }
        var firstHelion: Int { DeltaPage.columnHelion[column] }
    }

    struct Mark: Hashable, Sendable {
        let sync: Int
        let quarter: Int
        let x: Double
        let time: Double
    }

    struct QuarterPiece: Hashable, Sendable {
        let quarter: Int
        let x0: Double
        let x1: Double
        let startsHere: Bool
    }

    let index: Int
    let cells: [Cell]
    /// The page's place: its Gamma (global index and path α β γ) and its Delta ordinal 1 … 5.
    let gamma: Int64
    let path: [Int]
    let delta: Int

    static func count(_ clock: FractonicaClock) -> Int {
        Int((Double(clock.extent) * clock.levelInfo(3).prefixDouble / 4).rounded(.up))
    }

    static func clampPage(_ clock: FractonicaClock, _ page: Int) -> Int { max(0, min(count(clock) - 1, page)) }

    /// The page that holds t (the header's Delta), or nil outside the catalogue.
    static func page(_ clock: FractonicaClock, at t: Double) -> Int? {
        guard let l = clock.level(at: CalMath.r3(t), 3) else { return nil }
        return min(count(clock) - 1, Int(l.cycle))
    }

    /// The page of α β γ ordinals and a Delta ordinal (clamped into the catalogue).
    static func page(_ clock: FractonicaClock, alpha: Int, beta: Int, gamma: Int, delta: Int) -> Int {
        let g = clock.pathToCycle([alpha, beta, gamma]) ?? Int64(clock.count(2)) - 1
        return clampPage(clock, Int(g) * pagesPerGamma + delta - 1)
    }

    init(clock: FractonicaClock, index: Int, syncRange: ClosedRange<Int>) {
        self.index = index
        gamma = Int64(index / Self.pagesPerGamma)
        delta = index % Self.pagesPerGamma + 1
        path = clock.cycleToPath(level: 2, cycle: gamma)
        let zN = clock.levelInfo(5).prefixDouble
        let extent = Double(clock.extent)
        let z0 = Int64(index * Self.cells)
        let posOf = { (z: Int64) in Double(z) * 4 / zN }
        let starts = (0...Self.cells).map { i -> Double in
            let z = z0 + Int64(i)
            return posOf(z) < extent ? (CalMath.landPoint(clock, level: 5, index: z) ?? clock.tMax) : clock.tMax
        }
        let quarterSpan = Double(Self.cells) / 4
        var marks = [Int: [Mark]]()
        let pageStart = starts[0]
        let pageEnd = starts[Self.cells]
        if posOf(z0) < extent {
            for q in CalMath.syncQuarters(clock, from: pageStart, to: min(clock.tMax, pageEnd) + 1, range: syncRange) {
                guard let pos = clock.position(at: q.start) else { continue }
                let z = Int64(((pos + PureMath.epsPos) * zN / 4).rounded(.down))
                let i = Int(z - z0)
                guard i >= 0, i < Self.cells else { continue }
                let x = max(0, (pos - posOf(z)) / (posOf(z + 1) - posOf(z)))
                marks[i, default: []].append(Mark(sync: q.sync, quarter: q.quarter, x: x, time: q.start))
            }
        }
        let cellsPerSaros = zN / 4 // 2843.75
        cells = (0..<Self.cells).map { i in
            let z = z0 + Int64(i)
            let pos0 = posOf(z), pos1 = posOf(z + 1)
            let inRange = pos0 < extent
            // the eclipse inside the cell: k with floor(k · 2843.75) = z
            let k = Int((Double(z) / cellsPerSaros).rounded(.up))
            let kz = Double(k) * cellsPerSaros
            let eclipse = inRange && k <= clock.extent && Int64(kz.rounded(.down)) == z ? k : nil
            var pieces: [QuarterPiece] = []
            for q in 0..<4 {
                let a = max(Double(i), Double(q) * quarterSpan)
                let b = min(Double(i + 1), Double(q + 1) * quarterSpan)
                if b > a {
                    let from = Double(q) * quarterSpan
                    pieces.append(QuarterPiece(quarter: q, x0: a - Double(i), x1: b - Double(i), startsHere: from >= Double(i) && from < Double(i + 1)))
                }
            }
            return Cell(
                index: i, row: i / Self.columns, column: i % Self.columns, z: z, pos0: pos0, pos1: pos1, inRange: inRange,
                cut: inRange && pos1 > extent ? (extent - pos0) / (pos1 - pos0) : 1,
                start: inRange ? starts[i] : clock.tMax, end: inRange && pos1 < extent ? starts[i + 1] : clock.tMax,
                eclipse: eclipse, eclipseFraction: eclipse != nil ? kz - Double(z) : 0,
                syncs: marks[i] ?? [], quarters: pieces)
        }
    }

    /// The cell holding t (the header's Nuclide and Helion exactly), or nil.
    func cellIndex(_ clock: FractonicaClock, at t: Double) -> Int? {
        guard let l = clock.level(at: CalMath.r3(t), 5) else { return nil }
        let i = Int(l.cycle - Int64(index * Self.cells))
        return i >= 0 && i < Self.cells ? i : nil
    }

    /// How far t is through a cell, 0 … 1, measured in position (exact across an eclipse inside the cell).
    static func fraction(_ clock: FractonicaClock, cell: Cell, at t: Double) -> Double {
        guard let pos = clock.position(at: CalMath.r3(t)) else { return 0 }
        return min(1, max(0, (pos - cell.pos0) / (cell.pos1 - cell.pos0)))
    }

    /// The first millisecond of Helion j (0 … 10) of a cell; nil beyond the catalogue.
    static func helionStart(_ clock: FractonicaClock, cell: Cell, _ j: Int) -> Double? {
        let eta = cell.z * Int64(helionsPerCell) + Int64(j)
        guard clock.cycleStartTime(level: 6, index: eta) != nil else { return nil }
        return CalMath.landPoint(clock, level: 6, index: eta)
    }

    /// Where quarter q of the page's Delta begins: its first millisecond.
    func quarterStart(_ clock: FractonicaClock, _ q: Int) -> Double? {
        CalMath.landPoint(clock, level: 3, index: Int64(index), phase: Double(q) / 4)
    }
}
