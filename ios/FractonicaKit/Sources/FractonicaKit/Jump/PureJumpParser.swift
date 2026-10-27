import Foundation

/// The pure-mode jump box: what a person types turned into ranked candidate moments, in Fractonica terms only
/// (SPEC §15). A port of `parsePure` (src/ui/calendar/pure-parse.js); golden tests replay the JavaScript.
///
///     dates        all four forms, or any tail of them (the periods above come from the shown moment):
///                  Alpha Hexafracton Valley, …, Delta Trifracton End, ε#5 34η 29ι · Delta Trifracton End ε#5 34η 29ι
///                  α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν · δ#3 ε#5 34η 29ι · Gamma Difracton · Delta Trifracton Node
///                  ε#2 5η · 34η 17ι
///     addresses    a6 b4 g9 · 6.4.9 · d7#717211 (global index) · "ζ 6" (a depth chip: the running ζ)
///     offsets      +2ε 5η · -3ι · in 5λ · 3η ago · +0.5ν · +4 Blinks · +2 Nuclides 5 Helions
///     boundaries   next ε · prev η · next Helion · next Delta node · next node of Delta · next peak η · next peak
///     position     pos 22.9278 · sync 4820 · S4820 node · η [13,0] · η 13·4 · now · live
///
/// Old forms get one short pointer each; Earth input (a date, a clock time, "+3d", a city, Unix seconds) is answered
/// with one message instead of being read. Nothing returned contains a Gregorian date, a zone or an Earth unit. A
/// leading Pentad is read past, as a weekday before a date (`PentadLead`): "Pentad II · δ#3 ε#2 5η 5ι", "⬠II 34η 29ι".
public enum PureJumpParser {
    /// The placeholder of the pure box.
    public static let placeholder = "Delta Trifracton Node · ε#2 5η · +2ε 5η · next Helion · pos 24.5"

    /// Examples offered while the box is empty: the text and what it means.
    public static let examples: [(text: String, meaning: String)] = [
        ("Gamma Difracton", "start of the 2nd Gamma in the current Beta"),
        ("Delta Trifracton Node", "where the Node quarter of the 3rd Delta begins"),
        ("Delta Trifracton Node ε#2 21η 12ι", "a short date: Delta and quarter, Nuclide, Helion (from 1), Preons"),
        ("α#6 β#4 γ#9 δ#3 ε#5 34η 29ι", "the stamp: every period in letters, no quarter words"),
        ("ε#2 5η", "the 5th Helion of the 2nd Nuclide of the current Delta"),
        ("34η 17ι", "the 34th Helion of the shown Nuclide, 17 Preons in (Preons count from 0)"),
        ("+2ε 5η", "two Nuclides and five Helions after the shown moment"),
        ("+4 Blinks", "four Blinks (ν) after the shown moment"),
        ("next Helion", "the next η boundary"),
        ("next Delta node", "the next node of a Delta (its Valley quarter begins)"),
        ("pos 24.5", "Saros position"),
        ("sync 4820", "start of a solar sync"),
        ("η [13,0]", "next time the Helion shows the glyph pair 13·0"),
    ]

    /// Reads `text` at the context's shown moment: the candidates best first, the errors only when nothing parsed,
    /// [] for blank text.
    public static func parse(_ text: String, _ context: PureJumpContext, notation: Notation = Notation()) -> [JumpCandidate] {
        if text.jsLength > JumpParser.maxInput && text.jsTrim.jsLength > JumpParser.maxInput {
            return [.error("That is \(text.jsTrim.jsLength) characters: the jump box reads up to \(JumpParser.maxInput)",
                           "Paste a date, a stamp, counts or an offset")]
        }
        let typed = normalize(text)
        if typed.isEmpty { return [] }
        // a leading Pentad is implied by the rest of the date (SPEC §15.3)
        let (pentad, raw) = PentadLead.strip(typed)
        if !pentad.isEmpty && raw.isEmpty { return [PentadLead.alone(pentad, example: "δ#3 ε#2 5η 5ι")] }
        let lower = raw.jsLower
        // old forms: one pointer each, whatever else the text says (and the pointer never repeats them)
        if halfRE.test(lower) { return [.error(halfAnswer.0, halfAnswer.1)] }
        if beatRE.test(lower) { return [.error(beatAnswer.0, beatAnswer.1)] }
        if let m = retiredRE.exec(lower) {
            return [.error("That unit name is retired: the units are Delta, Nuclide, Helion, Preon, Flavon and Blink",
                           "\(retiredHint[m[1]!] ?? "") Press ? for the glossary.")]
        }
        if let m = minorFractonRE.exec(lower) { return [minorFractonAnswer(m)] }
        let now = JumpMaths.r3(context.now.isFinite ? context.now : 0)
        let c = Context(notation: notation, now: now, real: JumpMaths.r3(context.real.isFinite ? context.real : now), text: raw,
                        lower: lower, level: context.level.flatMap { (0..<14).contains($0) ? $0 : nil })
        var good: [JumpCandidate] = []
        var bad: [JumpCandidate] = []
        for recognize in recognizers {
            guard let items = recognize(c) else { continue }
            for item in items {
                if item.kind == .error { bad.append(item) } else { good.append(item) }
            }
        }
        if !good.isEmpty {
            // best first; `rank` demotes a reading that is only the second guess (a stable partition)
            let ranked = good.filter { $0.rank == 0 } + good.filter { $0.rank != 0 }
            var seen = Set<String>()
            return ranked.filter { seen.insert("\($0.kind.rawValue)|\($0.time.map(JSNumber.string) ?? "null")").inserted }
        }
        if !bad.isEmpty {
            var seen = Set<String>()
            return bad.filter { seen.insert($0.label).inserted }
        }
        if looksEarthly(raw) { return [earthAnswer] }
        // (a percentage is no Earth input but must not be printed back)
        let echo = percentRE.test(raw) ? "that" : "\"\(JumpMaths.clip(raw))\""
        return [.error("Cannot read \(echo)", "Try \(help). \(glossary)")]
    }

    // MARK: - Context

    struct Context {
        let notation: Notation
        let now: Double
        let real: Double
        let text: String
        let lower: String
        let level: Int?
        var clock: FractonicaClock { notation.model }
    }

    private static let recognizers: [@Sendable (Context) -> [JumpCandidate]?] = [
        keyword, offset, state, global, date, address, sync, position, boundary, levelOnly,
    ]

    /// The forms the generic answers suggest ("Try …. ").
    public static let help = "Delta Trifracton Node · α#6 β#4 γ#9 δ#3 · ε#2 5η · 34η 17ι · +2ε 5η · +4 Blinks · next Helion · pos 24.5 · sync 4820"
    /// Where the notation is explained, the tail of every help line.
    public static let glossary = "# numbers and Helions start at 1, counts at 0. Press ? for the glossary."

    // MARK: - Vocabulary

    private static let pointWords = JumpParser.pointWords
    private static let quarterAlt = "peak|node|valley|end"
    private static let depthAlt = JumpParser.depthAlt
    private static let levelWords = JumpParser.levelWords
    private static let levelWordAlt = levelWords.joined(separator: "|")
    private static let majorWordAlt = levelWords.prefix(4).joined(separator: "|")
    private static let ordinalAlt = Notation.ordinalNames.dropFirst().map { $0.lowercased() }.joined(separator: "|")
    /// Unit names → level: alpha beta gamma delta (also level names), nuclide helion preon flavon blink.
    private static let unitWords: [String: Int] = Dictionary(uniqueKeysWithValues: Notation.units.map { ($0.name.lowercased(), $0.level) })
    /// Longest first ("nuclide" must not be read as "nu" + "clide"), each with an optional plural s.
    private static let unitWordAlt: String = {
        let names = Notation.units.map { $0.name.lowercased() }
        let sorted = names.enumerated().sorted { a, b in a.element.count != b.element.count ? a.element.count > b.element.count : a.offset < b.offset }
        return sorted.map { "\($0.element)s?" }.joined(separator: "|")
    }()
    /// A depth letter, a level name or a unit name.
    private static let greekAlt = "\(unitWordAlt)|\(levelWordAlt)|[α-ξ]"
    /// No letter may follow a unit token: "3eta" is a count of η, "3etas" and "3etc" are not.
    private static let end = "(?![a-zα-ω])"

    private static func unitWordLevel(_ token: String) -> Int {
        if let l = unitWords[token] { return l }
        if token.hasSuffix("s"), let l = unitWords[String(token.dropLast())] { return l }
        return -1
    }

    /// Level of a unit letter, a level name or a unit name; −1 when it is none of them.
    static func levelOfUnitToken(_ token: String) -> Int {
        let t = token.jsLower
        let w = unitWordLevel(t)
        return w >= 0 ? w : JumpParser.levelOfToken(t)
    }

    /// "Delta" for a major level, the letter for the others.
    private static func levelWord(_ level: Int) -> String {
        level <= 3 ? Notation.levelNames[max(0, level)] : JumpMaths.letter(level)
    }

    private static func quarterOf(_ w: String?) -> Int {
        guard let w, !w.isEmpty else { return -1 }
        return Notation.quarterWords.firstIndex { $0.lowercased() == w.lowercased() } ?? -1
    }

    /// `String(Number(x.toPrecision(6)))`.
    private static func fmtNum(_ x: Double) -> String { JSNumber.string(JSNumber.precision(x, 6)) }

    /// "1st", "2nd" … of a whole number (any size, printed as JavaScript does).
    private static func ordinal(_ n: Double) -> String {
        let v = n.truncatingRemainder(dividingBy: 100)
        if v >= 11 && v <= 13 { return "\(JSNumber.string(n))th" }
        let d = Int(n.truncatingRemainder(dividingBy: 10))
        return JSNumber.string(n) + (d > 3 || d < 0 ? "th" : ["th", "st", "nd", "rd"][d])
    }

    // MARK: - Old forms: one pointer each

    private static let halfRE = JSRegex("(?:[α-ξ]|\(levelWordAlt))\\s*(?:½|-\\s*half\\b|\\s+half\\b)")
    private static let halfAnswer = ("Half-cycle units are gone: count whole units",
                                     "A Delta is 5 Nuclides (ε#1–5), a Nuclide 77 Helions: write Delta Trifracton, ε#2, 34η. Press ? for the glossary.")
    private static let beatRE = JSRegex("\\bbeats?\\b")
    private static let beatAnswer = ("Real time is counted in Blinks now: write +4 Blinks or +4ν",
                                     "A Blink (ν) is the finest unit and the tick of the device clock. Speeds read \"4ι per Blink\", frequencies \"pB\" (cycles per Blink). Press ? for the glossary.")
    private static let retiredRE = JSRegex("\\b(hadron|quark|chromon|somon|atom)s?\\b")
    private static let retiredHint = [
        "atom": "That period is the Delta now (δ, 5 Nuclides): write Delta, next Delta, +2δ.",
        "hadron": "That depth (ζ) is not a unit any more: it is 11 Helions, write 11η.",
        "quark": "That depth (θ) is not a unit any more: it is 4 Preons, write 4ι.",
        "chromon": "That depth (κ) is not a unit any more: it is 13 Flavons, write 13λ.",
        "somon": "That depth (μ) is not a unit any more: it is 5 Blinks, write 5ν.",
    ]
    private static let minorFractonRE = JSRegex(
        "\\b(\(Notation.levelNames.dropFirst(4).map { $0.lowercased() }.joined(separator: "|")))[\\s-]+(\(ordinalAlt)|[a-z]*fracton)\\b"
    )

    private static func minorFractonAnswer(_ m: JSMatch) -> JumpCandidate {
        let n = Notation.ordinalNames.firstIndex { $0.lowercased() == m[2] } ?? -1
        let hint = m[1] == "epsilon" && n >= 1
            ? "A Nuclide is written by its number: ε#\(n). "
            : "Below the Delta a cycle is placed by counts in its Nuclide: ε#2 5η 9ι. "
        return .error("Only Alpha, Beta, Gamma and Delta have fracton names", "\(hint)Press ? for the glossary.")
    }

    /// A depth that is no unit (ζ θ κ μ) used as one: "a ζ is 11η".
    private static func betweenAnswer(_ c: Context, _ level: Int, _ n: Double, span: Bool) -> JumpCandidate {
        let symbol = JumpMaths.letter(level)
        guard let b = PureDates.betweenUnit(c.clock, level) else {
            let length = c.notation.cycleLength(level: level)
            return .error("\(symbol) is finer than a Blink: count it as a decimal of ν", "One \(symbol) cycle is \(length), e.g. +\(length)")
        }
        let bn = JSNumber.string(b.n)
        if span {
            return .error("\(symbol) is a depth, not a unit: a \(symbol) is \(bn)\(b.unit.sym)",
                          "Write +\(fmtNum(n * b.n))\(b.unit.sym) for +\(fmtNum(n))\(symbol). The units are α β γ δ ε η ι λ ν (Delta, Nuclide, Helion, Preon, Flavon, Blink).")
        }
        let parent = Notation.units.first { $0.level == level - 1 }
        // (Helions are numbered from 1 in their Nuclide; Preons, Flavons and Blinks counted from 0 in their parent)
        let at = (n - 1) * b.n + (b.unit.id == "eta" ? 1 : 0)
        let where_ = n == n.rounded() && n >= 1
            ? "The \(ordinal(n)) \(symbol) of a \(parent?.name ?? "undefined") begins at \(JSNumber.string(at))\(b.unit.sym)"
            : "A \(symbol) is \(bn)\(b.unit.sym)"
        return .error("\(symbol) is a depth, not a unit: count \(b.unit.name)s instead",
                      "\(where_) (a \(symbol) is \(bn)\(b.unit.sym)); a stamp reads α#6 β#4 γ#9 δ#3 ε#5 34η 29ι")
    }

    // MARK: - Candidates

    /// "in 2ε 5η" / "5λ ago" / "the shown moment".
    private static func relText(_ c: Context, _ t: Double) -> String {
        if abs(t - c.now) < 0.0005 { return "the shown moment" }
        let text = PureDates.spanText(c.notation, min(c.now, t), max(c.now, t))
        return t > c.now ? "in \(text)" : "\(text) ago"
    }

    private static func make(_ c: Context, _ kind: JumpCandidate.Kind, _ label: String, _ t: Double?, extra: String = "",
                             upTo: String = "eta") -> JumpCandidate {
        guard let t, c.clock.inRange(t) else {
            return .error("\(label) is outside the catalogue", "The catalogue runs \(c.notation.catalogueText())")
        }
        let when = "\(c.notation.stamp(at: t, upTo: upTo)) (\(relText(c, t)))"
        return JumpCandidate(kind: kind, label: label, time: t, detail: [when, extra].filter { !$0.isEmpty }.joined(separator: " · "),
                             note: extra)
    }

    /// "ε lasts 77η": what one cycle of a level is made of ("" for the Blink).
    private static func lastsText(_ c: Context, _ level: Int, clipped: Bool = false) -> String {
        let made = PureDates.madeOf(c.notation, level)
        if made.isEmpty && !clipped { return "" }
        return "\(levelWord(level)) lasts \(made.isEmpty ? "1" + JumpMaths.letter(level) : made)\(clipped ? " (clipped by the catalogue end)" : "")"
    }

    private static func outsideNote(_ c: Context) -> String { "The catalogue runs \(c.notation.catalogueText())" }

    // MARK: - Earth input: answered, never read

    private static let earthUnitRE = JSRegex(
        "(?:^|[\\s+\\-(])\\d+(?:[.,]\\d+)?\\s*(?:ms|msec|msecs|s|sec|secs|seconds?|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?|mo|mos|months?|y|yr|yrs|years?)(?![a-zα-ω])",
        ignoreCase: true
    )
    private static let earthWordRE = JSRegex(
        "\\b(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|today|tomorrow|yesterday|noon|midnight|utc|gmt|unix|epoch|timestamp|iso|am|pm|tonight|morning|evening)\\b",
        ignoreCase: true
    )
    private static let earthDateRE = JSRegex(
        "\\b\\d{1,2}:\\d{2}|\\b\\d{4}-\\d{1,2}(?:-\\d{1,2})?\\b|\\b\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}\\b|\\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b|\\b(?:mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\b|^\\d{6,}$",
        ignoreCase: true
    )
    private static let percentRE = JSRegex("%|per ?cent", ignoreCase: true)

    /// Does this read like a date, a clock time, an Earth-unit offset, a city or a Unix time?
    public static func looksEarthly(_ text: String) -> Bool {
        let s = normalize(text)
        if s.isEmpty { return false }
        if earthDateRE.test(s) || earthWordRE.test(s) || earthUnitRE.test(s) { return true }
        if GregorianParser.parse(s, zone: "UTC", ref: (2000, 1, 1), zoneNames: true) != nil { return true }
        return GregorianParser.mentionsZone(s)
    }

    private static let earthAnswer = JumpCandidate.error(
        "Dates and clock times are off in pure mode",
        "This instrument is read in periods, counts, offsets and positions. Try \(help). \(glossary)"
    )

    private static let dashes = JSRegex("[\u{2212}\u{2012}\u{2013}\u{2014}\u{2015}]")
    private static let half = JSRegex("1\u{2044}2")
    private static let spaces = JSRegex("[\u{00A0}\u{2000}-\u{200B}\u{202F}\u{205F}\u{3000}]")
    private static let blanks = JSRegex("\\s+")

    /// Light normalisation: NFC (NFKC would turn ½ into 1⁄2), plain minus, one kind of space.
    static func normalize(_ text: String) -> String {
        var s = text.precomposedStringWithCanonicalMapping
        s = dashes.replaceAll(s, "-")
        s = half.replaceAll(s, "½")
        s = spaces.replaceAll(s, " ")
        s = blanks.replaceAll(s, " ")
        return s.jsTrim
    }

    // MARK: - now · live

    private static let keywordRE = JSRegex("^(?:now|live)$")

    static func keyword(_ c: Context) -> [JumpCandidate]? {
        guard keywordRE.test(c.lower) else { return nil }
        var candidate = make(c, .relative, "Now (the live clock)", c.real)
        if candidate.kind != .error { candidate.live = true }
        return [candidate]
    }

    // MARK: - Offsets: +2ε 5η, +4 Blinks

    private struct Term {
        var n: Double
        var token: String
    }

    private static let termRE = JSRegex("\\s*(\\d+(?:\\.\\d+)?)\\s*(\(greekAlt))\(end)\\s*,?\\s*(?:and\\s+)?")

    private static func parseTerms(_ s: String) -> [Term]? {
        var out: [Term] = []
        var used = 0
        while true {
            guard let m = termRE.sticky(s, at: used) else { break }
            out.append(Term(n: jsNumber(m[1]), token: m[2]!))
            used = m.end
            if used >= s.jsLength { break }
        }
        return !out.isEmpty && used >= s.jsTrimEnd.jsLength ? out : nil
    }

    private static let inRE = JSRegex("^in\\s+(.+)$")
    private static let agoRE = JSRegex("^(.+?)\\s+(?:ago|before)$")
    private static let laterRE = JSRegex("^(.+?)\\s+(?:later|after|ahead)$")
    private static let leadRE = JSRegex("^([+-])\\s*(.+)$")
    private static let bareNumberRE = JSRegex("^\\d+(?:\\.\\d+)?$")

    static func offset(_ c: Context) -> [JumpCandidate]? {
        var s = c.lower
        var sign: Double?
        if let m = inRE.exec(s) {
            sign = 1
            s = m[1]!
        } else if let m = agoRE.exec(s) {
            sign = -1
            s = m[1]!
        } else if let m = laterRE.exec(s) {
            sign = 1
            s = m[1]!
        }
        if let lead = leadRE.exec(s) {
            sign = (sign ?? 1) * (lead[1] == "-" ? -1 : 1)
            s = lead[2]!
        }
        if bareNumberRE.test(s) && sign != nil && s.replacingFirst(".", with: "").jsLength <= 5 {
            return [.error("Add a unit to the offset", "e.g. +2ε 5η · -3ι · in 5λ · 3η ago · +4 Blinks")]
        }
        guard let terms = parseTerms(s) else { return nil }
        // "34η 29ι 21λ" with no sign is also the clock the header prints: the date is the first reading, the span second
        let clockLike = sign == nil && isClockChain(c, terms)
        let direction = sign ?? 1
        if terms.count > 9 { return [.error("At most 9 terms in an offset")] }
        var dpos = 0.0
        var shown: [String] = []
        for term in terms {
            let level = levelOfUnitToken(term.token)
            if level < 0 { return [.error("\"\(JumpMaths.clip(term.token, 12))\" is not a unit")] }
            guard let unit = Notation.unit(level: level) else { return [betweenAnswer(c, level, term.n, span: true)] }
            dpos += term.n * c.notation.unitPos(unit)
            shown.append("\(JSNumber.string(term.n))\(unit.sym)")
        }
        let label = "\(direction < 0 ? "−" : "+")\(JumpMaths.clip(shown.joined(separator: " "), 32)) from the shown moment"
        guard let p0 = c.clock.position(at: c.now) else {
            return [.error("\(label): the shown moment is outside the catalogue", outsideNote(c))]
        }
        let p = p0 + direction * dpos
        if !(p >= 0 && p <= Double(c.clock.extent)) { return [.error("\(label) is outside the catalogue", outsideNote(c))] }
        var candidate = make(c, .relative, label, JumpMaths.r3(c.clock.time(atPosition: p)), upTo: "nu")
        if clockLike && candidate.kind != .error { candidate.rank = 1 }
        return [candidate]
    }

    /// η, η ι, η ι λ or η ι λ ν with whole counts inside their ranges: what the header's clock prints.
    private static func isClockChain(_ c: Context, _ terms: [Term]) -> Bool {
        guard (2...4).contains(terms.count) else { return false }
        let ids = ["eta", "iota", "lambda", "nu"]
        let r = PureDates.ranges(c.notation)
        return terms.enumerated().allSatisfy { i, t in
            guard let u = Notation.unit(level: levelOfUnitToken(t.token)), u.id == ids[i] else { return false }
            return t.n == t.n.rounded() && t.n >= r[u.id]!.min && t.n <= r[u.id]!.max
        }
    }

    // MARK: - Glyph states: η [13,0]

    private static let stateRE = JSRegex("^(?:(next|prev|previous)\\s+)?(\(depthAlt)|\(greekAlt))\\s*(.+)$")
    private static let bracketRE = JSRegex("^[[(]\\s*(.*?)\\s*[\\])]$")
    private static let digitsRE = JSRegex("^\\d{1,3}(?:\\s*[,;·\\s]\\s*\\d{1,3})*\\s*,?$")
    private static let digitSplitRE = JSRegex("[,;·\\s]+")
    private static let depthFormRE = JSRegex("^\(depthAlt)$")
    private static let depthTokenRE = JSRegex("^(?:depth|d)\\s*(\\d{1,2})$")

    private static func levelOfDepthToken(_ token: String) -> Int {
        if let m = depthTokenRE.exec(token) {
            let d = Int(m[1]!)!
            return d >= 1 && d <= 14 ? d - 1 : -2
        }
        return levelOfUnitToken(token)
    }

    static func state(_ c: Context) -> [JumpCandidate]? {
        guard let m = stateRE.exec(c.lower) else { return nil }
        let bracket = bracketRE.exec(m[3]!)
        let body = bracket?[1] ?? m[3]!
        guard digitsRE.test(body) else { return nil }
        let digits = digitSplitRE.split(body).filter { !$0.isEmpty }.map { Int($0)! }
        let depthForm = depthFormRE.test(m[2]!)
        if bracket == nil && !body.contains(",") && !body.contains("·") && !(depthForm && digits.count >= 2) { return nil }
        let direction0 = m[1] == nil ? 1 : (m[1] == "next" ? 1 : -1)
        let level = levelOfDepthToken(m[2]!)
        if level == -2 { return [.error("Depth must be between 1 and 14")] }
        if level < 0 { return nil }
        if level <= 3 {
            let name = Notation.levelNames[level]
            return [.error("A \(name) has no glyph pair: it is read by its quarter",
                           "Write next \(name) node, or \(name) Trifracton Valley (Peak, Node, Valley, End)")]
        }
        let clock = c.clock
        let tc = clock.clamp(c.now)
        for d in digits where d > 15 {
            return [.error("Digit \(d) is too large: two-stroke glyphs have 16 states, numbered 0–15")]
        }
        let names = digits.map(String.init).joined(separator: "·")
        var out: [JumpCandidate] = []
        for direction in direction0 >= 0 ? [1, -1] : [-1, 1] {
            let label = "\(direction > 0 ? "Next" : "Previous") time \(JumpMaths.letter(level)) shows \(names)"
            guard let o = clock.stateOccurrences(level: level, digits: digits, around: tc, direction: direction, count: 1).first else {
                out.append(.error("\(label): none inside the catalogue"))
                continue
            }
            let shows = { (t: Double) in clock.odometer(at: t, level, digits: digits.count)?.digits == digits }
            let t = PureDates.firstMs(o.start, shows) ?? JumpMaths.ceilMs(o.start)
            out.append(make(c, .state, label, t, extra: "lasts \(c.notation.duration(o.end - o.start, at: o.start))",
                            upTo: Notation.resolutionOf(level)))
        }
        return out
    }

    // MARK: - Global index: d7#717211

    private static let globalRE = JSRegex("^(\(depthAlt))\\s*#\\s*(\\d+)(?:\\s+(\(pointWords)))?$")

    static func global(_ c: Context) -> [JumpCandidate]? {
        guard let m = globalRE.exec(c.lower) else { return nil }
        let level = levelOfDepthToken(m[1]!)
        if level == -2 { return [.error("Depth must be between 1 and 14")] }
        if level < 0 { return nil }
        let clock = c.clock
        let count = clock.count(level)
        guard let idx = Int128(m[2]!), idx < count else {
            return [.error("Depth \(level + 1) has only \(count) cycles in the catalogue (d\(level + 1)#0 … d\(level + 1)#\(count - 1))",
                           "The number after the # is the 0-based index counted over the whole catalogue")]
        }
        let pid = JumpParser.pointID(m[3] ?? "begin")
        let phase = JumpParser.phaseOfPoint(pid)
        if JumpMaths.pointOfCycle(clock, level, Double(idx), phase) == nil {
            return [.error("The \(JumpParser.pointLabel(pid)) of this \(levelWord(level)) cycle lies beyond the end of the catalogue")]
        }
        let label = "\(levelWord(level)) global index \(idx) · \(c.notation.cycleName(level: level, cycle: Int64(idx)))\(pid == "begin" ? "" : " · " + JumpParser.pointLabel(pid))"
        let facts = clock.cycle(level: level, index: Int64(idx))!
        return [make(c, .cycle, label, PureDates.landPoint(clock, level, Int64(idx), phase),
                     extra: lastsText(c, level, clipped: facts.clipped), upTo: Notation.resolutionOf(level))]
    }

    // MARK: - Dates in all four forms

    private struct DateToken {
        enum Kind { case name, letter, count }
        var kind: Kind
        var level: Int
        var n: Double
        var hashed = false
        var quarter: Int
    }

    private static let inSplitRE = JSRegex("\\s+(?:in|of|within|inside)\\s+")
    private static let dateSeparatorsRE = JSRegex("[,›»>·|]")
    private static let nameTokenRE = JSRegex("\\s*(\(majorWordAlt))[\\s-]+(\(ordinalAlt))(?![a-z])(?:\\s+(\(quarterAlt)|begin|start)(?![a-z]))?")
    private static let letterTokenRE = JSRegex("\\s*(\(levelWordAlt)|[α-ξ])\(end)\\s*(#?)\\s*(\\d+)(?:\\s+(\(quarterAlt)|begin|start)(?![a-z]))?")
    private static let countTokenRE = JSRegex("\\s*(\\d+)\\s*(\(greekAlt))\(end)")

    /// Tokens of a date text, or nil when something else is in it.
    private static func tokenizeDate(_ lower: String) -> [DateToken]? {
        var s = blanks.replaceAll(dateSeparatorsRE.replaceAll(lower, " "), " ").jsTrim
        // "Gamma Difracton in Beta Tetrafracton": the parent after "in" goes first
        let halves = inSplitRE.split(s)
        if halves.count > 1 { s = halves.reversed().joined(separator: " ") }
        var tokens: [DateToken] = []
        var pos = 0
        while pos < s.jsLength {
            if let m = nameTokenRE.sticky(s, at: pos) {
                tokens.append(DateToken(kind: .name, level: levelWords.firstIndex(of: m[1]!) ?? -1,
                                        n: Double(Notation.ordinalNames.firstIndex { $0.lowercased() == m[2] } ?? -1),
                                        quarter: quarterOf(m[3])))
                pos = m.end
                continue
            }
            if let m = letterTokenRE.sticky(s, at: pos) {
                let level = JumpParser.levelOfToken(m[1]!)
                if level < 0 { return nil }
                tokens.append(DateToken(kind: .letter, level: level, n: jsNumber(m[3]), hashed: m[2] == "#", quarter: quarterOf(m[4])))
                pos = m.end
                continue
            }
            if let m = countTokenRE.sticky(s, at: pos) {
                let level = levelOfUnitToken(m[2]!)
                if level < 0 { return nil }
                tokens.append(DateToken(kind: .count, level: level, n: jsNumber(m[1]), quarter: -1))
                pos = m.end
                continue
            }
            return nil
        }
        return tokens.isEmpty ? nil : tokens
    }

    private static let countIDs = [6: "eta", 8: "iota", 10: "lambda", 12: "nu"]
    private static let ordinalIDs = [0: "alpha", 1: "beta", 2: "gamma", 3: "delta", 4: "epsilon"]

    /// Date tokens → ladder parts, or the error. "5η" is a count; "ε#2" / "δ 3" an ordinal; "η 3" (letter first, no
    /// hash) the old spelling of the count 3η, "η#4" the 4th Helion.
    private static func dateParts(_ c: Context, _ tokens: [DateToken]) -> Result<[PureDates.Part], ErrorBox> {
        var parts: [PureDates.Part] = []
        for t in tokens {
            let symbol = JumpMaths.letter(t.level)
            let quarter: Int? = t.quarter >= 0 ? t.quarter : nil
            switch t.kind {
            case .name:
                if t.n < 1 { return .failure(ErrorBox(.error("Not a fracton name"))) }
                parts.append(PureDates.Part(id: ordinalIDs[t.level]!, n: t.n, quarter: quarter, words: true))
                continue
            case .count, .letter:
                break
            }
            if quarter != nil && t.level > 3 {
                return .failure(ErrorBox(.error("A quarter word belongs to a major period (Alpha, Beta, Gamma, Delta), not to \(symbol)",
                                                "e.g. Delta Trifracton Node ε#2 21η")))
            }
            if t.kind == .count {
                if let id = countIDs[t.level] {
                    parts.append(PureDates.Part(id: id, n: t.n))
                    continue
                }
                if PureDates.betweenUnit(c.clock, t.level) != nil || t.level > 12 {
                    return .failure(ErrorBox(betweenAnswer(c, t.level, t.n, span: true)))
                }
                let n = JSNumber.string(t.n)
                return .failure(ErrorBox(.error(
                    "\(n)\(symbol) is a count of units, not a date entry",
                    "A date writes \(t.level <= 4 ? "an ordinal as \(symbol)#\(n)" : "it as an ordinal"); after the Nuclide come the Helion (numbered from 1) and the counts of Preons, Flavons, Blinks: 34η 29ι 21λ. A span after the shown moment starts with + : +\(n)\(symbol)"
                )))
            }
            // letter first
            if let id = ordinalIDs[t.level] {
                if t.n < 1 { return .failure(ErrorBox(.error("\(symbol)# numbers start at 1", "\(symbol)#1 is the first"))) }
                parts.append(PureDates.Part(id: id, n: t.n, quarter: quarter))
            } else if let id = countIDs[t.level] {
                if !t.hashed {
                    parts.append(PureDates.Part(id: id, n: t.n))
                } else {
                    if t.n < 1 {
                        return .failure(ErrorBox(.error("\(symbol)# numbers start at 1",
                                                        t.level == 6 ? "1η is the first Helion of a Nuclide" : "\(symbol)#1 is the first; a count of completed units starts at 0: 0\(symbol)")))
                    }
                    // η#4 is the 4th Helion, 4η (Helions are numbered from 1); ι#4 is the 4th Preon, the count 3ι
                    parts.append(PureDates.Part(id: id, n: t.level == 6 ? t.n : t.n - 1))
                }
            } else {
                return .failure(ErrorBox(betweenAnswer(c, t.level, t.n, span: false)))
            }
        }
        return .success(parts)
    }

    struct ErrorBox: Error {
        let candidate: JumpCandidate
        init(_ candidate: JumpCandidate) { self.candidate = candidate }
    }

    /// The written form of the parts: majors as given (words or letters, with a quarter word), then ε# and counts.
    private static func partsLabel(_ parts: [PureDates.Part]) -> String {
        let text = { (p: PureDates.Part) -> String in
            if p.words { return PureDates.entriesText([p], words: true) }
            return PureDates.entriesText([p]) + (p.quarter.map { " " + Notation.quarterWords[$0] } ?? "")
        }
        // several majors in words read like the full date: "Beta Tetrafracton, Gamma Difracton, ε#2 5η"
        let words = parts.filter(\.words)
        if words.count < 2 { return parts.map(text).joined(separator: " ") }
        let rest = parts.filter { !$0.words }.map(text).joined(separator: " ")
        return [words.map(text).joined(separator: ", "), rest].filter { !$0.isEmpty }.joined(separator: ", ")
    }

    static func date(_ c: Context) -> [JumpCandidate]? {
        guard let tokens = tokenizeDate(c.lower) else { return nil }
        // a bare count chain without any ordinal is (also) a span: the offset reader answers it; only η ι λ ν counts are a clock
        if tokens.allSatisfy({ $0.kind == .count }) && !tokens.allSatisfy({ countIDs[$0.level] != nil }) { return nil }
        // "ζ 6" / "η 7": what a depth chip prints, the running cycle of that depth (and an ordinal, where there is one)
        let t0 = tokens[0]
        let chip = tokens.count == 1 && t0.kind == .letter && !t0.hashed && t0.n == Double(t0.level + 1) && t0.quarter < 0
        switch dateParts(c, tokens) {
        case .failure(let box):
            if chip, let running = runningCycle(c, t0.level) { return [running] }
            return [box.candidate]
        case .success(let parts):
            var out = stamp(c, parts)
            if chip, let running = runningCycle(c, t0.level) { out.append(running) }
            return out
        }
    }

    private static func stamp(_ c: Context, _ parts: [PureDates.Part]) -> [JumpCandidate] {
        let t: Double, quarter: Int?
        switch PureDates.resolve(c.notation, parts, ref: c.now) {
        case .failure(let message, let detail): return [.error(message, detail)]
        case .moment(let time, let q): (t, quarter) = (time, q)
        }
        let ladder = PureDates.ladder
        let finestIdx = ladder.firstIndex(of: parts[parts.count - 1].id)!
        let firstIdx = ladder.firstIndex(of: parts[0].id)!
        let finest = ladder[finestIdx]
        let level = PureDates.levelOf(finest)
        let upTo = PureDates.isMajor(finest) ? "delta" : finest
        let given = partsLabel(parts)
        var label = given
        if firstIdx > 0 {
            let parentLevel = PureDates.levelOf(ladder[firstIdx - 1])
            if c.clock.inRange(c.now), let cur = c.clock.level(at: c.now, parentLevel) {
                label = "\(given) in \(c.notation.cycleName(level: parentLevel, cycle: cur.cycle))"
            }
        }
        // in words what the letters say (the stamp leads the detail anyway)
        let words = PureDates.isMajor(finest) ? c.notation.majorText(at: t, level: level) : c.notation.majorText(at: t, level: 3)
        let extra = [words, PureDates.isMajor(finest) && quarter == nil ? lastsText(c, level) : ""]
            .filter { !$0.isEmpty }.joined(separator: " · ")
        return [make(c, .cycle, label, t, extra: extra, upTo: upTo)]
    }

    /// The cycle of `level` running at the shown moment, as a depth chip "ζ 6" shows it (its start).
    private static func runningCycle(_ c: Context, _ level: Int) -> JumpCandidate? {
        guard c.clock.inRange(c.now), let cur = c.clock.level(at: c.now, level) else { return nil }
        let label = "The running \(levelWord(level)) (depth \(level + 1))"
        let extra = [c.notation.cycleName(level: level, cycle: cur.cycle), lastsText(c, level)].filter { !$0.isEmpty }.joined(separator: " · ")
        return make(c, .cycle, label, PureDates.landPoint(c.clock, level, cur.cycle, 0), extra: extra, upTo: Notation.resolutionOf(level))
    }

    // MARK: - Latin shorthand and dotted addresses: a6 b4 g9 · 6.4.9

    private static let addressRE = JSRegex("^[a-z]\\d|^\\d+(?:\\.\\d+)+$")

    static func address(_ c: Context) -> [JumpCandidate]? {
        guard addressRE.test(c.lower), let tok = JumpParser.tokenizePath(c.lower) else { return nil }
        for i in tok.levels.indices.dropFirst() where tok.levels[i] != tok.levels[i - 1] + 1 {
            return [.error("Write the periods from the longest to the shortest, without gaps", "e.g. a6 b4 g9 · α#6 β#4 γ#9")]
        }
        if tok.levels.last! > 4 {
            return [.error("Below the Nuclide a moment is counted, not numbered", "e.g. α#6 β#4 γ#9 δ#3 ε#5 34η 29ι")]
        }
        var parts = zip(tok.levels, tok.nums).map { PureDates.Part(id: ordinalIDs[$0]!, n: $1) }
        if let point = tok.point {
            let q = quarterOf(point)
            if q < 0 && point != "begin" { return [.error("\"\(point)\": a date takes a quarter word (Peak, Node, Valley, End)")] }
            if q >= 0 {
                if !PureDates.isMajor(parts[parts.count - 1].id) {
                    return [.error("A quarter word belongs to a major period (Alpha, Beta, Gamma, Delta)")]
                }
                parts[parts.count - 1].quarter = q
            }
        }
        return stamp(c, parts)
    }

    // MARK: - Sync and position

    private static let syncRE = JSRegex("^(?:sync|solar(?:\\s*sync)?|s)\\s*#?\\s*(-?\\d+)(?:\\s+(\(pointWords)))?$")

    static func sync(_ c: Context) -> [JumpCandidate]? {
        guard let m = syncRE.exec(c.lower) else { return nil }
        let n = jsNumber(m[1])
        let clock = c.clock
        guard abs(n) <= 9_007_199_254_740_991, let s = clock.solarSync(number: Int(n)) else {
            let r = JumpMaths.syncRange(clock)
            return [.error("Solar sync \(JumpMaths.clip(m[1]!, 24)) is not inside the catalogue", "Syncs \(r.first) … \(r.last)")]
        }
        let pid = JumpParser.pointID(m[2] ?? "begin")
        let phase = pid == "begin" ? 0 : JumpParser.phaseOfPoint(pid)
        let t = s.start + phase * (s.end - s.start)
        let place = pid == "begin" ? "start" : JumpParser.pointLabel(pid)
        let extra = "drift \(c.notation.driftText(start: s.start, nominalStart: s.nominalStart, drift: s.drift))"
        return [make(c, .sync, "Solar sync \(Int(n)) · \(place)", pid == "begin" ? PureDates.landCycleAt(clock, t, 6) : JumpMaths.ceilMs(t),
                     extra: extra, upTo: "iota")]
    }

    static func position(_ c: Context) -> [JumpCandidate]? {
        guard let (k, frac) = JumpParser.positionParts(c.lower) else { return nil }
        let clock = c.clock
        let f = jsNumber(frac)
        let extent = Double(clock.extent)
        if k > extent || (k == extent && f > 0) {
            return [.error("Position must be between 0 and \(clock.extent)",
                           "The catalogue holds \(clock.extent) Saros intervals (\(c.notation.catalogueText()))")]
        }
        let i = Int(k)
        let t = k == extent ? clock.tMax : clock.catalogue[i] + f * (clock.catalogue[i + 1] - clock.catalogue[i])
        return [make(c, .position, "Saros position \(i)\(f != 0 ? frac.jsSlice(1) : "")", JumpMaths.r3(t),
                     extra: "eclipse \(Notation.eclipseName(i)) + \(frac)", upTo: "iota")]
    }

    // MARK: - Boundaries: next ε, prev η, next Helion, next Delta node

    private static let barePointRE = JSRegex("^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(\(pointWords))$")
    private static let boundaryRE = JSRegex("^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(?:(\(pointWords))\\s*(?:of\\s*)?)?(\(depthAlt)|\(greekAlt)|[a-z])\(end)\\s*(?:(\(pointWords)))?$")

    static func boundary(_ c: Context) -> [JumpCandidate]? {
        if let bare = barePointRE.exec(c.lower) {
            guard let level = c.level else {
                return [.error("\"\(JumpMaths.clip(c.text))\" needs a level", "Name it: next peak η · next Delta node · next end of ε")]
            }
            let dir = bare[1] == "next" || bare[1] == "after" ? 1 : -1
            return boundaryCandidates(c, level, dir, JumpParser.countOf(bare[2]), JumpParser.pointID(bare[3]!))
        }
        guard let m = boundaryRE.exec(c.lower) else { return nil }
        let level = levelOfDepthToken(m[4]!)
        if level == -2 { return [.error("Depth must be between 1 and 14")] }
        if level < 0 { return nil }
        let dir = m[1] == "next" || m[1] == "after" ? 1 : -1
        let word = m[3] ?? m[5]
        return boundaryCandidates(c, level, dir, JumpParser.countOf(m[2]), word.map(JumpParser.pointID) ?? "end")
    }

    private static func boundaryCandidates(_ c: Context, _ level: Int, _ dir: Int, _ count: Int, _ pid: String) -> [JumpCandidate] {
        let clock = c.clock, notation = c.notation
        guard clock.inRange(c.now) else {
            return [.error("The shown moment is outside the catalogue, so there is no next or previous cycle", outsideNote(c))]
        }
        let phase = pid == "end" ? 1 : pid == "begin" ? 0 : JumpParser.phaseOfPoint(pid)
        let events = JumpParser.eventsAround(clock, c.now, level, dir, count, phase)
        let what = pid == "end" || pid == "begin" ? "boundary" : JumpParser.pointLabel(pid)
        let label = "\(dir > 0 ? "Next" : "Previous")\(count > 1 ? " " + JumpMaths.ordinal(count) : "") \(levelWord(level)) \(what)"
        guard events.count >= count, let last = events.last else {
            return [.error("\(label): \(dir > 0 ? "the catalogue ends before it" : "it would be before the catalogue starts")")]
        }
        let total = Int64(clock.count(level))
        // the first millisecond that shows it
        let t = PureDates.landPoint(clock, level, last.idx, phase == 1 ? 0 : phase)
        // inside the shown Nuclide a minor cycle is named by its counts alone ("34η"), across one by its Nuclide too
        let nuclide = clock.level(at: c.now, 4)?.cycle
        let nameOf = { (idx: Int64) -> String in
            if level < 4 { return notation.cycleName(level: level, cycle: idx) }
            if level == 4 {
                let d = idx / 5
                return d == clock.level(at: c.now, 3)?.cycle
                    ? notation.cycleName(level: 4, cycle: idx)
                    : "\(notation.cycleName(level: 4, cycle: idx)) of \(notation.cycleName(level: 3, cycle: d))"
            }
            let start = clock.cycleStartTime(level: level, index: idx)
            let same = start != nil && clock.level(at: clock.clamp(start! + 1e-3), 4)?.cycle == nuclide
            return notation.cycleName(level: level, cycle: idx, short: same)
        }
        let extra: String
        if phase == 0 || phase == 1 {
            let ends = last.idx >= 1 && last.idx <= total ? "\(nameOf(last.idx - 1)) ends" : ""
            let begins = last.idx < total ? "\(nameOf(last.idx)) begins" : "the catalogue ends"
            extra = [ends, begins].filter { !$0.isEmpty }.joined(separator: " → ")
        } else if level <= 3 {
            // a threshold of a major period ends one quarter and begins the next
            let k = Int(JSNumber.round(phase * 4))
            extra = last.idx < total
                ? "\(notation.cycleName(level: level, cycle: last.idx)) \(Notation.quarterWords[k - 1]) ends → \(Notation.quarterWords[k]) begins"
                : ""
        } else {
            extra = last.idx < total ? "\(what) of \(nameOf(last.idx))" : ""
        }
        return [make(c, .boundary, label, t, extra: extra, upTo: Notation.resolutionOf(level))]
    }

    private static let levelOnlyRE = JSRegex("^(\(greekAlt))$")

    /// A lone depth letter, level name or unit name ("ε", "Helion", "Delta"): its next and previous boundary.
    static func levelOnly(_ c: Context) -> [JumpCandidate]? {
        guard let m = levelOnlyRE.exec(c.lower) else { return nil }
        let level = levelOfUnitToken(m[1]!)
        if level < 0 { return nil }
        return boundaryCandidates(c, level, 1, 1, "end") + boundaryCandidates(c, level, -1, 1, "end")
    }
}
