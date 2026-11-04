@preconcurrency import AVFoundation
import FractonicaKit
import Foundation
import Observation
import SwiftUI
#if os(iOS)
import AudioToolbox
import UIKit
#endif

/// A moment's call: it rings from 2 Flavons before the moment for 11 Flavons (the ringtone looping, a buzz each ring),
/// the cameras running from the first ring so whatever is chosen starts at once:
///
/// - **Answered** (slide to answer, or the alarm's Answer): both cameras film until hung up, into the moment's reel —
///   the instant view (`InstantModel`, `.answered`) takes the call's place and its cameras.
/// - **Muted**: both cameras film, the screen dark, until a Flavon after the moment (`.muted`).
/// - **Declined** (or the alarm's Stop): each camera's photo at the press (`front`, `back`), titled Declined; then the
///   app leaves the screen, as a declined call does.
/// - **Rung out**: a missed call — on the iPhone an entry titled Missed, 🔴 (`MomentStore.recordMissed`) — and the
///   call screen goes.
///
/// Every entry is on the moment's time with its `capture` and how the call went (`MomentOutcome`). `finished` says when
/// the call's screen is done after a decline or a missed call (the instant view says it for the others).
@MainActor @Observable
final class MomentCallModel {
    enum Phase: Equatable {
        case ringing
        /// Answered or muted: the instant view filming both cameras.
        case filming
        /// Declined or rung out: the entry being written, then written.
        case ended(MomentOutcome)
    }

    let moment: Moment
    let demo: Bool
    /// The call's emoji, any of them (as a contact's picture): on its screen, then the entry's.
    let emoji: String
    /// The first ring and when it rings out (Unix seconds).
    let ringStart: Double
    let ringEnd: Double
    let camera = MomentCamera()
    private(set) var phase = Phase.ringing
    private(set) var saving = false
    /// What went amiss saving.
    private(set) var trouble: String?
    /// The answered or muted call's instant view.
    private(set) var instant: InstantModel?
    /// The call is over and its entry written (or it was missed): the screen goes.
    private(set) var finished: MomentOutcome?

    @ObservationIgnored private let start: CallStart
    @ObservationIgnored private var opened = false
    @ObservationIgnored private var timeout: Task<Void, Never>?

    init(request: InstantRequest) {
        moment = request.moment
        demo = request.demo
        start = request.start
        emoji = request.emoji ?? JournalLaunch.string("FXJournalEmojiPick") ?? EmojiCatalog.random()
        let flavon = FractonicaClock.shared.levelInfo(10).meanSeconds
        if request.demo {
            // a made-up moment: its call rings the lead's mean Flavons before it
            ringStart = moment.time - Double(MomentCalendar.leadFlavons) * flavon
            ringEnd = ringStart + Double(MomentCalendar.ringFlavons) * flavon
        } else {
            let calendar = MomentStore.shared.calendar
            ringStart = calendar.promptTime(of: moment)
            ringEnd = calendar.ringEnd(of: moment)
        }
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

    /// Closing the screen: one ringing just stops (it may still be written missed); one filming is hung up by its view.
    func close() {
        timeout?.cancel()
        MomentRinger.shared.stop()
        keepAwake(false)
        switch phase {
        case .ringing: camera.stop()
        case .filming: break
        case .ended: if !saving { camera.stop() }
        }
    }

    // MARK: Choices

    /// Slide to answer: both cameras film until hung up, into the reel.
    func answer() {
        pickUp(.answered)
    }

    /// Mute: both cameras film, the screen dark, until a Flavon after the moment.
    func mute() {
        pickUp(.muted)
    }

    private func pickUp(_ mode: InstantModel.Mode) {
        guard phase == .ringing else { return }
        stopRinging()
        MomentStore.shared.callPicked(moment, mode == .answered ? .answered : .muted, demo: demo)
        Haptics.play(.selection)
        instant = InstantModel(request: InstantRequest(moment: moment, demo: demo, emoji: emoji), mode: mode, camera: camera)
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
            _ = await MomentStore.shared.recordMissed(moment, demo: demo)
            saving = false
            finished = .missed
        }
    }

    private func stopRinging() {
        timeout?.cancel()
        MomentRinger.shared.stop()
    }

    /// `-FXMomentsPick`: the choice made by itself, 2 s into the ringing (an answered call hung up 8 s later).
    private func autoPick(_ pick: String) {
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            switch pick {
            case "answer":
                self?.answer()
                try? await Task.sleep(for: .seconds(8))
                self?.instant?.hangUp()
            case "mute": self?.mute()
            case "decline": self?.decline()
            default: break
            }
        }
    }

    // MARK: Saving

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
        do {
            _ = try await MomentSaver.save(moment: moment, emoji: emoji, text: "", media: media, outcome: .declined)
            Haptics.play(.success)
            finished = .declined
        } catch {
            trouble = error.localizedDescription
            momentsLog.error("could not save the declined call: \(error.localizedDescription)")
        }
    }

    /// The screen stays on through the call (locking it would stop the cameras).
    private func keepAwake(_ on: Bool) {
        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = on
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
        MomentCamera.prepareAudio(recording: MomentCamera.mayRecordSound)
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
