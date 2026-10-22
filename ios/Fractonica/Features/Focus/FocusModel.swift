import FractonicaKit
import Foundation
import Observation

/// The four pictures of Focus. Each draws every level as a harmonic in its own hue (`Theme.levelColor`): slow levels
/// drift the palette and the geometry, fast ones shimmer, boundaries ripple.
enum FocusStyle: String, CaseIterable, Identifiable, Sendable {
    /// Radial and angular waves from drifting sources, one per level, and the nodal lines where they cancel.
    case interference
    /// A harmonograph: damped pendulums tuned by the levels, drawn as one glowing trail.
    case harmonograph
    /// Nested rings, one per level, each breathing with its own wave and carrying its phase as a comet.
    case rings
    /// Aurora curtains, one per level, swaying with the faster levels and drifting with the slower ones.
    case aurora

    var id: String { rawValue }

    var title: String {
        switch self {
        case .interference: "Interference"
        case .harmonograph: "Harmonograph"
        case .rings: "Rings"
        case .aurora: "Aurora"
        }
    }

    var systemImage: String {
        switch self {
        case .interference: "circle.hexagongrid"
        case .harmonograph: "scribble.variable"
        case .rings: "target"
        case .aurora: "wind"
        }
    }

    /// The style's number in the shaders.
    var shaderIndex: Int {
        switch self {
        case .interference: 0
        case .harmonograph: 1
        case .rings: 2
        case .aurora: 3
        }
    }

    /// The next style (`step` 1) or the previous one (−1), wrapping around.
    func advanced(by step: Int) -> FocusStyle {
        let all = Self.allCases
        let i = all.firstIndex(of: self) ?? 0
        return all[((i + step) % all.count + all.count) % all.count]
    }
}

/// How long a Focus session lasts, in clock units: one Preon, four Preons, one Helion, or open-ended.
enum FocusLength: String, CaseIterable, Identifiable, Sendable {
    case preon, fourPreons, helion, open

    var id: String { rawValue }

    /// "1ι", "4ι", "1η", "Open" (the same in both modes).
    var title: String {
        switch self {
        case .preon: "1ι"
        case .fourPreons: "4ι"
        case .helion: "1η"
        case .open: "Open"
        }
    }

    /// "1 Preon", "4 Preons", "1 Helion", "Open-ended".
    var name: String {
        switch self {
        case .preon: "1 Preon"
        case .fourPreons: "4 Preons"
        case .helion: "1 Helion"
        case .open: "Open-ended"
        }
    }

    /// The level whose cycles measure the session, and how many of them.
    var unit: (level: Int, count: Int)? {
        switch self {
        case .preon: (8, 1)
        case .fourPreons: (8, 4)
        case .helion: (6, 1)
        case .open: nil
        }
    }

    /// The session's length in device seconds, starting at the real instant `real`: the count times the length of the
    /// unit's cycle running at that instant (cycles vary slightly between Saros intervals), or the unit's mean length
    /// outside the catalogue. Nil for an open session.
    func seconds(startingAt real: Double, clock: FractonicaClock = .shared) -> Double? {
        guard let unit else { return nil }
        let cycle = clock.level(at: real, unit.level)?.duration ?? clock.levelInfo(unit.level).meanSeconds
        return Double(unit.count) * cycle
    }
}

/// A Focus session, on the device clock (Unix seconds of real time, never the displayed time).
struct FocusSession: Sendable, Equatable {
    var length: FocusLength
    var start: Double
    /// Nil for an open session.
    var end: Double?

    init(length: FocusLength, start: Double, clock: FractonicaClock = .shared) {
        self.length = length
        self.start = start
        end = length.seconds(startingAt: start, clock: clock).map { start + $0 }
    }

    func elapsed(at now: Double) -> Double { max(0, now - start) }

    /// Seconds left, nil for an open session.
    func remaining(at now: Double) -> Double? { end.map { max(0, $0 - now) } }

    func isComplete(at now: Double) -> Bool { end.map { now >= $0 } ?? false }

    /// 0 … 1 through the session (0 for an open one).
    func progress(at now: Double) -> Double {
        guard let end, end > start else { return 0 }
        return min(1, max(0, (now - start) / (end - start)))
    }
}

/// Focus mode's preferences and its running session. One per app: the full-screen Focus and the Focus screen of the
/// iPad and Mac sidebar share it. Preferences persist under `focus.` keys; the session lives while a Focus view is
/// on screen.
@MainActor @Observable
final class FocusModel {
    static let shared = FocusModel()

    var style: FocusStyle {
        didSet { if persisting { defaults.set(style.rawValue, forKey: Keys.style) } }
    }
    var length: FocusLength {
        didSet { if persisting { defaults.set(length.rawValue, forKey: Keys.length) } }
    }
    /// The breathing cue on the Flavon.
    var breathing: Bool {
        didSet { if persisting { defaults.set(breathing, forKey: Keys.breathing) } }
    }

    /// The running session, if a Focus view is showing.
    private(set) var session: FocusSession?
    /// The real instant the last timed session completed, until a new one starts.
    private(set) var completed: FocusSession?

    /// Called when a timed session reaches its end while the app runs (the chime and haptic): `late` is true when the
    /// app learns of it well after the fact (it was suspended), which calls for no sound.
    @ObservationIgnored var onComplete: (@MainActor (_ session: FocusSession, _ late: Bool) -> Void)?
    /// The device clock, for checks.
    @ObservationIgnored var now: @MainActor () -> Double = { Date.now.timeIntervalSince1970 }

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var viewers = 0
    @ObservationIgnored private var persisting = true
    @ObservationIgnored private var endTask: Task<Void, Never>?
    /// The session the last Focus view left, and when.
    @ObservationIgnored private var handedOver: (session: FocusSession, completed: FocusSession?, at: Double)?

    /// A Focus view appearing within this many seconds of the last one leaving carries on its session.
    static let handOver = 1.0

    /// A completion noticed this long after the end is late.
    static let lateAfter = 5.0

    enum Keys {
        static let style = "focus.style"
        static let length = "focus.length"
        static let breathing = "focus.breathing"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        style = defaults.string(forKey: Keys.style).flatMap(FocusStyle.init(rawValue:)) ?? .interference
        length = defaults.string(forKey: Keys.length).flatMap(FocusLength.init(rawValue:)) ?? .fourPreons
        breathing = defaults.object(forKey: Keys.breathing) as? Bool ?? true
    }

    /// Choices for this launch only (launch arguments), not saved.
    func applyForThisLaunch(style: FocusStyle?, length: FocusLength?) {
        persisting = false
        if let style { self.style = style }
        if let length { self.length = length }
        persisting = true
    }

    // MARK: Viewers

    /// A Focus view appeared: the first one starts a session, or takes over the one a Focus view left a moment ago
    /// (iPad: the sidebar's Focus and the full-screen one hand over as the cover comes and goes, in either order).
    func attach() {
        viewers += 1
        guard viewers == 1, session == nil else { return }
        if let left = handedOver, now() - left.at < Self.handOver {
            session = left.session
            completed = left.completed
            handedOver = nil
            schedule(left.session)
        } else {
            start()
        }
    }

    /// A Focus view went away: the last one ends the session.
    func detach() {
        viewers = max(0, viewers - 1)
        if viewers == 0 { stop() }
    }

    var isShowing: Bool { viewers > 0 }

    // MARK: Sessions

    /// Starts a new session of the chosen length now (replacing any running one).
    func start(elapsed: Double = 0) {
        handedOver = nil
        let made = FocusSession(length: length, start: now() - max(0, elapsed))
        session = made
        completed = nil
        schedule(made)
    }

    /// Chooses a length and starts a session of it.
    func choose(_ newLength: FocusLength) {
        length = newLength
        start()
    }

    /// Ends the session without completing it.
    func stop() {
        if let session { handedOver = (session, completed, now()) }
        endTask?.cancel()
        endTask = nil
        session = nil
    }

    /// Checks the running session against the device clock (after the app returns to the front, say).
    func refresh() {
        guard let session, session.isComplete(at: now()) else { return }
        finish(session)
    }

    private func schedule(_ session: FocusSession) {
        endTask?.cancel()
        endTask = nil
        guard let end = session.end else { return }
        let delay = max(0, end - now())
        endTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.refresh()
        }
        if delay == 0 { refresh() }
    }

    /// A timed session reached its end: it completes, and Focus carries on as an open session from that moment.
    private func finish(_ ended: FocusSession) {
        guard let end = ended.end else { return }
        endTask?.cancel()
        endTask = nil
        let late = now() - end > Self.lateAfter
        completed = ended
        var open = FocusSession(length: .open, start: end)
        open.end = nil
        session = open
        onComplete?(ended, late)
    }
}

/// Spans of a session as Focus shows them.
enum FocusText {
    /// "8:24", "1:02:13" (Earth, whole seconds rounded up so "0:00" means done) · pure "6ι 43λ" (the ladder around
    /// `t`, SPEC §15.4).
    static func span(_ seconds: Double, pure: Bool, at t: Double, notation: Notation = .standard) -> String {
        let s = max(0, seconds.isFinite ? seconds : 0)
        if pure { return notation.duration(s, parts: 2, at: t) }
        let whole = Int(s.rounded(.up))
        let h = whole / 3600, m = (whole % 3600) / 60, sec = whole % 60
        let mm = h > 0 ? String(format: "%02d", m) : String(m)
        let ss = String(format: "%02d", sec)
        return h > 0 ? "\(h):\(mm):\(ss)" : "\(mm):\(ss)"
    }

    /// Earth mode's hint of a length: "≈ 8 min", "≈ 34 min", "≈ 5 h 3 min"; nil in pure mode or for an open session.
    static func approximate(_ length: FocusLength, pure: Bool, at real: Double, clock: FractonicaClock = .shared) -> String? {
        guard !pure, let seconds = length.seconds(startingAt: real, clock: clock) else { return nil }
        return "≈ " + EarthTime.duration(seconds)
    }
}
