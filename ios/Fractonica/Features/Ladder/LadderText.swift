import FractonicaKit
import Foundation

/// Earth wording and arithmetic of the ladder and Up next: a port of src/ui/ladder/lib.js (segmented bar, countdowns,
/// Gregorian labels at the resolution of a cycle, exact Saros spans, Just before / Just after, the turnover sentence).
/// Pure logic, no UI: checked against the web module by Checks/LadderChecks.swift.
enum LadderText {
    static let minute = 60.0
    static let hour = 3600.0
    static let day = 86_400.0
    /// The Julian year format.js counts in.
    static let year = 31_557_600.0
    /// Narrow no-break space between a number and "%".
    static let nnbsp = "\u{202F}"

    // MARK: Letters

    /// "η" for level 6.
    static func letter(_ level: Int) -> String { Fractonica.periodName(level).text }

    /// "η 7": the depth chip of a level.
    static func chip(_ level: Int) -> String { "\(letter(level)) \(level + 1)" }

    // MARK: Segmented bar

    /// Which child segment a phase falls in, and how far through that segment (lib.js `segmentState`).
    static func segment(phase: Double, factor: Int) -> (index: Int, frac: Double) {
        let x = min(1, max(0, phase.isFinite ? phase : 0)) * Double(factor)
        let index = Int(x.rounded(.down))
        if index >= factor { return (factor - 1, 1) }
        return (index, x - Double(index))
    }

    /// "1st", "2nd", "11th", "22nd".
    static func ordinal(_ n: Int) -> String {
        let v = n % 100
        if (11...13).contains(v) { return "\(n)th" }
        let suffix = ["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]
        return "\(n)\(suffix)"
    }

    /// "7 of 9": the cycle's place in its parent, 1-based and never past the sibling count.
    static func counter(local: Int, siblings: Int) -> String {
        "\(min(max(local + 1, 1), siblings)) of \(siblings)"
    }

    // MARK: Percent

    /// Whole percent through a cycle, floored, never 100 (lib.js `pctWhole`).
    static func pctWhole(_ phase: Double) -> Int {
        let p = phase.isFinite ? phase : 0
        return min(99, max(0, Int((p * 100 + 1e-7).rounded(.down))))
    }

    /// "81.4 %": floored to a tenth (lib.js `pctTenthsText`).
    static func pctTenths(_ phase: Double) -> String {
        let p = phase.isFinite ? phase : 0
        let tenths = min(999, max(0, Int((p * 1000 + 1e-7).rounded(.down))))
        return "\(tenths / 10).\(tenths % 10)\(nnbsp)%"
    }

    /// "8th of 9 θ 8 sectors · 33 % through it": where the bar's current segment is.
    static func sector(level: Int, index: Int, frac: Double, factor: Int) -> String {
        let child = level < Fractonica.maxLevel ? "\(chip(level + 1)) " : "finer "
        return "\(ordinal(index + 1)) of \(factor) \(child)sectors · \(min(99, Int((frac * 100).rounded(.down))))\(nnbsp)% through it"
    }

    // MARK: Just before / Just after

    /// "Just before" stops 2 s ahead of a turnover, or a quarter of the cycle when that is shorter.
    static func justBeforeLead(_ duration: Double) -> Double {
        guard duration > 0 else { return 2 }
        return min(2, duration * 0.25)
    }

    static func justBeforeTime(end: Double, duration: Double) -> Double { end - justBeforeLead(duration) }

    /// 1 ms into the cycle that follows the one ending at `end`.
    static func justAfterTime(end: Double) -> Double { end + 0.001 }

    /// Where "Just before" lands for the turnover of level `top` at `time`: inside the cycle that ends there.
    static func justBeforeTurnover(clock: FractonicaClock, time: Double, top: Int) -> Double {
        let ending = clock.level(at: time - 0.0005, top)
        return justBeforeTime(end: time, duration: ending?.duration ?? clock.levelInfo(top).meanSeconds)
    }

    /// "2 s", "400 ms", "11 ms".
    static func lead(_ seconds: Double) -> String {
        if seconds < 1 { return "\(max(1, Int(jsRound(seconds * 1000)))) ms" }
        return "\(LadderNumber.string(LadderNumber.fixed(seconds, 1))) s"
    }

    // MARK: Countdowns

    /// The shared countdown without its "in", tenths floored below 10 s (lib.js `countdownText`): "3 d 04 h",
    /// "12 min 04 s", "7.3 s".
    static func countdown(_ seconds: Double) -> String {
        let s = max(0, seconds.isFinite ? seconds : 0)
        let text = EarthTime.countdown(s < 10 ? (s * 10).rounded(.down) / 10 : s)
        return text.hasPrefix("in ") ? String(text.dropFirst(3)) : text
    }

    /// The hero countdown, up to three units of stable shape (lib.js `countdownLong`): "2 d 03 h 11 min".
    static func countdownLong(_ seconds: Double) -> String {
        let s = max(0, seconds.isFinite ? seconds : 0)
        if s < 60 { return countdown(s) }
        let w = Int(s.rounded(.down))
        let (Y, D, H, M) = (Int(year), Int(day), Int(hour), Int(minute))
        if w >= Y {
            let y = w / Y
            let d = (w - y * Y) / D
            let h = (w - y * Y - d * D) / H
            return "\(y) y \(d) d \(pad2(h)) h"
        }
        if w >= D { return "\(w / D) d \(pad2((w % D) / H)) h \(pad2((w % H) / M)) min" }
        if w >= H { return "\(w / H) h \(pad2((w % H) / M)) min \(pad2(w % M)) s" }
        return "\(w / M) min \(pad2(w % M)) s"
    }

    /// Time left in a ladder row: the countdown, or decimal years for a year or more ("19.3 y").
    static func remaining(_ seconds: Double) -> String {
        seconds >= year ? EarthTime.duration(seconds) : countdown(seconds)
    }

    // MARK: Gregorian labels

    /// The nearest millisecond of t.
    static func snapMs(_ t: Double) -> Double { jsRound(t * 1000) / 1000 }

    /// A time label at the resolution of a cycle `span` seconds long (lib.js `whenLabel`): "2026-10-18" (≥ 90 d),
    /// "Oct 18 03:41" (≥ 1 d), "03:41:12" (same day), "Oct 18 03:41:12", with ".250" below 10 s.
    static func whenLabel(_ earth: EarthFormatter, _ t: Double, ref: Double, span: Double) -> String {
        let precise = span < 10
        let t = precise ? snapMs(t) : t
        let p = earth.parts(t), r = earth.parts(ref)
        let iso = "\(p.year)-\(pad2(p.month))-\(pad2(p.day))"
        let date = "\(EarthTime.monthsShort[p.month - 1]) \(p.day)"
        let sameYear = p.year == r.year
        let sameDay = sameYear && p.month == r.month && p.day == r.day
        let hm = "\(pad2(p.hour)):\(pad2(p.minute))"
        if span >= 90 * day { return iso }
        if span >= day { return sameYear ? "\(date) \(hm)" : "\(iso) \(hm)" }
        let clock = "\(hm):\(pad2(p.second))" + (precise ? "." + pad3(msOf(t)) : "")
        return sameDay ? clock : "\(date) \(clock)"
    }

    /// "Fri 9 Oct 2026, 14:23:07" (".250" when `precise`).
    static func whenFull(_ earth: EarthFormatter, _ t: Double, precise: Bool = false) -> String {
        let t = precise ? snapMs(t) : t
        let p = earth.parts(t)
        let clock = "\(pad2(p.hour)):\(pad2(p.minute)):\(pad2(p.second))" + (precise ? "." + pad3(msOf(t)) : "")
        return "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year), \(clock)"
    }

    /// "Sun 18 Oct" in the year `refYear`, else "18 Oct 2027".
    static func dayLabel(_ earth: EarthFormatter, _ t: Double, refYear: Int) -> String {
        let p = earth.parts(t)
        if p.year == refYear { return "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1])" }
        return "\(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year)"
    }

    /// "03:41".
    static func clockLabel(_ earth: EarthFormatter, _ t: Double) -> String {
        let p = earth.parts(t)
        return "\(pad2(p.hour)):\(pad2(p.minute))"
    }

    // MARK: Exact Saros positions

    /// num / den with `decimals` places, rounded half up, exactly.
    static func ratioToDecimal(_ num: Int128, _ den: Int128, decimals: Int) -> String {
        var scale: Int128 = 1
        for _ in 0..<decimals { scale *= 10 }
        let q = (num * scale * 2 + den) / (den * 2)
        guard decimals > 0 else { return String(q) }
        var s = String(q)
        if s.count < decimals + 1 { s = String(repeating: "0", count: decimals + 1 - s.count) + s }
        let cut = s.index(s.endIndex, offsetBy: -decimals)
        return "\(s[..<cut]).\(s[cut...])"
    }

    /// Decimals that resolve one cycle (4 / P Saros) with a spare digit.
    static func positionDecimals(prefix: Int128) -> Int {
        let resolution = max(prefix / 4, 1)
        return min(14, max(2, String(resolution).count + 1))
    }

    /// The Saros-position span of a cycle, clipped at the catalogue extent: ("22.927824", "22.927856").
    static func positionSpan(cycle: Int64, prefix: Int128, extent: Int, clipped: Bool) -> (from: String, to: String) {
        let c = Int128(cycle)
        let decimals = positionDecimals(prefix: prefix)
        let end = Int128(extent) * prefix
        let n0 = min(4 * c, end)
        let n1 = clipped ? end : min(4 * (c + 1), end)
        return (ratioToDecimal(n0, prefix, decimals: decimals), ratioToDecimal(n1, prefix, decimals: decimals))
    }

    // MARK: Turnovers

    /// The levels finer than `top` down to `maxLevel`, which roll over with it.
    static func finerLevels(_ top: Int, maxLevel: Int) -> [Int] {
        top < maxLevel ? Array((top + 1)...maxLevel) : []
    }

    /// "ζ, η, θ" or "ζ … κ" beyond `max` letters.
    static func levelLetters(_ levels: [Int], max: Int = 4) -> String {
        guard let first = levels.first, let last = levels.last else { return "" }
        if levels.count <= max { return levels.map(letter).joined(separator: ", ") }
        return "\(letter(first)) … \(letter(last))"
    }

    /// "ε 5 ends — 4 finer cycles (ζ, η, θ, ι) end with it."
    static func turnoverSentence(top: Int, maxLevel: Int) -> String {
        let fin = finerLevels(top, maxLevel: maxLevel)
        let name = chip(top)
        if fin.isEmpty { return "\(name) ends." }
        let one = fin.count == 1
        return "\(name) ends — \(fin.count) finer \(one ? "cycle" : "cycles") (\(levelLetters(fin))) end\(one ? "s" : "") with it."
    }

    // MARK: Helpers

    static func pad2(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
    static func pad3(_ n: Int) -> String { n < 10 ? "00\(n)" : n < 100 ? "0\(n)" : "\(n)" }

    /// Math.round: halves toward +∞.
    static func jsRound(_ x: Double) -> Double {
        guard x.isFinite else { return x }
        let down = x.rounded(.down)
        return x - down >= 0.5 ? down + 1 : down
    }

    /// The millisecond part of a snapped instant.
    private static func msOf(_ t: Double) -> Int {
        min(999, max(0, Int(jsRound((t - t.rounded(.down)) * 1000))))
    }
}

/// The few JavaScript number formats the ladder prints (`toFixed`, `toPrecision`, `String(n)`), exact on the double's
/// binary value with ties toward the larger result, as JavaScript does (C's printf rounds ties to even).
enum LadderNumber {
    /// `x.toFixed(digits)` as a number.
    static func fixed(_ x: Double, _ digits: Int) -> Double {
        guard x.isFinite, digits >= 0, digits <= 15 else { return x }
        var scale: UInt128 = 1
        for _ in 0..<digits { scale *= 10 }
        guard let n = roundHalfUp(abs(x), times: scale) else { return x }
        let v = Double(n) / Double(scale)
        return x < 0 ? -v : v
    }

    /// `Number(x.toPrecision(digits))`.
    static func precision(_ x: Double, _ digits: Int) -> Double {
        guard x.isFinite, x != 0, digits >= 1 else { return x }
        let magnitude = abs(x)
        let exponent = Int(log10(magnitude).rounded(.down))
        let shift = digits - 1 - exponent
        var v: Double
        if shift >= 0 {
            var scale: UInt128 = 1
            for _ in 0..<min(shift, 30) { scale *= 10 }
            guard let n = roundHalfUp(magnitude, times: scale) else { return x }
            v = Double(n) / Double(scale)
        } else {
            let scale = pow(10, Double(-shift))
            v = LadderText.jsRound(magnitude / scale) * scale
        }
        if v >= pow(10, Double(exponent + 1)) { v = precision(v, digits) }
        return x < 0 ? -v : v
    }

    /// `String(x)` for the plain-decimal range the ladder prints: "2", "1.5", "0.14".
    static func string(_ x: Double) -> String {
        if x == x.rounded(), abs(x) < 1e15 { return String(Int64(x)) }
        return "\(x)"
    }

    /// round(x · scale), halves up, on the exact binary value of x (nil if it does not fit 128 bits).
    private static func roundHalfUp(_ x: Double, times scale: UInt128) -> UInt128? {
        let significand = UInt128(x.significandBitPattern | (x.isNormal ? (1 << 52) : 0))
        let exponent = Int(x.exponentBitPattern) - (x.isNormal ? 1075 : 1074)
        let (product, overflow) = significand.multipliedReportingOverflow(by: scale)
        guard !overflow else { return nil }
        if exponent >= 0 {
            guard exponent < 64, product.leadingZeroBitCount > exponent else { return nil }
            return product << exponent
        }
        let k = -exponent
        guard k < 127 else { return 0 }
        let q = product >> k
        let rem = product - (q << k)
        let half = UInt128(1) << (k - 1)
        return rem >= half ? q + 1 : q
    }
}
