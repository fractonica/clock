import Foundation

/// The chime that ends a Focus session, synthesised rather than shipped: two soft bell strikes a fifth apart, the
/// lower one last, as a 16-bit mono WAV. Pure (checked by FocusChecks); FocusChimePlayer plays it.
enum FocusChimeSynth {
    struct Partial {
        /// Frequency relative to the strike's fundamental.
        var ratio: Double
        var amplitude: Double
        /// Decay time constant, seconds.
        var decay: Double
    }

    /// A struck bell's partials: a slightly beating fundamental, the octave and the bell's minor-third-ish hum
    /// partials, the high ones dying fast.
    static let bell: [Partial] = [
        Partial(ratio: 1.0, amplitude: 1.0, decay: 1.9),
        Partial(ratio: 1.0034, amplitude: 0.45, decay: 1.6),
        Partial(ratio: 2.0, amplitude: 0.22, decay: 1.0),
        Partial(ratio: 2.76, amplitude: 0.26, decay: 0.75),
        Partial(ratio: 5.40, amplitude: 0.09, decay: 0.32),
        Partial(ratio: 8.93, amplitude: 0.04, decay: 0.18),
    ]

    /// The two strikes: (fundamental Hz, delay s, gain).
    static let strikes: [(frequency: Double, delay: Double, gain: Double)] = [(792, 0, 0.7), (528, 0.24, 1.0)]

    static let sampleRate = 44_100
    static let seconds = 3.6
    /// Peak level of the result, 0 … 1.
    static let peak = 0.42

    /// The samples, −1 … 1.
    static func samples() -> [Float] {
        let count = Int(Double(sampleRate) * seconds)
        var out = [Double](repeating: 0, count: count)
        let attack = 0.004
        let release = 0.35
        for strike in strikes {
            let start = Int(strike.delay * Double(sampleRate))
            for n in start..<count {
                let t = Double(n - start) / Double(sampleRate)
                var v = 0.0
                for p in bell {
                    v += p.amplitude * exp(-t / p.decay) * sin(2 * .pi * strike.frequency * p.ratio * t)
                }
                let envelope = min(1, t / attack)
                out[n] += v * envelope * strike.gain
            }
        }
        let tail = Double(count) / Double(sampleRate) - release
        let top = out.map(abs).max() ?? 1
        let scale = top > 0 ? peak / top : 0
        return out.enumerated().map { n, v in
            let t = Double(n) / Double(sampleRate)
            let fade = t > tail ? max(0, 1 - (t - tail) / release) : 1
            return Float(v * scale * fade)
        }
    }

    /// The chime as a WAV file (RIFF, PCM 16-bit mono).
    static func wav() -> Data {
        let pcm = samples().map { Int16(max(-1, min(1, $0)) * Float(Int16.max)) }
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) {
            withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
        }
        let bytes = pcm.count * 2
        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + bytes))
        data.append(contentsOf: Array("WAVE".utf8))
        data.append(contentsOf: Array("fmt ".utf8))
        append(UInt32(16))
        append(UInt16(1))                      // PCM
        append(UInt16(1))                      // mono
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2))         // byte rate
        append(UInt16(2))                      // block align
        append(UInt16(16))                     // bits per sample
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(bytes))
        for sample in pcm { append(sample) }
        return data
    }
}
