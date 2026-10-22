import FractonicaKit
import Foundation

// Everything the faces say, in Earth or pure words (src/ui/face/helpers.js, src/ui/face/pure.js, SPEC §8, §15): the
// watch face's info labels and letter names, the turnover line, the out-of-range texts and what VoiceOver reads.
// Pure mode never prints a clock time, a date, a zone, an Earth unit or a percentage: its countdowns are spans on the
// ladder ("in 6ι 43λ"), its sync time is the sync number and drift, its places are counts ("34η of 77 in ε#5").
// No SwiftUI here: checked by Checks/FaceChecks.swift.

enum FaceWords {
    static let dash = "—"

    /// A minor token of the journal face split for colouring: "ε#05" → ("ε#", "05", ""), "34η" → ("", "34", "η").
    struct TokenParts: Equatable, Sendable {
        let prefix: String
        let digits: String
        let suffix: String
    }

    static func parts(of token: String) -> TokenParts {
        let digits = token.filter(\.isASCII).filter(\.isNumber)
        guard !digits.isEmpty, let first = token.firstIndex(where: { $0.isASCII && $0.isNumber }),
              let last = token.lastIndex(where: { $0.isASCII && $0.isNumber }) else {
            return TokenParts(prefix: token, digits: "", suffix: "")
        }
        return TokenParts(prefix: String(token[..<first]), digits: String(token[first...last]),
                          suffix: String(token[token.index(after: last)...]))
    }

    /// "+3", "−3", "0"; integers with a true minus sign.
    static func signed(_ v: Int) -> String { v > 0 ? "+\(v)" : v < 0 ? "−\(-v)" : "0" }
    static func integer(_ n: Int) -> String { n < 0 ? "−\(-n)" : String(n) }

    /// "value −3, falling" / "peak, value +4" (helpers.js `describeState`, without the arrows).
    static func describe(index: Int, strokes: Int = 2) -> String {
        let s = GlyphState.of(index: index, strokes: strokes)
        switch s.derivative {
        case 1: return "value \(signed(s.value)), rising"
        case -1: return "value \(signed(s.value)), falling"
        default: return s.value > 0 ? "peak, value \(signed(s.value))" : "valley, value \(signed(s.value))"
        }
    }

    /// A phase as "35.8" percent, floored to a tenth (helpers.js `percentText`); Earth mode only.
    static func percent(_ phase: Double) -> String {
        if phase >= 1 { return "100.0" }
        guard phase > 0 else { return "0.0" }
        let tenths = min(999, max(0, Int((phase * 1000 + 1e-7).rounded(.down))))
        return String(format: "%d.%d", tenths / 10, tenths % 10)
    }

    // MARK: - The watch face

    /// The three info labels (SPEC §8): the next threshold of the top period, the next solar threshold and the sync
    /// time; pure mode gives countdowns and the sync's number with its drift (pure.js `pureInfoLabels`).
    struct InfoLabels: Equatable, Sendable {
        var topCaption: String
        var topValue: String
        var solarCaption: String
        var solarValue: String
        var syncCaption: String
        var syncValue: String
        /// The sync is defined here (it is not within about one sync of the catalogue's ends).
        var solarAvailable: Bool
    }

    /// "NEXT PEAK" (helpers.js `thresholdCaption`).
    static func caption(threshold name: String) -> String { "NEXT \(name.uppercased())" }

    static func infoLabels(at t: Double, top: LevelReading, solar: SolarReading?, words: Wording) -> InfoLabels {
        let next = top.next
        if words.pure {
            let n = words.notation
            let span = { (to: Double?) in to.map { "in \(n.between(t, $0))" } ?? dash }
            return InfoLabels(
                topCaption: caption(threshold: next.name),
                topValue: span(next.time),
                solarCaption: solar.map { caption(threshold: $0.threshold.name) } ?? "SOLAR SYNC",
                solarValue: solar.map { span($0.threshold.time) } ?? dash,
                syncCaption: solar.map { "SYNC \(integer($0.sync))" } ?? "SYNC",
                syncValue: solar.map { "drift \(n.driftText(start: $0.start, nominalStart: $0.nominalStart, drift: $0.drift))" } ?? dash,
                solarAvailable: solar != nil
            )
        }
        let label = { (time: Double?) in time.map { words.label($0, relativeTo: t) } ?? dash }
        return InfoLabels(
            topCaption: caption(threshold: next.name),
            topValue: label(next.time),
            solarCaption: solar.map { caption(threshold: $0.threshold.name) } ?? "SOLAR SYNC",
            solarValue: label(solar?.threshold.time),
            syncCaption: "SYNC TIME",
            syncValue: label(solar?.start),
            solarAvailable: solar != nil
        )
    }

    /// What VoiceOver reads while the info labels show (helpers.js `infoSpeech`, pure.js `pureInfoSpeech`).
    static func infoSpeech(_ m: InfoLabels, pure: Bool) -> String {
        let sentence = { (s: String) in s.prefix(1) + s.dropFirst().lowercased() }
        let value = { (v: String) in v == dash ? "not defined" : v }
        let top = "\(sentence(m.topCaption)) of the top period: \(value(m.topValue))."
        guard m.solarAvailable else {
            return top + (pure ? " Solar sync: not defined within one sync of the catalogue edge."
                : " Solar sync: not defined within 3 days of the catalogue edge.")
        }
        let solar = "\(sentence(m.solarCaption)) of the solar sync: \(value(m.solarValue))."
        return pure ? "\(top) \(solar) Solar \(m.syncCaption.lowercased()), \(m.syncValue)."
            : "\(top) \(solar) Sync time: \(value(m.syncValue))."
    }

    /// The name shown under a period letter in pure mode: a major cycle in words ("Delta Trifracton"), a minor one by
    /// where it starts in its Nuclide ("ε#5", "ε#5 34η", "ε#5 34η 28ι").
    static func letterName(level: Int, cycle: Int64, notation: Notation) -> String {
        notation.cycleName(level: level, cycle: cycle)
    }

    /// Where a running cycle sits, in one pure phrase (pure.js `placeText`):
    /// major "Delta Trifracton End · 3 of 5 in its γ", ε "ε#5 of 5 in Delta Trifracton", unit "34η of 77 in ε#5",
    /// between "28ι to 31ι in 34η".
    static func place(level: Int, reading lv: LevelReading, notation n: Notation) -> String {
        if Notation.isMajor(level) {
            let head = "\(n.cycleName(level: level, cycle: lv.cycle)) \(Notation.quarterWords[lv.quarter])"
            let parent = level == 0 ? "the catalogue" : "its \(Fractonica.periodName(level - 1).letter)"
            return "\(head) · \(lv.local + 1) of \(lv.siblings) in \(parent)"
        }
        let c = n.countsAtStart(level: level, cycle: lv.cycle)
        if level == 4 { return "ε#\(c.epsilon) of 5 in \(Notation.periodName(level: 3, ordinal: c.delta))" }
        // the unit a start is counted in, how many make its parent, the parent's own count
        let placing: (count: Int, symbol: String, of: Int, parent: String)? =
            switch level {
            case 5, 6: (c.eta, "η", 77, "ε#\(c.epsilon)")
            case 7, 8: (c.iota, "ι", 36, "\(c.eta)η")
            case 9, 10: (c.lambda, "λ", 65, "\(c.iota)ι")
            case 11, 12: (c.nu, "ν", 25, "\(c.lambda)λ")
            default: nil
            }
        guard let p = placing else { return n.cycleName(level: level, cycle: lv.cycle) }
        // a depth between two units is counted in the finer one: a θ is 4ι, said first to last
        let between = [5: 11, 7: 4, 9: 13, 11: 5][level]
        if let span = between { return "\(p.count)\(p.symbol) to \(p.count + span - 1)\(p.symbol) in \(p.parent)" }
        return "\(p.count)\(p.symbol) of \(p.of) in \(p.parent)"
    }

    /// The accessible label of a period row ("η depth 7: state 13 of 16, value −3, falling, cycle 1 of 11"; pure:
    /// "η depth 7 · 34η of 77 in ε#5: state 13 of 16, value −3, falling").
    static func rowLabel(level: Int, reading lv: LevelReading, digits: [Int], words: Wording) -> String {
        let letter = Fractonica.periodName(level).text
        let state = "state \(digits.first ?? 0) of 16, \(describe(index: digits.first ?? 0))"
        if words.pure { return "\(letter) depth \(level + 1) · \(place(level: level, reading: lv, notation: words.notation)): \(state)" }
        return "\(letter) depth \(level + 1): \(state), cycle \(lv.local + 1) of \(lv.siblings)"
    }

    /// The accessible label of the solar odometer ("Solar sync 4820, 35.8 percent"; pure "phase 5 and 11 of 256").
    static func solarLabel(_ s: SolarReading?, pure: Bool) -> String {
        guard let s else {
            return pure ? "Solar sync unavailable within one sync of the catalogue ends"
                : "Solar sync unavailable within three days of the catalogue ends"
        }
        if pure {
            let p = Notation.pair(s.phase)
            return "Solar sync \(integer(s.sync)), phase \(p.hi) and \(p.lo) of 256"
        }
        return "Solar sync \(integer(s.sync)), \(percent(s.phase)) percent"
    }

    // MARK: - States outside the readings

    /// The out-of-catalogue lines: what, then the range (in pure mode the first and last Alpha, never years).
    static func outOfRange(words: Wording) -> (title: [String], range: [String]) {
        if words.pure {
            let ends = words.notation.catalogueText().components(separatedBy: " – ")
            return (["outside the", "catalogue"], ["from \(ends.first ?? "α#1")", "to \(ends.last ?? "α#18")"])
        }
        let clock = words.notation.model
        return (["outside Saros 141", "catalogue"], ["from \(words.earth.date(clock.tMin))", "to \(words.earth.date(clock.tMax))"])
    }

    /// Where the solar sync is not defined (within about one sync of the catalogue's ends).
    static func solarUnavailable(pure: Bool) -> [String] {
        pure ? ["not defined within", "one sync of the edge"] : ["not defined within", "3 days of the edge"]
    }

    // MARK: - The turnover line

    /// What begins when the running cycle of `level` ends, and when.
    struct Turnover: Equatable, Sendable {
        /// "35η", "ε#2", "Delta Tetrafracton"; for a depth between units its letter ("θ").
        var name: String
        /// The depth between units has no name: the line says "Next θ" instead of "35η begins".
        var named: Bool
        /// "in 56 min 12 s" · pure "in 6ι 43λ"; empty when the catalogue ends with this cycle.
        var countdown: String
        /// The catalogue ends with this cycle: nothing begins.
        var last: Bool
        var level: Int
    }

    static func turnover(level: Int, reading lv: LevelReading, at t: Double, words: Wording) -> Turnover {
        let n = words.notation
        let clock = n.model
        let last = lv.clipped || lv.end >= clock.tMax - 1e-3
        let kind = Notation.levelKind(level)
        let next = lv.cycle + 1
        let name: String
        switch kind {
        case "major":
            name = n.cycleName(level: level, cycle: next)
        case "unit" where level > 4:
            // the finest count alone ("35η", "30ι"), or with the Nuclide when it turns over too ("ε#1 1η"),
            // like pure.js `followerName`
            let now = n.countsAtStart(level: level, cycle: lv.cycle)
            let then = n.countsAtStart(level: level, cycle: next)
            name = now.epsilon == then.epsilon && now.delta == then.delta
                ? n.cycleShort(level: level, cycle: next) : n.cycleName(level: level, cycle: next)
        case "unit":
            name = n.cycleShort(level: level, cycle: next)
        default:
            name = Fractonica.periodName(level).text
        }
        let countdown = last ? "" : words.countdown(lv.end - t, at: t)
        return Turnover(name: name, named: kind == "major" || kind == "unit", countdown: countdown, last: last, level: level)
    }

    /// The turnover as one sentence: "35η begins in 56 min 12 s", "Next θ in 1ι 30λ", "The catalogue ends with this η".
    static func sentence(_ x: Turnover) -> String {
        if x.last { return "The catalogue ends with this \(Fractonica.periodName(x.level).text)" }
        return x.named ? "\(x.name) begins \(x.countdown)" : "Next \(x.name) \(x.countdown)"
    }

    // MARK: - The journal face

    /// What VoiceOver reads for the journal face (journal.js `ariaOf`).
    static func journalLabel(_ r: Journal.Reading) -> String {
        let middle = r.tokens.map { $0.map(\.text).joined(separator: " ") } ?? r.major?.lines.joined(separator: " ") ?? ""
        return "Journal face: \(middle); the \(r.leadLetter) phase above and its cycle below"
    }
}

/// The lines of "How to read" (`FaceGuide`; howto.js and pure.js `pureHowToLines`), Markdown for bold.
enum FaceGuideText {
    static func glyphLines(pure: Bool) -> [String] {
        var lines = [
            "**Glyph = phase.** It shows where a cycle is: the value climbs to +4, falls to −4 and returns – 16 states per cycle.",
            "**Dot = falling.** A dot above the stem marks the falling half; rising and the two turning points have none.",
            pure
                ? "**Pair = odometer.** The left glyph is the coarse step, the right one the fine step inside it: 16 × 16 = 256 phases of a cycle."
                : "**Pair = odometer.** The left glyph is the coarse step, the right one the fine step inside it.",
        ]
        if pure {
            lines.append("**Numbers from 1, counts from 0.** 34η is the 34th Helion of its Nuclide (1–77); ε#5 and Delta Trifracton are numbered from 1 too. 29ι 21λ count the Preons and Flavons completed, from 0.")
        }
        return lines
    }

    static func journalLines(pure: Bool) -> [String] {
        [
            "**Middle:** three units from the longest down, every count in two digits – 34η 29ι 21λ. From the Delta up a period is shown alone, in words: 5th / Delta / Trifracton / End.",
            "**Top:** the phase of the longest unit shown, as a pair of glyphs (a period from Alpha to Delta as one 3-stroke glyph).",
            "**Bottom:** that unit's whole cycle – the left arc descends, the right one ascends; the white tick is now, the bright part already run.",
            pure
                ? "**The Helion is the basic reading:** its number and its phase. Preons and Flavons are the fine time."
                : "**The Helion is the basic reading** (about 5 hours): its number and its phase. Preons and Flavons are the fine time, like minutes and seconds.",
        ]
    }

    static func watchLines(pure: Bool) -> [String] {
        [
            "**Teal pairs:** two periods, the longer on top – the top pair at its depth, the lower one a depth below.",
            "**Counter dots** are the cycles of the parent period; lit up to the one you are in.",
            pure
                ? "**Yellow** is the solar sync: 19η cycles, 19 Helions. Its start drifts a little earlier with every sync, counted in λ."
                : "**Yellow** is the solar sync: 19 η cycles ≈ 4 civil days, landing about 10 s earlier each time.",
            pure
                ? "**Info labels** count down to the next threshold of the top period and of the sync, and give the sync's number and drift."
                : "**Info labels** give the next threshold of the top period and of the sync, and the time the sync began.",
        ]
    }

    static let gestureLines = [
        "**Tap the top or the bottom** of a face, or swipe down or up, for a longer or shorter unit; the rail of letters beside it jumps straight there.",
        "**Watch face:** tap the middle for the info labels, double tap to keep the period letters.",
        "**Swipe sideways** or use the dots to switch faces. Keys: ↑ ↓ step, ← → switch, i info, l letters.",
    ]
}
