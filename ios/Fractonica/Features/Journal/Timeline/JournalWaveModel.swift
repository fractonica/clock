import FractonicaKit
import Observation
import SwiftUI

/// The wave's view state and input: which stretch of time it shows (`JournalWaveFrame`), how that is moving (an eased
/// zoom, a flick coasting to a stop), and what taps on it do. One for the app, so the wave keeps its place between
/// visits; its zoom is remembered (`JournalBrowsing.waveScale`).
///
/// Motion is a pure function of the real instant: `frame(at:)` computes the frame for any display frame without writing
/// anything, so drawing never changes state; state changes on input and when a motion ends.
@MainActor @Observable
final class JournalWaveModel {
    static let shared = JournalWaveModel()

    enum Motion: Equatable {
        /// An eased move between two frames, the moment at height `anchorY` gliding between them.
        case tween(from: JournalWaveFrame, to: JournalWaveFrame, anchorY: Double, start: Date, duration: Double)
        /// A flick coasting to a stop: the content's velocity in points per second, decaying with time constant `tau`.
        case coast(from: JournalWaveFrame, v: Double, start: Date, tau: Double, duration: Double)
    }

    /// The frame when nothing moves (and where any motion starts).
    private(set) var base = JournalWaveFrame(top: Date.now.timeIntervalSince1970, k: 0.004)
    private(set) var motion: Motion?
    /// The entries on the wave, newest first.
    private(set) var pins: [JournalWavePin] = []
    /// Every symbol the pins use (Canvas symbols are made once per symbol).
    private(set) var symbols: [String] = []
    /// A cluster whose entries share their moment too closely to zoom apart: the screen offers them as a list.
    var chooser: JournalWaveChoice?

    /// The canvas's size (set by the view).
    @ObservationIgnored private(set) var size = CGSize(width: 390, height: 700)
    @ObservationIgnored private(set) var limits = JournalWaveLimits(height: 700, newest: Date.now.timeIntervalSince1970, oldest: Date.now.timeIntervalSince1970)
    @ObservationIgnored var reduceMotion = false
    /// Opens an entry (set by the screen).
    @ObservationIgnored var open: ((String) -> Void)?
    /// What the last drawn frame placed, for taps.
    @ObservationIgnored let hits = JournalWaveHits()
    @ObservationIgnored private var placed = false
    @ObservationIgnored private var pendingReveal: (start: Double, end: Double?)?
    @ObservationIgnored private var gestureStart: JournalWaveFrame?
    @ObservationIgnored private var pinchAnchor: Double?
    @ObservationIgnored private var pinching = false
    @ObservationIgnored private var settleTask: Task<Void, Never>?
    @ObservationIgnored private let clock = FractonicaClock.shared

    var isMoving: Bool { motion != nil }

    // MARK: Badges

    static let badge = 36.0
    static let badgeGap = 4.0

    // MARK: Data

    /// Takes the timeline's records (newest first) as pins.
    func setRecords(_ records: [HubRecord]) {
        var pins: [JournalWavePin] = []
        pins.reserveCapacity(records.count)
        var seen = Set<String>()
        var symbols: [String] = []
        for r in records {
            let symbol = Self.symbol(for: r)
            pins.append(JournalWavePin(id: r.id, time: r.time, symbol: symbol))
            if seen.insert(symbol).inserted { symbols.append(symbol) }
        }
        self.pins = pins.sorted { $0.time > $1.time }
        if symbols != self.symbols { self.symbols = symbols }
        updateLimits()
    }

    /// "e:🌙" for an emoji, "s:waveform" for a stand-in symbol.
    static func symbol(for record: HubRecord) -> String {
        if let entry = record.entry {
            if let emoji = entry.emoji, !emoji.isEmpty { return "e:" + emoji }
            return "s:" + JournalText(entry: entry, media: record.mediaBlobs).symbol
        }
        if let emoji = record.generic.emoji, !emoji.isEmpty { return "e:" + emoji }
        return "s:tray"
    }

    /// The pins between two moments (inclusive), newest first.
    func pins(from t0: Double, to t1: Double) -> ArraySlice<JournalWavePin> {
        // pins are newest first: find the first at or before t1, then run while at or after t0
        var lo = 0, hi = pins.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if pins[mid].time > t1 { lo = mid + 1 } else { hi = mid }
        }
        var end = lo
        while end < pins.count, pins[end].time >= t0 { end += 1 }
        return pins[lo..<end]
    }

    // MARK: Size and placing

    func resize(_ size: CGSize) {
        guard size.width > 10, size.height > 10, size != self.size else { return }
        let old = self.size
        self.size = size
        updateLimits()
        if !placed {
            placeInitially()
        } else {
            // keep the middle where it was
            let mid = base.t(old.height / 2)
            set(JournalWaveFrame(top: mid + size.height / 2 / base.k, k: base.k))
        }
        revealIfPending()
    }

    private func updateLimits() {
        let now = Date.now.timeIntervalSince1970
        let newest = max(now, pins.first?.time ?? now)
        let oldest = min(now, pins.last?.time ?? now)
        limits = JournalWaveLimits(height: size.height, newest: newest, oldest: oldest, clock: clock)
        if placed, motion == nil { base = limits.clamp(base, height: size.height) }
    }

    /// The first frame: where the launch arguments say, or the newest moment near the top at the remembered zoom
    /// (about one and a half ζ cycles, three days with their Helions, the first time).
    private func placeInitially() {
        placed = true
        let browsing = JournalBrowsing.shared
        let h = size.height
        let k = 1000 / (browsing.waveScale ?? clock.levelInfo(5).meanSeconds * 1.5 / h * 1000)
        if let at = browsing.waveAt {
            base = limits.frame(showing: at, atY: h / 2, k: k, height: h)
        } else {
            base = limits.frame(showing: limits.newest, atY: h * 0.12, k: k, height: h)
        }
    }

    /// Show a stretch of time when the wave next has a size (now, if it has one): [start, end] fitted, or a moment in
    /// the middle at the current zoom.
    func reveal(_ start: Double, _ end: Double? = nil) {
        pendingReveal = (start, end)
        if placed { revealIfPending() }
    }

    private func revealIfPending() {
        guard let r = pendingReveal, placed else { return }
        pendingReveal = nil
        if let end = r.end {
            fit(r.start, end, animated: false)
        } else {
            set(limits.frame(showing: r.start, atY: size.height / 2, k: base.k, height: size.height))
        }
    }

    // MARK: Reading

    /// The frame to draw at real instant `date`.
    func frame(at date: Date) -> JournalWaveFrame {
        switch motion {
        case .tween(let from, let to, let anchorY, let start, let duration)?:
            let u = date.timeIntervalSince(start) / duration
            guard u < 1 else { return to }
            let e = 1 - pow(1 - max(0, u), 3)
            let k = exp(log(from.k) + (log(to.k) - log(from.k)) * e)
            let ta = from.t(anchorY) + (to.t(anchorY) - from.t(anchorY)) * e
            return JournalWaveFrame(top: ta + anchorY / k, k: k)
        case .coast(let from, let v, let start, let tau, _)?:
            let t = date.timeIntervalSince(start)
            return limits.pan(from, by: v * tau * (1 - exp(-t / tau)), height: size.height)
        case nil:
            return base
        }
    }

    /// Where the frame is heading (the end of a motion).
    private var goal: JournalWaveFrame {
        switch motion {
        case .tween(_, let to, _, _, _)?: to
        case .coast(_, _, _, _, let duration)?: frame(at: .now.addingTimeInterval(duration))
        case nil: base
        }
    }

    // MARK: Moving

    /// Jump (cancels any motion).
    func set(_ f: JournalWaveFrame) {
        cancelMotion()
        base = limits.clamp(f, height: size.height)
    }

    private func cancelMotion() {
        settleTask?.cancel()
        settleTask = nil
        motion = nil
    }

    /// Freeze any motion where it is now (before the user takes over).
    private func commit() {
        guard motion != nil else { return }
        let f = frame(at: .now)
        cancelMotion()
        base = f
    }

    /// Glide to `target` (at once under Reduce Motion), the moment at height `anchorY` gliding.
    func animate(to target: JournalWaveFrame, anchorY: Double? = nil, duration: Double = 0.38) {
        let to = limits.clamp(target, height: size.height)
        let from = frame(at: .now)
        cancelMotion()
        guard !reduceMotion, duration > 0, from != to else {
            base = to
            remember()
            return
        }
        base = from
        motion = .tween(from: from, to: to, anchorY: anchorY ?? size.height / 2, start: .now, duration: duration)
        settle(after: duration, to: to)
    }

    private func settle(after seconds: Double, to end: JournalWaveFrame) {
        settleTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, let self else { return }
            self.base = end
            self.motion = nil
            self.settleTask = nil
            self.remember()
        }
    }

    /// Keeps the zoom for the next visit and launch.
    private func remember() {
        JournalBrowsing.shared.waveScale = 1000 / base.k
    }

    /// Zoom by `factor` (> 1 closer) about height y (the middle when nil).
    func zoom(by factor: Double, atY y: Double? = nil, animated: Bool = true) {
        let y = y ?? size.height / 2
        let target = limits.zoom(goal, by: factor, aboutY: y, height: size.height)
        if animated {
            animate(to: target, anchorY: y, duration: 0.28)
        } else {
            set(target)
            remember()
        }
    }

    /// About one and a half cycles of `level` on the screen, the middle kept.
    func fit(level: Int) {
        let k = size.height / (1.5 * clock.levelInfo(level).meanSeconds)
        let mid = goal.t(size.height / 2)
        animate(to: limits.frame(showing: mid, atY: size.height / 2, k: k, height: size.height))
    }

    /// Show [start, end] with a little room.
    func fit(_ start: Double, _ end: Double, animated: Bool = true) {
        let span = max(60, end - start)
        let h = size.height
        let k = h * 0.84 / span
        let target = limits.frame(showing: (start + end) / 2, atY: h / 2, k: k, height: h)
        if animated { animate(to: target) } else { set(target); remember() }
    }

    /// Bring a moment (now) to a fifth of the way down, same zoom.
    func goTo(_ t: Double) {
        animate(to: limits.frame(showing: t, atY: size.height * 0.2, k: goal.k, height: size.height))
    }

    /// The level of the preset nearest the zoom (for the menu's checkmark).
    func presetLevel(_ levels: [Int]) -> Int? {
        let k = goal.k
        var best: (Int, Double)?
        for level in levels {
            let d = abs(log(size.height / (1.5 * clock.levelInfo(level).meanSeconds) / k))
            if d < 0.2, d < best?.1 ?? .infinity { best = (level, d) }
        }
        return best?.0
    }

    // MARK: Gestures

    func panBegan() {
        commit()
        gestureStart = base
    }

    /// The content moved by `dy` points since the pan began.
    func panChanged(_ dy: Double) {
        guard !pinching, let start = gestureStart else { return }
        base = limits.pan(start, by: dy, height: size.height)
    }

    /// The fingers lifted at `vy` points per second: coast.
    func panEnded(velocity vy: Double) {
        gestureStart = nil
        guard !pinching, !reduceMotion, abs(vy) > 160 else { return }
        let tau = 0.42
        let v = max(-9000, min(9000, vy))
        let duration = tau * log(abs(v) / 12)
        guard duration > 0.05 else { return }
        let from = base
        cancelMotion()
        motion = .coast(from: from, v: v, start: .now, tau: tau, duration: duration)
        let end = limits.pan(from, by: v * tau * (1 - exp(-duration / tau)), height: size.height)
        settle(after: duration, to: end)
    }

    func pinchBegan() {
        commit()
        pinching = true
        gestureStart = base
        pinchAnchor = nil
    }

    /// Pinching: the content scaled by `scale` about the fingers at height y (where they began: `startY`), the moment
    /// under them following them.
    func pinchChanged(scale: Double, y: Double, startY: Double) {
        guard let start = gestureStart, scale > 0 else { return }
        let anchor = pinchAnchor ?? start.t(startY)
        pinchAnchor = anchor
        let k = limits.clampK(start.k * scale)
        base = limits.clamp(JournalWaveFrame(top: anchor + y / k, k: k), height: size.height)
    }

    func pinchEnded() {
        pinching = false
        pinchAnchor = nil
        gestureStart = nil
        remember()
    }

    /// A pinch lost a finger and goes on as a pan from here.
    func restartPan() {
        gestureStart = base
    }

    /// Trackpad or wheel: `dy` points of content movement (pan), or a zoom about height y.
    func scroll(dy: Double) {
        commit()
        base = limits.pan(base, by: dy, height: size.height)
    }

    func scrollZoom(_ amount: Double, atY y: Double) {
        commit()
        base = limits.zoom(base, by: exp(amount), aboutY: y, height: size.height)
        remember()
    }

    /// A tap: an entry opens; a cluster zooms in until its entries come apart (or lists them when they cannot).
    func tap(at p: CGPoint, touch: Bool) {
        guard let badge = hits.badge(at: p, slop: touch ? 8 : 2) else { return }
        Haptics.play(.selection)
        if !badge.isCluster, let id = badge.ids.first {
            open?(id)
            return
        }
        let f = frame(at: .now)
        if let k = JournalWavePlacer.separatingK(badge, size: Self.badge, gap: Self.badgeGap, kMax: limits.kMax), k > f.k * 1.05 {
            let mid = (badge.times.max()! + badge.times.min()!) / 2
            animate(to: limits.frame(showing: mid, atY: badge.y, k: min(limits.kMax, k * 1.25), height: size.height), anchorY: badge.y)
        } else {
            chooser = JournalWaveChoice(ids: badge.ids)
        }
    }

    func doubleTap(at p: CGPoint) {
        zoom(by: 2.5, atY: p.y)
    }

    func twoFingerTap(at p: CGPoint) {
        zoom(by: 1 / 2.5, atY: p.y)
    }

    // MARK: Profiling

    /// Sweeps the wave for the hitch probe: scroll up and down, then zoom out and in, from the frame it started at.
    func sweep(elapsed: Double, from start: JournalWaveFrame) {
        let cycle = elapsed.truncatingRemainder(dividingBy: 12)
        let h = size.height
        if cycle < 6 {
            let dy = h * 3 * (1 - cos(2 * .pi * cycle / 6)) / 2
            base = limits.pan(start, by: -dy, height: h)
        } else {
            let z = exp(-2.2 * (1 - cos(2 * .pi * (cycle - 6) / 6)) / 2)
            base = limits.zoom(start, by: z, aboutY: h / 2, height: h)
        }
    }
}

/// Entries too close together to zoom apart, offered as a list.
struct JournalWaveChoice: Identifiable, Equatable {
    let ids: [String]
    var id: String { ids.joined(separator: ",") }
}

/// The badges the wave drew last, for taps (written while drawing; not observed).
@MainActor
final class JournalWaveHits {
    var badges: [JournalWaveBadge] = []

    func badge(at p: CGPoint, slop: Double) -> JournalWaveBadge? {
        JournalWavePlacer.hit(badges, x: p.x, y: p.y, radius: JournalWaveModel.badge / 2 + slop)
    }
}
