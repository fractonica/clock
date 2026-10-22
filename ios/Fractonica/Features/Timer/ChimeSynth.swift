import Foundation

/// The timer's chime, synthesised: two rings of four glass-like strikes climbing the harmonic series 4 : 5 : 7 : 9 of
/// one low tone (a chord the ladder's own factors build), each strike a fundamental with two soft overtones and a bell
/// decay. Written once as a 16-bit mono WAV, which serves both the app and its notifications (`UNNotificationSound`
/// finds it in Library/Sounds). Pure, so the checks can look at the file.
enum ChimeSynth {
    static let sampleRate = 44_100
    /// Seconds; a notification sound must stay under 30.
    static let duration = 3.1
    /// The low tone whose harmonics ring.
    static let base = 165.0
    static let harmonics = [4.0, 5.0, 7.0, 9.0]
    /// Seconds between strikes of a ring, and between the two rings.
    static let strikeGap = 0.11
    static let ringGap = 1.5

    /// The samples, −1 … 1.
    static func samples() -> [Float] {
        let count = Int(duration * Double(sampleRate))
        var out = [Float](repeating: 0, count: count)
        let partials: [(ratio: Double, amplitude: Double, decay: Double)] = [(1, 1, 0.55), (2.003, 0.32, 0.32), (3.01, 0.1, 0.2)]
        for ring in 0..<2 {
            for (i, harmonic) in harmonics.enumerated() {
                let onset = Double(ring) * ringGap + Double(i) * strikeGap
                let frequency = base * harmonic
                // the later strikes of a ring a little softer, the second ring softer still
                let gain = 0.2 * (1 - 0.12 * Double(i)) * (ring == 0 ? 1 : 0.8)
                let first = Int(onset * Double(sampleRate))
                for n in first..<count {
                    let t = Double(n - first) / Double(sampleRate)
                    let attack = min(1, t / 0.004)
                    var v = 0.0
                    for p in partials {
                        v += p.amplitude * exp(-t / p.decay) * sin(2 * .pi * frequency * p.ratio * t)
                    }
                    out[n] += Float(gain * attack * v)
                }
            }
        }
        // soft limit, then fade the tail to silence
        let fade = Int(0.08 * Double(sampleRate))
        for n in 0..<count {
            var v = Double(out[n])
            v = tanh(1.2 * v) / tanh(1.2)
            if n >= count - fade { v *= Double(count - n) / Double(fade) }
            out[n] = Float(v)
        }
        return out
    }

    /// The chime as a WAV file (RIFF, PCM 16-bit, mono).
    static func wav() -> Data {
        let pcm = samples().map { Int16(max(-1, min(1, $0)) * Float(Int16.max)) }
        var data = Data()
        func append<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        let bytes = pcm.count * 2
        data.append(contentsOf: Array("RIFF".utf8))
        append(UInt32(36 + bytes))
        data.append(contentsOf: Array("WAVEfmt ".utf8))
        append(UInt32(16))
        append(UInt16(1)) // PCM
        append(UInt16(1)) // mono
        append(UInt32(sampleRate))
        append(UInt32(sampleRate * 2))
        append(UInt16(2))
        append(UInt16(16))
        data.append(contentsOf: Array("data".utf8))
        append(UInt32(bytes))
        for sample in pcm { append(sample) }
        return data
    }
}
