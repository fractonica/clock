import FractonicaKit
import SwiftUI

// Canvas drawing of the wave (src/ui/wave/draw.js). Every coordinate handed to the context is a stage point, projected
// in Double first, so zooming through any number of depths keeps full precision.

/// The fonts of the stage's labels.
enum WaveFont: Int {
    case label, labelBold, small, now

    /// The font at a scale (1 on a phone, a little larger on a big stage).
    func font(_ scale: Double = 1) -> Font {
        switch self {
        case .label: .system(size: 11 * scale, weight: .semibold)
        case .labelBold: .system(size: 12 * scale, weight: .bold)
        case .small: .system(size: 10 * scale, weight: .medium, design: .monospaced)
        case .now: .system(size: 12 * scale, weight: .bold).monospacedDigit()
        }
    }
}

extension WaveStage {
    /// Arcs with a radius above this many points are drawn as a polyline of their visible stretch.
    static let bigRadius = 3000.0

    // MARK: Helpers

    /// A level's colour (`lightness` in percent, as the web's theme); `grey` is the out-of-range ink.
    func color(_ level: Int, _ opacity: Double, _ lightness: Double = 64, grey: Bool = false) -> Color {
        let key = (grey ? 1 : 0) | ((level & 0x3F) << 1) | (Int((opacity * 100).rounded()) << 8) | (Int(lightness) << 16)
        if let c = colors[key] { return c }
        let c = grey
            ? Color(hue: 210, saturation: 0.14, lightness: min(80, lightness - 6) / 100, opacity: opacity)
            : Theme.levelColor(level, opacity: opacity, lightness: lightness / 100)
        if colors.count > 600 { colors.removeAll() }
        colors[key] = c
        return c
    }

    /// A cheap test of a projected arc against the stage.
    func visible(_ sa: WaveScreenArc, margin: Double = 24) -> Bool {
        if sa.r < 0.3 { return false }
        if sa.r > Self.bigRadius { return true }
        return !(sa.x + sa.r < -margin || sa.x - sa.r > size.width + margin || sa.y + sa.r < -margin || sa.y - sa.r > size.height + margin)
    }

    /// Adds the part [t0, t1] of a projected arc to a path (an arc, or a polyline for a circle far larger than the stage).
    func addArc(_ path: inout Path, _ sa: WaveScreenArc, _ t0: Double, _ t1: Double) {
        guard t1 > t0 else { return }
        if sa.r <= Self.bigRadius {
            let a0 = sa.a0 + sa.sweep * t0
            path.move(to: CGPoint(x: sa.x + sa.r * cos(a0), y: sa.y + sa.r * sin(a0)))
            path.addArc(center: CGPoint(x: sa.x, y: sa.y), radius: sa.r, startAngle: .radians(a0),
                        endAngle: .radians(sa.a0 + sa.sweep * t1), clockwise: sa.sweep < 0)
            return
        }
        let span = abs(sa.sweep)
        let near = sa.nearest(size.width / 2, size.height / 2, tMax: t1)
        let half = min(Double.pi, hypot(size.width, size.height) * 0.8 / sa.r + 0.01) / span
        let u0 = max(t0, near.t - half)
        let u1 = min(t1, near.t + half)
        guard u1 > u0 else { return }
        let n = 40
        for i in 0...n {
            let p = sa.point(u0 + (u1 - u0) * Double(i) / Double(n))
            if i == 0 { path.move(to: CGPoint(x: p.x, y: p.y)) } else { path.addLine(to: CGPoint(x: p.x, y: p.y)) }
        }
    }

    func stroke(_ g: inout GraphicsContext, _ path: Path, _ color: Color, _ width: Double, dash: [CGFloat] = []) {
        g.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round, dash: dash))
    }

    func circle(_ x: Double, _ y: Double, _ r: Double) -> Path {
        Path(ellipseIn: CGRect(x: x - r, y: y - r, width: 2 * r, height: 2 * r))
    }

    /// The width of a label, measured on a stand-in with every digit as "0" (a ticking number never changes size).
    func textWidth(_ g: GraphicsContext, _ text: String, _ font: WaveFont) -> Double {
        let stand = String(text.map { $0.isNumber && $0.isASCII ? "0" : $0 })
        let key = "\(font.rawValue)|\(fontScale)|\(stand)"
        if let w = widths[key] { return w }
        let w = Double(g.resolve(Text(stand).font(font.font(fontScale))).measure(in: CGSize(width: 4000, height: 200)).width)
        if widths.count > 600 { widths.removeAll() }
        widths[key] = w
        return w
    }

    /// A label at a fixed spot; its rectangle is marked taken (softly: a loop number under the time label is fine).
    func label(_ g: GraphicsContext, _ text: String, at x: Double, _ y: Double, color: Color, font: WaveFont, opacity: Double,
               anchor: UnitPoint = .center, weight: Double = WaveLabelPlacer.soft) {
        let w = textWidth(g, text, font)
        let x0 = anchor == .leading ? x : anchor == .trailing ? x - w : x - w / 2
        let rect = WaveRect(x0: x0 - 3, y0: y - 8 * fontScale, x1: x0 + w + 3, y1: y + 8 * fontScale)
        labels.occupy(rect, weight: weight)
        queue.append(QueuedLabel(text: text, at: CGPoint(x: x, y: y), color: color, font: font.font(fontScale), opacity: opacity * labelFade,
                                 anchor: anchor, rect: WaveRect(x0: x0, y0: y - 5 * fontScale, x1: x0 + w, y1: y + 5 * fontScale),
                                 yields: weight < 1))
    }

    /// A label beside a point, on the side with room (`WaveLabelPlacer`).
    @discardableResult
    func placedLabel(_ g: GraphicsContext, key: String, _ text: String, at x: Double, _ y: Double, normal: WavePoint, color: Color,
                     font: WaveFont, opacity: Double, clearance: Double = 12, weight: Double = 1) -> WaveLabelPlacer.Spot {
        let w = textWidth(g, text, font)
        let spot = labels.place(key: key, text: text, width: w, at: WavePoint(x: x, y: y), normal: normal,
                                clearance: clearance, weight: weight)
        let c = spot.center
        queue.append(QueuedLabel(text: text, at: CGPoint(x: c.x, y: c.y), color: color, font: font.font(fontScale), opacity: opacity * labelFade,
                                 rect: WaveRect(x0: c.x - w / 2 - 2, y0: c.y - 7 * fontScale, x1: c.x + w / 2 + 2, y1: c.y + 7 * fontScale)))
        return spot
    }

    /// Draws the queued labels on top, each with a dark halo so it reads over any arc.
    func flushLabels(_ g: inout GraphicsContext) {
        guard !queue.isEmpty else { return }
        // a fixed label that a placed one (the time, a level letter) ended up on gives way, so no two labels ever overlap
        let placed = queue.filter { !$0.yields && $0.rect.width > 0 }.map(\.rect)
        let items = placed.isEmpty ? queue : queue.filter { q in !q.yields || !placed.contains { $0.overlap(q.rect) > 0 } }
        g.drawLayer { layer in
            layer.addFilter(.shadow(color: Theme.background.opacity(0.95), radius: 1.2))
            layer.addFilter(.shadow(color: Theme.background.opacity(0.7), radius: 2.6))
            for q in items {
                var l = layer
                l.opacity = q.opacity
                l.draw(Text(q.text).font(q.font).foregroundStyle(q.color), at: q.at, anchor: q.anchor)
            }
        }
    }

    /// Where the segment from an inside point towards (x1, y1) leaves the stage inset by `inset`.
    func clipToStage(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double, inset: Double) -> (Double, Double) {
        let dx = x1 - x0
        let dy = y1 - y0
        var t = 1.0
        if dx > 0 { t = min(t, (size.width - inset - x0) / dx) } else if dx < 0 { t = min(t, (inset - x0) / dx) }
        if dy > 0 { t = min(t, (size.height - inset - y0) / dy) } else if dy < 0 { t = min(t, (inset - y0) / dy) }
        t = max(0, t)
        return (x0 + dx * t, y0 + dy * t)
    }

    /// Moves an edge badge off the floating controls, the shortest way that stays on the stage.
    func dodge(_ p: (Double, Double), _ avoid: [WaveRect], inset: Double) -> (Double, Double) {
        var (x, y) = p
        for _ in 0..<2 {
            for r in avoid where r.contains(x, y) {
                let moves: [(Double, Double)] = [(r.x0 - 14 - x, 0), (r.x1 + 14 - x, 0), (0, r.y0 - 14 - y), (0, r.y1 + 14 - y)]
                let fits = moves.filter { m in
                    let nx = x + m.0
                    let ny = y + m.1
                    return nx >= inset && nx <= size.width - inset && ny >= inset && ny <= size.height - inset
                }
                if let m = fits.min(by: { abs($0.0) + abs($0.1) < abs($1.0) + abs($1.1) }) {
                    x += m.0
                    y += m.1
                }
            }
        }
        return (x, y)
    }

    func drawMarker(_ g: inout GraphicsContext, _ x: Double, _ y: Double, level: Int, emphasis: Bool, size s: Double, grey: Bool) {
        if emphasis {
            let r = s * 3.4
            g.fill(circle(x, y, r), with: .radialGradient(
                Gradient(colors: [color(level, 0.55, 70, grey: grey), color(level, 0, 70, grey: grey)]),
                center: CGPoint(x: x, y: y), startRadius: 0, endRadius: r))
        }
        g.fill(circle(x, y, s + 1.6), with: .color(Theme.background.opacity(0.9)))
        g.fill(circle(x, y, s), with: .color(color(level, 1, emphasis ? 72 : 66, grey: grey)))
        if emphasis { g.fill(circle(x, y, s * 0.36), with: .color(.white)) }
    }

    // MARK: Scenes

    func drawScene(_ g: inout GraphicsContext, _ scene: WaveScene, _ cam: WaveCamera, alpha: Double, interactive: Bool, quiet: Bool,
                   _ input: WaveFrameInput) {
        let view = WaveProjection(cam, width: size.width, height: size.height)
        var layer = g
        layer.opacity = alpha
        switch scene {
        case .focus(let f): drawFocus(&layer, f, view, alpha: alpha, interactive: interactive, quiet: quiet, input)
        case .overview(let o): drawOverview(&layer, o, view, alpha: alpha, interactive: interactive, quiet: quiet, input)
        }
    }

    /// The displayed time written next to the focus marker (empty when the scene is not the one the time is in).
    private func nowLabel(_ scene: WaveScene, _ input: WaveFrameInput) -> String {
        guard inRange, let cur else { return "" }
        switch scene {
        case .overview: return input.words.nowLabel(lastT, level: 0, overview: true)
        case .focus(let f):
            guard cur[f.level].idx == f.idx else { return "" }
            return input.words.nowLabel(lastT, level: f.level, duration: f.info.duration)
        }
    }

    // MARK: Focus

    /// A focus scene: the focused half-arc, its numbered children and its grandchildren, the stretch of the parent it
    /// stands on, the solar ripple, and one marker per level joined by tethers (off-stage ones become lettered badges).
    private func drawFocus(_ g: inout GraphicsContext, _ s: WaveFocusScene, _ view: WaveProjection, alpha: Double, interactive: Bool,
                           quiet: Bool, _ input: WaveFrameInput) {
        let level = s.level
        let grey = !inRange
        let hover = interactive ? self.hover : nil
        func hovered(_ kind: WavePick.Kind, _ l: Int, _ idx: Int64) -> Bool {
            hover.map { $0.kind == kind && $0.level == l && $0.idx == idx } ?? false
        }
        let cur = self.cur.flatMap { $0.count > level + 2 ? $0 : nil }

        // the parent: the stretch of its circle this arc stands on
        if let a = s.ancestors.first {
            let pa = view.arc(a.arc)
            if visible(pa, margin: 60) {
                var whole = Path()
                addArc(&whole, pa, 0, a.fraction)
                stroke(&g, whole, color(a.level, 0.13, 62, grey: grey), 1.2)
                var slot = Path()
                addArc(&slot, pa, Double(a.slotJ) / Double(a.slotM), min(a.fraction, Double(a.slotJ + 1) / Double(a.slotM)))
                stroke(&g, slot, color(a.level, 0.7, 62, grey: grey), 2)
            }
        }

        // grandchildren: faint, batched by state
        let cg = cur?[level + 2]
        if !s.grand.isEmpty {
            var past = Path()
            var future = Path()
            var now: WaveLoop?
            for gr in s.grand {
                if let cg, gr.idx == cg.idx {
                    now = gr
                    continue
                }
                let sa = view.arc(gr.arc)
                guard visible(sa) else { continue }
                if let cg, WaveGeometry.travelled(gr.idx, cg) >= 1 { addArc(&past, sa, 0, gr.fraction) } else { addArc(&future, sa, 0, gr.fraction) }
            }
            stroke(&g, future, color(level + 2, 0.2, 62, grey: grey), 1)
            stroke(&g, past, color(level + 2, 0.42, 62, grey: grey), 1.1)
            if let now, let cg {
                let sa = view.arc(now.arc)
                if visible(sa) {
                    var rest = Path()
                    addArc(&rest, sa, cg.local, now.fraction)
                    stroke(&g, rest, color(level + 2, 0.32, 62, grey: grey), 1.3)
                    var done = Path()
                    addArc(&done, sa, 0, min(cg.local, now.fraction))
                    stroke(&g, done, color(level + 2, 0.95, 66, grey: grey), 1.9)
                }
            }
        }

        // hit targets: the focused arc first (it wins ties), then its children
        let sf = view.arc(s.focus)
        if interactive { hitArcs.append(HitArc(kind: .focus, level: level, idx: s.idx, sa: sf, fraction: s.fraction)) }

        // children
        let cc = cur?[level + 1]
        for c in s.children {
            let sa = view.arc(c.arc)
            if interactive { hitArcs.append(HitArc(kind: .child, level: c.level, idx: c.idx, sa: sa, fraction: c.fraction)) }
            guard visible(sa) else { continue }
            let w = 1.9
            if let cc, c.idx == cc.idx {
                var rest = Path()
                addArc(&rest, sa, min(cc.local, c.fraction), c.fraction)
                stroke(&g, rest, color(c.level, 0.4, 64, grey: grey), w)
                var done = Path()
                addArc(&done, sa, 0, min(cc.local, c.fraction))
                stroke(&g, done, color(c.level, 1, 68, grey: grey), w + 1)
            } else {
                let tr = cc.map { WaveGeometry.travelled(c.idx, $0) } ?? 0
                var p = Path()
                addArc(&p, sa, 0, c.fraction)
                stroke(&g, p, color(c.level, tr >= 1 ? 0.78 : 0.3, tr >= 1 ? 64 : 62, grey: grey), w)
            }
            if hovered(.child, c.level, c.idx) {
                var p = Path()
                addArc(&p, sa, 0, c.fraction)
                stroke(&g, p, .white.opacity(0.75), w + 2)
            }
        }

        // the focused arc: bright up to the displayed time, dim after it
        let fcur = cur?[level]
        let markers = cur.map { engine.markers(s, $0) } ?? []
        let trF = fcur.map { min(s.fraction, WaveGeometry.travelled(s.idx, $0)) } ?? 0

        // where the markers land, and the badges of those off the stage (or under a floating control), worked out
        // before any label so the labels keep clear of the badges
        let inset = 15.0
        struct Pt {
            var m: WaveMarker
            var x: Double
            var y: Double
            var inside: Bool
        }
        let pts: [Pt] = markers.map { m in
            let p = view.point(m.x, m.y)
            let onStage = p.x >= inset && p.x <= size.width - inset && p.y >= inset && p.y <= size.height - inset
            return Pt(m: m, x: p.x, y: p.y, inside: onStage && !input.avoid.contains { $0.contains(p.x, p.y) })
        }
        var badges: [(x: Double, y: Double, m: WaveMarker)] = []
        var tethers: [(x0: Double, y0: Double, x1: Double, y1: Double, level: Int)] = []
        for i in 1..<max(1, pts.count) {
            let a = pts[i - 1]
            let b = pts[i]
            if !a.inside && !b.inside { continue }
            var (x0, y0, x1, y1) = (a.x, a.y, b.x, b.y)
            if !a.inside {
                (x0, y0) = dodge(clipToStage(b.x, b.y, a.x, a.y, inset: inset), input.avoid, inset: inset)
                badges.append((x0, y0, a.m))
            } else if !b.inside {
                (x1, y1) = dodge(clipToStage(a.x, a.y, b.x, b.y, inset: inset), input.avoid, inset: inset)
                badges.append((x1, y1, b.m))
            }
            tethers.append((x0, y0, x1, y1, b.m.level))
        }
        /// A fixed label at (x, y) would sit on a badge: it gives way (the badge is a control).
        func underBadge(_ x: Double, _ y: Double) -> Bool {
            badges.contains { abs($0.x - x) < 26 && abs($0.y - y) < 19 }
        }
        if !quiet {
            for b in badges { labels.occupy(WaveRect(x0: b.x - 12, y0: b.y - 12, x1: b.x + 12, y1: b.y + 12)) }
        }
        if visible(sf) {
            var rest = Path()
            addArc(&rest, sf, trF, s.fraction)
            stroke(&g, rest, color(level, 0.34, 64, grey: grey), 3)
            if trF > 0 {
                var done = Path()
                addArc(&done, sf, 0, trF)
                stroke(&g, done, color(level, 0.12, 62, grey: grey), 11)
                stroke(&g, done, color(level, 0.22, 62, grey: grey), 6.5)
                stroke(&g, done, color(level, 1, 68, grey: grey), 3.4)
            }
            if hovered(.focus, level, s.idx) {
                var p = Path()
                addArc(&p, sf, 0, s.fraction)
                stroke(&g, p, .white.opacity(0.55), 4.6)
            }
            // quarter ticks: the start, apex and end of the half-arc, with their event names
            let fm = markers.first { $0.level == level }.map { view.point($0.x, $0.y) }
            var ticks = Path()
            for k in 0..<3 {
                let t = Double(k) / 2
                if t > s.fraction + 1e-9 { continue }
                let p = sf.point(t)
                let n = sf.normal(t)
                ticks.move(to: CGPoint(x: p.x - n.x * 6, y: p.y - n.y * 6))
                ticks.addLine(to: CGPoint(x: p.x + n.x * 6, y: p.y + n.y * 6))
                if !quiet, !(fm.map { hypot(p.x - $0.x, p.y - $0.y) < 22 } ?? false), !underBadge(p.x + n.x * 17, p.y + n.y * 17) {
                    label(g, s.info.marks[k], at: p.x + n.x * 17, p.y + n.y * 17, color: Theme.ink2, font: .small, opacity: alpha)
                }
            }
            stroke(&g, ticks, color(level, 0.9, 74, grey: grey), 1.6)
        }

        // the solar ripple rides the focused arc
        var ripple: (fit: WaveSolar.Fit, amp: Double)?
        if input.solar, inRange, let sun = sunSync, visible(sf) {
            ripple = drawRipple(&g, s, sf, travelled: trF, sync: sun.sync, quarter: sun.quarter, quiet: quiet, alpha: alpha)
        }

        // child numbers (signed: + crest, − trough)
        if !quiet {
            for c in s.children {
                let sa = view.arc(c.arc)
                guard sa.r >= 7, visible(sa) else { continue }
                let p = sa.point(c.fraction / 2)
                let n = sa.normal(c.fraction / 2)
                if underBadge(p.x + n.x * 12, p.y + n.y * 12) { continue }
                let lit = (cc.map { c.idx == $0.idx } ?? false) || hovered(.child, c.level, c.idx)
                label(g, WaveGeometry.signedLabel(c.j + 1, sweep: c.arc.sweep), at: p.x + n.x * 12, p.y + n.y * 12,
                      color: lit ? .white : color(c.level, 0.9, 74, grey: grey), font: lit ? .labelBold : .label, opacity: alpha)
            }
        }

        // the solar pin (behind the level markers)
        if let ripple, let sun = sunSync, let fcur, fcur.idx == s.idx {
            drawPin(&g, s, sf, pNow: fcur.local, sync: sun.sync, ripple: ripple, hovered: hovered(.sun, -1, 0), quiet: quiet,
                    interactive: interactive, alpha: alpha, input)
        }

        // markers and tethers, coarse to fine
        guard !markers.isEmpty else { return }
        if interactive {
            for q in pts where q.inside { hitMarkers.append(HitMarker(level: q.m.level, idx: q.m.idx, local: q.m.local, x: q.x, y: q.y)) }
        }
        for t in tethers {
            var tether = Path()
            tether.move(to: CGPoint(x: t.x0, y: t.y0))
            tether.addLine(to: CGPoint(x: t.x1, y: t.y1))
            stroke(&g, tether, color(t.level, 0.6, 68, grey: grey), 1.2, dash: t.level <= level ? [3, 3] : [])
        }
        // fine markers first, so the coarse ones stay on top of the cluster
        var nowAt: (Double, Double)?
        for q in pts.reversed() where q.inside {
            if interactive { noteMotion(level: q.m.level, arcPoints: view.arc(q.m.arc).length()) }
            let emph = q.m.level == level
            let size = emph ? 6.2 : q.m.level < level ? 4.4 : max(2.2, 4 - Double(q.m.level - level) * 0.45)
            drawMarker(&g, q.x, q.y, level: q.m.level, emphasis: emph, size: size, grey: grey)
            if let hover, hover.kind == .marker, hover.level == q.m.level {
                stroke(&g, circle(q.x, q.y, size + 5), .white.opacity(0.8), 1.5)
            }
            if emph { nowAt = (q.x, q.y) }
        }
        if !quiet {
            // the focus dot and the coarser ones are fixed points for the labels; the finer ones orbit too fast to dodge
            for q in pts where q.inside && q.m.level <= level {
                labels.occupy(WaveRect(x0: q.x - 9, y0: q.y - 9, x1: q.x + 9, y1: q.y + 9))
            }
            // colour alone must not name a level: a dot away from the focus marker carries its letter
            if let f = pts.first(where: { $0.m.level == level && $0.inside }) {
                for q in pts where q.inside && q.m.level != level && hypot(q.x - f.x, q.y - f.y) >= 56 {
                    let c = view.point(q.m.arc.cx, q.m.arc.cy)
                    let len = max(1e-9, hypot(q.x - c.x, q.y - c.y))
                    placedLabel(g, key: "lv\(q.m.level)", Fractonica.periodName(q.m.level).text, at: q.x, q.y,
                                normal: WavePoint(x: (q.x - c.x) / len, y: (q.y - c.y) / len), color: color(q.m.level, 1, 74, grey: grey),
                                font: .labelBold, opacity: alpha, clearance: 8, weight: WaveLabelPlacer.soft)
                }
            }
            let text = nowLabel(.focus(s), input)
            if interactive, !text.isEmpty { noteLabel(level: level, duration: s.info.duration, pure: input.words.pure) }
            if let (x, y) = nowAt, !text.isEmpty {
                let len = max(1e-9, hypot(x - sf.x, y - sf.y))
                placedLabel(g, key: "now", text, at: x, y, normal: WavePoint(x: (x - sf.x) / len, y: (y - sf.y) / len), color: .white,
                            font: .now, opacity: alpha)
            }
        }
        for b in badges {
            if interactive { hitMarkers.append(HitMarker(level: b.m.level, idx: b.m.idx, local: b.m.local, x: b.x, y: b.y)) }
            g.fill(circle(b.x, b.y, 9.5), with: .color(Theme.background2.opacity(0.92)))
            stroke(&g, circle(b.x, b.y, 9.5), color(b.m.level, 0.95, 66, grey: grey), 1.4)
            g.draw(Text(Fractonica.periodName(b.m.level).text).font(WaveFont.labelBold.font(fontScale)).foregroundStyle(color(b.m.level, 1, 74, grey: grey)),
                   at: CGPoint(x: b.x, y: b.y + 0.5), anchor: .center)
            if let hover, hover.kind == .marker, hover.level == b.m.level {
                stroke(&g, circle(b.x, b.y, 13), .white.opacity(0.8), 1.5)
            }
        }
    }

    // MARK: The solar sync

    private func gold(_ a: Double) -> Color { Theme.gold.opacity(a) }

    /// The ripple along the focused arc: one yellow wave per sync, bright up to the displayed time, with a dot on every
    /// quarter of the syncs it crosses (or of the present sync only when the wave is tight).
    private func drawRipple(_ g: inout GraphicsContext, _ s: WaveFocusScene, _ sf: WaveScreenArc, travelled: Double, sync: Int, quarter: Int,
                            quiet: Bool, alpha: Double) -> (fit: WaveSolar.Fit, amp: Double)? {
        let spec = WaveSolar.ArcSpec(idx: s.idx, prefix: engine.prefix(s.level), fraction: s.fraction)
        let fit = WaveSolar.rippleFit(syncs: WaveSolar.syncsOnArc(prefix: spec.p, fraction: s.fraction, grid: grid), arcPx: sf.length(s.fraction))
        guard fit.visible else { return nil }
        let amp = WaveSolar.rippleAmp(fit.wavelength)
        let pts = WaveSolar.polyline(sf, spec, grid, amp: amp)
        let n = pts.count - 1
        let split = WaveSolar.split(n: n, travelled: travelled, fraction: s.fraction)
        func path(_ i0: Int, _ i1: Int) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: pts[i0].x, y: pts[i0].y))
            if i1 > i0 { for i in (i0 + 1)...i1 { p.addLine(to: CGPoint(x: pts[i].x, y: pts[i].y)) } }
            return p
        }
        var l = g
        l.opacity *= fit.strength
        if split < n { stroke(&l, path(split, n), gold(0.5), 1.3) }
        if split > 0 { stroke(&l, path(0, split), gold(0.92), 1.5) }
        let quarterW = fit.wavelength / 4
        for m in WaveSolar.quarterMarks(spec, grid, only: quarterW >= 40 ? nil : sync) {
            let pt = WaveSolar.point(sf, spec, grid, min(s.fraction, max(0, m.p)), amp: amp)
            let passed = m.sync < sync || (m.sync == sync && m.k <= quarter)
            let next = m.sync == sync && m.k == quarter + 1
            let dot = circle(pt.x, pt.y, next ? 3.2 : 2.2)
            if passed {
                l.fill(dot, with: .color(gold(0.85)))
            } else {
                l.fill(dot, with: .color(Theme.background2.opacity(0.9)))
                stroke(&l, dot, gold(next ? 1 : 0.6), next ? 1.6 : 1.1)
            }
            if !quiet && m.sync == sync && quarterW >= 46 {
                placedLabel(l, key: "sq\(m.k)", m.name, at: pt.x, pt.y, normal: WavePoint(x: pt.nx, y: pt.ny), color: gold(next ? 1 : 0.78),
                            font: .small, opacity: alpha * fit.strength, clearance: 7, weight: WaveLabelPlacer.soft)
            }
        }
        return (fit, amp)
    }

    /// The solar pin: a yellow head floating off the ripple at the displayed time (never hiding the focus dot), with the
    /// sync number beside it. Dragging it travels within the sync.
    private func drawPin(_ g: inout GraphicsContext, _ s: WaveFocusScene, _ sf: WaveScreenArc, pNow: Double, sync: Int,
                         ripple: (fit: WaveSolar.Fit, amp: Double), hovered: Bool, quiet: Bool, interactive: Bool, alpha: Double,
                         _ input: WaveFrameInput) {
        let spec = WaveSolar.ArcSpec(idx: s.idx, prefix: engine.prefix(s.level), fraction: s.fraction)
        let pin = WaveSolar.pin(sf, spec, grid, pNow: pNow, amp: ripple.amp)
        let hx = pin.head.x
        let hy = pin.head.y
        guard hx >= 9, hy >= 9, hx <= size.width - 9, hy <= size.height - 9 else { return }
        var l = g
        l.opacity *= ripple.fit.strength
        var stem = Path()
        stem.move(to: CGPoint(x: pin.foot.x, y: pin.foot.y))
        stem.addLine(to: CGPoint(x: hx - pin.nx * 4, y: hy - pin.ny * 4))
        stroke(&l, stem, gold(0.85), 1.3)
        l.fill(circle(hx, hy, 12), with: .radialGradient(Gradient(colors: [gold(0.5), gold(0)]), center: CGPoint(x: hx, y: hy), startRadius: 0, endRadius: 12))
        l.fill(circle(hx, hy, 5.6), with: .color(Theme.background.opacity(0.92)))
        l.fill(circle(hx, hy, 4), with: .color(Theme.gold))
        if hovered { stroke(&l, circle(hx, hy, 9.5), .white.opacity(0.8), 1.5) }
        labels.occupy(WaveRect(x0: hx - 8, y0: hy - 8, x1: hx + 8, y1: hy + 8))
        if !quiet {
            placedLabel(l, key: "sun", input.words.sunNumber(sync), at: hx, hy, normal: WavePoint(x: pin.nx, y: pin.ny), color: Theme.gold,
                        font: .small, opacity: alpha * ripple.fit.strength, clearance: 8)
        }
        if interactive { hitSun = WavePoint(x: hx, y: hy) }
    }

    // MARK: The catalogue

    /// The catalogue: the 35 α half-arcs wrapped into rows, their β and γ loops faintly, the eclipses with their years
    /// (numbers in pure mode) and the markers of the first levels.
    private func drawOverview(_ g: inout GraphicsContext, _ ov: WaveOverviewScene, _ view: WaveProjection, alpha: Double, interactive: Bool,
                              quiet: Bool, _ input: WaveFrameInput) {
        let grey = !inRange
        let k = view.k
        let alphaArcs = ov.levels[0]
        let hover = interactive ? self.hover : nil

        // a dotted baseline per row, so crests and troughs read as one wave
        var base = Path()
        for row in 0..<ov.layout.rows {
            let a = view.point(0, Double(row) * ov.layout.rowPitch)
            let b = view.point(2 * Double(ov.layout.cols), Double(row) * ov.layout.rowPitch)
            base.move(to: CGPoint(x: a.x, y: a.y))
            base.addLine(to: CGPoint(x: b.x, y: b.y))
        }
        stroke(&g, base, Theme.ink2.opacity(0.12), 1, dash: [2, 6])

        // faint structure first: γ, then β
        for l in stride(from: 2, through: 1, by: -1) {
            let list = ov.levels[l]
            guard let first = list.first, first.arc.radius * k >= 1.1 else { continue }
            let curH = cur?[l]
            var past = Path()
            var future = Path()
            for e in list {
                let sa = view.arc(e.arc)
                guard visible(sa) else { continue }
                if let curH, WaveGeometry.travelled(e.idx, curH) >= 1 { addArc(&past, sa, 0, e.fraction) } else { addArc(&future, sa, 0, e.fraction) }
            }
            stroke(&g, future, color(l, l == 1 ? 0.28 : 0.15, 62, grey: grey), 1)
            stroke(&g, past, color(l, l == 1 ? 0.55 : 0.3, 62, grey: grey), 1)
        }

        // α: past brighter, future dim, the current one thick
        let cur0 = inRange ? cur?[0] : nil
        var past0 = Path()
        var future0 = Path()
        for e in alphaArcs {
            let sa = view.arc(e.arc)
            if interactive { hitArcs.append(HitArc(kind: .alpha, level: 0, idx: e.idx, sa: sa, fraction: e.fraction)) }
            if let cur0, e.idx == cur0.idx { continue }
            if let cur0, WaveGeometry.travelled(e.idx, cur0) >= 1 { addArc(&past0, sa, 0, e.fraction) } else { addArc(&future0, sa, 0, e.fraction) }
        }
        stroke(&g, future0, color(0, 0.4, 66, grey: grey), 2)
        stroke(&g, past0, color(0, 0.85, 66, grey: grey), 2.2)
        if let hover, hover.kind == .alpha, hover.idx >= 0, hover.idx < Int64(alphaArcs.count) {
            let e = alphaArcs[Int(hover.idx)]
            var p = Path()
            addArc(&p, view.arc(e.arc), 0, e.fraction)
            stroke(&g, p, .white.opacity(0.6), 4)
        }
        if let cur0, let cur, cur0.idx < Int64(alphaArcs.count) {
            let e = alphaArcs[Int(cur0.idx)]
            let sa = view.arc(e.arc)
            var rest = Path()
            addArc(&rest, sa, cur0.local, e.fraction)
            stroke(&g, rest, color(0, 0.45, 66), 3)
            var done = Path()
            addArc(&done, sa, 0, min(cur0.local, e.fraction))
            stroke(&g, done, color(0, 0.14, 62), 11)
            stroke(&g, done, color(0, 0.25, 62), 6.5)
            stroke(&g, done, color(0, 1, 70), 3.6)
            // the β half-arc we are inside, thicker
            let c1 = cur[1]
            if c1.idx < Int64(ov.levels[1].count) {
                let e1 = ov.levels[1][Int(c1.idx)]
                let s1 = view.arc(e1.arc)
                var r1 = Path()
                addArc(&r1, s1, c1.local, e1.fraction)
                stroke(&g, r1, color(1, 0.5, 66), 2)
                var d1 = Path()
                addArc(&d1, s1, 0, min(c1.local, e1.fraction))
                stroke(&g, d1, color(1, 1, 68), 2.6)
            }
        }

        // eclipses: the junctions carry their year (pure: their number), the apexes are the eclipses between
        if years.key.isEmpty {
            let e = input.words.eclipses()
            years = ("set", e.marks, e.end)
        }
        let stepLabel = k * 2 < 46 ? 2 : 1
        let dotColor = grey ? Theme.ink3.opacity(0.6) : Theme.ink2
        let midColor = grey ? Theme.ink3.opacity(0.4) : Theme.ink3
        var dots = Path()
        var mids = Path()
        for e in alphaArcs {
            let sa = view.arc(e.arc)
            let p0 = sa.point(0)
            dots.addPath(circle(p0.x, p0.y, 2.2))
            if !quiet, Int(e.idx) % stepLabel == 0, Int(e.idx) < years.marks.count {
                let crest = e.idx % 2 == 0
                label(g, years.marks[Int(e.idx)], at: p0.x + 4, p0.y + (crest ? 12 : -11), color: Theme.ink3, font: .small, opacity: alpha, anchor: .leading)
            }
            if e.fraction >= 0.5 {
                let pm = sa.point(0.5)
                mids.addPath(circle(pm.x, pm.y, 1.6))
            }
            if e.fraction < 1 {
                let pe = sa.point(e.fraction)
                dots.addPath(circle(pe.x, pe.y, 2.2))
                if !quiet {
                    label(g, years.end, at: pe.x + 5, pe.y + (e.idx % 2 == 0 ? -11 : 12), color: Theme.ink3, font: .small, opacity: alpha, anchor: .leading)
                }
            }
        }
        g.fill(dots, with: .color(dotColor))
        g.fill(mids, with: .color(midColor))

        // the markers of the levels big enough to see, joined by tethers
        if let cur, inRange {
            let mk = engine.overviewMarkers(ov, cur, scale: k)
            let pts = mk.map { m -> (m: WaveMarker, x: Double, y: Double) in
                let p = view.point(m.x, m.y)
                return (m, p.x, p.y)
            }
            if interactive { for q in pts { hitMarkers.append(HitMarker(level: q.m.level, idx: q.m.idx, local: q.m.local, x: q.x, y: q.y)) } }
            for i in pts.indices.dropFirst() {
                var p = Path()
                p.move(to: CGPoint(x: pts[i - 1].x, y: pts[i - 1].y))
                p.addLine(to: CGPoint(x: pts[i].x, y: pts[i].y))
                stroke(&g, p, color(pts[i].m.level, 0.7, 68), 1.2)
            }
            for q in pts.reversed() {
                if interactive { noteMotion(level: q.m.level, arcPoints: view.arc(q.m.arc).length()) }
                let emph = q.m.level == 0
                drawMarker(&g, q.x, q.y, level: q.m.level, emphasis: emph, size: emph ? 6 : max(2.4, 4.2 - Double(q.m.level) * 0.8), grey: false)
                if let hover, hover.kind == .marker, hover.level == q.m.level { stroke(&g, circle(q.x, q.y, 11), .white.opacity(0.8), 1.5) }
            }
            let text = nowLabel(.overview(ov), input)
            if interactive, !text.isEmpty { noteLabel(level: 0, duration: .infinity, pure: input.words.pure) }
            if !quiet, !text.isEmpty, let q = pts.first, q.x >= 0, q.x <= size.width, q.y >= 0, q.y <= size.height {
                labels.occupy(WaveRect(x0: q.x - 10, y0: q.y - 10, x1: q.x + 10, y1: q.y + 10))
                placedLabel(g, key: "now-all", text, at: q.x, q.y, normal: WavePoint(x: 0, y: -1), color: .white, font: .now, opacity: alpha)
            }
        }
        if !inRange, !quiet, interactive, let first = alphaArcs.first, let last = alphaArcs.last {
            let before = lastT < engine.clock.tMin
            let e = before ? first : last
            let p = view.arc(e.arc).point(before ? 0 : e.fraction)
            drawEdgeMarker(&g, p.x, p.y, text: before ? "before the first eclipse" : "after the last eclipse")
        }
    }

    /// A ring and a caption at a catalogue edge: where the displayed time is when it is out of range.
    private func drawEdgeMarker(_ g: inout GraphicsContext, _ x: Double, _ y: Double, text: String) {
        stroke(&g, circle(x, y, 8), Theme.now, 2)
        g.fill(circle(x, y, 3), with: .color(Theme.now))
        let w = textWidth(g, text, .labelBold)
        // every label placed so far is a hard obstacle for this caption
        let spot = labels.place(key: "edge", text: text, width: w + 8, at: WavePoint(x: x, y: y), normal: WavePoint(x: 0, y: -1), clearance: 12)
        let rect = CGRect(x: spot.center.x - w / 2 - 6, y: spot.center.y - 10, width: w + 12, height: 20)
        g.fill(Path(roundedRect: rect, cornerRadius: 6), with: .color(Theme.background2.opacity(0.92)))
        g.draw(Text(text).font(WaveFont.labelBold.font(fontScale)).foregroundStyle(Theme.now), at: CGPoint(x: spot.center.x, y: spot.center.y), anchor: .center)
    }
}
