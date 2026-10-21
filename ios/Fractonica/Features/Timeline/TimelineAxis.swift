import FractonicaKit
import Foundation

// The Gregorian axis of the timeline (src/ui/timeline/helpers.js): adaptive steps from milliseconds to centuries,
// zone-aware ticks and the context row above them. Local days are real local days (a DST day lasts 23 or 25 hours);
// nothing here assumes 86 400 s except where a comment says so. Pure-mode ticks come from `TimelineRuler` instead.

/// A labelled tick: its instant, its labels (longest first) and whether it also starts the next larger unit.
struct TimelineTick: Sendable, Equatable {
    let t: Double
    let labels: [String]
    let major: Bool
}

/// A stretch of the context row (a day, a month, a Delta quarter …) with its labels, longest first. `ord` is a
/// stable ordinal (consecutive spans differ by one) for alternate shading.
struct TimelineSpan: Sendable, Equatable {
    let t0: Double
    let t1: Double
    let labels: [String]
    let ord: Int
    /// 0 = Sunday for Gregorian days; −1 otherwise.
    var weekday: Int = -1
}

/// A step of the Gregorian axis: a unit and a multiple of it.
struct GregorianStep: Hashable, Sendable {
    enum Unit: String, Sendable {
        case ms, s, min, h, day, week, month, year

        /// Nominal length in seconds (a Julian year, a twelfth of it for a month).
        var seconds: Double {
            switch self {
            case .ms: 0.001
            case .s: 1
            case .min: 60
            case .h: 3600
            case .day: 86_400
            case .week: 7 * 86_400
            case .month: GregorianStep.month
            case .year: GregorianStep.year
            }
        }

        /// The typical label length in characters: how far apart ticks must be.
        var chars: Int {
            switch self {
            case .ms: 7
            case .s: 8
            case .min, .h, .day, .week: 5
            case .month: 3
            case .year: 4
            }
        }
    }

    /// The unit of the context row above the ticks.
    enum Context: Sendable { case minute, day, month, year, decade, century }

    let unit: Unit
    let n: Int

    var id: String { "\(unit.rawValue)\(n)" }
    var nominal: Double { unit.seconds * Double(n) }

    static let day = 86_400.0
    static let year = 31_557_600.0
    static let month = 2_629_800.0

    /// Every step, finest first (helpers.js `STEPS`).
    static let all: [GregorianStep] = [
        (Unit.ms, [1, 2, 5, 10, 20, 50, 100, 200, 500]),
        (.s, [1, 2, 5, 10, 15, 30]),
        (.min, [1, 2, 5, 10, 15, 30]),
        (.h, [1, 2, 3, 6, 12]),
        (.day, [1]),
        (.week, [1]),
        (.month, [1, 3, 6]),
        (.year, [1, 2, 5, 10, 20, 50, 100, 200, 500]),
    ].flatMap { unit, ns in ns.map { GregorianStep(unit: unit, n: $0) } }

    /// The finest step whose labels still have room: `pxPerSec` the scale, `charW` the width of a label character,
    /// `gap` the free space between neighbouring labels.
    static func pick(pxPerSec: Double, charW: Double = 6.6, gap: Double = 18) -> GregorianStep {
        all.first { $0.nominal * pxPerSec >= Double($0.unit.chars) * charW + gap } ?? all[all.count - 1]
    }

    /// The finer, unlabelled step drawn as small ticks between the labelled ones.
    var minor: GregorianStep? {
        let table: [String: (Unit, Int)] = [
            "ms2": (.ms, 1), "ms5": (.ms, 1), "ms10": (.ms, 2), "ms20": (.ms, 5), "ms50": (.ms, 10), "ms100": (.ms, 20),
            "ms200": (.ms, 50), "ms500": (.ms, 100),
            "s1": (.ms, 100), "s2": (.s, 1), "s5": (.s, 1), "s10": (.s, 2), "s15": (.s, 5), "s30": (.s, 10),
            "min1": (.s, 10), "min2": (.min, 1), "min5": (.min, 1), "min10": (.min, 2), "min15": (.min, 5), "min30": (.min, 5),
            "h1": (.min, 15), "h2": (.h, 1), "h3": (.h, 1), "h6": (.h, 1), "h12": (.h, 3),
            "day1": (.h, 6), "week1": (.day, 1), "month1": (.day, 1), "month3": (.month, 1), "month6": (.month, 1),
            "year1": (.month, 1), "year2": (.year, 1), "year5": (.year, 1), "year10": (.year, 1), "year20": (.year, 5),
            "year50": (.year, 10), "year100": (.year, 10), "year200": (.year, 50), "year500": (.year, 100),
        ]
        return table[id].map { GregorianStep(unit: $0.0, n: $0.1) }
    }

    /// The unit of the context row for this step (helpers.js `contextUnitOf`).
    var context: Context? {
        switch unit {
        case .ms, .s: .minute
        case .min, .h: .day
        case .day, .week: .month
        case .month: .year
        case .year: n <= 5 ? .decade : n <= 20 ? .century : nil
        }
    }
}

/// Zone-aware generation of the Gregorian axis.
enum GregorianAxis {
    private static let months = EarthTime.monthsShort
    private static let monthsLong = EarthTime.monthsLong
    private static let weekdays = EarthTime.weekdaysShort

    private static func pad2(_ n: Int) -> String { n < 10 ? "0\(n)" : "\(n)" }
    private static func pad3(_ n: Int) -> String { n < 10 ? "00\(n)" : n < 100 ? "0\(n)" : "\(n)" }
    private static func mod(_ a: Int64, _ b: Int64) -> Int64 { ((a % b) + b) % b }

    /// Calendar fields of a whole day count since 1970-01-01.
    private static func fields(days: Int) -> (y: Int, m: Int, d: Int, wd: Int) {
        let (y, m, d) = EarthTime.civilFromDays(days)
        return (y, m, d, Int(mod(Int64(days) + 4, 7)))
    }

    private static func addDays(_ y: Int, _ m: Int, _ d: Int, _ n: Int) -> (Int, Int, Int) {
        EarthTime.civilFromDays(EarthTime.daysFromCivil(y, m, d) + n)
    }

    private static func weekday(_ y: Int, _ m: Int, _ d: Int) -> Int {
        Int(mod(Int64(EarthTime.daysFromCivil(y, m, d)) + 4, 7))
    }

    private static func civil(_ fmt: EarthFormatter, _ y: Int, _ m: Int, _ d: Int) -> Double {
        fmt.toUnix(EarthTime.CivilTime(year: y, month: m, day: d))
    }

    /// Piecewise-constant UTC offsets over [from, to]: (from, to, offset), each change located to the second, so sub-day
    /// ticks align to local wall-clock multiples across a DST change (helpers.js `offsetSegments`).
    static func offsetSegments(_ fmt: EarthFormatter, from: Double, to: Double) -> [(from: Double, to: Double, offset: Int)] {
        var segments: [(from: Double, to: Double, offset: Int)] = []
        var a = from
        var oa = fmt.parts(a).offset
        var b = from
        while b < to {
            let nb = min(to, b + 86_400) // changes are never closer together than a day
            let ob = fmt.parts(nb).offset
            if ob != oa {
                var lo = b.rounded(.down), hi = nb.rounded(.up)
                while hi - lo > 1 {
                    let mid = ((lo + hi) / 2).rounded(.down)
                    if fmt.parts(mid).offset == oa { lo = mid } else { hi = mid }
                }
                segments.append((a, hi, oa))
                a = hi
                oa = ob
            }
            b = nb
        }
        segments.append((a, max(to, a), oa))
        return segments
    }

    /// Instants in [from, to] where the local wall clock is a multiple of `stepMs` milliseconds: (Unix ms, local ms).
    /// A fall-back hour yields its ticks twice; a spring-forward gap has none.
    static func alignedTicks(stepMs: Int64, from: Double, to: Double, _ fmt: EarthFormatter) -> [(tms: Int64, lms: Int64)] {
        var out: [(tms: Int64, lms: Int64)] = []
        let fromMs = Int64((from * 1000).rounded(.down))
        let toMs = Int64((to * 1000).rounded(.up))
        for seg in offsetSegments(fmt, from: from, to: to) {
            let off = Int64(seg.offset) * 1000
            let lo = max(Int64((seg.from * 1000).rounded()), fromMs)
            let hi = min(Int64((seg.to * 1000).rounded()), toMs)
            guard hi > lo else { continue }
            // ceil((lo + off) / stepMs) in integers
            let num = lo + off
            var k = num >= 0 ? (num + stepMs - 1) / stepMs : -((-num) / stepMs)
            while out.count < 20_000 {
                let tms = k * stepMs - off
                if tms >= hi { break }
                if tms >= lo { out.append((tms, k * stepMs)) }
                k += 1
            }
        }
        return out
    }

    /// The labelled ticks of `step` in [from, to] (helpers.js `generateTicks`). Labels run longest first; `major`
    /// marks a tick that is also a boundary of the next larger unit.
    static func ticks(_ step: GregorianStep, from: Double, to: Double, _ fmt: EarthFormatter) -> [TimelineTick] {
        var out: [TimelineTick] = []
        switch step.unit {
        case .ms, .s, .min, .h:
            let stepMs = Int64((step.nominal * 1000).rounded())
            for (tms, lms) in alignedTicks(stepMs: stepMs, from: from, to: to, fmt) {
                let dayMs = mod(lms, 86_400_000)
                let hh = Int(dayMs / 3_600_000)
                let mi = Int(dayMs / 60000 % 60)
                let ss = Int(dayMs / 1000 % 60)
                let ms = Int(dayMs % 1000)
                let labels: [String]
                let major: Bool
                switch step.unit {
                case .ms:
                    labels = [":\(pad2(ss)).\(pad3(ms))"]
                    major = ms == 0
                case .s:
                    labels = ["\(pad2(hh)):\(pad2(mi)):\(pad2(ss))", ":\(pad2(ss))"]
                    major = ss == 0
                case .min:
                    labels = ["\(pad2(hh)):\(pad2(mi))"]
                    major = mi == 0
                default:
                    major = hh == 0
                    if major {
                        let f = fields(days: Int((Double(lms) / 86_400_000).rounded(.down)))
                        labels = ["\(weekdays[f.wd]) \(f.d)", "\(f.d)"]
                    } else {
                        labels = ["\(pad2(hh)):00", pad2(hh)]
                    }
                }
                out.append(TimelineTick(t: Double(tms) / 1000, labels: labels, major: major))
            }
            return out
        default:
            break
        }

        let p = fmt.parts(from)
        func push(_ t: Double, _ labels: [String], _ major: Bool) {
            guard t >= from - 1e-6, t <= to + 1e-6 else { return }
            // a skipped local day resolves to the next midnight: keep the day that really starts there
            if let last = out.last, last.t == t { out.removeLast() }
            out.append(TimelineTick(t: t, labels: labels, major: major))
        }
        switch step.unit {
        case .day, .week:
            var (y, m, d) = (p.year, p.month, p.day)
            if step.unit == .week { (y, m, d) = addDays(y, m, d, -Int(mod(Int64(weekday(y, m, d) + 6), 7))) } // Monday
            let inc = step.unit == .week ? 7 : 1
            (y, m, d) = addDays(y, m, d, -inc)
            for _ in 0..<2000 {
                let t = civil(fmt, y, m, d)
                if t > to + 86_400 { break }
                let wd = weekday(y, m, d)
                if step.unit == .day {
                    push(t, ["\(weekdays[wd]) \(d)", "\(d)"], d == 1)
                } else {
                    push(t, ["\(d) \(months[m - 1])", "\(d)"], d <= 7)
                }
                (y, m, d) = addDays(y, m, d, inc)
            }
        case .month:
            var y = p.year
            var m = (p.month - 1) / step.n * step.n + 1 - step.n
            while m < 1 {
                m += 12
                y -= 1
            }
            for _ in 0..<4000 {
                let t = civil(fmt, y, m, 1)
                if t > to + 40 * 86_400 { break }
                push(t, step.n == 1 ? [monthsLong[m - 1], months[m - 1], String(months[m - 1].prefix(1))] : [monthsLong[m - 1], months[m - 1]], m == 1)
                m += step.n
                while m > 12 {
                    m -= 12
                    y += 1
                }
            }
        default: // year
            var y = Int((Double(p.year) / Double(step.n)).rounded(.down)) * step.n - step.n
            let decade = step.n * 10
            for _ in 0..<4000 {
                let t = civil(fmt, y, 1, 1)
                if t > to + 366 * 86_400 * Double(step.n) { break }
                push(t, [String(y)], ((y % decade) + decade) % decade == 0)
                y += step.n
            }
        }
        return out
    }

    /// Calendar spans of a unit overlapping [from, to]: the context row and the weekend shading
    /// (helpers.js `civilSpans`).
    static func spans(_ unit: GregorianStep.Context, from: Double, to: Double, _ fmt: EarthFormatter) -> [TimelineSpan] {
        var out: [TimelineSpan] = []
        if unit == .minute {
            for (tms, lms) in alignedTicks(stepMs: 60_000, from: from - 60, to: to + 60, fmt) {
                let f = fields(days: Int((Double(lms) / 86_400_000).rounded(.down)))
                let dayMs = mod(lms, 86_400_000)
                let hhmm = "\(pad2(Int(dayMs / 3_600_000))):\(pad2(Int(dayMs / 60000 % 60)))"
                let date = "\(f.d) \(months[f.m - 1]) \(f.y)"
                out.append(TimelineSpan(
                    t0: Double(tms) / 1000, t1: Double(tms) / 1000 + 60,
                    labels: ["\(weekdays[f.wd]) \(date) · \(hhmm)", "\(date) · \(hhmm)", hhmm],
                    ord: Int((Double(tms) / 60000).rounded(.down)), weekday: f.wd
                ))
            }
            return out
        }
        let p = fmt.parts(from)
        var (y, m, d) = (p.year, p.month, p.day)
        switch unit {
        case .month: d = 1
        case .year: (m, d) = (1, 1)
        case .decade: (y, m, d) = (Int((Double(y) / 10).rounded(.down)) * 10, 1, 1)
        case .century: (y, m, d) = (Int((Double(y) / 100).rounded(.down)) * 100, 1, 1)
        default: break
        }
        for _ in 0..<4000 {
            var (ny, nm, nd) = (y, m, d)
            switch unit {
            case .day: (ny, nm, nd) = addDays(y, m, d, 1)
            case .month: (ny, nm) = m == 12 ? (y + 1, 1) : (y, m + 1)
            case .year: ny = y + 1
            case .decade: ny = y + 10
            default: ny = y + 100
            }
            let wd = weekday(y, m, d)
            var labels: [String]
            switch unit {
            case .day:
                labels = ["\(weekdays[wd]) \(d) \(months[m - 1]) \(y)", "\(d) \(months[m - 1]) \(y)", "\(weekdays[wd]) \(d)", "\(d)"]
            case .month: labels = ["\(monthsLong[m - 1]) \(y)", "\(months[m - 1]) \(y)", months[m - 1]]
            case .year: labels = [String(y)]
            default: labels = ["\(y)s"]
            }
            let t0 = civil(fmt, y, m, d)
            let t1 = civil(fmt, ny, nm, nd)
            if unit == .day {
                // a DST day is not 24 h long: say so where there is room ("Sun 25 Oct 2026 · 25 h")
                let hours = (t1 - t0) / 3600
                if abs(hours - 24) > 0.01 {
                    let h = (hours * 100).rounded() / 100
                    labels.insert("\(labels[0]) · \(h == h.rounded() ? String(Int(h)) : String(h)) h", at: 0)
                }
            }
            let ord: Int
            switch unit {
            case .day: ord = EarthTime.daysFromCivil(y, m, d)
            case .month: ord = y * 12 + m
            case .year: ord = y
            case .decade: ord = Int((Double(y) / 10).rounded(.down))
            default: ord = Int((Double(y) / 100).rounded(.down))
            }
            if t1 > t0 { out.append(TimelineSpan(t0: t0, t1: t1, labels: labels, ord: ord, weekday: wd)) }
            if t1 >= to { break }
            (y, m, d) = (ny, nm, nd)
        }
        return out
    }

    /// The context row of a step.
    static func context(_ step: GregorianStep, from: Double, to: Double, _ fmt: EarthFormatter) -> [TimelineSpan] {
        step.context.map { spans($0, from: from, to: to, fmt) } ?? []
    }
}
