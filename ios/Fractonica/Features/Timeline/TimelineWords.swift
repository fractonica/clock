import FractonicaKit
import Foundation

/// What the timeline writes on its canvas, in Earth words or in pure Fractonica terms (src/ui/timeline/words.js and
/// the Earth labels of src/ui/timeline/paint.js). Pure mode never writes a Gregorian date, an Earth unit or a
/// percentage: lanes are named by their counts ("ε#5 34η"), lengths on the ladder ("= 36ι"), spans in units.
struct TimelineWords: Sendable {
    let pure: Bool
    let earth: EarthFormatter
    let notation: Notation
    var clock: FractonicaClock { notation.model }

    init(pure: Bool, earth: EarthFormatter, notation: Notation = .standard) {
        self.pure = pure
        self.earth = earth
        self.notation = notation
    }

    // MARK: Lengths

    /// A compact mean length with about three significant digits: "72.1 y", "16.2 d", "5.05 h", "311 ms"
    /// (helpers.js `formatCycleLength`).
    static func cycleLength(_ s: Double) -> String {
        func sig3(_ x: Double) -> String {
            x >= 100 ? String(format: "%.0f", x) : x >= 10 ? String(format: "%.1f", x) : String(format: "%.2f", x)
        }
        if s >= GregorianStep.year { return "\(sig3(s / GregorianStep.year)) y" }
        if s >= 86_400 { return "\(sig3(s / 86_400)) d" }
        if s >= 3600 { return "\(sig3(s / 3600)) h" }
        if s >= 60 { return "\(sig3(s / 60)) min" }
        if s >= 1 { return "\(sig3(s)) s" }
        return "\(sig3(s * 1000)) ms"
    }

    /// The lane head's second line: Earth "≈ 16.2 d"; pure one cycle counted in the next unit, the ladder itself:
    /// α "= 5β", ε "= 77η", η "= 36ι", the depths between "= 11η", ξ "= 0.14ν", the Blink "= 7ξ".
    func laneLength(_ level: Int, compact: Bool) -> String {
        let info = clock.levelInfo(level)
        guard pure else {
            let s = Self.cycleLength(info.meanSeconds)
            return compact ? s : "≈ \(s)"
        }
        let kind = Notation.levelKind(level)
        if kind == "between" || kind == "sub" { return "= \(notation.cycleLength(level: level))" }
        guard let next = Notation.units.first(where: { $0.level > level }) else {
            return "= \(info.factor)\(clock.levelInfo(level + 1).letter)"
        }
        return "= \(Int((notation.cyclePos(level) / notation.cyclePos(next.level)).rounded()))\(next.sym)"
    }

    /// One cycle of a level in a sentence: Earth "≈ 5 h 3 min", pure "1η", "11η", "0.14ν".
    func levelLength(_ level: Int) -> String {
        pure ? notation.cycleLength(level: level) : "≈ " + EarthTime.duration(clock.levelInfo(level).meanSeconds)
    }

    // MARK: Lanes

    /// The note on a lane too dense to draw: "16.2 d cycles · zoom in" · pure "ε cycles · zoom in", "ζ cycles of 11η".
    func denseMessage(_ level: Int) -> String {
        let info = clock.levelInfo(level)
        guard pure else { return "\(Self.cycleLength(info.meanSeconds)) cycles · zoom in" }
        switch Notation.levelKind(level) {
        case "sub": return "cycles of \(notation.cycleLength(level: level)) · zoom in"
        case "between": return "\(info.letter) cycles of \(notation.cycleLength(level: level)) · zoom in"
        default: return "\(info.letter) cycles · zoom in"
        }
    }

    /// When a cycle ends, for its wide label: "Thu 8 Oct 2026" for long cycles, "Oct 8 14:23", or with seconds.
    func endLabel(level: Int, end: Double, refYear: Int) -> String {
        let mean = clock.levelInfo(level).meanSeconds
        if mean >= 5 * 86_400 { return String(earth.long(end, seconds: false).split(separator: ",")[0]) }
        if mean >= 3600 { return earth.short(end, refYear: refYear) }
        return String(earth.short(end, refYear: refYear).dropLast(5)) + earth.time(end, seconds: true)
    }

    /// Labels of a block, longest first; the painter takes the first that fits. `wide`: the block spans most of the plot
    /// and may say when it ends; `quarter`: the quarter word at the cursor (pure, major periods).
    func blockLabels(level: Int, idx: Int64, local: Int, siblings: Int, width w: Double, wide: Bool, end: Double,
                     endsWithCatalogue: Bool, refYear: Int, quarter: String?, names: (Int, Int64) -> (name: String, short: String))
        -> [String] {
        let info = clock.levelInfo(level)
        let head = "\(info.letter) \(info.depth)"
        let n1 = local + 1
        var out: [String] = []
        if !pure {
            if wide {
                out.append("\(head) · \(n1)/\(siblings) · " + (endsWithCatalogue ? "ends with the catalogue" : "ends \(endLabel(level: level, end: end, refYear: refYear))"))
            }
            if w >= 120 { out.append("\(head) · \(n1)/\(siblings)") }
            if w >= 40 { out.append("\(info.letter)\(n1)") }
            out.append(String(n1))
            return out
        }
        let (name, short) = names(level, idx)
        let ends = endsWithCatalogue ? "ends with the catalogue" : "ends → \(endsInto(level: level, idx: idx, names: names))"
        if Notation.isMajor(level) {
            let named = quarter.map { "\(name) \($0)" } ?? name
            if wide { out.append("\(head) · \(named) (\(n1)/\(siblings)) · \(ends)") }
            if w >= 120 { out += ["\(head) · \(named)", named] }
            if quarter != nil, w >= 90 { out.append(name) }
            if w >= 40 { out += [quarter.map { "\(short) \($0)" } ?? short, short] }
            out.append(String(n1))
        } else {
            if wide { out.append("\(head) · \(name) · \(ends)") }
            if w >= 120 { out += ["\(head) · \(name)", name] }
            if w >= 30 { out.append(short) }
            out.append(String(short.filter { $0.isNumber || $0 == "." || $0 == "#" }.drop { $0 == "#" }))
        }
        var seen = Set<String>()
        return out.filter { seen.insert($0).inserted }
    }

    /// What begins when cycle `idx` ends, as a sentence names it: a major in words ("Delta Tetrafracton"), a minor cycle
    /// by the counts that change ("35η", or "ε#1 1η" at the start of the next Nuclide).
    func endsInto(level: Int, idx: Int64, names: (Int, Int64) -> (name: String, short: String)) -> String {
        let next = names(level, idx + 1).name
        if Notation.isMajor(level) { return next }
        let a = names(level, idx).name.split(separator: " "), b = next.split(separator: " ")
        var i = 0
        while i < b.count - 1, i < a.count, a[i] == b[i] { i += 1 }
        return b[i...].joined(separator: " ")
    }

    // MARK: Eclipses, edges and chips

    /// An eclipse's label: Earth its date, pure "#k" (numbered like its position).
    func eclipseLabel(_ k: Int) -> String {
        pure ? Notation.eclipseName(k) : earth.date(clock.catalogue[k])
    }

    func edgeLabel(start: Bool) -> String {
        if pure { return start ? "catalogue starts · pos 0" : "catalogue ends · pos \(clock.extent)" }
        return start ? "catalogue starts \(earth.date(clock.tMin))" : "catalogue ends \(earth.date(clock.tMax))"
    }

    /// The catalogue's extent: "1613-05-19 – 2857-06-13" · pure "α#1 – α#18".
    var catalogueRange: String {
        pure ? notation.catalogueText() : "\(earth.date(clock.tMin)) – \(earth.date(clock.tMax))"
    }

    /// The catalogue's years for the map's head: "1613–2857" · pure "α#1 – α#18".
    var catalogueYears: String {
        pure ? notation.catalogueText() : "\(earth.parts(clock.tMin).year)–\(earth.parts(clock.tMax).year)"
    }

    /// The selected depth's turnover pointer: "η ends in 3 h 12 min ▸" / "◂ η ends 2 d ago".
    func endsChip(letter: String, rel: String, right: Bool) -> String {
        right ? "\(letter) ends \(rel) ▸" : "◂ \(letter) ends \(rel)"
    }

    /// Variants of the chip of an off-screen cursor or now marker, longest first.
    func markerChip(name: String, label: String, right: Bool) -> [String] {
        right ? ["\(name) \(label) ▸", "\(name) ▸"] : ["◂ \(name) \(label)", "◂ \(name)"]
    }

    // MARK: Flags

    /// The label of a cursor / now / pointer flag: Earth by the zoom (time with ms, time, short date or date),
    /// pure the ruler's address for the tick unit ("34η 29ι 21λ").
    func flagLabel(_ t: Double, span: Double, refYear: Int, ruler: TimelineRuler, rulerUnit: Int) -> String {
        if pure { return ruler.flagText(t, u: rulerUnit) }
        let t = TimelineSearch.ms(t)
        if span <= 3 * 86_400 { return earth.time(t, seconds: true, ms: span < 40) }
        if span <= 400 * 86_400 { return earth.short(t, refYear: refYear) }
        return earth.date(t)
    }

    /// How often (in displayed seconds) a flag's label changes at this zoom.
    func flagResolution(span: Double, ruler: TimelineRuler, rulerUnit: Int) -> Double {
        if pure { return ruler.flagResolution(rulerUnit) }
        if span < 40 { return 0.001 }
        if span <= 3 * 86_400 { return 1 }
        return 60
    }

    /// The window's extent for the status line: "Oct 1 00:00 → Oct 15 00:00 · 14 d across" · pure
    /// "α#6 β#4 … → … · 2ε 10η across".
    func windowText(_ w: TimelineWindow, refYear: Int, ruler: TimelineRuler, rulerUnit: Int, plotWidth: Double) -> String {
        if pure {
            return "\(ruler.rangeText(w.t0, w.t1, to: rulerUnit)) · \(ruler.spanText(w.t0, w.t1, parts: 2, slack: 0.5 / max(1, plotWidth))) across"
        }
        return "\(earth.short(w.t0, refYear: refYear)) → \(earth.short(w.t1, refYear: refYear)) · \(EarthTime.duration(w.span, parts: 2)) across"
    }

    /// The width of the window alone: "14 d" · pure "2ε 10η".
    func spanText(_ w: TimelineWindow, ruler: TimelineRuler, plotWidth: Double) -> String {
        pure ? ruler.spanText(w.t0, w.t1, parts: 2, slack: 0.5 / max(1, plotWidth)) : EarthTime.duration(w.span, parts: 2)
    }
}
