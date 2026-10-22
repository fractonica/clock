import FractonicaKit
import Foundation

// The wave's words in both vocabularies (src/ui/wave/words.js and tooltip.js).
//
// Earth mode: Gregorian spans in the chosen zone, h / min countdowns, percentages. Pure mode (SPEC §15,
// docs/design/80-pure.md, revision 3): the major periods α β γ δ in words with their quarter ("Delta Trifracton",
// "Valley"; never a phase pair), the minor cycles by where they start in their Nuclide ("ε#5 34η") with a pair of
// 2-stroke glyphs instead of a percentage, address chains instead of dates, spans counted on the ladder, eclipses
// numbered instead of dated. "Half-arc" is the view's own geometry (a cycle is a crest followed by a trough), not a
// unit: lengths are always counted in units ("18ι").

/// A share of something as the reading shows it: a percentage (Earth), a glyph pair (pure, minor levels) or the
/// quarter word (pure, α β γ δ).
enum WaveShare: Equatable, Sendable {
    case percent(String)
    case pair(Double)
    case quarter(String)
}

/// One "what comes next" line: quiet lead-in words and the reading.
struct WaveNextLine: Equatable, Sendable {
    var dim: String
    var text: String
}

/// The tooltip of a half-arc, a point on it or a level marker.
struct WaveTip: Equatable, Sendable {
    var level: Int
    var letter: String
    var title: String
    var sign: String
    /// The span (Earth) or the address chain (pure), monospaced.
    var span: String
    var place: String
    var length: String
    /// Pure mode, minor level: the pair of how far through the half-arc, written before `pairSuffix`.
    var pair: Double?
    var pairSuffix: String
    var when: String
    var clipped: Bool
    var glyph: Glyph?
    var action: String?

    struct Glyph: Equatable, Sendable {
        var index: Int
        var label: String
        var direction: String
        var note: String
        var at: String?
    }
}

struct WaveWords {
    let wording: Wording
    let engine: WaveEngine

    var pure: Bool { wording.pure }
    private var notation: Notation { wording.notation }
    private var earth: EarthFormatter { wording.earth }
    private var clock: FractonicaClock { engine.clock }

    // MARK: Shared helpers

    static func cap(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }

    /// JavaScript's Math.round (halves up).
    private static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    /// t rounded to a whole millisecond (so ".9996" carries into the next second before it is printed).
    static func roundMs(_ t: Double) -> Double { jsRound(t * 1000) / 1000 }

    /// A share 0…1 as text, floored and held below 100 until it is complete: 0.2749 → "27", 0.1349 (1 decimal) → "13.4".
    static func floorPercent(_ frac: Double, decimals: Int = 0) -> String {
        let k = decimals == 0 ? 1.0 : 10.0
        let f = min(1, max(0, frac))
        var v = (f * 100 * k + 1e-7).rounded(.down) / k
        if f < 1 && v >= 100 { v = 100 - 1 / k }
        return decimals == 0 ? String(Int(v)) : String(format: "%.1f", v)
    }

    /// x with at most `digits` decimals and no trailing zeros ("69", "68.5"), as JavaScript prints Number(x.toFixed(n)).
    static func shortDecimal(_ x: Double, digits: Int) -> String {
        var s = String(format: "%.\(digits)f", x)
        if s.contains(".") {
            while s.hasSuffix("0") { s.removeLast() }
            if s.hasSuffix(".") { s.removeLast() }
        }
        return s
    }

    /// "phase 8 and 0 of 256": how a glyph pair is spoken.
    static func pairSpoken(_ fraction: Double, label: String = "phase") -> String {
        let p = Notation.pair(fraction)
        return "\(label) \(p.hi) and \(p.lo) of 256"
    }

    /// The sync number as written, with a true minus.
    static func signedNumber(_ n: Int) -> String { (n < 0 ? "−" : "") + String(abs(n)) }

    /// A share, floored: "87 %" or the pair.
    func share(_ frac: Double, decimals: Int = 0) -> WaveShare {
        pure ? .pair(frac) : .percent("\(Self.floorPercent(frac, decimals: decimals)) %")
    }

    /// The spoken form of a share.
    func shareSpoken(_ frac: Double, label: String) -> String {
        pure ? Self.pairSpoken(frac, label: label) : "\(Self.floorPercent(frac)) percent"
    }

    // MARK: Pure helpers

    /// A span of `dpos` Saros positions in ladder units: "1ε", "5η 18ι".
    private func pureSpan(_ dpos: Double, parts: Int = 2) -> String { notation.durationPos(dpos, parts: parts) }

    /// Position distance between two instants (exact across eclipse intervals; the nearest interval outside).
    private func positionSpan(_ t1: Double, _ t2: Double) -> Double {
        let lo = min(t1, t2)
        let hi = max(t1, t2)
        let a = clock.position(at: lo)
        let b = clock.position(at: hi)
        if let a, let b { return b - a }
        return (hi - lo) / notation.secondsPerPosition(at: a == nil ? clock.tMin : clock.tMax)
    }

    /// "in 1η 5ι" / "3ι ago".
    func pureCountdown(from: Double, to: Double, parts: Int = 2) -> String {
        let text = pureSpan(positionSpan(from, to), parts: parts)
        return to >= from ? "in \(text)" : "\(text) ago"
    }

    /// How many of the next unit make one cycle of a unit depth.
    private static let nextUnit: [Int: (Int, String)] = [0: (5, "β"), 1: (13, "γ"), 2: (5, "δ"), 3: (5, "ε"), 4: (77, "η"), 6: (36, "ι"), 8: (65, "λ"), 10: (25, "ν")]

    /// What one cycle of a depth is: "1δ = 5ε", "1η (Helion) = 36ι", "11η", "0.14ν".
    func cycleNamedPure(_ level: Int) -> String {
        let len = notation.cycleLength(level: level)
        let name = Notation.levelKind(level) == "unit" ? " (\(Notation.unitName(level: level)))" : ""
        let made = Self.nextUnit[level].map { " = \($0.0)\($0.1)" } ?? ""
        return len + name + made
    }

    /// The quarter of a cycle at `phase`: Peak, Node, Valley or End.
    static func quarterWord(_ phase: Double) -> String {
        Notation.quarterWords[min(3, max(0, Int((phase * 4).rounded(.down))))]
    }

    /// The phase of the cycle a half-arc belongs to, from the progress through the half-arc.
    static func cyclePhase(_ d: WaveHalfInfo, local: Double) -> Double {
        (d.crest ? 0 : 0.5) + min(1, max(0, local)) / 2
    }

    /// "α#6 β#4 γ#9 δ#3 ε#5 34η": the address of cycle `cycle` of a level, the stamp of its start (at most `links`).
    func chainText(level: Int, cycle: Int64, links: Int = 5) -> String {
        var items: [String] = []
        let p = engine.exactPrefix(level)
        for l in 0...min(level, 3) {
            let c = Int64(Int128(cycle) / (p / engine.exactPrefix(l)))
            items.append(Notation.shortName(level: l, ordinal: notation.ordinalOf(level: l, cycle: c)))
        }
        if level >= 4 { items += notation.cycleName(level: level, cycle: cycle).split(separator: " ").map(String.init) }
        return items.count > links ? "… " + items.suffix(links).joined(separator: " ") : items.joined(separator: " ")
    }

    /// Three consecutive tokens of the stamp, chosen by the depth: α "α#6 β#4 γ#9", δ "δ#3 ε#5 34η", ζ… "34η 29ι 21λ".
    func nowLabelPure(_ t: Double, level: Int) -> String {
        guard let d = notation.date(at: t) else { return "—" }
        let start = min(max(level, 0), 5)
        let c = start >= 3 ? notation.clock(at: t) : nil
        var all: [String] = ["α#\(d.alpha)", "β#\(d.beta)", "γ#\(d.gamma)", "δ#\(d.delta)", "ε#\(d.epsilon)"]
        if let c {
            all += ["\(c.eta)η", "\(c.iota)ι", "\(c.lambda)λ"]
        } else {
            all += ["", "", ""]
        }
        return all[start..<min(all.count, start + 3)].joined(separator: " ")
    }

    func cyclePure(_ d: WaveHalfInfo) -> String {
        let half = d.crest ? "opening" : "closing"
        if Notation.isMajor(d.level) {
            let parent = d.parent.map { "\u{a0}in\u{a0}\($0)" } ?? ""
            return "\(half) half of \(Notation.periodName(level: d.level, ordinal: d.cycleN)) · \(d.cycleN)\u{a0}of\u{a0}\(d.cycleOf)\(parent)"
        }
        return "\(half) half of \(notation.cycleName(level: d.level, cycle: d.cycle))"
    }

    // MARK: Earth helpers

    /// One instant at a precision that suits a span of `dur` seconds (date only beyond 2 years, ms below 10 s).
    func instantText(_ t: Double, duration dur: Double) -> String {
        if dur >= 2 * 31_557_600 { return earth.date(t) }
        if dur >= 86400 { return earth.dateTime(t, seconds: false) }
        return earth.dateTime(dur < 10 ? Self.roundMs(t) : t, seconds: true, ms: dur < 10)
    }

    /// "2026-03-02 12:00 → 2033-01-07 04:30"; the end drops its date on the same day.
    func spanText(_ start: Double, _ end: Double) -> String {
        let dur = end - start
        var s = start
        var e = end
        if dur < 10 {
            s = Self.roundMs(s)
            e = Self.roundMs(e)
        }
        let a = instantText(s, duration: dur)
        var b = instantText(e, duration: dur)
        if dur < 86400 && earth.date(s) == earth.date(e) { b = earth.time(e, seconds: true, ms: dur < 10) }
        return "\(a) → \(b)"
    }

    /// A countdown with milliseconds for the very short cycles: "in 12 ms", "3 min 04 s ago".
    func countdownText(_ sec: Double) -> String {
        let a = abs(sec)
        if a < 0.9995 {
            let ms = Int(Self.jsRound(a * 1000))
            return sec < 0 ? "\(ms) ms ago" : "in \(ms) ms"
        }
        return EarthTime.countdown(sec)
    }

    func cycleText(_ d: WaveHalfInfo) -> String {
        "\(d.half) half of \(d.letter) cycle \(d.cycleN) / \(d.cycleOf)\(d.parent.map { " in \($0)" } ?? "")"
    }

    // MARK: Readings

    /// "1 of 11 in this ζ half-arc", "4 of 35 in the catalogue".
    func loop(_ d: WaveHalfInfo) -> String {
        d.parent.map { "\(d.n) of \(d.of) in this \($0) half-arc" } ?? "\(d.n) of \(d.of) in the catalogue"
    }

    /// What the loop number counts.
    func loopHint(_ d: WaveHalfInfo) -> String {
        d.parent.map { "Its number among the \(d.of) half-arcs inside its \($0) half-arc: the numbered loops of the picture" }
            ?? "Its number among the \(d.of) α half-arcs of the whole catalogue"
    }

    func cycle(_ d: WaveHalfInfo) -> String { pure ? cyclePure(d) : cycleText(d) }

    func span(_ d: WaveHalfInfo) -> String {
        let clipped = d.clipped ? "  (clipped)" : ""
        return (pure ? chainText(level: d.level, cycle: d.cycle) : spanText(d.start, d.end)) + clipped
    }

    func catalogueSpan() -> String { pure ? notation.catalogueText() : spanText(clock.tMin, clock.tMax) }

    /// Where the current α half-arc lies, for the catalogue reading.
    func alphaSpan(_ d: WaveHalfInfo) -> String {
        if pure {
            let a = 2 * d.idx
            return "pos \(a) → \(Self.shortDecimal(Double(a) + 2 * d.fraction, digits: 3))"
        }
        return "\(earth.date(d.start)) → \(earth.date(d.end))"
    }

    /// The two "what comes next" lines: first half, the apex and the end; second half, the end and what follows.
    func nextLines(_ d: WaveHalfInfo, _ h: WaveHalf, t: Double) -> [WaveNextLine] {
        let count: (Double) -> String = { to in self.pure ? self.pureCountdown(from: t, to: to) : self.countdownText(to - t) }
        let ends = WaveNextLine(dim: "ends", text: count(d.end))
        if h.local < 0.5 && !d.clipped { return [WaveNextLine(dim: d.apex, text: count(engine.timeAt(d.level, d.idx, 0.5))), ends] }
        let last = d.clipped || d.idx + 1 >= engine.halfCount(d.level)
        return [ends, last ? WaveNextLine(dim: "catalogue ends here", text: "") : WaveNextLine(dim: "then a", text: d.crest ? "trough" : "crest")]
    }

    /// "starts in 3 d 04 h" / "ends in 1ι 4λ" / "ended 5 min ago".
    func when(_ d: WaveHalfInfo, now: Double) -> String {
        if pure {
            if now < d.start { return "starts \(pureCountdown(from: now, to: d.start))" }
            if now >= d.end { return "ended \(pureCountdown(from: now, to: d.end))" }
            return "ends \(pureCountdown(from: now, to: d.end))"
        }
        if now < d.start { return "starts \(countdownText(d.start - now))" }
        if now >= d.end { return "ended \(countdownText(d.end - now))" }
        return "ends \(countdownText(d.end - now))"
    }

    /// The displayed time next to the focus marker, at the precision of the half-arc's length.
    func nowLabel(_ t: Double, level: Int, duration: Double = 0, overview: Bool = false) -> String {
        if pure { return nowLabelPure(t, level: overview ? 0 : level) }
        if overview { return earth.date(t) }
        if duration >= 2 * 365.25 * 86400 { return earth.date(t) }
        if duration >= 86400 { return earth.dateTime(t, seconds: false) }
        return earth.time(duration < 10 ? Self.roundMs(t) : t, seconds: true, ms: duration < 10)
    }

    /// The eclipse labels of the catalogue: years (Earth) or numbers like the position (pure; #0 is the first).
    func eclipses() -> (marks: [String], end: String) {
        let n = Int(engine.halfCount(0))
        if pure { return ((0..<n).map { Notation.eclipseName(2 * $0) }, Notation.eclipseName(clock.extent)) }
        return ((0..<n).map { String(earth.parts(clock.catalogue[2 * $0]).year) }, String(earth.parts(clock.tMax).year))
    }

    func outOfRange(_ t: Double) -> String {
        let before = t < clock.tMin
        let gap = before ? clock.tMin - t : t - clock.tMax
        let side = before ? "before the first" : "after the last"
        if pure {
            let positions = gap / notation.secondsPerPosition(at: before ? clock.tMin : clock.tMax)
            let far = pureSpan(positions.isNaN ? 0 : positions)
            return "Outside the Saros 141 catalogue. The wave exists only between the first eclipse (\(Notation.eclipseName(0))) and the last (\(Notation.eclipseName(clock.extent))); the displayed time is \(far) \(side), so the catalogue is shown greyed."
        }
        return "Outside the Saros 141 catalogue. The wave exists only between the first eclipse (\(earth.date(clock.tMin))) and the last (\(earth.date(clock.tMax))); the displayed time is \(EarthTime.duration(gap)) \(side), so the catalogue is shown greyed."
    }

    /// The edges of the catalogue as the out-of-range buttons name them.
    func edgeName(_ edge: WaveEdge) -> String {
        if pure { return edge == .start ? "the first eclipse (\(Notation.eclipseName(0)))" : "the last eclipse (\(Notation.eclipseName(clock.extent)))" }
        return edge == .start ? "the first eclipse" : "the last eclipse"
    }

    // MARK: Levels

    /// A major period is said by its quarter, never by a pair (pure mode only).
    func isMajor(_ level: Int) -> Bool { pure && Notation.isMajor(level) }

    /// The quarter word of the cycle a half-arc reading belongs to: "Valley".
    func quarter(_ d: WaveHalfInfo, local: Double) -> String { Self.quarterWord(Self.cyclePhase(d, local: local)) }

    /// How long a half-arc of a level lasts: "2 h 31 min" · "18ι".
    func halfLength(_ level: Int) -> String {
        pure ? pureSpan(2 / engine.prefix(level)) : EarthTime.duration(clock.levelInfo(level).meanSeconds / 2)
    }

    /// The length of half-arc `d` (clipped ones are shorter).
    func halfLength(_ d: WaveHalfInfo) -> String {
        pure ? pureSpan(2 * d.fraction / engine.prefix(d.level)) : EarthTime.duration(d.duration)
    }

    /// The help line of a depth chip: "η · depth 7 · cycle ≈ 5 h 3 min · 9 child half-arcs per half-arc".
    func chipTitle(_ level: Int) -> String {
        let info = clock.levelInfo(level)
        if pure { return "\(info.text) · depth \(info.depth) · one cycle = \(cycleNamedPure(level)) · \(info.factor) child half-arcs per half-arc" }
        return "\(info.text) · depth \(info.depth) · cycle ≈ \(EarthTime.duration(info.meanSeconds)) · \(info.factor) child half-arcs per half-arc"
    }

    /// The spoken name of a depth chip.
    func chipAccessibility(_ level: Int) -> String {
        let info = clock.levelInfo(level)
        if pure { return "Depth \(info.depth), \(info.text), one cycle is \(cycleNamedPure(level))" }
        return "Depth \(info.depth), \(info.text), cycle about \(EarthTime.duration(info.meanSeconds))"
    }

    func catalogueTitle() -> String {
        let n = engine.halfCount(0)
        return pure
            ? "Catalogue: the whole Saros 141 wave, \(n) α half-arcs, \(notation.catalogueText())"
            : "Catalogue: the whole Saros 141 wave, \(n) α half-arcs from 1613 to 2857"
    }

    // MARK: Spoken

    /// Where a depth chip's level is now (appended to its spoken name).
    func chipLive(_ d: WaveHalfInfo, local: Double) -> String {
        let through: String
        if pure {
            through = Notation.isMajor(d.level)
                ? "in the \(Self.quarterWord(Self.cyclePhase(d, local: local))) quarter of its cycle"
                : Self.pairSpoken(local, label: "half-arc phase")
        } else {
            through = "\(Int((local * 20).rounded(.down)) * 5) percent through this half-arc"
        }
        return "Now in half-arc \(d.signed), \(d.crest ? "crest" : "trough"), \(loop(d)), \(through). \(Self.cap(cycle(d)))."
    }

    /// What is announced when the focused half-arc changes.
    func announce(_ d: WaveHalfInfo, t: Double) -> String {
        "\(d.letter) half-arc \(d.signed), \(d.crest ? "crest" : "trough"), \(loop(d)). \(Self.cap(cycle(d))). \(Self.cap(when(d, now: t)))."
    }

    func canvasLabel(_ d: WaveHalfInfo, local: Double) -> String {
        let part = pure ? (local < 0.5 ? "opening" : "closing") : (local < 0.5 ? "first" : "second")
        return "Wave view focused on \(d.letter) half-arc \(d.signed) (\(cycle(d))), now in the \(part) half of this half-arc."
    }

    func overviewLabel(_ d: WaveHalfInfo) -> String {
        "Wave view of the whole catalogue. Now in α half-arc \(d.signed): \(cycle(d))."
    }

    // MARK: The tooltip

    /// The tooltip of half-arc `d`; `p` is the progress of the point under the pointer (or of the marker).
    func tip(_ d: WaveHalfInfo, p: Double?, at: Double?, now: Double, marker: Bool, action: String?) -> WaveTip {
        var tip = WaveTip(
            level: d.level, letter: d.letter, title: "\(marker ? "marker · " : "")half-arc \(d.signed)",
            sign: d.crest ? "crest" : "trough",
            span: pure ? chainText(level: d.level, cycle: d.cycle) : spanText(d.start, d.end),
            place: "\(loop(d)) · \(cycle(d))",
            length: "\(halfLength(d)) long", pair: nil, pairSuffix: "", when: when(d, now: now), clipped: d.clipped,
            glyph: nil, action: action
        )
        if now >= d.start && now < d.end {
            let local = (now - d.start) / d.duration
            if pure {
                if Notation.isMajor(d.level) {
                    tip.length += " · now in its \(Self.quarterWord(Self.cyclePhase(d, local: local))) quarter"
                } else {
                    tip.length += " · "
                    tip.pair = local
                    tip.pairSuffix = "of this half-arc travelled"
                }
            } else {
                tip.length += " · \(Self.floorPercent(local)) % of this half-arc travelled"
            }
        }
        if let p {
            let index = WaveGeometry.glyphIndexAt(idx: d.idx, t: p)
            let g = GlyphState.of(index: index, strokes: 2)
            let sign = g.value > 0 ? "+" : g.value < 0 ? "−" : ""
            let dir = g.derivative > 0 ? "rising ↗" : g.derivative < 0 ? "falling ↘" : "turning point"
            var instant: String?
            if let at, !marker { instant = pure ? nowLabelPure(at, level: d.level) : instantText(at, duration: d.duration) }
            tip.glyph = WaveTip.Glyph(
                index: index, label: "\(sign)\(abs(g.value))", direction: dir,
                note: "glyph index \(index) (0–\(GlyphState.states(strokes: 2) - 1)) \(marker ? "at the displayed time" : "at this point")",
                at: instant
            )
        }
        return tip
    }

    // MARK: The solar sync

    func sunDefinition() -> String { pure ? "19η" : "19 η cycles ≈ 4 days" }

    func sunNumber(_ sync: Int) -> String { "#\(Self.signedNumber(sync))" }

    /// "peak in 21 h 04 min" / "peak in 3η 2ι".
    func sunNext(_ s: SolarReading, t: Double) -> String {
        let name = s.threshold.name
        guard let time = s.threshold.time else { return name }
        return pure ? "\(name) \(pureCountdown(from: t, to: time))" : "\(name) \(EarthTime.countdown(time - t))"
    }

    /// "−13 h 27 min" / "−6 236λ".
    func sunDrift(_ s: SolarReading) -> String {
        if pure { return notation.driftText(start: s.start, nominalStart: s.nominalStart, drift: s.drift) }
        return (s.drift > 0 ? "+" : "") + EarthTime.duration(s.drift)
    }

    func sunDriftLine(_ s: SolarReading) -> String {
        pure ? "Drift \(sunDrift(s))" : "Drift against civil days \(sunDrift(s))"
    }

    func sunEdge() -> String {
        pure ? "Not defined at the very edge of the catalogue: its first and last sync are cut short."
            : "Not defined within 3 days of the catalogue edge."
    }

    /// The depths whose current half-arc carries a ripple on this stage: "ripple at depths 4–5".
    func sunRange(_ levels: [Int]) -> String {
        guard let first = levels.first, let last = levels.last else { return "no ripple here: these arcs are too short" }
        let depths = levels.map { $0 + 1 }
        if depths.count == 1 { return "ripple at depth \(first + 1)" }
        let run = depths.enumerated().allSatisfy { $0.offset == 0 || $0.element == depths[$0.offset - 1] + 1 }
        return run ? "ripple at depths \(first + 1)–\(last + 1)" : "ripple at depths \(depths.map(String.init).joined(separator: ", "))"
    }

    func sunCaption() -> String {
        pure
            ? "The yellow ripple is the solar sync: one wavelength is 19η (19 Helions), drawn along the focused arc where one and a half or more fit, with a pin at its present phase; the solar strip shows the same phase at every depth."
            : "The yellow ripple is the solar sync: one wavelength is 19 η cycles (about 4 days), drawn along the focused arc where one and a half or more fit, with a pin at its present phase; the solar strip shows the same phase at every depth."
    }

    func sunAccessibility(_ s: SolarReading?, t: Double) -> String {
        guard let s else { return "Solar sync. \(sunEdge())" }
        return "Solar sync \(Self.signedNumber(s.sync)), \(shareSpoken(s.phase, label: "phase")), next \(sunNext(s, t: t)), \(sunDriftLine(s).replacingOccurrences(of: "Drift", with: "drift"))."
    }

    // MARK: Legend

    /// The one-sentence explanation of the picture.
    func caption() -> String {
        "Every half-cycle is an arc, a crest (+) or a trough (−); the numbered loops along it are its next-depth half-cycles, and the dot on each depth shows how far the displayed time has travelled through its arc."
    }

    func eclipseLegend() -> String {
        pure ? "an eclipse of the series, numbered like the position (#0 is the first); the thin loops are β and γ"
            : "an eclipse of the series, with its year; the thin loops are β and γ"
    }

    func sunLegend() -> String {
        pure ? "solar sync: 19η, peak · node · valley · end" : "solar sync: 19 η cycles (about 4 days), peak · node · valley · end"
    }
}
