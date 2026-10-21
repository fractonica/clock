import FractonicaKit
import Foundation
import Observation

/// The timeline's view state: which window it shows, how that window is moving and whether it follows the cursor
/// (src/ui/timeline.js, its closure state). One instance for the app, so the view keeps its window between visits.
///
/// Motion (a preset transition, a coasting pan) is a pure function of the real instant: `window(at:cursor:)` computes
/// the window for any frame without mutating anything, so drawing never writes state. The state only changes on input
/// and when a motion ends (`settle`). Follow keeps the cursor at the middle of the view: it is on by default while
/// live or in a time-lapse; dragging turns it off.
@MainActor @Observable
final class TimelineViewport {
    static let shared = TimelineViewport()

    enum Motion: Equatable {
        /// An eased transition between two windows (≈ 250 ms).
        case tween(from: TimelineWindow, to: TimelineWindow, start: Date, duration: Double)
        /// A pan coasting to a stop after a flick: centre velocity `v` (seconds of time per real second).
        case coast(from: TimelineWindow, v: Double, start: Date, duration: Double)
    }

    let limits: TimelineLimits
    /// The window when nothing moves (and the start of any motion).
    private(set) var base: TimelineWindow
    private(set) var motion: Motion?
    /// Keep the cursor at the middle of the view.
    private(set) var follow = false
    /// The user switched Follow off by hand: a time-lapse does not switch it back on by itself.
    @ObservationIgnored private(set) var followOptOut = false
    /// The plot's left edge and width in points (set by the screen on layout).
    @ObservationIgnored var plotX0 = 54.0
    @ObservationIgnored var plotWidth = 320.0
    /// The window has been placed around the cursor once.
    @ObservationIgnored private(set) var placed = false
    @ObservationIgnored private var settleTask: Task<Void, Never>?
    @ObservationIgnored private var gestureStart: TimelineWindow?
    @ObservationIgnored private var pinchAnchor: Double?

    init(clock: FractonicaClock = .shared) {
        limits = TimelineLimits(tMin: clock.tMin, tMax: clock.tMax)
        base = TimelineWindow(c: (clock.tMin + clock.tMax) / 2, span: limits.maxSpan)
    }

    var isMoving: Bool { motion != nil }

    /// Where the window is heading (the end of a transition) or stands; its span is what the controls show.
    var target: TimelineWindow {
        if case .tween(_, let to, _, _)? = motion { return to }
        return base
    }

    /// The scale of a window on the plot.
    func scale(_ w: TimelineWindow) -> TimelineScale { TimelineScale(window: w, x0: plotX0, width: plotWidth) }

    // MARK: Reading

    /// The window to draw at real instant `date` with the displayed time `cursor` (in the catalogue or not).
    func window(at date: Date, cursor: Double, cursorIn: Bool) -> TimelineWindow {
        var w = base
        switch motion {
        case .tween(let from, let to, let start, let duration)?:
            let u = date.timeIntervalSince(start) / duration
            w = u >= 1 ? to : TimelineTween.interpolate(from, to, TimelineTween.easeOut(u))
        case .coast(let from, let v, let start, _)?:
            w = limits.pan(from, by: TimelineTween.coast(v: v, elapsed: date.timeIntervalSince(start)))
        case nil:
            break
        }
        if follow, cursorIn { w = limits.centre(w, on: cursor) }
        return w
    }

    /// The window the view is heading for (the end of a transition), for presets and zoom buttons.
    func goal(cursor: Double, cursorIn: Bool) -> TimelineWindow {
        var w = base
        switch motion {
        case .tween(_, let to, _, _)?: w = to
        case .coast?: w = window(at: .now, cursor: cursor, cursorIn: false)
        case nil: break
        }
        if follow, cursorIn { w = limits.centre(w, on: cursor) }
        return w
    }

    // MARK: Placing

    /// Place the window around the cursor the first time the view appears: about eight cycles of the selected level
    /// (web: `initWindow`), or what the launch arguments ask for.
    func placeIfNeeded(cursor: Double, selectedLevel: Int, follow startFollowing: Bool, clock: FractonicaClock = .shared) {
        guard !placed else { return }
        placed = true
        let mean = clock.levelInfo(selectedLevel).meanSeconds
        let span = min(100 * 365.25 * 86_400, max(3600, mean * 8))
        base = limits.clamp(TimelineWindow(c: cursor, span: span))
        follow = startFollowing
    }

    /// Jump to a window (cancels any motion).
    func set(_ w: TimelineWindow) {
        cancelMotion()
        base = limits.clamp(w)
    }

    /// Freeze any motion where it is now (before the user takes over).
    func commit(cursor: Double, cursorIn: Bool) {
        guard motion != nil || follow else { return }
        let w = window(at: .now, cursor: cursor, cursorIn: cursorIn)
        cancelMotion()
        base = w
    }

    private func cancelMotion() {
        settleTask?.cancel()
        settleTask = nil
        motion = nil
    }

    /// Animate to `target` (instantly under Reduce Motion).
    func animate(to target: TimelineWindow, cursor: Double, cursorIn: Bool, duration: Double = 0.25, reduceMotion: Bool) {
        let to = limits.clamp(target)
        let from = window(at: .now, cursor: cursor, cursorIn: cursorIn)
        cancelMotion()
        // under follow the centre is the cursor's; the transition only changes the span
        if reduceMotion || duration <= 0 || from == to {
            base = to
            return
        }
        base = from
        motion = .tween(from: from, to: to, start: .now, duration: duration)
        settle(after: duration, to: to)
    }

    /// Coast after a flick with velocity `vx` points per second (the content's motion).
    func coast(velocityX vx: Double, cursor: Double, reduceMotion: Bool) {
        guard !reduceMotion else { return }
        let w = base
        let k = plotWidth / w.span
        guard abs(vx) > 220 else { return }
        let v = max(-w.span * 6, min(w.span * 6, -vx / k))
        let duration = TimelineTween.coastDuration(v: v, pxPerSecond: k)
        guard duration > 0.05 else { return }
        cancelMotion()
        motion = .coast(from: w, v: v, start: .now, duration: duration)
        let end = limits.pan(w, by: TimelineTween.coast(v: v, elapsed: duration))
        settle(after: duration, to: end)
    }

    private func settle(after seconds: Double, to end: TimelineWindow) {
        settleTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, let self else { return }
            self.base = end
            self.motion = nil
            self.settleTask = nil
        }
    }

    // MARK: Follow

    func setFollow(_ on: Bool, cursor: Double, cursorIn: Bool) {
        guard follow != on else { return }
        if !on { commit(cursor: cursor, cursorIn: cursorIn) }
        follow = on
    }

    /// The Follow button: switching it off by hand keeps a time-lapse from switching it back on.
    func toggleFollow(cursor: Double, cursorIn: Bool, reduceMotion: Bool) {
        followOptOut = follow
        if follow {
            setFollow(false, cursor: cursor, cursorIn: cursorIn)
        } else if cursorIn {
            let w = goal(cursor: cursor, cursorIn: cursorIn)
            animate(to: limits.centre(w, on: cursor), cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
            follow = true
        }
    }

    /// The clock jumped or changed mode (`ClockStore.lastChange`): follow and reveal the cursor as the web view does.
    func clockChanged(_ change: ClockStore.Change, cursor: Double, cursorIn: Bool, playing: Bool, reduceMotion: Bool) {
        switch change {
        case .pause, .edge:
            return
        case .rate:
            // a time-lapse started while the cursor is on screen: keep it in the middle
            if playing, !followOptOut, cursorIn, !follow, goal(cursor: cursor, cursorIn: false).contains(cursor) {
                follow = true
            }
            return
        case .live:
            followOptOut = false
            follow = true
        case .launch, .jump, .cycle:
            break
        }
        guard cursorIn else { return }
        let w = goal(cursor: cursor, cursorIn: false)
        let margin = w.span * 0.04
        if follow || cursor < w.t0 + margin || cursor > w.t1 - margin {
            animate(to: limits.centre(w, on: cursor), cursor: cursor, cursorIn: false, reduceMotion: reduceMotion)
        }
    }

    // MARK: Gestures

    /// A pan or pinch begins: freeze motion; a pan also stops following.
    func beginGesture(cursor: Double, cursorIn: Bool, pinch: Bool) {
        commit(cursor: cursor, cursorIn: cursorIn)
        if !pinch, follow { follow = false }
        gestureStart = base
        pinchAnchor = nil
    }

    /// Dragging: the content moved by `dx` points since the gesture began.
    func drag(dx: Double) {
        guard let start = gestureStart else { return }
        base = limits.pan(start, by: -dx / (plotWidth / start.span))
    }

    /// Pinching: the content scaled by `scale` around the fingers at `x` (the centroid now; `x0` where it began). While
    /// following, the zoom is about the cursor at the middle instead.
    func pinch(scale: Double, x: Double, startX x0: Double, cursor: Double, cursorIn: Bool) {
        guard let start = gestureStart, scale > 0 else { return }
        let span = limits.clampSpan(start.span / scale)
        if follow, cursorIn {
            base = limits.clamp(TimelineWindow(c: cursor, span: span))
            return
        }
        let anchor = pinchAnchor ?? TimelineScale(window: start, x0: plotX0, width: plotWidth).t(x0)
        pinchAnchor = anchor
        let frac = (x - plotX0) / plotWidth
        base = limits.clamp(TimelineWindow(c: anchor - frac * span + span / 2, span: span))
    }

    /// A pinch lost a finger and turns into a pan from here.
    func restartPan() { gestureStart = base }

    func endGesture() {
        gestureStart = nil
        pinchAnchor = nil
    }

    /// Zoom by `factor` (> 1 out) about the point at `x`, or about the cursor while following.
    func zoom(by factor: Double, atX x: Double?, cursor: Double, cursorIn: Bool, animated: Bool, reduceMotion: Bool) {
        let w = goal(cursor: cursor, cursorIn: cursorIn)
        let target: TimelineWindow
        if follow, cursorIn {
            target = limits.clamp(TimelineWindow(c: cursor, span: w.span * factor))
        } else {
            let current = window(at: .now, cursor: cursor, cursorIn: cursorIn)
            let px = x ?? (plotX0 + plotWidth / 2)
            let frac = min(1, max(0, (px - plotX0) / plotWidth))
            let p = scale(current).t(px)
            target = limits.window(span: w.span * factor, anchor: p, frac: frac)
        }
        if animated {
            animate(to: target, cursor: cursor, cursorIn: cursorIn, duration: 0.2, reduceMotion: reduceMotion)
        } else {
            set(target)
        }
    }

    /// Scroll-wheel or trackpad scrolling: `dx` points pans, `dy` zooms about `x` (helpers of the web wheel handler).
    func scroll(dx: Double, dy: Double, atX x: Double, cursor: Double, cursorIn: Bool, precise: Bool) {
        commit(cursor: cursor, cursorIn: cursorIn)
        if abs(dx) > abs(dy) {
            if follow { follow = false }
            base = limits.pan(base, by: dx / (plotWidth / base.span))
            return
        }
        guard dy != 0 else { return }
        zoom(by: exp(dy * (precise ? 0.005 : 0.0022)), atX: x, cursor: cursor, cursorIn: cursorIn, animated: false, reduceMotion: true)
    }

    /// Pan by a fraction of the view (keys), animated.
    func pan(fraction: Double, cursor: Double, cursorIn: Bool, reduceMotion: Bool) {
        let w = goal(cursor: cursor, cursorIn: cursorIn)
        setFollow(false, cursor: cursor, cursorIn: cursorIn)
        animate(to: limits.pan(w, by: fraction * w.span), cursor: cursor, cursorIn: cursorIn, duration: 0.16, reduceMotion: reduceMotion)
    }

    /// Bring time t into view (about 80 % from the edge it lies beyond), keeping the cursor in view when it fits.
    func reveal(_ t: Double, right: Bool, cursor: Double, cursorIn: Bool, reduceMotion: Bool) {
        let w = goal(cursor: cursor, cursorIn: cursorIn)
        let c: Double
        if cursorIn, abs(t - cursor) < 0.72 * w.span {
            c = (t + cursor) / 2
        } else {
            c = right ? t - 0.3 * w.span : t + 0.3 * w.span
        }
        setFollow(false, cursor: cursor, cursorIn: cursorIn)
        animate(to: TimelineWindow(c: c, span: w.span), cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
    }

    /// Centre the view on t, same zoom.
    func centre(on t: Double, cursor: Double, cursorIn: Bool, reduceMotion: Bool) {
        let w = goal(cursor: cursor, cursorIn: cursorIn)
        if abs(t - cursor) > 1e-3 { setFollow(false, cursor: cursor, cursorIn: cursorIn) }
        animate(to: limits.centre(w, on: t), cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
    }

    /// Show [start, end] with a little margin (a cycle, an eclipse interval).
    func fit(_ start: Double, _ end: Double, cursor: Double, cursorIn: Bool, reduceMotion: Bool) {
        setFollow(false, cursor: cursor, cursorIn: cursorIn)
        animate(to: limits.fit(start, end, margin: 0.06), cursor: cursor, cursorIn: cursorIn, duration: 0.3, reduceMotion: reduceMotion)
    }
}
