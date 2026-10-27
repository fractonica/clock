import FractonicaKit
import Foundation

/// What the reading beside the stage says (src/ui/wave.js `updateReadout`): the focused half-arc, where the displayed
/// time is in it and what comes next — or the catalogue, or why there is nothing to show. Plain values, built at the
/// reading's cadence and checked for pure-mode leaks.
struct WaveReadout: Equatable, Sendable {
    enum Kind: Equatable, Sendable { case focus, overview, outOfRange }

    var kind: Kind
    /// The level whose colour the reading wears (0 for the catalogue).
    var level: Int
    /// "η", or "∿" for the catalogue.
    var badge: String
    /// "half-arc −2" · "Saros 141".
    var title: String
    /// "trough" / "crest" · "35 α half-arcs · 69 intervals".
    var note: String
    /// "θ is too fast to follow" while a time-lapse outruns the selection, and why.
    var fast: String?
    var fastHelp = ""
    var span: String
    /// "2 of 11 in this ζ half-arc" (nil for the catalogue), and what that number counts.
    var loop: String?
    var loopHint = ""
    var cycle: String
    var primary: WaveShare
    var primaryWhat: String
    /// 0…1 through the half-arc (the catalogue), for the bar.
    var progress: Double
    var secondary: WaveShare?
    var secondaryWhat: String
    var next: [WaveNextLine]
    /// The glyph state of the level at the displayed time.
    var glyph: Int?
    /// The out-of-range explanation.
    var message: String?
    /// One sentence for VoiceOver.
    var spoken: String

    /// The reading at displayed time t. `level` is the shared selection, `eff` the level focused.
    static func make(t: Double, overview: Bool, level: Int, eff: Int, words: WaveWords) -> WaveReadout {
        let engine = words.engine
        let clock = engine.clock
        guard let cur = engine.readHalves(t) else {
            // "Outside the Saros 141 catalogue." becomes the title, the rest the explanation
            let message = words.outOfRange(t)
            let parts = message.split(separator: ". ", maxSplits: 1).map(String.init)
            return WaveReadout(kind: .outOfRange, level: 0, badge: "∿", title: parts.first ?? message, note: "", fast: nil, span: "",
                               loop: nil, cycle: "", primary: .percent(""), primaryWhat: "", progress: 0, secondary: nil, secondaryWhat: "",
                               next: [], glyph: nil, message: parts.count > 1 ? parts[1] : "", spoken: message)
        }
        if overview {
            let h = cur[0]
            let d = engine.describe(0, h.idx)
            let pos = (clock.position(at: t) ?? 0) / Double(clock.extent)
            let secondary: WaveShare = words.isMajor(0) ? .quarter(words.quarter(d, local: h.local))
                : words.share(WaveNav.throughOf(d, local: h.local, t: t, tMax: clock.tMax))
            return WaveReadout(
                kind: .overview, level: 0, badge: "∿", title: "Saros 141",
                note: "\(engine.halfCount(0)) α half-arcs", fast: nil,
                span: words.catalogueSpan(), loop: nil, cycle: "Now in the \(words.cycle(d))",
                primary: words.share(pos, decimals: 1), primaryWhat: "of the catalogue", progress: pos,
                secondary: secondary, secondaryWhat: words.isMajor(0) ? "quarter of this α cycle" : "of this α half-arc",
                next: [WaveNextLine(dim: "now in", text: "α half-arc \(d.signed) \(d.crest ? "crest" : "trough")"),
                       WaveNextLine(dim: "", text: words.alphaSpan(d))],
                glyph: h.reading?.index, message: nil, spoken: words.overviewLabel(d)
            )
        }
        let l = min(max(eff, 0), Fractonica.maxLevel)
        let h = cur[l]
        let d = engine.describe(l, h.idx)
        let through = WaveNav.throughOf(d, local: h.local, t: t, tMax: clock.tMax)
        let major = words.isMajor(l)
        let sel = min(max(level, 0), Fractonica.maxLevel)
        let selected = Fractonica.periodName(sel).text
        var reading = WaveReadout(
            kind: .focus, level: l, badge: d.letter, title: "half-arc \(d.signed)", note: d.crest ? "crest" : "trough",
            fast: level > l ? "\(selected) is too fast to follow" : nil,
            span: words.span(d), loop: words.loop(d), cycle: WaveWords.cap(words.cycle(d)),
            primary: major ? .quarter(words.quarter(d, local: h.local)) : words.share(through),
            primaryWhat: major ? "quarter of this \(d.letter) cycle" : "of this half-arc",
            progress: through,
            secondary: major ? nil : words.share(h.reading?.phase ?? 0, decimals: 1),
            secondaryWhat: major ? "" : "of this \(d.letter) cycle",
            next: words.nextLines(d, h, t: t),
            glyph: h.reading?.index, message: nil, spoken: words.canvasLabel(d, local: h.local)
        )
        if reading.fast != nil {
            reading.fastHelp = "\(selected) half-arcs last \(words.halfLength(sel)): too short to follow at this speed, so the view stays on \(d.letter); the finer depths are its loops"
        }
        reading.loopHint = words.loopHint(d)
        return reading
    }

    /// Every text of the reading (for the pure-mode checks).
    var texts: [String] {
        var out = [badge, title, note, span, cycle, primaryWhat, secondaryWhat, fast ?? "", loop ?? "", message ?? "", spoken]
        for line in next { out += [line.dim, line.text] }
        for share in [primary, secondary].compactMap({ $0 }) {
            if case .percent(let s) = share { out.append(s) }
            if case .quarter(let s) = share { out.append(s) }
        }
        return out
    }
}

/// The level chips' live state: where each level is in its current half-arc.
struct WaveChipState: Equatable, Sendable {
    var idx: Int64
    var local: Double
    var crest: Bool
    /// 0…1 through the half-arc, in 48ths (so a chip redraws only when its bar visibly moves).
    var progress: Double

    static func all(t: Double, engine: WaveEngine) -> [WaveChipState]? {
        guard let cur = engine.readHalves(t) else { return nil }
        return (0...Fractonica.maxLevel).map { l in
            WaveChipState(idx: cur[l].idx, local: cur[l].local, crest: cur[l].idx % 2 == 0, progress: (cur[l].local * 48).rounded() / 48)
        }
    }
}

/// How often the depth chips refresh: as often as the quickest bar that can be followed moves a 48th of its width (at
/// least every second, at most four times a second). A level whose half-arc passes in under ten seconds at the clock's
/// speed is too fast to follow on a chip: it shows no sign and a still bar, and sets no pace. A paused clock shows them
/// all.
struct WaveChipPace: Equatable, Sendable {
    /// Real seconds between refreshes.
    let interval: Double
    /// The same in displayed seconds (what `ClockTimeline(.periodic)` counts): a time-lapse covers more of them.
    let displayedInterval: Double
    /// The shortest half-arc (seconds) a chip follows.
    private let shortest: Double
    private let halves: [Double]

    static let minimumHalf = 10.0

    init(halfSeconds: [Double], rate: Double) {
        let r = abs(rate)
        halves = halfSeconds
        shortest = Self.minimumHalf * r
        let steps = halfSeconds.filter { $0 >= Self.minimumHalf * r }.map { $0 / max(r, 1e-9) / 48 }
        interval = max(0.25, min(1, steps.min() ?? 1))
        displayedInterval = interval * max(r, 1e-9)
    }

    /// Whether a level's chip shows its sign and progress.
    func followable(_ level: Int) -> Bool {
        level >= 0 && level < halves.count && halves[level] >= shortest
    }
}

/// The solar strip: the sync at every depth (src/ui/wave/sun.js).
struct WaveSolarReadout: Equatable, Sendable {
    var number: String
    var phase: Double
    var quarter: Int
    var share: WaveShare
    var next: String
    var drift: String
    /// Set in the first and last sync of the catalogue, which the engine leaves undefined.
    var edge: String?
    var spoken: String
    var start: Double
    var end: Double
    var sync: Int
    /// The Pentad running (SPEC §7.5): the sync's 19 Helions as Pentad I, II, III and the Hypopentad.
    var pentad: Int? = nil

    static func make(t: Double, words: WaveWords) -> WaveSolarReadout? {
        guard var readout = reading(t: t, words: words) else { return nil }
        if let p = Pentads.at(t) {
            readout.pentad = p.index
            readout.spoken = "\(PentadWords.full(p)). " + readout.spoken
        }
        return readout
    }

    private static func reading(t: Double, words: WaveWords) -> WaveSolarReadout? {
        let engine = words.engine
        guard engine.clock.inRange(t), let pos = engine.clock.position(at: t) else { return nil }
        guard let s = engine.clock.solar(at: t) else {
            let grid = WaveSolar.Grid(p6: engine.prefix(WaveSolar.syncLevel)).at(pos)
            return WaveSolarReadout(number: words.sunNumber(grid.sync), phase: grid.phase, quarter: WaveSolar.quarterOf(grid.phase),
                                    share: words.share(grid.phase), next: "", drift: "", edge: words.sunEdge(),
                                    spoken: words.sunAccessibility(nil, t: t), start: 0, end: 0, sync: grid.sync)
        }
        return WaveSolarReadout(number: words.sunNumber(s.sync), phase: s.phase, quarter: s.quarter, share: words.share(s.phase),
                                next: words.sunNext(s, t: t), drift: words.sunDriftLine(s), edge: nil,
                                spoken: words.sunAccessibility(s, t: t), start: s.start, end: s.end, sync: s.sync)
    }
}
