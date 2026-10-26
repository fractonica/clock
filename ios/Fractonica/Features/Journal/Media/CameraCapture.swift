@preconcurrency import AVFoundation
import SwiftUI
#if os(iOS)
import UIKit
import UniformTypeIdentifiers
#endif

/// A photo or a video taken in the app: the system camera on iPhone and iPad, a small capture view on the Mac. The
/// result is a file in the journal's tmp/, processed like a picked one.
enum CameraShot: Sendable {
    case photo(URL)
    case movie(URL)
}

enum CameraCapture {
    /// Whether this device has a camera to offer (none in the Simulator; a Mac only with one attached or built in).
    @MainActor static var isAvailable: Bool {
        #if os(iOS)
        UIImagePickerController.isSourceTypeAvailable(.camera)
        #else
        AVCaptureDevice.default(for: .video) != nil
        #endif
    }
}

#if os(iOS)
/// The system camera, photos and videos.
struct CameraPicker: UIViewControllerRepresentable {
    let disk: JournalDisk
    let onFinish: (CameraShot?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.mediaTypes = [UTType.image.identifier, UTType.movie.identifier]
        picker.videoQuality = .typeHigh
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(disk: disk, onFinish: onFinish) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let disk: JournalDisk
        let onFinish: (CameraShot?) -> Void

        init(disk: JournalDisk, onFinish: @escaping (CameraShot?) -> Void) {
            self.disk = disk
            self.onFinish = onFinish
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let movie = info[.mediaURL] as? URL {
                let target = disk.temporaryFile(ext: movie.pathExtension.isEmpty ? "mov" : movie.pathExtension)
                try? FileManager.default.copyItem(at: movie, to: target)
                onFinish(.movie(target))
            } else if let image = info[.originalImage] as? UIImage, let data = image.jpegData(compressionQuality: 0.95) {
                let target = disk.temporaryFile(ext: "jpg")
                try? data.write(to: target)
                onFinish(.photo(target))
            } else {
                onFinish(nil)
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish(nil)
        }
    }
}
#else
/// The Mac's camera: a preview, a shutter for a photo and a record button for a video.
struct MacCameraView: View {
    let disk: JournalDisk
    let onFinish: (CameraShot?) -> Void

    @State private var camera = MacCamera()
    @State private var mode = 0

    var body: some View {
        VStack(spacing: 14) {
            CameraPreview(session: camera.session)
                .aspectRatio(4 / 3, contentMode: .fit)
                .clipShape(.rect(cornerRadius: 14))
                .overlay(alignment: .topTrailing) {
                    if camera.isRecording {
                        Label("Recording", systemImage: "record.circle")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Theme.danger.opacity(0.85), in: .capsule)
                            .padding(10)
                    }
                }
            if let error = camera.error {
                Text(error).font(.footnote).foregroundStyle(Theme.danger)
            }
            HStack {
                Button("Cancel") {
                    camera.stop()
                    onFinish(nil)
                }
                .keyboardShortcut(.cancelAction)
                Spacer()
                Picker("Mode", selection: $mode) {
                    Text("Photo").tag(0)
                    Text("Video").tag(1)
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .disabled(camera.isRecording)
                Spacer()
                Button {
                    if mode == 0 {
                        camera.takePhoto(to: disk.temporaryFile(ext: "jpg")) { finish($0.map(CameraShot.photo)) }
                    } else if camera.isRecording {
                        camera.stopRecording()
                    } else {
                        camera.record(to: disk.temporaryFile(ext: "mov")) { finish($0.map(CameraShot.movie)) }
                    }
                } label: {
                    Label(mode == 0 ? "Take Photo" : camera.isRecording ? "Stop" : "Record",
                          systemImage: mode == 0 ? "camera" : camera.isRecording ? "stop.fill" : "record.circle")
                }
                .glassProminentButtonStyle()
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(18)
        .frame(minWidth: 560)
        .task { await camera.start() }
        .onDisappear { camera.stop() }
    }

    private func finish(_ shot: CameraShot?) {
        camera.stop()
        onFinish(shot)
    }
}

/// The capture session behind `MacCameraView`; AVFoundation's objects live on its own queue.
@MainActor @Observable
private final class MacCamera {
    @ObservationIgnored nonisolated let session = AVCaptureSession()
    private(set) var isRecording = false
    private(set) var error: String?

    @ObservationIgnored private let photoOutput = AVCapturePhotoOutput()
    @ObservationIgnored private let movieOutput = AVCaptureMovieFileOutput()
    @ObservationIgnored private var photoDelegate: PhotoDelegate?
    @ObservationIgnored private var movieDelegate: MovieDelegate?
    @ObservationIgnored private let queue = DispatchQueue(label: "app.fractonica.journal.camera")

    func start() async {
        guard await AVCaptureDevice.requestAccess(for: .video) else {
            error = "Allow the camera in System Settings › Privacy & Security."
            return
        }
        let audioAllowed = await AVCaptureDevice.requestAccess(for: .audio)
        let session = session
        let photoOutput = photoOutput
        let movieOutput = movieOutput
        let failed: Bool = await withCheckedContinuation { continuation in
            queue.async {
                session.beginConfiguration()
                session.sessionPreset = .high
                guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device),
                      session.canAddInput(input) else {
                    session.commitConfiguration()
                    continuation.resume(returning: true)
                    return
                }
                session.addInput(input)
                if audioAllowed, let mic = AVCaptureDevice.default(for: .audio), let micInput = try? AVCaptureDeviceInput(device: mic),
                   session.canAddInput(micInput) {
                    session.addInput(micInput)
                }
                if session.canAddOutput(photoOutput) { session.addOutput(photoOutput) }
                if session.canAddOutput(movieOutput) { session.addOutput(movieOutput) }
                session.commitConfiguration()
                session.startRunning()
                continuation.resume(returning: false)
            }
        }
        if failed { error = "The camera is not available." }
    }

    func stop() {
        let session = session
        queue.async { if session.isRunning { session.stopRunning() } }
    }

    func takePhoto(to url: URL, done: @escaping @MainActor (URL?) -> Void) {
        let delegate = PhotoDelegate(url: url) { result in Task { @MainActor in done(result) } }
        photoDelegate = delegate
        photoOutput.capturePhoto(with: AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg]), delegate: delegate)
    }

    func record(to url: URL, done: @escaping @MainActor (URL?) -> Void) {
        let delegate = MovieDelegate { [weak self] result in
            Task { @MainActor in
                self?.isRecording = false
                done(result)
            }
        }
        movieDelegate = delegate
        movieOutput.startRecording(to: url, recordingDelegate: delegate)
        isRecording = true
    }

    func stopRecording() {
        movieOutput.stopRecording()
    }

    private final class PhotoDelegate: NSObject, AVCapturePhotoCaptureDelegate, @unchecked Sendable {
        let url: URL
        let done: @Sendable (URL?) -> Void
        init(url: URL, done: @escaping @Sendable (URL?) -> Void) {
            self.url = url
            self.done = done
        }

        func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
            guard error == nil, let data = photo.fileDataRepresentation(), (try? data.write(to: url)) != nil else { return done(nil) }
            done(url)
        }
    }

    private final class MovieDelegate: NSObject, AVCaptureFileOutputRecordingDelegate, @unchecked Sendable {
        let done: @Sendable (URL?) -> Void
        init(done: @escaping @Sendable (URL?) -> Void) { self.done = done }

        func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
            done(FileManager.default.fileExists(atPath: outputFileURL.path) ? outputFileURL : nil)
        }
    }
}

/// The live camera image.
private struct CameraPreview: NSViewRepresentable {
    let session: AVCaptureSession

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        view.layer = layer
        view.wantsLayer = true
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {}
}
#endif
