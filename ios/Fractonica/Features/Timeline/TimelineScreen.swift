import FractonicaKit
import SwiftUI

/// Timeline: the zoomable, pannable multi-scale timeline from the whole catalogue (70 eclipses) down to seconds, one
/// lane per depth (src/ui/timeline.js, docs/design/40-timeline.md).
///
/// Top to bottom: the catalogue map, the axis (Gregorian in the zone, or the pure ruler of units), one lane per depth
/// with its cycles as blocks, and the Saros 141 eclipse lane; under it a Liquid Glass bar with zoom, presets, "fit the
/// selected cycle" and Follow. The canvas is drawn by `TimelinePainter` in one Core Graphics pass, culled to the
/// window; input comes through `TimelineInputSurface` (UIKit / AppKit recognisers) into `TimelineController`.
///
/// Launch arguments for screenshots and checks (never persisted):
///
///     -FXTimelineSpan <seconds>      the window's width (default: about eight cycles of the selected depth)
///     -FXTimelineCenter <unix s>     the window's centre (default: the cursor)
///     -FXTimelineYear <year>         the window's centre on 1 January of a year (for years before 1970)
///     -FXTimelinePreset <id>         all, alpha … nu (one unit across), century, decade, year, month, week, day, hour, minute
///     -FXTimelineFollow 0|1          Follow on or off at launch
///     -FXTimelineReadout <level>     open the read-out of the cursor's cycle at a level (0-based), or e<k> for eclipse k
///     -FXTimelineInspect <0…1>       show the inspect crosshair at that fraction of the plot
///     -FXTimelineInspectAt <x>,<y>   show the pointer's card at that point of the canvas (a lane head, the map …)
///     -FXTimelineDebug 1             draw the painter's time per frame in the corner
///     -FXTimelineBench 1             zoom in and out continuously (with the frame time), to measure the painter
///     -FXTimelineHeight <points>     cap the canvas height, to see the short (landscape) layout on a portrait device
///     -FXTimelineSide 1              the controls in a column on the trailing side, as on a phone in landscape
struct TimelineScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.displayScale) private var displayScale
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.accessibilityEnabled) private var assistiveTech
    @Environment(\.scenePhase) private var scenePhase
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    #endif
    @FocusState private var focused: Bool

    @State private var controller = TimelineController.shared

    private var viewport: TimelineViewport { controller.viewport }
    private var data: TimelineData { controller.data }
    private var clock: FractonicaClock { data.clock }

    var body: some View {
        let words = TimelineWords(pure: settings.pure, earth: settings.wording.earth)
        let side = sideControls
        let stack = side ? AnyLayout(HStackLayout(spacing: 0)) : AnyLayout(VStackLayout(spacing: 0))
        stack {
            GeometryReader { geo in
                canvas(size: CGSize(width: geo.size.width, height: min(geo.size.height, LaunchState.canvasHeight)), words: words)
            }
            .padding(.top, 4)
            TimelineControlBar(controller: controller, words: words, vertical: side)
                .padding(side ? .vertical : .horizontal, side ? 8 : 12)
                .padding(side ? .trailing : .top, 6)
                .padding(side ? .leading : .bottom, side ? 2 : 10)
        }
        .navigationTitle(Screen.timeline.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(phases: [.down, .repeat], action: keyPress)
        .onAppear(perform: appear)
        .onChange(of: store.revision) { controller.clockChanged() }
        .onChange(of: reduceMotion, initial: true) { _, on in controller.reduceMotion = on }
    }

    /// The controls go into a column on the trailing side where height is scarce (a phone in landscape).
    private var sideControls: Bool {
        #if os(iOS)
        verticalSizeClass == .compact || LaunchState.sideControls
        #else
        false
        #endif
    }

    // MARK: Canvas

    private var levels: [Int] {
        let lo = min(settings.minDepth, settings.maxDepth), hi = max(settings.minDepth, settings.maxDepth)
        return Array((lo - 1)...(hi - 1))
    }

    private var textScale: CGFloat {
        switch dynamicTypeSize {
        case ...DynamicTypeSize.large: 1
        case .xLarge: 1.06
        case .xxLarge: 1.12
        case .xxxLarge: 1.18
        default: 1.28
        }
    }

    @ViewBuilder
    private func canvas(size: CGSize, words: TimelineWords) -> some View {
        let levels = self.levels
        let layout = TimelineLayout(width: size.width, height: size.height, lanes: levels.count, textScale: textScale)
        Group {
            if let interval = pausedNowInterval(layout: layout, words: words) {
                // paused, the displayed time stands still but the real now marker moves on: redraw on real time, as
                // often as that marker or its label needs
                TimelineView(.animation(minimumInterval: interval, paused: scenePhase == .background)) { _ in
                    plot(t: store.time(), layout: layout, words: words, levels: levels)
                }
            } else {
                ClockTimeline(cadence(layout: layout, words: words)) { t in
                    plot(t: t, layout: layout, words: words, levels: levels)
                }
            }
        }
        .overlay {
            TimelineInputSurface(controller: controller)
                .accessibilityHidden(true)
        }
        .popover(item: Bindable(controller).readout, attachmentAnchor: .rect(.rect(controller.readout?.anchor ?? .zero))) { item in
            TimelineReadout(item: item, controller: controller)
                .presentationCompactAdaptation(.sheet)
                .presentationDetents([.medium, .large])
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Timeline")
        .accessibilityValue(assistiveTech ? accessibilityDescription(layout: layout, words: words) : "")
        .accessibilityHint("Swipe up or down to zoom.")
        .accessibilityAdjustableAction { direction in
            controller.zoom(by: direction == .increment ? 0.5 : 2)
        }
        .accessibilityAction(named: "Pan earlier") { controller.pan(fraction: -0.5) }
        .accessibilityAction(named: "Pan later") { controller.pan(fraction: 0.5) }
        .accessibilityAction(named: "Fit the selected cycle") { controller.fitSelected() }
        .accessibilityAction(named: "Centre on the cursor") { controller.centreOnCursor() }
        .accessibilityAction(named: "Details of the selected cycle") { controller.showSelectedReadout() }
        .onChange(of: layout, initial: true) { _, layout in
            controller.layout = layout
            controller.levels = levels
            viewport.plotX0 = layout.px0
            viewport.plotWidth = layout.plotWidth
            LaunchState.applyDeferred(controller: controller, store: store, layout: layout)
        }
    }

    private func plot(t: Double, layout: TimelineLayout, words: TimelineWords, levels: [Int]) -> some View {
        let frame = makeFrame(t: t, layout: layout, words: words, levels: levels)
        return Canvas(opaque: false) { context, _ in
            let painter = TimelinePainter(f: frame, data: data, hits: controller.hits)
            context.withCGContext { cg in
                TimelinePerf.shared.measure { painter.paint(cg) }
                if TimelinePerf.shared.enabled { TimelinePerf.shared.draw(cg, at: CGPoint(x: layout.px1 - 4, y: layout.lanesY + 10)) }
            }
        }
        .overlay(alignment: .topLeading) {
            if let hover = controller.hover {
                TimelineInspector(frame: frame, hover: hover, data: data)
            }
        }
    }

    /// While paused and still: how often (real seconds) the now marker needs a redraw — a quarter point of motion or a
    /// change of its flag when it is in or near the view, its chip's label when it is far off; nil when it is not shown.
    private func pausedNowInterval(layout: TimelineLayout, words: TimelineWords) -> Double? {
        guard store.isPaused, !viewport.isMoving else { return nil }
        let now = Date.now.timeIntervalSince1970
        guard clock.inRange(now) else { return nil }
        let w = viewport.base
        let k = layout.plotWidth / w.span
        let unit = words.pure ? data.ruler.pick(pxPerSec: k, plotWidth: layout.plotWidth).u : TimelineRuler.iota
        let near = now >= w.t0 - w.span && now <= w.t1
        let label = near ? words.flagResolution(span: w.span, ruler: data.ruler, rulerUnit: unit)
                         : words.pure ? data.ruler.flagResolution(unit) : 60
        return max(1.0 / 30, near ? min(label, 0.25 / k) : label)
    }

    /// The slowest redraw that keeps what moves honest: every frame while the window moves or the cursor glides more
    /// than a fraction of a point per frame; else as often as the flag's label or a quarter of a point of cursor
    /// motion needs; nothing while paused.
    private func cadence(layout: TimelineLayout, words: TimelineWords) -> ClockCadence {
        if viewport.isMoving { return .continuous }
        if store.isPaused { return .animation } // idles while paused
        let span = viewport.base.span
        let k = layout.plotWidth / span
        let rate = max(1e-9, abs(store.isLive ? 1 : store.rate))
        let unit = words.pure ? data.ruler.pick(pxPerSec: k, plotWidth: layout.plotWidth).u : TimelineRuler.iota
        let interval = min(words.flagResolution(span: span, ruler: data.ruler, rulerUnit: unit), 0.25 / k)
        if interval / rate < 1.0 / 30 { return .animation }
        return .periodic(interval)
    }

    private func makeFrame(t: Double, layout: TimelineLayout, words: TimelineWords, levels: [Int]) -> TimelineFrame {
        let date = Date.now
        let cursorIn = clock.inRange(t)
        let w = viewport.window(at: date, cursor: t, cursorIn: cursorIn)
        let scale = TimelineScale(window: w, x0: layout.px0, width: layout.plotWidth)
        let charW = 6.6 * textScale
        let axis: TimelineAxisStep = words.pure
            ? .ruler(data.ruler.pick(pxPerSec: scale.k, plotWidth: layout.plotWidth, charW: charW))
            : .gregorian(GregorianStep.pick(pxPerSec: scale.k, charW: charW))
        let now = store.isLive ? t : date.timeIntervalSince1970
        return TimelineFrame(
            layout: layout, window: w, scale: scale, cursor: t, cursorIn: cursorIn, live: store.isLive,
            now: now, nowShow: clock.inRange(now), levels: levels, selected: settings.selectedLevel, words: words,
            axis: axis, refYear: words.pure ? 0 : words.earth.parts(t).year, hover: controller.hover,
            pixel: 1 / max(1, displayScale), textScale: textScale, highlight: controller.readout?.selection
        )
    }

    /// One sentence per fact, for VoiceOver (no seconds: it must not tick).
    private func accessibilityDescription(layout: TimelineLayout, words: TimelineWords) -> String {
        let t = store.time()
        let w = viewport.base
        let ruler = data.ruler
        var out: [String] = []
        if words.pure {
            out.append("Shows \(ruler.rangeText(w.t0, w.t1, to: TimelineRuler.eta)), \(words.spanText(w, ruler: ruler, plotWidth: layout.plotWidth)) across.")
        } else {
            out.append("Shows \(words.earth.date(w.t0)) to \(words.earth.date(w.t1)), \(EarthTime.duration(w.span)) across.")
        }
        guard clock.inRange(t) else {
            out.append("The cursor is outside the Saros 141 catalogue.")
            return out.joined(separator: " ")
        }
        let state = store.isLive ? ", live" : store.isPlaying ? ", in time-lapse" : ""
        out.append("Cursor at \(words.pure ? words.notation.dateText(at: t, upTo: "eta") : words.earth.long(t, seconds: false))\(state).")
        let level = settings.selectedLevel
        if let c = data.cycle(level, at: t) {
            let info = clock.levelInfo(level)
            let ends = words.pure ? ruler.relText(c.end, to: t) : EarthTime.countdown(c.end - t)
            let name = words.pure ? data.names(level, c.idx).name : "cycle \(c.local + 1) of \(info.siblings ?? data.alpha.count)"
            out.append("Selected depth \(info.depth) (\(info.letter)): \(name), ends \(ends).")
        }
        if viewport.follow { out.append("Following the cursor.") }
        return out.joined(separator: " ")
    }

    // MARK: Keys

    private func keyPress(_ press: KeyPress) -> KeyPress.Result {
        if press.modifiers.contains(.command) || press.modifiers.contains(.control) || press.modifiers.contains(.option) { return .ignored }
        let shift = press.modifiers.contains(.shift)
        // held down, the keys that move the view repeat; the others act once
        if press.phase == .repeat {
            let moves: [KeyEquivalent] = [.leftArrow, .rightArrow, .pageUp, .pageDown]
            guard moves.contains(press.key) || ["+", "=", "-", "_"].contains(press.characters) else { return .handled }
        }
        switch press.key {
        case .leftArrow: controller.pan(fraction: shift ? -0.5 : -0.15)
        case .rightArrow: controller.pan(fraction: shift ? 0.5 : 0.15)
        case .upArrow: controller.stepSelection(-1)
        case .downArrow: controller.stepSelection(1)
        case .home: controller.centreOnCursor()
        case .return: controller.travelToCentre()
        case .pageUp: controller.pan(fraction: -0.9)
        case .pageDown: controller.pan(fraction: 0.9)
        default:
            switch press.characters {
            case "+", "=": controller.zoom(by: 0.5)
            case "-", "_": controller.zoom(by: 2)
            case "f", "F": controller.fitSelected()
            default: return .ignored
            }
        }
        return .handled
    }

    // MARK: Lifecycle

    private func appear() {
        controller.store = store
        controller.settings = settings
        let t = store.time()
        viewport.placeIfNeeded(cursor: t, selectedLevel: settings.selectedLevel, follow: store.isLive || store.isPlaying)
        LaunchState.applyOnce(controller: controller, store: store)
        controller.appeared()
        // the keys work without a click first (a Mac, an iPad with a keyboard)
        focused = true
    }
}

// MARK: - Launch arguments

/// The screen's launch arguments (`-FXTimeline…`), applied once.
@MainActor
private enum LaunchState {
    private static var applied = false
    /// `-FXTimelineHeight`: the canvas's height limit (infinite unless given).
    static let canvasHeight: CGFloat = value("FXTimelineHeight").flatMap(Double.init).map { CGFloat($0) } ?? .infinity
    /// `-FXTimelineSide 1`: the landscape arrangement (controls in a column) on any device.
    static let sideControls = value("FXTimelineSide") == "1"
    private static var deferredApplied = false

    private static func value(_ key: String) -> String? {
        let args = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        return (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue
    }

    static func applyOnce(controller: TimelineController, store: ClockStore) {
        guard !applied else { return }
        applied = true
        let viewport = controller.viewport
        let t = store.time()
        // a centre before 1970 is negative, which the argument parser reads as a flag: -FXTimelineYear says it in years
        let year = value("FXTimelineYear").flatMap(Int.init).map { Double(EarthTime.daysFromCivil($0, 1, 1)) * 86_400 }
        let centre = year ?? value("FXTimelineCenter").flatMap(Double.init)
        if let span = value("FXTimelineSpan").flatMap(Double.init) {
            let c = centre ?? t
            viewport.set(TimelineWindow(c: c, span: span))
        } else if let c = centre {
            viewport.set(TimelineWindow(c: c, span: viewport.base.span))
        }
        if let follow = value("FXTimelineFollow") {
            viewport.setFollow(follow == "1", cursor: t, cursorIn: store.clock.inRange(t))
        }
        if centre != nil {
            viewport.setFollow(false, cursor: t, cursorIn: store.clock.inRange(t))
        }
        TimelinePerf.shared.enabled = value("FXTimelineDebug") == "1" || value("FXTimelineBench") == "1"
        if value("FXTimelineBench") == "1" { bench(controller: controller, store: store) }
    }

    /// `-FXTimelineBench 1`: zoom from the whole catalogue to a few seconds and back, again and again, panning on the
    /// way, so the painter's cost per frame can be read in the corner while everything moves.
    private static func bench(controller: TimelineController, store: ClockStore) {
        Task { @MainActor in
            let viewport = controller.viewport
            try? await Task.sleep(for: .seconds(1))
            var forward = true
            while !Task.isCancelled {
                let t = store.time()
                let target = forward ? TimelineWindow(c: t + 3, span: 8) : TimelineWindow(c: t - 3e8, span: viewport.limits.maxSpan)
                viewport.setFollow(false, cursor: t, cursorIn: true)
                viewport.animate(to: target, cursor: t, cursorIn: true, duration: 6, reduceMotion: false)
                try? await Task.sleep(for: .seconds(6.5))
                forward.toggle()
            }
        }
    }

    /// The arguments that need the canvas's layout: a preset, the read-out, the inspect crosshair.
    static func applyDeferred(controller: TimelineController, store: ClockStore, layout: TimelineLayout) {
        guard !deferredApplied, layout.width > 0 else { return }
        deferredApplied = true
        // after the screen has settled into its final size (a tab's first layout passes are provisional)
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.8))
            if let layout = controller.layout { applyLayoutArguments(controller: controller, store: store, layout: layout) }
        }
    }

    private static func applyLayoutArguments(controller: TimelineController, store: ClockStore, layout: TimelineLayout) {
        let t = store.time()
        if let id = value("FXTimelinePreset") {
            let calendar = ["all", "century", "decade", "year", "month", "week", "day", "hour", "minute"]
            let preset = calendar.contains(id) ? id : "u:\(id)"
            let reduce = controller.reduceMotion
            controller.reduceMotion = true
            controller.apply(preset: preset)
            controller.reduceMotion = reduce
        }
        if let f = value("FXTimelineInspect").flatMap(Double.init) {
            let x = layout.px0 + f * layout.plotWidth
            controller.inspect(at: CGPoint(x: x, y: layout.lanesY + layout.laneH * 3.5), touch: true)
        }
        if let at = value("FXTimelineInspectAt")?.split(separator: ",").compactMap({ Double($0) }), at.count == 2 {
            controller.inspect(at: CGPoint(x: at[0], y: at[1]), touch: false)
        }
        if let r = value("FXTimelineReadout") {
            if r.hasPrefix("e"), let k = Int(r.dropFirst()), k >= 0, k < store.clock.catalogue.count {
                controller.readout = TimelineReadoutItem(selection: .eclipse(k), anchor: CGRect(x: layout.px0 + layout.plotWidth / 2, y: layout.eclipseY, width: 2, height: 20))
            } else if let level = Int(r), let reading = store.clock.level(at: t, level) {
                let x = controller.viewport.scale(controller.viewport.window(at: .now, cursor: t, cursorIn: true)).x(t)
                let lane = controller.levels.firstIndex(of: level) ?? 0
                controller.readout = TimelineReadoutItem(selection: .cycle(level: level, idx: reading.cycle),
                                                         anchor: CGRect(x: x - 1, y: layout.laneY(lane), width: 2, height: layout.laneH))
            }
        }
    }
}

// MARK: - Frame timing (debug)

/// The painter's own cost per frame (CPU, recording into the canvas), averaged; drawn in the corner with
/// `-FXTimelineDebug 1`.
@MainActor
final class TimelinePerf {
    static let shared = TimelinePerf()
    var enabled = false
    private var average = 0.0
    private var worst = 0.0
    private var count = 0

    func measure(_ body: () -> Void) {
        let start = CFAbsoluteTimeGetCurrent()
        body()
        let ms = (CFAbsoluteTimeGetCurrent() - start) * 1000
        count += 1
        average += (ms - average) / Double(min(count, 60))
        worst = count % 120 == 0 ? ms : max(worst, ms)
    }

    func draw(_ cg: CGContext, at p: CGPoint) {
        let td = TimelineTextDrawing(cg: cg, text: .shared)
        td.draw(String(format: "paint %.2f ms · max %.2f", average, worst), x: p.x, y: p.y, .mono(10, 600), TimelinePalette.ink, align: .right)
    }
}
