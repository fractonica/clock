import Foundation

/// How often the ladder's live parts redraw: the slowest cadence that keeps the finest visible change honest.
enum LadderCadence {
    /// The cadence of Up next and of the slow ladder rows (countdowns tick at ~4 Hz).
    static let readout = 0.25

    /// Displayed seconds between redraws of a ladder row: about one device pixel of its bar (a bar ~ 2000 px wide
    /// at most), never slower than `readout` (the countdown) and every frame (nil) when that is under 1/60 s, i.e. for
    /// cycles shorter than ~33 s (κ, λ, μ, ν, ξ).
    static func row(meanSeconds: Double) -> Double? {
        let pixel = meanSeconds / 2000
        return pixel < 1.0 / 60 ? nil : min(readout, pixel)
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
