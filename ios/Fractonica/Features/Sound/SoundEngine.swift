import AVFoundation
import FractonicaKit
import Foundation
import MediaPlayer
import Observation

/// The sound of the clock: one `AVAudioEngine` whose source node runs `SoundRenderer`, driven from the main actor.
///
///     SoundEngine.shared.toggle()                 // the continuous sound: chord, bells, physical register
///     SoundEngine.shared.playMoment(at: t)        // a 3–4 s arpeggio of the chord of any instant, also while off
///     SoundEngine.shared.update { $0.reverb = 0.4 } // preferences: saved, and applied without a glitch
///
/// The engine follows `ClockStore`: a scheduler on the main actor (every 50 ms) plans the bells of the next 0.6 s of
/// displayed time (2.5 s in the background) from the store's rate, and every discontinuity of the clock (a jump, a rate
/// change, the catalogue edge) re-anchors the renderer, which glides each voice into its new phase and drops the bells
/// planned for the old timeline. Real-world audio rules: audio only starts from a user action (never at launch); on iOS
/// the session is `.playback` with background audio, interruptions pause and resume it, unplugging headphones stops it,
/// and the lock screen shows the minor clock with play / pause. macOS runs the same engine.
@MainActor @Observable
final class SoundEngine {
    static let shared = SoundEngine()

    /// What the user chose, saved under `sound.v1`.
    private(set) var preferences: SoundPreferences
    /// The continuous sound is on (what the user asked for).
    private(set) var isOn = false
    /// The audio hardware runs (the sound is on, or a moment is ringing).
    private(set) var isRunning = false
    /// The system took the audio away (a call, another app); it comes back when the system allows.
    private(set) var interrupted = false
    /// Why the audio could not start, if it could not.
    private(set) var failure: String?
    private(set) var sampleRate = 0.0
    /// The tempo lock while it holds (see `activeLock`).
    private(set) var lock: TempoLock?

    /// The lock, unless the speed was changed elsewhere since (it lets go at the next clock change it sees).
    var activeLock: TempoLock? {
        guard let lock, !store.isLive, store.rate == lock.rate else { return nil }
        return lock
    }
    /// The last "Hear this moment": when each of its notes starts, in real time.
    private(set) var moment: MomentPlay?

    /// A tempo lock: one cycle of `depth` lasts `seconds` of real time at `rate`.
    struct TempoLock: Equatable, Sendable {
        let depth: Int
        let seconds: Double
        let rate: Double
    }

    /// A moment being played: the displayed time it is the chord of, and its notes with their real start times.
    struct MomentPlay: Equatable, Sendable {
        let t: Double
        let start: Date
        let notes: [SoundPlanner.MomentNote]
        let end: Date
    }

    /// A bell planned to ring at a real instant, for the visuals.
    struct Flash: Sendable {
        let level: Int
        let at: Date
        let strength: Double
    }

    /// Bells planned recently (the visuals light them up as they ring).
    @ObservationIgnored private(set) var flashes: [Flash] = []

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var source: AVAudioSourceNode?
    @ObservationIgnored private var renderer: SoundRenderer?
    @ObservationIgnored private var scheduler: Task<Void, Never>?
    @ObservationIgnored private var stopTask: Task<Void, Never>?
    @ObservationIgnored private var idleTask: Task<Void, Never>?
    @ObservationIgnored private var highWater = 0.0
    @ObservationIgnored private var epoch: UInt32 = 1
    @ObservationIgnored private var revision = -1
    @ObservationIgnored private var anchoredAt = Date.distantPast
    @ObservationIgnored private var physicalSlots = SoundPhysicalSlots()
    @ObservationIgnored private var inBackground = false
    @ObservationIgnored private var resumeWhenActive = false
    @ObservationIgnored private var nowPlayingTitle = ""
    @ObservationIgnored private var nowPlayingCheckedAt = Date.distantPast
    @ObservationIgnored private var observers: [any NSObjectProtocol] = []
    @ObservationIgnored private var remoteCommandsReady = false
    @ObservationIgnored private var locking = false
    @ObservationIgnored private let store: ClockStore
    @ObservationIgnored private let defaults: UserDefaults
    /// Launch option `-FXSoundSilent 1`: compute and draw everything, send silence to the speakers.
    @ObservationIgnored private var silentOutput = false

    /// Seconds of displayed time planned ahead (in real seconds), in front and behind.
    private static let lookahead = 0.6
    private static let backgroundLookahead = 2.5
    /// The renderer is re-anchored this often without a jump, so the audio clock never drifts from the device clock.
    private static let reanchorInterval = 5.0

    init(store: ClockStore = .shared, defaults: UserDefaults = .standard) {
        self.store = store
        self.defaults = defaults
        preferences = SoundPreferences.load(from: defaults)
    }

    // MARK: Preferences

    /// Changes the preferences (validated and saved) and applies them to the sound at once.
    func update(_ change: (inout SoundPreferences) -> Void) {
        var next = preferences
        change(&next)
        next = next.sanitized()
        guard next != preferences else { return }
        let tempoChanged = next.tempoDepth != preferences.tempoDepth || next.tempoSeconds != preferences.tempoSeconds
        preferences = next
        next.save(to: defaults)
        apply()
        if tempoChanged, lock != nil { _ = lockTempo(words: nil) }
    }

    /// Sends the current preferences to the renderer. Only while the hardware runs: nothing drains the command ring
    /// of a stopped engine, and a ring filled by slider moves made while the sound is off would drop the very
    /// commands that start it again (`ensureRunning` sends the preferences whenever it starts the engine).
    private func apply() {
        guard isRunning, let renderer else { return }
        for voice in SoundPlanner.voices(preferences) { renderer.commands.push(.voice(voice)) }
        renderer.commands.push(.mix(SoundMixConfig(
            volume: Float(preferences.volumeGain),
            reverb: Float(preferences.reverb),
            chord: isOn && preferences.chord,
            chimes: isOn && preferences.chimes
        )))
        let wanted = SoundPlanner.physicalWanted(preferences, on: isOn)
        for change in physicalSlots.assign(wanted, now: Date.now.timeIntervalSinceReferenceDate) {
            renderer.commands.push(.physical(slot: Int32(change.slot), hz: change.hz, gain: Float(change.gain)))
        }
    }

    // MARK: On and off

    func toggle() {
        if interrupted {
            // the system took the audio and never gave it back (another app kept playing): a tap takes it back
            isOn = false
            interrupted = false
            start()
        } else if isOn {
            stop()
        } else {
            start()
        }
    }

    /// Starts the continuous sound (a user action: a button, the lock screen, a resumed interruption).
    func start() {
        guard !isOn else { return }
        stopTask?.cancel()
        stopTask = nil
        idleTask?.cancel()
        idleTask = nil
        guard ensureRunning() else { return }
        isOn = true
        interrupted = false
        apply()
        resync(blend: false)
        renderer?.commands.push(.fader(target: 1, seconds: 0.12))
        startScheduler()
        setUpRemoteCommands()
        updateNowPlaying(force: true)
    }

    /// Fades the continuous sound out in 0.1 s and releases the audio hardware (a ringing moment may finish first).
    func stop() {
        guard isOn else { return }
        isOn = false
        scheduler?.cancel()
        scheduler = nil
        apply()
        renderer?.commands.push(.fader(target: 0, seconds: 0.1))
        updateNowPlaying(force: true)
        stopTask?.cancel()
        stopTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled, let self, !self.isOn else { return }
            if let moment = self.moment, moment.end > .now {
                self.scheduleIdle(after: moment.end.timeIntervalSinceNow)
            } else {
                self.renderer?.commands.push(.flush)
                self.shutDown()
            }
        }
    }

    /// Plays the chord of displayed time `t` as a short arpeggio, α → the finest sounding voice. False outside the
    /// catalogue (or when the audio cannot start).
    @discardableResult
    func playMoment(at t: Double) -> Bool {
        let facts = FractonicaClockFacts.standard
        guard let notes = SoundPlanner.moment(at: t, prefs: preferences, clock: facts, position: { FractonicaClock.shared.position(at: $0) }) else {
            return false
        }
        stopTask?.cancel()
        stopTask = nil
        idleTask?.cancel()
        idleTask = nil
        // a moment while the sound is off plays over whatever else is playing instead of stopping it
        guard ensureRunning(exclusive: isOn), let renderer else { return false }
        if !isOn {
            // the fader may sit at 0 after a stop: bring it up before the first note
            renderer.commands.push(.flush)
            renderer.commands.push(.fader(target: 1, seconds: 0.02))
        }
        let lead = 0.06
        let host0 = renderer.host(mach_absolute_time(), plus: lead)
        for bell in SoundPlanner.momentBells(notes, prefs: preferences, host: { renderer.host(host0, plus: $0) }) {
            renderer.commands.push(.bell(bell))
        }
        let start = Date.now.addingTimeInterval(lead)
        let length = SoundPlanner.momentLength(notes)
        moment = MomentPlay(t: t, start: start, notes: notes, end: start.addingTimeInterval(length))
        if !isOn { scheduleIdle(after: lead + length) }
        return true
    }

    /// Releases the hardware once a moment has rung out while the sound is off.
    private func scheduleIdle(after seconds: Double) {
        idleTask?.cancel()
        idleTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, seconds) + 0.3))
            guard !Task.isCancelled, let self, !self.isOn else { return }
            self.renderer?.commands.push(.fader(target: 0, seconds: 0.05))
            try? await Task.sleep(for: .milliseconds(80))
            guard !Task.isCancelled, !self.isOn else { return }
            self.renderer?.commands.push(.flush)
            self.shutDown()
        }
    }

    // MARK: The clock

    /// Call when the clock's revision changed: the tempo lock lets go when the speed was changed elsewhere, and a
    /// running sound re-anchors at once.
    func clockChanged() {
        releaseLockIfMoved()
        if isOn, store.revision != revision { tick() }
    }

    private func releaseLockIfMoved() {
        if let lock, !locking, store.isLive || store.rate != lock.rate {
            self.lock = nil
        }
    }

    /// Makes one cycle of the tempo depth last the tempo length (in pure mode the Blinks shown), and holds it.
    /// Returns the toast to show.
    @discardableResult
    func lockTempo(words: SoundWords?) -> String? {
        let w = words ?? SoundWords(AppSettings.shared.wording)
        let seconds = w.tempoSeconds(w.tempoValue(preferences.tempoSeconds))
        let rate = SoundSchedule.tempoRate(depth: preferences.tempoDepth, seconds: seconds)
        locking = true
        store.setRate(rate)
        locking = false
        lock = TempoLock(depth: preferences.tempoDepth, seconds: seconds, rate: store.rate)
        if isOn { tick() }
        return words.map { $0.lockToast(depth: preferences.tempoDepth, seconds: seconds, rate: rate) }
    }

    /// Lets go of the tempo lock (the speed stays). Returns the toast to show.
    func unlockTempo(words: SoundWords) -> String? {
        guard let lock else { return nil }
        self.lock = nil
        return words.unlockToast(rate: lock.rate)
    }

    // MARK: Lifecycle (SoundHooks)

    func enteredBackground() {
        inBackground = true
        #if os(iOS)
        if isOn && !preferences.backgroundPlay {
            resumeWhenActive = true
            stop()
        }
        #endif
    }

    func becameActive() {
        inBackground = false
        if resumeWhenActive {
            resumeWhenActive = false
            start()
        }
    }

    /// Test hooks for screenshots: `-FXSoundSilent 1` keeps the speakers silent, `-FXSoundDemo 1` starts the (silent)
    /// sound at launch so the screen shows it playing, `-FXSoundPhysical 1` turns the physical register on for the
    /// launch (unsaved), `-FXSoundLock 1` locks the tempo, `-FXSoundMoment <seconds>` plays the moment (silently) that
    /// long after launch.
    func applyLaunchOptions(_ defaults: UserDefaults = .standard) {
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func flag(_ key: String) -> Bool { ["1", "yes", "true"].contains(((args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue ?? "").lowercased()) }
        silentOutput = flag("FXSoundSilent") || flag("FXSoundDemo")
        if flag("FXSoundPhysical") { preferences.physical = true } // for this launch only, never saved
        if flag("FXSoundDemo") { start() }
        if flag("FXSoundLock") { lockTempo(words: nil) }
        // `-FXSoundMoment <seconds>`: "Hear this moment" that long after launch (silent unless asked otherwise)
        if let delay = ((args["FXSoundMoment"] as? String) ?? (args["FXSoundMoment"] as? NSNumber)?.stringValue).flatMap(Double.init) {
            silentOutput = true
            Task {
                try? await Task.sleep(for: .seconds(delay))
                self.playMoment(at: self.store.time())
            }
        }
    }

    // MARK: The scope

    /// Copies the latest output samples (mono) for the spectrum; false while nothing has been rendered.
    func copyOutput(into buffer: UnsafeMutablePointer<Float>, count: Int) -> Bool {
        guard isRunning, let renderer else { return false }
        return renderer.scope.copyLatest(into: buffer, count: count)
    }

    /// Bells ringing right now.
    var soundingBells: Int { renderer?.soundingBells.load(ordering: .relaxed) ?? 0 }

    /// Voices of the chord that sound.
    var voiceCount: Int {
        guard isOn else { return 0 }
        let chord = preferences.chord ? preferences.soundingLevels.count : 0
        let physical = preferences.physical ? SoundTuning.physicalLevels(shift: preferences.physShift).count : 0
        return chord + physical
    }

    // MARK: Scheduling

    private func startScheduler() {
        scheduler?.cancel()
        scheduler = Task { [weak self] in
            while !Task.isCancelled {
                self?.tick()
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
    }

    /// Plans the bells of the next stretch of displayed time and keeps the renderer anchored to the clock.
    private func tick() {
        guard isOn, let renderer else { return }
        let now = Date.now
        if store.revision != revision {
            releaseLockIfMoved()
            resync(blend: true)
        } else if now.timeIntervalSince(anchoredAt) >= Self.reanchorInterval {
            anchor(at: now, newEpoch: false, blend: false)
        }
        let rate = store.rate
        let horizon = store.time(at: now.addingTimeInterval(inBackground ? Self.backgroundLookahead : Self.lookahead))
        defer { highWater = horizon }
        if rate != 0, preferences.chimes {
            let levels = preferences.soundingLevels
            let events = rate > 0
                ? SoundSchedule.events(from: highWater, to: horizon, levels: levels, rate: rate, floor: preferences.floor)
                : SoundSchedule.events(from: horizon, to: highWater, levels: levels, rate: rate, floor: preferences.floor).reversed()
            let base = store.base
            for event in events {
                for bell in SoundPlanner.bells(for: event, prefs: preferences, rate: rate, epoch: epoch) {
                    renderer.commands.push(.bell(bell))
                    let real = base.real0 + (bell.t - base.t0) / base.rate
                    flashes.append(Flash(level: Int(bell.level), at: Date(timeIntervalSince1970: real), strength: event.strength))
                }
            }
        }
        if flashes.count > 96 || flashes.first.map({ now.timeIntervalSince($0.at) > 3 }) == true {
            flashes.removeAll { now.timeIntervalSince($0.at) > 3 }
        }
        if now.timeIntervalSince(nowPlayingCheckedAt) >= 1 { updateNowPlaying(force: false) }
    }

    /// A discontinuity of the clock: a new timeline (the bells of the old one are dropped) the voices glide into.
    private func resync(blend: Bool) {
        revision = store.revision
        anchor(at: .now, newEpoch: true, blend: blend)
        flashes.removeAll()
        updateNowPlaying(force: true)
    }

    private func anchor(at now: Date, newEpoch: Bool, blend: Bool) {
        guard let renderer else { return }
        if newEpoch { epoch &+= 1 }
        let host = mach_absolute_time()
        let t0 = store.time(at: now)
        renderer.commands.push(.anchor(t0: t0, rate: store.rate, host: host, epoch: epoch, blend: blend))
        anchoredAt = now
        if newEpoch { highWater = t0 }
    }

    // MARK: The audio hardware

    /// Builds the graph if needed, activates the session and runs the engine. False (with `failure`) when it cannot.
    /// `exclusive`: the continuous sound takes the audio over (other apps pause, the lock screen shows it); a moment
    /// heard while the sound is off mixes with them.
    private func ensureRunning(exclusive: Bool = true) -> Bool {
        do {
            #if os(iOS)
            let session = AVAudioSession.sharedInstance()
            let options: AVAudioSession.CategoryOptions = exclusive ? [] : [.mixWithOthers]
            if session.category != .playback || session.categoryOptions != options {
                try session.setCategory(.playback, mode: .default, options: options)
            }
            try session.setActive(true)
            #endif
            if engine == nil { try buildGraph() }
            guard let engine else { return false }
            let starting = !engine.isRunning || !isRunning
            if !engine.isRunning {
                engine.prepare()
                try engine.start()
            }
            observe()
            isRunning = true
            failure = nil
            if starting { apply() }
            return true
        } catch {
            failure = error.localizedDescription
            isRunning = false
            return false
        }
    }

    private func buildGraph() throws {
        let engine = AVAudioEngine()
        let hardware = engine.outputNode.outputFormat(forBus: 0)
        let rate = hardware.sampleRate > 0 ? hardware.sampleRate : 48000
        guard let format = AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2) else {
            throw CocoaError(.featureUnsupported)
        }
        let renderer = SoundRenderer(sampleRate: rate)
        let node = AVAudioSourceNode(format: format, renderBlock: Self.renderBlock(renderer))
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 1
        self.engine = engine
        self.renderer = renderer
        source = node
        sampleRate = rate
        physicalSlots = SoundPhysicalSlots()
        if silentOutput { renderer.commands.push(.silentOutput(true)) }
        apply()
        let changed = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { _ in
            MainActor.assumeIsolated { SoundEngine.shared.configurationChanged() }
        }
        observers.append(changed)
    }

    /// The render callback, made outside the main actor: it runs on the audio thread and only calls the renderer.
    private nonisolated static func renderBlock(_ renderer: SoundRenderer) -> AVAudioSourceNodeRenderBlock {
        { _, timestamp, frameCount, data in
            let buffers = UnsafeMutableAudioBufferListPointer(data)
            guard buffers.count > 0, let left = buffers[0].mData?.assumingMemoryBound(to: Float.self) else { return noErr }
            let right = buffers.count > 1 ? buffers[1].mData?.assumingMemoryBound(to: Float.self) ?? left : left
            let stamp = timestamp.pointee
            let host = stamp.mFlags.contains(.hostTimeValid) ? stamp.mHostTime : 0
            renderer.render(frameCount: Int(frameCount), left: left, right: right, hostTime: host)
            return noErr
        }
    }

    /// Stops the engine and gives the audio session back.
    private func shutDown() {
        engine?.stop()
        isRunning = false
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    /// The output device or its format changed (macOS: another device; iOS: a new route at another rate): rebuild the
    /// graph at the new rate and carry on.
    private func configurationChanged() {
        let wasRunning = isRunning
        tearDown()
        guard wasRunning, isOn else { return }
        isOn = false
        start()
    }

    private func tearDown() {
        engine?.stop()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
        engine = nil
        source = nil
        renderer = nil
        isRunning = false
        sessionObserversReady = false
    }

    // MARK: The audio session (iOS)

    @ObservationIgnored private var sessionObserversReady = false

    private func observe() {
        #if os(iOS)
        guard !sessionObserversReady else { return }
        sessionObserversReady = true
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { note in
            let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            let options = AVAudioSession.InterruptionOptions(rawValue: (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
            MainActor.assumeIsolated { SoundEngine.shared.interruption(type, options: options) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { note in
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt).flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
            MainActor.assumeIsolated { SoundEngine.shared.routeChanged(reason) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: .main) { _ in
            MainActor.assumeIsolated { SoundEngine.shared.mediaServicesReset() }
        })
        #endif
    }

    #if os(iOS)
    private func interruption(_ type: AVAudioSession.InterruptionType?, options: AVAudioSession.InterruptionOptions) {
        switch type {
        case .began:
            guard isOn else { return }
            interrupted = true
            // the system stopped the engine: nothing renders (or drains commands) until it is started again
            isRunning = false
            scheduler?.cancel()
            scheduler = nil
        case .ended:
            guard interrupted else { return }
            interrupted = false
            if options.contains(.shouldResume), isOn {
                isOn = false
                start()
            } else {
                isOn = false
                renderer?.commands.push(.fader(target: 0, seconds: 0.01))
                renderer?.commands.push(.flush)
                shutDown()
                updateNowPlaying(force: true)
            }
        default:
            break
        }
    }

    /// Headphones unplugged: stop, as every audio app does.
    private func routeChanged(_ reason: AVAudioSession.RouteChangeReason?) {
        if reason == .oldDeviceUnavailable, isOn { stop() }
    }

    private func mediaServicesReset() {
        let wasOn = isOn
        tearDown()
        isOn = false
        if wasOn { start() }
    }
    #endif

    // MARK: Now Playing and remote control

    /// The lock screen and Control Center: the minor clock ("34η 29ι") over the short date, with play / pause.
    private func updateNowPlaying(force: Bool) {
        nowPlayingCheckedAt = .now
        let center = MPNowPlayingInfoCenter.default()
        guard isOn else {
            if force {
                center.playbackState = .paused
                if var info = center.nowPlayingInfo {
                    info[MPNowPlayingInfoPropertyPlaybackRate] = 0.0
                    center.nowPlayingInfo = info
                }
            }
            return
        }
        let settings = AppSettings.shared
        let notation = Notation.standard
        let t = store.time()
        let title = notation.clockText(at: t, upTo: "iota")
        guard force || title != nowPlayingTitle else { return }
        nowPlayingTitle = title
        let detail = settings.pure ? notation.dateText(at: t, upTo: "epsilon") : settings.wording.date(t)
        center.nowPlayingInfo = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: detail,
            MPMediaItemPropertyAlbumTitle: "Fractonica",
            MPNowPlayingInfoPropertyIsLiveStream: true,
            MPNowPlayingInfoPropertyPlaybackRate: 1.0,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
        ]
        center.playbackState = .playing
    }

    private func setUpRemoteCommands() {
        guard !remoteCommandsReady else { return }
        remoteCommandsReady = true
        Self.registerRemoteCommands()
    }

    /// Play, pause and toggle from the lock screen, Control Center, headphones and the Mac's media keys. The handlers
    /// are made outside the main actor (MediaPlayer calls them on its own terms) and hop to it.
    private nonisolated static func registerRemoteCommands() {
        let commands = MPRemoteCommandCenter.shared()
        commands.playCommand.addTarget { _ in
            Task { @MainActor in SoundEngine.shared.start() }
            return .success
        }
        commands.pauseCommand.addTarget { _ in
            Task { @MainActor in SoundEngine.shared.stop() }
            return .success
        }
        commands.togglePlayPauseCommand.addTarget { _ in
            Task { @MainActor in SoundEngine.shared.toggle() }
            return .success
        }
        for unused in [commands.nextTrackCommand, commands.previousTrackCommand, commands.skipForwardCommand,
                       commands.skipBackwardCommand, commands.changePlaybackPositionCommand] {
            unused.isEnabled = false
        }
    }
}
