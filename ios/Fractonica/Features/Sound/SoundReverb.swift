import Foundation

/// A dark, smooth stereo room (RT60 about 2 s) for the audio thread: a 12 ms pre-delay, two diffusing all-passes and an
/// eight-line feedback delay network with a Householder matrix and a gentle low-pass in every line, so high partials die
/// first like in a real hall. It takes the place of the web app's convolution with a noise impulse. All memory is
/// allocated up front; `process` never allocates, locks or waits.
final class SoundReverb: @unchecked Sendable {
    private static let lineMilliseconds: [Double] = [31.7, 37.1, 41.3, 47.9, 53.1, 61.3, 67.7, 73.9]
    private static let lineCount = 8

    private let lines: UnsafeMutablePointer<Float>
    private let lengths: UnsafeMutablePointer<Int>
    private let offsets: UnsafeMutablePointer<Int>
    private let positions: UnsafeMutablePointer<Int>
    private let gains: UnsafeMutablePointer<Float>
    private let lows: UnsafeMutablePointer<Float>
    private let pre: UnsafeMutablePointer<Float>
    private let preLength: Int
    private var prePosition = 0
    private let diffusers: UnsafeMutablePointer<Float>
    private let diffuserLengths: (Int, Int)
    private var diffuserPositions = (0, 0)
    private let total: Int
    /// Low-pass coefficient of the lines: higher is darker.
    private let damping: Float = 0.42

    init(sampleRate: Double, rt60: Double = 2.0) {
        var lengthList: [Int] = []
        for ms in Self.lineMilliseconds {
            var n = Int((ms / 1000 * sampleRate).rounded())
            if n % 2 == 0 { n += 1 }
            lengthList.append(n)
        }
        total = lengthList.reduce(0, +)
        lines = .allocate(capacity: total)
        lines.initialize(repeating: 0, count: total)
        lengths = .allocate(capacity: Self.lineCount)
        offsets = .allocate(capacity: Self.lineCount)
        positions = .allocate(capacity: Self.lineCount)
        gains = .allocate(capacity: Self.lineCount)
        lows = .allocate(capacity: Self.lineCount)
        var offset = 0
        for (k, n) in lengthList.enumerated() {
            lengths[k] = n
            offsets[k] = offset
            positions[k] = 0
            // −60 dB after rt60 seconds of round trips through this line
            gains[k] = Float(pow(10, -3 * Double(n) / (rt60 * sampleRate)))
            lows[k] = 0
            offset += n
        }
        preLength = max(1, Int(0.012 * sampleRate))
        pre = .allocate(capacity: preLength)
        pre.initialize(repeating: 0, count: preLength)
        let d1 = max(1, Int(0.0047 * sampleRate))
        let d2 = max(1, Int(0.0017 * sampleRate))
        diffuserLengths = (d1, d2)
        diffusers = .allocate(capacity: d1 + d2)
        diffusers.initialize(repeating: 0, count: d1 + d2)
    }

    deinit {
        lines.deallocate()
        lengths.deallocate()
        offsets.deallocate()
        positions.deallocate()
        gains.deallocate()
        lows.deallocate()
        pre.deallocate()
        diffusers.deallocate()
    }

    /// Empties the room (the tail never comes back after a stop).
    func clear() {
        lines.update(repeating: 0, count: total)
        pre.update(repeating: 0, count: preLength)
        diffusers.update(repeating: 0, count: diffuserLengths.0 + diffuserLengths.1)
        for k in 0..<Self.lineCount { lows[k] = 0 }
    }

    /// Mono `input` in, stereo wet signal out (written, not added).
    func process(_ input: UnsafePointer<Float>, left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, count: Int) {
        let g: Float = 0.6
        let (d1, d2) = diffuserLengths
        let a = damping
        let b = 1 - damping
        var o = (Float(0), Float(0), Float(0), Float(0), Float(0), Float(0), Float(0), Float(0))
        var prePosition = self.prePosition
        var (p1, p2) = diffuserPositions
        defer {
            self.prePosition = prePosition
            diffuserPositions = (p1, p2)
        }
        for i in 0..<count {
            // pre-delay
            var x = pre[prePosition]
            pre[prePosition] = input[i]
            prePosition += 1
            if prePosition == preLength { prePosition = 0 }
            // two Schroeder all-passes smear the onset
            let y1 = diffusers[p1]
            let v1 = x + g * y1
            diffusers[p1] = v1
            x = y1 - g * v1
            p1 = p1 + 1 == d1 ? 0 : p1 + 1
            let y2 = diffusers[d1 + p2]
            let v2 = x + g * y2
            diffusers[d1 + p2] = v2
            x = y2 - g * v2
            p2 = p2 + 1 == d2 ? 0 : p2 + 1

            // read and damp every line
            func tap(_ k: Int) -> Float {
                let raw = lines[offsets[k] + positions[k]]
                let low = b * raw + a * lows[k]
                lows[k] = low
                return low
            }
            o = (tap(0), tap(1), tap(2), tap(3), tap(4), tap(5), tap(6), tap(7))
            let sum = o.0 + o.1 + o.2 + o.3 + o.4 + o.5 + o.6 + o.7
            let h = sum * 0.25 // Householder: y = x − (2 / N) Σx
            let input = x * 0.35
            func feed(_ k: Int, _ value: Float, _ sign: Float) {
                let p = positions[k]
                lines[offsets[k] + p] = (value - h) * gains[k] + sign * input
                positions[k] = p + 1 == lengths[k] ? 0 : p + 1
            }
            feed(0, o.0, 1)
            feed(1, o.1, -1)
            feed(2, o.2, 1)
            feed(3, o.3, -1)
            feed(4, o.4, 1)
            feed(5, o.5, -1)
            feed(6, o.6, 1)
            feed(7, o.7, -1)
            left[i] = (o.0 - o.2 + o.4 - o.6) * 0.5
            right[i] = (o.1 - o.3 + o.5 - o.7) * 0.5
        }
    }
}
