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

/// The instant view's state — a moment's call, muted: the moment, the emoji and the line being written, the cameras
/// (the call's, running since it rang) and the film, from the press: every camera filming until half a Flavon after
/// the moment (`MomentCalendar.filmSpan`, armed by a sleep on the continuous clock, not a tick), a flash and a haptic
/// at the moment itself, the microphone heard with it; muted after the moment, a Flavon from the press, marked missed.
/// Until the film ends a tap on a camera's square keeps its frame as a photo (`front`, `back`), and holding the
/// microphone button records a voice note — only while held, every held stretch back to back in one file. When the
/// film ends it is made into the moment's reel (`MomentReelRenderer`: the selfie's square over the back camera's,
/// slowing to an eighth at the moment with a click, then back the same way, the sound following) and the entry — time
/// = the moment, `capture` filled (outcome `muted`), the reel (named `reel`, its poster the moment's frame), the
/// photos, the voice note (`voice`) — is written, before the view changes, and only then shown. Closed before the
/// moment, nothing is saved; closed after it, the film ends there and the entry keeps what was filmed.
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
    /// The film's span (Unix seconds): from the press to half a Flavon after the moment — or, the moment past, a
    /// Flavon from the press.
    let filmStart: Double
    let filmEnd: Double
    /// Muted after the moment had passed: the reel slows at its film's middle, without clicks, marked missed.
    let missed: Bool
    var emoji: String?
    var text = ""
    let camera: MomentCamera
    private(set) var phase = Phase.waiting
    /// How far the reel is made, 0 … 1.
    private(set) var developed = 0.0
    /// Bumped at the moment: the flash.
    private(set) var flashes = 0
    /// The moment itself is past, inside the film.
    private(set) var reachedMoment = false
    /// Why the reel could not be made (the films were kept as they are instead).
    private(set) var reelFailure: String?
    /// A camera that lost many of its frames while filming ("the back camera lost 40 % of its frames").
    private(set) var filmTrouble: String?
    /// Photos taken by a tap on a camera, by camera.
    private(set) var snaps: [String: Int] = [:]
    /// Bumped at each photo, by camera: its square's flash.
    private(set) var snapFlashes: [String: Int] = [:]
    /// The microphone button held: the voice note recording.
    private(set) var talking = false
    /// The voice note's length so far, not counting the stretch being held.
    private(set) var voiceSeconds = 0.0
    @ObservationIgnored private var talkStarted: Double?
    /// Without the session's microphone (the Simulator, a camera refused): the voice note on a recorder of its own.
    @ObservationIgnored private let recorder = VoiceRecorder()
    @ObservationIgnored private var photos: [Task<[BlobRef], Never>] = []
    /// The length of a Flavon around the moment, for the countdown.
    let flavonSeconds: Double

    @ObservationIgnored private var captureTask: Task<Void, Never>?
    @ObservationIgnored private var opened = false
    #if os(iOS)
    @ObservationIgnored private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    #endif

    /// `camera`: the call's cameras, running already (new ones otherwise).
    init(request: InstantRequest, camera: MomentCamera? = nil, now: Double = Date.now.timeIntervalSince1970) {
        let m = request.moment
        moment = m
        demo = request.demo
        self.camera = camera ?? MomentCamera()
        emoji = EmojiCatalog.categories.prefix(5).flatMap(\.emoji).randomElement()
        let flavon = FractonicaClock.shared.level(at: m.time - 1, 10)?.duration ?? FractonicaClock.shared.levelInfo(10).meanSeconds
        flavonSeconds = flavon
        // filming at once (a moment's cameras run from its first ring)
        filmStart = now + 0.1
        // a demo moment's time is made up: its film ends a mean half Flavon after it
        let end = request.demo ? m.time + flavon / 2 : MomentStore.shared.calendar.filmSpan(of: m).end
        if m.time > filmStart + 0.05 {
            filmEnd = max(end, m.time + 0.5)
            missed = false
        } else {
            // muted after the moment: a Flavon from now, slowing at its middle
            filmEnd = filmStart + flavon
            missed = true
        }
    }

    var savedID: String? { if case .saved(let id) = phase { id } else { nil } }

    /// Photos and the voice note are taken until the film ends.
    var takesExtras: Bool { phase == .waiting || phase == .filming }

    /// The voice note's length, the stretch being held included.
    func voiceLength(at t: Double = Date.now.timeIntervalSince1970) -> Double {
        voiceSeconds + (talkStarted.map { max(0, t - $0) } ?? 0)
    }

    // MARK: Photos and the voice note

    /// A camera's frame kept as a photo (where there is no camera, a still of the moment stands in).
    func snap(_ name: String) {
        guard takesExtras else { return }
        snapFlashes[name, default: 0] += 1
        Haptics.play(.selection)
        let m = moment
        let none = camera.mode == .none
        photos.append(Task { [camera] in
            var data = await camera.still(name)
            if data == nil, none {
                data = MomentStill.make(m, words: AppSettings.shared.wording).first { $0.name == (name == "front" ? "front" : "back") }?.data
            }
            guard let data else { return [] }
            let blobs = await MomentSaver.adopt([(name: name, data: data)])
            if !blobs.isEmpty { self.snaps[name, default: 0] += 1 }
            return blobs
        })
    }

    /// The microphone button pressed or let go: the voice note records only while it is held.
    func talk(_ on: Bool) {
        guard on != talking, !on || takesExtras else { return }
        talking = on
        let now = Date.now.timeIntervalSince1970
        if on {
            talkStarted = now
            Haptics.play(.selection)
        } else if let started = talkStarted {
            voiceSeconds += max(0, now - started)
            talkStarted = nil
        }
        if camera.hearing {
            camera.voice(on)
        } else if on {
            if recorder.isActive {
                recorder.resume()
            } else {
                Task {
                    await recorder.start(quality: JournalPreferences.shared.audioQuality, disk: JournalStore.shared.disk)
                    // let go before the recorder was up
                    if !talking { recorder.pause() }
                }
            }
        } else {
            recorder.pause()
        }
    }

    /// The voice note, closed (nil when nothing was held).
    private func closeVoice() async -> URL? {
        talk(false)
        if camera.hearing { return await camera.finishVoice() }
        return recorder.isActive ? recorder.stop() : nil
    }

    /// Where the reel slows: the moment, or a late film's middle.
    var center: Double { missed ? (filmStart + filmEnd) / 2 : moment.time }

    /// Flavons left until the film starts (until the moment while filming).
    func flavons(at t: Double = Date.now.timeIntervalSince1970) -> Double {
        max(0, ((phase == .waiting ? filmStart : center) - t) / flavonSeconds)
    }

    // MARK: Lifecycle

    /// Starts the cameras (unless the call's run already) and the film.
    func open() {
        guard !opened else { return }
        opened = true
        Task {
            await camera.start()
            // the voice note without the session's microphone: asked now, not in the middle of the first hold
            if !camera.hearing { _ = await AVAudioApplication.requestRecordPermission() }
        }
        captureTask = Task { await film() }
    }

    /// Closing: before the moment nothing is kept; after it, the film ends and the entry keeps what was filmed.
    func close() {
        captureTask?.cancel()
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
        let (start, end, center) = (filmStart, filmEnd, center)
        let filming = Task { await camera.record(from: start, to: end) }
        await Self.sleep(until: center)
        if !Task.isCancelled {
            reachedMoment = true
            // the moment itself: none in a missed one's film
            if !missed {
                flashes += 1
                MomentHaptics.capture()
            }
        }
        let films = await withTaskCancellationHandler { await filming.value } onCancel: { filming.cancel() }
        guard reachedMoment else {
            // closed before the moment: nothing is kept
            films.forEach { try? FileManager.default.removeItem(at: $0.url) }
            if let voice = await closeVoice() { try? FileManager.default.removeItem(at: voice) }
            recorder.cancel()
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
        let voice = await closeVoice()
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
                let gaps = try await MomentReelRenderer.render(films: films, script: script, to: url) { [weak self] p in
                    Task { @MainActor in self?.developed = max(self?.developed ?? 0, p) }
                }
                if let gap = gaps.first { filmTrouble = gap }
                media = try await MomentSaver.adoptReel(url, posterAt: script.timing.moments[0])
                momentsLog.info("reel of \(self.moment.index): \(films.map(\.camera)), \(media.count) blobs")
            } catch {
                momentsLog.error("could not make the reel: \(error.localizedDescription)")
                reelFailure = error.localizedDescription
                // the films themselves, rather than nothing
                media = await MomentSaver.adoptFilms(films)
            }
            try? FileManager.default.removeItem(at: url)
        }
        MomentFilmArchive.keep(films)
        if let worst = films.filter({ $0.camera != "sound" && $0.lost > 0.1 }).max(by: { $0.lost < $1.lost }) {
            filmTrouble = "the \(worst.camera) camera lost \(Int((worst.lost * 100).rounded())) % of its frames"
            momentsLog.error("films: \(films.compactMap(\.report).joined(separator: "; "))")
        }
        for task in photos { media += await task.value }
        if let voice {
            do {
                let item = try await JournalMedia.processAudio(voice, name: "voice", disk: JournalStore.shared.disk, move: true)
                media += try await JournalStore.shared.adopt(item)
            } catch {
                momentsLog.error("could not keep the voice note: \(error.localizedDescription)")
            }
        }
        phase = .saving
        do {
            let record = try await MomentSaver.save(moment: moment, emoji: emoji, text: text, media: media, outcome: .muted)
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
        let rgb = moment.rarity.color.resolve(in: EnvironmentValues())
        let side = JournalPreferences.shared.videoQuality == .hevc720 ? 640 : 960
        return MomentReelScript(center: center, before: center - filmStart, after: filmEnd - center, half: flavonSeconds / 2,
                                notation: AppSettings.shared.wording.notation,
                                accent: [Double(rgb.red), Double(rgb.green), Double(rgb.blue)], side: side,
                                clicks: !missed, missed: missed)
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

    /// The cameras' films as they are (named by camera, the sound as `sound`), when the reel could not be made.
    @MainActor
    static func adoptFilms(_ films: [MomentFilm], store: JournalStore = .shared) async -> [BlobRef] {
        var blobs: [BlobRef] = []
        for film in films {
            do {
                let item = film.camera == "sound"
                    ? try await JournalMedia.processAudio(film.url, name: film.camera, disk: store.disk)
                    : try await JournalMedia.processVideo(film.url, name: film.camera, quality: JournalPreferences.shared.videoQuality,
                                                          disk: store.disk)
                blobs += try await store.adopt(item)
            } catch {
                momentsLog.error("could not keep the \(film.camera) film: \(error.localizedDescription)")
            }
        }
        return blobs
    }

    /// Writes the entry (the media already adopted, in their order), titled as its call went.
    @MainActor
    static func save(moment: Moment, emoji: String?, text: String, media: [BlobRef], outcome: MomentOutcome,
                     store: JournalStore = .shared) async throws -> HubRecord {
        let blobs = media
        let zone = AppSettings.shared.zone ?? TimeZone.current.identifier
        let entry = JournalEntry(emoji: emoji, title: outcome.title, markdown: text.trimmingCharacters(in: .whitespacesAndNewlines))
        var record = HubRecord.journalEntry(time: moment.time, zone: zone, entry: entry, blobs: blobs, now: Date.now.timeIntervalSince1970)
        record.data = record.data.with(capture: moment.capture(outcome))
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

/// The last capture's films as filmed, kept in Caches/MomentFilms until the next capture (replacing them): to look into
/// a reel that came out wrong (`devicectl device copy from` reads them off a phone).
enum MomentFilmArchive {
    static func keep(_ films: [MomentFilm]) {
        let fm = FileManager.default
        guard let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            films.forEach { try? fm.removeItem(at: $0.url) }
            return
        }
        let dir = caches.appending(path: "MomentFilms")
        try? fm.removeItem(at: dir)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        var lines: [String] = []
        for film in films {
            let target = dir.appending(path: "\(film.camera).\(film.url.pathExtension)")
            if (try? fm.moveItem(at: film.url, to: target)) == nil { try? fm.removeItem(at: film.url) }
            lines.append("\(film.camera) start \(film.start) lost \(film.lost) \(film.report ?? "")")
        }
        try? lines.joined(separator: "\n").write(to: dir.appending(path: "films.txt"), atomically: true, encoding: .utf8)
    }
}
