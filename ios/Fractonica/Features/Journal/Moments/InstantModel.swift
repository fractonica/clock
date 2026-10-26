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
/// that run from the moment the view opens, and the captures — `MomentStore.capturesPerMoment` of them (3 by default),
/// one Flavon apart and centred on the moment (`MomentCaptures`), each scheduled for its exact instant (a sleep on the
/// continuous clock, not a tick). Each capture takes every camera's photo at once, with its own flash and haptic; its
/// photos are written into the journal's media at once (named `back@-1`, `front@-1` … per hub/API.md). The recording
/// stops at the last capture, and the entry — time = the moment, `capture` filled, the photos, the voice note — is
/// written right then, before the view changes, and only then shown. Closed before the moment's own capture, nothing
/// is saved; closed after it, the entry keeps the captures taken so far.
@MainActor @Observable
final class InstantModel {
    enum Phase: Equatable {
        /// Before the last capture (some may be taken already).
        case waiting
        /// The last capture is taken: the entry is being written.
        case saving
        case saved(String)
        case failed(String)
    }

    /// One planned capture: its offset from the moment in Flavons and its instant.
    struct Shot: Equatable {
        let offset: Int
        let time: Double
    }

    let moment: Moment
    let demo: Bool
    /// How many captures the moment gets (1, 3 or 5).
    let count: Int
    /// Every capture of the moment, earliest first.
    let plan: [Shot]
    /// The captures still to take when the view opened (earlier ones, already past, are left out).
    let shots: [Shot]
    var emoji: String?
    var text = ""
    let recorder = VoiceRecorder()
    let camera = MomentCamera()
    private(set) var phase = Phase.waiting
    /// The offsets captured so far.
    private(set) var taken: [Int] = []
    /// Bumped at each capture: the flash.
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
    /// Each capture's photos on their way into the journal's media.
    @ObservationIgnored private var adopting: [Task<[BlobRef], Never>] = []
    @ObservationIgnored private var audio: URL?
    #if os(iOS)
    @ObservationIgnored private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    #endif

    init(request: InstantRequest, now: Double = Date.now.timeIntervalSince1970) {
        let m = request.moment
        moment = m
        demo = request.demo
        emoji = EmojiCatalog.categories.prefix(5).flatMap(\.emoji).randomElement()
        let flavon = FractonicaClock.shared.level(at: m.time - 1, 10)?.duration ?? FractonicaClock.shared.levelInfo(10).meanSeconds
        flavonSeconds = flavon
        let store = MomentStore.shared
        count = store.capturesPerMoment
        // a demo moment's time is made up: its captures are a mean Flavon apart
        plan = MomentCaptures.offsets(count: count).map { k in
            Shot(offset: k, time: request.demo ? m.time + Double(k) * flavon : store.calendar.captureTime(of: m, offset: k))
        }
        let ahead = plan.filter { $0.time > now - 0.5 }
        shots = ahead.isEmpty ? plan.suffix(1) : ahead
    }

    var savedID: String? { if case .saved(let id) = phase { id } else { nil } }

    /// The next capture to take, while there is one.
    var next: Shot? { phase == .waiting ? shots.first { !taken.contains($0.offset) } : nil }

    /// "2 of 3": a capture's number among the moment's.
    func number(of shot: Shot) -> Int { (plan.firstIndex(of: shot) ?? 0) + 1 }

    /// Flavons left until the next capture (until the moment once there is none).
    func flavons(at t: Double = Date.now.timeIntervalSince1970) -> Double {
        max(0, ((next?.time ?? moment.time) - t) / flavonSeconds)
    }

    // MARK: Lifecycle

    /// Starts the cameras, the announcement and then the recording, and arms the captures.
    func open() {
        guard !opened else { return }
        opened = true
        Task { await camera.start() }
        let speak = MomentStore.shared.settings.voice && (moment.time - Date.now.timeIntervalSince1970) / flavonSeconds >= 8
        voiceTask = Task {
            if speak { await MomentVoice.play(moment) }
            guard !Task.isCancelled, phase == .waiting else { return }
            await recorder.start(quality: JournalPreferences.shared.audioQuality, disk: JournalStore.shared.disk)
            if muted { recorder.pause() }
        }
        let shots = shots
        captureTask = Task {
            for shot in shots {
                let delay = shot.time - Date.now.timeIntervalSince1970
                if delay > 0 {
                    // the continuous clock keeps counting through a locked screen; a tolerance of zero asks for the
                    // instant itself, not a coalesced wake
                    try? await Task.sleep(until: .now + .seconds(delay), tolerance: .zero, clock: .continuous)
                }
                guard !Task.isCancelled else { break }
                await take(shot, last: shot == shots.last)
            }
            // closed before the moment's own capture: nothing is kept; otherwise the entry is written now, in a task of
            // its own that closing the view does not cancel
            if Task.isCancelled && !taken.contains(0) {
                discard()
            } else {
                await Task { await self.finish() }.value
            }
        }
    }

    /// Closing: before the moment's own capture nothing is kept; after it, the entry keeps what was captured.
    func close() {
        captureTask?.cancel()
        voiceTask?.cancel()
        MomentVoice.stop()
        if phase != .waiting || captureTask == nil { camera.stop() }
    }

    // MARK: The captures

    /// One capture: the flash and the haptic, every camera at once, the photos on their way into the journal.
    private func take(_ shot: Shot, last: Bool) async {
        guard phase == .waiting else { return }
        beginBackgroundWork()
        flashes += 1
        MomentHaptics.capture()
        if last {
            // the recording runs until the last capture
            voiceTask?.cancel()
            MomentVoice.stop()
            audio = recorder.stop()
        }
        var photos = await camera.capture()
        if photos.isEmpty, camera.mode == .none {
            // the Simulator, or a device without a camera: a still of the moment stands in, so the entry has its photos
            photos = MomentStill.make(moment, words: AppSettings.shared.wording, offset: count > 1 ? shot.offset : nil)
        }
        let named = photos.map { (name: MomentCaptures.photoName(camera: $0.name, offset: shot.offset, count: count), data: $0.data) }
        taken.append(shot.offset)
        adopting.append(Task { await MomentSaver.adopt(named) })
        momentsLog.info("capture \(shot.offset) of \(self.moment.index): \(named.map(\.name))")
    }

    /// Writes the entry with every capture taken (waiting for their photos), then shows it.
    private func finish() async {
        guard phase == .waiting else { return }
        phase = .saving
        voiceTask?.cancel()
        if audio == nil { audio = recorder.stop() }
        var blobs: [BlobRef] = []
        for task in adopting { blobs += await task.value }
        do {
            let record = try await MomentSaver.save(moment: moment, emoji: emoji, text: text, photos: blobs, audio: audio)
            audio = nil
            phase = .saved(record.id)
            Haptics.play(.success)
            momentsLog.info("captured \(self.moment.title()) at \(self.moment.time): \(blobs.count) photos in \(self.taken.count) captures")
        } catch {
            phase = .failed(error.localizedDescription)
            momentsLog.error("could not save the capture: \(error.localizedDescription)")
        }
        camera.stop()
        endBackgroundWork()
    }

    /// Closed before the moment: the recording and the photos go (the journal sweeps media no record names).
    private func discard() {
        recorder.cancel()
        camera.stop()
        endBackgroundWork()
    }

    /// iOS: the captures and the save finish even when the app leaves the front meanwhile.
    private func beginBackgroundWork() {
        #if os(iOS)
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Moment capture") { [weak self] in
            Task { @MainActor in self?.endBackgroundWork() }
        }
        #endif
    }

    private func endBackgroundWork() {
        #if os(iOS)
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
        #endif
    }
}

/// Writes a captured moment into the journal: each capture's photos into its media as soon as they are taken
/// (`adopt`), then the entry (`save`) — photos in `MomentCaptures.sortKey` order (back first, through the moment, then
/// front), the voice note, the moment's exact time and its `capture`. The record is on disk when `save` returns.
enum MomentSaver {
    /// Puts photos into the journal's media; the references (a photo that cannot be read is left out, and logged).
    @MainActor
    static func adopt(_ photos: [(name: String, data: Data)], store: JournalStore = .shared) async -> [BlobRef] {
        let disk = store.disk
        let quality = JournalPreferences.shared.photoQuality
        var blobs: [BlobRef] = []
        for photo in photos {
            do {
                let url = disk.temporaryFile(ext: sniffExtension(photo.data))
                try photo.data.write(to: url)
                let item = try await JournalMedia.processImage(url, name: photo.name, quality: quality, disk: disk)
                try? FileManager.default.removeItem(at: url)
                blobs += try await store.adopt(item)
            } catch {
                momentsLog.error("could not keep the photo \(photo.name): \(error.localizedDescription)")
            }
        }
        return blobs
    }

    /// Writes the entry (the photos already adopted).
    @MainActor
    static func save(moment: Moment, emoji: String?, text: String, photos: [BlobRef], audio: URL?,
                     store: JournalStore = .shared) async throws -> HubRecord {
        var blobs = photos.sorted { MomentCaptures.sortKey($0.name) < MomentCaptures.sortKey($1.name) }
        if let audio {
            do {
                let item = try await JournalMedia.processAudio(audio, disk: store.disk, move: true)
                blobs += try await store.adopt(item)
            } catch {
                // the photos and the moment matter more than the voice note: the entry is written without it
                momentsLog.error("could not keep the voice note: \(error.localizedDescription)")
            }
        }
        let zone = AppSettings.shared.zone ?? TimeZone.current.identifier
        let entry = JournalEntry(emoji: emoji, markdown: text.trimmingCharacters(in: .whitespacesAndNewlines))
        var record = HubRecord.journalEntry(time: moment.time, zone: zone, entry: entry, blobs: blobs, now: Date.now.timeIntervalSince1970)
        record.data = record.data.with(capture: moment.capture)
        return store.save(record)
    }

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
/// one per camera (with the capture's offset when there are several), as JPEG data.
@MainActor
enum MomentStill {
    static func make(_ m: Moment, words: Wording, offset: Int? = nil) -> [(name: String, data: Data)] {
        ["back", "front"].compactMap { name in
            let label = offset.map { "\(name) · \(MomentCaptures.offsetTag($0))" } ?? name
            let view = StillArt(moment: m, title: m.title(words.notation), camera: name, label: label)
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
        let label: String

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
                    Text(verbatim: label.uppercased())
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
