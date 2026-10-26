import FractonicaKit
import os
import SwiftUI

/// The Journal as a wave: time runs down the screen, newest at the top, the clock's levels drawn along it as nested
/// harmonic waves (the levels whose cycles are readable at the zoom), each entry's emoji on the wave at its moment.
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

/// The wave's paths for a zoom and size, built over a window two and a half screens tall and moved, not rebuilt, while
/// the view scrolls inside it. Names of cycles are memoised.
@MainActor
final class JournalWaveCache {
    struct Key: Equatable {
        let k: Double
        let width: Double
        let height: Double
    }

    struct Line {
        let level: Int
        let weight: Double
        let path: Path
    }

    private(set) var key: Key?
    private(set) var strands: [JournalWaveStrand] = []
    private(set) var lines: [Line] = []
    /// The cached paths' y is measured from this moment (y' = (anchor − t) · k).
    private(set) var anchor = 0.0
    private var lo = 0.0
    private var hi = 0.0
    private var names: [Int64: String] = [:]
    let clock = FractonicaClock.shared
    /// The texts as pictures.
    let labels = JournalWaveLabels()

    /// The strands and lines for a frame, rebuilding when the zoom or size changed or the view left the window.
    func lines(_ f: JournalWaveFrame, size: CGSize, x0: Double, half: Double) -> (strands: [JournalWaveStrand], lines: [Line], dy: Double) {
        let key = Key(k: f.k, width: size.width, height: size.height)
        let t0 = f.t(size.height), t1 = f.t(0)
        if key != self.key || t0 < lo || t1 > hi {
            rebuild(f, key: key, x0: x0, half: half)
        }
        return (strands, lines, (f.top - anchor) * f.k)
    }

    private func rebuild(_ f: JournalWaveFrame, key: Key, x0: Double, half: Double) {
        let signpost = JournalWaveSignposts.signposter.beginInterval("wave paths")
        defer { JournalWaveSignposts.signposter.endInterval("wave paths", signpost) }
        self.key = key
        let span = key.height / f.k
        lo = max(clock.tMin, f.t(key.height) - 0.75 * span)
        hi = min(clock.tMax, f.top + 0.75 * span)
        anchor = f.top
        strands = JournalWave.strands(k: f.k, height: key.height, half: half, clock: clock)
        guard hi > lo, let p0 = clock.position(at: lo), let p1 = clock.position(at: hi) else {
            lines = []
            return
        }
        let k = f.k, a = anchor
        lines = strands.indices.map { i in
            let points = JournalWave.line(strands, through: i, from: p0, to: p1, x0: x0, clock: clock) { t in (a - t) * k }
            var path = Path()
            if let first = points.first {
                path.move(to: CGPoint(x: first.x, y: first.y))
                for p in points.dropFirst() { path.addLine(to: CGPoint(x: p.x, y: p.y)) }
            }
            return Line(level: strands[i].level, weight: strands[i].weight, path: path)
        }
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
    /// The floating zoom buttons' strip on the right.
    static let controlsWidth = 60.0

    func draw(_ context: inout GraphicsContext, _ size: CGSize) {
        let signpost = JournalWaveSignposts.signposter.beginInterval("wave frame")
        defer { JournalWaveSignposts.signposter.endInterval("wave frame", signpost) }
        let w = size.width, h = size.height
        guard w > 40, h > 40 else { return }
        let margin = Self.margin(w)
        // the zoom buttons float on the right: the wave keeps clear of them
        let column = (lo: margin + 4, hi: w - Self.controlsWidth)
        let x0 = (column.lo + column.hi) / 2
        let half = min(240, (column.hi - column.lo) / 2 - 22)
        let clock = cache.clock
        let (strands, lines, dy) = cache.lines(frame, size: size, x0: x0, half: half)

        // the axis
        var axis = Path()
        axis.move(to: CGPoint(x: x0, y: 0))
        axis.addLine(to: CGPoint(x: x0, y: h))
        context.stroke(axis, with: .color(Theme.line.opacity(0.7)), lineWidth: 1)

        let p0 = clock.position(at: max(clock.tMin, frame.t(h + 20)))
        let p1 = clock.position(at: min(clock.tMax, frame.t(-20)))
        drawFrameLines(&context, strands, p0, p1, w: w, h: h, margin: margin)
        drawMargin(&context, strands, p0, p1, h: h, margin: margin)

        // the waves, coarsest first, the finest brightest
        var moved = context
        moved.translateBy(x: 0, y: dy)
        for (i, line) in lines.enumerated() {
            let fine = i == lines.count - 1
            let colour = Theme.levelColor(line.level, opacity: (fine ? 0.95 : 0.42) * (0.25 + 0.75 * line.weight), lightness: fine ? 0.68 : 0.6)
            if fine {
                moved.stroke(line.path, with: .color(Theme.levelColor(line.level, opacity: 0.16 * line.weight)), style: StrokeStyle(lineWidth: 6, lineCap: .round, lineJoin: .round))
            }
            moved.stroke(line.path, with: .color(colour), style: StrokeStyle(lineWidth: fine ? 1.8 : 1.3 + 1.2 * Double(lines.count - 1 - i) / Double(max(1, lines.count - 1)), lineCap: .round, lineJoin: .round))
        }

        let point: (Double) -> JournalWavePoint = { t in
            JournalWavePoint(x: x0 + JournalWave.offset(clock.position(at: t) ?? 0, strands, through: strands.count - 1), y: frame.y(t))
        }
        drawNow(&context, point, w: w, h: h, margin: margin)
        let badges = drawBadges(&context, point, w: w, h: h, margin: margin)
        drawFrameNames(&context, strands, p0, p1, badges, w: w, h: h, margin: margin)
        drawLegend(&context, strands, h: h)
    }

    /// Hairlines across at the framing level's cycle starts.
    private func drawFrameLines(_ context: inout GraphicsContext, _ strands: [JournalWaveStrand], _ p0: Double?, _ p1: Double?, w: Double, h: Double, margin: Double) {
        guard let p0, let p1, let s = JournalWave.frameLevel(strands, height: h) else { return }
        var lines = Path()
        for tick in JournalWave.ticks(s, from: p0, to: p1, limit: 40) {
            let y = frame.y(tick.time)
            lines.move(to: CGPoint(x: margin - 6, y: y))
            lines.addLine(to: CGPoint(x: w, y: y))
        }
        context.stroke(lines, with: .color(Theme.levelColor(s.level, opacity: 0.26 * s.weight, lightness: 0.6)), lineWidth: 1)
    }
}

