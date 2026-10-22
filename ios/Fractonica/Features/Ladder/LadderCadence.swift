import Foundation

/// How often the ladder's live parts redraw: the slowest cadence that keeps the finest visible change honest.
enum LadderCadence {
    /// The cadence of the slow ladder rows and of Up next near a change (countdowns tick at ~4 Hz).
    static let readout = 0.25

    /// Up next's cadence while nothing it shows is about to change: its countdowns show whole seconds at the finest
    /// (each update relays out the card, so ticking 4 times a second for nothing is not free).
    static let upNextCalm = 1.0

    /// Up next's cadence: `readout` while its next turnover or the selected level's next threshold is under ten
    /// seconds (plus one calm tick of lookahead) away, so the list moves on and the strip changes quarter promptly;
    /// `upNextCalm` otherwise. `untilNext` is the displayed time to the nearer of the two (nil: neither).
    static func upNext(untilNext: Double?) -> Double {
        guard let untilNext, untilNext.isFinite else { return upNextCalm }
        return untilNext < 10 + upNextCalm ? readout : upNextCalm
    }

    /// Displayed seconds between redraws of an open ladder row (its details tick too): about one device pixel of its
    /// bar (a bar ~ 2000 px wide at most), never slower than `readout` and every frame (nil) when that is under 1/60 s,
    /// i.e. for cycles shorter than ~33 s (κ, λ, μ, ν, ξ).
    static func row(meanSeconds: Double) -> Double? {
        guard let pixel = pixel(meanSeconds: meanSeconds) else { return nil }
        return min(readout, pixel)
    }

    /// Displayed seconds between redraws of a closed ladder row: the faster of what its bar needs (one device pixel)
    /// and what its countdown needs (`textStep`); every frame (nil) for cycles shorter than ~33 s. Slow rows then redraw
    /// once a minute or once a second, on the clock's own second, instead of four times a second for nothing.
    static func row(meanSeconds: Double, remaining: Double, pure: Bool) -> Double? {
        guard let pixel = pixel(meanSeconds: meanSeconds) else { return nil }
        return min(pixel, textStep(remaining: remaining, pure: pure))
    }

    /// How often a ladder countdown of `remaining` displayed seconds changes, rounded down to the cadences used: once a
    /// minute while its finest part is an hour or coarser (Earth "3 d 04 h", "19.3 y"; pure "43η 6ι" and coarser, from
    /// one ε on), once a second down to the last seconds, `readout` for the fast pure counts under two λ ("12ν").
    /// (The last ten seconds or Blinks, with decimals, tick faster by themselves: `countdown`.)
    static func textStep(remaining: Double, pure: Bool) -> Double {
        if pure {
            if remaining >= pureMinute { return 60 }
            return remaining >= pureSecond ? 1 : readout
        }
        return remaining >= 86_400 ? 60 : 1
    }

    /// One ε, beyond which a pure countdown's finest part is an η or coarser (statistically: an ι when the η count is
    /// 0, still more than eight minutes a step).
    static let pureMinute = 1_400_544.3
    /// Two λ: below it a pure countdown counts ν (a third of a second each).
    static let pureSecond = 2 * 7.773

    /// One device pixel of a bar (~ 2000 px at most), nil when that is under a display frame.
    private static func pixel(meanSeconds: Double) -> Double? {
        let pixel = meanSeconds / 2000
        return pixel < 1.0 / 60 ? nil : pixel
    }

    /// A finer cadence a countdown needs near its end, when it changes faster than its container redraws: Earth
    /// countdowns show tenths below 10 s, pure ones decimal Blinks below ten Blinks. `container` is the container's
    /// interval (it looks one interval ahead, so the switch is never late); nil when the container is fine enough.
    static func countdown(remaining: Double, pure: Bool, blinkSeconds: Double, container: Double) -> Double? {
        guard remaining > 0, remaining.isFinite else { return nil }
        if pure { return remaining < 10 * blinkSeconds + container ? 1.0 / 30 : nil }
        return remaining < 10 + container ? 0.1 : nil
    }

    /// Cycles shorter than this are too fast to count down or to follow: their rows show how long one lasts.
    static let stillBelow = 0.5
}
