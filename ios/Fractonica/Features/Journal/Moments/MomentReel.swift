import FractonicaKit
import Foundation

// A moment's reel: the film around the moment — both cameras at once with its sound, a frame each Sub-blink (ξ,
// 44.4 ms) — made into one video, the selfie camera's square over the back camera's. An answered call's reel plays the
// film (from the pick-up to the hang-up) forward, slowing towards the moment (a click at it; at most a third slower
// than real time) and back to real time, then at once backwards the same way: real time at the ends, slowing through
// the moment (a click again). A muted call's plays its film (from the press to a Flavon after the moment) once at real
// time, a click at the moment. Picked up after its moment, a film has no moment in it: it slows (answered) at its
// middle, without clicks, marked missed. Its frames last a Sub-blink too, so at real time each shows the next filmed one
// and its ξ count rolls over; slowed, a filmed frame holds for one more now and then. The sound follows the picture
// (deepening as it slows, backwards on the way back). Each frame wears its date and its time down to the ξ at the top.
// This file is the reel's arithmetic and words (no AVFoundation: checked by Moments/Checks); MomentReelRenderer makes
// the video.
//
// Source time u runs over the filmed seconds around the clip's centre c (the moment), u ∈ [−B, A]: B filmed before it,
// A after. Each pass shows the source at speed s(u) = 1 − (1 − m)·exp(−(u/H)² / 2σ²), H half a Flavon whatever was
// filmed (the slowing looks the same): real time far from the moment, m at it (two thirds for an answered call's reel,
// an eighth at its deepest, 1 — no slowing — for a muted call's). Output time spent on du is du / s, so a pass lasts
// ∫ du / s, and the backward pass is the forward one played in reverse: u_back(t) = u_forward(2P − t), P a pass.
// Filmed equally either side, that is the forward pass mirrored about the moment.

/// The reel as a journal entry's media: a video named `reel` (hub/API.md).
enum MomentReel {
    static let name = "reel"
}

/// The reel's timing: which source instant each output frame shows.
struct MomentReelTiming: Sendable {
    /// The deepest slowing (at the moment): an eighth of real time.
    static let deep = 1.0 / 8
    /// An answered call's: at most a third slower than real time.
    static let gentle = 2.0 / 3
    /// The slowing's width σ, in half Flavons: most of it within ±2σ of the moment (±40 % of half a Flavon each way).
    static let width = 0.2
    /// Grid steps of the integrals.
    private static let steps = 4096

    /// Seconds filmed before the moment (B) and after it (A).
    let before: Double
    let after: Double
    /// The slowing's scale (H): half a Flavon.
    let half: Double
    /// An output frame's length, in seconds: a Sub-blink.
    let frame: Double
    /// The speed at the moment (1: none).
    let slowest: Double
    /// Played back once it has played forward.
    let backward: Bool
    /// Each pass's length, in output seconds.
    let passDuration: Double
    /// ∫ du / s from −B to each grid point, in output seconds.
    private let forward: [Double]

    init(before: Double, after: Double, half: Double, frame: Double = MomentReelTiming.subBlink,
         slowest: Double = MomentReelTiming.deep, backward: Bool = true) {
        self.before = max(before, 0)
        self.after = max(after, 0)
        self.half = max(half, 1e-3)
        self.frame = max(frame, 1e-3)
        self.slowest = min(max(slowest, 1e-3), 1)
        self.backward = backward
        let n = Self.steps
        let span = max(self.before + self.after, 1e-3)
        let du = span / Double(n)
        let b = self.before, h = self.half, m = self.slowest
        func s(_ j: Int) -> Double { Self.speed((-b + Double(j) * du) / h, slowest: m) }
        var f = [0.0]
        f.reserveCapacity(n + 1)
        for j in 0..<n {
            // trapezoids
            f.append(f[j] + du * (1 / s(j) + 1 / s(j + 1)) / 2)
        }
        forward = f
        passDuration = f[n]
    }

    /// Filmed `half` either side of the moment, slowing to an eighth.
    init(half: Double, frame: Double = MomentReelTiming.subBlink) {
        self.init(before: half, after: half, half: half, frame: frame)
    }

    /// A pass's speed (fraction of real time) at x = u / H, `slowest` at the moment.
    static func speed(_ x: Double, slowest: Double = deep) -> Double {
        1 - (1 - slowest) * exp(-x * x / (2 * width * width))
    }

    /// The whole reel, its passes, in output seconds.
    var duration: Double { backward ? 2 * passDuration : passDuration }

    /// A Sub-blink (ξ, 44.4 ms): the film's and the reel's frame.
    static var subBlink: Double { FractonicaClock.shared.levelInfo(13).meanSeconds }

    /// Output frames in the reel.
    var frameCount: Int { max(1, Int((duration / frame).rounded())) }

    /// When the moment shows in each pass (output seconds) — where the clicks go.
    var moments: [Double] {
        let t = integral(at: 0)
        return backward ? [t, duration - t] : [t]
    }

    /// The source instant u (seconds from the moment) shown at output time τ, and whether it is the backward pass.
    func source(at tau: Double) -> (u: Double, backward: Bool) {
        let t = min(max(tau, 0), duration)
        if t <= passDuration { return (invert(t), false) }
        // going back is going forward, played in reverse
        return (invert(duration - t), true)
    }

    /// Output seconds of the forward pass up to source instant u.
    private func integral(at u: Double) -> Double {
        let n = forward.count - 1
        let p = min(max((u + before) / max(before + after, 1e-3), 0), 1) * Double(n)
        let j = min(Int(p), n - 1)
        return forward[j] + (forward[j + 1] - forward[j]) * (p - Double(j))
    }

    /// The source instant u whose forward integral is v.
    private func invert(_ v: Double) -> Double {
        let n = forward.count - 1
        guard let last = forward.last, v > 0 else { return -before }
        guard v < last else { return after }
        var lo = 0, hi = n
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if forward[mid] <= v { lo = mid } else { hi = mid }
        }
        let f = (v - forward[lo]) / max(forward[hi] - forward[lo], 1e-12)
        return -before + (Double(lo) + f) * (before + after) / Double(n)
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
