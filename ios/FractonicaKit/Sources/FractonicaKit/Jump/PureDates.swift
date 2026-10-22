import Foundation

/// Pure dates read back as moments, and the exact landings the pure jump box needs: a port of the parts of
/// src/ui/calendar/pure-conv.js it uses (SPEC §15). Everything is computed in Saros position, where the hierarchy is
/// exactly aligned, and only the last step converts to Unix seconds; which cycle a moment is in is always asked of the
/// clock, so a landing is the first millisecond the header itself shows the result.
enum PureDates {
    /// The entries of a date, coarse to fine: α β γ δ ε are ordinals and η is numbered (from 1), ι λ ν are counts.
    static let ladder = ["alpha", "beta", "gamma", "delta", "epsilon", "eta", "iota", "lambda", "nu"]
    static let majorIDs: Set<String> = ["alpha", "beta", "gamma", "delta"]
    static let ordinalIDs: Set<String> = ["alpha", "beta", "gamma", "delta", "epsilon"]
    static let numberedIDs: Set<String> = ordinalIDs.union(["eta"])
    static let parentWords = ["beta": "an Alpha", "gamma": "a Beta", "delta": "a Gamma", "epsilon": "a Delta", "eta": "a Nuclide",
                              "iota": "a Helion", "lambda": "a Preon", "nu": "a Flavon"]
    /// Absolute position tolerance, 1e-12 Saros (0.6 ms), as pure.js `decompose`.
    static let epsPos = 1e-12

    static func unit(_ id: String) -> FUnit { Notation.unit(id)! }
    static func levelOf(_ id: String) -> Int { unit(id).level }
    static func sym(_ id: String) -> String { unit(id).sym }
    static func isMajor(_ id: String) -> Bool { majorIDs.contains(id) }
    static func first(_ id: String) -> Double { numberedIDs.contains(id) ? 1 : 0 }

    /// A number as JavaScript prints it.
    static func js(_ x: Double) -> String { JSNumber.string(x) }
    static func ordText(_ sym: String, _ n: Double) -> String { "\(sym)#\(js(n))" }
    static func countText(_ sym: String, _ n: Double) -> String { "\(js(n))\(sym)" }
    /// "Difracton" for 2, "#25" beyond the table (pure.js `ordinalName` of any number).
    static func ordinalName(_ n: Double) -> String {
        n >= 1 && n < Double(Notation.ordinalNames.count) && n == n.rounded() ? Notation.ordinalNames[Int(n)] : "#\(js(n))"
    }

    /// One entry of a date: `id` from the ladder, its number, the quarter word of a major entry (0 Peak … 3 End), and
    /// whether the major was written in words.
    struct Part {
        var id: String
        var n: Double
        var quarter: Int?
        var words = false
    }

    // MARK: - Ranges and lengths

    /// The printed range of every entry, derived from the hierarchy: α 1–18, β 1–5, γ 1–13, δ 1–5, ε 1–5, η 1–77,
    /// ι 0–35, λ 0–64, ν 0–24.
    static func ranges(_ notation: Notation) -> [String: (min: Double, max: Double)] {
        let clock = notation.model
        let len = { (id: String) in notation.unitPos(unit(id)) }
        let ratio = { (a: String, b: String) in JSNumber.round(len(a) / len(b)) }
        return [
            "alpha": (1, Double(clock.count(0))),
            "beta": (1, Double(clock.levelInfo(1).siblings ?? 0)),
            "gamma": (1, Double(clock.levelInfo(2).siblings ?? 0)),
            "delta": (1, ratio("gamma", "delta")),
            "epsilon": (1, ratio("delta", "epsilon")),
            "eta": (1, ratio("epsilon", "eta")),
            "iota": (0, ratio("eta", "iota") - 1),
            "lambda": (0, ratio("iota", "lambda") - 1),
            "nu": (0, ratio("lambda", "nu") - 1),
        ]
    }

    /// The date and the clock at t as one set of counters (α … ε, η ι λ ν); nil outside the catalogue.
    static func counters(_ notation: Notation, _ t: Double) -> [String: Int]? {
        guard let d = notation.date(at: t), let c = notation.clock(at: t) else { return nil }
        return ["alpha": d.alpha, "beta": d.beta, "gamma": d.gamma, "delta": d.delta, "epsilon": c.epsilon, "eta": c.eta,
                "iota": c.iota, "lambda": c.lambda, "nu": c.nu]
    }

    /// What one cycle of `level` is made of: "5ε", "77η", "36ι" for a unit, the exact length for a depth between
    /// units ("11η" for ζ), "" for the Blink.
    static func madeOf(_ notation: Notation, _ level: Int) -> String {
        guard let i = Notation.units.firstIndex(where: { $0.level == level }) else { return notation.cycleLength(level: level) }
        guard i + 1 < Notation.units.count else { return "" }
        let next = Notation.units[i + 1]
        return "\(js(JSNumber.round(notation.unitPos(Notation.units[i]) / notation.unitPos(next))))\(next.sym)"
    }

    /// The unit a depth between units is counted in, and how many: ζ → (η, 11), θ → (ι, 4), κ → (λ, 13), μ → (ν, 5).
    static func betweenUnit(_ clock: FractonicaClock, _ level: Int) -> (unit: FUnit, n: Double)? {
        guard let next = Notation.units.first(where: { $0.level == level + 1 }),
              !Notation.units.contains(where: { $0.level == level }) else { return nil }
        return (next, JSNumber.round(clock.levelInfo(level + 1).prefixDouble / clock.levelInfo(level).prefixDouble))
    }

    // MARK: - Exact landings

    /// The first millisecond for which `shows` holds, searched around the float estimate `t` of an exact boundary.
    static func firstMs(_ t: Double, _ shows: (Double) -> Bool) -> Double? {
        guard t.isFinite else { return nil }
        let i0 = (t * 1000 - 1e-3).rounded(.up)
        if shows(i0 / 1000) && !shows((i0 - 1) / 1000) { return i0 / 1000 }
        var i = i0 - 3
        while i <= i0 + 6 {
            if shows(i / 1000) { return i / 1000 }
            i += 1
        }
        return nil
    }

    static func inCatalogue(_ clock: FractonicaClock, _ t: Double) -> Double { min(clock.tMax, max(clock.tMin, t)) }

    /// The first millisecond at which cycle `idx` of `level` has reached `phase` (0 it begins, 1 the next begins);
    /// nil beyond the catalogue.
    static func landPoint(_ clock: FractonicaClock, _ level: Int, _ idx: Int64, _ phase: Double = 0) -> Double? {
        guard let t = JumpMaths.pointOfCycle(clock, level, Double(idx), phase) else { return nil }
        let at = { (c: Double) in clock.level(at: c, level) }
        let shows: (Double) -> Bool
        if phase <= 0 {
            shows = { (at($0)?.cycle ?? -1) >= idx }
        } else if phase >= 1 {
            shows = { (at($0)?.cycle ?? -1) >= idx + 1 }
        } else {
            shows = { c in
                guard let l = at(c) else { return false }
                return l.cycle > idx || (l.cycle == idx && l.phase >= phase)
            }
        }
        return firstMs(t, shows) ?? inCatalogue(clock, JumpMaths.ceilMs(t))
    }

    /// The first millisecond of the cycle of `level` that begins at the float time `t`.
    static func landCycleAt(_ clock: FractonicaClock, _ t: Double, _ level: Int) -> Double {
        guard t.isFinite else { return t }
        let shows = { (c: Double) in
            guard let l = clock.level(at: c, level) else { return false }
            return l.start > t - 5e-3
        }
        return firstMs(t, shows) ?? inCatalogue(clock, JumpMaths.ceilMs(t))
    }

    // MARK: - Text

    /// "Delta Trifracton Node" / "ε#2" / "5η": one entry as it is written.
    static func partText(_ p: Part) -> String {
        if isMajor(p.id) {
            return "\(JumpMaths.levelName(levelOf(p.id))) \(ordinalName(p.n))" + (p.quarter.map { " " + Notation.quarterWords[$0] } ?? "")
        }
        return ordinalIDs.contains(p.id) ? ordText(sym(p.id), p.n) : countText(sym(p.id), p.n)
    }

    /// The entries in letters ("α#6 β#4 γ#9 δ#3 ε#5 34η 29ι"); `words`: the majors as names with their quarter words.
    static func entriesText(_ parts: [Part], words: Bool = false) -> String {
        parts.map { p in
            words || p.words ? partText(p) : ordinalIDs.contains(p.id) ? ordText(sym(p.id), p.n) : countText(sym(p.id), p.n)
        }.joined(separator: " ")
    }

    /// The distance between two moments in ladder units, measured in position, with 2 ms of slack so a span built
    /// from whole units does not read one small unit short.
    static func spanText(_ notation: Notation, _ a: Double, _ b: Double, parts: Int = 2) -> String {
        let lo = JumpMaths.r3(min(a, b)), hi = JumpMaths.r3(max(a, b))
        let exact = notation.between(lo, hi, parts: parts)
        if exact.hasSuffix("ν"), exact.dropLast().allSatisfy({ "0123456789.<".contains($0) }), exact.count > 1 { return exact }
        return notation.between(lo, min(notation.model.tMax, hi + 0.002), parts: parts)
    }

    // MARK: - Dates → moments

    enum Resolved {
        case moment(t: Double, quarter: Int?)
        case failure(String, String)
    }

    /// A date in any of its forms read back as the first millisecond that shows its finest entry (pure-conv.js
    /// `resolveParts`). The periods above the first entry come from `ref`; a quarter word on a major entry is checked
    /// against the rest of the date, and on the finest entry it is the start of that quarter.
    static func resolve(_ notation: Notation, _ parts: [Part], ref: Double?) -> Resolved {
        let clock = notation.model
        guard !parts.isEmpty else { return .failure("Nothing to read", "") }
        let ids = parts.map { ladder.firstIndex(of: $0.id)! }
        let word = { (id: String) in isMajor(id) ? JumpMaths.levelName(levelOf(id)) : sym(id) }
        for i in ids.indices.dropFirst() {
            if ids[i] <= ids[i - 1] {
                return .failure("Write the entries from the longest to the shortest",
                                "e.g. Delta Trifracton Node ε#2 21η 12ι · α#6 β#4 γ#9 δ#3 ε#5 34η")
            }
            if ids[i] != ids[i - 1] + 1 {
                return .failure("\(word(ladder[ids[i - 1] + 1])) is missing between \(word(ladder[ids[i - 1]])) and \(word(ladder[ids[i]]))",
                                "Write consecutive entries, e.g. α#6 β#4 γ#9 δ#3 ε#5 34η 29ι")
            }
        }
        let etaIdx = ladder.firstIndex(of: "eta")!
        let firstIdx = ids[0]
        let finestIdx = ids[ids.count - 1]
        let finest = ladder[finestIdx]
        let r = ranges(notation)
        var base: [String: Int]?
        if firstIdx > 0 {
            base = ref.flatMap { counters(notation, $0) }
            if base == nil {
                return .failure("The shown moment is outside the catalogue, so the enclosing periods are unknown",
                                "Start the date with the Alpha, e.g. α#6 β#4 γ#9 δ#3")
            }
        }
        var values: [String: Double] = [:]
        for (i, id) in ladder.enumerated() { values[id] = i < firstIdx ? Double(base![id]!) : first(id) }
        for p in parts {
            let id = p.id
            let (lo, hi) = r[id]!
            if p.n != p.n.rounded() || !p.n.isFinite || p.n < lo || p.n > hi {
                if id == "alpha" {
                    return .failure("The catalogue holds only \(js(hi)) Alphas (\(notation.catalogueText()))",
                                    "Alpha \(ordinalName(1)) … Alpha \(ordinalName(hi))")
                }
                if isMajor(id) {
                    let lv = JumpMaths.levelName(levelOf(id))
                    return .failure("\(lv) \(ordinalName(p.n)): \(parentWords[id]!) holds \(js(hi)) \(lv)s",
                                    "\(lv) \(ordinalName(lo)) … \(lv) \(ordinalName(hi)) (\(ordText(sym(id), lo)) … \(ordText(sym(id), hi)))")
                }
                let ord = ordinalIDs.contains(id)
                let text = { (n: Double) in ord ? ordText(sym(id), n) : countText(sym(id), n) }
                let edge = p.n > hi ? text(hi) : text(lo)
                let why = id == "eta" && p.n < lo ? ": Helions are numbered from 1" : ""
                return .failure("\(text(p.n)): \(sym(id)) \(numberedIDs.contains(id) ? "is numbered" : "counts") \(js(lo))–\(js(hi)) inside \(parentWords[id]!)",
                                "\(edge) is the \(p.n > hi ? "last" : "first")\(why)")
            }
            if let q = p.quarter, !(0...3).contains(q) { return .failure("A quarter is Peak, Node, Valley or End", "") }
            values[id] = p.n
        }
        let v = { (id: String) in values[id]! }
        guard let gamma = clock.pathToCycle([Int(v("alpha")), Int(v("beta")), Int(v("gamma"))]) else {
            return .failure("\(partText(Part(id: "gamma", n: v("gamma")))) of Alpha \(ordinalName(v("alpha"))), Beta \(ordinalName(v("beta"))) begins after the catalogue ends",
                            "The catalogue ends inside Alpha \(ordinalName(r["alpha"]!.max)); its last periods are clipped")
        }
        let len = { (id: String) in notation.unitPos(unit(id)) }
        var pos = (Double(gamma) * 4) / clock.levelInfo(2).prefixDouble + (v("delta") - 1) * len("delta") + (v("epsilon") - 1) * len("epsilon")
        // pos is the start of the named (or shown) Nuclide: whole cycles all the way down
        let elen = len("epsilon")
        let nIdx = JSNumber.round(pos / elen)
        pos = nIdx * elen
        let bare = firstIdx >= etaIdx // counts alone: inside the Nuclide of the shown moment
        let unitStart = pos + (v("eta") - 1) * len("eta") + v("iota") * len("iota") + v("lambda") * len("lambda") + v("nu") * len("nu")
        // the span the finest entry names, narrowed by every quarter word (which only has to meet the date somewhere)
        var lo = unitStart
        var hi = unitStart + len(finest)
        let quartered = parts.filter { isMajor($0.id) && $0.quarter != nil }
        for p in quartered {
            let ml = len(p.id)
            let ms = ((unitStart + epsPos) / ml).rounded(.down) * ml
            lo = max(lo, ms + (Double(p.quarter!) * ml) / 4)
            hi = min(hi, ms + (Double(p.quarter! + 1) * ml) / 4)
        }
        if !quartered.isEmpty && !(hi - lo > epsPos) {
            let p = quartered.first { !quarterMeets($0, unitStart, len(finest), len($0.id)) } ?? quartered[0]
            return quarterMismatch(clock, p, parts, unitStart, len(finest))
        }
        let target = lo
        if !(target >= 0 && target < Double(clock.extent)) {
            return .failure("That moment lies after the catalogue ends \(notation.catalogueText())", "")
        }
        // what the first millisecond must show: every entry down to the finest one (or the counts inside that Nuclide)
        let given = Array(ladder[(bare ? etaIdx : 0)...finestIdx])
        let want = { (c: Double) -> Bool in
            guard let cs = counters(notation, c) else { return false }
            if bare && clock.level(at: c, 4).map({ Double($0.cycle) }) != nIdx { return false }
            for p in quartered where notation.quarter(at: c, level: levelOf(p.id)) != p.quarter { return false }
            return given.allSatisfy { Double(cs[$0]!) == values[$0]! }
        }
        let estimate = clock.time(atPosition: target)
        let t = firstMs(estimate, want) ?? inCatalogue(clock, JumpMaths.ceilMs(estimate))
        let last = parts[parts.count - 1]
        return .moment(t: t, quarter: isMajor(finest) ? last.quarter : nil)
    }

    /// Does the quarter word of major entry `p` meet the span [start, start + span)?
    private static func quarterMeets(_ p: Part, _ start: Double, _ span: Double, _ ml: Double) -> Bool {
        let ms = ((start + epsPos) / ml).rounded(.down) * ml
        return max(start, ms + (Double(p.quarter!) * ml) / 4) < min(start + span, ms + (Double(p.quarter! + 1) * ml) / 4) - epsPos
    }

    /// "Delta Trifracton Node and ε#2 5η do not meet": with the quarter(s) the date does lie in.
    private static func quarterMismatch(_ clock: FractonicaClock, _ p: Part, _ parts: [Part], _ start: Double, _ span: Double) -> Resolved {
        let ml = 4 / clock.levelInfo(levelOf(p.id)).prefixDouble
        let ms = ((start + epsPos) / ml).rounded(.down) * ml
        let q0 = min(3, Int((((start - ms) / ml) * 4 + 1e-9).rounded(.down)))
        let q1 = min(3, Int((((start + span - ms) / ml) * 4 - 1e-9).rounded(.down)))
        let words = q1 > q0 ? "\(Notation.quarterWords[q0]) … \(Notation.quarterWords[q1]) quarters" : "\(Notation.quarterWords[q0]) quarter"
        let rank = ladder.firstIndex(of: p.id)!
        let rest = parts.filter { ladder.firstIndex(of: $0.id)! > rank }.map(partText).joined(separator: " ")
        let name = "\(JumpMaths.levelName(levelOf(p.id))) \(ordinalName(p.n))"
        return .failure(
            "\(name) \(Notation.quarterWords[p.quarter!]) and \(rest.isEmpty ? "the rest of the date" : rest) do not meet",
            "\(rest.isEmpty ? "That date" : rest) lies in the \(words) of \(name): write \(name) \(Notation.quarterWords[q0])\(rest.isEmpty ? "" : " " + rest), or leave the quarter out"
        )
    }
}
