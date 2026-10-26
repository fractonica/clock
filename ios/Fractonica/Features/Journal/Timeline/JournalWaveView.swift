import FractonicaKit
import os
import SwiftUI

/// The Journal as a wave in the Wave screen's circular geometry: time runs down the screen, newest at the top, along
/// the regular arcs of the level that fits the zoom, the finer levels riding them as perpendicular loops
/// (`JournalArcLayout`), each entry's emoji on the wave at its moment.
/// Drag to move through time, pinch to zoom from Preons to Betas, tap an emoji to open its entry (a cluster zooms in
/// until it comes apart). The displayed moment is marked across the wave.
///
/// One `Canvas` draws it all (the waves from cached paths, the emoji as Canvas symbols made once per emoji), so a frame
/// costs the same with ten entries or a thousand; a platform view over it takes the touches, trackpad and mouse.
struct JournalWaveView: View {
    /// The timeline's records, newest first, and their revision.
    let records: [HubRecord]
    let revision: Int
    let open: (String) -> Void

    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var model = JournalWaveModel.shared
    @State private var cache = JournalWaveCache()

    var body: some View {
        // only the canvas follows the frame: this body runs when the records, the mode or a dialog change
        JournalWaveCanvas(model: model, cache: cache, words: settings.wording)
        .overlay { JournalWaveInputSurface(model: model) }
        .overlay(alignment: .bottomTrailing) { controls }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { model.resize($0) }
        .onChange(of: revision, initial: true) { model.setRecords(records) }
        .onAppear {
            model.open = open
            model.reduceMotion = reduceMotion
            JournalWaveHitches.startIfAsked(model)
        }
        .onChange(of: reduceMotion) { model.reduceMotion = reduceMotion }
        .confirmationDialog("Entries at this moment", isPresented: chooserShown, titleVisibility: .visible, presenting: model.chooser) { choice in
            ForEach(choice.ids, id: \.self) { id in
                Button(title(id)) { open(id) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Journal wave")
        .accessibilityHint("Entries placed on the clock's waves; swipe to move through them")
        .accessibilityZoomAction { action in
            model.zoom(by: action.direction == .zoomIn ? 2 : 0.5)
        }
        .accessibilityScrollAction { edge in
            model.scroll(dy: (edge == .top ? 1 : edge == .bottom ? -1 : 0) * model.size.height * 0.8)
        }
        .accessibilityChildren {
            if voiceOver { accessibilityItems }
        }
    }

    private var chooserShown: Binding<Bool> {
        Binding(get: { model.chooser != nil }, set: { if !$0 { model.chooser = nil } })
    }

    private func title(_ id: String) -> String {
        guard let r = records.first(where: { $0.id == id }) else { return "Entry" }
        let emoji = r.entry?.emoji ?? r.generic.emoji
        let name = r.entry.map { JournalText(entry: $0, media: r.mediaBlobs).title } ?? r.generic.title
        return [emoji, name].compactMap { $0 }.joined(separator: " ")
    }

    // MARK: Controls

    private var controls: some View {
        GlassContainer(spacing: 8) {
            VStack(spacing: 8) {
                control("Zoom In", "plus") { model.zoom(by: 2) }
                control("Zoom Out", "minus") { model.zoom(by: 0.5) }
                control("Now", "arrow.up.to.line") { model.goTo(store.time()) }
            }
        }
        .padding(14)
    }

    private func control(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.play(.selection)
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 22, height: 22)
        }
        .glassButtonStyle()
        .buttonBorderShape(.circle)
        .controlSize(.large)
        .accessibilityLabel(title)
        .help(title)
    }

    // MARK: Accessibility

    /// The entries in view, as buttons in time order (VoiceOver only).
    @ViewBuilder
    private var accessibilityItems: some View {
        let f = model.base
        let visible = model.pins(from: f.t(model.size.height), to: f.t(0)).prefix(60)
        ForEach(Array(visible), id: \.id) { pin in
            Button(accessibilityText(pin)) { open(pin.id) }
        }
    }

    private func accessibilityText(_ pin: JournalWavePin) -> String {
        let words = settings.wording
        return "\(title(pin.id)), \(words.pure ? words.notation.clockText(at: pin.time, upTo: "iota") : words.earth.short(pin.time))"
    }
}

/// The wave's canvas: redrawn on every frame of a move (the frame is read here and nowhere above), on the clock's
/// cadence for the displayed moment's marker, and every display frame while a zoom glides or a flick coasts.
struct JournalWaveCanvas: View {
    let model: JournalWaveModel
    let cache: JournalWaveCache
    let words: Wording

    @Environment(ClockStore.self) private var store

    var body: some View {
        ClockTimeline(.periodic(cadence)) { now in
            TimelineView(.animation(minimumInterval: nil, paused: !model.isMoving)) { timeline in
                let frame = model.frame(at: timeline.date)
                let pins = model.pins
                let live = store.isLive
                Canvas(opaque: false, rendersAsynchronously: false) { context, size in
                    JournalWavePainter(frame: frame, now: now, live: live, words: words, pins: pins, model: model, cache: cache)
                        .draw(&context, size)
                } symbols: {
                    ForEach(model.symbols, id: \.self) { key in
                        JournalWaveSymbol(key: key).tag(key)
                    }
                }
            }
        }
    }

    /// How often the displayed moment's marker moves: about every half point (in powers of two, so a zoom seldom
    /// changes it).
    private var cadence: Double {
        let s = 0.5 / max(1e-9, model.base.k)
        return min(4096, max(1, pow(2, log2(s).rounded())))
    }
}

/// An emoji (or a stand-in symbol) in its disc: the Canvas symbol a badge draws.
struct JournalWaveSymbol: View {
    let key: String

    var body: some View {
        let size = JournalWaveModel.badge
        ZStack {
            Circle().fill(Theme.panel3)
            Circle().stroke(Theme.line2, lineWidth: 1)
            if key.hasPrefix("e:") {
                Text(verbatim: String(key.dropFirst(2))).font(.system(size: size * 0.54))
            } else {
                Image(systemName: String(key.dropFirst(2)))
                    .font(.system(size: size * 0.36, weight: .medium))
                    .foregroundStyle(Theme.teal)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Drawing

/// The wave's arcs and paths for a zoom and size, built over a window two and a half screens tall and moved, not
/// rebuilt, while the view scrolls inside it. Names of cycles are memoised.
@MainActor
final class JournalWaveCache {
    struct Key: Equatable {
        let k: Double
        let width: Double
        let height: Double
        let x0: Double
        let radius: Double
    }

    struct Line {
        let level: Int
        let weight: Double
        let width: Double
        let depth: Double
        let path: Path
    }

    private(set) var key: Key?
    private(set) var zoom = JournalArcs.zoom(k: 0.001, radius: 100)
    private(set) var lines: [Line] = []
    /// The half-arcs in the window, per level from the spine down, in the cache's coordinates.
    private(set) var arcs: [[JournalArc]] = []
    /// The cached arcs' y is measured from this moment (y' = (anchor − t) · k).
    private(set) var anchor = 0.0
    private var lo = 0.0
    private var hi = 0.0
    private var names: [Int64: String] = [:]
    /// The layout in the cache's coordinates, and the wave points of moments worked out so far (kept while it lasts).
    private var layout: JournalArcLayout?
    private var points: [Double: JournalWavePoint] = [:]
    let clock = FractonicaClock.shared
    /// The texts as pictures.
    let labels = JournalWaveLabels()

    /// Arcs with a radius above this many points are drawn as polylines (a spine opening into a straight line).
    static let bigRadius = 3000.0

    /// The zoom, lines and arcs for a frame, rebuilding when the zoom or size changed or the view left the window; `dy`
    /// moves the cached coordinates onto the frame.
    func lines(_ f: JournalWaveFrame, size: CGSize, x0: Double, radius: Double) -> (zoom: JournalArcZoom, lines: [Line], arcs: [[JournalArc]], dy: Double) {
        let key = Key(k: f.k, width: size.width, height: size.height, x0: x0, radius: radius)
        let t0 = f.t(size.height), t1 = f.t(0)
        if key != self.key || t0 < lo || t1 > hi {
            rebuild(f, key: key)
        }
        return (zoom, lines, arcs, (f.top - anchor) * f.k)
    }

    private func rebuild(_ f: JournalWaveFrame, key: Key) {
        let signpost = JournalWaveSignposts.signposter.beginInterval("wave paths")
        defer { JournalWaveSignposts.signposter.endInterval("wave paths", signpost) }
        // while a zoom changes it every frame, the window is only a little taller than the screen
        let zooming = self.key.map { $0.k != key.k && $0.width == key.width && $0.height == key.height } ?? false
        self.key = key
        let span = key.height / f.k
        let extra = (zooming ? 0.25 : 0.75) * span
        lo = max(clock.tMin, f.t(key.height) - extra)
        hi = min(clock.tMax, f.top + extra)
        anchor = f.top
        points.removeAll(keepingCapacity: true)
        zoom = JournalArcs.zoom(k: f.k, radius: key.radius, clock: clock)
        let k = f.k, a = anchor
        let layout = JournalArcLayout(zoom: zoom, x0: key.x0, clock: clock) { t in (a - t) * k }
        self.layout = layout
        let drawn = zoom.drawn
        guard hi > lo, let last = drawn.last else {
            lines = []
            arcs = []
            return
        }
        let yRange = (a - hi) * k ... (a - lo) * k
        arcs = layout.arcs(from: lo, to: hi, through: last, yRange: yRange)
        lines = drawn.compactMap { level in
            let i = level - zoom.spine
            guard i < arcs.count else { return nil }
            var path = Path()
            for item in arcs[i] { Self.add(&path, item.arc, yRange: yRange) }
            return Line(level: level, weight: zoom.weight(level), width: zoom.lineWidth(level), depth: zoom.depth(level), path: path)
        }
    }

    /// Adds an arc to a path: a true arc, or the stretch of a huge one inside `yRange` as a polyline.
    static func add(_ path: inout Path, _ a: WaveArc, yRange: ClosedRange<Double>) {
        if a.radius <= bigRadius {
            // a level's arcs follow on from each other: one stroke runs on through their joins (no caps piling up
            // into beads where a translucent line meets itself)
            let p = a.point(0)
            if let c = path.currentPoint, abs(c.x - p.x) < 0.01, abs(c.y - p.y) < 0.01 {} else {
                path.move(to: CGPoint(x: p.x, y: p.y))
            }
            path.addArc(center: CGPoint(x: a.cx, y: a.cy), radius: a.radius, startAngle: .radians(a.start),
                        endAngle: .radians(a.start + a.sweep), clockwise: a.sweep < 0)
            return
        }
        // nearly straight: a spine arc down the axis, sampled where it is in the window
        let p0 = a.point(0), p1 = a.point(1)
        let dy = p1.y - p0.y
        guard abs(dy) > 1e-9 else { return }
        let u0 = max(0, min(1, (yRange.lowerBound - p0.y) / dy))
        let u1 = max(0, min(1, (yRange.upperBound - p0.y) / dy))
        let (a0, a1) = (min(u0, u1), max(u0, u1))
        guard a1 > a0 else { return }
        let n = 24
        for i in 0...n {
            let p = a.point(a0 + (a1 - a0) * Double(i) / Double(n))
            if i == 0 { path.move(to: CGPoint(x: p.x, y: p.y)) } else { path.addLine(to: CGPoint(x: p.x, y: p.y)) }
        }
    }

    /// A moment's point on the wave in the cache's coordinates (add `dy` for the frame's), memoised until the next
    /// rebuild: scrolling then places the emoji without tracing them again.
    func point(_ t: Double) -> JournalWavePoint? {
        if let p = points[t] { return p }
        guard let p = layout?.point(t) else { return nil }
        if points.count > 4000 { points.removeAll(keepingCapacity: true) }
        points[t] = p
        return p
    }

    /// "δ#3", "23η": a cycle start's short label.
    func short(level: Int, cycle: Int64, notation: Notation) -> String {
        name(level: level, cycle: cycle, salt: 0) { notation.cycleShort(level: level, cycle: cycle) }
    }

    /// "Delta Trifracton", "ε#2 23η": a cycle's name.
    func full(level: Int, cycle: Int64, notation: Notation) -> String {
        name(level: level, cycle: cycle, salt: 1) { notation.cycleName(level: level, cycle: cycle) }
    }

    private func name(level: Int, cycle: Int64, salt: Int64, make: () -> String) -> String {
        let key = (cycle &* 64) &+ Int64(level) &* 2 &+ salt
        if let v = names[key] { return v }
        if names.count > 4000 { names.removeAll(keepingCapacity: true) }
        let v = make()
        names[key] = v
        return v
    }
}

enum JournalWaveSignposts {
    static let signposter = OSSignposter(subsystem: "app.fractonica.clock", category: "JournalWave")
}

/// Draws one frame of the wave.
@MainActor
struct JournalWavePainter {
    let frame: JournalWaveFrame
    let now: Double
    let live: Bool
    let words: Wording
    let pins: [JournalWavePin]
    let model: JournalWaveModel
    let cache: JournalWaveCache

    /// The label margin on the left.
    static func margin(_ width: Double) -> Double { width > 700 ? 92 : 64 }
    /// The floating zoom buttons' strip on the right, and how tall it is from the bottom.
    static let controlsWidth = 60.0
    static let controlsHeight = 200.0

    /// The wave's axis and radius in a view: the middle of the column between the margin and the buttons, and a radius
    /// that leaves room for the loops either side (and lets a few arcs share a tall screen).
    static func geometry(_ size: CGSize) -> (x0: Double, radius: Double, column: ClosedRange<Double>) {
        let w = size.width, h = size.height
        let lo = margin(w) + 4, hi = max(lo + 40, w - controlsWidth)
        let half = (hi - lo) / 2
        return ((lo + hi) / 2, max(24, min(half / 1.3, h * 0.2)), lo...hi)
    }

    func draw(_ context: inout GraphicsContext, _ size: CGSize) {
        let signpost = JournalWaveSignposts.signposter.beginInterval("wave frame")
        defer { JournalWaveSignposts.signposter.endInterval("wave frame", signpost) }
        let w = size.width, h = size.height
        guard w > 40, h > 40 else { return }
        let margin = Self.margin(w)
        let (x0, radius, _) = Self.geometry(size)
        let clock = cache.clock
        let (zoom, lines, arcs, dy) = cache.lines(frame, size: size, x0: x0, radius: radius)
        let layout = JournalArcLayout(zoom: zoom, x0: x0, clock: clock, y: frame.y)

        // the axis
        var axis = Path()
        axis.move(to: CGPoint(x: x0, y: 0))
        axis.addLine(to: CGPoint(x: x0, y: h))
        context.stroke(axis, with: .color(Theme.line.opacity(0.7)), lineWidth: 1)

        let p0 = clock.position(at: max(clock.tMin, frame.t(h + 20)))
        let p1 = clock.position(at: min(clock.tMax, frame.t(-20)))
        drawFrameLines(&context, zoom, p0, p1, w: w, h: h, margin: margin)
        drawMargin(&context, zoom, layout, p0, p1, h: h, margin: margin)

        // the levels, coarsest first; the one nearest the spine's place glows
        var moved = context
        moved.translateBy(x: 0, y: dy)
        let glowing = lines.min { abs($0.depth) < abs($1.depth) }?.level
        for line in lines {
            let glow = line.weight * max(0, 1 - abs(line.depth))
            if glow > 0.05, line.level == glowing {
                moved.stroke(line.path, with: .color(Theme.levelColor(line.level, opacity: 0.16 * glow)),
                             style: StrokeStyle(lineWidth: line.width + 4.5, lineCap: .round, lineJoin: .round))
            }
            moved.stroke(line.path, with: .color(Theme.levelColor(line.level, opacity: 0.95 * line.weight, lightness: 0.6 + 0.08 * glow)),
                         style: StrokeStyle(lineWidth: line.width, lineCap: .round, lineJoin: .round))
        }
        drawMarks(&context, zoom, arcs, dy: dy, w: w, h: h)

        drawNow(&context, layout, w: w, h: h, margin: margin)
        let badges = drawBadges(&context, layout, w: w, h: h, margin: margin)
        drawFrameNames(&context, zoom, p0, p1, badges, w: w, h: h, margin: margin)
        drawLegend(&context, zoom, h: h)
    }

    /// Hairlines across at the framing level's cycle starts (on the axis: the spine's nodes).
    private func drawFrameLines(_ context: inout GraphicsContext, _ zoom: JournalArcZoom, _ p0: Double?, _ p1: Double?, w: Double, h: Double, margin: Double) {
        guard let p0, let p1, let level = JournalArcs.frameLevel(zoom, height: h, clock: cache.clock) else { return }
        var lines = Path()
        for tick in JournalArcs.ticks(level: level, from: p0, to: p1, clock: cache.clock, limit: 40) {
            let y = frame.y(tick.time)
            lines.move(to: CGPoint(x: margin - 6, y: y))
            lines.addLine(to: CGPoint(x: w, y: y))
        }
        context.stroke(lines, with: .color(Theme.levelColor(level, opacity: 0.26, lightness: 0.6)), lineWidth: 1)
    }
}
