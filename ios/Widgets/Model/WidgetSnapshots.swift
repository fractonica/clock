import FractonicaKit

// What each widget shows at one instant, computed once per timeline entry by the provider (views only lay it out).
// Every string is final: built through `WidgetWords`, so a pure widget can never print an Earth word. Each snapshot
// type names the changes its picture follows (`changes`), which set its timeline's entries. Nil outside the catalogue.
// Pure logic, checked by Widgets/Checks.

// MARK: - Journal

/// The journal face (src/ui/face/journal.js, `Journal.reading`): the lead unit's phase on top (a 256-state pair, or a
/// major period's 3-stroke glyph), the counts in the middle, the lead cycle as two half-arcs with a tick below.
///
/// A widget cannot redraw every Flavon (7.8 s), so its middle stops at the Preon: the Helion face reads "34η 29ι"
/// where the app reads "34η 29ι 21λ", and the running Preon is drawn as a bar the system advances by itself.
struct JournalSnapshot: Hashable, Sendable {
    enum Top: Hashable, Sendable {
        case pair(hi: Int, lo: Int)
        case glyph3(Int)
    }

    /// The widget's units: α β γ δ (a major period alone) and the triplets from ε and η (`Journal.units` 0 … 5).
    static let units = 0...5

    let unit: Int
    let leadLevel: Int
    let leadLetter: String
    /// 0 ..< 1 through the lead cycle: the arc's tick.
    let leadPhase: Double
    let top: Top
    /// Minor faces: "ε#05 34η 29ι" or "34η 29ι" (two digits each, as the face).
    let tokens: [CountToken]
    /// Major faces: "5th", "Delta", "Trifracton", "End".
    let lines: [String]
    /// Minor faces: the running Preon (start, end), drawn as a live bar.
    let preon: ClosedRange<Double>?
    /// The short pure date, for the large face's foot: "Delta Trifracton End · ε#5".
    let caption: String
    /// What VoiceOver reads.
    let accessibility: String

    var isMajor: Bool { !lines.isEmpty }

    init?(at t: Double, unit rawUnit: Int, words: WidgetWords = WidgetWords(pure: true)) {
        let unit = min(Self.units.upperBound, max(Self.units.lowerBound, rawUnit))
        let clock = words.notation.model
        guard let reading = Journal.reading(at: t, unit: unit, notation: words.notation) else { return nil }
        self.unit = unit
        leadLevel = reading.leadLevel
        leadLetter = reading.leadLetter
        leadPhase = reading.leadPhase
        if let major = reading.major {
            top = .glyph3(major.index3)
            tokens = []
            lines = major.lines
            preon = nil
        } else {
            guard let digits = clock.odometer(at: t, reading.leadLevel)?.digits, digits.count == 2 else { return nil }
            top = .pair(hi: digits[0], lo: digits[1])
            // the face's third count is finer than a widget can follow: stop at the Preon
            tokens = (reading.tokens ?? []).filter { $0.level <= 8 }.map(CountToken.init(journal:))
            lines = []
            preon = clock.level(at: t, 8).map { $0.start...max($0.start, $0.end) }
        }
        let date = words.notation.date(at: t)
        caption = date.map { "\(Notation.periodName(level: 3, ordinal: $0.delta)) \($0.quarter.delta) · ε#\($0.epsilon)" } ?? ""
        let middle = lines.isEmpty ? tokens.map(\.text).joined(separator: " ") : lines.joined(separator: " ")
        accessibility = "\(middle); the \(reading.leadLetter) phase above and its cycle below"
    }

    /// The changes the face follows for a unit.
    static func changes(unit rawUnit: Int) -> Set<WidgetChange> {
        let unit = min(units.upperBound, max(units.lowerBound, rawUnit))
        let lead = Journal.units[unit].level
        if lead <= 3 {
            // the glyph, the tick (in 256 steps), the child's ordinal and the quarter
            return [.glyph3(level: lead), .pair(level: lead), .cycle(level: lead + 1), .quarter(level: lead)]
        }
        return [.pair(level: lead), .cycle(level: 8)]
    }
}

// MARK: - Clock

/// The clock in a line (the app's header, the watch face's elements): the minor clock, the Helion's phase pair, the
/// solar odometer, the major period and the Nuclide, the next Helion.
struct ClockSnapshot: Hashable, Sendable {
    let tokens: [CountToken]
    let helionPair: [Int]
    let helionPhase: Double
    /// "Delta Trifracton End".
    let major: String
    /// "ε#5".
    let nuclide: String
    /// The solar odometer's three glyphs; nil in the partial syncs at the catalogue's two ends.
    let solarDigits: [Int]?
    /// Pure "sync 4 820 · drift −6 236λ"; Earth "sync 4 820 · began 15:01" (the local time the sync began, SPEC §7.3).
    let solarText: String
    /// Earth "Thu 8 Oct 2026"; pure nil.
    let earthDay: String?
    /// Earth "UTC+03:00"; pure nil.
    let earthZone: String?
    /// "35η" (or "ε#1 1η" across a Nuclide); nil at the catalogue's end.
    let nextHelion: String?
    /// When the Helion ends (the live countdown in Earth words).
    let helionEnd: Double
    /// Pure "6ι" (counted from the running Preon's start); Earth "17:14" (when).
    let nextHelionWhen: String
    let accessibility: String

    /// The pair, the Preon count and the solar odometer; with Earth words also midnight (the Earth day, and the
    /// "Thu 15:01" labels of moments on other days).
    static func changes(words: WidgetWords) -> Set<WidgetChange> {
        let base: Set<WidgetChange> = [.pair(level: 6), .cycle(level: 8), .solarDigits]
        return words.pure ? base : base.union([.midnight(zone: words.earth.zone)])
    }

    init?(at t: Double, words: WidgetWords) {
        let n = words.notation
        let clock = n.model
        guard let tokens = words.clockTokens(at: t), let date = n.date(at: t),
              let helion = clock.level(at: t, 6), let preon = clock.level(at: t, 8),
              let pair = clock.odometer(at: t, 6)?.digits else { return nil }
        self.tokens = tokens
        helionPair = pair
        helionPhase = helion.phase
        major = "\(Notation.periodName(level: 3, ordinal: date.delta)) \(date.quarter.delta)"
        nuclide = "ε#\(date.epsilon)"
        let solar = clock.solar(at: t)
        solarDigits = solar?.digits3
        if let s = solar {
            let number = Notation.groupDigits(Double(s.sync))
            solarText = words.pure
                ? "sync \(number) · drift \(n.driftText(start: s.start, nominalStart: s.nominalStart, drift: s.drift))"
                : "sync \(number) · began \(words.earthWhen(s.start, from: t))"
        } else {
            solarText = ""
        }
        earthDay = words.pure ? nil : words.earthDay(t)
        earthZone = words.pure ? nil : words.earthZone(t)
        nextHelion = helion.clipped ? nil : words.nextCycleName(level: 6, cycle: helion.cycle)
        helionEnd = helion.end
        nextHelionWhen = words.pure ? words.span(from: preon.start, to: helion.end) : words.earthWhen(helion.end, from: t)
        accessibility = "\(tokens.map(\.text).joined(separator: " ")), \(major), \(nuclide)"
    }
}

// MARK: - Up next

/// One upcoming turnover: the instant a cycle ends and the next begins (every finer cycle ends with it).
struct Turnover: Hashable, Sendable, Identifiable {
    /// The coarsest level that rolls over there.
    let level: Int
    /// When, and when the ending cycle began (for a live progress bar).
    let time: Double
    let start: Double
    /// What begins: "35η", "ε#3", "Delta Tetrafracton"; nil where the catalogue ends.
    let begins: String?
    /// Pure: the short letter date there, "δ#3 ε#5 35η"; Earth: when, "Fri 17:14".
    let when: String
    /// Pure: the span still to come, "5η 12ι"; Earth: a static span for far events ("3 d 04 h"), nil when the view
    /// counts down live.
    let countdown: String?

    var id: Double { time }

    /// "35η begins", "the catalogue ends".
    var title: String { begins.map { "\($0) begins" } ?? "the catalogue ends" }
}

/// The next turnover of every unit from the Helion up (η ε δ γ β α), earliest first: the moments the clock's counts
/// roll over, from hours to decades away. Where several roll over together the row names the coarsest.
struct UpNextSnapshot: Hashable, Sendable {
    /// The levels whose next end is listed, finest first.
    static let levels = [6, 4, 3, 2, 1, 0]
    /// Earth countdowns run live (`Text(timerInterval:)`) when the event is closer than this; farther ones are static
    /// "3 d 04 h" spans, refreshed by the timeline (an entry every Preon).
    static let liveLimit = 86_400.0

    let turnovers: [Turnover]
    let pure: Bool

    /// What the list shown from t on follows: pure countdowns count Preons (an entry at every Preon start, which is
    /// also where any of the listed cycles ends); Earth words follow midnight (the labels of moments) and every whole
    /// hour of a static "3 d 04 h" span.
    static func changes(at t: Double, words: WidgetWords) -> Set<WidgetChange> {
        var changes: Set<WidgetChange> = [.cycle(level: 8)]
        guard !words.pure else { return changes }
        changes.insert(.midnight(zone: words.earth.zone))
        let clock = words.notation.model
        for level in levels {
            if let end = clock.level(at: t + WidgetChange.settle, level)?.end, end - t >= liveLimit {
                changes.insert(.countdown(to: end, step: 3600))
            }
        }
        return changes
    }

    init?(at t: Double, words: WidgetWords) {
        let clock = words.notation.model
        guard let preon = clock.level(at: t, 8) else { return nil }
        var byTime: [Double: Turnover] = [:]
        for level in Self.levels {
            guard let reading = clock.level(at: t, level) else { continue }
            // the coarsest level wins where several end together; levels are visited finest first
            let begins = reading.clipped ? nil : words.nextCycleName(level: level, cycle: reading.cycle)
            let when = !words.pure ? words.earthWhen(reading.end, from: t)
                : begins == nil ? words.notation.catalogueText() // the catalogue's extent, "α#1 – α#18"
                : Self.pureWhen(level: level, at: reading.end, words: words)
            let countdown: String? = words.pure
                ? words.span(from: preon.start, to: reading.end)
                : (reading.end - t < Self.liveLimit ? nil : words.earthSpan(reading.end - t))
            byTime[reading.end] = Turnover(level: level, time: reading.end, start: reading.start, begins: begins,
                                           when: when, countdown: countdown)
        }
        turnovers = byTime.values.sorted { $0.time < $1.time }
        pure = words.pure
    }

    /// Where a turnover falls, in letters, at the resolution of what begins there: "α#6 β#4 γ#9 δ#4" (a major period),
    /// "δ#3 ε#2" (a Nuclide), "δ#3 ε#5 35η" (a Helion).
    static func pureWhen(level: Int, at end: Double, words: WidgetWords) -> String {
        let t = end + WidgetChange.settle
        if level <= 3 { return words.notation.stamp(at: t, upTo: "delta") }
        return words.notation.dateText(at: t, letters: true, upTo: level == 4 ? "epsilon" : "eta")
    }
}

// MARK: - Rings

/// A dial snapshot (the Rings screen): one ring per level α … η, the cycle's progress swept clockwise from 12 o'clock,
/// with the minor clock and the Helion's pair in the middle.
struct RingsSnapshot: Hashable, Sendable {
    struct Ring: Hashable, Sendable {
        let level: Int
        let phase: Double
        /// Index in the parent, 0-based, of `siblings`.
        let local: Int
        let siblings: Int
        /// Child cycles per cycle: the ring's sector ticks.
        let factor: Int
    }

    /// The dial's levels, outermost first: those whose rings a timeline entry every ~71 s keeps honest.
    static let levels = Array(0...6)

    let rings: [Ring]
    let tokens: [CountToken]
    let helionPair: [Int]
    let next: Turnover?
    let accessibility: String

    static func changes(words: WidgetWords) -> Set<WidgetChange> {
        let base: Set<WidgetChange> = [.pair(level: 6), .cycle(level: 8)]
        return words.pure ? base : base.union([.midnight(zone: words.earth.zone)])
    }

    init?(at t: Double, words: WidgetWords) {
        let clock = words.notation.model
        let readings = Self.levels.compactMap { clock.level(at: t, $0) }
        guard readings.count == Self.levels.count, let tokens = words.clockTokens(at: t),
              let pair = clock.odometer(at: t, 6)?.digits,
              let upNext = UpNextSnapshot(at: t, words: words) else { return nil }
        rings = readings.map { Ring(level: $0.level, phase: $0.phase, local: $0.local, siblings: $0.siblings, factor: $0.factor) }
        self.tokens = tokens
        helionPair = pair
        next = upNext.turnovers.first
        accessibility = "Rings α to η; \(tokens.map(\.text).joined(separator: " "))"
    }
}

// MARK: - Lock Screen

/// The Lock Screen's three accessories: the Helion as a gauge with its number, the short date with the pair, and the
/// minor clock in a line.
struct AccessorySnapshot: Hashable, Sendable {
    /// The Helion's number in its Nuclide, 1 … 77.
    let helion: Int
    let helionPhase: Double
    let helionPair: [Int]
    let tokens: [CountToken]
    /// "Delta Trifracton End".
    let major: String
    /// "ε#5".
    let nuclide: String
    /// "34η 29ι".
    var inline: String { tokens.map(\.text).joined(separator: " ") }

    /// The gauge moves in 256 steps per Helion; the counts change with every Preon.
    static let changes: Set<WidgetChange> = [.pair(level: 6), .cycle(level: 8)]

    init?(at t: Double, words: WidgetWords = WidgetWords(pure: true)) {
        let n = words.notation
        guard let c = n.clock(at: t), let date = n.date(at: t), let tokens = words.clockTokens(at: t),
              let helion = n.model.level(at: t, 6), let pair = n.model.odometer(at: t, 6)?.digits else { return nil }
        self.helion = c.eta
        helionPhase = helion.phase
        helionPair = pair
        self.tokens = tokens
        major = "\(Notation.periodName(level: 3, ordinal: date.delta)) \(date.quarter.delta)"
        nuclide = "ε#\(date.epsilon)"
    }
}

// MARK: - Overview

/// The extra-large overview (iPad, Mac): the clock, the dial and up next side by side.
struct OverviewSnapshot: Hashable, Sendable {
    let clock: ClockSnapshot
    let rings: RingsSnapshot
    let upNext: UpNextSnapshot

    init?(at t: Double, words: WidgetWords) {
        guard let clock = ClockSnapshot(at: t, words: words), let rings = RingsSnapshot(at: t, words: words),
              let upNext = UpNextSnapshot(at: t, words: words) else { return nil }
        self.clock = clock
        self.rings = rings
        self.upNext = upNext
    }

    /// Everything its three parts follow.
    static func changes(at t: Double, words: WidgetWords) -> Set<WidgetChange> {
        ClockSnapshot.changes(words: words).union(UpNextSnapshot.changes(at: t, words: words))
    }
}
