import FractonicaKit
import Foundation

/// What the epicycle face reads at an instant: the base cycle the figure is being drawn in and how far into it. Every
/// arm follows from its phase (`EpicycleFigure`). No SwiftUI here: checked by Checks/EpicycleChecks.swift.
struct EpicycleReading: Equatable, Sendable {
    /// The base cycle (its global index), its phase 0 ..< 1 (linear in position, as every level's), start and end.
    let cycle: Int64
    let phase: Double
    let start: Double
    let end: Double
    /// Where the figure stops: 1, or the phase the catalogue ends at in its clipped last cycle.
    let endPhase: Double

    /// Displayed seconds a whole base cycle takes (a clipped one: as if it ran on).
    var seconds: Double { (end - start) / max(endPhase, 1e-9) }

    /// The reading at t; nil outside the catalogue.
    static func at(_ t: Double, base: Int, clock: FractonicaClock = .shared) -> EpicycleReading? {
        guard let b = clock.level(at: t, base) else { return nil }
        var endPhase = 1.0
        if b.clipped, let last = clock.level(at: clock.tMax, base), last.cycle == b.cycle {
            endPhase = max(last.phase, b.phase)
        }
        return EpicycleReading(cycle: b.cycle, phase: min(max(b.phase, 0), 1), start: b.start, end: b.end, endPhase: endPhase)
    }

    /// The traced prefix's step: the figure as drawn up to the start of the running step of `steps` a cycle.
    func cut(steps: Int) -> Int { min(steps, Int((phase * Double(steps)).rounded(.down))) }
}

/// The Pentads in a base cycle long enough to hold Helions (a ζ or longer): where each Pentad begins in it and the
/// running Pentad's stretch, in the base's phase. A Helion of the sync sits (its index − the running one's) Helions
/// from the running one, so the whole cycle's Pentads follow from the reading at t.
struct EpicyclePentads: Equatable, Sendable {
    /// Helions in a base cycle.
    let helions: Int
    /// The Helions (0 ..< helions) of this cycle where a Pentad begins, and which Pentad; empty where there are more
    /// than `maxHelions` (a Delta or longer: too many to mark).
    let starts: [Start]
    /// The running Pentad (0 … 3) and its stretch of the cycle in the base's phase (clamped to the cycle).
    let pentad: Int
    let from: Double
    let to: Double
    /// The base cycle.
    let cycle: Int64

    struct Start: Equatable, Sendable {
        let helion: Int
        let pentad: Int
    }

    /// The most Helions a cycle has for its Pentads to be marked one by one (a Nuclide's 77).
    static let maxHelions = 120

    /// The base's phase where Helion j of the cycle begins.
    func phase(ofHelion j: Int) -> Double { Double(j) / Double(helions) }

    /// The Pentads of the base cycle running at t; nil for a base finer than ζ (a Helion or less: the figure lies in one
    /// Pentad) or outside the catalogue. Without `marks`, only the running Pentad's stretch (no `starts`).
    static func at(_ t: Double, base: Int, endPhase: Double = 1, marks: Bool = true,
                   clock: FractonicaClock = .shared) -> EpicyclePentads? {
        guard base <= 5, let b = clock.level(at: t, base), let h = clock.level(at: t, 6), let p = Pentads.at(t, clock: clock) else { return nil }
        var n = 1
        for level in base..<6 { n *= clock.levelInfo(level).factor }
        let now = Int(h.cycle - b.cycle * Int64(n)) // the running Helion in the cycle
        let within = 5 * p.index + p.helion - 1      // and in its sync
        var starts: [Start] = []
        if marks && n <= maxHelions {
            for j in 0..<n where Double(j) / Double(n) < endPhase {
                let k = ((within + j - now) % 19 + 19) % 19
                if k % 5 == 0 { starts.append(Start(helion: j, pentad: k / 5)) }
            }
        }
        let first = now - (within - 5 * p.index)
        return EpicyclePentads(helions: n, starts: starts, pentad: p.index,
                               from: max(0, Double(first) / Double(n)), to: min(1, Double(first + p.helions) / Double(n)),
                               cycle: b.cycle)
    }
}

/// When the face's layers change next, in displayed time (for `NowTimeline`), and how finely they step.
enum EpicycleCadence {
    /// Steps a base cycle for the traced prefix (redrawn once a step; the motion layer draws the rest of the way to
    /// the pen): 720 (a Helion's every 25 s, half a Preon), fewer when a time-lapse would redraw it more than ten
    /// times a real second.
    static func traceSteps(seconds: Double, speed: Double) -> Int {
        guard seconds > 0, speed != 0 else { return 720 }
        let fast = seconds / (abs(speed) * 0.1)
        return Int(min(720, max(24, fast)).rounded(.down))
    }

    /// The displayed time between two redraws of the moving parts: while the pen moves about a third of a point
    /// (`penSpeed` in reach units a displayed second, `scale` points to the reach), at most one step of the trace, at
    /// least a Blink (`shortestStep`); with Reduce Motion no more often than a real second. (A time-lapse's real
    /// steps are bounded by the timeline's `minimumStep`.)
    static func motionStep(penSpeed: Double, scale: Double, seconds: Double, steps: Int, speed: Double, reduceMotion: Bool) -> Double {
        let points = penSpeed * scale
        var step = points > 0 ? 0.35 / points : seconds / Double(max(steps, 1))
        step = min(step, seconds / Double(max(steps, 1)))
        step = max(step, shortestStep)
        if reduceMotion { step = max(step, abs(speed) * 1.0) }
        return step
    }

    /// The moving parts redraw at most once a Blink of displayed time, as the analog face's hands and the star's spark
    /// step: a full-size canvas redrawn faster keeps the window's display cycle busy (on the Mac, the arms of η … λ
    /// redrawn 6–7 times a second cost ~20 % of a core; once a Blink about 1 %).
    static var shortestStep: Double { Notation.standard.blinkSeconds }

    /// The shortest real time between two redraws of the moving parts during a time-lapse.
    static let lapseStep = 1.0 / 30

    /// The hub's Helion of the sync and the caption: at the running Helion's end.
    static func helion(after t: Double, clock: FractonicaClock = .shared) -> Double? {
        guard let h = clock.level(at: t, 6), h.end > t else { return nil }
        return h.end
    }

    /// The rim's Pentads: when the Pentad or the base cycle changes.
    static func pentads(after t: Double, base: Int, clock: FractonicaClock = .shared) -> Double? {
        [Pentads.change(after: t), clock.level(at: t, base)?.end].compactMap { $0 }.filter { $0.isFinite && $0 > t }.min()
    }
}

/// What the epicycle face says.
enum EpicycleWords {
    /// A level as the face names it: the unit's name ("Helion", "Delta"), else its letter ("θ").
    static func name(_ level: Int) -> String {
        Notation.unit(level: level)?.name ?? Fractonica.periodName(level).text
    }

    /// The arms' letters, base first: "η θ ι κ".
    static func letters(_ figure: EpicycleFigure, onOnly: Bool = true) -> [String] {
        figure.arms.filter { !onOnly || $0.on }.map { Fractonica.periodName($0.level).text }
    }

    /// How often arm `level` turns in a base cycle: "once a Helion", "9 times a Helion", "2,340 times a Helion".
    static func turns(level: Int, cycles: Int, base: Int) -> String {
        let per = cycles == 1 ? "once" : "\(cycles.formatted(.number.locale(Locale(identifier: "en")))) times"
        return "\(per) a \(name(base))"
    }

    /// "2nd Helion of 5".
    static func place(_ p: PentadReading) -> String { PentadWords.place(p) }

    /// What VoiceOver reads: "Epicycles of η, θ, ι and κ, closing once a Helion. Pentad II, 2nd Helion of 5 · 34η 29ι.
    /// Pentad III in 13 h 04 min." (pure "… in 2η 30ι."): down to the Preon, as it is read again once a Preon.
    static func spoken(_ figure: EpicycleFigure, at t: Double, pure: Bool, notation: Notation = .standard) -> String {
        let letters = letters(figure)
        let list = letters.count < 2 ? letters.joined() : letters.dropLast().joined(separator: ", ") + " and " + (letters.last ?? "")
        var text = "Epicycles of \(list), closing once a \(name(figure.base))."
        if let p = Pentads.at(t, clock: notation.model) {
            text += " \(PentadWords.full(p))\(PentadWords.separator)\(notation.clockText(at: t, upTo: "iota"))."
            if p.end < notation.model.tMax, let countdown = PentadCardModel.countdown(at: t, to: p.end, pure: pure, notation: notation) {
                text += " \(PentadWords.name((p.index + 1) % 4)) \(countdown)."
            }
        }
        return text
    }
}
