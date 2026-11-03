import FractonicaKit
import Foundation

// A moment's reel: the film around the moment — both cameras at once with its sound, a frame each Sub-blink (ξ,
// 44.4 ms) — made into one video, the selfie camera's square over the back camera's. An answered call's reel plays the
// film (from the pick-up to the hang-up) forward at real time, a chime at the moment (Half-Life 2's suit charging), then
// at once backwards to where it began, the chime again as it passes the moment. A muted call's plays its film (from the
// press to a Flavon after the moment) once at real time, the chime at the moment. Picked up after its moment, a film has
// no moment in it: no chimes, marked missed. Its frames last a Sub-blink too, so each shows the next filmed one and its
// ξ count rolls over. The sound plays along (backwards on the way back). Each frame wears its date and its time down to
// the ξ at the top.
// This file is the reel's arithmetic and words (no AVFoundation: checked by Moments/Checks); MomentReelRenderer makes
// the video.
//
// Source time u runs over the filmed seconds around the clip's centre c (the moment), u ∈ [−B, A]: B filmed before it,
// A after. At output time τ the forward pass shows u = τ − B, a pass lasting P = B + A; the backward pass is the forward
// one played in reverse, u = (2P − τ) − B.

/// The reel as a journal entry's media: a video named `reel` (hub/API.md).
enum MomentReel {
    static let name = "reel"
}

/// The reel's timing: which source instant each output frame shows.
struct MomentReelTiming: Sendable {
    /// Seconds filmed before the moment (B) and after it (A).
    let before: Double
    let after: Double
    /// An output frame's length, in seconds: a Sub-blink.
    let frame: Double
    /// Played back once it has played forward.
    let backward: Bool

    init(before: Double, after: Double, frame: Double = MomentReelTiming.subBlink, backward: Bool = true) {
        self.before = max(before, 0)
        self.after = max(after, 0)
        self.frame = max(frame, 1e-3)
        self.backward = backward
    }

    /// Each pass's length, in output seconds: the film's own.
    var passDuration: Double { before + after }

    /// The whole reel, its passes, in output seconds.
    var duration: Double { backward ? 2 * passDuration : passDuration }

    /// A Sub-blink (ξ, 44.4 ms): the film's and the reel's frame.
    static var subBlink: Double { FractonicaClock.shared.levelInfo(13).meanSeconds }

    /// Output frames in the reel.
    var frameCount: Int { max(1, Int((duration / frame).rounded())) }

    /// When the moment shows in each pass (output seconds) — where the chimes start.
    var moments: [Double] { backward ? [before, duration - before] : [before] }

    /// The source instant u (seconds from the moment) shown at output time τ, and whether it is the backward pass.
    func source(at tau: Double) -> (u: Double, backward: Bool) {
        let t = min(max(tau, 0), duration)
        if t <= passDuration { return (t - before, false) }
        // going back is going forward, played in reverse
        return (duration - t - before, true)
    }

    /// The output frame times, in seconds.
    func frameTime(_ k: Int) -> Double { Double(k) * frame }
}

/// The words on the reel's frames.
enum MomentReelText {
    /// "α6 β4 γ9 δ4 ε1": the date, its letters without the cycles' marks.
    static func date(at t: Double, notation: Notation) -> String {
        notation.stamp(at: t, upTo: "epsilon").replacingOccurrences(of: "#", with: "")
    }

    /// The mark on a reel filmed after its moment had passed (a call muted late).
    static let missed = "MISSED"

    /// "62η 4ι 29λ 4ν 3ξ": the Helion, Preon, Flavon, Blink and Sub-blink.
    static func time(at t: Double, notation: Notation, clock: FractonicaClock = .shared) -> String {
        guard let c = notation.clock(at: t), let xi = clock.level(at: t, 13) else { return "—" }
        return "\(c.eta)η \(c.iota)ι \(c.lambda)λ \(c.nu)ν \(xi.local)ξ"
    }

    /// Where filmed frame i (Unix time `times[i]`) is read: the middle of the Sub-blink it opens, found from the first
    /// frame's place in its Sub-blink — frames a Sub-blink apart then read one ξ apart, however they jitter.
    static func readAt(_ t: Double, first: Double, frame: Double, clock: FractonicaClock = .shared) -> Double {
        let phase = clock.level(at: first, 13)?.phase ?? 0.5
        return t + (0.5 - phase) * frame
    }
}

/// Which filmed frames an output frame blends: the frame at or before source time u and the next, with the next one's
/// weight. Times outside the filmed span hold the first or the last frame.
enum MomentReelFrames {
    static func pick(_ times: [Double], _ u: Double) -> (a: Int, b: Int, weight: Double) {
        guard let first = times.first, let last = times.last else { return (0, 0, 0) }
        if u <= first { return (0, 0, 0) }
        if u >= last { return (times.count - 1, times.count - 1, 0) }
        var lo = 0, hi = times.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if times[mid] <= u { lo = mid } else { hi = mid }
        }
        let span = times[hi] - times[lo]
        let w = span > 0 ? (u - times[lo]) / span : 0
        return (lo, hi, min(1, max(0, w)))
    }
}
