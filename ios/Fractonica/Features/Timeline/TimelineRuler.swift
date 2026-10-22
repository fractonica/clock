import FractonicaKit
import Foundation

/// The pure ruler: the Fractonica replacement of the Gregorian axis (src/ui/timeline/ruler.js, SPEC §15,
/// docs/design/40-timeline.md "Pure mode").
///
/// The ladder is `Notation.units`, index 0 … 8: the major periods α β γ δ (said in words, "Delta Trifracton") and the
/// minor units ε η ι λ ν (letters and counts, "ε#5 34η 29ι 21λ 3ν"). A tick starts a unit and is written as
/// `Notation.stamp` writes it: α … ε are ordinals from 1 ("δ#3", "ε#2"); the Helion is numbered from 1 in its Nuclide
/// ("34η"); Preons, Flavons and Blinks count completed units from 0. The context row names the next coarser unit; above
/// whole major-period ticks it is cut into the parent's quarters, named by the threshold that ends them.
///
/// Which unit an instant is in is read two ways: by time, exactly (`FractonicaClock.level(at:)`, the header's floor),
/// for flags and stamps; by float position with an absolute tolerance, for the middle of a stretch or a grid point.
struct TimelineRuler: Sendable {
    /// A step of the ruler: unit `u` (ladder index) or every m-th one, or the tenths of a Blink (`div`).
    struct Step: Hashable, Sendable {
        let id: String
        let u: Int
        let level: Int
        let m: Int
        let sym: String
        /// Mean seconds between labelled ticks.
        let nominal: Double
        let chars: Int
        let charsShort: Int
        /// Ladder index of the context row's unit, −1 for none.
        let ctx: Int
        /// The context row is cut into the quarters of a major period.
        let quarters: Bool
        /// Cuts every unit into this many parts (the Blink's tenths); 0 otherwise.
        var div = 0
    }

    /// A zoom preset: one unit across (`u` its ladder index), or the whole catalogue (`u` −1).
    struct Preset: Hashable, Sendable {
        let id: String
        let label: String
        let u: Int
        let deepest: Bool
    }

    let clock: FractonicaClock
    let notation: Notation
    let units = Notation.units
    /// Length of a unit in Saros positions, and in mean seconds.
    let len: [Double]
    let sec: [Double]
    let prefix: [Double]
    let alphaCount: Int
    /// How many of a unit make the previous one (index 0: the catalogue's α count).
    let per: [Int]
    let steps: [Step]
    private let stepByID: [String: Step]
    let presets: [Preset]

    /// The ladder indices that matter by name.
    static let gamma = 2, delta = 3, epsilon = 4, eta = 5, iota = 6, lambda = 7, nu = 8
    /// Majors and the Nuclide are ordinals ("ε#5"); from the Helion on the ladder is written as counts ("34η").
    static let firstCountUnit = eta
    /// Float noise of a position near 70 is ~1.4e-14 Saros; this absolute tolerance (60 µs) is above it for every unit.
    static let epsPos = 1e-13

    /// Multiples a step may use per unit: the grids of the depths between (11η, 4ι, 13λ, 5ν) among them, so the
    /// labelled ticks fall where those lanes start; neighbouring steps are at most 2.6 apart.
    private static let multiples: [String: [Int]] = [
        "nu": [1, 2, 5, 10],
        "lambda": [1, 2, 5, 13, 26],
        "iota": [1, 2, 4, 6, 12, 18],
        "eta": [1, 2, 3, 5, 11, 22, 33],
        "epsilon": [1, 2],
        "delta": [1, 2],
        "gamma": [1, 2, 3, 6],
        "beta": [1, 2],
        "alpha": [1, 2],
    ]
    /// The unlabelled finer step between the labelled ticks of a whole unit.
    private static let minorOfUnit: [String: String] = [
        "nu": "nu/10", "lambda": "nu×5", "iota": "lambda×13", "eta": "iota×4", "epsilon": "eta×11",
        "delta": "epsilon", "gamma": "delta", "beta": "gamma", "alpha": "beta",
    ]
    /// The most labelled ticks a plot shows, the plot width below which ordinals use their short form, and how many ticks
    /// of a whole unit make it preferable to a multiple of the unit below.
    static let maxLabels = 12.0
    static let narrowPlot = 520.0
    static let preferLabels = 4.8

    init(clock: FractonicaClock = .shared, notation: Notation = .standard) {
        self.clock = clock
        self.notation = notation
        let units = Notation.units
        len = units.map { notation.unitPos($0) }
        sec = units.map { notation.unitSeconds($0) }
        prefix = units.map { clock.levelInfo($0.level).prefixDouble }
        alphaCount = Int(clock.count(0))
        var per = [alphaCount]
        for i in 1..<units.count { per.append(Int((len[i - 1] / len[i]).rounded())) }
        self.per = per

        func fromOne(_ i: Int) -> Bool { i <= Self.eta }
        func digits(_ n: Int) -> Int { String(max(0, n)).count }
        func top(_ i: Int) -> Int { fromOne(i) ? per[i] : per[i] - 1 }
        var steps: [Step] = []
        for i in stride(from: units.count - 1, through: 0, by: -1) {
            let u = units[i]
            let chars = u.sym.count + (i < Self.firstCountUnit ? 1 : 0) + digits(top(i))
            let charsShort = i < Self.firstCountUnit ? 1 + digits(top(i)) : chars
            for m in (Self.multiples[u.id] ?? [1]) where m == 1 || 2 * m <= per[i] {
                let ctx = i - 1
                steps.append(Step(
                    id: m == 1 ? u.id : "\(u.id)×\(m)", u: i, level: u.level, m: m, sym: u.sym,
                    nominal: sec[i] * Double(m), chars: chars, charsShort: charsShort, ctx: ctx,
                    quarters: ctx >= 0 && units[ctx].major && m == 1
                ))
            }
        }
        self.steps = steps
        var byID = Dictionary(uniqueKeysWithValues: steps.map { ($0.id, $0) })
        let nu = Self.nu
        byID["nu/10"] = Step(id: "nu/10", u: nu, level: units[nu].level, m: 1, sym: units[nu].sym, nominal: sec[nu] / 10,
                             chars: 0, charsShort: 0, ctx: nu - 1, quarters: false, div: 10)
        stepByID = byID
        presets = ["nu", "lambda", "iota", "eta", "epsilon", "delta", "gamma", "beta", "alpha"].map { id in
            let u = units.firstIndex { $0.id == id }!
            return Preset(id: "u:\(id)", label: units[u].sym, u: u, deepest: u == nu)
        } + [Preset(id: "all", label: "All", u: -1, deepest: false)]
    }

    // MARK: Counters and addresses

    func perOf(_ i: Int) -> Int { per[i] }
    func isMajor(_ i: Int) -> Bool { i >= 0 && i < units.count && units[i].major }
    private func fromOne(_ i: Int) -> Bool { i <= Self.eta }
    func unitIndex(_ id: String) -> Int { units.firstIndex { $0.id == id } ?? -1 }
    /// The ladder index of a 0-based level when that depth is a unit, else nil.
    func unitOfLevel(_ level: Int) -> Int? { units.firstIndex { $0.level == level } }

    /// The counter shown for the unit with global index `idx`: from 1 for α … ε and the Helion, from 0 below it.
    func counter(_ i: Int, _ idx: Int64) -> Int {
        let n = Int64(perOf(i))
        return Int(((idx % n) + n) % n) + (fromOne(i) ? 1 : 0)
    }

    /// "α#6", "δ#3", "ε#5" (ordinals) or "34η", "21λ" (numbers and counts).
    func tokenText(_ i: Int, _ c: Int) -> String {
        i < Self.firstCountUnit ? "\(units[i].sym)#\(c)" : "\(c)\(units[i].sym)"
    }

    /// "Delta Trifracton".
    func words(_ i: Int, _ c: Int) -> String { Notation.periodName(level: units[i].level, ordinal: c) }

    /// A tick's labels, longest first: "Delta Trifracton" → "δ#3" → "#3"; "ε#5" → "#5"; "34η".
    func tickLabels(_ i: Int, _ c: Int) -> [String] {
        if isMajor(i) { return [words(i, c), tokenText(i, c), "#\(c)"] }
        if i < Self.firstCountUnit { return [tokenText(i, c), "#\(c)"] }
        return [tokenText(i, c)]
    }

    /// Index of the unit running at position p (float, absolute tolerance).
    func indexAtPos(_ i: Int, _ p: Double) -> Int64 {
        Int64(((p + Self.epsPos) * prefix[i] / 4).rounded(.down))
    }

    /// Index of the unit running at t, exactly as the header reads it; nil outside the catalogue.
    func indexAtTime(_ i: Int, _ t: Double) -> Int64? {
        clock.level(at: t, units[i].level)?.cycle
    }

    struct Token: Sendable {
        let u: Int
        let c: Int
        let text: String
    }

    /// The tokens of `which` units at time t (exact); empty outside the catalogue.
    func tokens(at t: Double, _ which: [Int]) -> [Token] {
        var out: [Token] = []
        for i in which {
            guard let idx = indexAtTime(i, t) else { return [] }
            let c = counter(i, idx)
            out.append(Token(u: i, c: c, text: tokenText(i, c)))
        }
        return out
    }

    func tokens(atPos p: Double, _ which: [Int]) -> [Token] {
        which.map { i in
            let c = counter(i, indexAtPos(i, p))
            return Token(u: i, c: c, text: tokenText(i, c))
        }
    }

    /// The units of a flag's address for ticks of unit `u`: from the Preon on the header clock "34η 29ι 21λ" (with "3ν"
    /// while the ticks are finer), coarser ticks show the tick unit between its neighbours ("δ#3 ε#5 34η" for ε).
    func flagUnits(_ u: Int) -> [Int] {
        let eta = Self.eta, iota = Self.iota
        if u >= iota { return u > iota ? [eta, iota, iota + 1, iota + 2] : [eta, iota, iota + 1] }
        let a = max(0, min(u - 1, units.count - 3))
        return [a, a + 1, a + 2]
    }

    /// The cursor / now / pointer flag at t for ticks of unit `u`: "34η 29ι 21λ"; "" outside the catalogue.
    func flagText(_ t: Double, u: Int) -> String {
        tokens(at: TimelineSearch.ms(t), flagUnits(u)).map(\.text).joined(separator: " ")
    }

    /// The finest unit a flag for ticks of unit `u` names: how often it changes.
    func flagResolution(_ u: Int) -> Double { sec[flagUnits(u).last ?? Self.nu] }

    /// The letter address at t from unit `from` to unit `to`: "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι".
    func chain(at t: Double, from: Int = 0, to: Int) -> String {
        tokens(at: t, Array(from...to)).map(\.text).joined(separator: " ")
    }

    // MARK: Positions and spans

    func posOf(_ t: Double) -> Double? { clock.position(at: t) }

    /// The position of any instant: outside the catalogue it continues at the mean Saros length (for lengths only).
    func posExt(_ t: Double) -> Double {
        if t < clock.tMin { return -(clock.tMin - t) / clock.meanSaros }
        if t > clock.tMax { return Double(clock.extent) + (t - clock.tMax) / clock.meanSaros }
        return clock.position(at: t) ?? 0
    }

    func timeExt(_ p: Double) -> Double {
        if p < 0 { return clock.tMin + p * clock.meanSaros }
        if p > Double(clock.extent) { return clock.tMax + (p - Double(clock.extent)) * clock.meanSaros }
        return clock.time(atPosition: p)
    }

    /// The start of the unit with global index x of unit i (fractions allowed: quarters, tenths); nil beyond the
    /// catalogue (model.js `cycleStartTime` in float arithmetic).
    func startTime(_ i: Int, _ x: Double) -> Double? {
        TimelineRuler.startTime(clock, level: units[i].level, x)
    }

    static func startTime(_ clock: FractonicaClock, level: Int, _ x: Double) -> Double? {
        let p = clock.levelInfo(level).prefixDouble
        let n = x * 4
        let k = (n / p).rounded(.down)
        let extent = Double(clock.extent)
        if k > extent { return nil }
        if k == extent { return n - k * p == 0 ? clock.tMax : nil }
        guard k >= 0 else { return nil }
        let i = Int(k)
        let f = (n - k * p) / p
        return clock.catalogue[i] + f * (clock.catalogue[i + 1] - clock.catalogue[i])
    }

    /// A length counted in ladder units around t0 < t1 ("2ε 10η"), measured in position; under ten Blinks a decimal
    /// ("6.4ν"). `slack` is the relative width the eye cannot tell apart: a window one unit across within half a pixel
    /// reads "1α", not "4β 12γ".
    func spanText(_ t0: Double, _ t1: Double, parts: Int = 2, slack: Double = 0) -> String {
        let span = posExt(t1) - posExt(t0)
        if slack > 0, span > 0 {
            let eps = span * slack
            let cs = notation.decompose(span + eps, parts: parts)
            if let first = cs.first, first.unit.id != units[units.count - 1].id {
                var acc = 0.0
                for (unit, count) in cs {
                    acc += Double(count) * notation.unitPos(unit)
                    if span - acc <= eps { return notation.durationPos(acc, parts: parts) }
                }
            }
        }
        return notation.durationPos(span, parts: parts)
    }

    /// "in 2ε 10η" / "6ι 43λ ago" for t relative to ref; "now" only within the same millisecond.
    func relText(_ t: Double, to ref: Double) -> String {
        if abs(t - ref) < 0.001 { return "now" }
        return t > ref ? "in \(notation.between(ref, t))" : "\(notation.between(t, ref)) ago"
    }

    /// "from → to" of a window in letters, the shared leading part written once:
    /// "α#6 β#4 γ#9 δ#3 ε#5 32η 30ι → 34η 1ι". An edge outside the catalogue says so.
    func rangeText(_ t0: Double, _ t1: Double, to: Int = TimelineRuler.iota) -> String {
        func edge(_ t: Double) -> String? {
            let s = TimelineSearch.ms(t)
            if s >= clock.tMin && s <= clock.tMax { return nil }
            return s < clock.tMin ? "before the catalogue" : "after the catalogue"
        }
        let ea = edge(t0), eb = edge(t1)
        if let ea, let eb { return ea == eb ? ea : "the whole catalogue" }
        if ea != nil || eb != nil { return "\(ea ?? chain(at: t0, to: to)) → \(eb ?? chain(at: t1, to: to))" }
        let a = tokens(at: t0, Array(0...to)), b = tokens(at: t1, Array(0...to))
        guard !a.isEmpty, !b.isEmpty else { return "" }
        var common = 0
        while common < a.count - 1 && a[common].text == b[common].text { common += 1 }
        let head = common > 0 ? a[0..<common].map(\.text).joined(separator: " ") + " " : ""
        return head + a[common...].map(\.text).joined(separator: " ") + " → " + b[common...].map(\.text).joined(separator: " ")
    }

    // MARK: Steps

    func step(id: String) -> Step? { stepByID[id] }

    /// The unlabelled finer step between the labelled ticks.
    func minor(of step: Step) -> Step? {
        if step.div > 0 { return nil }
        if step.m == 1 { return Self.minorOfUnit[units[step.u].id].flatMap { stepByID[$0] } }
        var best = 1
        for x in (Self.multiples[units[step.u].id] ?? [1]) where x == 1 || 2 * x <= per[step.u] {
            if x >= step.m || step.m % x != 0 { continue }
            if abs(log(Double(step.m) / Double(x) / 4)) <= abs(log(Double(step.m) / Double(best) / 4)) { best = x }
        }
        return stepByID[best == 1 ? units[step.u].id : "\(units[step.u].id)×\(best)"]
    }

    /// The finest step whose labels still have room; never more than `maxLabels` labels across. A multiple gives way to
    /// the whole unit above it once that unit has `preferLabels` ticks on the plot.
    func pick(pxPerSec: Double, plotWidth: Double, charW: Double = 6.6) -> Step {
        let roomy = plotWidth / Self.maxLabels
        let narrow = plotWidth < Self.narrowPlot
        for (k, s) in steps.enumerated() {
            let need = max(Double(narrow ? s.charsShort : s.chars) * charW + (narrow ? 10 : 18), roomy)
            if s.nominal * pxPerSec < need { continue }
            if s.m > 1, let whole = steps[(k + 1)...].first(where: { $0.m == 1 }),
               plotWidth / (whole.nominal * pxPerSec) >= Self.preferLabels {
                return whole
            }
            return s
        }
        return steps[steps.count - 1]
    }

    /// The ticks of a step in [from, to]. Every parent is counted from its own start: ticks at 0, m, 2m … while a full
    /// step still fits before the parent ends. `major` marks a parent's start. Nothing outside the catalogue.
    func ticks(_ step: Step, from: Double, to: Double, limit: Int = 6000) -> [TimelineTick] {
        let i = step.u
        let a = max(from, clock.tMin), b = min(to, clock.tMax)
        guard b >= a, let pa = posOf(a), let pb = posOf(b) else { return [] }
        var out: [TimelineTick] = []
        if step.div > 0 {
            let d = Double(step.div)
            let lo = max(0, (pa / len[i] * d).rounded(.down) - 1)
            let hi = (pb / len[i] * d).rounded(.up) + 1
            var k = lo
            while k <= hi && out.count < limit {
                defer { k += 1 }
                guard let t = startTime(i, k / d), t < clock.tMax else { break }
                if t < from - 1e-6 || t > to + 1e-6 { continue }
                out.append(TimelineTick(t: t, labels: [], major: false))
            }
            return out
        }
        let m = Int64(step.m)
        let n = Int64(perOf(i))
        let lo = max(0, Int64((pa / len[i]).rounded(.down)) - 1)
        let hi = Int64((pb / len[i]).rounded(.up)) + 1
        var j = lo / n
        while j * n <= hi {
            var o: Int64 = 0
            while o + m <= n {
                defer { o += m }
                let k = j * n + o
                if k < lo { continue }
                if k > hi || out.count >= limit { return out }
                guard let t = startTime(i, Double(k)), t < clock.tMax else { return out }
                if t < from - 1e-6 || t > to + 1e-6 { continue }
                let c = counter(i, k)
                out.append(TimelineTick(t: t, labels: tickLabels(i, c), major: i == 0 || o == 0))
            }
            j += 1
        }
        return out
    }

    // MARK: The context row

    /// Labels of a stretch whose address at p runs down to unit c, longest first: majors in words joined by " · ",
    /// then the minor letters, dropping leading parts one by one; then the letter form and the bare ordinal.
    func stretchLabels(_ p: Double, _ c: Int, quarter: String? = nil) -> [String] {
        let which = (0...c).filter { isMajor(c) || $0 >= Self.gamma }
        let toks = tokens(atPos: p, which)
        var parts = toks.map { tk in isMajor(tk.u) ? (text: words(tk.u, tk.c), major: true) : (text: tk.text, major: false) }
        if let quarter, !parts.isEmpty { parts[parts.count - 1].text += " \(quarter)" }
        func join(_ ps: ArraySlice<(text: String, major: Bool)>) -> String {
            var s = ""
            var previousMajor: Bool?
            for x in ps {
                if let pm = previousMajor { s += pm ? " · " : " " }
                s += x.text
                previousMajor = x.major
            }
            return s
        }
        var labels = (0..<parts.count).map { join(parts[$0...]) }
        if let last = toks.last {
            if isMajor(c) {
                labels.append(quarter.map { "\(last.text) \($0)" } ?? last.text)
                labels.append(quarter ?? "#\(last.c)")
            } else if c < Self.firstCountUnit {
                labels.append("#\(last.c)")
            }
        }
        return labels
    }

    /// Stretches of unit c overlapping [from, to]; with `quarters` every cycle is cut into its four quarters, each named
    /// by its quarter word (`ord` then counts quarters).
    func spans(_ c: Int, from: Double, to: Double, quarters: Bool = false, limit: Int = 4000) -> [TimelineSpan] {
        guard c >= 0 else { return [] }
        let a = max(from, clock.tMin), b = min(to, clock.tMax)
        guard b >= a, let pa = posOf(a), let pb = posOf(b) else { return [] }
        let q = quarters ? 4.0 : 1.0
        let k0 = max(0, (pa / len[c] * q).rounded(.down))
        let k1 = max(k0, (pb / len[c] * q).rounded(.up) - 1)
        var out: [TimelineSpan] = []
        var k = k0
        let ext = Double(clock.extent)
        while k <= k1 && out.count < limit {
            defer { k += 1 }
            guard let t0 = startTime(c, k / q) else { break }
            let t1 = startTime(c, (k + 1) / q) ?? clock.tMax
            if !(t1 > t0) { continue }
            let mid = min(ext - 10 * Self.epsPos, (k + 0.5) / q * len[c])
            let word = quarters ? Notation.quarterWords[Int(k) % 4] : nil
            out.append(TimelineSpan(t0: t0, t1: t1, labels: stretchLabels(mid, c, quarter: word), ord: Int(k)))
        }
        return out
    }

    /// The context row of a step: the quarters of the major period above whole-unit ticks, else the next coarser unit.
    func context(_ step: Step, from: Double, to: Double) -> [TimelineSpan] {
        spans(step.ctx, from: from, to: to, quarters: step.quarters)
    }

    /// The catalogue map's labels: "#10", "#20" … at those eclipses.
    func overviewMarks(every: Int = 10) -> [(t: Double, label: String)] {
        stride(from: every, to: clock.extent, by: every).map { (clock.catalogue[$0], Notation.eclipseName($0)) }
    }

    // MARK: Presets

    func preset(_ id: String) -> Preset? { presets.first { $0.id == id } }

    /// Window width of a preset centred on `at`: one unit across in position, or the whole limit. The deepest preset is
    /// the narrowest window the view allows.
    func presetSpan(_ id: String, limits: TimelineLimits, at: Double) -> Double {
        guard let p = preset(id), p.u >= 0 else { return limits.maxSpan }
        let c = posExt(at)
        let span = min(timeExt(c + len[p.u] / 2) - timeExt(c - len[p.u] / 2), limits.maxSpan)
        return p.deepest ? max(span, limits.minSpan) : span
    }

    /// The window of a preset keeping `anchor` at fraction `frac`, one unit across in position.
    func presetWindow(_ id: String, limits: TimelineLimits, anchor: Double, frac: Double = 0.5) -> TimelineWindow {
        let p = preset(id)
        if let p, p.u >= 0, !p.deepest {
            let left = posExt(anchor) - frac * len[p.u]
            let t0 = timeExt(left), t1 = timeExt(left + len[p.u])
            if t1 - t0 <= limits.maxSpan { return TimelineWindow(c: (t0 + t1) / 2, span: t1 - t0) }
        }
        let span = p?.deepest == true ? presetSpan(id, limits: limits, at: anchor) : limits.maxSpan
        return TimelineWindow(c: anchor - frac * span + span / 2, span: span)
    }

    /// The preset whose width is within ~12 % of `span` around `at`.
    func activePreset(span: Double, limits: TimelineLimits, at: Double) -> String? {
        presets.first { abs(log(span / presetSpan($0.id, limits: limits, at: at))) < 0.12 }?.id
    }
}
