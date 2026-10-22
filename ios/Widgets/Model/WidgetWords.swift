import FractonicaKit
import Foundation

/// How a widget says moments and spans: Fractonica terms only (pure, SPEC §15) or with Earth time in a zone. The
/// widgets' counterpart of the app's `Wording`: the extension has no access to the app's settings, so each widget
/// carries its own choice (its configuration intent). Pure words never contain a Gregorian date, a clock time, a zone,
/// an Earth unit or a percentage. Pure logic, checked by Widgets/Checks.
struct WidgetWords: Sendable {
    let pure: Bool
    let earth: EarthFormatter
    var notation: Notation { .standard }

    /// `zone` nil is the device's zone.
    init(pure: Bool, zone: String? = nil) {
        self.pure = pure
        earth = EarthFormatter(zone: zone)
    }

    // MARK: Minor clock

    /// The minor clock at t as tokens, down to the Preon: "34η 29ι" (the Helion numbered from 1 in its Nuclide, the
    /// Preons completed). Nil outside the catalogue.
    func clockTokens(at t: Double) -> [CountToken]? {
        guard let c = notation.clock(at: t) else { return nil }
        return [CountToken(level: 6, number: String(c.eta), suffix: "η"), CountToken(level: 8, number: String(c.iota), suffix: "ι")]
    }

    // MARK: Cycles

    /// What begins where the running cycle `cycle` of `level` ends (src/ui/ladder/pure-text.js `nextCycle`): a major
    /// period in words ("Delta Tetrafracton"), the Nuclide by its ordinal ("ε#3"), a finer cycle by where it starts,
    /// short inside the same Nuclide ("35η") and with the Nuclide when it starts a new one ("ε#3 1η"). Nil when the
    /// catalogue ends with the running cycle.
    func nextCycleName(level: Int, cycle: Int64) -> String? {
        let clock = notation.model
        let next = cycle + 1
        guard Int128(next) < clock.count(level) else { return nil }
        if level <= 4 { return notation.cycleName(level: level, cycle: next) }
        let ratio = clock.levelInfo(level).prefix / clock.levelInfo(4).prefix
        let same = Int128(next) / ratio == Int128(cycle) / ratio
        return notation.cycleName(level: level, cycle: next, short: same)
    }

    /// The letter or the name a sentence uses for a level: "Delta" for a major period, "η" otherwise.
    static func levelWord(_ level: Int) -> String {
        Notation.isMajor(level) ? Notation.levelNames[level] : Fractonica.periodName(level).text
    }

    // MARK: Spans

    /// A span on the ladder between two instants, two non-zero parts: "6ι", "5η 12ι", "2ε 10η" (exact across
    /// eclipse intervals). Measured from the start of the running Preon, a countdown read this way changes exactly
    /// when a Preon begins: it counts the Preons still to start, like a clock that shows whole minutes.
    func span(from start: Double, to end: Double) -> String {
        notation.between(start, end, parts: 2)
    }

    /// An Earth countdown without the "in": "3 d 04 h", "12 min 04 s".
    func earthSpan(_ seconds: Double) -> String {
        let text = EarthTime.countdown(seconds)
        return text.hasPrefix("in ") ? String(text.dropFirst(3)) : text
    }

    // MARK: Earth moments

    /// "Thu 8 Oct 2026" in the zone.
    func earthDay(_ t: Double) -> String {
        let p = earth.parts(t)
        return "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year)"
    }

    /// When an event at t happens, seen from `ref`: "17:14" on the same day, "Fri 17:14" within the week ahead, else
    /// "Oct 18 17:14" ("Oct 18 2027 17:14" in another year).
    func earthWhen(_ t: Double, from ref: Double) -> String {
        let a = earth.parts(t), b = earth.parts(ref)
        let time = earth.time(t, seconds: false)
        if a.year == b.year && a.month == b.month && a.day == b.day { return time }
        // whole civil days between the two dates (a day around a clock change lasts 23 or 25 hours)
        let days = ((earth.toUnix(EarthTime.CivilTime(year: a.year, month: a.month, day: a.day))
            - earth.toUnix(EarthTime.CivilTime(year: b.year, month: b.month, day: b.day))) / 86_400).rounded()
        if days > 0 && days < 7 { return "\(EarthTime.weekdaysShort[a.weekday]) \(time)" }
        return earth.short(t, refYear: b.year)
    }

    /// "UTC+03:00" (the zone's tag at t).
    func earthZone(_ t: Double) -> String { earth.tag(t) }
}

/// One count of a reading, split for colouring: the number in ink, the letter (or the ordinal mark) in its level's
/// colour. "34η" is ("", "34", "η"); "ε#05" is ("ε#", "05", "").
struct CountToken: Hashable, Sendable {
    var level: Int
    var prefix: String = ""
    var number: String
    var suffix: String = ""

    var text: String { prefix + number + suffix }

    /// A journal token ("72η", "ε#05", "03ν").
    init(journal token: Journal.Token) {
        level = token.level
        let text = token.text
        if text.hasPrefix("ε#") {
            prefix = "ε#"
            number = String(text.dropFirst(2))
        } else {
            number = String(text.prefix { $0.isNumber })
            suffix = String(text.drop { $0.isNumber })
        }
    }

    init(level: Int, prefix: String = "", number: String, suffix: String = "") {
        self.level = level
        self.prefix = prefix
        self.number = number
        self.suffix = suffix
    }
}
