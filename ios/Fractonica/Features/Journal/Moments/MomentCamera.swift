@preconcurrency import AVFoundation
import Observation
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// The instant view's cameras: the back and front cameras at once (`AVCaptureMultiCamSession`, iPhone XS and later)
/// with a live preview of each, one camera where only one runs at a time, the Mac's camera on the Mac, and none in the
/// Simulator (the view shows a placeholder and the reel is drawn instead, so the whole capture runs there too). Each
/// camera runs at the fastest frame rate the session affords (60 frames a second on most iPhones, both cameras at once).
/// `record(from:to:)` films the span from every camera, each into a movie file of its own: `back`, `front`, or
/// `camera` (the Mac).
@MainActor @Observable
final class MomentCamera {
    enum Mode: Equatable {
        case starting
        /// Back and front at once.
        case dual
        /// One camera.
        case single
        /// No camera (Simulator, or none attached): a placeholder.
        case none
        case denied
    }

    private(set) var mode = Mode.starting
    /// The preview layers by camera: `back`, `front` or `camera`.
    private(set) var previews: [String: AVCaptureVideoPreviewLayer] = [:]

    @ObservationIgnored private let rig = CameraRig()

    func start() async {
        #if targetEnvironment(simulator)
        mode = .none
        return
        #else
        guard await AVCaptureDevice.requestAccess(for: .video) else {
            mode = .denied
            return
        }
        let result = await rig.configure()
        previews = result.previews
        mode = result.previews.isEmpty ? .none : result.previews.count > 1 ? .dual : .single
        #endif
    }

    func stop() {
        rig.stop()
    }

    /// Films every camera from Unix time `start` to `end` (from the first frame at or after `start`); returns each
    /// camera's file once the span is over. Cancelling the task ends the films at once.
    func record(from start: Double, to end: Double) async -> [MomentFilm] {
        await rig.record(from: start, to: end)
    }
}

/// The capture session and its outputs, configured and driven on a serial queue of its own; each camera's frames
/// arrive on a queue of their own and go to a `FrameTap`'s film while a recording is on.
private final class CameraRig: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.fractonica.moments.camera")
    private var session: AVCaptureSession?
    /// Frame taps by camera name.
    private var taps: [FrameTap] = []

    struct Configured: @unchecked Sendable {
        var previews: [String: AVCaptureVideoPreviewLayer]
    }

    func configure() async -> Configured {
        await withCheckedContinuation { continuation in
            queue.async {
                continuation.resume(returning: self.build())
            }
        }
    }

    private func build() -> Configured {
        #if os(iOS)
        if AVCaptureMultiCamSession.isMultiCamSupported, let dual = buildDual() { return dual }
        #endif
        return buildSingle()
    }

    private func videoOutput(_ name: String) -> (AVCaptureVideoDataOutput, FrameTap) {
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        // every frame for the film: the writer keeps up (a hardware encoder per camera)
        output.alwaysDiscardsLateVideoFrames = false
        let tap = FrameTap(camera: name)
        output.setSampleBufferDelegate(tap, queue: tap.queue)
        return (output, tap)
    }

    #if os(iOS)
    /// Back and front cameras in one multi-camera session, each with a video data output and a preview layer
    /// connected by hand (Apple's AVMultiCamPiP pattern), at the fastest frame rate the hardware affords for both.
    /// Nil when the hardware cannot afford both at all.
    private func buildDual() -> Configured? {
        let session = AVCaptureMultiCamSession()
        session.beginConfiguration()
        var previews: [String: AVCaptureVideoPreviewLayer] = [:]
        var made: [FrameTap] = []
        var devices: [AVCaptureDevice] = []
        for (name, position) in [("back", AVCaptureDevice.Position.back), ("front", .front)] {
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
                  let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { continue }
            session.addInputWithNoConnections(input)
            guard let port = input.ports(for: .video, sourceDeviceType: device.deviceType, sourceDevicePosition: position).first else { continue }
            let (output, tap) = videoOutput(name)
            guard session.canAddOutput(output) else { continue }
            session.addOutputWithNoConnections(output)
            let connection = AVCaptureConnection(inputPorts: [port], output: output)
            guard session.canAddConnection(connection) else { continue }
            session.addConnection(connection)
            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
            if position == .front, connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = true
            }
            let layer = AVCaptureVideoPreviewLayer(sessionWithNoConnection: session)
            layer.videoGravity = .resizeAspectFill
            let preview = AVCaptureConnection(inputPort: port, videoPreviewLayer: layer)
            if session.canAddConnection(preview) {
                session.addConnection(preview)
                if preview.isVideoRotationAngleSupported(90) { preview.videoRotationAngle = 90 }
                if position == .front, preview.isVideoMirroringSupported {
                    preview.automaticallyAdjustsVideoMirroring = false
                    preview.isVideoMirrored = true
                }
            }
            previews[name] = layer
            made.append(tap)
            devices.append(device)
        }
        let fps = Self.fastestAffordable(devices, session: session)
        session.commitConfiguration()
        guard made.count == 2, session.hardwareCost <= 1, session.systemPressureCost <= 1 else {
            return nil
        }
        momentsLog.info("cameras: back and front at \(fps) fps")
        made.forEach { $0.clock = session.synchronizationClock }
        session.startRunning()
        self.session = session
        taps = made
        return Configured(previews: previews)
    }

    /// Sets each camera to the fastest frame rate both can run at once within the hardware's budget: tries 240, 120,
    /// 60 and 30 frames a second in turn (a camera that cannot reach the rate runs at its own best), each on its
    /// largest multi-camera format of at most 1920 × 1440 that reaches it. Returns the rate settled on.
    private static func fastestAffordable(_ devices: [AVCaptureDevice], session: AVCaptureMultiCamSession) -> Double {
        for rate in [240.0, 120, 60, 30] {
            for device in devices { setFormat(device, fps: rate) }
            if session.hardwareCost <= 1 { return rate }
        }
        return 30
    }

    /// The device's largest multi-camera format (at most 1920 × 1440) reaching `fps`, or failing that its fastest,
    /// locked to that rate.
    private static func setFormat(_ device: AVCaptureDevice, fps: Double) {
        let formats = device.formats.filter { format in
            let d = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return format.isMultiCamSupported && d.width <= 1920 && d.height <= 1440
        }
        func best(_ f: AVCaptureDevice.Format) -> Double { f.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0 }
        func pixels(_ f: AVCaptureDevice.Format) -> Int {
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return Int(d.width) * Int(d.height)
        }
        let reaching = formats.filter { best($0) >= fps }
        let chosen = reaching.max { pixels($0) < pixels($1) }
            ?? formats.max { best($0) < best($1) || (best($0) == best($1) && pixels($0) < pixels($1)) }
        guard let chosen, (try? device.lockForConfiguration()) != nil else { return }
        device.activeFormat = chosen
        let rate = min(fps, best(chosen))
        let frame = CMTime(value: 1000, timescale: CMTimeScale(rate * 1000))
        device.activeVideoMinFrameDuration = frame
        device.activeVideoMaxFrameDuration = frame
        device.unlockForConfiguration()
    }
    #endif

    /// One camera: the back one on iPhone and iPad (the front one where there is no back), the default on the Mac.
    private func buildSingle() -> Configured {
        let session = AVCaptureSession()
        session.beginConfiguration()
        session.sessionPreset = .high
        #if os(iOS)
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
        let name = device?.position == .front ? "front" : "back"
        #else
        let device = AVCaptureDevice.default(for: .video)
        let name = "camera"
        #endif
        guard let device, let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
            session.commitConfiguration()
            return Configured(previews: [:])
        }
        session.addInput(input)
        let (output, tap) = videoOutput(name)
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            return Configured(previews: [:])
        }
        session.addOutput(output)
        #if os(iOS)
        if let c = output.connection(with: .video), c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        if device.position == .front, let c = output.connection(with: .video), c.isVideoMirroringSupported {
            c.automaticallyAdjustsVideoMirroring = false
            c.isVideoMirrored = true
        }
        #endif
        session.commitConfiguration()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        #if os(iOS)
        if let c = layer.connection, c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        #endif
        tap.clock = session.synchronizationClock
        session.startRunning()
        self.session = session
        taps = [tap]
        return Configured(previews: [name: layer])
    }

    func stop() {
        queue.async {
            if let session = self.session, session.isRunning { session.stopRunning() }
            self.session = nil
            self.taps.forEach { $0.cancel() }
            self.taps = []
        }
    }

    /// Films from `start` to `end` on every camera; the files once all are written.
    func record(from start: Double, to end: Double) async -> [MomentFilm] {
        let taps: [FrameTap] = await withCheckedContinuation { continuation in
            queue.async { continuation.resume(returning: self.taps) }
        }
        taps.forEach { $0.arm(from: start, to: end) }
        // a camera that stops sending frames (the session interrupted) still ends its film a moment after the span
        let deadline = Task {
            try? await Task.sleep(for: .seconds(max(0, end - Date.now.timeIntervalSince1970) + 1))
            taps.forEach { $0.finishNow() }
        }
        defer { deadline.cancel() }
        return await withTaskCancellationHandler {
            var films: [MomentFilm] = []
            for tap in taps {
                if let film = await tap.film() { films.append(film) }
            }
            return films
        } onCancel: {
            taps.forEach { $0.finishNow() }
        }
    }
}

/// One camera's frames: while armed, the frames inside the span go into a movie file (HEVC, at the camera's own size
/// and rate). Frame times come from the session's clock, mapped to Unix time when armed.
private final class FrameTap: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    let camera: String
    let queue: DispatchQueue
    /// The session's clock (its frames' timestamps).
    var clock: CMClock?

    private let lock = NSLock()
    private var span: (start: Double, end: Double)?
    /// Unix time minus clock time, taken when armed.
    private var offset = 0.0
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var firstUnix: Double?
    private var finishing = false
    /// The film handed over (until armed again): later ends change nothing.
    private var delivered = false
    private var result: MomentFilm??
    private var waiter: CheckedContinuation<MomentFilm?, Never>?

    init(camera: String) {
        self.camera = camera
        queue = DispatchQueue(label: "app.fractonica.moments.frames.\(camera)")
    }

    func arm(from start: Double, to end: Double) {
        let now = CMClockGetTime(clock ?? CMClockGetHostTimeClock()).seconds
        lock.withLock {
            span = (start, end)
            offset = Date.now.timeIntervalSince1970 - now
            result = nil
        }
        queue.async { self.delivered = false }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let (span, offset) = lock.withLock { (self.span, self.offset) }
        guard let span, !finishing else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let unix = pts.seconds + offset
        if unix < span.start { return }
        if unix > span.end {
            finish()
            return
        }
        if writer == nil, !begin(sampleBuffer, at: pts, unix: unix) { return }
        if let input, input.isReadyForMoreMediaData { input.append(sampleBuffer) }
    }

    private func begin(_ sample: CMSampleBuffer, at pts: CMTime, unix: Double) -> Bool {
        guard let format = CMSampleBufferGetFormatDescription(sample) else { return false }
        let size = CMVideoFormatDescriptionGetDimensions(format)
        let url = FileManager.default.temporaryDirectory.appending(path: "moment-\(camera)-\(UUID().uuidString).mov")
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mov) else { return false }
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.hevc,
            AVVideoWidthKey: Int(size.width),
            AVVideoHeightKey: Int(size.height),
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { return false }
        writer.add(input)
        guard writer.startWriting() else {
            momentsLog.error("the \(self.camera) film could not start: \(writer.error?.localizedDescription ?? "?")")
            return false
        }
        writer.startSession(atSourceTime: pts)
        self.writer = writer
        self.input = input
        firstUnix = unix
        return true
    }

    /// Ends the film now (the span cut short).
    func finishNow() {
        queue.async { self.finish() }
    }

    /// Stops filming for good (the session going away).
    func cancel() {
        queue.async {
            self.finish()
        }
    }

    /// On the tap's queue: closes the file and hands it over (nil when nothing was filmed).
    private func finish() {
        guard !finishing, !delivered else { return }
        lock.withLock { span = nil }
        guard let writer, let input, let firstUnix else {
            deliver(nil)
            return
        }
        finishing = true
        input.markAsFinished()
        let url = writer.outputURL
        writer.finishWriting { [self] in
            queue.async {
                let ok = self.writer?.status == .completed
                if !ok { momentsLog.error("the \(self.camera) film failed: \(self.writer?.error?.localizedDescription ?? "?")") }
                self.writer = nil
                self.input = nil
                self.firstUnix = nil
                self.finishing = false
                self.deliver(ok ? MomentFilm(camera: self.camera, url: url, start: firstUnix) : nil)
            }
        }
    }

    private func deliver(_ film: MomentFilm?) {
        delivered = true
        let w = lock.withLock { () -> CheckedContinuation<MomentFilm?, Never>? in
            result = .some(film)
            let w = waiter
            waiter = nil
            return w
        }
        w?.resume(returning: film)
    }

    /// The film once it is written (nil when nothing was filmed).
    func film() async -> MomentFilm? {
        await withCheckedContinuation { continuation in
            lock.lock()
            if let result {
                lock.unlock()
                continuation.resume(returning: result)
            } else {
                waiter = continuation
                lock.unlock()
            }
        }
    }
}

// MARK: - Preview

/// A camera's live preview, filling its frame.
struct MomentCameraPreview: View {
    let layer: AVCaptureVideoPreviewLayer

    var body: some View {
        PreviewHost(layer: layer)
    }
}

#if os(iOS)
private struct PreviewHost: UIViewRepresentable {
    let layer: AVCaptureVideoPreviewLayer

    func makeUIView(context: Context) -> LayerView {
        let view = LayerView()
        view.preview = layer
        return view
    }

    func updateUIView(_ view: LayerView, context: Context) {
        view.preview = layer
    }

    final class LayerView: UIView {
        var preview: AVCaptureVideoPreviewLayer? {
            didSet {
                guard preview !== oldValue else { return }
                oldValue?.removeFromSuperlayer()
                if let preview { layer.addSublayer(preview) }
                setNeedsLayout()
            }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            preview?.frame = bounds
            CATransaction.commit()
        }
    }
}
#else
private struct PreviewHost: NSViewRepresentable {
    let layer: AVCaptureVideoPreviewLayer

    func makeNSView(context: Context) -> LayerView {
        let view = LayerView()
        view.wantsLayer = true
        view.preview = layer
        return view
    }

    func updateNSView(_ view: LayerView, context: Context) {
        view.preview = layer
    }

    final class LayerView: NSView {
        var preview: AVCaptureVideoPreviewLayer? {
            didSet {
                guard preview !== oldValue else { return }
                oldValue?.removeFromSuperlayer()
                if let preview { layer?.addSublayer(preview) }
                needsLayout = true
            }
        }

        override func layout() {
            super.layout()
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            preview?.frame = bounds
            CATransaction.commit()
        }
    }
}
#endif
