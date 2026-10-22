import CoreGraphics
import FractonicaKit
import Foundation
import ImageIO
import Metal
import UniformTypeIdentifiers

// Focus's logic (harmonics, sessions, spans, the chime) and its shaders: they compile, render every style at several
// instants on this Mac's GPU without NaNs or black frames, and stay cheap. With FOCUS_SHOTS=<folder> the frames are
// also written as PNGs (look development); FOCUS_SHOTS_SIZE=WxH picks their size (default 1206x2622, an iPhone).

@main
struct FocusChecks {
    static let clock = FractonicaClock.shared
    static let vectorA = 1_791_460_800.0

    @MainActor
    static func main() async {
        harmonics()
        webParity()
        sessions()
        spans()
        model()
        chime()
        styles()
        await shaders()
        Checks.finish()
    }

    static func input(_ t: Double, rate: Double = 1, frame: Double = 1.0 / 120, since: Double = 1e9, calm: Bool = false) -> FocusHarmonics.Input {
        FocusHarmonics.Input(t: t, rate: rate, real: t, frameInterval: frame, sinceDiscontinuity: since, calm: calm, breathing: true)
    }

    // MARK: Harmonics

    static func harmonics() {
        var h = FocusHarmonics()
        h.update(input(vectorA))
        check(h.inRange, "vector A is inside the catalogue")
        for level in 0...12 {
            let phase = clock.level(at: vectorA, level)!.phase
            check(h.levels[level].phase == phase, "level \(level) phase is the engine's: \(h.levels[level].phase) vs \(phase)")
        }
        for level in 13...15 {
            check((0..<1).contains(h.levels[level].phase), "sub-Blink level \(level) phase in 0..<1: \(h.levels[level].phase)")
        }
        // ξ continuous from ν agrees with the engine's ξ (1 ms grain).
        let xi = clock.level(at: vectorA, 13)!.phase
        let d = abs(h.levels[13].phase - xi)
        check(min(d, 1 - d) < 0.03, "ξ from ν matches the engine's ξ: \(h.levels[13].phase) vs \(xi)")
        // ο runs 11 times as fast as ξ: one ξ cycle later its phase is the same; a fraction of an ο later it differs.
        let nu = clock.level(at: vectorA, 12)!
        var h2 = FocusHarmonics()
        h2.update(input(nu.start + nu.duration / 7 * 2 + 0.0001))
        var h3 = FocusHarmonics()
        h3.update(input(nu.start + 0.0001))
        check(abs(h2.levels[14].phase - h3.levels[14].phase) < 1e-3, "ο is whole cycles per ξ: \(h2.levels[14].phase) vs \(h3.levels[14].phase)")

        // Amplitudes at real speed, 120 Hz: everything to ν visible; at 60 Hz still ν.
        check(h.levels[12].amplitude > 0.99, "ν fully visible at 120 Hz: \(h.levels[12].amplitude)")
        var h60 = FocusHarmonics()
        h60.update(input(vectorA, frame: 1.0 / 60))
        check(h60.levels[12].amplitude > 0.99, "ν fully visible at 60 Hz: \(h60.levels[12].amplitude)")
        // A 4ι-per-Blink time-lapse (6 500×) fades λ … ν, keeps η.
        var lapse = FocusHarmonics()
        lapse.update(input(vectorA, rate: 6500))
        check(lapse.levels[10].amplitude == 0 && lapse.levels[12].amplitude == 0, "time-lapse fades λ and ν")
        check(lapse.levels[6].amplitude > 0.99, "time-lapse keeps η: \(lapse.levels[6].amplitude)")
        check(lapse.shimmer == 0, "time-lapse silences the shimmer")
        // Paused: everything visible, no ripples, shimmer still (phases frozen).
        var paused = FocusHarmonics()
        paused.update(input(vectorA, rate: 0))
        check(paused.levels[12].amplitude == 1 && paused.levels.allSatisfy { $0.ripple == 0 }, "paused: visible, no ripples")
        check(paused.breathCue == 1, "paused: the breath follows the live Flavon")

        // Breath: rising Flavon inhales.
        let lambda = clock.level(at: vectorA, 10)!
        var rising = FocusHarmonics()
        rising.update(input(lambda.start + lambda.duration * 0.1))
        check(rising.inhaling && rising.breath > 0.5, "rising Flavon: inhale, lungs filling: \(rising.breath)")
        var falling = FocusHarmonics()
        falling.update(input(lambda.start + lambda.duration * 0.5))
        check(!falling.inhaling, "falling Flavon: exhale")
        var peak = FocusHarmonics()
        peak.update(input(lambda.start + lambda.duration * 0.25))
        check(peak.breath > 0.99, "lungs full at the peak: \(peak.breath)")

        // Ripples: half a real second after a Preon boundary, κ and λ ripple; a jump there does not.
        let preon = clock.level(at: vectorA, 8)!
        var after = FocusHarmonics()
        after.update(input(preon.start + 0.5))
        check(after.levels[8].ripple > 0, "ι ripples after its boundary: \(after.levels[8].ripple)")
        check(after.levels[10].ripple > 0, "λ ripples with it")
        check(after.levels[11].ripple == 0, "μ never ripples at real speed (cycle too short)")
        check(after.levels[8].ripple > after.levels[10].ripple, "the coarser boundary ripples harder")
        var jumped = FocusHarmonics()
        jumped.update(input(preon.start + 0.5, since: 0.2))
        check(jumped.levels.allSatisfy { $0.ripple == 0 }, "a boundary crossed by a jump does not ripple")
        var later = FocusHarmonics()
        later.update(input(preon.start + 3))
        check(later.levels[8].ripple == 0, "ripples end after their lifetime")

        // Reduce Motion.
        var calm = FocusHarmonics()
        calm.update(input(preon.start + 0.5, calm: true))
        check(calm.shimmer == 0 && calm.levels[11].amplitude == 0 && calm.levels[12].amplitude == 0, "calm: no shimmer, μ ν rest")
        check(calm.levels.allSatisfy { $0.ripple == 0 }, "calm: no ripples")
        check(calm.levels[6].amplitude == 1, "calm: slow levels stay")

        // Outside the catalogue: nothing is read.
        var outside = FocusHarmonics()
        outside.update(input(clock.tMax + 86_400))
        check(!outside.inRange && outside.breathCue == 0 && outside.levels.allSatisfy { $0.amplitude == 0 }, "out of range: dormant")
        var before = FocusHarmonics()
        before.update(input(clock.tMin - 1))
        check(!before.inRange, "before the catalogue: dormant")
        // The edges themselves read.
        var edge = FocusHarmonics()
        edge.update(input(clock.tMax))
        check(edge.inRange, "tMax reads")
        var start = FocusHarmonics()
        start.update(input(clock.tMin))
        check(start.inRange, "tMin reads")
    }

    // MARK: Parity with the web app

    /// Values printed by the web app's JavaScript (fractonica.js + src/core/model.js + pure.js, node 24) at the same
    /// instants: each level's phase (model.levelAt(t, L).phase, 4 decimals), the minor clock (pure.clockText) and pure
    /// spans (pure.duration(s, {at: t})).
    static func webParity() {
        let web: [(t: Double, clock: String, phases: [Double])] = [
            (1_791_460_800, "34η 29ι 21λ", [0.7320, 0.6598, 0.5776, 0.8878, 0.4392, 0.0741, 0.8146, 0.3313, 0.3252, 0.6260, 0.1385, 0.6927, 0.4635]),
            (946_684_800, "21η 12ι 6λ", [0.3608, 0.8039, 0.4506, 0.2528, 0.2641, 0.8487, 0.3360, 0.0240, 0.0959, 0.4794, 0.2324, 0.1622, 0.8111]),
            (2_886_085_800, "1η 23ι 1λ", [0.2129, 0.0646, 0.8403, 0.2017, 0.0083, 0.0582, 0.6397, 0.7572, 0.0289, 0.1445, 0.8780, 0.3898, 0.9490]),
            (clock.tMin + 3600, "1η 7ι 8λ", [0.0000, 0.0000, 0.0001, 0.0005, 0.0026, 0.0180, 0.1979, 0.7813, 0.1253, 0.6263, 0.1424, 0.7118, 0.5590]),
            (clock.tMax - 3600, "20η 1ι 56λ", [0.2500, 0.2500, 0.2499, 0.2495, 0.2474, 0.7320, 0.0521, 0.4687, 0.8748, 0.3739, 0.8601, 0.3007, 0.5037]),
        ]
        for row in web {
            var h = FocusHarmonics()
            h.update(input(row.t))
            for (level, phase) in row.phases.enumerated() {
                let d = abs(h.levels[level].phase - phase)
                check(min(d, 1 - d) < 6e-5, "web parity at \(row.t): level \(level) phase \(h.levels[level].phase) vs \(phase)")
            }
            check(Notation.standard.clockText(at: row.t) == row.clock, "web parity at \(row.t): clock \(Notation.standard.clockText(at: row.t)) vs \(row.clock)")
            check(FocusText.span(2015, pure: true, at: row.t) == "3ι 64λ", "web parity: 2015 s is 3ι 64λ, got \(FocusText.span(2015, pure: true, at: row.t))")
            check(FocusText.span(30, pure: true, at: row.t) == "3λ 21ν", "web parity: 30 s is 3λ 21ν, got \(FocusText.span(30, pure: true, at: row.t))")
        }
        check(Notation.standard.catalogueText() == "α#1 – α#18", "web parity: catalogue text \(Notation.standard.catalogueText())")
    }

    // MARK: Sessions

    static func sessions() {
        let preon = FocusLength.preon.seconds(startingAt: vectorA)!
        check(abs(preon - clock.level(at: vectorA, 8)!.duration) < 1e-9, "1ι is the running Preon's length")
        check(abs(preon - 505.3) < 2, "1ι ≈ 8.4 min: \(preon)")
        let four = FocusLength.fourPreons.seconds(startingAt: vectorA)!
        check(abs(four - 4 * preon) < 1e-9, "4ι is four Preons")
        let helion = FocusLength.helion.seconds(startingAt: vectorA)!
        check(abs(helion / 3600 - 5.05) < 0.02, "1η ≈ 5.05 h: \(helion / 3600)")
        check(FocusLength.open.seconds(startingAt: vectorA) == nil, "open has no length")
        let outside = FocusLength.preon.seconds(startingAt: clock.tMax + 1e6)!
        check(abs(outside - clock.levelInfo(8).meanSeconds) < 1e-9, "outside the catalogue: the mean Preon")

        let s = FocusSession(length: .preon, start: 1000)
        check(s.end == 1000 + FocusLength.preon.seconds(startingAt: 1000)!, "session end")
        check(s.remaining(at: 1100)! > 0 && !s.isComplete(at: 1100), "running")
        check(s.isComplete(at: s.end!) && s.remaining(at: s.end! + 5) == 0, "complete at the end")
        check(abs(s.progress(at: 1000 + (s.end! - 1000) / 2) - 0.5) < 1e-9, "progress halfway")
        let open = FocusSession(length: .open, start: 1000)
        check(open.end == nil && open.remaining(at: 2000) == nil && !open.isComplete(at: 1e12), "open session")
        check(open.elapsed(at: 1300) == 300, "elapsed")
    }

    // MARK: Spans

    static func spans() {
        check(FocusText.span(504.2, pure: false, at: vectorA) == "8:25", "Earth span rounds up: \(FocusText.span(504.2, pure: false, at: vectorA))")
        check(FocusText.span(0, pure: false, at: vectorA) == "0:00", "Earth zero")
        check(FocusText.span(18_187, pure: false, at: vectorA) == "5:03:07", "Earth hours: \(FocusText.span(18_187, pure: false, at: vectorA))")
        let pure = FocusText.span(2021, pure: true, at: vectorA)
        check(pure.hasPrefix("3ι") || pure.hasPrefix("4ι"), "pure span in Preons: \(pure)")
        for seconds in [0.2, 5.0, 61.0, 505.0, 2021.0, 18_187.0] {
            let text = FocusText.span(seconds, pure: true, at: vectorA)
            let earthish = text.contains(":") || text.contains("s") || text.contains("min") || text.contains("h ") || text.contains("%")
            check(!earthish, "pure span has no Earth units: \(text)")
        }
        check(FocusText.approximate(.preon, pure: true, at: vectorA) == nil, "no Earth hint in pure mode")
        check(FocusText.approximate(.open, pure: false, at: vectorA) == nil, "no hint for open")
        check(FocusText.approximate(.fourPreons, pure: false, at: vectorA)?.hasPrefix("≈ 33 min") == true,
              "Earth hint of 4ι: \(FocusText.approximate(.fourPreons, pure: false, at: vectorA) ?? "nil")")
    }

    // MARK: Model

    @MainActor
    static func model() {
        let defaults = UserDefaults(suiteName: "focus.checks.\(UUID().uuidString)")!
        let model = FocusModel(defaults: defaults)
        check(model.style == .interference && model.length == .fourPreons && model.breathing, "defaults")
        model.style = .aurora
        model.length = .preon
        model.breathing = false
        let again = FocusModel(defaults: defaults)
        check(again.style == .aurora && again.length == .preon && !again.breathing, "preferences persist")

        var now = 10_000.0
        model.now = { now }
        var completions: [(FocusSession, Bool)] = []
        model.onComplete = { completions.append(($0, $1)) }
        model.attach()
        check(model.session?.length == .preon && model.session?.start == 10_000, "attaching starts a session")
        model.attach()
        model.detach()
        check(model.session != nil, "a second viewer leaving keeps it")
        let end = model.session!.end!
        now = end - 1
        model.refresh()
        check(completions.isEmpty, "not yet")
        now = end + 1
        model.refresh()
        check(completions.count == 1 && completions[0].1 == false, "completes on time, with a chime")
        check(model.completed?.length == .preon, "remembers the completed session")
        check(model.session?.length == .open && model.session?.start == end, "carries on open from the end")
        model.choose(.helion)
        check(model.completed == nil && model.session?.length == .helion && model.session?.start == now, "choosing restarts")
        now = model.session!.end! + 60
        model.refresh()
        check(completions.count == 2 && completions[1].1 == true, "a completion noticed late is silent")
        model.start(elapsed: 100)
        check(model.session?.start == now - 100, "start with elapsed time")
        model.detach()
        check(model.session == nil && !model.isShowing, "the last viewer ends the session")
        let left = now - 100
        now += 0.4
        model.attach()
        check(model.session?.start == left, "a view appearing just after the last one left carries on its session")
        model.detach()
        now += 2
        model.attach()
        check(model.session?.start == now, "later, a new session starts")
        model.detach()
    }

    // MARK: Chime

    static func chime() {
        let wav = FocusChimeSynth.wav()
        check(wav.count == 44 + Int(Double(FocusChimeSynth.sampleRate) * FocusChimeSynth.seconds) * 2, "WAV size \(wav.count)")
        check(String(decoding: wav.prefix(4), as: UTF8.self) == "RIFF" && String(decoding: wav[8..<12], as: UTF8.self) == "WAVE", "RIFF/WAVE header")
        let samples = FocusChimeSynth.samples()
        let peak = samples.map(abs).max() ?? 0
        check(abs(Double(peak) - FocusChimeSynth.peak) < 0.01, "peak level \(peak)")
        check(abs(samples.last ?? 1) < 1e-4 && abs(samples.first ?? 1) < 1e-3, "starts and ends silent")
    }

    // MARK: Styles

    static func styles() {
        check(FocusStyle.interference.advanced(by: -1) == .aurora && FocusStyle.aurora.advanced(by: 1) == .interference, "styles wrap")
        check(Set(FocusStyle.allCases.map(\.shaderIndex)) == [0, 1, 2, 3], "shader indices")
        check(MemoryLayout<FocusUniforms>.stride == 128 && MemoryLayout<FocusGPULevel>.stride == 80, "uniform layouts match the shaders")

        // The per-frame constants the CPU computes for the shaders.
        var h = FocusHarmonics()
        h.update(input(vectorA))
        for i in 0...12 {
            let place = FocusRenderer.place(of: i, h)
            let radius = Double((place.x * place.x + place.y * place.y).squareRoot())
            let expected = i <= 4 ? 0.45 + 0.08 * Double(i) : 0.06 + 0.035 * Double(i - 5)
            check(abs(radius - expected) < 1e-5, "level \(i) circles at its radius: \(radius) vs \(expected)")
        }
        check(FocusRenderer.place(of: 3, h).z != 0 && FocusRenderer.place(of: 7, h).z == 0, "harmonograph glows for γ … ζ only")
        let tip = FocusRenderer.penTip(h)
        check(tip.x.isFinite && tip.y.isFinite && (tip.x * tip.x + tip.y * tip.y).squareRoot() < 1.5, "pen tip on the canvas: \(tip)")
    }

    // MARK: Shaders

    @MainActor
    static func shaders() async {
        let pipelines: FocusPipelines
        do {
            let started = CACurrentMediaTimeLike()
            pipelines = try await FocusPipelines.load()
            print(String(format: "  shaders compiled in %.0f ms (8 field pipelines + the trail)", (CACurrentMediaTimeLike() - started) * 1000))
        } catch {
            check(false, "shaders compile: \(error)")
            return
        }
        guard let renderer = FocusRenderer(pipelines: pipelines) else {
            check(false, "renderer")
            return
        }
        let env = ProcessInfo.processInfo.environment
        let folder = env["FOCUS_SHOTS"].map { URL(fileURLWithPath: $0, isDirectory: true) }
        var width = 1206, height = 2622
        if let size = env["FOCUS_SHOTS_SIZE"]?.split(separator: "x").compactMap({ Int($0) }), size.count == 2 {
            width = size[0]
            height = size[1]
        }
        let only = env["FOCUS_SHOTS_STYLE"].flatMap(FocusStyle.init(rawValue:))
        let instants: [(String, Double)] = [
            ("A", vectorA), ("y2000", 946_684_800), ("y2061", 2_886_085_800), ("start", clock.tMin + 10), ("end", clock.tMax - 10),
        ]
        let descriptor = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: pipelines.pixelFormat, width: width, height: height, mipmapped: false)
        descriptor.usage = [.renderTarget, .shaderRead]
        descriptor.storageMode = .shared
        guard let texture = pipelines.device.makeTexture(descriptor: descriptor) else {
            check(false, "texture")
            return
        }
        for style in FocusStyle.allCases where only == nil || only == style {
            var gpu: [Double] = []
            var cpu: [Double] = []
            for (name, t0) in instants {
                // A short run of frames at 120 Hz, so the timing is warm; the last one is checked.
                var h = FocusHarmonics()
                var buffers: [any MTLCommandBuffer] = []
                for frame in 0..<12 {
                    let t = t0 + Double(frame) / 120
                    let c0 = CACurrentMediaTimeLike()
                    h.update(input(t, calm: env["FOCUS_SHOTS_CALM"] == "1"))
                    var look = FocusLook()
                    look.style = style
                    look.previous = style
                    look.calm = env["FOCUS_SHOTS_CALM"] == "1"
                    look.dim = env["FOCUS_SHOTS_DIM"] == "1" ? 1 : 0
                    renderer.update(harmonics: h, look: look, pixels: SIMD2(Float(width), Float(height)), pointScale: 3, drift: 40 + Double(frame) / 120)
                    guard let buffer = renderer.queue.makeCommandBuffer() else { continue }
                    renderer.encode(buffer, target: texture)
                    buffer.commit()
                    cpu.append(CACurrentMediaTimeLike() - c0)
                    buffers.append(buffer)
                }
                if let last = buffers.last { waitFor(last) }
                // Frames queue back to back: the GPU's time per frame is the span of the run over its frames.
                let run = Array(buffers.dropFirst(3))
                if let first = run.first, let last = run.last, run.count > 1 {
                    gpu.append((last.gpuEndTime - first.gpuStartTime) / Double(run.count))
                }
                let stats = pixelStats(texture)
                check(!stats.allBlack, "\(style.rawValue) at \(name) draws something (max \(stats.max))")
                check(stats.mean < 200, "\(style.rawValue) at \(name) is not blown out (mean \(stats.mean))")
                if let folder {
                    let url = folder.appendingPathComponent("\(style.rawValue)-\(name).png")
                    writePNG(texture, to: url)
                }
            }
            let mean = gpu.reduce(0, +) / Double(max(1, gpu.count))
            let cpuMean = cpu.reduce(0, +) / Double(max(1, cpu.count))
            let best = gpu.min() ?? 0
            print(String(format: "  %@: GPU %.2f ms/frame (best %.2f, max %.2f) at %dx%d · CPU %.3f ms/frame (harmonics + encode)",
                         style.rawValue, mean * 1000, best * 1000, (gpu.max() ?? 0) * 1000, width, height, cpuMean * 1000))
            // A sanity bound on the best run only: the build machine's GPU is shared with simulators and other builds.
            // Uncontended, every style takes under 2 ms here at this size; the old single pipeline that switched styles
            // at run time took 9 … 14.
            check(best < 0.008, "\(style.rawValue) renders in under 8 ms on this Mac: \(best * 1000) ms")
        }
        // A cross-fade draws both styles: halfway, the picture holds some of each.
        for (from, to) in [(FocusStyle.rings, FocusStyle.aurora), (.harmonograph, .interference)] {
            var h = FocusHarmonics()
            h.update(input(vectorA))
            var look = FocusLook()
            look.previous = from
            look.style = to
            look.transition = 0.5
            renderer.update(harmonics: h, look: look, pixels: SIMD2(Float(width), Float(height)), pointScale: 3, drift: 40)
            guard let buffer = renderer.queue.makeCommandBuffer() else { continue }
            renderer.encode(buffer, target: texture)
            buffer.commit()
            waitFor(buffer)
            let stats = pixelStats(texture)
            check(!stats.allBlack && stats.mean < 200, "cross-fade \(from.rawValue) → \(to.rawValue) draws (mean \(stats.mean))")
            if let folder { writePNG(texture, to: folder.appendingPathComponent("fade-\(from.rawValue)-\(to.rawValue).png")) }
        }
        // Out of range: a dark ember, never a reading.
        var outside = FocusHarmonics()
        outside.update(input(clock.tMax + 1e6))
        renderer.update(harmonics: outside, look: FocusLook(), pixels: SIMD2(Float(width), Float(height)), pointScale: 3, drift: 1)
        if let buffer = renderer.queue.makeCommandBuffer() {
            renderer.encode(buffer, target: texture)
            buffer.commit()
            waitFor(buffer)
            let stats = pixelStats(texture)
            check(stats.mean < 30, "out of range stays dark (mean \(stats.mean))")
            if let folder { writePNG(texture, to: folder.appendingPathComponent("outside.png")) }
        }
    }

    /// Blocks until the GPU is done (a synchronous helper: the async variant would send the buffer off the main actor).
    static func waitFor(_ buffer: any MTLCommandBuffer) { buffer.waitUntilCompleted() }

    static func CACurrentMediaTimeLike() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1e9 }

    static func pixelStats(_ texture: any MTLTexture) -> (allBlack: Bool, max: Int, mean: Double) {
        let w = texture.width, h = texture.height
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        texture.getBytes(&bytes, bytesPerRow: w * 4, from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
        var top = 0
        var sum = 0
        var i = 0
        while i < bytes.count {
            let v = max(Int(bytes[i]), Int(bytes[i + 1]), Int(bytes[i + 2]))
            top = max(top, v)
            sum += v
            i += 4 * 7
        }
        return (top < 40, top, Double(sum) / Double(bytes.count / (4 * 7)))
    }

    static func writePNG(_ texture: any MTLTexture, to url: URL) {
        let w = texture.width, h = texture.height
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        texture.getBytes(&bytes, bytesPerRow: w * 4, from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)
        guard let provider = CGDataProvider(data: Data(bytes) as CFData),
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let image = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4, space: space,
                                  bitmapInfo: info, provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
    }
}
