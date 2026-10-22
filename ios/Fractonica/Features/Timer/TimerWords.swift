import FractonicaKit
import Foundation

/// How the Timer and the Stopwatch say things in the current mode (through the shell's `Wording`, so pure mode never
/// prints an Earth time or unit): the names of timers, the moments they ring, the lines of notifications and of the
/// Live Activity.
struct TimerWords {
    let words: Wording
    let clock: RealClock
    /// Real now (device time).
    let now: Date

    var pure: Bool { words.pure }

    /// "4ι", "5 min" (pure: its span on the ladder), "Until 30ι".
    func title(_ spec: TimerSpec) -> String {
        switch spec {
        case .ladder(let span):
            return span.name
        case .earth(let seconds):
            if !pure { return EarthClockText.name(seconds: seconds) }
            guard let blink = clock.blinkSeconds(at: now) else { return "Timer" }
            return LadderSpan(blinks: LadderReadout.ceilBlinks(Double(seconds) / blink)).name
        case .aligned(let target):
            return "Until \(target.name(words.notation))"
        }
    }

    /// The title in words for VoiceOver: "4 Preons", "Until 30ι".
    func spokenTitle(_ spec: TimerSpec) -> String {
        if case .ladder(let span) = spec { return span.spoken }
        return title(spec)
    }

    /// Where a moment falls: "14:23:07" (another day: "Oct 9 14:23") · pure "34η 30ι 12λ" (another Nuclide: a short
    /// letter date). "—" outside the catalogue in pure mode.
    func moment(_ date: Date) -> String {
        let t = clock.t(date)
        if pure && !clock.clock.inRange(t) { return "—" }
        return words.label(t, relativeTo: clock.t(now))
    }

    /// The Fractonica clock at a moment, "34η 30ι 12λ" (both modes; "—" outside the catalogue).
    func clockReading(_ date: Date, upTo: String = "lambda") -> String {
        words.notation.clockText(at: clock.t(date), upTo: upTo)
    }

    /// When a running timer rings: "14:23:07 · 34η 30ι" (`short`: "14:23 · 34η 30ι") · pure "34η 30ι 12λ".
    func ringTime(_ end: Date, short: Bool = false, withReading: Bool = true) -> String {
        if pure { return moment(end) }
        let t = clock.t(end)
        let earth = short && words.earth.label(t, ref: clock.t(now)).count <= 8 ? words.earth.time(t, seconds: false) : moment(end)
        guard withReading else { return earth }
        let fractonica = clockReading(end, upTo: "iota")
        return fractonica == "—" ? earth : "\(earth) · \(fractonica)"
    }

    /// A ladder span of whole Blinks as a countdown readout: "02ι 13λ 07ν".
    func readout(blinks: Int, lead: LadderUnit) -> String {
        LadderSpan(blinks: blinks).readout(from: lead)
    }

    // MARK: Notifications

    /// The notification of a run: "Timer done" / "4ι · 34η 30ι 12λ".
    func notificationBody(_ run: TimerRun) -> String {
        switch run.spec {
        case .aligned(let target):
            return "\(target.name(words.notation)) begins"
        default:
            let title = title(run.spec)
            guard let end = run.end else { return title }
            return "\(title) · rang at \(pure ? clockReading(end) : moment(end))"
        }
    }
}
