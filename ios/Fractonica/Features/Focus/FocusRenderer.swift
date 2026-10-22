import FractonicaKit
import Metal
import QuartzCore
import Synchronization

/// The uniforms every Focus shader reads (`Header` in FocusShaders): seven float4, no padding surprises.
struct FocusUniforms: Sendable {
    /// Width px, height px, px per point, min(width, height) px.
    var view = SIMD4<Float>(1, 1, 1, 1)
    /// Drift s (real, from the renderer's start), breath 0…1, breath cue 0…1, calm 0…1.
    var clock = SIMD4<Float>(0, 0.5, 0, 0)
    /// Style A, style B, mix A→B, alive 0…1.
    var style = SIMD4<Float>(0, 0, 0, 1)
    /// Shimmer 0…1, dim 0…1, frame seed, exposure.
    var extra = SIMD4<Float>(0, 0, 0, 1)
    /// Harmonograph segments, line width pt, line alpha, unused.
    var lines = SIMD4<Float>(0, 1, 0, 0)
    /// Background rgb (linear).
    var ground = SIMD4<Float>(0, 0, 0, 0)
    /// The accent (teal) rgb (linear), for the breathing cue.
    var accent = SIMD4<Float>(0, 0, 0, 0)
}

/// One level as the shaders read it (`Level` in FocusShaders).
struct FocusGPULevel: Sendable {
    /// Phase, amplitude, ripple, ripple age.
    var motion = SIMD4<Float>(0, 0, 0, 0)
    /// Linear rgb, weight.
    var color = SIMD4<Float>(0, 0, 0, 0)
    /// Siblings, factor, unused, unused.
    var info = SIMD4<Float>(0, 0, 0, 0)
}

/// How a frame should look, apart from the clock: the style (and the one it is leaving), Reduce Motion, the overlay's
/// dimming and whether the clock has a reading at all.
struct FocusLook: Sendable, Equatable {
    var style: FocusStyle = .interference
    /// The style being left during a transition, and how far the transition is (0 … 1).
    var previous: FocusStyle = .interference
    var transition: Double = 1
    var calm = false
    /// 0 … 1: dims the picture behind the overlay.
    var dim: Double = 0
    /// 0 … 1: fades the picture in once the shaders are ready.
    var fade: Double = 1
}

/// The compiled shaders: one pipeline for the full-screen field, one for the harmonograph's trail. Built once per
/// process off the main thread (the runtime compiler takes a moment); pipeline states are immutable and thread-safe.
final class FocusPipelines: @unchecked Sendable {
    let device: any MTLDevice
    let field: any MTLRenderPipelineState
    let lines: any MTLRenderPipelineState
    let pixelFormat: MTLPixelFormat

    /// The format of the drawables and textures Focus renders into: 8-bit sRGB, so blending happens in linear light.
    static let defaultPixelFormat = MTLPixelFormat.bgra8Unorm_srgb

    init(device: any MTLDevice, pixelFormat: MTLPixelFormat = defaultPixelFormat) throws {
        self.device = device
        self.pixelFormat = pixelFormat
        let options = MTLCompileOptions()
        options.mathMode = .fast
        let library = try device.makeLibrary(source: FocusShaders.source, options: options)

        let field = MTLRenderPipelineDescriptor()
        field.label = "Focus field"
        field.vertexFunction = library.makeFunction(name: "focusFieldVertex")
        field.fragmentFunction = library.makeFunction(name: "focusFieldFragment")
        field.colorAttachments[0].pixelFormat = pixelFormat
        self.field = try device.makeRenderPipelineState(descriptor: field)

        let lines = MTLRenderPipelineDescriptor()
        lines.label = "Focus harmonograph"
        lines.vertexFunction = library.makeFunction(name: "focusLineVertex")
        lines.fragmentFunction = library.makeFunction(name: "focusLineFragment")
        let attachment = lines.colorAttachments[0]!
        attachment.pixelFormat = pixelFormat
        attachment.isBlendingEnabled = true
        attachment.rgbBlendOperation = .add
        attachment.alphaBlendOperation = .add
        attachment.sourceRGBBlendFactor = .one
        attachment.destinationRGBBlendFactor = .one
        attachment.sourceAlphaBlendFactor = .zero
        attachment.destinationAlphaBlendFactor = .one
        self.lines = try device.makeRenderPipelineState(descriptor: lines)
    }

    /// The process's pipelines for the system GPU, built on first use (off the main actor) and kept.
    @MainActor
    static func load() async throws -> FocusPipelines {
        if let cached { return cached }
        if let pending { return try await pending.value }
        guard let device = MTLCreateSystemDefaultDevice() else { throw FocusRenderError.noDevice }
        let box = DeviceBox(device: device)
        let task = Task.detached(priority: .userInitiated) { try FocusPipelines(device: box.device) }
        pending = task
        defer { pending = nil }
        let made = try await task.value
        cached = made
        return made
    }

    @MainActor private static var cached: FocusPipelines?
    @MainActor private static var pending: Task<FocusPipelines, any Error>?

    /// Carries the device into the compile task (MTLDevice is thread-safe).
    private struct DeviceBox: @unchecked Sendable { let device: any MTLDevice }
}

enum FocusRenderError: Error {
    case noDevice
}

/// Turns a frame's harmonics and look into uniforms and encodes the frame: the field in one full-screen triangle,
/// then, for the harmonograph, its trail as one triangle strip blended additively. Platform-neutral (Metal only):
/// the app drives it from a display link, the checks render offscreen with it.
@MainActor
final class FocusRenderer {
    let pipelines: FocusPipelines
    let queue: any MTLCommandQueue
    private(set) var uniforms = FocusUniforms()
    private(set) var levels: [FocusGPULevel]
    private var frame = 0

    /// Segments of the harmonograph's trail (two vertices each).
    static let trailSegments = 12_000
    /// Line width of the trail in points.
    static let trailWidth: Float = 1.15
    static let trailAlpha: Float = 0.30

    /// How prominent each level is: the everyday units in front, the slowest and the fastest behind.
    static let weights: [Float] = [0.3, 0.3, 0.3, 0.5, 0.6, 0.75, 1, 1, 0.95, 0.9, 0.85, 0.6, 0.4, 0.3, 0.2, 0.15]

    init?(pipelines: FocusPipelines, palette: FocusPalette = .standard, clock: FractonicaClock = .shared) {
        guard let queue = pipelines.device.makeCommandQueue() else { return nil }
        queue.label = "Focus"
        self.pipelines = pipelines
        self.queue = queue
        levels = (0..<FocusHarmonics.levelCount).map { level in
            let info = clock.levelInfo(min(level, Fractonica.supportedLevels.upperBound))
            let rgb = palette.levels[min(level, palette.levels.count - 1)]
            return FocusGPULevel(
                motion: .zero,
                color: SIMD4(rgb, Self.weights[level]),
                info: SIMD4(Float(info.siblings ?? 18), Float(info.factor), 0, 0)
            )
        }
        uniforms.ground = SIMD4(palette.background, 0)
        uniforms.accent = SIMD4(palette.accent, 0)
    }

    /// Fills the uniforms for a frame.
    /// - Parameters:
    ///   - pixels: the target's size in pixels; `pointScale` pixels per point.
    ///   - drift: real seconds since the renderer started (the picture's own slow motion).
    func update(harmonics h: FocusHarmonics, look: FocusLook, pixels: SIMD2<Float>, pointScale: Float, drift: Double) {
        frame &+= 1
        for i in 0..<FocusHarmonics.levelCount {
            let level = h.levels[i]
            levels[i].motion = SIMD4(Float(level.phase), Float(level.amplitude), Float(level.ripple), Float(level.rippleAge))
        }
        let calm: Float = look.calm ? 1 : 0
        uniforms.view = SIMD4(pixels.x, pixels.y, pointScale, max(1, min(pixels.x, pixels.y)))
        uniforms.clock = SIMD4(Float(drift.truncatingRemainder(dividingBy: 36_000)), Float(h.breath), Float(h.breathCue), calm)
        let mix = Float(min(1, max(0, look.transition)))
        // During a transition the field shows A = the style being left and B = the new one.
        let a = Float(look.transition < 1 ? look.previous.shaderIndex : look.style.shaderIndex)
        let b = Float(look.style.shaderIndex)
        uniforms.style = SIMD4(a, b, look.transition < 1 ? mix : 0, h.inRange ? 1 : 0)
        let exposure: Float = 1.6 * Float(min(1, max(0, look.fade)))
        uniforms.extra = SIMD4(Float(h.shimmer), Float(look.dim), Float(frame % 977), exposure)
        let trail = (look.style == .harmonograph ? mix : 0) + (look.previous == .harmonograph && look.transition < 1 ? 1 - mix : 0)
        let alive: Float = h.inRange ? 1 : 0
        uniforms.lines = SIMD4(Float(Self.trailSegments), Self.trailWidth, Self.trailAlpha * trail * alive * Float(min(1, max(0, look.fade))), 0)
    }

    /// Whether the frame draws the harmonograph's trail.
    var drawsTrail: Bool { uniforms.lines.z > 0.001 }

    /// Encodes the frame into `target` (a drawable's texture or an offscreen texture of `pipelines.pixelFormat`).
    func encode(_ commandBuffer: any MTLCommandBuffer, target: any MTLTexture) {
        let pass = MTLRenderPassDescriptor()
        pass.colorAttachments[0].texture = target
        pass.colorAttachments[0].loadAction = .dontCare      // the field covers every pixel
        pass.colorAttachments[0].storeAction = .store
        guard let encoder = commandBuffer.makeRenderCommandEncoder(descriptor: pass) else { return }
        encoder.label = "Focus"
        let trail = drawsTrail
        withUnsafeBytes(of: &uniforms) { header in
            levels.withUnsafeBytes { levels in
                encoder.setRenderPipelineState(pipelines.field)
                encoder.setFragmentBytes(header.baseAddress!, length: header.count, index: 0)
                encoder.setFragmentBytes(levels.baseAddress!, length: levels.count, index: 1)
                encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
                if trail {
                    encoder.setRenderPipelineState(pipelines.lines)
                    encoder.setVertexBytes(header.baseAddress!, length: header.count, index: 0)
                    encoder.setVertexBytes(levels.baseAddress!, length: levels.count, index: 1)
                    encoder.drawPrimitives(type: .triangleStrip, vertexStart: 0, vertexCount: 2 * (Self.trailSegments + 1))
                }
            }
        }
        encoder.endEncoding()
    }
}

/// Per-frame cost, measured by the renderer: CPU time on the main thread (harmonics, uniforms, encoding, commit) and
/// GPU time of the command buffer, averaged over the last frames. Thread-safe: the GPU time arrives on Metal's
/// completion thread.
final class FocusFrameStats: Sendable {
    struct Summary: Sendable, Equatable {
        var frames = 0
        var fps = 0.0
        var cpu = 0.0
        var gpu = 0.0
        var cpuMax = 0.0
        var gpuMax = 0.0
        var pixels = 0
    }

    private struct State {
        var cpu: [Double] = []
        var gpu: [Double] = []
        var stamps: [Double] = []
        var pixels = 0
    }

    private let state = Mutex(State())
    private static let window = 240

    func recordCPU(_ seconds: Double, at stamp: Double, pixels: Int) {
        state.withLock { s in
            s.cpu.append(seconds)
            s.stamps.append(stamp)
            s.pixels = pixels
            if s.cpu.count > Self.window { s.cpu.removeFirst(s.cpu.count - Self.window) }
            if s.stamps.count > Self.window { s.stamps.removeFirst(s.stamps.count - Self.window) }
        }
    }

    func recordGPU(_ seconds: Double) {
        guard seconds > 0, seconds < 1 else { return }
        state.withLock { s in
            s.gpu.append(seconds)
            if s.gpu.count > Self.window { s.gpu.removeFirst(s.gpu.count - Self.window) }
        }
    }

    var summary: Summary {
        state.withLock { s in
            var out = Summary()
            out.frames = s.cpu.count
            out.pixels = s.pixels
            if s.stamps.count > 1, let first = s.stamps.first, let last = s.stamps.last, last > first {
                out.fps = Double(s.stamps.count - 1) / (last - first)
            }
            if !s.cpu.isEmpty {
                out.cpu = s.cpu.reduce(0, +) / Double(s.cpu.count)
                out.cpuMax = s.cpu.max() ?? 0
            }
            if !s.gpu.isEmpty {
                out.gpu = s.gpu.reduce(0, +) / Double(s.gpu.count)
                out.gpuMax = s.gpu.max() ?? 0
            }
            return out
        }
    }

    /// "120 fps · CPU 0.06 ms (max 0.21) · GPU 0.84 ms (max 1.10) · 2.8 Mpx".
    var line: String {
        let s = summary
        func ms(_ x: Double) -> String { String(format: "%.2f", x * 1000) }
        return String(format: "%.0f fps", s.fps) + " · CPU \(ms(s.cpu)) ms (max \(ms(s.cpuMax))) · GPU \(ms(s.gpu)) ms (max \(ms(s.gpuMax))) · "
            + String(format: "%.1f Mpx", Double(s.pixels) / 1e6)
    }
}
