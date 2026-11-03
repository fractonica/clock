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

/// A moment's call picked up: both cameras (the call's, running since it rang) filming from the press, the microphone
/// heard with them, a flash and a haptic at the moment itself (`MomentClock.sleep`, the continuous clock, not a tick).
///
/// - **Answered**: until hung up. A tap on a camera's square keeps its frame as a photo (`front`, `back`), a long press
///   lights the torch. The film becomes the moment's reel (`MomentReelRenderer`: the selfie's square over the back
///   camera's, at real time with a click at the moment, then backwards to the start, clicking at it again, the sound
///   following).
/// - **Muted**: the screen dark, until a Flavon after the moment (`MomentCalendar.captureTime`), played once at real
///   time with a click at the moment.
///
/// Picked up after the moment (or hung up before it), the film has no moment in it: no clicks, marked missed when the
/// moment had passed. Then the entry — time = the moment, `capture` filled
/// (outcome `answered` or `muted`), the film as a video named `reel` (its poster the moment's frame), the photos — is
/// written. Closing the view ends the film there; what was filmed is kept.
@MainActor @Observable
final class InstantModel {
    enum Mode: Equatable {
        case answered, muted
    }

    enum Phase: Equatable {
        /// Before the film (a tenth of a second).
        case waiting
        /// The cameras filming.
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
    let mode: Mode
    /// The film's start (Unix seconds): the press.
    let filmStart: Double
    /// Its end: a Flavon after the moment (muted), the hang-up (answered: no end until then).
    private(set) var filmEnd: Double
    /// Picked up after the moment had passed.
    let missed: Bool
    let camera: MomentCamera
    private(set) var phase = Phase.waiting
    /// How far the reel is made, 0 … 1.
    private(set) var developed = 0.0
    /// Bumped at the moment: the flash.
    private(set) var flashes = 0
    /// Why the reel could not be made (the films were kept as they are instead).
    private(set) var reelFailure: String?
    /// A camera that lost many of its frames while filming ("the back camera lost 40 % of its frames").
    private(set) var filmTrouble: String?
    /// Photos taken by a tap on a camera, by camera.
    private(set) var snaps: [String: Int] = [:]
    /// Bumped at each photo, by camera: its square's flash.
    private(set) var snapFlashes: [String: Int] = [:]
    @ObservationIgnored private var photos: [Task<[BlobRef], Never>] = []
    /// The length of a Flavon around the moment, for the countdown.
    let flavonSeconds: Double

    @ObservationIgnored private var captureTask: Task<Void, Never>?
    @ObservationIgnored private var filming: Task<[MomentFilm], Never>?
    @ObservationIgnored private var opened = false
    #if os(iOS)
    @ObservationIgnored private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    #endif

    /// `camera`: the call's cameras, running already (new ones otherwise).
    init(request: InstantRequest, mode: Mode, camera: MomentCamera? = nil, now: Double = Date.now.timeIntervalSince1970) {
        let m = request.moment
        moment = m
        demo = request.demo
        self.mode = mode
        self.camera = camera ?? MomentCamera()
        let flavon = FractonicaClock.shared.level(at: m.time - 1, 10)?.duration ?? FractonicaClock.shared.levelInfo(10).meanSeconds
        flavonSeconds = flavon
        // filming at once (a moment's cameras run from its first ring)
        filmStart = now + 0.1
        missed = m.time <= filmStart + 0.05
        switch mode {
        case .answered:
            filmEnd = .infinity
        case .muted where missed:
            // the moment past: a Flavon from now
            filmEnd = filmStart + flavon
        case .muted:
            // a demo moment's time is made up: its film ends a mean Flavon after it
            let end = request.demo ? m.time + flavon : MomentStore.shared.calendar.captureTime(of: m, offset: 1)
            filmEnd = max(end, m.time + 0.5)
        }
    }

    var savedID: String? { if case .saved(let id) = phase { id } else { nil } }

    /// Photos are taken while it films.
    var takesExtras: Bool { phase == .waiting || phase == .filming }

    // MARK: Photos and the torch

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

    /// The long press: the back camera's torch on or off.
    func toggleTorch() {
        guard takesExtras, camera.hasTorch else { return }
        Haptics.play(.selection)
        camera.toggleTorch()
    }

    /// Flavons left to the moment.
    func flavons(at t: Double = Date.now.timeIntervalSince1970) -> Double {
        max(0, (moment.time - t) / flavonSeconds)
    }

    /// The reel's centre: the moment, or (none in the film) its middle.
    private func center(end: Double) -> Double {
        moment.time > filmStart && moment.time < end ? moment.time : (filmStart + end) / 2
    }

    // MARK: Lifecycle

    /// Starts the cameras (unless the call's run already) and the film.
    func open() {
        guard !opened else { return }
        opened = true
        let camera = camera
        Task { await camera.start() }
        captureTask = Task { await film() }
    }

    /// Hang up (or End): the film ends now, and what was filmed becomes the entry.
    func hangUp() {
        guard takesExtras else { return }
        filmEnd = min(filmEnd, Date.now.timeIntervalSince1970)
        Haptics.play(.selection)
        filming?.cancel()
    }

    /// Closing the view: as hanging up.
    func close() {
        hangUp()
    }

    // MARK: The film

    private func film() async {
        await MomentClock.sleep(until: filmStart - 0.05)
        beginBackgroundWork()
        phase = .filming
        let (start, end) = (filmStart, filmEnd)
        let camera = camera
        let task = Task { await camera.record(from: start, to: end) }
        filming = task
        // hung up before the film began
        if filmEnd < filmStart { task.cancel() }
        var tick: Task<Void, Never>?
        if !missed {
            let t = moment.time
            tick = Task { [weak self] in
                await MomentClock.sleep(until: t)
                guard !Task.isCancelled, let self, self.phase == .filming else { return }
                self.flashes += 1
                MomentHaptics.capture()
            }
        }
        let films = await task.value
        // no camera (the Simulator), or one that stopped: the film still runs to its end (the drawn stand-in with it)
        while Date.now.timeIntervalSince1970 < filmEnd { try? await Task.sleep(for: .milliseconds(100)) }
        tick?.cancel()
        filming = nil
        // the reel and the entry, in a task of their own that closing the view does not cancel
        await Task { await self.finish(films) }.value
    }

    /// Makes the reel (a drawn one where there is no camera) and writes the entry.
    private func finish(_ films: [MomentFilm]) async {
        camera.stop()
        filmEnd = min(filmEnd, Date.now.timeIntervalSince1970)
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
                media = try await MomentSaver.adoptReel(url, posterAt: script.clicks ? script.timing.moments[0] : 0)
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
        phase = .saving
        let outcome: MomentOutcome = mode == .answered ? .answered : .muted
        do {
            let record = try await MomentSaver.save(moment: moment, emoji: outcome.emoji, text: "", media: media, outcome: outcome)
            phase = .saved(record.id)
            Haptics.play(.success)
            momentsLog.info("captured \(self.moment.title()) at \(self.moment.time), \(outcome.rawValue): \(media.count) blobs")
        } catch {
            phase = .failed(error.localizedDescription)
            momentsLog.error("could not save the capture: \(error.localizedDescription)")
        }
        endBackgroundWork()
    }

    /// The film from the press to its end at real time: answered, forward and then back; muted, once.
    private func reelScript() -> MomentReelScript {
        let rgb = moment.rarity.color.resolve(in: EnvironmentValues())
        let side = JournalPreferences.shared.videoQuality == .hevc720 ? 640 : 960
        let end = max(filmEnd, filmStart + 0.1)
        let center = center(end: end)
        let inside = center == moment.time
        return MomentReelScript(center: center, before: center - filmStart, after: end - center,
                                notation: AppSettings.shared.wording.notation,
                                accent: [Double(rgb.red), Double(rgb.green), Double(rgb.blue)], side: side,
                                clicks: inside, missed: missed, backward: mode == .answered)
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
