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
/// Simulator (the view shows a placeholder and a still is drawn instead, so the whole capture runs there too).
/// `capture()` takes every camera's photo at once and returns them by name: `back`, `front`, or `camera` (the Mac).
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
    /// The preview layers, back (or the only camera) first.
    private(set) var mainLayer: AVCaptureVideoPreviewLayer?
    private(set) var insetLayer: AVCaptureVideoPreviewLayer?

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
        mainLayer = result.main
        insetLayer = result.inset
        mode = result.outputs == 0 ? .none : result.outputs > 1 ? .dual : .single
        #endif
    }

    func stop() {
        rig.stop()
    }

    /// Every camera's photo, taken at once, as encoded image data (HEIC or JPEG) by name.
    func capture() async -> [(name: String, data: Data)] {
        await rig.capture()
    }
}

/// The capture session and its outputs, configured and driven on a serial queue of its own.
private final class CameraRig: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.fractonica.moments.camera")
    private var session: AVCaptureSession?
    /// Photo outputs by name.
    private var outputs: [(name: String, output: AVCapturePhotoOutput)] = []
    private var delegates: [PhotoGrab] = []

    struct Configured: @unchecked Sendable {
        var main: AVCaptureVideoPreviewLayer?
        var inset: AVCaptureVideoPreviewLayer?
        var outputs: Int
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

    #if os(iOS)
    /// Back and front cameras in one multi-camera session, each with a photo output and a preview layer connected by
    /// hand (Apple's AVMultiCamPiP pattern). Nil when the hardware cannot afford both.
    private func buildDual() -> Configured? {
        let session = AVCaptureMultiCamSession()
        session.beginConfiguration()
        var layers: [AVCaptureVideoPreviewLayer] = []
        var made: [(String, AVCapturePhotoOutput)] = []
        for (name, position) in [("back", AVCaptureDevice.Position.back), ("front", .front)] {
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position),
                  let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { continue }
            Self.chooseMultiCamFormat(device)
            session.addInputWithNoConnections(input)
            guard let port = input.ports(for: .video, sourceDeviceType: device.deviceType, sourceDevicePosition: position).first else { continue }
            let output = AVCapturePhotoOutput()
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
            layers.append(layer)
            made.append((name, output))
        }
        session.commitConfiguration()
        guard made.count == 2, session.hardwareCost <= 1, session.systemPressureCost <= 1 else {
            return nil
        }
        session.startRunning()
        self.session = session
        outputs = made
        return Configured(main: layers.first, inset: layers.last, outputs: made.count)
    }

    /// A format the multi-camera session can run, no larger than 1920 × 1440 (keeps the hardware cost down).
    private static func chooseMultiCamFormat(_ device: AVCaptureDevice) {
        let formats = device.formats.filter { format in
            let d = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            return format.isMultiCamSupported && d.width <= 1920 && d.height <= 1440
        }
        guard let best = formats.max(by: {
            let a = CMVideoFormatDescriptionGetDimensions($0.formatDescription), b = CMVideoFormatDescriptionGetDimensions($1.formatDescription)
            return Int(a.width) * Int(a.height) < Int(b.width) * Int(b.height)
        }), (try? device.lockForConfiguration()) != nil else { return }
        device.activeFormat = best
        device.unlockForConfiguration()
    }
    #endif

    /// One camera: the back one on iPhone and iPad (the front one where there is no back), the default on the Mac.
    private func buildSingle() -> Configured {
        let session = AVCaptureSession()
        session.beginConfiguration()
        session.sessionPreset = .photo
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
            return Configured(main: nil, inset: nil, outputs: 0)
        }
        session.addInput(input)
        let output = AVCapturePhotoOutput()
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            return Configured(main: nil, inset: nil, outputs: 0)
        }
        session.addOutput(output)
        #if os(iOS)
        if let c = output.connection(with: .video), c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        #endif
        session.commitConfiguration()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        #if os(iOS)
        if let c = layer.connection, c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        #endif
        session.startRunning()
        self.session = session
        outputs = [(name, output)]
        return Configured(main: layer, inset: nil, outputs: 1)
    }

    func stop() {
        queue.async {
            if let session = self.session, session.isRunning { session.stopRunning() }
            self.session = nil
            self.outputs = []
        }
    }

    /// Fires every photo output at once and waits for all of them.
    func capture() async -> [(name: String, data: Data)] {
        let grabs: [(String, PhotoGrab)] = await withCheckedContinuation { continuation in
            queue.async {
                var list: [(String, PhotoGrab)] = []
                for (name, output) in self.outputs {
                    let settings: AVCapturePhotoSettings
                    if output.availablePhotoCodecTypes.contains(.hevc) {
                        settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.hevc])
                    } else {
                        settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
                    }
                    let grab = PhotoGrab()
                    list.append((name, grab))
                    output.capturePhoto(with: settings, delegate: grab)
                }
                self.delegates = list.map(\.1)
                continuation.resume(returning: list)
            }
        }
        var out: [(name: String, data: Data)] = []
        for (name, grab) in grabs {
            if let data = await grab.value() { out.append((name, data)) }
        }
        queue.async { self.delegates = [] }
        return out
    }
}

/// One photo's delegate: its data once processed (nil on failure). Waiting is safe before or after it arrives.
private final class PhotoGrab: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var result: Data??
    private var waiter: CheckedContinuation<Data?, Never>?

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        finish(error == nil ? photo.fileDataRepresentation() : nil)
    }

    private func finish(_ data: Data?) {
        lock.lock()
        guard result == nil else { lock.unlock(); return }
        result = .some(data)
        let w = waiter
        waiter = nil
        lock.unlock()
        w?.resume(returning: data)
    }

    func value() async -> Data? {
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
