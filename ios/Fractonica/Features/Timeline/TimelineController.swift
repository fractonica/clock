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
    /// The clock's revision after the timeline's own last move of the cursor.
    @ObservationIgnored private var ownRevision = -1
    /// The clock's revision the view last followed.
    @ObservationIgnored private var seenRevision = -1
    /// A pinch happened during the current pan: no coasting when the fingers lift.
    @ObservationIgnored private var pinched = false
    /// Scrubbing: the selected depth's cycle under the cursor, for a tick each time the cursor crosses into another.
    @ObservationIgnored private var scrubCycle: Int64?
    /// Pinching: the zoom stands at its narrowest or widest (one tick when it gets there).
    @ObservationIgnored private var atZoomLimit = false

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

    /// Zoom presets: the whole catalogue, one unit across (α … ν), and in Earth mode the calendar (a century … a
    /// minute, the web's Day … Century and the brief's hour and minute). `strip`: shown in the inline row; the menu has
    /// them all.
    struct Preset: Identifiable, Hashable {
        let id: String
        let label: String
        let title: String
        var strip = true
        var calendar = false
    }

    private static let year = 365.25 * 86_400
    /// The calendar presets: id, label, menu title, width in seconds, in the inline row.
    private static let calendar: [(id: String, label: String, title: String, span: Double, strip: Bool)] = [
        ("century", "Century", "A century", 100 * year, false),
        ("decade", "Decade", "A decade", 10 * year, false),
        ("year", "Year", "A year", year, false),
        ("month", "Month", "A month", 30.4375 * 86_400, false),
        ("week", "Week", "A week", 7 * 86_400, false),
        ("day", "Day", "A day", 86_400, true),
        ("hour", "Hour", "An hour", 3600, true),
        ("minute", "Min", "A minute", 60, true),
    ]

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
            return Preset(id: "u:\(id)", label: sym, title: "One \(sym) cycle (≈ \(TimelineWords.cycleLength(ruler.sec[u])))")
        }
        let calendar = Self.calendar.map { Preset(id: $0.id, label: $0.label, title: $0.title, strip: $0.strip, calendar: true) }
        return [Preset(id: "all", label: "All", title: "The whole catalogue")] + units + calendar
    }

    private func presetWindow(_ id: String, anchor: Double, frac: Double) -> TimelineWindow {
        let lim = viewport.limits
        if let c = Self.calendar.first(where: { $0.id == id }) { return lim.window(span: c.span, anchor: anchor, frac: frac) }
        return lim.clamp(data.ruler.presetWindow(id, limits: lim, anchor: anchor, frac: frac))
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

    /// The preset the view is at: the nearest one within ~12 % (a year and one γ are only 11 % apart).
    func activePreset(pure: Bool, window w: TimelineWindow) -> String? {
        var best: (id: String, d: Double)?
        for p in presets(pure: pure) {
            let d = abs(log(w.span / presetWindow(p.id, anchor: w.c, frac: 0.5).span))
            if d < 0.12, d < best?.d ?? .infinity { best = (p.id, d) }
        }
        return best?.id
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

    /// Move the cursor (the displayed time) to t, inside the catalogue. The view does not chase a move it made itself
    /// (the web view ignores its own 'timeline' moves): scrubbing near an edge must not re-centre the window.
    func travel(to t: Double, reveal: Bool = false) {
        guard let store else { return }
        let target = clock.clamp(t)
        store.travel(to: target)
        ownRevision = store.revision
        seenRevision = store.revision
        // a read-out's "Travel here" may go to a start off screen: bring it into view
        if reveal, !viewport.goal(cursor: target, cursorIn: true).contains(target) {
            viewport.centre(on: target, cursor: target, cursorIn: true, reduceMotion: reduceMotion)
        }
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
        seenRevision = store.revision
        guard store.revision != ownRevision else { return }
        viewport.clockChanged(store.lastChange, cursor: cursor, cursorIn: cursorIn, playing: store.isPlaying, reduceMotion: reduceMotion)
    }

    /// The screen appears: a jump made while it was away (another tab, a widget's link) is shown as if it had been
    /// watching — the cursor is brought into view.
    func appeared() {
        guard let store, store.revision != seenRevision else { return }
        clockChanged()
    }

    /// The read-out of the selected depth's cycle at the cursor (VoiceOver's "Details" action), anchored on its lane.
    func showSelectedReadout() {
        guard let level = settings?.selectedLevel, let c = data.cycle(level, at: cursor), let layout else { return }
        let i = levels.firstIndex(of: level)
        let x = min(layout.px1 - 1, max(layout.px0, viewport.scale(windowNow).x(cursor)))
        let y = i.map { layout.laneY($0) } ?? layout.lanesY
        readout = TimelineReadoutItem(selection: .cycle(level: level, idx: c.idx), anchor: CGRect(x: x - 1, y: y, width: 2, height: layout.laneH))
    }

    /// Return: the cursor to the middle of the view (web: Enter).
    func travelToCentre() {
        let w = viewport.goal(cursor: cursor, cursorIn: cursorIn)
        guard clock.inRange(w.c) else { return }
        Haptics.play(.selection)
        viewport.setFollow(false, cursor: cursor, cursorIn: cursorIn)
        travel(to: w.c)
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
            scrubCycle = settings.flatMap { data.cycle($0.selectedLevel, at: cursor)?.idx }
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
            let scale = viewport.scale(windowNow)
            travel(to: scale.t(x) + grab)
            scrubTick(k: scale.k)
        case .overview(let grab)?:
            guard let layout else { return }
            viewport.set(TimelineWindow(c: overviewTime(location.x, layout) - grab, span: viewport.base.span))
        case nil:
            break
        }
    }

    /// A tick as the scrubbed cursor enters another cycle of the selected depth, while those cycles are wide enough on
    /// screen (12 points) for each tick to match a block passing under the finger.
    private func scrubTick(k: Double) {
        guard let level = settings?.selectedLevel, clock.levelInfo(level).meanSeconds * k >= 12 else { return }
        let idx = data.cycle(level, at: cursor)?.idx
        if idx != scrubCycle {
            if scrubCycle != nil, idx != nil { Haptics.play(.selection) }
            scrubCycle = idx
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
        atZoomLimit = isAtZoomLimit
    }

    func pinchChanged(scale: CGFloat, location: CGPoint, start: CGPoint) {
        viewport.pinch(scale: scale, x: location.x, startX: start.x, cursor: cursor, cursorIn: cursorIn)
        // a tick when the pinch reaches the narrowest window (about two seconds) or the whole catalogue
        let limit = isAtZoomLimit
        if limit, !atZoomLimit { Haptics.play(.step) }
        atZoomLimit = limit
    }

    private var isAtZoomLimit: Bool {
        let span = viewport.base.span, lim = viewport.limits
        return span <= lim.minSpan * 1.0001 || span >= lim.maxSpan * 0.9999
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
            // tap the ruler: move the cursor there, snapped to a labelled tick within a few points
            let scale = viewport.scale(windowNow)
            var t = scale.t(p.x)
            if let tick = TimelineSearch.nearest(hits.ticks, t, within: (touch ? 8 : 5) / scale.k) { t = hits.ticks[tick] }
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

    /// The pointer (or a finger held down) over the canvas: the plot shows the moment there, the map its own moment, an
    /// eclipse marker that eclipse, and a head in the gutter explains its row.
    func inspect(at p: CGPoint?, touch: Bool) {
        guard let p, let layout, p.x >= 0, p.x <= layout.px1, p.y >= 0, p.y < layout.bottom,
              layout.region(x: p.x, y: p.y).region != .none else {
            if hover != nil { hover = nil }
            return
        }
        let next = TimelineHover(x: p.x, y: p.y, touch: touch)
        if hover != next { hover = next }
    }

    /// Scrolling: `dx` points moves the view later, `dy` points zooms out (both as a web wheel event reads them).
    func scroll(dx: CGFloat, dy: CGFloat, at p: CGPoint, precise: Bool) {
        readout = nil
        viewport.scroll(dx: dx, dy: dy, atX: p.x, cursor: cursor, cursorIn: cursorIn, precise: precise)
    }
}
