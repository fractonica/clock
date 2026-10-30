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

/// The instant view's state: the moment, the emoji and the line being written, the cameras running from the moment the
/// view opens, and the film: every camera filming the Flavon centred on the moment (`MomentCalendar.filmSpan`: from half
/// a Flavon before to half after, armed by a sleep on the continuous clock, not a tick), a flash and a haptic at the
/// moment itself. When the film ends it is made into the moment's reel (`MomentReelRenderer`: the selfie's square over
/// the back camera's, slowing to an eighth at the moment with a click, then played backwards) and the entry — time =
/// the moment, `capture` filled, the reel (named `reel`, its poster the moment's frame) — is written, before the view
/// changes, and only then shown. Nothing records sound. Closed before the moment, nothing is saved; closed after it,
/// the film ends there and the entry keeps what was filmed.
@MainActor @Observable
final class InstantModel {
    enum Phase: Equatable {
        /// Before the film.
        case waiting
        /// The cameras filming the Flavon around the moment.
        case filming
        /// The film made into the reel (`developed` says how far).
        case developing
        /// The entry being written.
        case saving
        case saved(String)
        case failed(String)
    }

    let moment: Moment
    let demo: Bool
    /// The film's span (Unix seconds): half a Flavon either side of the moment — or, opened after that has passed, a
    /// Flavon from now.
    let filmStart: Double
    let filmEnd: Double
    var emoji: String?
    var text = ""
    let camera = MomentCamera()
    private(set) var phase = Phase.waiting
    /// How far the reel is made, 0 … 1.
    private(set) var developed = 0.0
    /// Bumped at the moment: the flash.
    private(set) var flashes = 0
    /// The moment itself is past, inside the film.
    private(set) var reachedMoment = false
    /// The length of a Flavon around the moment, for the countdown.
    let flavonSeconds: Double

    @ObservationIgnored private var captureTask: Task<Void, Never>?
    @ObservationIgnored private var voiceTask: Task<Void, Never>?
    @ObservationIgnored private var opened = false
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
        // a demo moment's time is made up: its film is a mean Flavon around it
        let span = request.demo ? (start: m.time - flavon / 2, end: m.time + flavon / 2) : MomentStore.shared.calendar.filmSpan(of: m)
        if span.end > now + 1 {
            filmStart = span.start
            filmEnd = span.end
        } else {
            // opened too late for the moment's own Flavon: a Flavon from now, slowing at its middle
            filmStart = now + 0.5
            filmEnd = now + 0.5 + flavon
        }
    }

    var savedID: String? { if case .saved(let id) = phase { id } else { nil } }

    /// Where the reel slows: the moment, or a late film's middle.
    var center: Double { moment.time >= filmStart && moment.time <= filmEnd ? moment.time : (filmStart + filmEnd) / 2 }

    /// Flavons left until the film starts (until the moment while filming).
    func flavons(at t: Double = Date.now.timeIntervalSince1970) -> Double {
        max(0, ((phase == .waiting ? filmStart : center) - t) / flavonSeconds)
    }

    // MARK: Lifecycle

    /// Starts the cameras and the announcement, and arms the film.
    func open() {
        guard !opened else { return }
        opened = true
        Task { await camera.start() }
        if MomentStore.shared.settings.voice && (moment.time - Date.now.timeIntervalSince1970) / flavonSeconds >= 8 {
            let m = moment
            voiceTask = Task { await MomentVoice.play(m) }
        }
        captureTask = Task { await film() }
    }

    /// Closing: before the moment nothing is kept; after it, the film ends and the entry keeps what was filmed.
    func close() {
        captureTask?.cancel()
        voiceTask?.cancel()
        MomentVoice.stop()
        if phase == .waiting { camera.stop() }
    }

    // MARK: The film

    private func film() async {
        await Self.sleep(until: filmStart - 0.05)
        guard !Task.isCancelled else {
            camera.stop()
            return
        }
        beginBackgroundWork()
        phase = .filming
        voiceTask?.cancel()
        MomentVoice.stop()
        let (start, end, center) = (filmStart, filmEnd, center)
        let filming = Task { await camera.record(from: start, to: end) }
        await Self.sleep(until: center)
        if !Task.isCancelled {
            reachedMoment = true
            flashes += 1
            MomentHaptics.capture()
        }
        let films = await withTaskCancellationHandler { await filming.value } onCancel: { filming.cancel() }
        guard reachedMoment else {
            // closed before the moment: nothing is kept
            films.forEach { try? FileManager.default.removeItem(at: $0.url) }
            camera.stop()
            endBackgroundWork()
            return
        }
        // the reel and the entry, in a task of their own that closing the view does not cancel
        await Task { await self.finish(films) }.value
    }

    private static func sleep(until t: Double) async {
        let delay = t - Date.now.timeIntervalSince1970
        guard delay > 0 else { return }
        // the continuous clock keeps counting through a locked screen; a tolerance of zero asks for the instant itself
        try? await Task.sleep(until: .now + .seconds(delay), tolerance: .zero, clock: .continuous)
    }

    /// Makes the reel (a drawn one where there is no camera), writes the entry, then shows it.
    private func finish(_ films: [MomentFilm]) async {
        camera.stop()
        phase = .developing
        #if os(iOS)
        // the GPU and the video encoder are the front app's: a film that ended in the background becomes the reel on
        // the way back
        while UIApplication.shared.applicationState == .background { try? await Task.sleep(for: .milliseconds(500)) }
        #endif
        var media: [BlobRef] = []
        if !films.isEmpty || camera.mode == .none {
            let disk = JournalStore.shared.disk
            let url = disk.temporaryFile(ext: "mov")
            let script = reelScript()
            do {
                try await MomentReelRenderer.render(films: films, script: script, to: url) { [weak self] p in
                    Task { @MainActor in self?.developed = max(self?.developed ?? 0, p) }
                }
                media = try await MomentSaver.adoptReel(url, posterAt: MomentReelTiming(half: script.half).moments[0])
                momentsLog.info("reel of \(self.moment.index): \(films.map(\.camera)), \(media.count) blobs")
            } catch {
                momentsLog.error("could not make the reel: \(error.localizedDescription)")
                // the films themselves, rather than nothing
                media = await MomentSaver.adoptFilms(films)
            }
            try? FileManager.default.removeItem(at: url)
        }
        films.forEach { try? FileManager.default.removeItem(at: $0.url) }
        phase = .saving
        do {
            let record = try await MomentSaver.save(moment: moment, emoji: emoji, text: text, media: media)
            phase = .saved(record.id)
            Haptics.play(.success)
            momentsLog.info("captured \(self.moment.title()) at \(self.moment.time): \(media.count) blobs")
        } catch {
            phase = .failed(error.localizedDescription)
            momentsLog.error("could not save the capture: \(error.localizedDescription)")
        }
        endBackgroundWork()
    }

    private func reelScript() -> MomentReelScript {
        let words = AppSettings.shared.wording
        let clock = FractonicaClock.shared
        let rgb = moment.rarity.color.resolve(in: EnvironmentValues())
        let side = JournalPreferences.shared.videoQuality == .hevc720 ? 640 : 960
        return MomentReelScript(
            moment: moment.time, center: center, half: (filmEnd - filmStart) / 2,
            preon: clock.level(at: moment.time - 1, 8)?.duration ?? clock.levelInfo(8).meanSeconds,
            title: moment.ledTitle(words.notation), notation: words.notation, pure: words.pure,
            zone: AppSettings.shared.timeZone, accent: [Double(rgb.red), Double(rgb.green), Double(rgb.blue)], side: side)
    }

    /// iOS: the film, the reel and the save finish even when the app leaves the front meanwhile.
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

/// Writes a captured moment into the journal: the reel (or, failing it, the films) into its media (`adoptReel`), then
/// the entry (`save`) — the media, the moment's exact time and its `capture`. The record is on disk when `save`
/// returns.
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

    /// Puts the reel into the journal's media, named `reel`, its poster the frame at `posterAt` (the moment).
    @MainActor
    static func adoptReel(_ url: URL, posterAt: Double, store: JournalStore = .shared) async throws -> [BlobRef] {
        // made at the journal's video size already: kept as it is
        let item = try await JournalMedia.processVideo(url, name: MomentReel.name, quality: .original, disk: store.disk,
                                                       posterAt: posterAt)
        return try await store.adopt(item)
    }

    /// The cameras' films as they are (named by camera), when the reel could not be made.
    @MainActor
    static func adoptFilms(_ films: [MomentFilm], store: JournalStore = .shared) async -> [BlobRef] {
        var blobs: [BlobRef] = []
        for film in films {
            do {
                let item = try await JournalMedia.processVideo(film.url, name: film.camera, quality: JournalPreferences.shared.videoQuality,
                                                               disk: store.disk)
                blobs += try await store.adopt(item)
            } catch {
                momentsLog.error("could not keep the \(film.camera) film: \(error.localizedDescription)")
            }
        }
        return blobs
    }

    /// Writes the entry (the media already adopted).
    @MainActor
    static func save(moment: Moment, emoji: String?, text: String, media: [BlobRef],
                     store: JournalStore = .shared) async throws -> HubRecord {
        let blobs = media.sorted { MomentCaptures.sortKey($0.name) < MomentCaptures.sortKey($1.name) }
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
