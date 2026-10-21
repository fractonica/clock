import FractonicaKit
import Foundation

// The minor ladder as the Timer and the Stopwatch count it (SPEC §15.1): Helion η, Preon ι, Flavon λ and Blink ν.
// Every unit is a whole number of Blinks (a Flavon is 25ν, a Preon 65λ, a Helion 36ι), so a span is one integer
// count of Blinks and its readout is exact integer arithmetic. Real time becomes Blinks through the clock's position
// (SPEC §15.4: spans are measured in position, so they stay exact across Saros intervals). Pure logic, no UI: checked
// by Features/Timer/Checks.

/// A unit a timer counts in, coarse to fine.
enum LadderUnit: Int, CaseIterable, Codable, Sendable, Identifiable, Comparable {
    case eta = 6, iota = 8, lambda = 10, nu = 12

    var id: Int { rawValue }
    /// The unit's level (depth − 1), for `Theme.levelColor`.
    var level: Int { rawValue }

    var symbol: String {
        switch self {
        case .eta: "η"
        case .iota: "ι"
        case .lambda: "λ"
        case .nu: "ν"
        }
    }

    var name: String {
        switch self {
        case .eta: "Helion"
        case .iota: "Preon"
        case .lambda: "Flavon"
        case .nu: "Blink"
        }
    }

    /// "Preon" / "Preons".
    func name(count: Int) -> String { count == 1 ? name : name + "s" }

    /// Blinks in one unit.
    var blinks: Int {
        switch self {
        case .eta: 58_500
        case .iota: 1_625
        case .lambda: 25
        case .nu: 1
        }
    }

    /// How many of this unit make the next unit up: 77η in an ε, 36ι in an η, 65λ in an ι, 25ν in a λ.
    var perParent: Int {
        switch self {
        case .eta: 77
        case .iota: 36
        case .lambda: 65
        case .nu: 25
        }
    }

    /// The depth between this unit and the next one up, as a count of this unit: ζ = 11η, θ = 4ι, κ = 13λ, μ = 5ν.
    /// Dials put a longer tick at every group.
    var group: Int {
        switch self {
        case .eta: 11
        case .iota: 4
        case .lambda: 13
        case .nu: 5
        }
    }

    /// The largest count a duration wheel offers (one less than the next unit; η stops below the Nuclide).
    var wheelMax: Int { perParent - 1 }

    /// The next finer unit; nil for the Blink.
    var finer: LadderUnit? { LadderUnit(rawValue: rawValue + 2) }

    /// Units from this one down to the Blink.
    var downToBlink: [LadderUnit] { LadderUnit.allCases.filter { $0 >= self } }

    /// Coarse sorts first: η < ι < λ < ν.
    static func < (a: LadderUnit, b: LadderUnit) -> Bool { a.rawValue < b.rawValue }
}

/// A span of whole Blinks, read as counts of the ladder units.
struct LadderSpan: Hashable, Sendable {
    let blinks: Int

    init(blinks: Int) { self.blinks = max(0, blinks) }

    init(eta: Int = 0, iota: Int = 0, lambda: Int = 0, nu: Int = 0) {
        self.init(blinks: eta * LadderUnit.eta.blinks + iota * LadderUnit.iota.blinks
            + lambda * LadderUnit.lambda.blinks + nu)
    }

    /// The count of `unit` once the coarser units are taken out; the Helion count is not wrapped (it may pass 77).
    func count(_ unit: LadderUnit) -> Int {
        unit == .eta ? blinks / unit.blinks : (blinks / unit.blinks) % unit.perParent
    }

    /// The coarsest unit with a non-zero count (the Blink for an empty span).
    var lead: LadderUnit { LadderUnit.allCases.first { count($0) > 0 } ?? .nu }

    var isZero: Bool { blinks == 0 }

    /// "1η 12ι", "13λ", "4ι": the non-zero counts, coarse to fine ("0ν" when empty). The name of a duration.
    var name: String {
        let parts = LadderUnit.allCases.compactMap { u in count(u) > 0 ? "\(count(u))\(u.symbol)" : nil }
        return parts.isEmpty ? "0ν" : parts.joined(separator: " ")
    }

    /// The name cut to its `parts` leading non-zero counts: "1η 12ι" for 1η 12ι 3λ 4ν with 2 parts.
    func name(parts: Int) -> String {
        let all = LadderUnit.allCases.compactMap { u in count(u) > 0 ? "\(count(u))\(u.symbol)" : nil }
        return all.isEmpty ? "0ν" : all.prefix(max(1, parts)).joined(separator: " ")
    }

    /// "1 Helion 12 Preons": the name in words, for VoiceOver.
    var spoken: String {
        let parts = LadderUnit.allCases.compactMap { u in count(u) > 0 ? "\(count(u)) \(u.name(count: count(u)))" : nil }
        return parts.isEmpty ? "0 Blinks" : parts.joined(separator: " ")
    }

    /// The fields of a readout from `lead` down to the Blink, each with its count and text ("02", or "1" when the
    /// field is left unpadded).
    func fields(from lead: LadderUnit, padLead: Bool = true) -> [Field] {
        lead.downToBlink.map { u in
            let n = count(u)
            let pad = u != lead || padLead
            return Field(unit: u, count: n, digits: pad && n < 10 ? "0\(n)" : "\(n)")
        }
    }

    /// "02ι 13λ 07ν": a fixed-width readout from `lead` down to the Blink.
    func readout(from lead: LadderUnit, padLead: Bool = true) -> String {
        fields(from: lead, padLead: padLead).map { $0.digits + $0.unit.symbol }.joined(separator: " ")
    }

    /// "2 Preons 13 Flavons 7 Blinks", the readout in words, zero fields included.
    func spokenReadout(from lead: LadderUnit) -> String {
        fields(from: lead).map { "\($0.count) \($0.unit.name(count: $0.count))" }.joined(separator: " ")
    }

    struct Field: Hashable, Sendable {
        let unit: LadderUnit
        let count: Int
        let digits: String
    }
}

/// Readouts as the Timer and the Stopwatch show them.
enum LadderReadout {
    /// A countdown keeps the fields of its total, at least Flavons and Blinks: a 4ι timer reads "04ι 00λ 00ν" until it
    /// rings, a 13λ one "13λ 00ν".
    static func timerLead(total: LadderSpan) -> LadderUnit {
        min(total.lead, .lambda)
    }

    /// A stopwatch shows Preons, Flavons and Blinks, and Helions once one has passed: "03ι 22λ 14ν", "1η 03ι 22λ 14ν".
    static func stopwatchLead(elapsed: LadderSpan) -> LadderUnit {
        elapsed.count(.eta) > 0 ? .eta : .iota
    }

    /// Whole Blinks left on a countdown: rounded up, so the readout shows the full span at the start and reaches zero
    /// exactly when the timer rings (as a kitchen timer shows 5:00, then 4:59). A thousandth of a Blink absorbs the
    /// float error of positions.
    static func ceilBlinks(_ blinks: Double) -> Int {
        guard blinks.isFinite, blinks > 0 else { return 0 }
        return Int((blinks - 1e-3).rounded(.up))
    }

    /// Whole Blinks elapsed on a stopwatch: rounded down.
    static func floorBlinks(_ blinks: Double) -> Int {
        guard blinks.isFinite, blinks > 0 else { return 0 }
        return Int((blinks + 1e-3).rounded(.down))
    }
}

// MARK: - Real time on the ladder

/// Real time as the Fractonica clock reads it: device dates become catalogue instants, Blinks are measured in the
/// clock's position. Readings outside the catalogue are nil, never extrapolated.
///
/// `offset` is zero in normal use; the `-FXTimerNow` launch argument sets it so screenshots can pretend the device
/// clock reads another instant (all timing stays on the device clock).
struct RealClock: Sendable {
    var offset: Double = 0
    var clock: FractonicaClock = .shared

    /// One Blink in Saros position units, 4 / P(ν).
    var blinkPosition: Double { 4 / clock.levelInfo(LadderUnit.nu.level).prefixDouble }

    /// The catalogue instant a device date stands for.
    func t(_ date: Date) -> Double { date.timeIntervalSince1970 + offset }

    /// The device date of a catalogue instant.
    func date(_ t: Double) -> Date { Date(timeIntervalSince1970: t - offset) }

    func inRange(_ date: Date) -> Bool { clock.inRange(t(date)) }

    /// Blinks from `a` to `b`, measured in position (negative when `b` is earlier); nil if either is outside the
    /// catalogue.
    func blinks(from a: Date, to b: Date) -> Double? {
        guard let pa = clock.position(at: t(a)), let pb = clock.position(at: t(b)) else { return nil }
        return (pb - pa) / blinkPosition
    }

    /// The date `blinks` Blinks after `date`; nil if `date` or the result lies outside the catalogue.
    func date(after date: Date, blinks: Double) -> Date? {
        guard let p = clock.position(at: t(date)) else { return nil }
        let q = p + blinks * blinkPosition
        guard q >= 0, q < Double(clock.extent) else { return nil }
        return self.date(clock.time(atPosition: q))
    }

    /// Device seconds of one Blink around `date` (the Saros interval it falls in); nil outside the catalogue.
    func blinkSeconds(at date: Date) -> Double? {
        let t = t(date)
        guard let k = clock.locate(t)?.k else { return nil }
        let next = min(k + 1, clock.extent)
        return blinkPosition * (clock.catalogue[next] - clock.catalogue[next - 1])
    }
}

// MARK: - Clock-aligned ends

/// "Until the next Preon": a countdown that ends where a cycle of a level begins, aligned with the clock.
struct AlignedTarget: Codable, Hashable, Sendable {
    /// The level whose next cycle the timer waits for.
    let level: Int
    /// That cycle's global index.
    let cycle: Int64
    /// When it begins (catalogue instant).
    let time: Double

    /// The levels a timer can align to, short to long: κ (13λ), ι, θ (4ι), η, ζ (11η) and ε.
    static let levels = [9, 8, 7, 6, 5, 4]

    /// The next start of a cycle of `level` strictly after `t`; nil outside the catalogue or when the running cycle is
    /// the catalogue's last.
    static func next(level: Int, after t: Double, clock: FractonicaClock = .shared) -> AlignedTarget? {
        guard let r = clock.level(at: t, level), !r.clipped, r.end > t, r.end < clock.tMax else { return nil }
        return AlignedTarget(level: level, cycle: r.cycle + 1, time: r.end)
    }

    /// What begins: "30ι", "35η", "8ι" (a θ), "23η" (a ζ), "ε#3" (pure notation; also how Earth mode names it).
    func name(_ notation: Notation) -> String {
        notation.cycleShort(level: level, cycle: cycle)
    }

    /// The word for a level's cycle: Helion, Preon … for units, the letter for the depths between them.
    static func word(level: Int) -> String {
        if let unit = LadderUnit(rawValue: level) { return unit.name }
        if level == 4 { return "Nuclide" }
        return Fractonica.periodName(level).text
    }

    /// Every level's length as an exact count of a unit: "11η" for ζ, "4ι" for θ.
    static func length(level: Int, notation: Notation) -> String {
        notation.cycleLength(level: level)
    }
}

// MARK: - Presets

/// Quick timers: whole cycles of the ladder, from a κ (13λ) to a ζ (11η).
enum TimerPresets {
    static let spans: [LadderSpan] = [
        LadderSpan(lambda: 13), LadderSpan(iota: 1), LadderSpan(iota: 2), LadderSpan(iota: 4), LadderSpan(eta: 1),
        LadderSpan(eta: 11),
    ]

    /// What a preset is on the ladder, in words: "a κ", "a Preon", "2 Preons", "a θ", "a Helion", "a ζ".
    static func meaning(_ span: LadderSpan) -> String {
        switch span.blinks {
        case 325: "one κ"
        case 6_500: "one θ"
        case 643_500: "one ζ"
        default:
            span.spoken.hasPrefix("1 ") ? "one " + span.spoken.dropFirst(2) : span.spoken
        }
    }
}
