import FractonicaKit
import Foundation

/// How the Saros catalogue says its figures: Earth units and UTC dates, or in pure mode Fractonica units and dates on
/// the reference clock (SPEC §15), where an eclipse outside the reference series' catalogue has no date, only its
/// ordinal.
struct SarosWords {
    let words: Wording
    /// Eclipses are world events: their times are given in UTC whatever the app's zone.
    let utc = EarthFormatter(timeZone: .gmt)

    var pure: Bool { words.pure }

    static let year = 365.2425 * 86_400

    /// "−10.081 s a sync" · pure "−0.227 Blinks a sync".
    func drift(_ d: SarosDrift) -> String { perSync(d.perSync) }

    /// The drift alone, for a column headed "a sync": "−10.081 s" · pure "−0.227 Blinks".
    func driftShort(_ d: SarosDrift) -> String {
        pure ? "\(sign(d.perSync))\(words.notation.blinks(abs(d.perSync)))" : "\(sign(d.perSync))\(String(format: "%.3f", abs(d.perSync))) s"
    }

    /// The lap, short: "84.3 y" (≈ when the series ends first) · pure the span in Fractonica units.
    func lapShort(_ d: SarosDrift) -> String {
        let approx = d.lap == nil ? "≈" : ""
        return pure ? approx + words.notation.duration(d.lapOrEstimate, parts: 2, at: d.at)
                    : approx + String(format: "%.1f y", d.lapOrEstimate / Self.year)
    }

    /// Seconds a sync: "−10.081 s a sync" · pure in Blinks.
    func perSync(_ seconds: Double) -> String {
        pure ? "\(sign(seconds))\(words.notation.blinks(abs(seconds))) a sync"
             : "\(sign(seconds))\(String(format: "%.3f", abs(seconds))) s a sync"
    }

    /// The lap: "89.2 years" (≈ when the series ends before it) · pure the span in Fractonica units.
    func lap(_ d: SarosDrift) -> String {
        let approx = d.lap == nil ? "≈ " : ""
        return pure ? approx + words.notation.duration(d.lapOrEstimate, parts: 2, at: d.at)
                    : approx + String(format: "%.1f years", d.lapOrEstimate / Self.year)
    }

    /// The lap as an Alpha and what runs past it: "α + 17.1 y" · pure "α + 15γ 3δ".
    func lapPastAlpha(_ d: SarosDrift) -> String {
        let past = d.lapPastAlpha
        let body = pure ? words.notation.duration(abs(past), parts: 2, at: d.at) : String(format: "%.1f y", abs(past) / Self.year)
        return "α \(past < 0 ? "−" : "+") \(body)"
    }

    /// When the lap completes: "Jan 2116" · pure its Fractonica date.
    func lapEnd(_ d: SarosDrift) -> String? {
        guard let end = d.lapEnd else { return nil }
        if pure { return FractonicaClock.shared.inRange(end) ? words.notation.dateText(at: end, upTo: "delta") : nil }
        let p = utc.parts(end)
        return "\(EarthTime.monthsShort[p.month - 1]) \(p.year)"
    }

    /// "1639 – 3009" · pure nil (years are Earth's).
    func span(_ s: SarosSeries) -> String? {
        pure ? nil : "\(utc.parts(s.start).year) – \(utc.parts(s.end).year)"
    }

    /// "2017-08-21 18:25 UTC" · pure the eclipse's date on the reference clock, when it falls inside its catalogue.
    func date(_ e: SarosEclipse) -> String {
        if pure {
            let clock = FractonicaClock.shared
            return clock.inRange(e.time) ? words.notation.dateText(at: e.time, upTo: "eta") : "outside the clock's catalogue"
        }
        return "\(utc.date(e.time)) \(utc.time(e.time, seconds: false)) UTC"
    }

    /// "2 min 40 s" · pure in Fractonica units; nil without a central duration.
    func duration(_ e: SarosEclipse) -> String? {
        guard let s = e.centralDuration else { return nil }
        if pure { return words.notation.duration(Double(s), parts: 2, at: e.time) }
        return s >= 60 ? "\(s / 60) min \(s % 60) s" : "\(s) s"
    }

    /// "in 18 years" / "9 years ago" / "in 3 months" · pure a countdown in Fractonica units.
    func relative(_ e: SarosEclipse, now: Double) -> String {
        let dt = e.time - now
        if pure { return words.notation.countdown(dt, parts: 1, at: now) }
        let years = abs(dt) / Self.year
        let text = years >= 1.5 ? "\(Int(years.rounded())) years" : years >= 1 ? "a year"
            : abs(dt) >= 60 * 86_400 ? "\(Int((abs(dt) / (30.44 * 86_400)).rounded())) months"
            : abs(dt) >= 2 * 86_400 ? "\(Int((abs(dt) / 86_400).rounded())) days" : "now"
        return text == "now" ? text : dt > 0 ? "in \(text)" : "\(text) ago"
    }

    /// "#23" and, every fourth eclipse, the Alpha it starts on a clock the series carries: "#24 · α#7".
    static func ordinal(_ e: SarosEclipse) -> String {
        e.ordinal % 4 == 0 ? "#\(e.ordinal) · α#\(e.ordinal / 4 + 1)" : "#\(e.ordinal)"
    }

    /// "Total", "Annular (non-central)", "Hybrid", "Partial" with NASA's label: "Total · T".
    static func type(_ e: SarosEclipse) -> String {
        let central = e.type.kind != .partial && !e.type.isCentral ? " (non-central)" : ""
        return "\(e.type.kind.title)\(central)"
    }

    /// "32 T · 1 H · 1 A · 14 P" (the kinds the series has, rarest light first).
    static func kinds(_ s: SarosSeries) -> String {
        let k = s.kinds
        return [SarosEclipseType.Kind.total, .hybrid, .annular, .partial]
            .compactMap { kind in k[kind].map { "\($0) \(kind.letter)" } }
            .joined(separator: " · ")
    }

    /// −10.08 → "−", true minus.
    private func sign(_ v: Double) -> String { v < 0 ? "−" : "+" }
}
