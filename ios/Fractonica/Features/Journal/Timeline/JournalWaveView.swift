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
        let words = settings.wording
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

    /// How often the displayed moment's marker moves: about every half point.
    private var cadence: Double {
        let s = 0.5 / max(1e-9, model.base.k)
        return min(4096, max(1, pow(2, log2(s).rounded())))
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

    /// The framing cycles' names (and Earth moments) on their hairlines, over everything, on whichever side of the
    /// column the emoji leave free.
    private func drawFrameNames(_ context: inout GraphicsContext, _ strands: [JournalWaveStrand], _ p0: Double?, _ p1: Double?,
                                _ badges: [JournalWaveBadge], w: Double, h: Double, margin: Double) {
        guard let p0, let p1, let s = JournalWave.frameLevel(strands, height: h) else { return }
        let alpha = s.weight
        let r = JournalWaveModel.badge / 2
        for tick in JournalWave.ticks(s, from: p0, to: p1, limit: 40) {
            let y = frame.y(tick.time)
            guard y > -24, y < h + 4 else { continue }
            let name = cache.full(level: s.level, cycle: tick.cycle, notation: words.notation)
            var text = Text(verbatim: name).font(.system(size: 11, weight: .semibold)).foregroundColor(Theme.levelColor(s.level, opacity: alpha, lightness: 0.76))
            if !words.pure {
                text = text + Text(verbatim: "  " + JournalWave.earthTick(tick.time, level: s.level, earth: words.earth))
                    .font(.system(size: 10)).foregroundColor(Theme.ink2.opacity(alpha))
            }
            let resolved = context.resolve(text)
            let m = resolved.measure(in: CGSize(width: w, height: 30))
            let left = CGRect(x: margin + 4, y: y + 3, width: m.width + 10, height: m.height + 4)
            let right = CGRect(x: w - Self.controlsWidth - m.width - 10, y: y + 3, width: m.width + 10, height: m.height + 4)
            func covered(_ rect: CGRect) -> Int {
                badges.filter { rect.insetBy(dx: -r, dy: -r).contains(CGPoint(x: $0.x, y: $0.y)) }.count
            }
            let box = covered(left) <= covered(right) ? left : right
            context.fill(Capsule().path(in: box), with: .color(Theme.background.opacity(0.78)))
            context.draw(resolved, at: CGPoint(x: box.midX, y: box.midY), anchor: .center)
        }
    }

    /// Cycle starts in the margin, coarse levels first, as many as fit.
    private func drawMargin(_ context: inout GraphicsContext, _ strands: [JournalWaveStrand], _ p0: Double?, _ p1: Double?, h: Double, margin: Double) {
        guard let p0, let p1 else { return }
        var taken: [Double] = []
        var drawn = 0
        for s in strands where s.cyclePoints >= 34 && s.weight > 0.35 {
            var marks = Path()
            for tick in JournalWave.ticks(s, from: p0, to: p1, limit: 80) {
                let y = frame.y(tick.time)
                guard y > -8, y < h + 8 else { continue }
                marks.move(to: CGPoint(x: margin - 4, y: y))
                marks.addLine(to: CGPoint(x: margin + 2, y: y))
                guard drawn < 44, !taken.contains(where: { abs($0 - y) < 13 }) else { continue }
                taken.append(y)
                drawn += 1
                let label = cache.short(level: s.level, cycle: tick.cycle, notation: words.notation)
                context.draw(Text(verbatim: label).font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundColor(Theme.levelColor(s.level, opacity: s.weight, lightness: 0.7)),
                             at: CGPoint(x: margin - 8, y: y), anchor: .trailing)
            }
            context.stroke(marks, with: .color(Theme.levelColor(s.level, opacity: 0.7 * s.weight)), lineWidth: 1)
        }
    }

    /// The displayed moment: a line across, a dot on the wave, "Now" (or the moment, while travelling).
    private func drawNow(_ context: inout GraphicsContext, _ point: (Double) -> JournalWavePoint, w: Double, h: Double, margin: Double) {
        let y = frame.y(now)
        guard y > -20, y < h + 20 else { return }
        let colour = live ? Theme.now : Theme.cursor
        var line = Path()
        line.move(to: CGPoint(x: margin - 6, y: y))
        line.addLine(to: CGPoint(x: w, y: y))
        context.stroke(line, with: .color(colour.opacity(0.55)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
        let p = point(now)
        context.fill(Path(ellipseIn: CGRect(x: p.x - 9, y: p.y - 9, width: 18, height: 18)), with: .color(colour.opacity(0.22)))
        context.fill(Path(ellipseIn: CGRect(x: p.x - 4.5, y: p.y - 4.5, width: 9, height: 9)), with: .color(colour))
        let label = live ? "Now" : words.time(now, seconds: false)
        context.draw(Text(verbatim: label).font(.system(size: 10, weight: .semibold)).foregroundColor(colour),
                     at: CGPoint(x: w - 8, y: y - 3), anchor: .bottomTrailing)
    }

    /// The entries in view: placed, tethered to their wave point when set beside it, clusters with their count.
    @discardableResult
    private func drawBadges(_ context: inout GraphicsContext, _ point: (Double) -> JournalWavePoint, w: Double, h: Double, margin: Double) -> [JournalWaveBadge] {
        let size = JournalWaveModel.badge
        let reach = 2 * (size + JournalWaveModel.badgeGap)
        let visible = model.pins(from: frame.t(h + reach), to: frame.t(-reach))
        let badges = JournalWavePlacer.place(Array(visible), size: size, gap: JournalWaveModel.badgeGap,
                                             xRange: (margin + 2)...(w - Self.controlsWidth + 6), point: point)
        model.hits.badges = badges
        guard !badges.isEmpty else { return badges }
        var tethers = Path()
        var dots = Path()
        for b in badges where b.isOffset {
            let dx = b.x - b.anchor.x, dy = b.y - b.anchor.y
            let d = max(1, (dx * dx + dy * dy).squareRoot())
            tethers.move(to: CGPoint(x: b.anchor.x, y: b.anchor.y))
            tethers.addLine(to: CGPoint(x: b.x - dx / d * size / 2, y: b.y - dy / d * size / 2))
        }
        for b in badges {
            dots.addEllipse(in: CGRect(x: b.anchor.x - 2.5, y: b.anchor.y - 2.5, width: 5, height: 5))
        }
        context.stroke(tethers, with: .color(Theme.ink3.opacity(0.7)), lineWidth: 1)
        context.fill(dots, with: .color(Theme.ink2))
        for b in badges {
            guard b.y > -size, b.y < h + size else { continue }
            if let symbol = context.resolveSymbol(id: b.symbol) {
                context.draw(symbol, at: CGPoint(x: b.x, y: b.y))
            }
            if b.isCluster {
                let text = context.resolve(Text(verbatim: "\(b.ids.count)").font(.system(size: 10, weight: .bold).monospacedDigit()).foregroundColor(Theme.background))
                let m = text.measure(in: CGSize(width: 60, height: 20))
                let bw = max(17, m.width + 9)
                let rect = CGRect(x: b.x + size * 0.32 - bw / 2 + 4, y: b.y - size / 2 - 3, width: bw, height: 17)
                context.fill(Capsule().path(in: rect.insetBy(dx: -1.5, dy: -1.5)), with: .color(Theme.background))
                context.fill(Capsule().path(in: rect), with: .color(Theme.teal))
                context.draw(text, at: CGPoint(x: rect.midX, y: rect.midY))
            }
        }
        return badges
    }

    /// The levels drawn and how much time the screen shows, bottom left: "ζ η θ  4 d 10 h".
    private func drawLegend(_ context: inout GraphicsContext, _ strands: [JournalWaveStrand], h: Double) {
        var text = Text(verbatim: "")
        for (i, s) in strands.enumerated() where s.weight > 0.15 {
            text = text + Text(verbatim: (i > 0 ? " " : "") + Fractonica.periodName(s.level).text)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Theme.levelColor(s.level, opacity: 0.3 + 0.7 * s.weight, lightness: 0.72))
        }
        let span = frame.span(h)
        text = text + Text(verbatim: "  " + words.duration(span, at: frame.t(h / 2))).font(.system(size: 11)).foregroundColor(Theme.ink2)
        let resolved = context.resolve(text)
        let m = resolved.measure(in: CGSize(width: 300, height: 30))
        let box = CGRect(x: 8, y: h - 10 - m.height - 6, width: m.width + 14, height: m.height + 6)
        context.fill(Capsule().path(in: box), with: .color(Theme.background.opacity(0.82)))
        context.draw(resolved, at: CGPoint(x: box.midX, y: box.midY), anchor: .center)
    }
}
