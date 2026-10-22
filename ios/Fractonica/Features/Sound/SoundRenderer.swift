import FractonicaKit
import Foundation
import Synchronization

/// The synthesiser of the sonification: everything the audio thread does, free of any audio framework (so the logic
/// checks can render it offline and listen with an FFT).
///
///     chord      one voice per sounding level: a sine, a quiet partner 0.15 Hz away and a 2nd harmonic that is
///                brighter on the rising branch; its loudness is the glyph wave of the level's cycle, sampled from the
///                catalogue position at a 1.5 kHz control rate (ξ's true 22.5 Hz modulation stays exact)
///     bells      up to 48 at once (64 slots, so a stolen bell can fade): sine partials with their own exponential
///                decays, each starting on its exact sample
///     physical   the true rates of the deepest cycles as band-limited triangles
///     master     reverb send → room (`SoundReverb`), volume, fader, a stereo-linked limiter and a soft safety curve
///
/// Threading. The main thread talks to it only through `commands` (a lock-free ring of plain values) and reads back
/// only `scope`, `soundingBells` and `outputPeak` (atomics and a lock-free ring). `render` runs on the audio thread and
/// never allocates, locks, waits or touches Swift concurrency: all memory is allocated in `init`.
///
/// Time. The renderer counts its own frames. An `.anchor` command ties a host time (when the main thread read the clock)
/// to a displayed time and a rate; the renderer turns the host time into a frame with the buffer's own host time, so a
/// bell planned at displayed time t starts on the frame that is heard when the clock shows t.
final class SoundRenderer: @unchecked Sendable {
    // MARK: Gain staging (src/audio/engine.js, measured offline by the logic checks)

    static let voiceAmp: Float = 0.16
    static let chorusGain: Float = 0.14
    static let chorusHz = 0.15
    static let harmonicBase: Float = 0.1
    static let harmonicDepth: Float = 0.08
    /// Bells sounding at once (the polyphony cap) and the slots that leave room for stolen bells to fade.
    static let maxBells = 48
    static let bellSlots = 64
    static let pendingSlots = 512
    /// Frames per control step of the drone (≈ 0.7 ms at 48 kHz).
    static let controlFrames = 32
    /// Frames processed at once (larger buffers are split).
    static let chunkFrames = 4096
    /// Reverb slider 0 … 1 → send gain into the room.
    static let reverbSendScale: Float = 1.6
    /// Output gain after the volume (+8 dB, about what the web app's compressor adds as make-up gain).
    static let makeup: Float = 2.5
    static let voiceCount = SoundTuning.levelCount
    static let physicalSlots = 8

    /// A bell's character: attack, base decay, loudness and up to three partials (frequency ratio, amplitude, decay
    /// scale), as `RECIPES` in engine.js.
    struct Recipe: Sendable {
        let attack: Float
        let decay: Float
        let gain: Float
        let parts: (SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)
        let count: Int
    }

    /// Peak bright, node soft, valley dark, end the biggest; the moment a soft pluck.
    static func recipe(_ kind: UInt8) -> Recipe {
        switch SoundSchedule.Kind(rawValue: kind) ?? .moment {
        case .peak:
            Recipe(attack: 0.004, decay: 0.95, gain: 1.0, parts: (SIMD3(1, 1, 1), SIMD3(2.756, 0.34, 0.45), SIMD3(5.404, 0.12, 0.22)), count: 3)
        case .node:
            Recipe(attack: 0.006, decay: 0.55, gain: 0.7, parts: (SIMD3(1, 1, 1), SIMD3(2, 0.14, 0.5), .zero), count: 2)
        case .valley:
            Recipe(attack: 0.012, decay: 1.3, gain: 0.9, parts: (SIMD3(1, 1, 1), SIMD3(2, 0.22, 0.6), .zero), count: 2)
        case .end:
            Recipe(attack: 0.003, decay: 1.5, gain: 1.0, parts: (SIMD3(1, 1, 1), SIMD3(2, 0.38, 0.6), SIMD3(3, 0.2, 0.4)), count: 3)
        case .moment:
            Recipe(attack: 0.012, decay: 1.5, gain: 1.0, parts: (SIMD3(1, 1, 1), SIMD3(2, 0.16, 0.5), .zero), count: 2)
        }
    }

    // MARK: Hand-over

    let sampleRate: Double
    /// Main thread → audio thread.
    let commands = SoundCommandRing()
    /// Audio thread → screen: the last output samples (mono).
    let scope = SoundScopeRing()
    /// Bells sounding (not counting the ones fading after being stolen).
    let soundingBells = Atomic<Int>(0)
    /// Peak of the last buffer, as `Float.bitPattern`.
    let outputPeak = Atomic<UInt32>(0)

    // MARK: Audio-thread state (allocated once)

    private struct State {
        var frame: Int64 = 0
        var mapValid = false
        var frame0 = 0.0
        var t0 = 0.0
        var rate = 0.0
        var epoch: UInt32 = 0
        var blendLeft = 0
        var blendTotal = 1
        var volume: Float = 0
        var volumeTarget: Float = 0
        var send: Float = 0
        var sendTarget: Float = 0
        var chord = true
        var chimeGain: Float = 1
        var chimeTarget: Float = 1
        var fader: Float = 0
        var faderTarget: Float = 0
        var faderStep: Float = 0
        var limiter: Float = 0
        var pendingCount = 0
        var silent = false
    }

    private struct Voice {
        var prefix = 0.0
        var mean = 1.0
        var on = false
        var active = false
        var fresh = true
        var hz = 0.0
        var targetHz = 0.0
        var weight: Float = 1
        var noHarmonic = false
        var floor: Float = 0
        var panL: Float = 0.7071
        var panR: Float = 0.7071
        var phaseA = 0.0
        var phaseB = 0.0
        var phaseH = 0.0
        var mute: Float = 0
        var gain: Float = 0
        var harmonic: Float = 0
        var held: Float = 0
    }

    private struct Bell {
        var active = false
        var releasing = false
        var moment = false
        var level: Int8 = 0
        var start: Int64 = 0
        var amp: Float = 0
        var attack = 1
        var decayFrames: Float = 1
        var age = 0
        var panL: Float = 0.7071
        var panR: Float = 0.7071
        var release: Float = 1
        var releaseStep: Float = 0
        var count = 0
    }

    private struct Partial {
        var alive = false
        var phase = 0.0
        var increment = 0.0
        var envelope: Float = 0
        var peak: Float = 0
        var attackStep: Float = 0
        var multiplier: Float = 1
        var stopAge = 0
    }

    private struct Physical {
        var hz = 0.0
        var gain: Float = 0
        var target: Float = 0
        var phase = 0.0
    }

    private let state: UnsafeMutablePointer<State>
    private let voices: UnsafeMutablePointer<Voice>
    private let bells: UnsafeMutablePointer<Bell>
    private let partials: UnsafeMutablePointer<Partial>
    private let pending: UnsafeMutablePointer<SoundBell>
    private let pendingUsed: UnsafeMutablePointer<Bool>
    private let physical: UnsafeMutablePointer<Physical>
    private let catalogue: UnsafeMutablePointer<Double>
    private let extent: Int
    private let tMin: Double
    private let tMax: Double
    private let sine: UnsafeMutablePointer<Float>
    private static let sineSize = 4096
    private let mixL: UnsafeMutablePointer<Float>
    private let mixR: UnsafeMutablePointer<Float>
    private let bellL: UnsafeMutablePointer<Float>
    private let bellR: UnsafeMutablePointer<Float>
    private let wetL: UnsafeMutablePointer<Float>
    private let wetR: UnsafeMutablePointer<Float>
    private let sendBuffer: UnsafeMutablePointer<Float>
    private let reverb: SoundReverb
    /// Seconds per mach tick.
    private let ticksToSeconds: Double
    /// One-pole coefficients per control block / per sample.
    private let muteIn: Float
    private let muteOut: Float
    private let glide: Double
    private let harmonicSmoothing: Float
    private let limiterAttack: Float
    private let limiterRelease: Float

    init(sampleRate: Double, clock: FractonicaClockFacts = .standard) {
        self.sampleRate = sampleRate
        state = .allocate(capacity: 1)
        state.initialize(to: State())
        voices = .allocate(capacity: Self.voiceCount)
        voices.initialize(repeating: Voice(), count: Self.voiceCount)
        for level in 0..<Self.voiceCount {
            voices[level].prefix = clock.prefixes[level]
            voices[level].mean = clock.means[level]
        }
        bells = .allocate(capacity: Self.bellSlots)
        bells.initialize(repeating: Bell(), count: Self.bellSlots)
        partials = .allocate(capacity: Self.bellSlots * 3)
        partials.initialize(repeating: Partial(), count: Self.bellSlots * 3)
        pending = .allocate(capacity: Self.pendingSlots)
        pending.initialize(repeating: SoundBell(t: 0, host: 0, hz: 0, amp: 0, decay: 0, pan: 0, kind: 0, level: 0, epoch: 0, moment: false), count: Self.pendingSlots)
        pendingUsed = .allocate(capacity: Self.pendingSlots)
        pendingUsed.initialize(repeating: false, count: Self.pendingSlots)
        physical = .allocate(capacity: Self.physicalSlots)
        physical.initialize(repeating: Physical(), count: Self.physicalSlots)
        extent = clock.catalogue.count - 1
        catalogue = .allocate(capacity: clock.catalogue.count)
        catalogue.initialize(from: clock.catalogue, count: clock.catalogue.count)
        tMin = clock.catalogue[0]
        tMax = clock.catalogue[extent]
        sine = .allocate(capacity: Self.sineSize + 1)
        for i in 0...Self.sineSize { sine[i] = Float(sin(2 * Double.pi * Double(i) / Double(Self.sineSize))) }
        func buffer() -> UnsafeMutablePointer<Float> {
            let p = UnsafeMutablePointer<Float>.allocate(capacity: Self.chunkFrames)
            p.initialize(repeating: 0, count: Self.chunkFrames)
            return p
        }
        mixL = buffer()
        mixR = buffer()
        bellL = buffer()
        bellR = buffer()
        wetL = buffer()
        wetR = buffer()
        sendBuffer = buffer()
        reverb = SoundReverb(sampleRate: sampleRate)
        var timebase = mach_timebase_info_data_t()
        mach_timebase_info(&timebase)
        ticksToSeconds = Double(timebase.numer) / Double(timebase.denom) / 1e9
        let block = Double(Self.controlFrames)
        muteIn = Float(1 - exp(-block / (0.05 * sampleRate)))
        muteOut = Float(1 - exp(-block / (0.03 * sampleRate)))
        glide = 1 - exp(-block / (0.05 * sampleRate))
        harmonicSmoothing = Float(1 - exp(-block / (0.02 * sampleRate)))
        limiterAttack = Float(1 - exp(-1 / (0.003 * sampleRate)))
        limiterRelease = Float(1 - exp(-1 / (0.25 * sampleRate)))
        // touch every global the audio thread reads, so none is first initialised there
        _ = SoundSchedule.voiceLoudness(phase: 0, hz: SoundSchedule.amFullHz) + SoundSchedule.directionWeight(0) + SoundSchedule.directionCue(0)
        _ = (Self.voiceAmp, Self.chorusGain, Self.chorusHz, Self.harmonicBase, Self.harmonicDepth, Self.reverbSendScale, Self.makeup)
        _ = (Self.maxBells, Self.bellSlots, Self.pendingSlots, Self.controlFrames, Self.voiceCount, Self.physicalSlots, Self.sineSize)
        for kind in SoundSchedule.Kind.allCases { _ = Self.recipe(kind.rawValue) }
    }

    deinit {
        state.deallocate()
        voices.deallocate()
        bells.deallocate()
        partials.deallocate()
        pending.deallocate()
        pendingUsed.deallocate()
        physical.deallocate()
        catalogue.deallocate()
        sine.deallocate()
        for p in [mixL, mixR, bellL, bellR, wetL, wetR, sendBuffer] { p.deallocate() }
    }

    /// Host time (mach ticks) of a moment `seconds` after another one.
    func host(_ host: UInt64, plus seconds: Double) -> UInt64 {
        UInt64(max(0, Double(host) + seconds / ticksToSeconds))
    }

    // MARK: Rendering (audio thread)

    /// Renders `frameCount` frames into `left` and `right` (written, not added). `hostTime` is the host time at which
    /// the first frame is heard (0 when unknown).
    func render(frameCount: Int, left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, hostTime: UInt64) {
        drain(hostTime: hostTime)
        var done = 0
        while done < frameCount {
            let n = min(Self.chunkFrames, frameCount - done)
            let host = hostTime == 0 ? 0 : hostTime &+ UInt64(Double(done) / sampleRate / ticksToSeconds)
            renderChunk(n, left: left + done, right: right + done, host: host)
            done += n
        }
    }

    private func drain(hostTime: UInt64) {
        let s = state
        while let command = commands.pop() {
            switch command {
            case let .anchor(t0, rate, host, epoch, blend):
                var frame0 = Double(s.pointee.frame)
                if host != 0, hostTime != 0 {
                    frame0 += (Double(host) - Double(hostTime)) * ticksToSeconds * sampleRate
                }
                if blend && s.pointee.mapValid {
                    for i in 0..<Self.voiceCount { voices[i].held = voices[i].gain }
                    s.pointee.blendTotal = max(1, Int(0.04 * sampleRate))
                    s.pointee.blendLeft = s.pointee.blendTotal
                }
                s.pointee.frame0 = frame0
                s.pointee.t0 = t0
                s.pointee.rate = rate
                s.pointee.mapValid = true
                if epoch != s.pointee.epoch {
                    s.pointee.epoch = epoch
                    dropStalePending()
                }
            case let .voice(config):
                let i = Int(config.level)
                guard i >= 0, i < Self.voiceCount else { continue }
                let v = voices + i
                v.pointee.on = config.on
                v.pointee.targetHz = config.hz
                if !v.pointee.active { v.pointee.hz = config.hz }
                v.pointee.weight = config.weight
                v.pointee.noHarmonic = config.noHarmonic
                v.pointee.floor = config.floor
                let x = (Double(min(1, max(-1, config.pan))) + 1) / 2
                v.pointee.panL = Float(cos(x * .pi / 2))
                v.pointee.panR = Float(sin(x * .pi / 2))
            case let .mix(mix):
                s.pointee.volumeTarget = mix.volume
                s.pointee.sendTarget = mix.reverb * Self.reverbSendScale
                s.pointee.chord = mix.chord
                s.pointee.chimeTarget = mix.chimes ? 1 : 0
            case let .physical(slot, hz, gain):
                let i = Int(slot)
                guard i >= 0, i < Self.physicalSlots else { continue }
                // a resting slot takes its new pitch (the planner reuses a slot only after its tail has died away)
                if physical[i].target == 0 || physical[i].gain < 1e-4 { physical[i].hz = hz }
                physical[i].target = gain
            case let .bell(bell):
                addPending(bell)
            case let .fader(target, seconds):
                s.pointee.faderTarget = target
                let frames = max(1, Float(seconds) * Float(sampleRate))
                s.pointee.faderStep = (target - s.pointee.fader) / frames
            case .flush:
                flush()
            case let .silentOutput(silent):
                s.pointee.silent = silent
            }
        }
    }

    private func addPending(_ bell: SoundBell) {
        for i in 0..<Self.pendingSlots where !pendingUsed[i] {
            pending[i] = bell
            pendingUsed[i] = true
            state.pointee.pendingCount += 1
            return
        }
    }

    private func dropStalePending() {
        let epoch = state.pointee.epoch
        for i in 0..<Self.pendingSlots where pendingUsed[i] && pending[i].epoch != 0 && pending[i].epoch != epoch {
            pendingUsed[i] = false
            state.pointee.pendingCount -= 1
        }
    }

    private func flush() {
        for i in 0..<Self.bellSlots { bells[i].active = false }
        for i in 0..<Self.pendingSlots { pendingUsed[i] = false }
        state.pointee.pendingCount = 0
        for i in 0..<Self.voiceCount {
            voices[i].active = false
            voices[i].fresh = true
            voices[i].mute = 0
            voices[i].gain = 0
            voices[i].harmonic = 0
        }
        for i in 0..<Self.physicalSlots {
            physical[i].gain = 0
        }
        reverb.clear()
        state.pointee.limiter = 0
        state.pointee.blendLeft = 0
    }

    private func renderChunk(_ n: Int, left: UnsafeMutablePointer<Float>, right: UnsafeMutablePointer<Float>, host: UInt64) {
        let s = state
        startDueBells(n, host: host)
        mixL.update(repeating: 0, count: n)
        mixR.update(repeating: 0, count: n)
        bellL.update(repeating: 0, count: n)
        bellR.update(repeating: 0, count: n)

        renderVoices(n)
        renderPhysical(n)
        renderBells(n)

        // buses → room → volume → fader → limiter → safety
        let k = Float(1 - exp(-Double(n) / (0.03 * sampleRate)))
        let volume0 = s.pointee.volume
        let volume1 = volume0 + (s.pointee.volumeTarget - volume0) * k
        let send0 = s.pointee.send
        let send1 = send0 + (s.pointee.sendTarget - send0) * Float(1 - exp(-Double(n) / (0.05 * sampleRate)))
        let chime0 = s.pointee.chimeGain
        let chime1 = chime0 + (s.pointee.chimeTarget - chime0) * Float(1 - exp(-Double(n) / (0.02 * sampleRate)))
        let invN = 1 / Float(n)
        for i in 0..<n {
            let u = Float(i + 1) * invN
            let chime = chime0 + (chime1 - chime0) * u
            let l = mixL[i] + bellL[i] * chime
            let r = mixR[i] + bellR[i] * chime
            mixL[i] = l
            mixR[i] = r
            sendBuffer[i] = (l + r) * 0.5 * (send0 + (send1 - send0) * u)
        }
        reverb.process(sendBuffer, left: wetL, right: wetR, count: n)

        var fader = s.pointee.fader
        let target = s.pointee.faderTarget
        let step = s.pointee.faderStep
        var envelope = s.pointee.limiter
        let attack = limiterAttack
        let release = limiterRelease
        var peak: Float = 0
        let silent = s.pointee.silent
        for i in 0..<n {
            let u = Float(i + 1) * invN
            let gain = (volume0 + (volume1 - volume0) * u) * fader * Self.makeup
            if fader != target {
                fader += step
                if (step > 0 && fader > target) || (step < 0 && fader < target) || step == 0 { fader = target }
            }
            var l = (mixL[i] + wetL[i]) * gain
            var r = (mixR[i] + wetR[i]) * gain
            // stereo-linked limiter: −6 dBFS, 6 dB knee, 8 : 1, 3 ms attack, 250 ms release
            let level = max(abs(l), abs(r))
            envelope += (level - envelope) * (level > envelope ? attack : release)
            if envelope > 0.3548 { // the knee starts at −9 dBFS
                let db = 20 * log10f(envelope)
                let over = db + 6
                let reduction: Float = over < 3 ? (1 / 8 - 1) * (over + 3) * (over + 3) / 12 : (1 / 8 - 1) * over
                let g = powf(10, reduction / 20)
                l *= g
                r *= g
            }
            l = Self.safety(l)
            r = Self.safety(r)
            if !l.isFinite || !r.isFinite {
                l = 0
                r = 0
            }
            peak = max(peak, max(abs(l), abs(r)))
            left[i] = silent ? 0 : l
            right[i] = silent ? 0 : r
            sendBuffer[i] = (l + r) * 0.5
        }
        if !envelope.isFinite { envelope = 0 }
        s.pointee.fader = fader
        s.pointee.limiter = envelope
        s.pointee.volume = volume1
        s.pointee.send = send1
        s.pointee.chimeGain = chime1
        scope.write(sendBuffer, count: n)
        outputPeak.store(peak.bitPattern, ordering: .relaxed)
        var sounding = 0
        for b in 0..<Self.bellSlots where bells[b].active && !bells[b].releasing { sounding += 1 }
        soundingBells.store(sounding, ordering: .relaxed)
        s.pointee.frame += Int64(n)
    }

    /// Transparent up to 0.8, then a soft ceiling at 0.98: the output can never exceed full scale.
    @inline(__always)
    static func safety(_ x: Float) -> Float {
        let a = abs(x)
        guard a > 0.8 else { return x }
        let y = 0.8 + 0.18 * tanhf((a - 0.8) / 0.18)
        return x < 0 ? -y : y
    }

    @inline(__always)
    private func wave(_ phase: Double) -> Float {
        let x = phase * Double(Self.sineSize)
        let i = Int(x)
        let f = Float(x - Double(i))
        let a = sine[i]
        return a + (sine[i + 1] - a) * f
    }

    /// The catalogue position of displayed time t (model.js `positionOf`); nil outside the catalogue.
    @inline(__always)
    private func position(_ t: Double) -> Double? {
        guard t >= tMin, t <= tMax else { return nil }
        var lo = 0
        var hi = extent
        while lo + 1 < hi {
            let m = (lo + hi) >> 1
            if catalogue[m] <= t { lo = m } else { hi = m }
        }
        return Double(lo) + (t - catalogue[lo]) / (catalogue[lo + 1] - catalogue[lo])
    }

    // MARK: Chord

    private func renderVoices(_ n: Int) {
        let s = state
        let block = Self.controlFrames
        let sr = sampleRate
        var offset = 0
        while offset < n {
            let b = min(block, n - offset)
            let endFrame = Double(s.pointee.frame) + Double(offset + b)
            let pos: Double? = s.pointee.mapValid ? position(s.pointee.t0 + s.pointee.rate * (endFrame - s.pointee.frame0) / sr) : nil
            if s.pointee.blendLeft > 0 { s.pointee.blendLeft -= b }
            let blend: Float = s.pointee.blendLeft > 0 ? 1 - Float(s.pointee.blendLeft) / Float(s.pointee.blendTotal) : 1
            let rate = abs(s.pointee.rate)
            let chord = s.pointee.chord
            let invB = 1 / Float(b)
            for i in 0..<Self.voiceCount {
                let v = voices + i
                let wanted = v.pointee.on && chord
                if !v.pointee.active {
                    guard wanted else { continue }
                    v.pointee.active = true
                    v.pointee.fresh = true
                    v.pointee.mute = 0
                    v.pointee.hz = v.pointee.targetHz
                }
                // where the voice is heading by the end of this block
                var target: Float = 0
                var harmonicTarget: Float = v.pointee.noHarmonic ? 0 : Self.harmonicBase
                if let pos {
                    let x = pos * v.pointee.prefix / 4
                    let phase = x - x.rounded(.down)
                    let hz = rate / v.pointee.mean
                    let loud = SoundSchedule.voiceLoudness(phase: phase, hz: hz, floor: Double(v.pointee.floor))
                    target = Self.voiceAmp * v.pointee.weight * Float(loud)
                    if !v.pointee.noHarmonic {
                        harmonicTarget += Self.harmonicDepth * Float(SoundSchedule.directionWeight(hz) * SoundSchedule.directionCue(phase))
                    }
                }
                if blend < 1 { target = v.pointee.held + (target - v.pointee.held) * blend }
                let g0 = v.pointee.fresh ? target : v.pointee.gain
                let m0 = v.pointee.mute
                let m1 = m0 + ((wanted ? 1 : 0) - m0) * (wanted ? muteIn : muteOut)
                let h0 = v.pointee.fresh ? harmonicTarget : v.pointee.harmonic
                let h1 = h0 + (harmonicTarget - h0) * harmonicSmoothing
                v.pointee.fresh = false
                v.pointee.hz += (v.pointee.targetHz - v.pointee.hz) * glide
                let hz = v.pointee.hz
                let incA = hz / sr
                let incB = (hz + Self.chorusHz) / sr
                let incH = 2 * hz / sr
                var pa = v.pointee.phaseA
                var pb = v.pointee.phaseB
                var ph = v.pointee.phaseH
                let dg = target - g0
                let dm = m1 - m0
                let dh = h1 - h0
                let panL = v.pointee.panL
                let panR = v.pointee.panR
                let chorus = Self.chorusGain
                let outL = mixL + offset
                let outR = mixR + offset
                for j in 0..<b {
                    let u = Float(j + 1) * invB
                    let g = (g0 + dg * u) * (m0 + dm * u)
                    let sample = (wave(pa) + chorus * wave(pb) + (h0 + dh * u) * wave(ph)) * g
                    outL[j] += sample * panL
                    outR[j] += sample * panR
                    pa += incA
                    if pa >= 1 { pa -= 1 }
                    pb += incB
                    if pb >= 1 { pb -= 1 }
                    ph += incH
                    if ph >= 1 { ph -= 1 }
                }
                v.pointee.phaseA = pa
                v.pointee.phaseB = pb
                v.pointee.phaseH = ph
                v.pointee.gain = target
                v.pointee.mute = m1
                v.pointee.harmonic = h1
                if !wanted && m1 < 1e-4 {
                    v.pointee.active = false
                    v.pointee.mute = 0
                }
            }
            offset += b
        }
    }

    // MARK: Physical register

    private func renderPhysical(_ n: Int) {
        let sr = sampleRate
        let smoothing = Float(1 - exp(-1 / (0.06 * sr)))
        let nyquist = 0.45 * sr
        for slot in 0..<Self.physicalSlots {
            let p = physical + slot
            if p.pointee.gain < 1e-5 && p.pointee.target == 0 {
                p.pointee.gain = 0
                continue
            }
            let increment = p.pointee.hz / sr
            var phase = p.pointee.phase
            var gain = p.pointee.gain
            let target = p.pointee.target
            for i in 0..<n {
                gain += (target - gain) * smoothing
                // band-limited triangle: odd harmonics with alternating signs, 1 / k²
                var sample: Float = 0
                var k = 1
                var sign: Float = 1
                while k <= 15, Double(k) * p.pointee.hz < nyquist {
                    let x = phase * Double(k)
                    sample += sign * wave(x - x.rounded(.down)) / Float(k * k)
                    sign = -sign
                    k += 2
                }
                let out = sample * 0.8106 * gain * 0.7071 // 8 / π²
                mixL[i] += out
                mixR[i] += out
                phase += increment
                if phase >= 1 { phase -= 1 }
            }
            p.pointee.phase = phase
            p.pointee.gain = gain
        }
    }

    // MARK: Bells

    private func startDueBells(_ n: Int, host: UInt64) {
        let s = state
        guard s.pointee.pendingCount > 0 else { return }
        let first = Double(s.pointee.frame)
        let end = first + Double(n)
        let late = 0.1 * sampleRate
        for i in 0..<Self.pendingSlots where pendingUsed[i] {
            let bell = pending[i]
            if bell.epoch != 0 && bell.epoch != s.pointee.epoch {
                pendingUsed[i] = false
                s.pointee.pendingCount -= 1
                continue
            }
            let frame: Double
            if bell.host != 0 {
                frame = host != 0 ? first + (Double(bell.host) - Double(host)) * ticksToSeconds * sampleRate : first
            } else {
                guard s.pointee.mapValid, s.pointee.rate != 0 else { continue }
                frame = s.pointee.frame0 + (bell.t - s.pointee.t0) / s.pointee.rate * sampleRate
            }
            guard frame < end else { continue }
            pendingUsed[i] = false
            s.pointee.pendingCount -= 1
            guard frame.isFinite, frame >= first - late else { continue } // already history
            startBell(bell, offset: max(0, min(n - 1, Int(frame.rounded(.down)) - Int(s.pointee.frame))))
        }
    }

    /// The loudness of a sounding bell's main partial now (`bellLoudAt` of schedule.js).
    private func loudness(_ b: UnsafeMutablePointer<Bell>) -> Float {
        let amp = b.pointee.amp
        let u = min(1, max(0, Float(b.pointee.age - b.pointee.attack) / b.pointee.decayFrames))
        return amp * powf(1e-4 / amp, u)
    }

    /// Is bell a less important than bell b (the one stolen first): the quietest, then the finest, then the oldest.
    private static func lessImportant(loudA: Float, levelA: Int8, startA: Int64, loudB: Float, levelB: Int8, startB: Int64) -> Bool {
        if loudA != loudB { return loudA < loudB }
        if levelA != levelB { return levelA > levelB }
        return startA < startB
    }

    private func startBell(_ bell: SoundBell, offset: Int) {
        guard bell.amp >= 2e-4, bell.hz > 0 else { return }
        let startFrame = state.pointee.frame + Int64(offset)
        // polyphony: over the cap the least important bell is stolen, unless that is the newcomer
        var sounding = 0
        var victim = -1
        var victimLoud: Float = 0
        for i in 0..<Self.bellSlots where bells[i].active && !bells[i].releasing {
            sounding += 1
            let loud = loudness(bells + i)
            if victim < 0 || Self.lessImportant(loudA: loud, levelA: bells[i].level, startA: bells[i].start,
                                                loudB: victimLoud, levelB: bells[victim].level, startB: bells[victim].start) {
                victim = i
                victimLoud = loud
            }
        }
        if sounding >= Self.maxBells {
            guard victim >= 0, Self.lessImportant(loudA: victimLoud, levelA: bells[victim].level, startA: bells[victim].start,
                                                  loudB: bell.amp, levelB: bell.level, startB: startFrame) else { return }
            bells[victim].releasing = true
            bells[victim].releaseStep = 1 / max(1, Float(0.02 * sampleRate))
        }
        var slot = -1
        var quietest: Float = .infinity
        for i in 0..<Self.bellSlots {
            if !bells[i].active {
                slot = i
                break
            }
            if bells[i].releasing && bells[i].release < quietest {
                slot = i
                quietest = bells[i].release
            }
        }
        guard slot >= 0 else { return }
        let recipe = Self.recipe(bell.kind)
        let b = bells + slot
        let attack = max(1, Int(Double(recipe.attack) * sampleRate))
        b.pointee = Bell()
        b.pointee.active = true
        b.pointee.moment = bell.moment
        b.pointee.level = bell.level
        b.pointee.start = startFrame
        b.pointee.amp = bell.amp
        b.pointee.attack = attack
        b.pointee.decayFrames = max(1, bell.decay * Float(sampleRate))
        b.pointee.age = -offset
        let x = (Double(min(1, max(-1, bell.pan))) + 1) / 2
        b.pointee.panL = Float(cos(x * .pi / 2))
        b.pointee.panR = Float(sin(x * .pi / 2))
        let limit = min(12000, 0.45 * sampleRate)
        var count = 0
        for k in 0..<recipe.count {
            let part = Self.part(recipe, k)
            let hz = Double(bell.hz) * Double(part.x)
            let peak = bell.amp * part.y
            let p = partials + slot * 3 + k
            p.pointee = Partial()
            guard hz <= limit, peak >= 1.5e-4 else { continue }
            let decayFrames = max(1, Double(bell.decay * part.z) * sampleRate)
            p.pointee.alive = true
            p.pointee.phase = 0
            p.pointee.increment = hz / sampleRate
            p.pointee.peak = peak
            p.pointee.attackStep = peak / Float(attack)
            p.pointee.multiplier = Float(pow(1e-4 / Double(peak), 1 / decayFrames))
            p.pointee.stopAge = attack + Int(decayFrames)
            count = k + 1
        }
        b.pointee.count = count
        if count == 0 { b.pointee.active = false }
    }

    @inline(__always)
    private static func part(_ recipe: Recipe, _ k: Int) -> SIMD3<Float> {
        switch k {
        case 0: recipe.parts.0
        case 1: recipe.parts.1
        default: recipe.parts.2
        }
    }

    private func renderBells(_ n: Int) {
        for slot in 0..<Self.bellSlots where bells[slot].active {
            let b = bells + slot
            let outL = b.pointee.moment ? mixL : bellL
            let outR = b.pointee.moment ? mixR : bellR
            var age = b.pointee.age
            let attack = b.pointee.attack
            var release = b.pointee.release
            let releasing = b.pointee.releasing
            let releaseStep = b.pointee.releaseStep
            let panL = b.pointee.panL
            let panR = b.pointee.panR
            var anyAlive = false
            for i in 0..<n {
                if age < 0 {
                    age += 1
                    continue
                }
                var sample: Float = 0
                for k in 0..<b.pointee.count {
                    let p = partials + slot * 3 + k
                    guard p.pointee.alive else { continue }
                    if age < attack {
                        p.pointee.envelope += p.pointee.attackStep
                    } else if age == attack {
                        p.pointee.envelope = p.pointee.peak
                    } else {
                        p.pointee.envelope *= p.pointee.multiplier
                    }
                    sample += p.pointee.envelope * wave(p.pointee.phase)
                    var phase = p.pointee.phase + p.pointee.increment
                    if phase >= 1 { phase -= 1 }
                    p.pointee.phase = phase
                    if age >= p.pointee.stopAge { p.pointee.alive = false }
                }
                if releasing {
                    release -= releaseStep
                    if release <= 0 {
                        release = 0
                        break
                    }
                    sample *= release
                }
                outL[i] += sample * panL
                outR[i] += sample * panR
                age += 1
            }
            for k in 0..<b.pointee.count where partials[slot * 3 + k].alive { anyAlive = true }
            b.pointee.age = age
            b.pointee.release = release
            if !anyAlive || (releasing && release <= 0) { b.pointee.active = false }
        }
    }
}

/// The clock facts the audio thread needs, copied once: the catalogue, and per voice its prefix and mean cycle.
struct FractonicaClockFacts: Sendable {
    let catalogue: [Double]
    let prefixes: [Double]
    let means: [Double]

    static let standard: FractonicaClockFacts = {
        let clock = FractonicaClock.shared
        return FractonicaClockFacts(
            catalogue: clock.catalogue,
            prefixes: (0..<SoundTuning.levelCount).map { clock.levelInfo($0).prefixDouble },
            means: (0..<SoundTuning.levelCount).map { clock.levelInfo($0).meanSeconds }
        )
    }()
}
