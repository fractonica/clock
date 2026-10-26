import FractonicaKit
import SwiftUI

// The wave's texts and marks — the half-arcs' event names (peak, node, valley, end) and loop numbers as on the Wave
// screen, cycle names, margin counts, the displayed moment's markers, cluster counts, the legend — drawn as pictures
// made once each: a frame then costs a few image draws instead of laying out text dozens of times (text was most of a
// frame's main-thread time while the wave moved).

extension JournalWavePainter {
    /// The event names of the half-arcs that read as the wave (the spine, or its children as they grow into the next
    /// spine): a tick across each start, apex and end, named "peak" or "valley" at the apex and "node" or "end" where a
    /// half ends; and the loop numbers of the finer half-arcs big enough to carry one (signed: + crest, − trough).
    func drawMarks(_ context: inout GraphicsContext, _ zoom: JournalArcZoom, _ arcs: [[JournalArc]], dy: Double, h: Double) {
        let scale = context.environment.displayScale
        var budget = 90
        for (i, list) in arcs.enumerated() {
            let level = zoom.spine + i
            let chord = zoom.chord(level)
            let named = zoom.weight(level) * max(0, 1 - abs(zoom.depth(level))) * JournalArcs.smoothstep(60, 110, chord)
            let numbered = i == 0 ? 0 : zoom.weight(level) * JournalArcs.smoothstep(22, 36, chord) * (1 - named)
            guard named > 0.05 || numbered > 0.05 else { continue }
            let m = level > 0 ? cache.clock.levelInfo(level - 1).factor : 1
            // names stand clear of the loops riding this level
            let reach = 14 + 0.5 * zoom.chord(level + 1) * min(1, 3 * zoom.weight(level + 1))
            var ticks = Path()
            var faded = context
            faded.opacity = max(named, numbered)
            for item in list {
                let a = item.arc
                let top = min(a.cy - a.radius, a.point(0).y, a.point(1).y) + dy
                let bottom = max(a.cy + a.radius, a.point(0).y, a.point(1).y) + dy
                guard bottom > -20, top < h + 20 else { continue }
                if named > 0.05 {
                    let crest = item.idx % 2 == 0
                    for (u, text) in [(0.5, crest ? "peak" : "valley"), (1.0, crest ? "node" : "end")] {
                        let p = a.point(u)
                        let n = normal(a, u)
                        let y = p.y + dy
                        guard y > -10, y < h + 10 else { continue }
                        ticks.move(to: CGPoint(x: p.x - n.x * 5, y: y - n.y * 5))
                        ticks.addLine(to: CGPoint(x: p.x + n.x * 5, y: y + n.y * 5))
                        guard budget > 0 else { continue }
                        budget -= 1
                        let label = cache.labels.label("e|\(text)", scale: scale) {
                            Text(verbatim: text).font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(Theme.ink2)
                                .padding(.horizontal, 3).background(Theme.background.opacity(0.72), in: .capsule)
                        }
                        let c = CGPoint(x: p.x + n.x * reach, y: y + n.y * reach)
                        var l = context
                        l.opacity = named
                        l.draw(label.image, in: CGRect(x: c.x - label.size.width / 2, y: c.y - label.size.height / 2,
                                                       width: label.size.width, height: label.size.height))
                    }
                } else if numbered > 0.05, budget > 0 {
                    let p = a.point(0.5)
                    let y = p.y + dy
                    guard y > -10, y < h + 10 else { continue }
                    budget -= 1
                    let n = normal(a, 0.5)
                    let text = WaveGeometry.signedLabel(Int(item.idx % Int64(m)) + 1, sweep: a.sweep)
                    let label = cache.labels.label("o|\(level)|\(text)", scale: scale) {
                        Text(verbatim: text).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.levelColor(level, lightness: 0.74))
                    }
                    faded.draw(label.image, in: CGRect(x: p.x + n.x * 11 - label.size.width / 2, y: y + n.y * 11 - label.size.height / 2,
                                                       width: label.size.width, height: label.size.height))
                }
            }
            if named > 0.05 {
                context.stroke(ticks, with: .color(Theme.levelColor(level, opacity: 0.9 * named, lightness: 0.74)), lineWidth: 1.5)
            }
        }
    }

    /// The outward normal of an arc at progress u (away from its centre).
    func normal(_ a: WaveArc, _ u: Double) -> CGPoint {
        let angle = a.start + a.sweep * u
        return CGPoint(x: cos(angle), y: sin(angle))
    }

    /// The framing cycles' names (and Earth moments) on their hairlines, over everything, on whichever side of the
    /// column the emoji leave free.
    func drawFrameNames(_ context: inout GraphicsContext, _ zoom: JournalArcZoom, _ p0: Double?, _ p1: Double?,
                        _ badges: [JournalWaveBadge], w: Double, h: Double, margin: Double) {
        guard let p0, let p1, let level = JournalArcs.frameLevel(zoom, height: h, clock: cache.clock) else { return }
        let r = JournalWaveModel.badge / 2
        let scale = context.environment.displayScale
        for tick in JournalArcs.ticks(level: level, from: p0, to: p1, clock: cache.clock, limit: 40) {
            let y = frame.y(tick.time)
            guard y > -24, y < h + 4 else { continue }
            let name = cache.full(level: level, cycle: tick.cycle, notation: words.notation)
            let earth = words.pure ? "" : JournalArcs.earthTick(tick.time, level: level, earth: words.earth)
            let label = cache.labels.label("f|\(level)|\(name)|\(earth)", scale: scale) {
                HStack(spacing: 6) {
                    Text(verbatim: name).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.levelColor(level, lightness: 0.76))
                    if !earth.isEmpty { Text(verbatim: earth).font(.system(size: 10)).foregroundStyle(Theme.ink2) }
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Theme.background.opacity(0.78), in: .capsule)
            }
            let left = CGRect(x: margin + 4, y: y + 3, width: label.size.width, height: label.size.height)
            let right = CGRect(x: w - Self.controlsWidth - label.size.width, y: y + 3, width: label.size.width, height: label.size.height)
            func covered(_ rect: CGRect) -> Int {
                badges.filter { rect.insetBy(dx: -r, dy: -r).contains(CGPoint(x: $0.x, y: $0.y)) }.count
            }
            context.draw(label.image, in: covered(left) <= covered(right) ? left : right)
        }
    }

    /// Cycle starts in the margin, coarse levels first, as many as fit: the spine's and coarser ones on the axis, its
    /// children's where they start on the spine.
    func drawMargin(_ context: inout GraphicsContext, _ zoom: JournalArcZoom, _ layout: JournalArcLayout, _ p0: Double?, _ p1: Double?,
                    h: Double, margin: Double) {
        guard let p0, let p1 else { return }
        let scale = context.environment.displayScale
        let clock = cache.clock
        var taken: [Double] = []
        var drawn = 0
        for level in max(0, zoom.spine - 2)...(zoom.spine + 1) {
            guard clock.levelInfo(level).meanSeconds * zoom.k >= 34 else { continue }
            let alpha = level <= zoom.spine ? 1 : min(1, 1.6 * zoom.weight(level))
            guard alpha > 0.3 else { continue }
            var marks = Path()
            var faded = context
            faded.opacity = alpha
            for tick in JournalArcs.ticks(level: level, from: p0, to: p1, clock: clock, limit: 80) {
                let y = level <= zoom.spine ? frame.y(tick.time) : (layout.point(tick.time, through: zoom.spine)?.y ?? frame.y(tick.time))
                guard y > -8, y < h + 8 else { continue }
                marks.move(to: CGPoint(x: margin - 4, y: y))
                marks.addLine(to: CGPoint(x: margin + 2, y: y))
                // the legend keeps the bottom left
                guard drawn < 44, y < h - 34, !taken.contains(where: { abs($0 - y) < 13 }) else { continue }
                taken.append(y)
                drawn += 1
                let text = cache.short(level: level, cycle: tick.cycle, notation: words.notation)
                let label = cache.labels.label("m|\(level)|\(text)", scale: scale) {
                    Text(verbatim: text).font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(Theme.levelColor(level, lightness: 0.7))
                }
                faded.draw(label.image, in: CGRect(x: margin - 8 - label.size.width, y: y - label.size.height / 2,
                                                   width: label.size.width, height: label.size.height))
            }
            context.stroke(marks, with: .color(Theme.levelColor(level, opacity: 0.7 * alpha)), lineWidth: 1)
        }
    }

    /// The displayed moment as on the Wave screen: a marker on each level's arc where the moment is, joined by tethers
    /// and lettered, the finest bright on the wave itself (where an emoji of that moment sits), with a line to the
    /// right edge saying "Now" (or the moment, while travelling).
    func drawNow(_ context: inout GraphicsContext, _ layout: JournalArcLayout, w: Double, h: Double, margin: Double) {
        let zoom = layout.zoom
        let chain = layout.trace(now)
        guard let last = chain.last else { return }
        let end = last.arc.arc.point(last.local)
        guard end.y > -40, end.y < h + 40 else { return }
        let colour = live ? Theme.now : Theme.cursor
        let scale = context.environment.displayScale
        var line = Path()
        line.move(to: CGPoint(x: margin - 6, y: end.y))
        line.addLine(to: CGPoint(x: w, y: end.y))
        context.stroke(line, with: .color(colour.opacity(0.4)), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))

        // the levels' markers, coarse to fine, those that show
        let markers = chain.dropLast().filter { zoom.weight($0.arc.level) > 0.12 }.map { m -> (level: Int, p: WavePoint, n: CGPoint) in
            (m.arc.level, m.arc.arc.point(m.local), normal(m.arc.arc, m.local))
        }
        var tether = Path()
        if let first = markers.first {
            tether.move(to: CGPoint(x: first.p.x, y: first.p.y))
            for m in markers.dropFirst() { tether.addLine(to: CGPoint(x: m.p.x, y: m.p.y)) }
            tether.addLine(to: CGPoint(x: end.x, y: end.y))
        }
        context.stroke(tether, with: .color(colour.opacity(0.5)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        for m in markers {
            let weight = zoom.weight(m.level)
            let s = 2.6 + 1.6 * weight
            context.fill(Path(ellipseIn: CGRect(x: m.p.x - s - 1.4, y: m.p.y - s - 1.4, width: 2 * s + 2.8, height: 2 * s + 2.8)),
                         with: .color(Theme.background.opacity(0.9)))
            context.fill(Path(ellipseIn: CGRect(x: m.p.x - s, y: m.p.y - s, width: 2 * s, height: 2 * s)),
                         with: .color(Theme.levelColor(m.level, lightness: 0.68)))
            // colour alone must not name a level: each marker away from the moment's dot carries its letter
            guard hypot(m.p.x - end.x, m.p.y - end.y) > 18 else { continue }
            let letter = Fractonica.periodName(m.level).text
            let label = cache.labels.label("v|\(m.level)|\(letter)", scale: scale) {
                Text(verbatim: letter).font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.levelColor(m.level, lightness: 0.76))
                    .padding(.horizontal, 2).background(Theme.background.opacity(0.7), in: .capsule)
            }
            var faded = context
            faded.opacity = min(1, 1.5 * weight)
            faded.draw(label.image, in: CGRect(x: m.p.x + m.n.x * 12 - label.size.width / 2, y: m.p.y + m.n.y * 12 - label.size.height / 2,
                                               width: label.size.width, height: label.size.height))
        }
        context.fill(Path(ellipseIn: CGRect(x: end.x - 10, y: end.y - 10, width: 20, height: 20)), with: .color(colour.opacity(0.22)))
        context.fill(Path(ellipseIn: CGRect(x: end.x - 5, y: end.y - 5, width: 10, height: 10)), with: .color(Theme.background))
        context.fill(Path(ellipseIn: CGRect(x: end.x - 4, y: end.y - 4, width: 8, height: 8)), with: .color(colour))
        let text = live ? "Now" : words.time(now, seconds: false)
        let label = cache.labels.label("n|\(live)|\(text)", scale: scale) {
            Text(verbatim: text).font(.system(size: 10, weight: .semibold)).foregroundStyle(colour)
        }
        context.draw(label.image, in: CGRect(x: w - 8 - label.size.width, y: end.y - 3 - label.size.height, width: label.size.width, height: label.size.height))
    }

    /// The entries in view: placed, tethered to their wave point when set beside it, clusters with their count.
    @discardableResult
    func drawBadges(_ context: inout GraphicsContext, _ layout: JournalArcLayout, w: Double, h: Double, margin: Double) -> [JournalWaveBadge] {
        let size = JournalWaveModel.badge
        let reach = 2 * (size + JournalWaveModel.badgeGap) + layout.zoom.radius
        let visible = model.pins(from: frame.t(h + reach), to: frame.t(-reach))
        let badges = JournalWavePlacer.place(Array(visible), size: size, gap: JournalWaveModel.badgeGap,
                                             xRange: (margin + 2)...(w - Self.controlsWidth + 6), slack: layout.zoom.radius) { layout.point($0) }
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
        let scale = context.environment.displayScale
        for b in badges {
            guard b.y > -size, b.y < h + size else { continue }
            if let symbol = context.resolveSymbol(id: b.symbol) {
                context.draw(symbol, at: CGPoint(x: b.x, y: b.y))
            }
            if b.isCluster {
                let count = b.ids.count
                let bubble = cache.labels.label("c|\(count)", scale: scale) {
                    Text(verbatim: "\(count)")
                        .font(.system(size: 10, weight: .bold).monospacedDigit())
                        .foregroundStyle(Theme.background)
                        .padding(.horizontal, 5)
                        .frame(minWidth: 17, minHeight: 17)
                        .background(Theme.teal, in: .capsule)
                        .padding(1.5)
                        .background(Theme.background, in: .capsule)
                }
                context.draw(bubble.image, in: CGRect(x: b.x + size * 0.32 + 4 - bubble.size.width / 2, y: b.y - size / 2 - 4.5,
                                                      width: bubble.size.width, height: bubble.size.height))
            }
        }
        return badges
    }

    /// The levels drawn and how much time the screen shows, bottom left: "ζ η θ  4 d 10 h".
    func drawLegend(_ context: inout GraphicsContext, _ zoom: JournalArcZoom, h: Double) {
        let letters = zoom.levels.filter { zoom.weight($0) > 0.15 }
            .map { (level: $0, opacity: min(1, ((0.3 + 0.7 * zoom.weight($0)) * 10).rounded() / 10)) }
        let span = words.duration(frame.span(h), at: frame.t(h / 2))
        let key = "l|" + letters.map { "\($0.level):\($0.opacity)" }.joined(separator: ",") + "|" + span
        let label = cache.labels.label(key, scale: context.environment.displayScale) {
            HStack(spacing: 4) {
                ForEach(letters, id: \.level) { l in
                    Text(verbatim: Fractonica.periodName(l.level).text)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.levelColor(l.level, opacity: l.opacity, lightness: 0.72))
                }
                Text(verbatim: span).font(.system(size: 11)).foregroundStyle(Theme.ink2).padding(.leading, 4)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Theme.background.opacity(0.82), in: .capsule)
        }
        context.draw(label.image, in: CGRect(x: 8, y: h - 10 - label.size.height, width: label.size.width, height: label.size.height))
    }
}

/// The wave's texts as pictures, made once each (`ImageRenderer`) and kept by key; opacity comes from the drawing
/// context.
@MainActor
final class JournalWaveLabels {
    struct Label {
        let image: Image
        let size: CGSize
    }

    private var labels: [String: Label] = [:]

    func label(_ key: String, scale: CGFloat, @ViewBuilder content: () -> some View) -> Label {
        let key = "\(scale)|" + key
        if let hit = labels[key] { return hit }
        if labels.count > 800 { labels.removeAll(keepingCapacity: true) }
        let renderer = ImageRenderer(content: content().fixedSize())
        renderer.scale = scale
        let label: Label
        if let cg = renderer.cgImage {
            label = Label(image: Image(decorative: cg, scale: scale), size: CGSize(width: CGFloat(cg.width) / scale, height: CGFloat(cg.height) / scale))
        } else {
            label = Label(image: Image(systemName: "circle").resizable(), size: .zero)
        }
        labels[key] = label
        return label
    }
}
