import FractonicaKit
import Foundation

/// What Alerts says: notification titles and bodies from the rule's templates, and the descriptions of rules, in the
/// app's two vocabularies (`Wording`: Earth words in the chosen zone, or Fractonica words only in pure mode).
///
/// Tokens of a template:
///
///     {name}     the cycle: "Delta Tetrafracton", "ε#3", "35η" (a Helion starting a Nuclide: "ε#3 1η"),
///                "solar sync 4821", "#23" (an eclipse). A turnover of a major period or Nuclide is named by the
///                coarsest one that turns with it: a Gamma rule says "Beta Difracton" where a Beta begins
///     {event}    "begins", "reaches its peak", "reaches its node", "reaches its valley", "ends"
///     {ordinal}  the place in its parent: "Trifracton" (α β γ δ), "3rd" (finer); the sync's number; "#23"
///     {unit}     "Delta", "Helion", "ζ", "solar sync", "eclipse"
///     {when}     "now", or the lead: "in 15 min", "in 3ι"
///     {time}     the moment: "14:23:07" (another day: "Oct 9 14:23") · pure "34η 29ι 21λ" (another Nuclide: the
///                short letter date)
struct AlertText: Sendable {
    let words: Wording

    var pure: Bool { words.pure }
    var notation: Notation { words.notation }
    var clock: FractonicaClock { words.notation.model }

    static let tokens = ["{name}", "{event}", "{ordinal}", "{unit}", "{when}", "{time}"]

    // MARK: - Messages

    /// The notification's title for an occurrence of `rule`.
    func title(_ rule: AlertRule, _ o: AlertOccurrence) -> String {
        let text = render(rule.title, rule, o)
        return (text.isEmpty ? render(AlertRule.defaultTitle, rule, o) : text).capitalizedLatinFirst
    }

    /// The notification's body; occurrences of other rules folded into it are listed after it.
    func body(_ rule: AlertRule, _ o: AlertOccurrence, also: [(rule: AlertRule, occurrence: AlertOccurrence)] = []) -> String {
        var lines = [render(rule.body, rule, o).capitalizedLatinFirst].filter { !$0.isEmpty }
        if !also.isEmpty {
            lines.append("Also: " + also.map { title($0.rule, $0.occurrence) }.joined(separator: " · "))
        }
        return lines.joined(separator: "\n")
    }

    /// The template with its tokens replaced; unknown tokens stay as they are.
    func render(_ template: String, _ rule: AlertRule, _ o: AlertOccurrence) -> String {
        guard template.contains("{") else { return template.trimmingCharacters(in: .whitespacesAndNewlines) }
        var out = template
        let values: [(String, () -> String)] = [
            ("{name}", { name(o) }), ("{event}", { event(o) }), ("{ordinal}", { ordinal(o) }),
            ("{unit}", { unit(o) }), ("{when}", { when(o, lead: rule.lead) }), ("{time}", { time(o) }),
        ]
        for (token, value) in values where out.contains(token) {
            out = out.replacingOccurrences(of: token, with: value())
        }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: - Tokens

    func name(_ o: AlertOccurrence) -> String {
        switch o.subject {
        case .eclipse:
            return Notation.eclipseName(Int(o.index))
        case .solar:
            return "solar sync \(o.index)"
        case .level(let level):
            if let (named, cycle) = namingCycle(o, level: level), named <= 4 {
                return notation.cycleName(level: named, cycle: cycle)
            }
            // Finer than the Nuclide: where it starts in its Nuclide, with the Nuclide when it starts a new one.
            let startsNuclide = o.event == .begin && o.top <= 4
            return notation.cycleName(level: level, cycle: o.index, short: !startsNuclide)
        }
    }

    func event(_ o: AlertOccurrence) -> String {
        if o.subject == .eclipse { return "is greatest" }
        return Self.eventPhrase(o.event)
    }

    static func eventPhrase(_ e: AlertEvent) -> String {
        switch e {
        case .begin: "begins"
        case .peak: "reaches its peak"
        case .node: "reaches its node"
        case .valley: "reaches its valley"
        case .end: "ends"
        }
    }

    func ordinal(_ o: AlertOccurrence) -> String {
        switch o.subject {
        case .eclipse: return Notation.eclipseName(Int(o.index))
        case .solar: return String(o.index)
        case .level(let level):
            let (named, cycle) = namingCycle(o, level: level) ?? (level, o.index)
            let place = notation.ordinalOf(level: named, cycle: cycle)
            return Notation.isMajor(named) ? Notation.ordinalName(place) : Journal.ordinal(place)
        }
    }

    func unit(_ o: AlertOccurrence) -> String {
        switch o.subject {
        case .eclipse: return "eclipse"
        case .solar: return "solar sync"
        case .level(let level):
            let named = namingCycle(o, level: level)?.level ?? level
            return Self.unitName(named)
        }
    }

    /// "now", or how far ahead the notification comes: "in 15 min", "in 1 day", "in 3ι" (pure, for an Earth lead:
    /// the span on the ladder).
    func when(_ o: AlertOccurrence, lead: AlertLead) -> String {
        guard !lead.isAtMoment else { return "now" }
        if let symbol = lead.unit.symbol { return "in \(lead.count)\(symbol)" }
        if pure { return words.countdown(o.time - o.fire, at: o.fire) }
        return "in " + Self.earthLead(lead)
    }

    /// The moment, read a hair after it so a beginning cycle reads as begun.
    func time(_ o: AlertOccurrence) -> String {
        words.label(o.time + 0.002, relativeTo: o.fire)
    }

    /// The level that names a turnover and the index of its cycle there: a major period or Nuclide turning over is
    /// named by the coarsest one that turns with it. Nil for the finer levels (named by their placing).
    private func namingCycle(_ o: AlertOccurrence, level: Int) -> (level: Int, cycle: Int64)? {
        guard level <= 4 else { return nil }
        guard o.event.isTurnover, o.top < level, o.top >= 0 else { return (level, o.index) }
        let ratio = Int64(clock.levelInfo(level).prefix / clock.levelInfo(o.top).prefix)
        let cycle = o.event == .begin ? o.index / ratio : (o.index + 1) / ratio - 1
        return (o.top, cycle)
    }

    // MARK: - Describing rules

    /// "Alpha" … "Delta", "Nuclide", "Helion", "Preon", "Flavon", "Blink"; the letter for the depths between ("ζ").
    static func unitName(_ level: Int) -> String {
        if Notation.isMajor(level) { return Notation.levelNames[level] }
        return Notation.unit(level: level)?.name ?? Fractonica.periodName(level).text
    }

    /// What a subject is called in lists: "Helion", "ζ 6", "Solar sync", "Saros 141 eclipses".
    func subjectName(_ s: AlertSubject) -> String {
        switch s {
        case .eclipse: "Saros 141 eclipses"
        case .solar: "Solar sync"
        case .level(let level): Notation.isUnitLevel(level) ? Self.unitName(level) : words.levelChip(level)
        }
    }

    /// A subject's second line: "η 7 · ≈ 5 h 3 min" · pure "η 7 · 36ι"; "19 Helions"; "#0 – #69".
    func subjectDetail(_ s: AlertSubject) -> String {
        switch s {
        case .eclipse: return "\(Notation.eclipseName(0)) – \(Notation.eclipseName(clock.extent))"
        case .solar: return pure ? "19η, quarters of 4η 27ι" : "19 Helions ≈ 4 days"
        case .level(let level):
            let length = pure ? holds(level) ?? notation.cycleLength(level: level) : words.levelLength(level)
            return "\(words.levelChip(level)) · \(length)"
        }
    }

    /// What one unit is made of ("36ι" for a Helion), nil for the Blink and the depths between.
    private func holds(_ level: Int) -> String? {
        let units = Notation.unitLevels
        guard let i = units.firstIndex(of: level), i + 1 < units.count else { return nil }
        let next = units[i + 1]
        let n = clock.levelInfo(next).prefix / clock.levelInfo(level).prefix
        return "\(n)\(Fractonica.periodName(next).text)"
    }

    /// "Begins", "Peak · Node · Valley · End", "Every quarter", "Greatest eclipse".
    func eventsSummary(_ rule: AlertRule) -> String {
        guard rule.subject.hasEvents else { return "Greatest eclipse" }
        let events = rule.events.sorted()
        if events == [.begin] { return "Begins" }
        if events == [.end] { return "Ends" }
        if events.count == AlertEvent.allCases.count { return "Every quarter and turnover" }
        return events.map { Self.eventName($0) }.joined(separator: " · ")
    }

    static func eventName(_ e: AlertEvent) -> String { e.rawValue.capitalized }

    /// The filters in words: "only Delta Pentafracton", "only ε#2", "only the 5th of each ζ", "when a Gamma turns too".
    func filterSummary(_ rule: AlertRule) -> String? {
        guard case .level(let level) = rule.subject else { return nil }
        var parts: [String] = []
        if let n = rule.ordinal {
            switch level {
            case ...3: parts.append("only \(Notation.periodName(level: level, ordinal: n))")
            case 4: parts.append("only ε#\(n)")
            default: parts.append("only the \(Journal.ordinal(n)) of each \(Fractonica.periodName(level - 1).text)")
            }
        }
        if let c = rule.coarser {
            parts.append("when \(Self.article(Self.unitName(c))) \(Self.unitName(c)) turns too")
        }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// "At the moment", "15 min before", "1 day before", "3ι before" · pure, for an Earth lead: "≈ 1ι 47λ before".
    func leadSummary(_ lead: AlertLead, at t: Double) -> String {
        guard !lead.isAtMoment else { return "At the moment" }
        if let symbol = lead.unit.symbol { return "\(lead.count)\(symbol) before" }
        if pure {
            return "≈ " + words.duration(Double(lead.count) * lead.unit.seconds!, at: t) + " before"
        }
        return Self.earthLead(lead) + " before"
    }

    /// The rule in one line: "Begins · at the moment", "Peak · Node · 3ι before · only Delta Pentafracton".
    func summary(_ rule: AlertRule, at t: Double) -> String {
        var parts = [eventsSummary(rule), leadSummary(rule.lead, at: t).lowercasedFirst]
        if let filters = filterSummary(rule) { parts.append(filters) }
        return parts.joined(separator: " · ")
    }

    /// "15 min", "1 h", "2 days".
    static func earthLead(_ lead: AlertLead) -> String {
        switch lead.unit {
        case .minute: "\(lead.count)\u{00A0}min"
        case .hour: "\(lead.count)\u{00A0}h"
        case .day: lead.count == 1 ? "1\u{00A0}day" : "\(lead.count)\u{00A0}days"
        default: "\(lead.count)\(lead.unit.symbol ?? "")"
        }
    }

    /// "a" or "an" before a unit's name (an Alpha, a Helion, an ε).
    static func article(_ word: String) -> String {
        word.first.map { "AEIOUaeiouαεηιουω".contains($0) } == true ? "an" : "a"
    }
}

extension String {
    /// The string with a leading Latin letter in upper case ("solar sync 4820 …" → "Solar sync 4820 …"); Greek
    /// period letters and digits stay as they are ("ε#3", "35η").
    var capitalizedLatinFirst: String {
        guard let first, first.isASCII, first.isLowercase else { return self }
        return first.uppercased() + dropFirst()
    }

    /// The string with its first letter in lower case ("At the moment" → "at the moment").
    var lowercasedFirst: String {
        guard let first else { return self }
        return first.lowercased() + dropFirst()
    }
}
