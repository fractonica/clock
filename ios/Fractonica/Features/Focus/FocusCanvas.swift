import Metal
import QuartzCore
import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// What the screen asks of the picture.
struct FocusCanvasConfig: Equatable {
    var style: FocusStyle = .interference
    var breathing = true
    /// Reduce Motion: the calm variant (no shimmer, ripples or zoom; lively levels at rest).
    var calm = false
    /// The overlay is up: dim the picture a little behind it.
    var dimmed = false
    /// The scene is not in the background (GPU work is not allowed there on iOS).
    var active = true
    /// A fixed moment to show instead of the displayed time (the -FXFocusTime test hook; may lie outside the catalogue).
    var timeOverride: Double?
    /// Print the frame statistics every few seconds.
    var logStats = false
}

/// The Focus picture: a Metal layer drawn on every display refresh (up to 120 Hz on ProMotion), fed the clock's
/// harmonics at the displayed time (`ClockStore.time(at:)` at the frame's target instant).
///
/// The layer runs its own display link rather than a SwiftUI `ClockTimeline`: it draws without re-evaluating any
/// SwiftUI view per frame, asks for the frame rate it wants (`preferredFrameRateRange`) and reads each frame's
/// target timestamp. It still reads the time from the shared `ClockStore`, stops in the background and when it leaves
/// the window, and draws nothing until the shaders are compiled (then fades in).
struct FocusCanvas: View {
    var config: FocusCanvasConfig
    var stats: FocusFrameStats

    @Environment(ClockStore.self) private var store

    var body: some View {
        FocusCanvasRepresentable(store: store, config: config, stats: stats)
            .background(Theme.background)
    }
}

#if os(iOS)
private struct FocusCanvasRepresentable: UIViewRepresentable {
    let store: ClockStore
    let config: FocusCanvasConfig
    let stats: FocusFrameStats

    func makeUIView(context: Context) -> FocusMetalView {
        FocusMetalView(driver: FocusDriver(store: store, config: config, stats: stats))
    }

    func updateUIView(_ view: FocusMetalView, context: Context) {
        view.driver.config = config
    }

    static func dismantleUIView(_ view: FocusMetalView, coordinator: ()) {
        view.driver.stop()
    }
}

/// A view backed by a `CAMetalLayer`.
final class FocusMetalView: UIView {
    let driver: FocusDriver

    override class var layerClass: AnyClass { CAMetalLayer.self }

    init(driver: FocusDriver) {
        self.driver = driver
        super.init(frame: .zero)
        isOpaque = true
        backgroundColor = UIColor(Theme.background)
        isUserInteractionEnabled = false
        driver.attach(layer: layer as! CAMetalLayer)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        driver.layout(points: bounds.size, nativeScale: window?.screen.nativeScale ?? traitCollection.displayScale)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if let window {
            driver.layout(points: bounds.size, nativeScale: window.screen.nativeScale)
            let link = CADisplayLink(target: driver, selector: #selector(FocusDriver.step(_:)))
            driver.start(link: link, maximumFramesPerSecond: window.screen.maximumFramesPerSecond)
        } else {
            driver.stop()
        }
    }
}
#elseif os(macOS)
private struct FocusCanvasRepresentable: NSViewRepresentable {
    let store: ClockStore
    let config: FocusCanvasConfig
    let stats: FocusFrameStats

    func makeNSView(context: Context) -> FocusMetalView {
        FocusMetalView(driver: FocusDriver(store: store, config: config, stats: stats))
    }

    func updateNSView(_ view: FocusMetalView, context: Context) {
        view.driver.config = config
    }

    static func dismantleNSView(_ view: FocusMetalView, coordinator: ()) {
        view.driver.stop()
    }
}

/// A view backed by a `CAMetalLayer`.
final class FocusMetalView: NSView {
    let driver: FocusDriver
    private let metalLayer = CAMetalLayer()

    init(driver: FocusDriver) {
        self.driver = driver
        super.init(frame: .zero)
        wantsLayer = true
        layerContentsRedrawPolicy = .never
        driver.attach(layer: metalLayer)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func makeBackingLayer() -> CALayer { metalLayer }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func layout() {
        super.layout()
        relayout()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        relayout()
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil {
            relayout()
            let link = displayLink(target: driver, selector: #selector(FocusDriver.step(_:)))
            driver.start(link: link, maximumFramesPerSecond: window?.screen?.maximumFramesPerSecond ?? 60)
        } else {
            driver.stop()
        }
    }

    private func relayout() {
        driver.layout(points: bounds.size, nativeScale: window?.backingScaleFactor ?? 2)
    }
}
#endif

/// Drives the picture: one display link, one renderer, the harmonics of each frame, the look's easing (style
/// cross-fades, the overlay's dimming, the fade-in) and an adaptive resolution that keeps the GPU well inside the frame.
@MainActor
final class FocusDriver: NSObject {
    var config: FocusCanvasConfig {
        didSet {
            if config.style != oldValue.style { beginTransition(from: oldValue.style) }
            if config.calm != oldValue.calm { updateFrameRate() }
        }
    }

    let stats: FocusFrameStats
    private let store: ClockStore
    private var renderer: FocusRenderer?
    private var loading: Task<Void, Never>?
    private var harmonics = FocusHarmonics()
    private weak var layer: CAMetalLayer?
    private var link: CADisplayLink?
    private var maximumFramesPerSecond = 60

    private let started = CACurrentMediaTime()
    private var readyAt: Double?
    private var revision: Int
    private var discontinuityAt: Double
    private var previousStyle: FocusStyle
    private var transitionStart = -100.0
    private var dim = 0.0
    private var lastFrame: Double?

    /// The view's size in points and the screen's scale, and the scale the picture renders at (≤ the screen's).
    private var points = CGSize(width: 1, height: 1)
    private var nativeScale: CGFloat = 2
    private var renderScale: CGFloat = 2
    private var lastScaleChange = 0.0
    private var lastLog = 0.0
    private var lastPowerCheck = 0.0
    private var lowPower = false

    /// The style cross-fade, seconds.
    static let transitionTime = 0.9
    /// The most pixels the picture renders before its scale drops below the screen's.
    static let pixelBudget = 4.2e6

    init(store: ClockStore, config: FocusCanvasConfig, stats: FocusFrameStats) {
        self.store = store
        self.config = config
        self.stats = stats
        revision = store.revision
        discontinuityAt = Date.now.timeIntervalSince1970
        previousStyle = config.style
        dim = config.dimmed ? 1 : 0
        super.init()
    }

    func attach(layer: CAMetalLayer) {
        self.layer = layer
        layer.pixelFormat = FocusPipelines.defaultPixelFormat
        layer.framebufferOnly = true
        layer.isOpaque = true
        layer.maximumDrawableCount = 3
        #if os(macOS)
        layer.colorspace = CGColorSpace(name: CGColorSpace.sRGB)
        #endif
        loadPipelines()
    }

    private func loadPipelines() {
        guard renderer == nil, loading == nil else { return }
        loading = Task { [weak self] in
            guard let pipelines = try? await FocusPipelines.load() else { return }
            guard let self else { return }
            renderer = FocusRenderer(pipelines: pipelines)
            if let layer { layer.device = pipelines.device }
            readyAt = CACurrentMediaTime()
            loading = nil
        }
    }

    // MARK: Display link

    func start(link newLink: CADisplayLink, maximumFramesPerSecond: Int) {
        link?.invalidate()
        link = newLink
        self.maximumFramesPerSecond = max(30, maximumFramesPerSecond)
        lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
        updateFrameRate()
        newLink.add(to: .main, forMode: .common)
    }

    func stop() {
        link?.invalidate()
        link = nil
        lastFrame = nil
    }

    /// 120 Hz where the display can (60 under Low Power Mode, 60 for the calm variant, which moves little).
    private func updateFrameRate() {
        guard let link else { return }
        var top = Float(maximumFramesPerSecond)
        if lowPower || config.calm { top = min(top, 60) }
        link.preferredFrameRateRange = CAFrameRateRange(minimum: min(30, top), maximum: top, preferred: top)
    }

    func layout(points: CGSize, nativeScale: CGFloat) {
        self.points = points
        self.nativeScale = max(1, nativeScale)
        renderScale = Self.scale(points: points, nativeScale: self.nativeScale, budget: Self.pixelBudget)
        applyScale()
    }

    private func applyScale() {
        guard let layer else { return }
        layer.contentsScale = renderScale
        layer.drawableSize = CGSize(width: max(1, (points.width * renderScale).rounded()), height: max(1, (points.height * renderScale).rounded()))
    }

    /// The scale to render at: the screen's, at most 2× (the picture is soft light, not text), and within the pixel
    /// budget.
    nonisolated static func scale(points: CGSize, nativeScale: CGFloat, budget: Double) -> CGFloat {
        let area = max(1, Double(points.width * points.height))
        return max(1, min(nativeScale, 2, CGFloat((budget / area).squareRoot())))
    }

    @objc func step(_ link: CADisplayLink) {
        let interval = link.targetTimestamp - link.timestamp
        render(frameInterval: interval > 0 ? interval : link.duration, targetTimestamp: link.targetTimestamp)
    }

    // MARK: Frames

    private func beginTransition(from old: FocusStyle) {
        let now = CACurrentMediaTime()
        // A new choice in the middle of a fade starts from whatever is more visible.
        let progress = (now - transitionStart) / Self.transitionTime
        previousStyle = progress < 0.5 ? previousStyle : old
        transitionStart = now
    }

    private func render(frameInterval: Double, targetTimestamp: CFTimeInterval) {
        guard config.active, let renderer, let layer, layer.drawableSize.width > 1 else { return }
        let cpuStart = CACurrentMediaTime()
        let real = Date.now.timeIntervalSince1970 + (targetTimestamp - cpuStart)
        let frameDate = Date(timeIntervalSince1970: real)

        let t: Double
        let rate: Double
        if let fixed = config.timeOverride {
            t = fixed
            rate = 0
        } else {
            t = store.time(at: frameDate)
            rate = store.isLive ? 1 : store.rate
        }
        if store.revision != revision {
            revision = store.revision
            discontinuityAt = real
        }
        harmonics.update(FocusHarmonics.Input(
            t: t, rate: rate, real: real,
            frameInterval: min(0.1, max(1.0 / 240, frameInterval)),
            sinceDiscontinuity: real - discontinuityAt,
            calm: config.calm, breathing: config.breathing
        ))

        let dt = lastFrame.map { min(0.1, max(0, cpuStart - $0)) } ?? 0
        lastFrame = cpuStart
        dim += ((config.dimmed ? 1 : 0) - dim) * (1 - exp(-dt / 0.28))
        let linear = min(1, max(0, (cpuStart - transitionStart) / Self.transitionTime))
        var look = FocusLook()
        look.style = config.style
        look.previous = previousStyle
        look.transition = linear * linear * (3 - 2 * linear)
        look.calm = config.calm
        look.dim = dim
        look.fade = readyAt.map { min(1, (cpuStart - $0) / 0.8) } ?? 0

        let size = layer.drawableSize
        renderer.update(harmonics: harmonics, look: look, pixels: SIMD2(Float(size.width), Float(size.height)),
                        pointScale: Float(renderScale), drift: cpuStart - started)
        guard let drawable = layer.nextDrawable(), let buffer = renderer.queue.makeCommandBuffer() else { return }
        renderer.encode(buffer, target: drawable.texture)
        buffer.present(drawable)
        let stats = stats
        buffer.addCompletedHandler { done in
            stats.recordGPU(done.gpuEndTime - done.gpuStartTime)
        }
        buffer.commit()
        stats.recordCPU(CACurrentMediaTime() - cpuStart, at: cpuStart, pixels: Int(size.width * size.height))
        housekeeping(now: cpuStart, frameInterval: frameInterval)
    }

    /// Every couple of seconds: Low Power Mode, the adaptive resolution and the optional log line.
    private func housekeeping(now: Double, frameInterval: Double) {
        if now - lastPowerCheck > 2 {
            lastPowerCheck = now
            let power = ProcessInfo.processInfo.isLowPowerModeEnabled
            if power != lowPower {
                lowPower = power
                updateFrameRate()
            }
        }
        // Keep the GPU under about 60 % of the frame: step the scale down when it is busier, back up when idle.
        if now - lastScaleChange > 2, now - (readyAt ?? now) > 1.5 {
            let summary = stats.summary
            let budget = max(1.0 / 120, frameInterval)
            let ceiling = Self.scale(points: points, nativeScale: nativeScale, budget: Self.pixelBudget)
            if summary.gpu > 0.6 * budget, renderScale > 1 {
                renderScale = max(1, renderScale * 0.85)
                lastScaleChange = now
                applyScale()
            } else if summary.gpu > 0, summary.gpu < 0.25 * budget, renderScale < ceiling - 0.01 {
                renderScale = min(ceiling, renderScale * 1.1)
                lastScaleChange = now
                applyScale()
            }
        }
        if config.logStats, now - lastLog > 3 {
            lastLog = now
            FocusLaunch.log("\(config.style.rawValue) \(stats.line) · scale \(String(format: "%.2f", renderScale))")
        }
    }
}

