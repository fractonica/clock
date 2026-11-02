#!/usr/bin/env swift
// Synthesises the ringtones of Moments' calls (Features/Journal/Moments, `MomentRingtone`) into
// ios/Fractonica/Resources/Moments/ring-<name>.caf:
//
//     swift ios/scripts/make-ringtones.swift            (from any directory)
//
// Each is 7 rings of half a mean Flavon (3.886 s, 27.2 s in all: a notification's or an alarm's sound must stay under
// 30 s), every ring the same and the last one's tail wrapped round into the first, so the file loops seamlessly in the
// app. Mono IMA4 at 22.05 kHz in a CAF (afconvert), a format both notification sounds and AlarmKit take.
//
//   helion   two rings of four glass strikes climbing the harmonic ladder 4 : 5 : 7 : 9 (the timer chime's chord)
//   bell     an old telephone's bell: a clapper between two bells at 25 strikes a second, ring-ring
//   marimba  a figure on the ladder's 8 : 10 : 12 : 14 played on a marimba, twice
//   pulse    soft electronic pulses, a major third warbling, beep-beep
import Foundation

let scriptURL = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
let out = scriptURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Fractonica/Resources/Moments")
let rate = 22_050.0
/// Half a mean Flavon (`MomentRingtone.cycle`).
let cycle = 7.771_5 / 2
let rings = 7
let count = Int((cycle * Double(rings) * rate).rounded())

/// A ring's sound, as (onset seconds within the ring, sample function of the time since the onset, its length).
struct Voice {
    var onset: Double
    var length: Double
    var sample: (Double) -> Double
}

/// Renders `voices` once per ring, a tail past the file's end wrapped to its start, normalised to a peak of 0.9.
func render(_ voices: [Voice]) -> [Float] {
    var buffer = [Double](repeating: 0, count: count)
    for ring in 0..<rings {
        for v in voices {
            let first = Int(((Double(ring) * cycle + v.onset) * rate).rounded())
            let n = Int(v.length * rate)
            for i in 0..<n {
                buffer[(first + i) % count] += v.sample(Double(i) / rate)
            }
        }
    }
    let peak = buffer.map(abs).max() ?? 1
    return buffer.map { Float(0.9 * $0 / max(peak, 1e-9)) }
}

/// A struck tone: partials (ratio, amplitude, decay seconds) of `f`, a few milliseconds' attack.
func strike(_ f: Double, _ partials: [(Double, Double, Double)], attack: Double = 0.003) -> (Double) -> Double {
    { t in
        let a = min(1, t / attack)
        var v = 0.0
        for (ratio, amplitude, decay) in partials { v += amplitude * exp(-t / decay) * sin(2 * .pi * f * ratio * t) }
        return a * v
    }
}

func helion() -> [Float] {
    let base = 196.0
    let glass = [(1.0, 1.0, 0.45), (2.003, 0.32, 0.25), (3.01, 0.1, 0.15)]
    var voices: [Voice] = []
    for (r, onset) in [0.0, 0.62].enumerated() {
        for (i, h) in [4.0, 5.0, 7.0, 9.0].enumerated() {
            let gain = (1 - 0.1 * Double(i)) * (r == 0 ? 1 : 0.85)
            let tone = strike(base * h, glass)
            voices.append(Voice(onset: onset + Double(i) * 0.075, length: 2.2) { gain * tone($0) })
        }
    }
    return render(voices)
}

func bell() -> [Float] {
    // a bell's inharmonic partials; the two bells a little apart
    let partials = [(1.0, 1.0, 0.32), (2.32, 0.55, 0.16), (4.25, 0.3, 0.08), (6.63, 0.16, 0.045)]
    let bells = [strike(1260, partials, attack: 0.001), strike(1420, partials, attack: 0.001)]
    var voices: [Voice] = []
    for onset in [0.0, 0.6] {
        for k in 0..<11 {
            // the clapper's strikes, the first ones a touch harder
            let gain = 0.75 + 0.25 * exp(-Double(k) / 3) + (k % 3 == 1 ? -0.05 : 0)
            let tone = bells[k % 2]
            voices.append(Voice(onset: onset + Double(k) * 0.04, length: 1.4) { gain * tone($0) })
        }
    }
    return render(voices)
}

func marimba() -> [Float] {
    let base = 65.406 // C2: the figure on its harmonics
    let bar = [(1.0, 1.0, 0.5), (3.93, 0.22, 0.06), (9.9, 0.05, 0.018)]
    let figure: [Double] = [8, 10, 12, 14, 12, 10, 9, 12]
    var voices: [Voice] = []
    for (p, start) in [0.0, 1.3].enumerated() {
        for (i, h) in figure.enumerated() {
            let gain = (i == 0 || i == 3 ? 1.0 : 0.82) * (p == 0 ? 1 : 0.9)
            let tone = strike(base * h, bar, attack: 0.002)
            voices.append(Voice(onset: start + Double(i) * 0.13, length: 1.6) { gain * tone($0) })
        }
    }
    return render(voices)
}

func pulse() -> [Float] {
    let low = 880.0, high = 880.0 * 1.26
    func burst(_ t: Double) -> Double {
        let length = 0.42
        guard t < length else { return 0 }
        let envelope = min(1, t / 0.012) * min(1, (length - t) / 0.04)
        // the warble: a sixteenth of a second on each tone
        let f = Int(t * 16) % 2 == 0 ? low : high
        let v = sin(2 * .pi * f * t) + 0.12 * sin(2 * .pi * 3 * f * t)
        return envelope * v
    }
    return render([Voice(onset: 0, length: 0.45, sample: burst), Voice(onset: 0.55, length: 0.45, sample: burst)])
}

/// The samples as a 16-bit mono WAV.
func wav(_ samples: [Float]) -> Data {
    var data = Data()
    func append<T: FixedWidthInteger>(_ value: T) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
    let bytes = samples.count * 2
    data.append(contentsOf: Array("RIFF".utf8))
    append(UInt32(36 + bytes))
    data.append(contentsOf: Array("WAVEfmt ".utf8))
    append(UInt32(16))
    append(UInt16(1))
    append(UInt16(1))
    append(UInt32(rate))
    append(UInt32(rate * 2))
    append(UInt16(2))
    append(UInt16(16))
    data.append(contentsOf: Array("data".utf8))
    append(UInt32(bytes))
    for s in samples { append(Int16(max(-1, min(1, s)) * Float(Int16.max))) }
    return data
}

let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("ringtones-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: tmp) }
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
for (name, make) in [("helion", helion), ("bell", bell), ("marimba", marimba), ("pulse", pulse)] {
    let raw = tmp.appendingPathComponent("\(name).wav")
    try wav(make()).write(to: raw)
    let target = out.appendingPathComponent("ring-\(name).caf")
    try? FileManager.default.removeItem(at: target)
    let convert = Process()
    convert.executableURL = URL(fileURLWithPath: "/usr/bin/afconvert")
    convert.arguments = ["-f", "caff", "-d", "ima4@22050", "-c", "1", raw.path, target.path]
    try convert.run()
    convert.waitUntilExit()
    guard convert.terminationStatus == 0 else { fatalError("afconvert failed for \(name)") }
    let size = (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    print("ring-\(name).caf  \(String(format: "%.1f", Double(count) / rate)) s  \(size / 1024) KB")
}
