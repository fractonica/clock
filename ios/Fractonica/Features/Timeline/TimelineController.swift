import FractonicaKit
import Observation
import SwiftUI

/// The read-out being shown (a cycle or an eclipse) and where it was tapped, for the popover's arrow.
struct TimelineReadoutItem: Identifiable, Equatable {
    let selection: TimelineSelection
    let anchor: CGRect

    var id: TimelineSelection { selection }
}

/// Turns input from the platform layers (touch, trackpad, mouse, keys, buttons) into moves of the window, the clock
/// and the read-out. One per app, like the viewport.
@MainActor @Observable
final class TimelineController {
    static let shared = TimelineController()

    let viewport: TimelineViewport
    let data: TimelineData
    @ObservationIgnored let hits = TimelineHitMap()

    /// The read-out popover / sheet.
    var readout: TimelineReadoutItem?
    /// The pointer or the inspecting finger.
    var hover: TimelineHover?

    /// Bound by the screen while it is on screen.
    @ObservationIgnored weak var store: ClockStore?
    @ObservationIgnored weak var settings: AppSettings?
    @ObservationIgnored var layout: TimelineLayout?
    @ObservationIgnored var levels: [Int] = []
    @ObservationIgnored var reduceMotion = false

    private enum Drag { case plot, scrub(grab: Double), overview(grab: Double) }
    @ObservationIgnored private var drag: Drag?
    @ObservationIgnored private var pinching = false
    /// A pinch happened during the current pan: no coasting when the fingers lift.
    @ObservationIgnored private var pinched = false

    init(viewport: TimelineViewport = .shared, data: TimelineData = .shared) {
        self.viewport = viewport
        self.data = data
    }

    private var clock: FractonicaClock { data.clock }
    private var cursor: Double { store?.time() ?? Date.now.timeIntervalSince1970 }
    private var cursorIn: Bool { clock.inRange(cursor) }

    // MARK: Commands (buttons, keys, menus)

    func zoom(by factor: Double) {
        Haptics.play(.selection)
        viewport.zoom(by: factor, atX: nil, cursor: cursor, cursorIn: cursorIn, animated: true, reduceMotion: reduceMotion)
    }

    /// Zoom presets: the whole catalogue, one unit across (α … ν), or a day, an hour, a minute (Earth mode).
    struct Preset: Identifiable, Hashable {
        let id: String
        let label: String
        let title: String
    }

    func presets(pure: Bool) -> [Preset] {
        let ruler = data.ruler
        if pure {
            return ruler.presets.reversed().map { p in
                p.u < 0
                    ? Preset(id: p.id, label: "All", title: "The whole catalogue")
                    : Preset(id: p.id, label: p.label, title: "One \(ruler.units[p.u].name) (\(p.label)) across")
            }
        }
        let units = ["alpha", "beta", "gamma", "delta", "epsilon"].map { id in
            let u = ruler.unitIndex(id)
            let sym = ruler.units[u].sym
            return Preset(id: "u:\(id)", label: sym, title: "One \(sym) cycle across (≈ \(TimelineWords.cycleLength(ruler.sec[u])))")
        }
        return [Preset(id: "all", label: "All", title: "The whole catalogue")] + units + [
            Preset(id: "day", label: "Day", title: "One day across"),
            Preset(id: "hour", label: "Hour", title: "One hour across"),
            Preset(id: "minute", label: "Min", title: "One minute across"),
        ]
    }

    private func presetWindow(_ id: String, anchor: Double, frac: Double) -> TimelineWindow {
        let lim = viewport.limits
        switch id {
        case "day": return lim.window(span: 86_400, anchor: anchor, frac: frac)
        case "hour": return lim.window(span: 3600, anchor: anchor, frac: frac)
        case "minute": return lim.window(span: 60, anchor: anchor, frac: frac)
        default: return lim.clamp(data.ruler.presetWindow(id, limits: lim, anchor: anchor, frac: frac))
        }
    }

    /// Show a preset, keeping the cursor where it is on screen when it is in view (at the middle while following).
    func apply(preset id: String) {
        Haptics.play(.selection)
        let w = viewport.goal(cursor: cursor, cursorIn: cursorIn)
        var anchor = w.c, frac = 0.5
        if cursorIn, viewport.follow {
            anchor = cursor
        } else if cursorIn, w.contains(cursor) {
            anchor = cursor
            frac = (cursor - w.t0) / w.span
        }
        viewport.animate(to: presetWindow(id, anchor: anchor, frac: frac), cursor: cursor, cursorIn: cursorIn, duration: 0.35, reduceMotion: reduceMotion)
    }

    /// The preset the view is at (within ~12 %), if any.
    func activePreset(pure: Bool, window w: TimelineWindow) -> String? {
        presets(pure: pure).first { p in
            let target = presetWindow(p.id, anchor: w.c, frac: 0.5)
            return abs(log(w.span / target.span)) < 0.12
        }?.id
    }

    /// Zoom to the selected level's cycle at the cursor.
    func fitSelected() {
        guard let level = settings?.selectedLevel, let c = data.cycle(level, at: cursor) else { return }
        Haptics.play(.selection)
        viewport.fit(c.start, c.end, cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
    }

    func fit(level: Int, idx: Int64) {
        guard let start = clock.cycleStartTime(level: level, index: idx) else { return }
        let end = clock.cycleStartTime(level: level, index: idx + 1) ?? clock.tMax
        viewport.fit(start, end, cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
    }

    func centreOnCursor() {
        guard cursorIn else { return }
        viewport.centre(on: cursor, cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
    }

    func toggleFollow() {
        Haptics.play(.selection)
        viewport.toggleFollow(cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
    }

    func pan(fraction: Double) {
        viewport.pan(fraction: fraction, cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
    }

    /// Move the cursor (the displayed time) to t, inside the catalogue.
    func travel(to t: Double) {
        guard let store else { return }
        store.travel(to: clock.clamp(t))
    }

    /// Select the level of the lane above or below the selected one.
    func stepSelection(_ direction: Int) {
        guard let settings, let first = levels.first, let last = levels.last else { return }
        let next = min(last, max(first, settings.selectedLevel + direction))
        if next != settings.selectedLevel {
            settings.selectedLevel = next
            Haptics.play(.selection)
        }
    }

    func clockChanged() {
        guard let store else { return }
        viewport.clockChanged(store.lastChange, cursor: cursor, cursorIn: cursorIn, playing: store.isPlaying, reduceMotion: reduceMotion)
    }

    // MARK: Hit testing

    private func region(_ p: CGPoint) -> (region: TimelineLayout.Region, gutter: Bool)? {
        layout?.region(x: p.x, y: p.y)
    }

    private var windowNow: TimelineWindow { viewport.window(at: .now, cursor: cursor, cursorIn: cursorIn) }

    /// The block under a point of lane `i`, or nil.
    private func block(lane i: Int, x: Double) -> (level: Int, block: TimelineBlock)? {
        guard i >= 0, i < levels.count else { return nil }
        let level = levels[i]
        let w = windowNow
        let scale = viewport.scale(w)
        if clock.levelInfo(level).meanSeconds * scale.k < 3 { return nil }
        let t = scale.t(x)
        guard clock.inRange(t) else { return nil }
        let blocks = data.blocks(level, w.t0, w.t1)
        let n = TimelineSearch.lastAtOrBefore(blocks, t) { $0.start }
        guard n >= 0, t < blocks[n].end || blocks[n].end >= clock.tMax else { return nil }
        return (level, blocks[n])
    }

    // MARK: Input

    func panBegan(at start: CGPoint, touch: Bool) {
        readout = nil
        hover = nil
        if pinching {
            // two fingers: the pinch moves the window; this pan only continues it if a finger stays down
            pinched = true
            drag = .plot
            return
        }
        let slop: CGFloat = touch ? 12 : 2
        if let flag = hits.cursorFlag, flag.insetBy(dx: -slop, dy: -slop).contains(start), cursorIn {
            viewport.setFollow(false, cursor: cursor, cursorIn: cursorIn)
            drag = .scrub(grab: cursor - viewport.scale(windowNow).t(start.x))
            return
        }
        if case (.overview, false)? = region(start), let layout {
            viewport.beginGesture(cursor: cursor, cursorIn: cursorIn, pinch: false)
            let t = overviewTime(start.x, layout)
            let frame = hits.overviewFrame
            let inside = frame.map { start.x >= $0.minX && start.x <= $0.maxX } ?? false
            drag = .overview(grab: inside ? t - viewport.base.c : 0)
            if !inside { viewport.set(TimelineWindow(c: t, span: viewport.base.span)) }
            return
        }
        viewport.beginGesture(cursor: cursor, cursorIn: cursorIn, pinch: false)
        pinched = pinching
        drag = .plot
    }

    private func overviewTime(_ x: Double, _ layout: TimelineLayout) -> Double {
        let lim = viewport.limits
        return lim.d0 + (x - layout.px0) / layout.plotWidth * (lim.d1 - lim.d0)
    }

    func panChanged(translation: CGSize, location: CGPoint) {
        guard !pinching else { return }
        switch drag {
        case .plot?:
            viewport.drag(dx: translation.width)
        case .scrub(let grab)?:
            guard let layout else { return }
            let x = min(layout.px1, max(layout.px0, location.x))
            travel(to: viewport.scale(windowNow).t(x) + grab)
        case .overview(let grab)?:
            guard let layout else { return }
            viewport.set(TimelineWindow(c: overviewTime(location.x, layout) - grab, span: viewport.base.span))
        case nil:
            break
        }
    }

    func panEnded(velocity: CGSize) {
        defer {
            drag = nil
            viewport.endGesture()
        }
        if case .plot? = drag, !pinching, !pinched {
            viewport.coast(velocityX: velocity.width, cursor: cursor, reduceMotion: reduceMotion)
        }
    }

    func pinchBegan() {
        readout = nil
        hover = nil
        pinching = true
        pinched = true
        viewport.beginGesture(cursor: cursor, cursorIn: cursorIn, pinch: true)
    }

    func pinchChanged(scale: CGFloat, location: CGPoint, start: CGPoint) {
        viewport.pinch(scale: scale, x: location.x, startX: start.x, cursor: cursor, cursorIn: cursorIn)
    }

    func pinchEnded() {
        pinching = false
        viewport.endGesture()
        if case .plot? = drag { viewport.beginGesture(cursor: cursor, cursorIn: cursorIn, pinch: true) }
    }

    func tap(at p: CGPoint, touch: Bool) {
        guard let (region, gutter) = region(p) else { return }
        if let chip = hits.chip(at: p, slop: touch ? 10 : 0) {
            Haptics.play(.selection)
            switch chip.action {
            case .reveal(let t, let right):
                viewport.reveal(t, right: right, cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
            case .centreCursor:
                centreOnCursor()
            case .centreNow:
                let now = Date.now.timeIntervalSince1970
                viewport.centre(on: now, cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
            }
            return
        }
        if gutter {
            if case .lane(let i) = region, i < levels.count, let settings {
                settings.selectedLevel = levels[i]
                Haptics.play(.selection)
            }
            return
        }
        switch region {
        case .overview:
            guard let layout else { return }
            viewport.centre(on: overviewTime(p.x, layout), cursor: cursor, cursorIn: cursorIn, reduceMotion: reduceMotion)
        case .lane(let i):
            guard let hit = block(lane: i, x: p.x), let layout else {
                readout = nil
                return
            }
            let scale = viewport.scale(windowNow)
            let x0 = max(layout.px0, scale.x(hit.block.start)), x1 = min(layout.px1, scale.x(hit.block.end))
            let anchor = CGRect(x: touch ? p.x - 1 : (x0 + x1) / 2 - 1, y: layout.laneY(i), width: 2, height: layout.laneH)
            Haptics.play(.selection)
            readout = TimelineReadoutItem(selection: .cycle(level: hit.level, idx: hit.block.idx), anchor: anchor)
        case .eclipse:
            guard let layout else { return }
            let scale = viewport.scale(windowNow)
            if let k = TimelineSearch.nearest(clock.catalogue, scale.t(p.x), within: (touch ? 16 : 9) / scale.k) {
                Haptics.play(.selection)
                let x = scale.x(clock.catalogue[k])
                readout = TimelineReadoutItem(selection: .eclipse(k), anchor: CGRect(x: x - 6, y: layout.eclipseY, width: 12, height: layout.eclipseH * 0.7))
            }
        case .axis:
            // tap the ruler: move the cursor there, snapped to a tick within a few points
            let scale = viewport.scale(windowNow)
            let t = scale.t(p.x)
            guard clock.inRange(t) else { return }
            Haptics.play(.selection)
            viewport.setFollow(false, cursor: cursor, cursorIn: cursorIn)
            travel(to: t)
        case .none:
            readout = nil
        }
    }

    func doubleTap(at p: CGPoint) {
        readout = nil
        guard let (region, gutter) = region(p), !gutter else { return }
        if case .overview = region { return }
        viewport.zoom(by: 0.4, atX: p.x, cursor: cursor, cursorIn: cursorIn, animated: true, reduceMotion: reduceMotion)
    }

    func twoFingerTap(at p: CGPoint) {
        readout = nil
        viewport.zoom(by: 2.5, atX: p.x, cursor: cursor, cursorIn: cursorIn, animated: true, reduceMotion: reduceMotion)
    }

    func inspect(at p: CGPoint?, touch: Bool) {
        guard let p, let layout, p.x >= layout.px0, p.x <= layout.px1, p.y >= layout.axisY, p.y < layout.bottom else {
            if hover != nil { hover = nil }
            return
        }
        hover = TimelineHover(x: p.x, y: p.y, touch: touch)
    }

    /// Scrolling: `dx` points moves the view later, `dy` points zooms out (both as a web wheel event reads them).
    func scroll(dx: CGFloat, dy: CGFloat, at p: CGPoint, precise: Bool) {
        readout = nil
        viewport.scroll(dx: dx, dy: dy, atX: p.x, cursor: cursor, cursorIn: cursorIn, precise: precise)
    }
}
