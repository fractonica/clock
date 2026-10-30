import Foundation

// A moment's reel: the Flavon around the moment filmed by both cameras at once (half a Flavon before it, half after),
// made into one video — the selfie camera's square over the back camera's — that plays the Flavon forward, slowing
// towards the moment (a click at it) and back to real time, then plays it backwards with the slowing reflected: slow
// at both ends, real time through the moment (a click again). Each frame wears its stamp at the top and the time to
// the moment in Preons at the foot. This file is the reel's arithmetic (no AVFoundation: checked by Moments/Checks);
// MomentReelRenderer makes the video.
//
// Source time u runs over the filmed seconds around the clip's centre c (the moment), u ∈ [−H, H], H half a Flavon;
// x = u / H ∈ [−1, 1]. The forward pass shows the source at speed s(x) = 1 − (1 − m)·exp(−x² / 2σ²): real time at the
// ends, m (an eighth) at the moment, symmetric about it. The backward pass runs at r(x) = s(1 − |x|): the forward's
// slowness reflected from the middle to the ends. Output time spent on dx is H·dx / speed, so both passes last the
// same, H·∫ dx / s.

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
    /// Output frames a second.
    static let fps = 30.0
    /// Grid steps of the integrals.
    private static let steps = 4096

    /// Half the clip, in seconds (H).
    let half: Double
    /// Each pass's length, in output seconds.
    let passDuration: Double
    /// ∫ dx / s from −1 to each grid point, in half-clips; the backward pass's ∫ dx / r from 1 down to each.
    private let forward: [Double]
    private let backward: [Double]

    init(half: Double) {
        self.half = max(half, 1e-3)
        let n = Self.steps
        let dx = 2.0 / Double(n)
        func x(_ j: Int) -> Double { -1 + Double(j) * dx }
        var f = [0.0], b = [0.0]
        f.reserveCapacity(n + 1)
        b.reserveCapacity(n + 1)
        for j in 0..<n {
            // trapezoids; the backward integral is built from x = 1 downwards (b[k] at x = 1 − k·dx)
            f.append(f[j] + dx * (1 / Self.forwardSpeed(x(j)) + 1 / Self.forwardSpeed(x(j + 1))) / 2)
            b.append(b[j] + dx * (1 / Self.backwardSpeed(x(n - j)) + 1 / Self.backwardSpeed(x(n - j - 1))) / 2)
        }
        forward = f
        backward = b
        passDuration = self.half * f[n]
    }

    /// The forward pass's speed at x (fraction of real time).
    static func forwardSpeed(_ x: Double) -> Double {
        1 - (1 - slowest) * exp(-x * x / (2 * width * width))
    }

    /// The backward pass's speed at x: the forward's, reflected from the middle to the ends.
    static func backwardSpeed(_ x: Double) -> Double {
        forwardSpeed(1 - min(1, abs(x)))
    }

    /// The whole reel, both passes, in output seconds.
    var duration: Double { 2 * passDuration }

    /// Output frames in the reel.
    var frameCount: Int { max(1, Int((duration * Self.fps).rounded())) }

    /// When the moment shows: the middle of each pass (output seconds) — where the clicks go.
    var moments: [Double] { [passDuration / 2, passDuration * 1.5] }

    /// The source position x (−1 … 1) shown at output time τ, and whether it is the backward pass.
    func source(at tau: Double) -> (x: Double, backward: Bool) {
        let t = min(max(tau, 0), duration)
        if t <= passDuration {
            return (Self.invert(forward, t / half), false)
        }
        // the backward table runs from x = 1 down, so its inversion comes out mirrored: −x
        let mirrored = Self.invert(backward, (t - passDuration) / half)
        return (-mirrored, true)
    }

    /// The source position whose integral (in half-clips) is v, along a table from −1 to 1 (x = −1 + 2k/n); for the
    /// backward table the same arithmetic gives its distance from 1, returned as −x by `source`.
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
    func frameTime(_ k: Int) -> Double { Double(k) / Self.fps }
}

/// The reel's labels and frame choice.
enum MomentReelText {
    /// The time to the moment in Preons, signed as a countdown: "−0.00769ι" half a Flavon before, "0.00000ι" at it,
    /// "+0.00384ι" after (a Flavon is 1/65 of a Preon, so the reel's whole span is ±0.00769ι).
    static func countdown(seconds: Double, preon: Double) -> String {
        guard preon > 0 else { return "—" }
        let v = seconds / preon
        let digits = String(format: "%.5f", abs(v))
        if digits == "0.00000" { return "0.00000ι" }
        return (v < 0 ? "\u{2212}" : "+") + digits + "ι"
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
