import FractonicaKit
import SwiftUI

// The wave's texts — cycle names, margin counts, the moment's label, cluster counts, the legend — drawn as pictures
// made once each: a frame then costs a few image draws instead of laying out text dozens of times (text was most of a
// frame's main-thread time while the wave moved).

extension JournalWavePainter {
    /// The framing cycles' names (and Earth moments) on their hairlines, over everything, on whichever side of the
    /// column the emoji leave free.
    func drawFrameNames(_ context: inout GraphicsContext, _ strands: [JournalWaveStrand], _ p0: Double?, _ p1: Double?,
                        _ badges: [JournalWaveBadge], w: Double, h: Double, margin: Double) {
        guard let p0, let p1, let s = JournalWave.frameLevel(strands, height: h) else { return }
        let r = JournalWaveModel.badge / 2
        let scale = context.environment.displayScale
        for tick in JournalWave.ticks(s, from: p0, to: p1, limit: 40) {
            let y = frame.y(tick.time)
            guard y > -24, y < h + 4 else { continue }
            let name = cache.full(level: s.level, cycle: tick.cycle, notation: words.notation)
            let earth = words.pure ? "" : JournalWave.earthTick(tick.time, level: s.level, earth: words.earth)
            let label = cache.labels.label("f|\(s.level)|\(name)|\(earth)", scale: scale) {
                HStack(spacing: 6) {
                    Text(verbatim: name).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.levelColor(s.level, lightness: 0.76))
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
            let box = covered(left) <= covered(right) ? left : right
            var faded = context
            faded.opacity = s.weight
            faded.draw(label.image, in: box)
        }
    }

    /// Cycle starts in the margin, coarse levels first, as many as fit.
    func drawMargin(_ context: inout GraphicsContext, _ strands: [JournalWaveStrand], _ p0: Double?, _ p1: Double?, h: Double, margin: Double) {
        guard let p0, let p1 else { return }
        let scale = context.environment.displayScale
        var taken: [Double] = []
        var drawn = 0
        for s in strands where s.cyclePoints >= 34 && s.weight > 0.35 {
            var marks = Path()
            var faded = context
            faded.opacity = s.weight
            for tick in JournalWave.ticks(s, from: p0, to: p1, limit: 80) {
                let y = frame.y(tick.time)
                guard y > -8, y < h + 8 else { continue }
                marks.move(to: CGPoint(x: margin - 4, y: y))
                marks.addLine(to: CGPoint(x: margin + 2, y: y))
                // the legend keeps the bottom left
                guard drawn < 44, y < h - 34, !taken.contains(where: { abs($0 - y) < 13 }) else { continue }
                taken.append(y)
                drawn += 1
                let text = cache.short(level: s.level, cycle: tick.cycle, notation: words.notation)
                let label = cache.labels.label("m|\(s.level)|\(text)", scale: scale) {
                    Text(verbatim: text).font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(Theme.levelColor(s.level, lightness: 0.7))
                }
                faded.draw(label.image, in: CGRect(x: margin - 8 - label.size.width, y: y - label.size.height / 2,
                                                   width: label.size.width, height: label.size.height))
            }
            context.stroke(marks, with: .color(Theme.levelColor(s.level, opacity: 0.7 * s.weight)), lineWidth: 1)
        }
    }

    /// The displayed moment: a line across, a dot on the wave, "Now" (or the moment, while travelling).
    func drawNow(_ context: inout GraphicsContext, _ point: (Double) -> JournalWavePoint, w: Double, h: Double, margin: Double) {
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
        let text = live ? "Now" : words.time(now, seconds: false)
        let label = cache.labels.label("n|\(live)|\(text)", scale: context.environment.displayScale) {
            Text(verbatim: text).font(.system(size: 10, weight: .semibold)).foregroundStyle(colour)
        }
        context.draw(label.image, in: CGRect(x: w - 8 - label.size.width, y: y - 3 - label.size.height, width: label.size.width, height: label.size.height))
    }

    /// The entries in view: placed, tethered to their wave point when set beside it, clusters with their count.
    @discardableResult
    func drawBadges(_ context: inout GraphicsContext, _ point: (Double) -> JournalWavePoint, w: Double, h: Double, margin: Double) -> [JournalWaveBadge] {
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
    func drawLegend(_ context: inout GraphicsContext, _ strands: [JournalWaveStrand], h: Double) {
        let letters = strands.filter { $0.weight > 0.15 }.map { (level: $0.level, opacity: min(1, ((0.3 + 0.7 * $0.weight) * 10).rounded() / 10)) }
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
