import Accelerate
import FractonicaKit
import SwiftUI

/// The live spectrum of what plays (src/ui/sound/scope.js): a log frequency axis from 40 Hz to 8 kHz with the voices
/// of the chord standing on it as ticks in their level colours, as tall as each voice is loud now — so it reads
/// "which cycles sound, where, and how much" even before any sound plays — the measured spectrum in teal over it, and
/// the waveform underneath. Normal mode labels the A's of the keyboard; pure mode the octaves of the ground in pB.
struct SoundScopeView: View {
    let words: SoundWords
    var height: CGFloat

    @Environment(ClockStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The analyser, made on first use: a `@State` initial value is built again every time the parent's body runs
    /// (each slider move), and an FFT setup with its buffers is too much to throw away that often.
    @State private var box = SoundSpectrum.Box()
    private var analyser: SoundSpectrum { box.spectrum }

    private var engine: SoundEngine { .shared }

    var body: some View {
        // the spectrum is measured 30 times a second, also while the clock stands still (the drone keeps sounding)
        SoundTimeline(engine.isRunning ? .continuous(fps: reduceMotion ? 4 : 30) : .animation(fps: 30)) { t in
            let live = SoundLive.at(t, rate: store.rate, prefs: engine.preferences)
            let fresh = engine.isRunning ? analyser.update(engine: engine, now: .now, interval: reduceMotion ? 0.25 : 1.0 / 30) : analyser.clear()
            Canvas { context, size in
                _ = fresh
                draw(&context, size: size, live: live)
            }
        }
        .frame(height: height)
        .accessibilityElement()
        .accessibilityLabel("Spectrum")
        .accessibilityValue(engine.isRunning ? "Live spectrum of the sound; coloured ticks mark the notes of the cycles" : "The notes of the cycles; the spectrum appears while the sound plays")
    }

    private static let fMin = 40.0
    private static let fMax = 8000.0
    private static let dbMin: Float = -100
    private static let dbMax: Float = -12
    private static let waveHeight: CGFloat = 30

    private func draw(_ context: inout GraphicsContext, size: CGSize, live: SoundLive) {
        let prefs = engine.preferences
        let top: CGFloat = 6
        let bottom = size.height - Self.waveHeight - 26
        let specHeight = bottom - top
        let width = size.width
        let span = log(Self.fMax / Self.fMin)
        let x = { (f: Double) in CGFloat(log(f / Self.fMin) / span) * width }

        // grid: the A's (pure: the octaves of the ground, pB over the ratio)
        var lines: [(f: Double, main: String, sub: String)] = []
        if words.pure {
            var k = Int((log2(Self.fMin / prefs.baseHz) - 1e-9).rounded(.up))
            while prefs.baseHz * pow(2, Double(k)) <= Self.fMax {
                let f = prefs.baseHz * pow(2, Double(k))
                var pb = words.pitch(f)
                if k != 0, pb.hasSuffix(" pB") { pb.removeLast(3) }
                lines.append((f, pb, k == 0 ? "ground" : SoundWords.ratioFactor(pow(2, Double(k)))))
                k += 1
            }
        } else {
            lines = [(55, "55", "A1"), (110, "110", "A2"), (220, "220", "A3"), (440, "440", "A4"), (880, "880", "A5"), (1760, "1.76k", "A6"), (3520, "3.52k", "A7")]
        }
        for line in lines {
            let lx = x(line.f).rounded() + 0.5
            var path = Path()
            path.move(to: CGPoint(x: lx, y: top))
            path.addLine(to: CGPoint(x: lx, y: bottom))
            context.stroke(path, with: .color(Theme.line), lineWidth: 1)
            // labels stay inside the canvas: the last octave line stands close to the right edge
            let edge: (x: CGFloat, anchor: UnitPoint) = lx > width - 18 ? (width, .trailing) : lx < 18 ? (0, .leading) : (lx, .center)
            context.draw(Text(line.main).font(.system(size: 9.5).monospacedDigit()).foregroundStyle(Theme.ink3), at: CGPoint(x: edge.x, y: bottom + 9), anchor: edge.anchor)
            context.draw(Text(line.sub).font(.system(size: 9)).foregroundStyle(Theme.ink3.opacity(0.75)), at: CGPoint(x: edge.x, y: bottom + 20), anchor: edge.anchor)
        }
        var axis = Path()
        axis.move(to: CGPoint(x: 0, y: bottom + 0.5))
        axis.addLine(to: CGPoint(x: width, y: bottom + 0.5))
        context.stroke(axis, with: .color(Theme.line2), lineWidth: 1)

        // the measured spectrum
        if engine.isRunning, analyser.hasData {
            let columns = max(2, Int(width / 2))
            var points: [CGPoint] = []
            points.reserveCapacity(columns)
            for c in 0..<columns {
                let f0 = Self.fMin * exp(Double(c) / Double(columns) * span)
                let f1 = Self.fMin * exp(Double(c + 1) / Double(columns) * span)
                let db = analyser.level(from: f0, to: f1)
                let u = CGFloat(min(1, max(0, (db - Self.dbMin) / (Self.dbMax - Self.dbMin))))
                points.append(CGPoint(x: CGFloat(c) / CGFloat(columns) * width, y: bottom - u * specHeight))
            }
            var fill = Path()
            fill.move(to: CGPoint(x: 0, y: bottom))
            for p in points { fill.addLine(to: p) }
            fill.addLine(to: CGPoint(x: width, y: bottom))
            fill.closeSubpath()
            context.fill(fill, with: .linearGradient(Gradient(colors: [Theme.teal.opacity(0.32), Theme.teal.opacity(0.02)]), startPoint: CGPoint(x: 0, y: top), endPoint: CGPoint(x: 0, y: bottom)))
            var curve = Path()
            curve.addLines(points)
            context.stroke(curve, with: .color(Theme.teal), lineWidth: 1.2)
        }

        // the voices: tick height = loudness now
        let rows = SoundTuning.standard
        let ticks = rows.map { row in (row: row, hz: SoundTuning.frequency(row, baseHz: prefs.baseHz)) }.filter { $0.hz >= Self.fMin && $0.hz <= Self.fMax }
        let labelled = soundLabelSlots(ticks.filter { prefs.levels[$0.row.level] }.map { ($0.row.level, x($0.hz)) })
        let moment = momentLevels()
        for tick in ticks {
            let level = tick.row.level
            let on = prefs.levels[level] && prefs.chord
            let loud = on && live.inRange ? live.shown[level] : 0
            let tx = x(tick.hz).rounded() + 0.5
            let h = 4 + CGFloat(loud) * (specHeight - 16)
            let alpha = on ? (engine.isOn ? 0.95 : 0.6) : 0.2
            var stem = Path()
            stem.move(to: CGPoint(x: tx, y: bottom - 1))
            stem.addLine(to: CGPoint(x: tx, y: bottom - h))
            context.stroke(stem, with: .color(Theme.levelColor(level, opacity: alpha, lightness: on ? 0.66 : 0.5)), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            context.fill(Path(ellipseIn: CGRect(x: tx - 2.6, y: bottom - h - 2.6, width: 5.2, height: 5.2)),
                         with: .color(Theme.levelColor(level, opacity: alpha, lightness: on ? 0.72 : 0.5)))
            if moment.contains(level) {
                context.stroke(Path(ellipseIn: CGRect(x: tx - 7, y: bottom - h - 7, width: 14, height: 14)), with: .color(Theme.levelColor(level, lightness: 0.8)), lineWidth: 1.5)
            }
            if labelled.contains(level) {
                context.draw(Text(tick.row.letter).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.levelColor(level, opacity: engine.isOn ? 0.95 : 0.65, lightness: 0.76)),
                             at: CGPoint(x: tx, y: max(top + 6, bottom - h - 10)))
            }
        }

        // the waveform
        let mid = size.height - Self.waveHeight / 2 - 1
        var base = Path()
        base.move(to: CGPoint(x: 0, y: mid + 0.5))
        base.addLine(to: CGPoint(x: width, y: mid + 0.5))
        context.stroke(base, with: .color(Theme.line), lineWidth: 1)
        if engine.isRunning, let wave = analyser.wave(points: Int(width)) {
            var path = Path()
            for (i, v) in wave.enumerated() {
                let p = CGPoint(x: CGFloat(i), y: mid - CGFloat(v) * (Self.waveHeight / 2 - 3))
                if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
            }
            context.stroke(path, with: .color(Theme.teal.opacity(0.85)), lineWidth: 1.1)
        } else {
            let hint = words.pure ? "Turn the sound on to see what plays" : "Turn the sound on to see the spectrum"
            context.draw(Text(hint).font(.caption).foregroundStyle(Theme.ink3), at: CGPoint(x: width / 2, y: mid))
        }
    }

    private func momentLevels() -> Set<Int> {
        guard let moment = engine.moment else { return [] }
        let now = Date.now
        return Set(moment.notes.filter { let age = now.timeIntervalSince(moment.start) - $0.offset; return age >= 0 && age < 0.45 }.map(\.level))
    }
}

/// The spectrum of the latest output: an 8192-point FFT (Hann window) of the renderer's scope ring, smoothed like an
/// analyser node, at most `interval` apart.
@MainActor
final class SoundSpectrum {
    /// A cheap holder that makes its analyser lazily (see `SoundScopeView.box`).
    @MainActor final class Box {
        private var made: SoundSpectrum?

        var spectrum: SoundSpectrum {
            if let made { return made }
            let spectrum = SoundSpectrum()
            made = spectrum
            return spectrum
        }
    }

    private static let log2n = 13
    private static let size = 1 << log2n
    private var samples = [Float](repeating: 0, count: size)
    private var window = vDSP.window(ofType: Float.self, usingSequence: .hanningDenormalized, count: size, isHalfWindow: false)
    private var real = [Float](repeating: 0, count: size / 2)
    private var imaginary = [Float](repeating: 0, count: size / 2)
    private var power = [Float](repeating: 0, count: size / 2)
    /// Smoothed magnitude per bin (linear).
    private var smoothed = [Float](repeating: 0, count: size / 2)
    private let fft = vDSP.FFT(log2n: vDSP_Length(log2n), radix: .radix2, ofType: DSPSplitComplex.self)
    private var last = Date.distantPast
    private(set) var hasData = false
    private var sampleRate = 48000.0

    /// Pulls new samples when `interval` has passed; returns whether the data changed.
    @discardableResult
    func update(engine: SoundEngine, now: Date, interval: Double) -> Bool {
        guard now.timeIntervalSince(last) >= interval else { return false }
        last = now
        sampleRate = engine.sampleRate > 0 ? engine.sampleRate : 48000
        let ok = samples.withUnsafeMutableBufferPointer { engine.copyOutput(into: $0.baseAddress!, count: Self.size) }
        guard ok, let fft else { return false }
        let windowed = vDSP.multiply(samples, window)
        real.withUnsafeMutableBufferPointer { re in
            imaginary.withUnsafeMutableBufferPointer { im in
                var split = DSPSplitComplex(realp: re.baseAddress!, imagp: im.baseAddress!)
                windowed.withUnsafeBufferPointer { input in
                    input.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: Self.size / 2) {
                        vDSP_ctoz($0, 2, &split, 1, vDSP_Length(Self.size / 2))
                    }
                }
                fft.forward(input: split, output: &split)
                power.withUnsafeMutableBufferPointer { out in
                    vDSP_zvmags(&split, 1, out.baseAddress!, 1, vDSP_Length(Self.size / 2))
                }
            }
        }
        // |X| of a full-scale sine with this window and vDSP's ×2 scaling is about n / 2
        let norm = 2 / Float(Self.size)
        for i in power.indices {
            let magnitude = sqrt(power[i]) * norm
            smoothed[i] = hasData ? max(magnitude, smoothed[i] * 0.72 + magnitude * 0.28) : magnitude
        }
        hasData = true
        return true
    }

    /// Forgets the spectrum (the sound stopped).
    @discardableResult
    func clear() -> Bool {
        if hasData {
            hasData = false
            smoothed = [Float](repeating: 0, count: Self.size / 2)
        }
        return false
    }

    /// The loudest level (dBFS) between two frequencies, interpolated where a column is narrower than a bin.
    func level(from f0: Double, to f1: Double) -> Float {
        let df = sampleRate / Double(Self.size)
        let n = smoothed.count
        var m: Float = 0
        if f1 - f0 < df {
            let pos = sqrt(f0 * f1) / df
            let i = max(1, min(n - 2, Int(pos)))
            let fr = Float(min(1, max(0, pos - Double(i))))
            m = smoothed[i] * (1 - fr) + smoothed[i + 1] * fr
        } else {
            let i0 = max(1, Int(f0 / df))
            let i1 = min(n - 1, max(i0, Int(f1 / df)))
            for i in i0...i1 { m = max(m, smoothed[i]) }
        }
        return m > 0 ? 20 * log10(m) : -200
    }

    /// The latest waveform resampled to `points` values in −1 … 1 (gain-normalised so a quiet sound still shows),
    /// starting at a rising zero crossing so it stands still.
    func wave(points: Int) -> [Float]? {
        guard hasData, points > 1 else { return nil }
        let span = min(1536, Self.size / 4)
        var start = 0
        for i in 1..<(Self.size - span) where samples[i - 1] < 0 && samples[i] >= 0 {
            start = i
            break
        }
        var peak: Float = 0
        for i in 0..<span { peak = max(peak, abs(samples[start + i])) }
        guard peak > 1e-5 else { return nil }
        let gain = min(14, 0.9 / max(peak, 0.02))
        return (0..<points).map { samples[start + Int(Double($0) / Double(points) * Double(span - 1))] * gain }
    }
}
