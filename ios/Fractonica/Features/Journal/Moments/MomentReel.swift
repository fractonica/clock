import FractonicaKit
import Foundation

// A moment's reel: the Flavon around the moment filmed by both cameras at once (half a Flavon before it, half after)
// with its sound, a frame each Sub-blink (ξ, 44.4 ms), made into one video — the selfie camera's square over the back
// camera's — that plays the Flavon forward, slowing towards the moment (a click at it) and back to real time, then at
// once backwards the same way: real time at the ends, slowing through the moment (a click again). Its frames last a
// Sub-blink too, so at real time each shows the next filmed one and its ξ count rolls over; slowed, a filmed frame
// holds for several. The sound follows the picture (deepening as it slows, backwards on the way back). Each frame
// wears its date and its time down to the ξ at the top. This file is the reel's arithmetic and words (no
// AVFoundation: checked by Moments/Checks); MomentReelRenderer makes the video.
//
// Source time u runs over the filmed seconds around the clip's centre c (the moment), u ∈ [−H, H], H half a Flavon;
// x = u / H ∈ [−1, 1]. Both passes show the source at speed s(x) = 1 − (1 − m)·exp(−x² / 2σ²): real time at the ends,
// m (an eighth) at the moment, symmetric about it. Output time spent on dx is H·dx / s, so a pass lasts H·∫ dx / s, and
// the backward pass at output time t is the forward pass at t, mirrored: x_back(t) = −x_forward(t).

/// The reel as a journal entry's media: a video named `reel` (hub/API.md).
enum MomentReel {
    static let name = "reel"
}

/// The reel's timing: which source instant each output frame shows.
struct MomentReelTiming: Sendable {
    /// The slowest speed (at the moment, going forward): an eighth of real time.
    static let slowest = 1.0 / 8
    /// The slowing's width σ, in half-clips: most of it within ±2σ of the moment (±40 % of the clip).
    static let width = 0.2
    /// Grid steps of the integrals.
    private static let steps = 4096

    /// Half the clip, in seconds (H).
    let half: Double
    /// An output frame's length, in seconds: a Sub-blink.
    let frame: Double
    /// Each pass's length, in output seconds.
    let passDuration: Double
    /// ∫ dx / s from −1 to each grid point, in half-clips.
    private let forward: [Double]

    init(half: Double, frame: Double = MomentReelTiming.subBlink) {
        self.half = max(half, 1e-3)
        self.frame = max(frame, 1e-3)
        let n = Self.steps
        let dx = 2.0 / Double(n)
        func x(_ j: Int) -> Double { -1 + Double(j) * dx }
        var f = [0.0]
        f.reserveCapacity(n + 1)
        for j in 0..<n {
            // trapezoids
            f.append(f[j] + dx * (1 / Self.speed(x(j)) + 1 / Self.speed(x(j + 1))) / 2)
        }
        forward = f
        passDuration = self.half * f[n]
    }

    /// Either pass's speed at x (fraction of real time).
    static func speed(_ x: Double) -> Double {
        1 - (1 - slowest) * exp(-x * x / (2 * width * width))
    }

    /// The whole reel, both passes, in output seconds.
    var duration: Double { 2 * passDuration }

    /// A Sub-blink (ξ, 44.4 ms): the film's and the reel's frame.
    static var subBlink: Double { FractonicaClock.shared.levelInfo(13).meanSeconds }

    /// Output frames in the reel.
    var frameCount: Int { max(1, Int((duration / frame).rounded())) }

    /// When the moment shows: the middle of each pass (output seconds) — where the clicks go.
    var moments: [Double] { [passDuration / 2, passDuration * 1.5] }

    /// The source position x (−1 … 1) shown at output time τ, and whether it is the backward pass.
    func source(at tau: Double) -> (x: Double, backward: Bool) {
        let t = min(max(tau, 0), duration)
        if t <= passDuration {
            return (Self.invert(forward, t / half), false)
        }
        // the speed is symmetric about the moment: going back is going forward, mirrored
        return (-Self.invert(forward, (t - passDuration) / half), true)
    }

    /// The source position whose integral (in half-clips) is v, along a table from −1 to 1 (x = −1 + 2k/n).
    private static func invert(_ table: [Double], _ v: Double) -> Double {
        let n = table.count - 1
        guard let last = table.last, v > 0 else { return -1 }
        guard v < last else { return 1 }
        var lo = 0, hi = n
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if table[mid] <= v { lo = mid } else { hi = mid }
        }
        let f = (v - table[lo]) / max(table[hi] - table[lo], 1e-12)
        return -1 + (Double(lo) + f) * 2 / Double(n)
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
