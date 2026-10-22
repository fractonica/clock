import Foundation

/// The Earth jump box: anything a person might type turned into ranked candidate instants. A port of `parseJump`
/// (src/ui/calendar/parse.js); golden tests replay the JavaScript over hundreds of inputs.
///
///     dates / times  2031-06-01 · 2031-06-01 14:30:15 · 1 Jun 2031 2pm · 2031-06-01T14:30Z · Thu 8 Oct 2026, 12:00:00
///                    2031-06-01 14:30 Moscow (a zone or city after the time) · 06/01/2031 (day/month or month/day)
///     unix           1791460800 · unix 1791460800 · 1791460800000 (ms)
///     relative       now · today · tomorrow 9:00 · +3d · -2h30m · in 2 weeks · 3 days ago · +1y
///     position       pos 22.9278 · p22.9278 · saros 22.9 · 22 + 0.9278
///     cycles         α#6 β#3 γ#11 · α6 β3 γ11 · a6 b3 g11 · 6.3.11 · ε#5 (ancestors from the displayed time) · d7#717211
///     sync           sync 4820 · S4820 node
///     boundaries     next ε · prev ζ · next end of δ · next peak η · next peak (the selected level) · next 3 ε
///     odometer       d7 13,0 · η [13,0]
///
/// "ε#5" is the 5th ε inside its parent; a bare "ε 5" is the depth chip of the other screens, so it is offered both
/// ways. Candidates come best first; errors only when nothing parsed.
public enum JumpParser {
    /// Longest input the box reads; longer pastes are answered at once.
    public static let maxInput = GregorianParser.maxInput

    /// The placeholder of the Earth box.
    public static let placeholder = "2031-06-01 · +3d · α#6 β#3 γ#11 · pos 24.5 · sync 4820"

    /// The forms the generic "Cannot read" answer suggests ("Try …. ").
    public static let help = "2031-06-01 14:30 · +3d · α#6 β#3 γ#11 · pos 24.5 · sync 4820 · next ε"

    /// Examples offered while the box is empty: the text and what it means. The slash date follows the locale.
    public static func examples(dayFirst: Bool?) -> [(text: String, meaning: String)] {
        [
            ("2031-06-01 14:30", "a date and time in the app zone"),
            ("2031-06-01 14:30 Tokyo", "the same in another zone (a city, an IANA name or +09:00)"),
            (dayFirst == false ? "06/01/2031" : "01/06/2031",
             dayFirst == false ? "slashes read month/day here: 1 Jun 2031 (day/month is the second choice)"
                 : "slashes read day/month here: 1 Jun 2031 (month/day is the second choice)"),
            ("+3d", "three days after the displayed time"),
            ("next ε", "the next epsilon boundary"),
            ("α#6 β#3 γ#11", "start of a cycle by its address (#6 = the 6th inside its parent)"),
            ("pos 24.5", "Saros position"),
            ("sync 4820", "start of a solar sync"),
            ("d7 13,0", "next time depth 7 shows [13, 0]"),
        ]
    }

    /// Does the device's locale write the day before the month in 06/01/2031? (nil when unknown)
    public static func dayFirst(locale: Locale = .current) -> Bool? { GregorianParser.dayFirst(locale: locale) }

    /// Does the text name a time zone or a city? (The pure box uses it to recognise Earth input it does not take.)
    public static func mentionsZone(_ text: String) -> Bool { GregorianParser.mentionsZone(text) }

    /// Reads `text` at the context's displayed time: the candidates best first, the errors only when nothing parsed,
    /// [] for blank text.
    public static func parse(_ text: String, _ context: JumpContext, clock: FractonicaClock = .shared) -> [JumpCandidate] {
        if text.jsLength > maxInput && text.jsTrim.jsLength > maxInput {
            return [.error("That is \(text.jsTrim.jsLength) characters: the jump box reads up to \(maxInput)",
                           "Paste a date, a Unix time, an offset or a cycle address")]
        }
        let raw = GregorianParser.normalize(text)
        if raw.isEmpty { return [] }
        let zone = TimeZone(identifier: context.zone) != nil ? context.zone : EarthTime.systemZone
        let now = JumpMaths.r3(context.now.isFinite ? context.now : 0)
        let level = context.level.flatMap { (0..<14).contains($0) ? $0 : nil }
        let c = Context(clock: clock, formatter: EarthFormatter(zone: zone), zone: zone, now: now,
                        real: JumpMaths.r3(context.real.isFinite ? context.real : now), text: raw, lower: raw.jsLower,
                        dayFirst: context.dayFirst, level: level)
        var good: [JumpCandidate] = []
        var bad: [JumpCandidate] = []
        for recognize in recognizers {
            guard let items = recognize(c) else { continue }
            for item in items {
                if item.kind == .error { bad.append(item) } else { good.append(item) }
            }
        }
        if !good.isEmpty {
            // the same instant by two routes is one candidate
            var seen = Set<String>()
            return good.filter { seen.insert("\($0.kind.rawValue)|\($0.time.map(JSNumber.string) ?? "null")").inserted }
        }
        if !bad.isEmpty { return bad }
        return [.error(
            "Cannot read \"\(JumpMaths.clip(raw))\"",
            "Try \(help). A time without an offset is read in \(zone.replacingOccurrences(of: "_", with: " ")): add a city or zone (14:30 Tokyo), an offset (+03:00), or change the zone in the header."
        )]
    }

    // MARK: - Context

    struct Context {
        let clock: FractonicaClock
        let formatter: EarthFormatter
        let zone: String
        let now: Double
        let real: Double
        let text: String
        let lower: String
        let dayFirst: Bool?
        let level: Int?
    }

    private static let recognizers: [@Sendable (Context) -> [JumpCandidate]?] = [
        keyword, relative, state, global, path, sync, position, boundary, levelOnly, gregorian, unix,
    ]

    /// A candidate, or an error when the instant is outside the catalogue.
    static func make(_ c: Context, _ kind: JumpCandidate.Kind, _ label: String, _ t: Double, extra: String = "",
                     date: Bool = true) -> JumpCandidate {
        if let problem = JumpMaths.rangeProblem(c.clock, t) {
            return .error("\(label) is \(problem)", "Catalogue: \(JumpMaths.catalogueRangeText(c.clock)) (UTC)")
        }
        let detail = [JumpMaths.describeTime(c.clock, c.formatter, t, ref: c.now, date: date), extra]
            .filter { !$0.isEmpty }.joined(separator: " · ")
        return JumpCandidate(kind: kind, label: label, time: t, detail: detail, note: extra)
    }

    private static func refDate(_ c: Context) -> (year: Int, month: Int, day: Int) {
        let p = EarthTime.zonedParts(c.now, zone: JumpMaths.timeZone(c.zone))
        return (p.year, p.month, p.day)
    }

    // MARK: - Tokens

    static let levelWords = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu", "nu", "xi"]
    private static let latin: [String: Int] = ["a": 0, "b": 1, "g": 2, "d": 3, "e": 4, "z": 5, "h": 6, "t": 7, "th": 7, "i": 8, "k": 9, "l": 10, "m": 11, "n": 12, "x": 13]
    static let levelAlt = "alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|th|[α-ξ]|[a-z]"
    static let depthAlt = "(?:depth|d)\\s*\\d{1,2}"
    static let pointWords = "begin|start|peak|node|valley|end|mid|middle"
    private static let greekWordAlt = "alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|[α-ξ]"

    /// Zero-based level of a Greek letter, English name or Latin shorthand; −1 if unknown.
    static func levelOfToken(_ token: String) -> Int {
        let t = token.jsLower
        if let w = levelWords.firstIndex(of: t) { return w }
        if t.jsLength == 1, let i = JumpMaths.letters.firstIndex(of: t) { return i }
        return latin[t] ?? -1
    }

    private static let depthToken = JSRegex("^(?:depth|d)\\s*(\\d{1,2})$")

    /// Level of "d7" / "depth 7" (depth form, 1-based; −2 outside 1 … 14) or of a level token.
    static func levelOfDepthToken(_ token: String) -> Int {
        if let m = depthToken.exec(token) {
            let d = Int(m[1]!)!
            return d >= 1 && d <= 14 ? d - 1 : -2
        }
        return levelOfToken(token)
    }

    static func pointID(_ w: String) -> String {
        w == "start" || w == "begin" ? "begin" : w == "mid" || w == "middle" ? "node" : w
    }

    static func phaseOfPoint(_ id: String) -> Double { JumpMaths.points.first { $0.id == id }?.phase ?? 0 }

    static func pointLabel(_ id: String) -> String { JumpMaths.points.first { $0.id == id }?.label.lowercased() ?? id }

    /// `Math.max(1, Math.min(500, Number(text)))` for a count in "next 3 ε".
    static func countOf(_ text: String?) -> Int {
        guard truthy(text) else { return 1 }
        let n = jsNumber(text)
        return n.isNaN ? 1 : Int(max(1, min(500, n)))
    }

    // MARK: - Keywords: now, today, tomorrow, yesterday

    private static let keywordRE = JSRegex("^(now|today|tomorrow|tmrw|yesterday)(?:\\s+(.+))?$")

    static func keyword(_ c: Context) -> [JumpCandidate]? {
        guard let m = keywordRE.exec(c.lower) else { return nil }
        let word = m[1]!
        if word == "now" {
            if m[2] != nil { return nil }
            var candidate = make(c, .relative, "Now (device clock)", c.real)
            if candidate.kind != .error { candidate.live = true }
            return [candidate]
        }
        let ref0 = refDate(c)
        let shift = word == "yesterday" ? -1 : word == "today" ? 0 : 1
        let day = JumpMaths.addDays(ref0.year, ref0.month, ref0.day, shift)
        let capitalized = word.prefix(1).uppercased() + word.dropFirst()
        let t: Double
        let label: String
        if let rest = m[2] {
            switch GregorianParser.parse(rest, zone: c.zone, ref: day) {
            case nil:
                return [.error("Cannot read the time \"\(JumpMaths.clip(rest))\" after \"\(word)\"", "Try 14:30, 2pm or noon")]
            case .error(let message)?:
                return [.error(message)]
            case .results(let results)?:
                if results[0].precision != "time" {
                    return [.error("After \"\(word)\" write only a time of day, e.g. \(word) 14:30")]
                }
                t = results[0].t
                label = "\(capitalized) \(JumpMaths.clip(rest))"
            }
        } else {
            t = JumpMaths.dayStart(c.zone, day.year, day.month, day.day)
            label = "\(capitalized) (start of the day)"
        }
        return [make(c, .relative, label, t)]
    }

    // MARK: - Offsets: +3d, -2h30m, in 2 weeks, 3 days ago

    private static let inRE = JSRegex("^in\\s+(.+)$")
    private static let agoRE = JSRegex("^(.+?)\\s+(?:ago|before)$")
    private static let laterRE = JSRegex("^(.+?)\\s+(?:later|from now|after|ahead|hence)$")
    private static let leadRE = JSRegex("^([+-])\\s*(.+)$")
    private static let bareNumberRE = JSRegex("^\\d+(?:\\.\\d+)?$")
    private static let termRE = JSRegex("\\s*(\\d+(?:\\.\\d+)?)\\s*([a-z]+)\\s*(?:,|and)?")
    private static let wholeRE = JSRegex("^\\d+$")
    private static let unitAliases: [(Set<String>, String)] = [
        (["ms", "msec", "msecs", "millisecond", "milliseconds"], "ms"),
        (["s", "sec", "secs", "second", "seconds"], "s"),
        (["m", "min", "mins", "minute", "minutes"], "min"),
        (["h", "hr", "hrs", "hour", "hours"], "h"),
        (["d", "day", "days"], "d"),
        (["w", "wk", "wks", "week", "weeks"], "w"),
        (["mo", "mos", "mon", "month", "months"], "mo"),
        (["y", "yr", "yrs", "year", "years"], "y"),
    ]
    private static let unitText = ["ms": "ms", "s": "s", "min": "min", "h": "h", "d": "d", "w": "wk", "mo": "mo", "y": "y"]

    static func relative(_ c: Context) -> [JumpCandidate]? {
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
        guard let sign else { return nil }
        if bareNumberRE.test(s) {
            // "+3" / "-5": a unit is missing; long digit strings are Unix seconds, left to the unix recognizer
            if s.replacingFirst(".", with: "").jsLength > 5 { return nil }
            return [.error("Add a unit to the offset", "e.g. +3d, +90min, -2h30m, in 2 weeks, 5 days ago")]
        }
        var comps: [String: Double] = ["y": 0, "mo": 0, "w": 0, "d": 0, "h": 0, "min": 0, "s": 0, "ms": 0]
        var used = 0
        var shown: [String] = []
        while true {
            guard let p = termRE.sticky(s, at: used) else { break }
            guard let unit = unitAliases.first(where: { $0.0.contains(p[2]!) })?.1 else { return nil }
            if (unit == "y" || unit == "mo") && !wholeRE.test(p[1]!) {
                return [.error("Years and months must be whole numbers", "use +18mo or +1.5d instead of +1.5y")]
            }
            comps[unit, default: 0] += jsNumber(p[1])
            shown.append("\(p[1]!) \(unitText[unit]!)")
            used = p.end
            if used >= s.jsLength { break }
        }
        if shown.isEmpty || used < s.jsTrimEnd.jsLength { return nil }

        let label = "\(sign < 0 ? "−" : "+")\(JumpMaths.clip(shown.joined(separator: " "), 32)) from the displayed time"
        let dd = sign * (comps["d"]! + comps["w"]! * 7)
        let secs = sign * (comps["h"]! * 3600 + comps["min"]! * 60 + comps["s"]! + comps["ms"]! / 1000)
        let tooFar = {
            [JumpCandidate.error("\(label) is \(JumpMaths.rangeProblem(c.clock, sign < 0 ? -.infinity : .infinity) ?? "")",
                                 "Catalogue: \(JumpMaths.catalogueRangeText(c.clock)) (UTC)")]
        }
        if ![dd, secs, comps["mo"]!, comps["y"]!].allSatisfy(\.isFinite) || abs(dd) > 4e6 { return tooFar() }
        let p = EarthTime.zonedParts(c.now, zone: JumpMaths.timeZone(c.zone))
        var mo = Double(p.month - 1) + sign * comps["mo"]! + 12 * sign * comps["y"]!
        let year = Double(p.year) + (mo / 12).rounded(.down)
        mo = (mo.truncatingRemainder(dividingBy: 12) + 12).truncatingRemainder(dividingBy: 12)
        if year < 1000 || year > 9999 { return tooFar() }
        let y = Int(year), m = Int(mo)
        let day = min(p.day, EarthTime.daysInMonth(y, m + 1))
        let whole = dd.rounded(.towardZero)
        let civ = JumpMaths.addDays(y, m + 1, day, Int(whole))
        if civ.year < 1000 || civ.year > 9999 { return tooFar() }
        var t = JumpMaths.localToUnix(EarthTime.CivilTime(year: civ.year, month: civ.month, day: civ.day, hour: p.hour,
                                                          minute: p.minute, second: p.second, ms: p.ms), c.zone)
        t += (dd - whole) * 86_400 + secs
        t = JumpMaths.r3(t)
        return [make(c, .relative, label, t)]
    }

    // MARK: - Odometer states: d7 13,0 · η [13,0]

    private static let stateRE = JSRegex("^(?:(next|prev|previous)\\s+)?(\(depthAlt)|\(greekWordAlt))\\s*(.+)$")
    private static let bracketRE = JSRegex("^[[(]\\s*(.*?)\\s*[\\])]$")
    private static let digitsRE = JSRegex("^\\d{1,3}(?:\\s*[,;\\s]\\s*\\d{1,3})*\\s*,?$")
    private static let digitSplitRE = JSRegex("[,;\\s]+")
    private static let depthFormRE = JSRegex("^\(depthAlt)$")

    static func state(_ c: Context) -> [JumpCandidate]? {
        guard let m = stateRE.exec(c.lower) else { return nil }
        let bracket = bracketRE.exec(m[3]!)
        let body = bracket?[1] ?? m[3]!
        guard digitsRE.test(body) else { return nil }
        let digits = digitSplitRE.split(body).filter { !$0.isEmpty }.map { Int($0)! }
        let depthForm = depthFormRE.test(m[2]!)
        if bracket == nil && !body.contains(",") && !(depthForm && digits.count >= 2) { return nil }
        let direction0 = m[1] == nil ? 1 : (m[1] == "next" ? 1 : -1)
        let level = levelOfDepthToken(m[2]!)
        if level == -2 { return [.error("Depth must be between 1 and 14")] }
        if level < 0 { return nil }
        let clock = c.clock
        let tc = clock.clamp(c.now)
        let names = "[\(digits.map(String.init).joined(separator: ", "))]"
        for d in digits where d > 15 {
            return [.error("Digit \(d) is too large: two-stroke glyphs have 16 states, numbered 0–15")]
        }
        var out: [JumpCandidate] = []
        for direction in direction0 >= 0 ? [1, -1] : [-1, 1] {
            let occurrences = clock.stateOccurrences(level: level, digits: digits, around: tc, direction: direction, count: 1)
            let label = "\(direction > 0 ? "Next" : "Previous") time depth \(level + 1) (\(JumpMaths.letter(level))) shows \(names)"
            guard let o = occurrences.first else {
                out.append(.error("\(label): none inside the catalogue"))
                continue
            }
            let shows = { (t: Double) in clock.odometer(at: t, level, digits: digits.count)?.digits == digits }
            out.append(make(c, .state, label, JumpMaths.landOn(clock, o.start, want: shows),
                            extra: "lasts \(EarthTime.duration(o.end - o.start))"))
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
            return [.error("\(JumpMaths.levelName(level)) has only \(count) cycles in the catalogue (d\(level + 1)#0 … d\(level + 1)#\(count - 1))",
                           "The number after the # is the 0-based index counted over the whole catalogue")]
        }
        let pid = pointID(m[3] ?? "begin")
        guard let t = JumpMaths.pointOfCycle(clock, level, Double(idx), phaseOfPoint(pid)) else {
            return [.error("The \(pointLabel(pid)) of this \(JumpMaths.letter(level)) cycle lies beyond the end of the catalogue")]
        }
        let path = clock.cycleToPath(level: level, cycle: Int64(idx))
        let label = "\(JumpMaths.letter(level)) global index \(idx) · \(JumpMaths.pathText(path))\(pid == "begin" ? "" : " · " + pointLabel(pid))"
        let facts = clock.cycle(level: level, index: Int64(idx))!
        return [make(c, .cycle, label, JumpMaths.landOn(clock, t, level: pid == "begin" ? level : nil),
                     extra: "\(JumpMaths.letter(level)) lasts \(EarthTime.duration(facts.duration))\(facts.clipped ? " (clipped by the catalogue end)" : "")")]
    }

    // MARK: - Addresses: α#6 β#3 γ#11 · α6 β3 γ11 · a6 b3 g11 · 6.3.11 · ε#5

    /// A tokenised address: levels and numbers, the point word, whether a # was written, and whether it is one
    /// spaced "letter number" pair ("ζ 6", the text of a depth chip).
    struct PathTokens {
        var levels: [Int]
        var nums: [Double]
        var point: String?
        var hashed: Bool
        var spaced: Bool
    }

    private static let separatorsRE = JSRegex("[›»>·|,]")
    private static let dotBeforeLetterRE = JSRegex("(\\d)\\s*\\.\\s*(?=[a-zα-ξ#])")
    private static let blanksRE = JSRegex("\\s+")
    private static let chainSeparatorsRE = JSRegex("[›»>·|]")
    private static let dottedRE = JSRegex("^\\d{1,3}(?:\\s*\\.\\s*\\d{1,3})+$")
    private static let dotSplitRE = JSRegex("\\s*\\.\\s*")
    private static let entryRE = JSRegex("(\\s*)(\(levelAlt))(\\s*)(#?)(\\s*)(\\d+)")
    private static let tailRE = JSRegex("^@?\\s*(\(pointWords))$")
    private static let atRE = JSRegex("^@\\s*")

    static func tokenizePath(_ lower: String) -> PathTokens? {
        var body = separatorsRE.replaceAll(lower, " ")
        body = dotBeforeLetterRE.replaceAll(body, "$1 ")
        body = blanksRE.replaceAll(body, " ").jsTrim
        let dotted = chainSeparatorsRE.replaceAll(lower, ".")
        if dottedRE.test(dotted) {
            let nums = dotSplitRE.split(dotted).map(jsNumber)
            return PathTokens(levels: Array(0..<nums.count), nums: nums, point: nil, hashed: false, spaced: false)
        }
        var levels: [Int] = []
        var nums: [Double] = []
        var hashed = false, spaced = false
        var pos = 0
        while pos < body.jsLength {
            guard let m = entryRE.sticky(body, at: pos) else { break }
            let lv = levelOfToken(m[2]!)
            if lv < 0 { return nil }
            levels.append(lv)
            nums.append(jsNumber(m[6]))
            if truthy(m[4]) { hashed = true } else if truthy(m[3]) || truthy(m[5]) { spaced = true }
            pos = m.end
        }
        if levels.isEmpty { return nil }
        let tail = body.jsSlice(pos).jsTrim
        if !tail.isEmpty && !tailRE.test(tail) { return nil }
        return PathTokens(levels: levels, nums: nums, point: tail.isEmpty ? nil : pointID(atRE.replaceAll(tail, "")),
                          hashed: hashed, spaced: levels.count == 1 && spaced && !hashed)
    }

    private static func pathCandidates(_ c: Context, _ tok: PathTokens) -> [JumpCandidate] {
        let clock = c.clock
        let levels = tok.levels, nums = tok.nums
        let first = levels[0]
        for i in levels.indices.dropFirst() where levels[i] != levels[i - 1] + 1 {
            if levels[i] > levels[i - 1] {
                return [.error("\(JumpMaths.levelName(levels[i - 1] + 1)) is missing between \(JumpMaths.levelName(levels[i - 1])) and \(JumpMaths.levelName(levels[i]))",
                               "Write consecutive levels, e.g. α#6 β#3 γ#11")]
            }
            return [.error("Write the levels from the longest to the shortest, e.g. α#6 β#3 γ#11")]
        }
        // ancestors from the displayed time when the address starts below alpha
        var prefix: [Int] = []
        if first > 0 {
            guard clock.inRange(c.now), let p = JumpMaths.pathOfTime(clock, c.now, first) else {
                return [.error("The displayed time is outside the catalogue, so the enclosing cycles are unknown",
                               "Start the address with α, e.g. α#6 β#3")]
            }
            prefix = p
        }
        var path = prefix
        for (i, n) in nums.enumerated() {
            let level = first + i
            if n < 1 { return [.error("\(JumpMaths.levelName(level)) numbers start at 1")] }
            if level == 0 {
                let count = Int(clock.count(0))
                if n > Double(count) {
                    return [.error("The catalogue holds only \(count) Alpha cycles (\(JumpMaths.cycleLabel(0, 1)) … \(JumpMaths.cycleLabel(0, count)))",
                                   JumpMaths.catalogueRangeText(clock) + " UTC")]
                }
            } else {
                let siblings = clock.levelInfo(level).siblings ?? 0
                let parent = JumpMaths.levelName(level - 1)
                if n > Double(siblings) {
                    // a Greek letter before a hash is the ordinal; the global index has its own spelling
                    let hint = tok.hashed ? " · for a global cycle index write d\(level + 1)#\(JumpMaths.num(n))" : ""
                    return [.error("\(JumpMaths.levelName(level)) has only \(siblings) cycles in \(JumpMaths.an(parent)) \(parent)",
                                   "\(JumpMaths.cycleLabel(level, 1)) … \(JumpMaths.cycleLabel(level, siblings))\(hint)")]
                }
            }
            path.append(Int(n))
            if clock.pathToCycle(path) == nil {
                let maxHere = JumpMaths.childCount(clock, Array(path.dropLast()))
                return [.error("\(JumpMaths.pathText(path)) starts after the catalogue ends (\(JumpMaths.utcDate(clock.tMax)))",
                               maxHere != 0 ? "\(JumpMaths.levelName(level)) goes up to \(maxHere) here, the last cycles are clipped" : "")]
            }
        }
        let level = path.count - 1
        guard let cycle = JumpMaths.cycleOfPath(clock, path) else { return [] }
        let pid = tok.point ?? "begin"
        guard let t = JumpMaths.pointOfCycle(clock, level, Double(cycle.idx), phaseOfPoint(pid)) else {
            return [.error("The \(pointLabel(pid)) of \(JumpMaths.pathText(path)) lies beyond the end of the catalogue",
                           "The last cycle is clipped by the catalogue end")]
        }
        // what the text was taken to mean, in words, whenever the displayed time supplies the missing ancestors
        let chain = JumpMaths.chainText(Array(path[first...]), from: first)
        var label = chain
        if !prefix.isEmpty {
            let parent = JumpMaths.letter(first - 1)
            label = nums.count == 1
                ? "The \(JumpMaths.ordinal(Int(nums[0]))) \(JumpMaths.letter(first)) in the current \(parent)"
                : "\(chain) in the current \(parent)"
        }
        if pid != "begin" { label += " · " + pointLabel(pid) }
        let lasts = "\(JumpMaths.letter(level)) lasts \(EarthTime.duration(cycle.facts.duration))\(cycle.facts.clipped ? " (clipped by the catalogue end)" : "")"
        let extra = !prefix.isEmpty && nums.count == 1 ? "\(chain) · \(lasts)" : lasts
        return [make(c, .cycle, label, JumpMaths.landOn(clock, t, level: pid == "begin" ? level : nil), extra: extra)]
    }

    /// The cycle of `level` running at the displayed time, as a depth chip "ζ 6" shows it (its start).
    private static func runningCycle(_ c: Context, _ level: Int) -> JumpCandidate? {
        guard c.clock.inRange(c.now), let cur = c.clock.level(at: c.now, level) else { return nil }
        let letter = JumpMaths.letter(level)
        let parent = level > 0 ? " in its \(JumpMaths.letter(level - 1))" : ""
        let label = "The running \(letter) (depth \(level + 1))"
        let extra = "\(JumpMaths.cycleLabel(level, cur.local + 1)) · \(cur.local + 1) / \(cur.siblings)\(parent) · \(letter) lasts \(EarthTime.duration(cur.duration))"
        return make(c, .cycle, label, JumpMaths.landOn(c.clock, cur.start, level: level), extra: extra)
    }

    static func path(_ c: Context) -> [JumpCandidate]? {
        guard let tok = tokenizePath(c.lower) else { return nil }
        var out = pathCandidates(c, tok)
        // "ζ 6" is also what the ladder prints for the ζ running now (ζ is depth 6): offer that reading second
        if tok.spaced && tok.nums[0] == Double(tok.levels[0] + 1), let running = runningCycle(c, tok.levels[0]) {
            out.append(running)
        }
        return out
    }

    // MARK: - Solar sync: sync 4820 · S4820 node

    private static let syncRE = JSRegex("^(?:sync|solar(?:\\s*sync)?|s)\\s*#?\\s*(-?\\d+)(?:\\s+(\(pointWords)))?$")

    static func sync(_ c: Context) -> [JumpCandidate]? {
        guard let m = syncRE.exec(c.lower) else { return nil }
        let n = jsNumber(m[1])
        let clock = c.clock
        guard abs(n) <= 9_007_199_254_740_991, let s = clock.solarSync(number: Int(n)) else {
            let r = JumpMaths.syncRange(clock)
            return [.error("Solar sync \(JumpMaths.clip(m[1]!, 24)) is not inside the catalogue", "Syncs \(r.first) … \(r.last)")]
        }
        let pid = pointID(m[2] ?? "begin")
        let phase = pid == "begin" ? 0 : phaseOfPoint(pid)
        let t = s.start + phase * (s.end - s.start)
        let place = pid == "begin" ? "start" : pointLabel(pid)
        let extra = "drift \(s.drift < 0 ? "−" : "+")\(EarthTime.duration(abs(s.drift))) vs the civil grid"
        return [make(c, .sync, "Solar sync \(Int(n)) · \(place)", pid == "begin" ? JumpMaths.landOn(clock, t, level: 6) : JumpMaths.landOn(clock, t),
                     extra: extra)]
    }

    // MARK: - Position: pos 22.9278 · p22.9278 · saros 22.9 · 22 + 0.9278

    private static let positionRE = JSRegex("^(?:pos(?:ition)?|saros|p)\\s*[:=]?\\s*(\\d+)(?:[.,](\\d*))?$")
    private static let positionSumRE = JSRegex("^(\\d+)\\s*\\+\\s*(0?\\.\\d+)$")
    private static let positionDecimalRE = JSRegex("^(\\d+)\\.(\\d{4,})$")

    /// The ordinal and fraction text of a position input, or nil when the text is not one.
    static func positionParts(_ lower: String) -> (k: Double, frac: String)? {
        if let m = positionRE.exec(lower) { return (jsNumber(m[1]), truthy(m[2]) ? "0." + m[2]! : "0") }
        if let m = positionSumRE.exec(lower) { return (jsNumber(m[1]), m[2]!.hasPrefix(".") ? "0" + m[2]! : m[2]!) }
        if let m = positionDecimalRE.exec(lower) { return (jsNumber(m[1]), "0." + m[2]!) }
        return nil
    }

    static func position(_ c: Context) -> [JumpCandidate]? {
        guard let (k, frac) = positionParts(c.lower) else { return nil }
        let clock = c.clock
        let f = jsNumber(frac)
        let extent = Double(clock.extent)
        if k > extent || (k == extent && f > 0) {
            return [.error("Position must be between 0 and \(clock.extent)",
                           "The catalogue holds \(clock.extent) Saros intervals (\(JumpMaths.catalogueRangeText(clock)))")]
        }
        let i = Int(k)
        let t = k == extent ? clock.tMax : clock.catalogue[i] + f * (clock.catalogue[i + 1] - clock.catalogue[i])
        return [make(c, .position, "Saros position \(i)\(f != 0 ? frac.jsSlice(1) : "")", JumpMaths.r3(t), extra: "eclipse #\(i) + \(frac)")]
    }

    // MARK: - Boundaries: next ε · prev ζ · next end of δ · next peak η

    /// Times at which cycles of `level` reach `phase` (0 = a boundary) after `now` (dir > 0) or before it; `count` of
    /// them, with the global index of the cycle each belongs to (parse.js `eventsAround`).
    static func eventsAround(_ clock: FractonicaClock, _ now: Double, _ level: Int, _ dir: Int, _ count: Int,
                             _ phase: Double) -> [(t: Double, idx: Int64)] {
        guard let cur = clock.level(at: clock.clamp(now), level) else { return [] }
        var out: [(t: Double, idx: Int64)] = []
        let total = Int64(clock.count(level))
        let ph = phase == 1 ? 0 : phase
        let bump: Int64 = phase == 1 ? 1 : 0
        if dir > 0 {
            var idx = max(0, cur.cycle - 1)
            while idx <= total && out.count < count {
                guard let t = JumpMaths.pointOfCycle(clock, level, Double(idx + bump), ph) else { break }
                if t > now { out.append((t, idx + bump)) }
                idx += 1
            }
        } else {
            var idx = min(total - 1, cur.cycle + 1)
            while idx >= 0 && out.count < count {
                if let t = JumpMaths.pointOfCycle(clock, level, Double(idx + bump), ph), t < now - 0.01 {
                    out.append((t, idx + bump))
                }
                idx -= 1
            }
        }
        return out
    }

    private static let barePointRE = JSRegex("^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(\(pointWords))$")
    private static let boundaryRE = JSRegex("^(next|prev|previous|last|after|before)\\s*(\\d+)?\\s*(?:(\(pointWords))\\s*(?:of\\s*)?)?(\(depthAlt)|\(greekWordAlt)|[a-z])\\s*(?:(\(pointWords)))?$")

    static func boundary(_ c: Context) -> [JumpCandidate]? {
        // "next peak" / "prev node" without a level: the selected level, else a hint
        if let bare = barePointRE.exec(c.lower) {
            guard let level = c.level else {
                return [.error("\"\(JumpMaths.clip(c.text))\" needs a level", "Name it: next peak η · next node ζ · next end of δ")]
            }
            let dir = bare[1] == "next" || bare[1] == "after" ? 1 : -1
            return boundaryCandidates(c, level, dir, countOf(bare[2]), pointID(bare[3]!))
        }
        guard let m = boundaryRE.exec(c.lower) else { return nil }
        let level = levelOfDepthToken(m[4]!)
        if level == -2 { return [.error("Depth must be between 1 and 14")] }
        if level < 0 { return nil }
        let dir = m[1] == "next" || m[1] == "after" ? 1 : -1
        let word = m[3] ?? m[5]
        return boundaryCandidates(c, level, dir, countOf(m[2]), word.map(pointID) ?? "end")
    }

    private static func boundaryCandidates(_ c: Context, _ level: Int, _ dir: Int, _ count: Int, _ pid: String) -> [JumpCandidate] {
        let clock = c.clock
        guard clock.inRange(c.now) else {
            return [.error("The displayed time is outside the catalogue, so there is no next or previous cycle",
                           "Catalogue: \(JumpMaths.catalogueRangeText(clock)) (UTC)")]
        }
        let phase = pid == "end" ? 1 : pid == "begin" ? 0 : phaseOfPoint(pid)
        let events = eventsAround(clock, c.now, level, dir, count, phase)
        let letter = JumpMaths.letter(level)
        let what = pid == "end" || pid == "begin" ? "boundary" : pointLabel(pid)
        let label = "\(dir > 0 ? "Next" : "Previous")\(count > 1 ? " " + JumpMaths.ordinal(count) : "") \(letter) \(what)"
        guard events.count >= count, let last = events.last else {
            return [.error("\(label): \(dir > 0 ? "the catalogue ends before it" : "it would be before the catalogue starts")")]
        }
        let isBoundary = phase == 0 || phase == 1
        // which cycles meet there, in the "ε#5" notation
        let total = Int64(clock.count(level))
        let ord = { (i: Int64) in JumpMaths.cycleLabel(level, clock.cycleToPath(level: level, cycle: i).last!) }
        let extra: String
        if isBoundary {
            let ends = last.idx >= 1 && last.idx <= total ? "\(ord(last.idx - 1)) ends" : ""
            let starts = last.idx < total ? "\(ord(last.idx)) starts" : "the catalogue ends"
            extra = [ends, starts].filter { !$0.isEmpty }.joined(separator: " · ")
        } else {
            extra = last.idx < total ? "in \(ord(last.idx))" : ""
        }
        return [make(c, .boundary, label, isBoundary ? JumpMaths.landOn(clock, last.t, level: level) : JumpMaths.landOn(clock, last.t),
                     extra: extra)]
    }

    private static let levelOnlyRE = JSRegex("^(\(greekWordAlt))$")

    /// A lone Greek letter or level name: its next and previous boundary.
    static func levelOnly(_ c: Context) -> [JumpCandidate]? {
        guard let m = levelOnlyRE.exec(c.lower) else { return nil }
        let level = levelOfToken(m[1]!)
        return boundaryCandidates(c, level, 1, 1, "end") + boundaryCandidates(c, level, -1, 1, "end")
    }

    // MARK: - Gregorian dates and times

    /// The first instant after the period (day, month, year) a date-like input names.
    private static func periodEnd(_ x: GregorianParser.Reading, _ zone: String) -> Double {
        let f = x.fields
        let next: (year: Int, month: Int, day: Int)
        switch x.precision {
        case "year": next = (f.year + 1, 1, 1)
        case "month": next = JumpMaths.addDays(f.year, f.month, 1, EarthTime.daysInMonth(f.year, f.month))
        default: next = JumpMaths.addDays(f.year, f.month, f.day, 1)
        }
        if let offset = x.offset { return JumpMaths.utcSeconds(next.year, next.month, next.day) - Double(offset) }
        return JumpMaths.dayStart(zone, next.year, next.month, next.day)
    }

    static func gregorian(_ c: Context) -> [JumpCandidate]? {
        switch GregorianParser.parse(c.text, zone: c.zone, ref: refDate(c), dayFirst: c.dayFirst, zoneNames: true) {
        case nil:
            return nil
        case .error(let message)?:
            return [.error(message)]
        case .results(let results)?:
            return results.map { x in gregorianCandidate(c, x) }
        }
    }

    private static func gregorianCandidate(_ c: Context, _ x: GregorianParser.Reading) -> JumpCandidate {
        let clock = c.clock
        let zone = x.zone ?? c.zone // a zone named in the text wins over the app zone
        var t = JumpMaths.r3(x.t)
        var note = ""
        var problem = JumpMaths.rangeProblem(clock, t)
        if problem != nil && t < clock.tMin && !x.hasTime && x.precision != "time" && periodEnd(x, zone) > clock.tMin {
            // "1613", "May 1613" or "1613-05-19": the period contains the first instant of the catalogue
            t = JumpMaths.r3(clock.tMin)
            problem = nil
            note = "the catalogue starts during this \(x.precision) (\(JumpMaths.utcStamp(clock.tMin)) UTC): showing its first instant"
        }
        let when = c.formatter.long(t) + " " + c.formatter.tag(t)
        var label = when
        let f = x.fields
        if x.precision == "year" {
            label = "\(f.year) · \(when)"
        } else if x.precision == "month" {
            label = "\(JumpMaths.monthsFull[f.month - 1]) \(f.year) · \(when)"
        } else if x.precision == "day", let n = x.note {
            label = "\(when) (\(n))"
        }
        if let problem {
            let p2 = JumpMaths.pad2
            let time = x.hasTime ? " \(p2(f.hour)):\(p2(f.minute))\(f.second != 0 ? ":" + p2(f.second) : "")" : ""
            let shown = "\(String(f.year).padStart(4))-\(p2(f.month))-\(p2(f.day))\(time)"
            return .error("\(shown) is \(problem)", "Catalogue: \(JumpMaths.catalogueRangeText(clock)) (UTC)")
        }
        func joined(_ parts: String...) -> String { parts.filter { !$0.isEmpty }.joined(separator: " · ") }
        if let offset = x.offset {
            note = joined("input read as UTC\(offset == 0 ? "" : JumpMaths.isoOffset(offset))", note)
        } else {
            if let named = x.zone {
                note = joined("input read in \(named)", note)
            } else if x.hasTime && x.precision != "time" {
                note = joined("input read in \(c.zone)", note)
            }
            if x.hasTime {
                let formatter = x.zone != nil ? EarthFormatter(zone: zone) : c.formatter
                let issue = JumpMaths.wallTimeNote(x.fields, zone: zone, t: t, formatter: formatter)
                if !issue.isEmpty { note += (note.isEmpty ? "" : " · ") + issue }
            }
        }
        return make(c, .date, label, t, extra: note, date: false)
    }

    // MARK: - Unix time

    private static let unixRE = JSRegex("^(?:(unix|epoch|ts|timestamp|unixtime)\\s*[:=]?\\s*|@\\s*)?(-?\\d+(?:\\.\\d+)?)\\s*(ms|s|sec)?$")

    static func unix(_ c: Context) -> [JumpCandidate]? {
        guard let m = unixRE.exec(c.lower) else { return nil }
        let explicit = truthy(m[1]) || c.lower.hasPrefix("@")
        let number = m[2]!
        let digits = (number.hasPrefix("-") ? String(number.dropFirst()) : number).split(separator: ".", omittingEmptySubsequences: false)[0].count
        if !explicit && digits < 5 { return nil }
        let v = jsNumber(number)
        let ms = m[3] == "ms" ? true : truthy(m[3]) ? false : digits >= 12 && digits <= 14
        let sec = ms ? v / 1000 : v
        if !sec.isFinite || abs(sec) > 8.64e12 { return [.error("\(JumpMaths.clip(number)) is not a valid Unix time")] }
        let t = JumpMaths.r3(sec)
        return [make(c, .unix, ms ? "Unix milliseconds \(JumpMaths.clip(number))" : "Unix seconds \(JumpMaths.clip(number))", t)]
    }
}

extension String {
    /// `s.replace(target, with)` for a plain string: the first occurrence only.
    func replacingFirst(_ target: String, with replacement: String) -> String {
        guard let r = range(of: target) else { return self }
        return replacingCharacters(in: r, with: replacement)
    }
}
