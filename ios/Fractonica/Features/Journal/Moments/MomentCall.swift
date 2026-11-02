@preconcurrency import AVFoundation
import FractonicaKit
import Foundation
import Observation
import SwiftUI
#if os(iOS)
import AudioToolbox
import UIKit
#endif

/// A moment's call: it rings from a Flavon before the moment for 11 Flavons (the ringtone looping, a buzz each ring),
/// the cameras running from the first ring so whatever is chosen starts at once:
///
/// - **Answered** (slide to answer, or the alarm's Answer): the back camera films with the microphone until hung up,
///   the screen dark against the ear (the proximity sensor), a tap on the viewfinder changing lens, a haptic at the
///   moment; the entry keeps the film as `call` (its poster the moment's frame), titled Answered. Saved, the Journal
///   shows it.
/// - **Muted**: both cameras film from the press through the moment into its reel — the instant view (`InstantModel`)
///   takes the call's place and its cameras.
/// - **Declined** (or the alarm's Stop): each camera's photo at the press (`front`, `back`), titled Declined; then the
///   app leaves the screen, as a declined call does.
/// - **Rung out**: a missed call — on the iPhone an entry titled Missed, 🔴 (`MomentStore.recordMissed`) — and the
///   call screen goes.
///
/// Every entry is on the moment's time with its `capture` and how the call went (`MomentOutcome`). `finished` says when
/// the call's screen is done (the entry written, or the call missed).
@MainActor @Observable
final class MomentCallModel {
    enum Phase: Equatable {
        case ringing
        /// Picked up: the back camera filming until hung up.
        case talking
        /// Muted: the instant view filming both cameras.
        case filming
        /// Hung up, declined or rung out: the entry being written, then written.
        case ended(MomentOutcome)
    }

    let moment: Moment
    let demo: Bool
    /// The first ring and when it rings out (Unix seconds).
    let ringStart: Double
    let ringEnd: Double
    let camera = MomentCamera()
    private(set) var phase = Phase.ringing
    /// When it was picked up and hung up.
    private(set) var talkStart: Double?
    private(set) var talkEnd: Double?
    /// The entry written for the call (a muted one's instant view writes its own).
    private(set) var savedID: String?
    private(set) var saving = false
    /// What went amiss saving (the call's film kept as it was, or nothing written).
    private(set) var trouble: String?
    /// Photos taken while talking, and the flash of each.
    private(set) var snaps = 0
    private(set) var snapFlashes = 0
    /// The muted call's instant view.
    private(set) var instant: InstantModel?
    /// The call is over and its entry written (or it was missed): the screen goes.
    private(set) var finished: MomentOutcome?

    @ObservationIgnored private let start: CallStart
    @ObservationIgnored private var opened = false
    @ObservationIgnored private var timeout: Task<Void, Never>?
    @ObservationIgnored private var tick: Task<Void, Never>?
    @ObservationIgnored private var film: Task<[MomentFilm], Never>?
    @ObservationIgnored private var photos: [Task<[BlobRef], Never>] = []
    #if os(iOS)
    @ObservationIgnored private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    #endif

    init(request: InstantRequest) {
        moment = request.moment
        demo = request.demo
        start = request.start
        let flavon = FractonicaClock.shared.levelInfo(10).meanSeconds
        if request.demo {
            // a made-up moment: its call rings a mean Flavon before it
            ringStart = moment.time - Double(MomentCalendar.leadFlavons) * flavon
            ringEnd = ringStart + Double(MomentCalendar.ringFlavons) * flavon
        } else {
            let calendar = MomentStore.shared.calendar
            ringStart = calendar.promptTime(of: moment)
            ringEnd = calendar.ringEnd(of: moment)
        }
    }

    /// How long the call has lasted (picked up).
    func talked(at t: Double = Date.now.timeIntervalSince1970) -> Double {
        guard let talkStart else { return 0 }
        return max(0, (talkEnd ?? t) - talkStart)
    }

    // MARK: Lifecycle

    /// Starts the cameras and the ringing — or, picked up from the alarm, what was chosen there.
    func open() {
        guard !opened else { return }
        opened = true
        MomentStore.shared.callOpened(moment, demo: demo)
        keepAwake(true)
        let camera = camera
        Task { await camera.start() }
        let now = Date.now.timeIntervalSince1970
        switch start {
        case .ringing:
            guard now < ringEnd else { return ringOut() }
            MomentRinger.shared.ring(MomentStore.shared.settings.ringtone)
            let end = ringEnd
            timeout = Task { [weak self] in
                await MomentClock.sleep(until: end)
                guard !Task.isCancelled else { return }
                self?.ringOut()
            }
            if let pick = MomentStore.shared.launch.pick, demo { autoPick(pick) }
        case .answered:
            if now < ringEnd { answer() } else { ringOut() }
        case .declined(let t):
            guard t < ringEnd else { return ringOut() }
            // the app came up long after the press (the alarm's Stop did not open it): no photos of another instant
            decline(photos: now - t < FractonicaClock.shared.levelInfo(10).meanSeconds)
        }
    }

    /// Closing the screen: a call talking is hung up; one ringing just stops (it may still be written missed).
    func close() {
        timeout?.cancel()
        tick?.cancel()
        MomentRinger.shared.stop()
        keepAwake(false)
        proximity(false)
        switch phase {
        case .talking: hangUp()
        case .ringing: camera.stop()
        case .filming: break
        case .ended: if !saving { camera.stop() }
        }
    }

    // MARK: Choices

    /// Slide to answer: the back camera films until hung up.
    func answer() {
        guard phase == .ringing else { return }
        stopRinging()
        MomentStore.shared.callPicked(moment, .answered, demo: demo)
        let now = Date.now.timeIntervalSince1970
        phase = .talking
        talkStart = now
        beginBackgroundWork()
        proximity(true)
        Haptics.play(.selection)
        let camera = camera
        film = Task {
            await camera.start()
            return await camera.record(from: Date.now.timeIntervalSince1970, to: .infinity, only: Set([camera.main].compactMap { $0 }))
        }
        if moment.time > now {
            // the moment itself, felt at the ear
            let t = moment.time
            tick = Task {
                await MomentClock.sleep(until: t)
                guard !Task.isCancelled else { return }
                MomentHaptics.capture()
            }
        }
    }

    /// The red button: the film ends and the entry is written.
    func hangUp() {
        guard phase == .talking else { return }
        talkEnd = Date.now.timeIntervalSince1970
        tick?.cancel()
        proximity(false)
        phase = .ended(.answered)
        let film = film
        // cancelling ends the film at once
        film?.cancel()
        Task { await saveCall(film) }
    }

    /// Mute: the instant view films both cameras from now through the moment.
    func mute() {
        guard phase == .ringing else { return }
        stopRinging()
        MomentStore.shared.callPicked(moment, .muted, demo: demo)
        instant = InstantModel(request: InstantRequest(moment: moment, demo: demo), camera: camera)
        phase = .filming
    }

    /// Decline: each camera's photo at the press (`photos`).
    func decline(photos: Bool = true) {
        guard phase == .ringing else { return }
        stopRinging()
        MomentStore.shared.callPicked(moment, .declined, demo: demo)
        phase = .ended(.declined)
        Haptics.play(.selection)
        Task { await saveDecline(photos: photos) }
    }

    /// Eleven Flavons rang unanswered: a missed call.
    func ringOut() {
        guard phase == .ringing else { return }
        stopRinging()
        phase = .ended(.missed)
        camera.stop()
        Haptics.play(.warning)
        Task {
            saving = true
            savedID = await MomentStore.shared.recordMissed(moment, demo: demo)
            saving = false
            finished = .missed
        }
    }

    /// While talking: the back camera's next lens (1× → 3× → 0.5× …, as the phone has them).
    func nextLens() {
        guard phase == .talking, camera.lenses.count > 1 else { return }
        Haptics.play(.selection)
        camera.nextLens()
    }

    /// While talking: the back camera's frame kept as a photo.
    func snap() {
        guard phase == .talking, let name = camera.main ?? (camera.mode == .none ? "back" : nil) else { return }
        snapFlashes += 1
        Haptics.play(.selection)
        let m = moment, none = camera.mode == .none, camera = camera
        photos.append(Task {
            var data = await camera.still(name)
            if data == nil, none { data = MomentStill.make(m, words: AppSettings.shared.wording).first { $0.name == "back" }?.data }
            guard let data else { return [] }
            let blobs = await MomentSaver.adopt([(name: name, data: data)])
            if !blobs.isEmpty { self.snaps += 1 }
            return blobs
        })
    }

    private func stopRinging() {
        timeout?.cancel()
        MomentRinger.shared.stop()
    }

    /// `-FXMomentsPick`: the choice made by itself, 2 s into the ringing (screenshots and checks).
    private func autoPick(_ pick: String) {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            switch pick {
            case "answer":
                self?.answer()
                try? await Task.sleep(for: .seconds(8))
                self?.hangUp()
            case "mute": self?.mute()
            case "decline": self?.decline()
            default: break
            }
        }
    }

    // MARK: Saving

    private func saveCall(_ film: Task<[MomentFilm], Never>?) async {
        saving = true
        defer { saving = false }
        let films = await film?.value ?? []
        camera.stop()
        #if os(iOS)
        // the video encoder is the front app's: a call hung up in the background is saved on the way back
        while UIApplication.shared.applicationState == .background { try? await Task.sleep(for: .milliseconds(500)) }
        #endif
        var media: [BlobRef] = []
        if !films.isEmpty {
            do {
                if let merged = try await MomentCallFilm.merge(films) {
                    let picture = films.first { $0.camera != "sound" }
                    let poster = picture.map { moment.time - $0.start }.flatMap { $0 >= 0 && $0 <= talked() ? $0 : nil }
                    let item = try await JournalMedia.processVideo(merged, name: MomentCallFilm.name, quality: JournalPreferences.shared.videoQuality,
                                                                   disk: JournalStore.shared.disk, posterAt: poster)
                    media += try await JournalStore.shared.adopt(item)
                    try? FileManager.default.removeItem(at: merged)
                }
            } catch {
                momentsLog.error("could not keep the call's film: \(error.localizedDescription)")
                trouble = "the film is kept as it was filmed — \(error.localizedDescription)"
                media += await MomentSaver.adoptFilms(films)
            }
            MomentFilmArchive.keep(films)
        } else if camera.mode == .none {
            // no camera (the Simulator): a still stands in for the film
            media += await MomentSaver.adopt(MomentStill.make(moment, words: AppSettings.shared.wording).filter { $0.name == "back" })
        }
        for task in photos { media += await task.value }
        await save(.answered, media: media)
        endBackgroundWork()
        if trouble == nil { finished = .answered }
    }

    private func saveDecline(photos: Bool) async {
        saving = true
        defer { saving = false }
        if photos { await camera.start() }
        var shots: [(name: String, data: Data)] = []
        if !photos {
            // none
        } else if camera.mode == .none {
            shots = MomentStill.make(moment, words: AppSettings.shared.wording)
        } else {
            // both at once: the press's instant
            let names = ["front", "back", "camera"].filter { camera.previews[$0] != nil }
            let camera = camera
            await withTaskGroup(of: (String, Data?).self) { group in
                for name in names { group.addTask { (name, await camera.still(name)) } }
                for await (name, data) in group { if let data { shots.append((name, data)) } }
            }
            shots.sort { MomentCaptures.sortKey($0.name) < MomentCaptures.sortKey($1.name) }
        }
        camera.stop()
        let media = await MomentSaver.adopt(shots)
        await save(.declined, media: media)
        if trouble == nil { finished = .declined }
    }

    private func save(_ outcome: MomentOutcome, media: [BlobRef]) async {
        do {
            let record = try await MomentSaver.save(moment: moment, emoji: outcome.emoji, text: "", media: media, outcome: outcome)
            savedID = record.id
            Haptics.play(.success)
            momentsLog.info("call \(outcome.rawValue) at \(self.moment.title()): \(media.count) blobs")
        } catch {
            trouble = error.localizedDescription
            momentsLog.error("could not save the call: \(error.localizedDescription)")
        }
    }

    // MARK: The device

    /// The screen stays on through the call (locking it would stop the cameras).
    private func keepAwake(_ on: Bool) {
        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = on
        #endif
    }

    /// Talking: the screen goes dark against the ear.
    private func proximity(_ on: Bool) {
        #if os(iOS)
        UIDevice.current.isProximityMonitoringEnabled = on
        #endif
    }

    private func beginBackgroundWork() {
        #if os(iOS)
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Moment call") { [weak self] in
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

/// Sleeps until a Unix instant, on the continuous clock (it keeps counting through a locked screen).
enum MomentClock {
    static func sleep(until t: Double) async {
        let delay = t - Date.now.timeIntervalSince1970
        guard delay > 0 else { return }
        try? await Task.sleep(until: .now + .seconds(delay), tolerance: .zero, clock: .continuous)
    }
}

// MARK: - The ringing

/// A call ringing in the app: its ringtone looping through the silent switch (in the call's audio session, so the
/// cameras starting under it do not stop it) and a buzz at each ring. `preview` plays a ringtone's first two rings for
/// the settings.
@MainActor @Observable
final class MomentRinger {
    static let shared = MomentRinger()

    /// The ringtone being previewed.
    private(set) var previewing: MomentRingtone?
    @ObservationIgnored private var player: AVAudioPlayer?
    @ObservationIgnored private var tasks: [Task<Void, Never>] = []

    func ring(_ tone: MomentRingtone) {
        stop()
        #if os(iOS)
        MomentCamera.prepareAudio(recording: AVAudioApplication.shared.recordPermission == .granted)
        #endif
        guard let player = Self.player(tone) else { return }
        player.numberOfLoops = -1
        player.play()
        self.player = player
        #if os(iOS)
        tasks.append(Task {
            // a buzz at each ring
            while !Task.isCancelled {
                AudioServicesPlayAlertSound(SystemSoundID(kSystemSoundID_Vibrate))
                try? await Task.sleep(for: .seconds(MomentRingtone.cycle))
            }
        })
        #endif
    }

    /// Plays a ringtone's first two rings, or stops it when it is the one playing.
    func preview(_ tone: MomentRingtone) {
        let again = previewing == tone
        stop()
        guard !again else { return }
        MomentCamera.prepareAudio(recording: false)
        guard let player = Self.player(tone) else { return }
        player.play()
        self.player = player
        previewing = tone
        tasks.append(Task { [weak self] in
            try? await Task.sleep(for: .seconds(2 * MomentRingtone.cycle))
            guard !Task.isCancelled else { return }
            self?.stop()
        })
    }

    func stop() {
        tasks.forEach { $0.cancel() }
        tasks = []
        player?.stop()
        player = nil
        previewing = nil
    }

    private static func player(_ tone: MomentRingtone) -> AVAudioPlayer? {
        guard let url = Bundle.main.url(forResource: "ring-\(tone.rawValue)", withExtension: "caf") else {
            momentsLog.error("no ringtone \(tone.fileName)")
            return nil
        }
        return try? AVAudioPlayer(contentsOf: url)
    }
}

// MARK: - The call's film

/// An answered call's film: the camera's picture with the microphone's sound laid under it from the instant it was
/// heard, in one movie, passed through (not encoded again). A journal entry's media named `call` (hub/API.md).
enum MomentCallFilm {
    static let name = "call"

    static func merge(_ films: [MomentFilm]) async throws -> URL? {
        guard let picture = films.first(where: { $0.camera != "sound" }) else { return nil }
        let composition = AVMutableComposition()
        let asset = AVURLAsset(url: picture.url)
        guard let track = try await asset.loadTracks(withMediaType: .video).first,
              let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
        else { return nil }
        let (range, transform) = try await track.load(.timeRange, .preferredTransform)
        try video.insertTimeRange(range, of: track, at: .zero)
        video.preferredTransform = transform
        if let sound = films.first(where: { $0.camera == "sound" }) {
            let heard = AVURLAsset(url: sound.url)
            if let source = try await heard.loadTracks(withMediaType: .audio).first,
               let audio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
                let length = try await source.load(.timeRange)
                // the sound began this long after the picture (before it: its start is cut)
                let offset = sound.start - picture.start
                let skip = CMTime(seconds: max(0, -offset), preferredTimescale: 48_000)
                let at = CMTime(seconds: max(0, offset), preferredTimescale: 48_000)
                let end = CMTimeMinimum(length.end, length.start + skip + range.duration - at)
                if end > length.start + skip {
                    try audio.insertTimeRange(CMTimeRange(start: length.start + skip, end: end), of: source, at: at)
                }
            }
        }
        guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else { return nil }
        let url = FileManager.default.temporaryDirectory.appending(path: "moment-call-\(UUID().uuidString).mov")
        try await export.export(to: url, as: .mov)
        return url
    }
}
