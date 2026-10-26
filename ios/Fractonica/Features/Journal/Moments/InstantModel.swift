@preconcurrency import AVFoundation
import FractonicaKit
import Foundation
import ImageIO
import Observation
import SwiftUI
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#endif

/// The instant view's state: the moment, the emoji and the line being written, the cameras and the voice recording
/// that run from the moment the view opens, and the capture, scheduled for the exact moment (a sleep on the
/// continuous clock to that instant, not a tick). At the moment it takes every camera's photo at once, stops the
/// recording and saves the entry — time = the moment, `capture` filled, photos named front and back, the voice note —
/// then shows it. Closed before the moment, nothing is saved.
@MainActor @Observable
final class InstantModel {
    enum Phase: Equatable {
        case waiting
        case capturing
        case saved(String)
        case failed(String)
    }

    let moment: Moment
    let demo: Bool
    var emoji: String?
    var text = ""
    let recorder = VoiceRecorder()
    let camera = MomentCamera()
    private(set) var phase = Phase.waiting
    /// Bumped at the capture: the flash.
    private(set) var flashes = 0
    /// The microphone paused by the user.
    var muted = false {
        didSet {
            guard muted != oldValue else { return }
            if muted { recorder.pause() } else { recorder.resume() }
        }
    }
    /// The length of a Flavon around the moment, for the countdown.
    let flavonSeconds: Double

    @ObservationIgnored private var captureTask: Task<Void, Never>?
    @ObservationIgnored private var voiceTask: Task<Void, Never>?
    @ObservationIgnored private var opened = false

    init(request: InstantRequest) {
        moment = request.moment
        demo = request.demo
        emoji = EmojiCatalog.categories.prefix(5).flatMap(\.emoji).randomElement()
        flavonSeconds = FractonicaClock.shared.level(at: request.moment.time - 1, 10)?.duration
            ?? FractonicaClock.shared.levelInfo(10).meanSeconds
    }

    var savedID: String? { if case .saved(let id) = phase { id } else { nil } }

    /// Flavons left until the moment.
    func flavons(at t: Double = Date.now.timeIntervalSince1970) -> Double {
        max(0, (moment.time - t) / flavonSeconds)
    }

    // MARK: Lifecycle

    /// Starts the cameras, the announcement and then the recording, and arms the capture.
    func open() {
        guard !opened else { return }
        opened = true
        Task { await camera.start() }
        let speak = MomentStore.shared.settings.voice && flavons() >= 8
        voiceTask = Task {
            if speak { await MomentVoice.play(moment) }
            guard !Task.isCancelled, phase == .waiting else { return }
            await recorder.start(quality: JournalPreferences.shared.audioQuality, disk: JournalStore.shared.disk)
            if muted { recorder.pause() }
        }
        let delay = moment.time - Date.now.timeIntervalSince1970
        captureTask = Task {
            if delay > 0 {
                // the continuous clock keeps counting through a locked screen; a tolerance of zero asks for the
                // instant itself, not a coalesced wake
                try? await Task.sleep(until: .now + .seconds(delay), tolerance: .zero, clock: .continuous)
            }
            guard !Task.isCancelled else { return }
            await fire()
        }
    }

    /// Closing: before the moment nothing is kept.
    func close() {
        captureTask?.cancel()
        voiceTask?.cancel()
        MomentVoice.stop()
        if phase == .waiting { recorder.cancel() }
        camera.stop()
    }

    // MARK: The capture

    private func fire() async {
        guard phase == .waiting else { return }
        phase = .capturing
        flashes += 1
        MomentHaptics.capture()
        voiceTask?.cancel()
        MomentVoice.stop()
        let audio = recorder.stop()
        var photos = await camera.capture()
        camera.stop()
        if photos.isEmpty, camera.mode == .none {
            // the Simulator, or a device without a camera: a still of the moment stands in, so the entry has its photos
            photos = MomentStill.make(moment, words: AppSettings.shared.wording)
        }
        do {
            let record = try await MomentSaver.save(moment: moment, emoji: emoji, text: text, photos: photos, audio: audio)
            phase = .saved(record.id)
            Haptics.play(.success)
            momentsLog.info("captured \(self.moment.title()) at \(self.moment.time): \(photos.count) photos, audio \(audio != nil)")
        } catch {
            phase = .failed(error.localizedDescription)
            momentsLog.error("could not save the capture: \(error.localizedDescription)")
        }
    }
}

/// Writes a captured moment as a journal entry: photos (back first, then front, named so), the voice note, the moment's
/// exact time and its `capture`.
enum MomentSaver {
    @MainActor
    static func save(moment: Moment, emoji: String?, text: String, photos: [(name: String, data: Data)], audio: URL?,
                     store: JournalStore = .shared) async throws -> HubRecord {
        let disk = store.disk
        let quality = JournalPreferences.shared.photoQuality
        var blobs: [BlobRef] = []
        let ordered = photos.sorted { order($0.name) < order($1.name) }
        for photo in ordered {
            let url = disk.temporaryFile(ext: sniffExtension(photo.data))
            try photo.data.write(to: url)
            let item = try await JournalMedia.processImage(url, name: photo.name, quality: quality, disk: disk)
            try? FileManager.default.removeItem(at: url)
            blobs += try await store.adopt(item)
        }
        if let audio {
            let item = try await JournalMedia.processAudio(audio, disk: disk, move: true)
            blobs += try await store.adopt(item)
        }
        let zone = AppSettings.shared.zone ?? TimeZone.current.identifier
        let entry = JournalEntry(emoji: emoji, markdown: text.trimmingCharacters(in: .whitespacesAndNewlines))
        var record = HubRecord.journalEntry(time: moment.time, zone: zone, entry: entry, blobs: blobs, now: Date.now.timeIntervalSince1970)
        record.data = record.data.with(capture: moment.capture)
        return store.save(record)
    }

    private static func order(_ name: String) -> Int { name == "back" ? 0 : name == "front" ? 1 : 2 }

    /// "heic" for an ISO media file, "jpg" otherwise.
    private static func sniffExtension(_ data: Data) -> String {
        data.count > 12 && data[4] == 0x66 && data[5] == 0x74 && data[6] == 0x79 && data[7] == 0x70 ? "heic" : "jpg"
    }
}

/// The capture's feel: a strong impact on iPhone, the trackpad's on the Mac; off with the Haptics setting.
@MainActor
enum MomentHaptics {
    static func capture() {
        guard AppSettings.shared.haptics else { return }
        #if os(iOS)
        let impact = UIImpactFeedbackGenerator(style: .heavy)
        impact.impactOccurred(intensity: 1)
        Task {
            try? await Task.sleep(for: .milliseconds(90))
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 1)
        }
        #else
        Haptics.play(.success)
        #endif
    }
}

/// The spoken announcement of a moment ("A new Delta begins in eleven Flavons"), from the bundle. On iPhone it plays
/// in the ambient category, so the silent switch silences it.
@MainActor
enum MomentVoice {
    private static var player: AVAudioPlayer?

    static func url(for m: Moment) -> URL? {
        Bundle.main.url(forResource: m.soundName, withExtension: "caf")
    }

    /// Plays it and returns when it has finished (or at once when there is none).
    static func play(_ m: Moment) async {
        guard let url = url(for: m) else { return }
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.ambient, mode: .spokenAudio, options: [.mixWithOthers])
        try? session.setActive(true)
        #endif
        guard let player = try? AVAudioPlayer(contentsOf: url) else { return }
        self.player = player
        player.play()
        try? await Task.sleep(for: .seconds(player.duration + 0.15))
        if self.player === player { self.player = nil }
    }

    static func stop() {
        player?.stop()
        player = nil
    }
}

/// A still that stands in for a camera where there is none (the Simulator): the moment's name on its rarity's colours,
/// one per camera, as JPEG data.
@MainActor
enum MomentStill {
    static func make(_ m: Moment, words: Wording) -> [(name: String, data: Data)] {
        ["back", "front"].compactMap { name in
            let view = StillArt(moment: m, title: m.title(words.notation), camera: name)
                .frame(width: name == "back" ? 900 : 600, height: name == "back" ? 1200 : 800)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 1
            guard let image = renderer.cgImage else { return nil }
            let data = NSMutableData()
            guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
            CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
            guard CGImageDestinationFinalize(dest) else { return nil }
            return (name, data as Data)
        }
    }

    private struct StillArt: View {
        let moment: Moment
        let title: String
        let camera: String

        var body: some View {
            let c = moment.rarity.color
            ZStack {
                LinearGradient(colors: [c.opacity(0.85), Theme.background], startPoint: camera == "back" ? .top : .bottomLeading, endPoint: .bottom)
                Circle().fill(c.opacity(0.35)).blur(radius: 90).offset(x: camera == "back" ? -120 : 90, y: -160)
                VStack(spacing: 18) {
                    Text(verbatim: moment.level.letter)
                        .font(.system(size: camera == "back" ? 300 : 200, weight: .ultraLight, design: .serif))
                        .foregroundStyle(.white.opacity(0.9))
                    Text(verbatim: title)
                        .font(.system(size: camera == "back" ? 54 : 40, weight: .semibold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                    Text(verbatim: camera.uppercased())
                        .font(.system(size: 28, weight: .heavy))
                        .kerning(4)
                        .foregroundStyle(.white.opacity(0.6))
                }
                .padding(40)
            }
            .environment(\.colorScheme, .dark)
        }
    }
}
