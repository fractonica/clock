import FractonicaKit
import Foundation

// Pure-mode wording of the Rings screen: a port of src/ui/rings/pure-text.js (docs/design/80-pure.md, SPEC §15). No
// Gregorian date, zone, Earth time unit or percentage appears in anything produced here; Checks/RingsChecks.swift
// compares it with the JavaScript and scans it with the web app's pure-mode leak rules.
//
// The major rings (α β γ δ) are said in words with their quarter ("Delta Trifracton End"), never with a phase pair; the
// minor rings by where their cycle starts in its Nuclide ("ε#5 34η"), with a pair of two-stroke glyphs where Earth mode
// prints a percentage. A "coordinate" replaces a date and time of day: the stamp cut to a resolution that tells the
// quarters of a cycle apart ("δ#3 ε#5" / "34η 29ι"). Durations always come from `Notation` (`between`, `durationPos`,
// `cycleLength`); real time is counted in Blinks.

struct RingsPureText: Sendable {
    let notation: Notation
    var clock: FractonicaClock { notation.model }

    init(notation: Notation = .standard) {
        self.notation = notation
    }

    // MARK: Coordinates

    /// The digits of a coordinate, longest first: the ordinals α β γ δ ε, the Helion (1–77 in its Nuclide), the counts
    /// ι λ ν, then three virtual digits: the decimals of the ν count below one Blink.
    static let coordinate = ["alpha", "beta", "gamma", "delta", "epsilon", "eta", "iota", "lambda", "nu", "nu.1", "nu.2", "nu.3"]
    /// Index of ε, the last ordinal, and of ν, the finest whole digit.
    static let lastOrdinal = 4
    static let nu = 8
    /// The level of the unit a placing count is given in, by its symbol (the colour of an address token).
    static let levelOfSymbol: [Character: Int] = ["η": 6, "ι": 8, "λ": 10, "ν": 12]
    /// A boundary instant is read 1 ms into the state that starts there (the way the jump controls land on it).
    static let nudge = 0.001

    /// The symbol of digit `i` ("ε", "λ"; the decimals of ν read "ν").
    static func symbol(_ i: Int) -> String {
        Notation.unit(coordinate[min(i, nu)])?.sym ?? "?"
    }

    /// The fields of an instant: 1-based ordinals α … ε, the Helion (1–77) and the 0-based counts ι λ ν, and how far the
    /// running Blink has gone (the decimals of the ν count).
    struct Fields: Equatable, Sendable {
        var ord: [Int]
        var count: [Int]
        var frac: Double
    }

    /// `pureFields`: nil outside the catalogue.
    func fields(at t: Double) -> Fields? {
        guard let d = notation.date(at: t), let c = notation.clock(at: t) else { return nil }
        return Fields(
            ord: [d.alpha, d.beta, d.gamma, d.delta, d.epsilon],
            count: [c.eta, c.iota, c.lambda, c.nu],
            frac: clock.level(at: t, 12)?.phase ?? 0
        )
    }

    /// `fieldsAtPosition`: the fields of the exact position num / den by integer arithmetic on the level table (the
    /// clock never reads an instant at the catalogue's closing edge, where a boundary would show the previous unit).
    func fields(atPosition num: Int128, _ den: Int128 = 1) -> Fields {
        let prefix = { (level: Int) in clock.levelInfo(level).prefix }
        let done = { (level: Int) in num * prefix(level) / (4 * den) }
        let local = { (level: Int) -> Int in
            guard let siblings = clock.levelInfo(level).siblings else { return Int(done(level)) }
            return Int(done(level) % Int128(siblings))
        }
        let count = { (between: Int, unit: Int) in local(between) * (clock.levelInfo(unit).siblings ?? 1) + local(unit) }
        let nuWhole = num * prefix(12) / (4 * den)
        let nuRest = num * prefix(12) - nuWhole * 4 * den
        return Fields(
            ord: [Int(done(0)) + 1, local(1) + 1, local(2) + 1, local(3) + 1, local(4) + 1],
            count: [count(5, 6) + 1, count(7, 8), count(9, 10), count(11, 12)],
            frac: Double(nuRest) / Double(4 * den)
        )
    }

    /// Nominal length of a cycle of `level` in Saros position units (only to pick a resolution).
    func cycleSpan(_ level: Int) -> Double { 4 / clock.levelInfo(level).prefixDouble }

    /// Index into `coordinate` of the largest digit that fits `divisor` times into a span of `span` Saros units: the
    /// resolution that tells the quarters of a cycle apart (4) or a pointer position (160).
    func resolution(span: Double, divisor: Double = 4) -> Int {
        let step = span / divisor
        guard let nuUnit = Notation.unit("nu") else { return Self.coordinate.count - 1 }
        let nuLength = notation.unitPos(nuUnit)
        for (i, id) in Self.coordinate.enumerated() {
            let length = i > Self.nu ? nuLength / pow(10, Double(i - Self.nu)) : Notation.unit(id).map(notation.unitPos) ?? 0
            if length <= step * (1 + 1e-9) { return i }
        }
        return Self.coordinate.count - 1
    }

    /// "3.43": the ν count with `decimals` decimals, floored (a count never reads further along than it is).
    static func nuCount(_ whole: Int, _ frac: Double, decimals: Int) -> String {
        let k = pow(10, Double(decimals))
        let v = ((Double(whole) + frac) * k + 1e-7).rounded(.down) / k
        return String(format: "%.\(decimals)f", v)
    }

    /// The coordinate text of fields at resolution `res`: the stamp down to that digit, cut into `time` (its trailing
    /// counts, at most `timeTokens`) and `date` (the `dateTokens` tokens just before them), so the two always join
    /// into a piece of the stamp.
    func parts(_ f: Fields, res: Int, dateTokens: Int = 3, timeTokens: Int = 6) -> (date: String, time: String) {
        var tokens: [String] = []
        for i in 0...min(res, Self.lastOrdinal) { tokens.append("\(Self.symbol(i))#\(f.ord[i])") }
        let lastDigit = min(res, Self.nu)
        if lastDigit > Self.lastOrdinal {
            for i in (Self.lastOrdinal + 1)...lastDigit {
                let n = f.count[i - Self.lastOrdinal - 1]
                let number = i == Self.nu && res > Self.nu ? Self.nuCount(n, f.frac, decimals: res - Self.nu) : "\(n)"
                tokens.append(number + Self.symbol(i))
            }
        }
        let counts = max(0, lastDigit - Self.lastOrdinal)
        let cut = tokens.count - min(timeTokens, counts)
        return (
            tokens[max(0, cut - dateTokens)..<cut].joined(separator: " "),
            tokens[cut...].joined(separator: " ")
        )
    }

    /// Fields of a boundary instant: 1 ms into the state that starts there; the catalogue's closing edge reads from
    /// its exact position.
    func boundaryFields(at t: Double) -> Fields? {
        if t + Self.nudge >= clock.tMax { return fields(atPosition: Int128(clock.extent)) }
        return fields(at: t + Self.nudge)
    }

    /// The coordinate of instant `t` at resolution `res`: date "δ#3 ε#5", time "34η 29ι" ("" when coarser than η).
    func when(_ t: Double, res: Int, dateTokens: Int = 3, timeTokens: Int = 6) -> (date: String, time: String) {
        guard let f = boundaryFields(at: t) else { return ("—", "") }
        return parts(f, res: res, dateTokens: dateTokens, timeTokens: timeTokens)
    }

    /// `when` on one line, as the stamp writes it.
    func whenText(_ t: Double, res: Int, dateTokens: Int = 3, timeTokens: Int = 6) -> String {
        let w = when(t, res: res, dateTokens: dateTokens, timeTokens: timeTokens)
        return [w.date, w.time].filter { !$0.isEmpty }.joined(separator: " ")
    }

    /// One of the five boundary labels of a cycle (begin, peak, node, valley, end).
    struct BoundaryLabel: Equatable, Sendable {
        /// "" when the previous label already says it, like a clock under its date.
        var date: String
        var time: String
        /// The same label with less and less context, for narrow places.
        var alt: [Pair]
        /// The label has not left the ordinals of the cycle's start.
        var sameAsStart: Bool
        var full: Pair

        struct Pair: Equatable, Sendable {
            var date: String
            var time: String
        }
    }

    /// `boundaryLabels`: the coordinates of a cycle's five events (`times` as `LevelReading.thresholds`; nil beyond the
    /// catalogue), ordinals written once and repeated only where they change.
    func boundaryLabels(level: Int, times: [Double?]) -> [BoundaryLabel?] {
        let res = resolution(span: cycleSpan(level))
        let fields = times.map { $0.flatMap(boundaryFields(at:)) }
        func at(_ f: Fields?, _ dateTokens: Int, _ timeTokens: Int) -> BoundaryLabel.Pair? {
            f.map { let p = parts($0, res: res, dateTokens: dateTokens, timeTokens: timeTokens); return .init(date: p.date, time: p.time) }
        }
        let full = fields.map { at($0, 2, 3) }
        let short = fields.map { at($0, 1, 2) }
        let tiny = fields.map { at($0, 1, 1) }
        return full.indices.map { i -> BoundaryLabel? in
            guard let p = full[i] else { return nil }
            let prev = full[..<i].last { $0 != nil } ?? nil
            let sameAsPrev = prev != nil && !p.time.isEmpty && prev!.date == p.date
            func less(_ q: BoundaryLabel.Pair?, noDate: Bool) -> BoundaryLabel.Pair {
                guard let q else { return .init(date: "", time: "") }
                return .init(date: sameAsPrev || (noDate && !q.time.isEmpty) ? "" : q.date, time: q.time)
            }
            return BoundaryLabel(
                date: sameAsPrev ? "" : p.date,
                time: p.time,
                alt: [less(short[i], noDate: false), less(tiny[i], noDate: true)],
                sameAsStart: full[0] != nil && !p.time.isEmpty && full[0]!.date == p.date,
                full: p
            )
        }
    }

    /// The short text that follows a finger or pointer over the wave: finer than a boundary label.
    func pointerText(level: Int, _ t: Double) -> String {
        whenText(t, res: resolution(span: cycleSpan(level), divisor: 160), dateTokens: 1)
    }

    // MARK: Names and sentences

    static func isMajor(_ level: Int) -> Bool { Notation.isMajor(level) }

    /// Peak, Node, Valley or End: the threshold that ends the quarter a phase is in.
    static func quarterWord(_ phase: Double) -> String {
        Notation.quarterWords[min(3, max(0, Int((phase * 4).rounded(.down))))]
    }

    /// A major cycle in words ("Delta Trifracton"), a minor one by where it starts ("ε#5", "ε#5 34η", "ε#5 34η 28ι").
    func cycleName(level: Int, cycle: Int64) -> String {
        notation.cycleName(level: level, cycle: cycle)
    }

    /// With the quarter of a major cycle ("Delta Trifracton End"); a minor cycle has its placing only.
    func displayName(_ r: LevelReading) -> String {
        let name = cycleName(level: r.level, cycle: r.cycle)
        return Self.isMajor(r.level) ? "\(name) \(Self.quarterWord(r.phase))" : name
    }

    /// What begins when cycle `cycle` of `level` ends, as briefly as the context allows; nil when the catalogue ends
    /// there. Major "Delta Tetrafracton"; ε "ε#4" or "ε#1 of Delta Tetrafracton"; finer only the placing counts that
    /// change ("35η", "30ι", "35η 0ι"), the whole name when the Nuclide turns over.
    func follower(level: Int, cycle: Int64, end: Double, clipped: Bool) -> String? {
        if clipped || end >= clock.tMax - 1e-6 { return nil }
        let next = cycle + 1
        if level < 4 { return notation.cycleName(level: level, cycle: next) }
        let a = notation.countsAtStart(level: level, cycle: cycle)
        let b = notation.countsAtStart(level: level, cycle: next)
        if level == 4 {
            return a.delta == b.delta ? "ε#\(b.epsilon)" : "ε#\(b.epsilon) of \(Notation.periodName(level: 3, ordinal: b.delta))"
        }
        if a.delta != b.delta || a.epsilon != b.epsilon { return notation.cycleName(level: level, cycle: next) }
        let was = notation.cycleName(level: level, cycle: cycle, short: true).split(separator: " ").map(String.init)
        let now = notation.cycleName(level: level, cycle: next, short: true).split(separator: " ").map(String.init)
        let i = now.indices.first { k in k >= was.count || now[k] != was[k] } ?? 0
        return now[i...].joined(separator: " ")
    }

    func follower(_ r: LevelReading) -> String? {
        follower(level: r.level, cycle: r.cycle, end: r.end, clipped: r.clipped)
    }

    /// "→ 35η begins" / "→ Delta Tetrafracton begins", or "→ end of the catalogue".
    func endLine(_ r: LevelReading) -> String {
        follower(r).map { "→ \($0) begins" } ?? "→ end of the catalogue"
    }

    /// "ends → 35η begins" / "the catalogue ends here".
    func endsSentence(level: Int, cycle: Int64, end: Double, clipped: Bool) -> String {
        follower(level: level, cycle: cycle, end: end, clipped: clipped).map { "ends → \($0) begins" } ?? "the catalogue ends here"
    }

    /// The span between two instants counted on the ladder ("6ι 43λ"; negative "−20ι 21λ").
    func between(_ from: Double, _ to: Double, parts: Int = 2) -> String {
        notation.between(from, to, parts: parts)
    }

    /// The big countdown in the middle of the dial: two counts, or three while the third stays steady (never finer
    /// than λ); a compact dial has two.
    func centreSpan(from: Double, to: Double, compact: Bool = false) -> String {
        guard !compact, let a = clock.position(at: from), let b = clock.position(at: to) else {
            return between(from, to)
        }
        let d = max(0, b - a)
        guard let lambda = Notation.unit("lambda") else { return between(from, to) }
        if let lead = notation.decompose(d, parts: 1).first, lead.unit.level >= lambda.level {
            return notation.durationPos(d, parts: 2)
        }
        let length = notation.unitPos(lambda)
        let steady = ((d + 1e-12) / length).rounded(.down) * length
        return notation.durationPos(steady, parts: 3)
    }

    /// "in 6ι 43λ" / "5ι 2λ ago".
    func inText(now: Double, _ t: Double, parts: Int = 2) -> String {
        t >= now ? "in \(between(now, t, parts: parts))" : "\(between(t, now, parts: parts)) ago"
    }

    /// "starts in 2ε 10η" / "started 2η ago" / "running now".
    func startPhrase(start: Double, end: Double, now: Double) -> String {
        if now >= start && now < end { return "running now" }
        return start > now ? "starts \(inText(now: now, start))" : "started \(inText(now: now, start))"
    }

    /// How long a cycle lasts: the exact nominal length of a whole one ("1δ", "11η", "0.14ν"); a cycle clipped by the
    /// catalogue's end is measured.
    func lengthText(level: Int, start: Double, end: Double, clipped: Bool) -> String {
        clipped ? notation.between(start, end) : notation.cycleLength(level: level)
    }

    /// How many of the next unit make one cycle of a unit level.
    static let nextUnit: [Int: (Int, String)] = [0: (5, "β"), 1: (13, "γ"), 2: (5, "δ"), 3: (5, "ε"), 4: (77, "η"), 6: (36, "ι"), 8: (65, "λ"), 10: (25, "ν")]

    /// The unit a whole cycle of `level` is ("Helion"), or "" (majors are said in words, ζ θ κ μ ξ are no units).
    static func unitNote(_ level: Int) -> String {
        Notation.levelKind(level) == "unit" ? Notation.unitName(level: level) : ""
    }

    /// `lengthText` with what one cycle is made of: "1δ = 5ε", "1η (Helion) = 36ι", "11η", "0.14ν".
    func lengthWithName(level: Int, start: Double, end: Double, clipped: Bool) -> String {
        let text = lengthText(level: level, start: start, end: end, clipped: clipped)
        if clipped { return text }
        let name = Self.unitNote(level)
        let made = Self.nextUnit[level].map { " = \($0.0)\($0.1)" } ?? ""
        return text + (name.isEmpty ? "" : " (\(name))") + made
    }

    /// A span of real (device) time counted in Blinks: "325 Blinks", "58 500 Blinks", "0.143 Blinks".
    func blinkSpan(_ seconds: Double) -> String {
        let n = seconds / notation.blinkSeconds
        if n >= 100 { return "\(Notation.groupDigits(n.rounded())) \(Notation.blink)s" }
        return notation.blinks(seconds)
    }

    /// One turn of a ring in real time ("about 325 Blinks" without the "about").
    func aboutTurn(_ level: Int) -> String {
        blinkSpan(clock.levelInfo(level).meanSeconds)
    }

    // MARK: Threshold chips

    static let quarterNames = ["peak", "node", "valley", "end"]

    /// What a quarter chip says (`chipText`): `k` 0 … 3 = peak … end, `t` its instant (nil beyond the catalogue),
    /// `label` its boundary label (index k + 1 of `boundaryLabels`).
    struct Chip: Equatable, Sendable {
        var count: String
        var date: String
        var time: String
        var title: String
        /// What a screen reader says.
        var label: String
    }

    func chip(_ r: LevelReading, k: Int, t: Double?, now: Double, label: BoundaryLabel?) -> Chip {
        let name = Self.quarterNames[k]
        guard let t, let label else {
            let none = "\(name): beyond the end of the catalogue"
            return Chip(count: "", date: "—", time: "", title: none, label: none)
        }
        let of = cycleName(level: r.level, cycle: r.cycle)
        let w = label.full
        let place = [w.date, w.time].filter { !$0.isEmpty }.joined(separator: " ")
        let count = between(now, t)
        let next = follower(r)
        let what = k == 3 ? "the end of \(of) (\(next.map { "\($0) begins" } ?? "the catalogue ends"))" : "the \(name) of \(of)"
        let when = inText(now: now, t)
        return Chip(
            count: count,
            date: label.sameAsStart && !w.time.isEmpty ? "" : w.date,
            time: w.time,
            title: "\(r.quarter > k ? "Jump back to" : "Jump just past") \(what) · \(place) · \(when)",
            label: "\(what), \(when), at \(place)"
        )
    }

    // MARK: Facts

    /// "phase 13 and 4 of 256": the pair in words.
    static func pairLabel(_ phase: Double, label: String = "phase") -> String {
        let p = Notation.pair(phase)
        return "\(label) \(p.hi) and \(p.lo) of 256"
    }

    /// The phase fact: the pair in words for a minor cycle, the quarter for a major one ("End quarter").
    static func stateText(_ phase: Double, level: Int) -> String {
        isMajor(level) ? "\(quarterWord(phase)) quarter" : pairLabel(phase)
    }

    /// The address of a cycle as tokens with the level that colours them: the ordinals of the majors and the Nuclide
    /// (α#6 β#4 γ#9 δ#3 ε#5), then the Helion and the counts that place a minor cycle in it (34η 29ι).
    func addressTokens(level: Int, cycle: Int64) -> [(level: Int, text: String)] {
        let path = clock.cycleToPath(level: level, cycle: cycle)
        var out = path.prefix(min(level, 4) + 1).enumerated().map { (level: $0.offset, text: Notation.shortName(level: $0.offset, ordinal: $0.element)) }
        if level >= 5 {
            for token in notation.cycleName(level: level, cycle: cycle, short: true).split(separator: " ") {
                out.append((Self.levelOfSymbol[token.last ?? " "] ?? level, String(token)))
            }
        }
        return out
    }

    /// Slider text for assistive technology: "Rising, phase 13 and 4 of 256 in ε#5 34η"; a major cycle "Falling, End
    /// quarter of Delta Trifracton".
    static func sliderText(word: String, phase: Double, name: String, level: Int) -> String {
        isMajor(level) ? "\(word), \(stateText(phase, level: level)) of \(name)" : "\(word), \(pairLabel(phase)) in \(name)"
    }
}
