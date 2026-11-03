@preconcurrency import AVFoundation
import CoreImage
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
/// camera takes a frame each Sub-blink (ξ, 44.4 ms: 22.5 frames a second), the reel's own frame.
/// The session hears the microphone too (when allowed). `record(from:to:only:)` films the span from every camera (or
/// those named), each into a movie file of its own — `back`, `front`, or `camera` (the Mac) — and its sound into one
/// more, `sound`; a span without an end films until the task is cancelled (an answered call, hung up). `still(_:)` is a
/// camera's latest frame as a photo; a long press lights the back camera's torch (`toggleTorch()`). The cameras start
/// once, however many ask. Where the
/// phone has several back lenses and can run them beside the selfie camera, the back camera is the multi-lens one, on
/// its wide lens: `nextLens()` moves to the next (1× → 3× → 0.5× …) by its zoom, so a film runs on unbroken.
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
    /// The session hears the microphone: the films have their sound.
    private(set) var hearing = false
    /// The back camera's torch: there, and lit.
    private(set) var hasTorch = false
    private(set) var torch = false
    /// The back camera's lenses, as the phone names them (0.5, 1, 3), and the one in use.
    private(set) var lenses: [Double] = []
    private(set) var lens = 0

    @ObservationIgnored private let rig = CameraRig()
    @ObservationIgnored private var starting: Task<Void, Never>?

    /// The camera a single film is made with: the back one, else the only one.
    var main: String? { previews["back"] != nil ? "back" : previews.keys.sorted().first }

    func start() async {
        if let starting { return await starting.value }
        let task = Task { await run() }
        starting = task
        await task.value
    }

    private func run() async {
        #if targetEnvironment(simulator)
        mode = .none
        return
        #else
        guard await AVCaptureDevice.requestAccess(for: .video) else {
            mode = .denied
            return
        }
        let sound = await AVCaptureDevice.requestAccess(for: .audio)
        let result = await rig.configure(sound: sound)
        previews = result.previews
        hearing = result.hearing
        lenses = result.lenses
        lens = result.lens
        hasTorch = result.torch
        mode = result.previews.isEmpty ? .none : result.previews.count > 1 ? .dual : .single
        #endif
    }

    /// The back camera's next lens, round to the widest after the longest.
    func nextLens() {
        guard lenses.count > 1 else { return }
        lens = (lens + 1) % lenses.count
        rig.lens(lens)
    }

    func stop() {
        rig.stop()
        starting = nil
        torch = false
    }

    /// The back camera's torch on, or off again.
    func toggleTorch() {
        guard hasTorch else { return }
        torch.toggle()
        rig.torch(torch)
    }

    /// Films every camera (or those in `only`, and the sound) from Unix time `start` to `end` (from the first frame at or
    /// after `start`; `.infinity` for no end); returns each camera's file once the span is over. Cancelling the task ends
    /// the films at once.
    func record(from start: Double, to end: Double, only: Set<String>? = nil) async -> [MomentFilm] {
        await rig.record(from: start, to: end, only: only.map { $0.union(["sound"]) })
    }

    /// A camera's latest frame as JPEG data (nil without one).
    func still(_ camera: String) async -> Data? {
        await rig.still(camera)
    }

    /// The audio session a moment's call runs in, through the silent switch: playing and recording at once where the
    /// microphone is allowed (the films' sound, the ringtone over them, the
    /// vibration and the moment's haptic with them), playing only otherwise. The ringtone and the cameras ask for the
    /// same, so neither interrupts the other. Ringing, the speaker at its loudest (`.videoRecording`); `filming`, the
    /// microphone as it is, without the system's gain control (`.measurement`): the ringtone and the buzz right by it
    /// would otherwise turn it down for half a minute after the pick-up.
    nonisolated static func prepareAudio(recording: Bool, filming: Bool = false) {
        #if os(iOS)
        let audio = AVAudioSession.sharedInstance()
        if recording {
            try? audio.setCategory(.playAndRecord, mode: filming ? .measurement : .videoRecording,
                                   options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP])
            try? audio.setAllowHapticsAndSystemSoundsDuringRecording(true)
        } else if audio.category != .playAndRecord {
            try? audio.setCategory(.playback, options: [.mixWithOthers])
        }
        try? audio.setActive(true)
        #endif
    }

    /// The microphone is allowed: the films have their sound.
    nonisolated static var mayRecordSound: Bool {
        #if os(iOS)
        AVAudioApplication.shared.recordPermission == .granted
        #else
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized
        #endif
    }

}

/// The capture session and its outputs, configured and driven on a serial queue of its own; each camera's frames
/// arrive on a queue of their own and go to a `FrameTap`'s film while a recording is on.
private final class CameraRig: @unchecked Sendable {
    private let queue = DispatchQueue(label: "app.fractonica.moments.camera")
    private var session: AVCaptureSession?
    /// Frame taps by camera name.
    private var taps: [FrameTap] = []
    /// The microphone's tap: the films' sound.
    private var sound: FrameTap?
    private lazy var stills = CIContext()

    struct Configured: @unchecked Sendable {
        var previews: [String: AVCaptureVideoPreviewLayer]
        var hearing = false
        /// The back lenses' names (0.5, 1, 3) and the one in use.
        var lenses: [Double] = []
        var lens = 0
        /// The back camera has a torch.
        var torch = false
    }

    /// The back camera (its torch).
    private var backCamera: AVCaptureDevice?

    /// The back camera when it has several lenses, and each lens's zoom factor on it.
    private var back: AVCaptureDevice?
    private var zooms: [CGFloat] = []

    func configure(sound: Bool) async -> Configured {
        await withCheckedContinuation { continuation in
            queue.async {
                continuation.resume(returning: self.build(sound: sound))
            }
        }
    }

    private func build(sound: Bool) -> Configured {
        #if os(iOS)
        // (a call's ringing or its film has set the session up already: kept as it is)
        if sound, AVAudioSession.sharedInstance().category != .playAndRecord { MomentCamera.prepareAudio(recording: true) }
        if AVCaptureMultiCamSession.isMultiCamSupported {
            // the back camera with the most lenses that runs beside the selfie camera
            let types: [AVCaptureDevice.DeviceType] = [.builtInTripleCamera, .builtInDualWideCamera, .builtInDualCamera, .builtInWideAngleCamera]
            let sets = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).supportedMultiCamDeviceSets
            if let front = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) {
                for type in types {
                    guard let back = AVCaptureDevice.default(type, for: .video, position: .back),
                          sets.contains(where: { $0.contains(back) && $0.contains(front) }) else { continue }
                    if let dual = buildDual(back: back, front: front, sound: sound) { return dual }
                }
            }
        }
        #endif
        return buildSingle(sound: sound)
    }

    /// The microphone as an input with an audio data output, connected by hand in a multi-camera session.
    private func addMicrophone(to session: AVCaptureSession, byHand: Bool) -> FrameTap? {
        guard let mic = AVCaptureDevice.default(for: .audio), let input = try? AVCaptureDeviceInput(device: mic),
              session.canAddInput(input) else { return nil }
        let output = AVCaptureAudioDataOutput()
        let tap = FrameTap(camera: "sound")
        output.setSampleBufferDelegate(tap, queue: tap.queue)
        guard byHand else {
            session.addInput(input)
            guard session.canAddOutput(output) else { return nil }
            session.addOutput(output)
            return tap
        }
        session.addInputWithNoConnections(input)
        guard let port = input.ports.first(where: { $0.mediaType == .audio }), session.canAddOutput(output) else { return nil }
        session.addOutputWithNoConnections(output)
        let connection = AVCaptureConnection(inputPorts: [port], output: output)
        guard session.canAddConnection(connection) else { return nil }
        session.addConnection(connection)
        return tap
    }

    private func videoOutput(_ name: String) -> (AVCaptureVideoDataOutput, FrameTap) {
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
        // a frame the film cannot take in time is let go rather than queued: queued frames hold the camera's buffers
        output.alwaysDiscardsLateVideoFrames = true
        let tap = FrameTap(camera: name)
        output.setSampleBufferDelegate(tap, queue: tap.queue)
        return (output, tap)
    }

    #if os(iOS)
    /// Back and front cameras in one multi-camera session, each with a video data output and a preview layer
    /// connected by hand (Apple's AVMultiCamPiP pattern), at the fastest frame rate the hardware affords for both.
    /// Nil when the hardware cannot afford both at all.
    private func buildDual(back: AVCaptureDevice, front: AVCaptureDevice, sound: Bool) -> Configured? {
        let session = AVCaptureMultiCamSession()
        session.automaticallyConfiguresApplicationAudioSession = false
        session.beginConfiguration()
        var previews: [String: AVCaptureVideoPreviewLayer] = [:]
        var made: [FrameTap] = []
        var devices: [AVCaptureDevice] = []
        for (name, device) in [("back", back), ("front", front)] {
            let position = device.position
            guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else { continue }
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
        devices.forEach { Self.setFormat($0, frame: MomentReelTiming.subBlink) }
        // a multi-lens camera opens on its widest lens: on the wide one from the start
        let lenses = Self.lenses(back)
        if lenses.zooms.count > 1 { zoom(back, to: lenses.zooms[lenses.wide]) }
        let mic = sound ? addMicrophone(to: session, byHand: true) : nil
        session.commitConfiguration()
        guard made.count == 2, session.hardwareCost <= 1, session.systemPressureCost <= 1 else {
            momentsLog.info("cameras: \(back.localizedName) and the selfie camera cost too much together")
            return nil
        }
        momentsLog.info("cameras: \(back.localizedName) and front a frame each Sub-blink, lenses \(lenses.names), \(mic == nil ? "no sound" : "with sound")")
        (made + [mic].compactMap { $0 }).forEach { $0.clock = session.synchronizationClock }
        session.startRunning()
        self.session = session
        taps = made
        self.sound = mic
        if lenses.zooms.count > 1 {
            self.back = back
            zooms = lenses.zooms
        }
        backCamera = back
        return Configured(previews: previews, hearing: mic != nil, lenses: lenses.names, lens: lenses.wide, torch: back.hasTorch)
    }

    /// A multi-lens camera's lenses, widest first: the zoom factor that brings each in (the first lens at 1, the next
    /// where the camera switches over to it), their names as the phone gives them (0.5, 1, 3), and the wide one.
    private static func lenses(_ device: AVCaptureDevice) -> (zooms: [CGFloat], names: [Double], wide: Int) {
        let switches = device.virtualDeviceSwitchOverVideoZoomFactors.map { CGFloat(truncating: $0) }
        guard device.isVirtualDevice, !switches.isEmpty, switches.count == device.constituentDevices.count - 1 else { return ([1], [1], 0) }
        let zooms = [1] + switches
        let multiplier = Double(device.displayVideoZoomFactorMultiplier)
        let names = zooms.map { (Double($0) * multiplier * 10).rounded() / 10 }
        let wide = device.constituentDevices.firstIndex { $0.deviceType == .builtInWideAngleCamera } ?? 0
        return (zooms, names, wide)
    }

    private func zoom(_ device: AVCaptureDevice, to factor: CGFloat) {
        guard (try? device.lockForConfiguration()) != nil else { return }
        device.videoZoomFactor = min(max(factor, device.minAvailableVideoZoomFactor), device.activeFormat.videoMaxZoomFactor)
        device.unlockForConfiguration()
    }

    /// The device's smallest 8-bit format (multi-camera where `multi`) taking a frame each `frame` seconds whose short
    /// side still fills the reel's square (960 pixels: 1920 × 1080 on most iPhones; every pixel more is load on two
    /// encoders at once), or failing that its fastest; locked to that frame.
    static func setFormat(_ device: AVCaptureDevice, frame: Double, multi: Bool = true) {
        let fps = 1 / frame
        let formats = device.formats.filter { format in
            let d = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
            let subtype = CMFormatDescriptionGetMediaSubType(format.formatDescription)
            return (format.isMultiCamSupported || !multi) && d.width <= 1920 && d.height <= 1440
                && subtype != kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange && subtype != kCVPixelFormatType_420YpCbCr10BiPlanarFullRange
                && format.videoSupportedFrameRateRanges.contains { $0.minFrameRate <= fps }
        }
        func best(_ f: AVCaptureDevice.Format) -> Double { f.videoSupportedFrameRateRanges.map(\.maxFrameRate).max() ?? 0 }
        func pixels(_ f: AVCaptureDevice.Format) -> Int {
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return Int(d.width) * Int(d.height)
        }
        func fills(_ f: AVCaptureDevice.Format) -> Bool {
            let d = CMVideoFormatDescriptionGetDimensions(f.formatDescription)
            return min(d.width, d.height) >= 960
        }
        let reaching = formats.filter { best($0) >= fps }
        let chosen = reaching.filter(fills).min { pixels($0) < pixels($1) }
            ?? reaching.max { pixels($0) < pixels($1) }
            ?? formats.max { best($0) < best($1) || (best($0) == best($1) && pixels($0) < pixels($1)) }
        guard let chosen, (try? device.lockForConfiguration()) != nil else { return }
        device.activeFormat = chosen
        let duration = CMTime(seconds: max(frame, 1 / best(chosen)), preferredTimescale: 1_000_000)
        device.activeVideoMinFrameDuration = duration
        device.activeVideoMaxFrameDuration = duration
        device.unlockForConfiguration()
    }
    #endif

    /// One camera: the back one on iPhone and iPad (the front one where there is no back), the default on the Mac.
    private func buildSingle(sound: Bool) -> Configured {
        let session = AVCaptureSession()
        #if os(iOS)
        session.automaticallyConfiguresApplicationAudioSession = false
        #endif
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
        #if os(iOS)
        session.sessionPreset = .inputPriority
        Self.setFormat(device, frame: MomentReelTiming.subBlink, multi: false)
        #endif
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
        let mic = sound ? addMicrophone(to: session, byHand: false) : nil
        session.commitConfiguration()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        #if os(iOS)
        if let c = layer.connection, c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
        #endif
        tap.clock = session.synchronizationClock
        mic?.clock = session.synchronizationClock
        session.startRunning()
        self.session = session
        taps = [tap]
        self.sound = mic
        #if os(iOS)
        if device.position == .back { backCamera = device }
        return Configured(previews: [name: layer], hearing: mic != nil, torch: device.position == .back && device.hasTorch)
        #else
        return Configured(previews: [name: layer], hearing: mic != nil)
        #endif
    }

    func stop() {
        queue.async {
            if let session = self.session, session.isRunning { session.stopRunning() }
            self.session = nil
            self.back = nil
            self.zooms = []
            self.backCamera = nil
            (self.taps + [self.sound].compactMap { $0 }).forEach { $0.cancel() }
            self.taps = []
            self.sound = nil
        }
    }

    /// Films from `start` to `end` on every camera (those in `only`), and the microphone; the files once all are written.
    func record(from start: Double, to end: Double, only: Set<String>?) async -> [MomentFilm] {
        let taps: [FrameTap] = await withCheckedContinuation { continuation in
            queue.async {
                let all = self.taps + [self.sound].compactMap { $0 }
                continuation.resume(returning: all.filter { only?.contains($0.camera) ?? true })
            }
        }
        taps.forEach { $0.arm(from: start, to: end) }
        // a camera that stops sending frames (the session interrupted) still ends its film a moment after the span
        let deadline = Task {
            guard end.isFinite else { return }
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

    /// A camera's latest frame as JPEG data.
    func still(_ camera: String) async -> Data? {
        await withCheckedContinuation { continuation in
            queue.async {
                guard let tap = self.taps.first(where: { $0.camera == camera }) else {
                    continuation.resume(returning: nil)
                    return
                }
                let stills = self.stills
                tap.nextFrame { image in
                    // the frame is copied on the tap's queue; the JPEG is made here, off it
                    self.queue.async {
                        let data = image.flatMap {
                            stills.jpegRepresentation(of: CIImage(cgImage: $0), colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
                                                      options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.92])
                        }
                        continuation.resume(returning: data)
                    }
                }
            }
        }
    }

    /// The back camera's torch, lit or not.
    func torch(_ on: Bool) {
        #if os(iOS)
        queue.async {
            guard let device = self.backCamera, device.hasTorch, (try? device.lockForConfiguration()) != nil else { return }
            if on, device.isTorchAvailable {
                try? device.setTorchModeOn(level: AVCaptureDevice.maxAvailableTorchLevel)
            } else {
                device.torchMode = .off
            }
            device.unlockForConfiguration()
        }
        #endif
    }

    /// The back camera on lens `index`.
    func lens(_ index: Int) {
        #if os(iOS)
        queue.async {
            guard let back = self.back, self.zooms.indices.contains(index) else { return }
            self.zoom(back, to: self.zooms[index])
        }
        #endif
    }
}

/// One camera's frames, or the microphone's sound: while armed, the samples inside the span go into a file of their own
/// (HEVC at the camera's own size and rate, or AAC). Sample times come from the session's clock, mapped to Unix time
/// when armed. A camera's tap keeps its latest frame (for a photo).
private final class FrameTap: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureAudioDataOutputSampleBufferDelegate,
    @unchecked Sendable {
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
    /// A photo asked for: the next frame, copied (no frame of the camera's is kept).
    private var stillWanted: (@Sendable (CGImage?) -> Void)?
    private lazy var copier = CIContext()
    /// What happened to the span's frames: taken into the film, refused by a busy writer, dropped by the camera (by
    /// reason).
    private var written = 0
    private var busy = 0
    private var dropped: [String: Int] = [:]

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
        if let pixels = CMSampleBufferGetImageBuffer(sampleBuffer), let wanted = stillWanted {
            stillWanted = nil
            let image = CIImage(cvPixelBuffer: pixels)
            wanted(copier.createCGImage(image, from: image.extent))
        }
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
        if let input, input.isReadyForMoreMediaData, input.append(sampleBuffer) {
            written += 1
        } else {
            busy += 1
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didDrop sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard writer != nil else { return }
        let reason = CMGetAttachment(sampleBuffer, key: kCMSampleBufferAttachmentKey_DroppedFrameReason, attachmentModeOut: nil) as? String
        dropped[reason.map(Self.dropName) ?? "unknown", default: 0] += 1
    }

    private static func dropName(_ reason: String) -> String {
        if reason == (kCMSampleBufferDroppedFrameReason_FrameWasLate as String) { return "late" }
        if reason == (kCMSampleBufferDroppedFrameReason_OutOfBuffers as String) { return "out of buffers" }
        if reason == (kCMSampleBufferDroppedFrameReason_Discontinuity as String) { return "discontinuity" }
        return reason
    }

    /// How the film went, for the log and the saved screen: "back: 466 frames kept, 3 refused by the writer, 0 dropped".
    private var report: String {
        let lost = dropped.map { "\($0.value) \($0.key)" }.sorted().joined(separator: ", ")
        return "\(camera): \(written) kept, \(busy) refused by the writer" + (lost.isEmpty ? "" : ", dropped \(lost)")
    }

    /// The share of the span's frames that did not make it into the film.
    private var lostShare: Double {
        let lost = busy + dropped.values.reduce(0, +)
        return Double(lost) / Double(max(1, written + lost))
    }

    /// AAC settings for the microphone's format: its rate, mono or stereo.
    static func aac(for format: CMFormatDescription) -> [String: Any] {
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee
        let rate = asbd.map { $0.mSampleRate > 0 ? $0.mSampleRate : 48_000 } ?? 48_000
        let channels = min(2, max(1, Int(asbd?.mChannelsPerFrame ?? 1)))
        var settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: rate,
            AVNumberOfChannelsKey: channels,
            AVEncoderBitRateKey: channels == 1 ? 96_000 : 160_000,
        ]
        if channels == 2 {
            var layout = AudioChannelLayout()
            layout.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo
            settings[AVChannelLayoutKey] = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
        }
        return settings
    }

    private func begin(_ sample: CMSampleBuffer, at pts: CMTime, unix: Double) -> Bool {
        guard let format = CMSampleBufferGetFormatDescription(sample) else { return false }
        let audio = CMFormatDescriptionGetMediaType(format) == kCMMediaType_Audio
        let url = FileManager.default.temporaryDirectory.appending(path: "moment-\(camera)-\(UUID().uuidString).\(audio ? "m4a" : "mov")")
        written = 0
        busy = 0
        dropped = [:]
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: audio ? .m4a : .mov) else { return false }
        let input: AVAssetWriterInput
        if audio {
            input = AVAssetWriterInput(mediaType: .audio, outputSettings: Self.aac(for: format))
        } else {
            let size = CMVideoFormatDescriptionGetDimensions(format)
            // no frame reordering: the encoder hands each frame back at once instead of holding several of the
            // camera's buffers (a camera runs out of them, and its film stalls)
            input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.hevc,
                AVVideoWidthKey: Int(size.width),
                AVVideoHeightKey: Int(size.height),
                AVVideoCompressionPropertiesKey: [
                    AVVideoAllowFrameReorderingKey: false,
                    AVVideoExpectedSourceFrameRateKey: 23,
                    AVVideoAverageBitRateKey: Int(size.width) * Int(size.height) * 8,
                    AVVideoMaxKeyFrameIntervalDurationKey: 1,
                ],
            ])
        }
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
                momentsLog.info("film \(self.report)")
                let film = MomentFilm(camera: self.camera, url: url, start: firstUnix, report: self.report, lost: self.lostShare)
                self.writer = nil
                self.input = nil
                self.firstUnix = nil
                self.finishing = false
                self.deliver(ok ? film : nil)
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

    /// The camera's next frame, copied (nil when none comes within a second).
    func nextFrame(_ done: @escaping @Sendable (CGImage?) -> Void) {
        let once = Once(done)
        queue.async { self.stillWanted = { once.call($0) } }
        queue.asyncAfter(deadline: .now() + 1) {
            self.stillWanted = nil
            once.call(nil)
        }
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

/// A callback called at most once.
private final class Once<T>: @unchecked Sendable {
    private let lock = NSLock()
    private var done: ((T) -> Void)?

    init(_ done: @escaping (T) -> Void) { self.done = done }

    func call(_ value: T) {
        let d = lock.withLock { () -> ((T) -> Void)? in
            let d = done
            done = nil
            return d
        }
        d?(value)
    }
}
