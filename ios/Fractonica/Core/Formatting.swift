import FractonicaKit
import Foundation

/// How the app says a moment or a span right now: Earth words in the chosen time zone, or Fractonica words in pure
/// mode (the `fmt` wrapper of src/main.js). A screen that always goes through it cannot print a Gregorian date or
/// "3 h 20 min" in pure mode by accident.
///
///     @Environment(AppSettings.self) private var settings
///     let words = settings.wording
///     Text(words.time(t))                           // "14:23:07"            · pure "34η 29ι 21λ"
///     Text(words.countdown(reading.remaining, at: t)) // "in 56 min 12 s"      · pure "in 6ι 43λ"
///
/// Use `earth` and `notation` directly for anything mode-specific (zone tags, parts, stamps).
struct Wording: Sendable {
    let pure: Bool
    /// Earth formatting in the chosen zone.
    let earth: EarthFormatter
    let notation: Notation

    init(pure: Bool, timeZone: TimeZone, notation: Notation = .standard) {
        self.pure = pure
        earth = EarthFormatter(timeZone: timeZone)
        self.notation = notation
    }

    /// Bound to an IANA identifier (nil = the device zone). Prefer this to `init(timeZone:)` for a chosen zone: Foundation
    /// reports "UTC" as "GMT", and only the identifier keeps the web app's "UTC" tag.
    init(pure: Bool, zone: String?, notation: Notation = .standard) {
        self.pure = pure
        earth = EarthFormatter(zone: zone)
        self.notation = notation
    }

    // MARK: Moments

    /// "2026-10-08" · pure "Delta Trifracton End ε#5 34η 29ι".
    func date(_ t: Double) -> String {
        pure ? notation.dateText(at: t) : earth.date(t)
    }

    /// "14:23:07" (or "14:23") · pure "34η 29ι 21λ".
    func time(_ t: Double, seconds: Bool = true) -> String {
        pure ? notation.clockText(at: t) : earth.time(t, seconds: seconds)
    }

    /// "2026-10-08 14:23:07" · pure "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ".
    func dateTime(_ t: Double) -> String {
        pure ? notation.stamp(at: t, upTo: "lambda") : earth.dateTime(t)
    }

    /// "Thu 8 Oct 2026, 14:23:07" · pure "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι".
    func long(_ t: Double) -> String {
        pure ? notation.stamp(at: t, upTo: "iota") : earth.long(t)
    }

    /// "Oct 8 14:23" (the year only when it differs from `refYear`) · pure "α#6 β#4 γ#9 δ#3 ε#5 34η".
    func short(_ t: Double, refYear: Int? = nil) -> String {
        pure ? notation.stamp(at: t, upTo: "eta") : earth.short(t, refYear: refYear)
    }

    /// A time of day when `t` falls on the same day as `ref`, else a short date (SPEC §8 info labels): "14:23:07",
    /// "Oct 9 14:23", and "Oct 9 2027 14:23" in another year (the web app's `label` leaves the year out, which makes a
    /// moment years away read like one this year) · pure: the clock within the same Nuclide, else the short letter date.
    func label(_ t: Double, relativeTo ref: Double) -> String {
        guard pure else {
            let year = earth.parts(ref).year
            return earth.parts(t).year == year ? earth.label(t, ref: ref) : earth.short(t, refYear: year)
        }
        if notation.stamp(at: t, upTo: "epsilon") == notation.stamp(at: ref, upTo: "epsilon") {
            return notation.clockText(at: t)
        }
        return notation.dateText(at: t, letters: true, upTo: "eta")
    }

    /// The day a moment falls on: "Thu 8 Oct 2026" · pure the Delta and the Nuclide, "Delta Trifracton End ε#5".
    func day(_ t: Double) -> String {
        guard !pure else { return notation.dateText(at: t, upTo: "epsilon") }
        let p = earth.parts(t)
        return "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year)"
    }

    /// "UTC+03:00" · pure "" (zones do not exist there).
    func tag(_ t: Double) -> String {
        pure ? "" : earth.tag(t)
    }

    // MARK: Spans

    /// "3 d 4 h" · pure "5η 12ι". Pure spans are measured on the ladder around `t`.
    func duration(_ seconds: Double, at t: Double, parts: Int = 2) -> String {
        pure ? notation.duration(seconds, parts: parts, at: t) : EarthTime.duration(seconds, parts: parts)
    }

    /// "in 3 d 04 h" / "3 min ago" · pure "in 5η 12ι" / "6ι 43λ ago".
    func countdown(_ seconds: Double, at t: Double) -> String {
        pure ? notation.countdown(seconds, at: t) : EarthTime.countdown(seconds)
    }

    /// How far `t` is from `ref`, as a countdown.
    func relative(_ t: Double, to ref: Double) -> String {
        countdown(t - ref, at: ref)
    }

    // MARK: Speeds

    /// The forward time-lapse presets of the transport, real time first.
    var rates: [TimeLapse] {
        pure ? notation.rates.map { TimeLapse(id: $0.id, rate: $0.rate, label: $0.label) } : TimeLapse.earth
    }

    /// "×3,600 · 1 h/s", "−×60 · 1 min/s", "×42 (custom)" · pure "4ι per Blink", "η per Blink backward".
    func rateLabel(_ rate: Double) -> String {
        if pure { return notation.rateLabel(rate) }
        let speed = abs(rate)
        if let preset = TimeLapse.earth.first(where: { abs($0.rate - speed) / $0.rate < 0.005 }) {
            return rate < 0 ? "−" + preset.label : preset.label
        }
        let number = speed >= 100 ? speed.formatted(.number.precision(.fractionLength(0)).locale(Locale(identifier: "en"))) : speed.formatted(.number.precision(.significantDigits(1...3)))
        return "×\(number) (custom\(rate < 0 ? ", backward" : ""))"
    }

    // MARK: Levels

    /// The depth chip of a level: "η 7" (letter and depth, the same in both modes).
    func levelChip(_ level: Int) -> String {
        "\(Fractonica.periodName(level).text) \(level + 1)"
    }

    /// A level's name: "depth 7" · pure "Helion" for the units, "Delta" for the major periods, the letter between them.
    func levelName(_ level: Int) -> String {
        guard pure else { return "depth \(level + 1)" }
        switch Notation.levelKind(level) {
        case "major": return Notation.levelNames[level]
        case "unit": return Notation.unit(level: level)?.name ?? Fractonica.periodName(level).text
        default: return Fractonica.periodName(level).text
        }
    }

    /// A level for pickers and lists: "η 7 · ≈ 5 h 3 min" · pure "η 7 · Helion", "ζ 6 · 11η".
    func levelLabel(_ level: Int) -> String {
        let named = pure && ["major", "unit"].contains(Notation.levelKind(level))
        return "\(levelChip(level)) · \(named ? levelName(level) : levelLength(level))"
    }

    /// How long one cycle of a level lasts: "≈ 5 h 3 min" · pure exactly, on the ladder: "1η", "11η", "0.14ν".
    func levelLength(_ level: Int) -> String {
        pure ? notation.cycleLength(level: level) : "≈ " + EarthTime.duration(notation.model.levelInfo(level).meanSeconds)
    }
}

extension AppSettings {
    /// The wording for the current mode and zone. Reading it makes a view follow both.
    var wording: Wording { Wording(pure: pure, zone: zone) }
}
