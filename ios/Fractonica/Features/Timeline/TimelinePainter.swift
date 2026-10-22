import FractonicaKit
import SwiftUI

/// The axis of a frame: Gregorian steps in Earth mode, the unit ruler in pure mode.
enum TimelineAxisStep: Equatable {
    case gregorian(GregorianStep)
    case ruler(TimelineRuler.Step)

    var rulerUnit: Int? {
        if case .ruler(let s) = self { return s.u }
        return nil
    }
}

/// What is under the pointer or the finger while inspecting.
struct TimelineHover: Equatable {
    var x: Double
    var y: Double
    /// A finger (long press): the card goes above it.
    var touch: Bool
}

/// Something the read-out shows.
enum TimelineSelection: Hashable {
    case cycle(level: Int, idx: Int64)
    case eclipse(Int)
}

/// One frame's inputs: everything the painter draws from, read in the view's body (never inside the renderer).
struct TimelineFrame {
    let layout: TimelineLayout
    let window: TimelineWindow
    let scale: TimelineScale
    let cursor: Double
    let cursorIn: Bool
    let live: Bool
    let now: Double
    let nowShow: Bool
    let levels: [Int]
    let selected: Int
    let words: TimelineWords
    let axis: TimelineAxisStep
    /// The year the short labels leave out (the cursor's), Earth mode.
    let refYear: Int
    let hover: TimelineHover?
    /// One device pixel in points.
    let pixel: CGFloat
    /// Dynamic Type scale of the canvas labels (1 … 1.3).
    let textScale: CGFloat
    let highlight: TimelineSelection?

    var pure: Bool { words.pure }
    var k: Double { scale.k }
    var rulerUnit: Int { axis.rulerUnit ?? TimelineRuler.iota }
}

/// What the input layer can hit: chips, the cursor flag (drag it to scrub) and the map's window frame. Filled by the
/// painter each frame; read by gestures. Not observed.
@MainActor
final class TimelineHitMap {
    enum Action: Equatable {
        case reveal(Double, right: Bool)
        case centreCursor
        case centreNow
    }

    struct Chip {
        let rect: CGRect
        let action: Action
        let label: String
    }

    var chips: [Chip] = []
    var cursorFlag: CGRect?
    var overviewFrame: CGRect?
    /// The labelled ticks of the axis in view, sorted: a tap on the ruler snaps to them.
    var ticks: [Double] = []

    func reset() {
        chips.removeAll(keepingCapacity: true)
        ticks.removeAll(keepingCapacity: true)
        cursorFlag = nil
        overviewFrame = nil
    }

    func chip(at p: CGPoint, slop: CGFloat) -> Chip? {
        chips.last { $0.rect.insetBy(dx: -slop, dy: -slop).contains(p) }
    }
}

/// Draws one frame of the timeline into a Core Graphics context (y down), top to bottom: the catalogue map, the lane
/// backdrop, the lanes, the eclipse lane, the outside of the catalogue, the axis, the cursor and now markers, the lane
/// heads and the chips (src/ui/timeline/paint.js). Everything off the visible window is culled.
@MainActor
struct TimelinePainter {
    let f: TimelineFrame
    let data: TimelineData
    let hits: TimelineHitMap
    let text = TimelineText.shared

    private typealias P = TimelinePalette

    private var L: TimelineLayout { f.layout }
    private var clock: FractonicaClock { data.clock }

    /// x of time t, kept within a few thousand points of the plot: a 72-year cycle at minute zoom lies 10^10 points
    /// away, beyond what the renderer's float32 geometry can place.
    private func X(_ t: Double) -> CGFloat {
        let x = f.scale.x(t)
        return CGFloat(min(L.px1 + 4000, max(L.px0 - 4000, x.isFinite ? x : 0)))
    }
    private func snap(_ x: CGFloat) -> CGFloat { (x / f.pixel).rounded() * f.pixel }
    private func font(_ s: TimelineText.Style) -> TimelineText.Style { s.scaled(f.textScale) }

    /// The selected depth's turnover pointer when its end is off screen.
    private struct SelChip {
        let right: Bool
        let cy: CGFloat
        let label: String
        let width: CGFloat
        let end: Double
        let color: CGColor
    }

    func paint(_ cg: CGContext) {
        hits.reset()
        cg.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
        let td = TimelineTextDrawing(cg: cg, text: text)
        let selChip = planSelectedChip()
        if L.showsOverview { overview(cg, td) }
        laneBackdrop(cg)
        var names: [LaneText] = []
        for i in f.levels.indices {
            if let t = lane(cg, td, i, selChip) { names.append(t) }
        }
        outsideCatalogue(cg, td)
        eclipseLane(cg, td)
        axis(cg, td)
        // the cursor and now lines run under the lanes' names: a name they cross gets a dark backing, so neither the
        // line nor the text strikes the other out
        let lines = markerLines(cg)
        for t in names { laneText(cg, td, t, lines: lines) }
        markers(cg, td)
        gutter(cg, td)
        chips(cg, td, selChip)
    }

    /// A lane's names and second lines, drawn after the marker lines.
    private struct LaneText {
        struct Label {
            let text: String
            let x: CGFloat
            let y: CGFloat
            let color: CGColor
            let backed: Bool
        }
        let clip: CGRect
        let style: TimelineText.Style
        let detailStyle: TimelineText.Style
        let detailColor: CGColor
        var labels: [Label] = []
        var details: [(String, CGFloat, CGFloat)] = []
    }

    private func laneText(_ cg: CGContext, _ td: TimelineTextDrawing, _ t: LaneText, lines: [CGFloat]) {
        guard !t.labels.isEmpty || !t.details.isEmpty else { return }
        cg.saveGState()
        cg.clip(to: t.clip)
        let backing = CGMutablePath(), dim = CGMutablePath()
        for l in t.labels {
            let lw = text.width(l.text, t.style)
            let r = CGRect(x: l.x - 3, y: l.y - 7.5, width: lw + 6, height: 15)
            let crossed = lines.contains { $0 > r.minX - 1 && $0 < r.maxX + 1 }
            if crossed { backing.addPath(roundRect(r, 5)) } else if l.backed { dim.addPath(roundRect(r, 5)) }
        }
        for (s, x, y) in t.details {
            let lw = text.width(s, t.detailStyle)
            let r = CGRect(x: x - 2, y: y - 7, width: lw + 6, height: 14)
            if lines.contains(where: { $0 > r.minX - 1 && $0 < r.maxX + 1 }) { backing.addPath(roundRect(r, 5)) }
        }
        cg.addPath(dim)
        cg.setFillColor(P.background(0.45))
        cg.fillPath()
        cg.addPath(backing)
        cg.setFillColor(P.background(0.78))
        cg.fillPath()
        for l in t.labels { td.draw(l.text, x: l.x, y: l.y, t.style, l.color) }
        for (s, x, y) in t.details { td.draw(s, x: x + 1, y: y, t.detailStyle, t.detailColor) }
        cg.restoreGState()
    }

    // MARK: - Shapes

    private func fill(_ cg: CGContext, _ r: CGRect, _ c: CGColor) {
        cg.setFillColor(c)
        cg.fill(r)
    }

    private func roundRect(_ r: CGRect, _ radius: CGFloat) -> CGPath {
        let rr = max(0, min(radius, r.width / 2, r.height / 2))
        return CGPath(roundedRect: r, cornerWidth: rr, cornerHeight: rr, transform: nil)
    }

    /// Diagonal stripes in `color` over `rect`.
    private func hatch(_ cg: CGContext, _ rect: CGRect, _ color: CGColor, gap: CGFloat = 7) {
        guard rect.width > 0, rect.height > 0 else { return }
        cg.saveGState()
        cg.clip(to: rect)
        let path = CGMutablePath()
        var x = (rect.minX / gap).rounded(.down) * gap - rect.height
        while x < rect.maxX {
            path.move(to: CGPoint(x: x, y: rect.maxY))
            path.addLine(to: CGPoint(x: x + rect.height, y: rect.minY))
            x += gap
        }
        cg.addPath(path)
        cg.setStrokeColor(color)
        cg.setLineWidth(1)
        cg.strokePath()
        cg.restoreGState()
    }

    private func vline(_ cg: CGContext, _ x: CGFloat, _ y0: CGFloat, _ y1: CGFloat, _ color: CGColor, width: CGFloat = 1, dash: [CGFloat]? = nil) {
        cg.saveGState()
        cg.setStrokeColor(color)
        cg.setLineWidth(width)
        if let dash { cg.setLineDash(phase: 0, lengths: dash) }
        let sx = snap(x)
        cg.move(to: CGPoint(x: sx, y: y0))
        cg.addLine(to: CGPoint(x: sx, y: y1))
        cg.strokePath()
        cg.restoreGState()
    }

    /// A pure count label ("17ι"): the number in `color`, the unit symbol in `symbol`'s colour, so a monospaced θ or ι
    /// next to digits cannot be misread.
    private func countText(_ td: TimelineTextDrawing, _ s: String, x: CGFloat, y: CGFloat, _ style: TimelineText.Style, _ color: CGColor, symbol: CGColor?) {
        guard let symbol, let last = s.last, last.isLetter, s.dropLast().allSatisfy(\.isNumber), s.count > 1 else {
            td.draw(s, x: x, y: y, style, color)
            return
        }
        let digits = String(s.dropLast())
        let w = td.draw(digits, x: x, y: y, style, color)
        td.draw(String(last), x: x + w, y: y, style, symbol)
    }

    // MARK: - Catalogue map

    private func overview(_ cg: CGContext, _ td: TimelineTextDrawing) {
        let lim = data.limits
        let y = L.overviewY, h = L.overviewH
        let x0 = L.px0, x1 = L.px1, w = x1 - x0
        func dx(_ t: Double) -> CGFloat { x0 + CGFloat((t - lim.d0) / (lim.d1 - lim.d0)) * w }
        let frame = CGRect(x: x0, y: y, width: w, height: h)
        let bandH = (h * 0.46).rounded()

        cg.saveGState()
        cg.addPath(roundRect(frame, 8))
        cg.clip()
        fill(cg, frame, P.ink(0.035))
        let a = dx(lim.tMin), b = dx(lim.tMax)
        hatch(cg, CGRect(x: x0, y: y, width: a - x0, height: h), P.ink2(0.18), gap: 5)
        hatch(cg, CGRect(x: b, y: y, width: x1 - b, height: h), P.ink2(0.18), gap: 5)
        // α bands: one label form for all of them (the longest that fits every band), so the map reads evenly
        let labelStyle = font(.ui(9.5, 600))
        let narrowest = data.alpha.dropLast().map { dx($0.end) - dx($0.start) }.min() ?? w
        let forms: [(Int) -> String] = f.pure ? [{ "α#\($0)" }, { "#\($0)" }, { "\($0)" }] : [{ "α\($0)" }, { "\($0)" }]
        let form = forms.first { fmt in text.width(fmt(data.alpha.count), labelStyle) <= narrowest - 4 }
        let alphaInk = P.cg(Theme.levelColor(0, opacity: 0.95, lightness: 0.82))
        for al in data.alpha {
            let ax0 = dx(al.start), ax1 = dx(al.end)
            let c = Theme.levelColor(0, opacity: al.idx % 2 == 1 ? 0.12 : 0.26, lightness: 0.6)
            fill(cg, CGRect(x: ax0, y: y + 3, width: max(0, ax1 - ax0 - 0.5), height: bandH), P.cg(c))
            if let form, text.width(form(Int(al.idx) + 1), labelStyle) <= ax1 - ax0 - 2 {
                td.draw(form(Int(al.idx) + 1), x: (ax0 + ax1) / 2, y: y + 3 + bandH / 2, labelStyle, alphaInk, align: .center)
            }
        }
        let ticks = CGMutablePath()
        for e in clock.catalogue {
            ticks.addRect(CGRect(x: snap(dx(e)), y: y + 4 + bandH, width: f.pixel * 2, height: 3))
        }
        cg.addPath(ticks)
        cg.setFillColor(P.teal(0.8))
        cg.fillPath()
        let marks: [(t: Double, label: String)] = f.pure
            ? data.ruler.overviewMarks()
            : data.centuries(f.words.earth).map { ($0.t, $0.labels[0]) }
        let markStyle = font(.mono(8.5))
        var lastX = -CGFloat.infinity
        let markY = y + 4 + bandH + 3 + (h - (4 + bandH + 3)) / 2
        for m in marks where m.t >= lim.d0 && m.t <= lim.d1 {
            let tx = dx(m.t)
            let lw = text.width(m.label, markStyle)
            if tx - lw / 2 < x0 + 3 || tx + lw / 2 > x1 - 3 || tx - lastX < lw + 10 { continue }
            lastX = tx
            td.draw(m.label, x: tx, y: markY, markStyle, P.ink2(0.75), align: .center)
        }
        cg.restoreGState()

        // the visible window
        let rx0 = min(x1, max(x0, dx(f.window.t0))), rx1 = min(x1, max(x0, dx(f.window.t1)))
        let rw = max(6, rx1 - rx0)
        let wr = CGRect(x: min(rx0, x1 - rw), y: y + 1, width: rw, height: h - 2)
        hits.overviewFrame = wr
        cg.addPath(roundRect(wr, 5))
        cg.setFillColor(P.teal(0.14))
        cg.fillPath()
        cg.addPath(roundRect(wr.insetBy(dx: 0.75, dy: 0.75), 5))
        cg.setStrokeColor(P.teal)
        cg.setLineWidth(1.5)
        cg.strokePath()

        if f.nowShow, abs(f.now - f.cursor) > 1e-3 || !f.cursorIn { overviewMark(cg, dx(f.now), P.now, y, h) }
        if f.cursorIn || f.live { overviewMark(cg, dx(f.live ? f.now : f.cursor), f.live ? P.now : P.cursor, y, h) }

        cg.addPath(roundRect(frame.insetBy(dx: 0.5, dy: 0.5), 8))
        cg.setStrokeColor(P.ink(0.08))
        cg.setLineWidth(1)
        cg.strokePath()
    }

    private func overviewMark(_ cg: CGContext, _ x: CGFloat, _ color: CGColor, _ y: CGFloat, _ h: CGFloat) {
        guard x >= L.px0 - 1, x <= L.px1 + 1 else { return }
        fill(cg, CGRect(x: snap(x) - 0.75, y: y + 1, width: 1.5, height: h - 2), color)
        cg.move(to: CGPoint(x: x - 3.5, y: y - 1))
        cg.addLine(to: CGPoint(x: x + 3.5, y: y - 1))
        cg.addLine(to: CGPoint(x: x, y: y + 4))
        cg.closePath()
        cg.setFillColor(color)
        cg.fillPath()
    }

    // MARK: - Lane backdrop

    private func axisTicks() -> [TimelineTick] {
        switch f.axis {
        case .gregorian(let s): data.gregorianTicks(s, f.window.t0, f.window.t1, f.words.earth)
        case .ruler(let s): data.rulerTicks(s, f.window.t0, f.window.t1)
        }
    }

    private var showsWeekends: Bool {
        !f.pure && f.k * 86_400 >= 7 && f.window.span < 200 * 86_400
    }

    private func laneBackdrop(_ cg: CGContext) {
        let px0 = L.px0, w = L.plotWidth
        for (i, level) in f.levels.enumerated() {
            let y = L.laneY(i)
            fill(cg, CGRect(x: px0, y: y + 1, width: w, height: L.laneH - 2), level == f.selected ? P.lane(level).tint : P.band)
        }
        fill(cg, CGRect(x: px0, y: L.eclipseY + 1, width: w, height: L.eclipseH - 2), P.band)

        cg.saveGState()
        cg.clip(to: CGRect(x: px0, y: L.axisY, width: w, height: L.bottom - L.axisY))
        if showsWeekends {
            let path = CGMutablePath()
            for s in data.weekends(f.window.t0, f.window.t1, f.words.earth) {
                let a = X(s.t0), b = X(s.t1)
                if b < px0 || a > L.px1 { continue }
                path.addRect(CGRect(x: max(a, px0), y: L.tickY, width: b - max(a, px0), height: L.bottom - L.tickY))
            }
            cg.addPath(path)
            cg.setFillColor(P.weekend)
            cg.fillPath()
        }
        let minor = CGMutablePath(), major = CGMutablePath()
        for tk in axisTicks() {
            let x = X(tk.t)
            if x < px0 || x > L.px1 { continue }
            (tk.major ? major : minor).addRect(CGRect(x: snap(x), y: L.lanesY, width: f.pixel * 2, height: L.bottom - L.lanesY))
        }
        cg.addPath(minor)
        cg.setFillColor(P.grid)
        cg.fillPath()
        cg.addPath(major)
        cg.setFillColor(P.gridMajor)
        cg.fillPath()
        cg.restoreGState()
    }

    // MARK: - Lanes

    /// The band of a lane that holds the waves, under the row of names: (top, bottom), or nil when the lane is too thin
    /// for a wave. Tall lanes leave room for a block's second line.
    static func waveBand(y: CGFloat, h: CGFloat) -> (top: CGFloat, bottom: CGFloat)? {
        let top = y + min(12, h * 0.34) + 7.5 + (h >= 72 ? 18 : 3)
        let bottom = y + h - 4
        return bottom - top >= 10 ? (top, bottom) : nil
    }

    @discardableResult
    private func lane(_ cg: CGContext, _ td: TimelineTextDrawing, _ i: Int, _ selChip: SelChip?) -> LaneText? {
        let level = f.levels[i]
        let info = clock.levelInfo(level)
        let st = P.lane(level)
        let y = L.laneY(i), h = L.laneH
        let px0 = L.px0, px1 = L.px1, plotW = L.plotWidth
        let meanPx = info.meanSeconds * f.k
        let t0 = f.window.t0, t1 = f.window.t1

        cg.saveGState()
        cg.clip(to: CGRect(x: px0, y: y, width: plotW, height: h))
        defer { cg.restoreGState() }

        let cur = f.cursorIn ? data.cycle(level, at: f.cursor) : nil
        let siblings = info.siblings ?? data.alpha.count
        let small = font(.ui(10, 500))

        if meanPx < 3 {
            // too dense to draw: a hatch, the cursor's cycle as a hairline and a note
            // only where the catalogue is: outside it there are no cycles to be dense
            let ca = max(px0, X(clock.tMin)), cb = min(px1, X(clock.tMax))
            guard cb > ca else { return nil }
            hatch(cg, CGRect(x: ca, y: y + 3, width: cb - ca, height: h - 6), st.hatch, gap: 5)
            if let cur {
                let a = min(px1, max(px0, X(cur.start)))
                fill(cg, CGRect(x: a, y: y + 2, width: max(2.5, min(px1, max(px0, X(cur.end))) - a), height: h - 4), st.cur)
            }
            let msg = f.words.denseMessage(level)
            let mw = text.width(msg, small)
            let mx = min(ca + 8, px1 - mw - 20)
            if mx >= ca, cb - mx > mw + 14, h >= 16 {
                let pill = CGRect(x: mx, y: y + h / 2 - 8, width: mw + 12, height: 16)
                cg.addPath(roundRect(pill, 8))
                cg.setFillColor(P.background(0.85))
                cg.fillPath()
                td.draw(msg, x: mx + 6, y: y + h / 2, small, P.ink2(0.95))
            }
            return nil
        }

        let blocks = data.blocks(level, t0, t1)
        var n = max(0, TimelineSearch.lastAtOrBefore(blocks, t0) { $0.start })
        let band = Self.waveBand(y: y, h: h)
        let showWave = band != nil
        let reserve: CGFloat = (selChip.map { !$0.right && level == f.selected } ?? false) ? selChip!.width + 14 : 0
        let fillA = CGMutablePath(), fillB = CGMutablePath(), strong = CGMutablePath()
        var current: (rect: CGRect, path: CGPath, block: TimelineBlock, x0: CGFloat, x1: CGFloat)?
        let detailStyle = font(.ui(10, 500))
        var waves: [(TimelineBlock, CGFloat, CGFloat, Bool)] = []
        // thin lanes (a phone in landscape) set their names smaller, so they stay inside the lane
        let labelStyle = font(.ui(h < 22 ? max(8, min(10, h - 6)) : 11, 600))
        var names = LaneText(clip: CGRect(x: px0, y: y, width: plotW, height: h), style: labelStyle, detailStyle: detailStyle,
                             detailColor: st.textDim)
        let quarterWord: String? = {
            guard f.pure, Notation.isMajor(level), cur != nil, let q = f.words.notation.quarter(at: f.cursor, level: level) else { return nil }
            return Notation.quarterWords[q]
        }()
        let highlighted: Int64? = {
            if case .cycle(let l, let idx)? = f.highlight, l == level { return idx }
            return nil
        }()
        var highlightRect: CGRect?

        while n < blocks.count {
            let b = blocks[n]
            n += 1
            if b.start > t1 { break }
            let x0 = X(b.start), x1 = X(b.end)
            if x1 < px0 { continue }
            let w = x1 - x0
            let isCur = cur?.idx == b.idx
            let gap: CGFloat = w >= 5 ? min(1, w * 0.1) : 0
            let inset: CGFloat = h < 20 ? 1 : 2
            let rect = CGRect(x: x0 + gap / 2, y: y + inset, width: max(f.pixel, w - gap), height: h - 2 * inset)
            let radius = min(5, w * 0.22, h * 0.2)
            if isCur {
                current = (rect, roundRect(rect, radius), b, x0, x1)
            } else if b.idx % 2 == 0 {
                fillA.addPath(roundRect(rect, radius))
            } else {
                fillB.addPath(roundRect(rect, radius))
            }
            if b.idx == highlighted { highlightRect = rect }
            if w >= 8, x0 >= px0, level == 0 || b.local == 0 {
                strong.addRect(CGRect(x: snap(x0) - 0.75, y: y + 1, width: 1.5, height: h - 2))
            }
            // (a cycle cut short by the catalogue's end has no wave: its quarters lie beyond the catalogue)
            let clipped = b.end >= clock.tMax - 1e-3 && clock.cycleStartTime(level: level, index: b.idx + 1) == nil
            if w >= 80, showWave, !clipped, w <= plotW * 3 || isCur { waves.append((b, x0, x1, isCur)) }
            if w >= 14 {
                let cx0 = max(x0, px0), cx1 = min(x1, px1)
                let variants = f.words.blockLabels(
                    level: level, idx: b.idx, local: b.local, siblings: siblings, width: w, wide: w > plotW * 0.45,
                    end: b.end, endsWithCatalogue: b.end >= clock.tMax - 1e-3, refYear: f.refYear,
                    quarter: isCur ? quarterWord : nil, names: { data.names($0, $1) })
                let room = cx1 - max(cx0, px0 + reserve)
                if let lab = text.fit(variants, labelStyle, room: room - (w < 30 ? 4 : 10)) {
                    let lw = text.width(lab, labelStyle)
                    var tx = max(x0, px0 + reserve) + (w < 30 ? 3 : 7)
                    if tx + lw > x1 - 3 { tx = x1 - 3 - lw } // pushed by the next block, like a sticky header
                    if tx >= cx0 + 1 {
                        let wavy = showWave && w >= 80
                        let ty = wavy ? y + min(12, h * 0.34) : y + h / 2
                        names.labels.append(.init(text: lab, x: tx, y: ty, color: isCur ? st.cur : st.text, backed: wavy))
                        // tall lanes: a second, quieter line under a wide block's name
                        if h >= 72, w >= 160, let detail = blockDetail(level, b, isCur: isCur),
                           text.width(detail, detailStyle) <= cx1 - tx - 8 {
                            names.details.append((detail, tx, ty + 16))
                        }
                    }
                }
            }
        }
        cg.addPath(fillA)
        cg.setFillColor(st.fillA)
        cg.fillPath()
        cg.addPath(fillB)
        cg.setFillColor(st.fillB)
        cg.fillPath()
        cg.addPath(strong)
        cg.setFillColor(st.lineStrong)
        cg.fillPath()
        if let current {
            cg.addPath(current.path)
            cg.setFillColor(st.fillCur)
            cg.fillPath()
        }
        if let band { for (b, _, _, isCur) in waves { wave(cg, td, level, b, st, band, isCur) } }
        if let current {
            cg.addPath(roundRect(current.rect.insetBy(dx: 0.75, dy: 0.75), min(5, current.rect.width * 0.22, h * 0.2)))
            cg.setStrokeColor(st.cur)
            cg.setLineWidth(h < 20 ? 1 : 1.5)
            cg.strokePath()
        }
        if let highlightRect {
            cg.addPath(roundRect(highlightRect.insetBy(dx: 0.5, dy: 0.5), min(5, highlightRect.width * 0.22, h * 0.2)))
            cg.setStrokeColor(P.ink(0.9))
            cg.setLineWidth(1.5)
            cg.strokePath()
        }
        return names
    }

    /// The second line of a wide block in a tall lane: Earth its start and end; pure its length and, on the cursor's
    /// cycle, when it ends.
    private func blockDetail(_ level: Int, _ b: TimelineBlock, isCur: Bool) -> String? {
        let words = f.words
        if words.pure {
            let length = words.notation.cycleLength(level: level)
            return isCur ? "lasts \(length) · ends \(data.ruler.relText(b.end, to: f.cursor))" : "lasts \(length)"
        }
        let earth = words.earth
        let mean = clock.levelInfo(level).meanSeconds
        func say(_ t: Double) -> String {
            mean >= 5 * 86_400 ? earth.date(t) : mean >= 3600 ? earth.short(t, refYear: f.refYear) : earth.time(t, seconds: true)
        }
        let span = "\(say(b.start)) → \(say(b.end))"
        return isCur ? "\(span) · ends \(EarthTime.countdown(b.end - f.cursor))" : span
    }

    /// The triangle wave of one cycle (0 → peak at ¼ → valley at ¾ → 0), its quarter ticks and, on the cursor's cycle,
    /// where the cursor sits on it.
    private func wave(_ cg: CGContext, _ td: TimelineTextDrawing, _ level: Int, _ b: TimelineBlock, _ st: TimelinePalette.Lane,
                      _ band: (top: CGFloat, bottom: CGFloat), _ isCur: Bool) {
        // the wave's geometry in unclamped doubles (its slope near the cursor must be exact), drawn only where visible
        func ux(_ t: Double) -> CGFloat { CGFloat(f.scale.x(t)) }
        let x0 = ux(b.start), x1 = ux(b.end)
        let q1 = ux(data.quarterTime(level, b.idx, 1))
        let q2 = ux(data.quarterTime(level, b.idx, 2))
        let q3 = ux(data.quarterTime(level, b.idx, 3))
        var cx0 = max(x0, L.px0), cx1 = min(x1, L.px1)
        if x1 - x0 > L.plotWidth * 3 {
            // a cycle far wider than the view: only a short stretch of its wave, around the cursor
            guard isCur, f.cursorIn else { return }
            let c = X(f.cursor)
            cx0 = max(cx0, c - 26)
            cx1 = min(cx1, c + 26)
        }
        // the wave keeps to its band under the names, so neither crosses the other
        let mid = (band.top + band.bottom) / 2
        let a = min((band.bottom - band.top) / 2, 15)
        let pts = [CGPoint(x: x0, y: mid), CGPoint(x: q1, y: mid - a), CGPoint(x: q3, y: mid + a), CGPoint(x: x1, y: mid)]
        let path = CGMutablePath()
        var started = false
        for i in 0..<3 {
            let p = pts[i], q = pts[i + 1]
            guard q.x - p.x > 1e-6, q.x >= cx0, p.x <= cx1 else { continue }
            let sa = max(p.x, cx0), sb = min(q.x, cx1)
            let ya = p.y + (q.y - p.y) * (sa - p.x) / (q.x - p.x)
            let yb = p.y + (q.y - p.y) * (sb - p.x) / (q.x - p.x)
            if !started {
                path.move(to: CGPoint(x: sa, y: ya))
                started = true
            }
            path.addLine(to: CGPoint(x: sb, y: yb))
        }
        cg.addPath(path)
        cg.setStrokeColor(st.wave)
        cg.setLineWidth(1.25)
        cg.setLineJoin(.round)
        cg.strokePath()
        if isCur, f.cursorIn {
            let cx = X(f.cursor)
            if cx > cx0, cx < cx1 {
                var cy = mid
                for i in 0..<3 {
                    let p = pts[i], q = pts[i + 1]
                    if q.x - p.x > 1e-6, cx >= p.x, cx <= q.x {
                        cy = p.y + (q.y - p.y) * (cx - p.x) / (q.x - p.x)
                        break
                    }
                }
                let dot = CGRect(x: cx - 3.5, y: cy - 3.5, width: 7, height: 7)
                cg.setFillColor(st.cur)
                cg.fillEllipse(in: dot)
                cg.setStrokeColor(P.background(0.9))
                cg.setLineWidth(1.25)
                cg.strokeEllipse(in: dot)
            }
        }
        let bottom = band.bottom + 2
        let ticks = CGMutablePath()
        for (qx, tall) in [(q1, 4.0), (q2, 6.0), (q3, 4.0)] where qx > cx0 && qx < cx1 && qx < x1 - 0.5 {
            ticks.addRect(CGRect(x: snap(qx), y: bottom - tall, width: f.pixel * 2, height: tall))
        }
        cg.addPath(ticks)
        cg.setFillColor(st.textDim)
        cg.fillPath()
        // the quarters' words sit inside the wave, on the side of the mid line the wave leaves free there
        guard a >= 8 else { return }
        let small = font(.ui(9.5, 500))
        let above = mid - a * 0.5 - 1, below = mid + a * 0.5 + 1
        if f.pure, Notation.isMajor(level) {
            // a major period's quarters in words, each centred on its stretch (named by the threshold that ends it):
            // the wave is above the mid line in the first two stretches, below it in the last two
            guard x1 - x0 >= 160 else { return }
            for (i, (s0, s1)) in [(x0, q1), (q1, q2), (q2, q3), (q3, x1)].enumerated() {
                let word = Notation.quarterWords[i]
                let cx = (s0 + s1) / 2
                if s1 - s0 >= text.width(word, small) + 10, cx > cx0 + 14, cx < cx1 - 14 {
                    td.draw(word, x: cx, y: i < 2 ? below : above, small, st.textDim, align: .center)
                }
            }
            return
        }
        guard !f.pure, x1 - x0 >= 320 else { return }
        // under the peak, above the valley, and above the node where the wave runs down through the mid line
        for (qx, name, wy) in [(q1, "peak", below), (q2, "node", above), (q3, "valley", above)] where qx > cx0 + 14 && qx < cx1 - 14 {
            td.draw(name, x: qx, y: wy, small, st.textDim, align: .center)
        }
    }

    // MARK: - Eclipse lane

    private func eclipseLane(_ cg: CGContext, _ td: TimelineTextDrawing) {
        let y = L.eclipseY, h = L.eclipseH
        let px0 = L.px0, px1 = L.px1
        let e = clock.catalogue
        let base = (y + h * 0.38).rounded()
        cg.saveGState()
        cg.clip(to: CGRect(x: px0, y: y, width: L.plotWidth, height: h))
        fill(cg, CGRect(x: px0, y: base, width: L.plotWidth, height: f.pixel * 2), P.ink2(0.22))
        if f.cursorIn, let loc = clock.locate(f.cursor), loc.k < e.count - 1 {
            let a = min(px1, max(px0, X(e[loc.k]))), b = min(px1, max(px0, X(e[loc.k + 1])))
            fill(cg, CGRect(x: a, y: base - 1, width: max(1.5, b - a), height: 3), P.teal(0.55))
        }
        let sarosPx = clock.meanSaros * f.k
        let minPx = (f.pure ? 34 : 62) * f.textScale
        var stride = 1
        while sarosPx * Double(stride) < minPx && stride < 64 { stride *= 2 }
        let regular = font(.mono(9.5)), bold = font(.mono(9.5, 600))
        let selectedEclipse: Int? = {
            if case .eclipse(let k)? = f.highlight { return k }
            return nil
        }()
        var visible = 0
        let labelY = y + h * 0.78
        for (i, t) in e.enumerated() {
            let x = X(t)
            if x < px0 - 40 { continue }
            if x > px1 + 40 { break }
            if x >= px0 && x <= px1 { visible += 1 }
            let alpha = i % 4 == 0
            let crowd = min(1, max(0.5, sarosPx / 14))
            let r: CGFloat = (alpha ? 5 : 3.4) * crowd + (selectedEclipse == i ? 1.5 : 0)
            if alpha {
                cg.move(to: CGPoint(x: x, y: base - r))
                cg.addLine(to: CGPoint(x: x + r, y: base))
                cg.addLine(to: CGPoint(x: x, y: base + r))
                cg.addLine(to: CGPoint(x: x - r, y: base))
                cg.closePath()
            } else {
                cg.addEllipse(in: CGRect(x: x - r, y: base - r, width: 2 * r, height: 2 * r))
            }
            cg.setFillColor(alpha ? P.cg(Theme.levelColor(0, lightness: 0.72)) : P.teal)
            cg.setStrokeColor(selectedEclipse == i ? P.ink : P.background(0.9))
            cg.setLineWidth(selectedEclipse == i ? 1.5 : 1)
            cg.drawPath(using: .fillStroke)
            if i % stride == 0 || selectedEclipse == i, h >= 32 {
                let lab = f.words.eclipseLabel(i)
                let style = alpha ? bold : regular
                let lw = text.width(lab, style)
                if x - lw / 2 > px0 + 2, x + lw / 2 < px1 - 2 {
                    td.draw(lab, x: x, y: labelY, style, alpha ? P.ink(0.9) : P.ink2(0.85), align: .center)
                }
            }
        }
        cg.restoreGState()

        guard visible == 0 else { return }
        // nothing in view: point at the nearest eclipses on either side
        let prev = e.lastIndex { $0 < f.window.t0 }
        let next = e.firstIndex { $0 > f.window.t1 }
        if let prev {
            let lab = f.pure ? "◂ \(Notation.eclipseName(prev))" : "◂ \(f.words.earth.date(e[prev]))"
            chip(cg, td, lab, x: px0 + 8, cy: base, right: false, color: P.teal, action: .reveal(e[prev], right: false))
        }
        if let next {
            let lab = f.pure ? "\(Notation.eclipseName(next)) ▸" : "\(f.words.earth.date(e[next])) ▸"
            chip(cg, td, lab, x: px1 - 8, cy: base, right: true, color: P.teal, action: .reveal(e[next], right: true))
        }
        let msg = "Saros 141 · time base of the clock"
        let style = font(.ui(10, 500))
        if h >= 32, L.plotWidth > text.width(msg, style) + 300 {
            td.draw(msg, x: (px0 + px1) / 2, y: labelY, style, P.mutedText, align: .center)
        }
    }

    // MARK: - Outside the catalogue

    private func outsideCatalogue(_ cg: CGContext, _ td: TimelineTextDrawing) {
        let top = L.tickY + L.tickH, bottom = L.bottom
        let px0 = L.px0, px1 = L.px1
        let a = X(clock.tMin), b = X(clock.tMax)
        guard a > px0 || b < px1 else { return }
        cg.saveGState()
        cg.clip(to: CGRect(x: px0, y: top, width: L.plotWidth, height: bottom - top))
        if a > px0 {
            let r = CGRect(x: px0, y: top, width: min(a, px1) - px0, height: bottom - top)
            fill(cg, r, P.shade)
            hatch(cg, r, P.hatchLine)
        }
        if b < px1 {
            let r = CGRect(x: max(b, px0), y: top, width: px1 - max(b, px0), height: bottom - top)
            fill(cg, r, P.shade)
            hatch(cg, r, P.hatchLine)
        }
        cg.restoreGState()
        let style = font(.ui(10, 600))
        for (x, start) in [(a, true), (b, false)] where x >= px0 && x <= px1 {
            vline(cg, x, top, bottom, P.ink2(0.6), dash: [3, 3])
            let lab = f.words.edgeLabel(start: start)
            let lw = text.width(lab, style)
            let room = start ? x - px0 : px1 - x
            if room > lw + 14 {
                td.draw(lab, x: start ? x - 6 : x + 6, y: L.lanesY + 11, style, P.ink2(0.95), align: start ? .right : .left)
            }
        }
        if b <= px0 || a >= px1 {
            let cx = (px0 + px1) / 2, cy = (top + bottom) / 2
            td.draw("Outside the Saros 141 catalogue", x: cx, y: cy - 9, font(.ui(13, 600)), P.ink(0.9), align: .center)
            td.draw(f.words.catalogueRange, x: cx, y: cy + 10, font(.mono(11)), P.ink2(0.9), align: .center)
            let back = b <= px0 ? "◂ back to the catalogue" : "back to the catalogue ▸"
            chip(cg, td, back, x: cx, cy: cy + 34, right: nil, color: P.teal,
                 action: .reveal(b <= px0 ? clock.tMax : clock.tMin, right: a >= px1))
        }
    }

    // MARK: - Axis

    private func axis(_ cg: CGContext, _ td: TimelineTextDrawing) {
        let px0 = L.px0, px1 = L.px1
        let ay = L.axisY, yTick = L.tickY, rowH = L.tickH
        let t0 = f.window.t0, t1 = f.window.t1
        cg.saveGState()
        cg.clip(to: CGRect(x: px0, y: ay, width: L.plotWidth, height: L.ctxH + L.tickH + L.markH))
        fill(cg, CGRect(x: px0, y: ay, width: L.plotWidth, height: L.ctxH + rowH), P.ink(0.03))

        // context row
        let spans: [TimelineSpan]
        let minor: [TimelineTick]?
        let symbol: CGColor?
        switch f.axis {
        case .gregorian(let s):
            spans = data.gregorianContext(s, t0, t1, f.words.earth)
            minor = s.minor.flatMap { m in m.nominal * f.k >= 6 ? data.gregorianTicks(m, t0, t1, f.words.earth) : nil }
            symbol = nil
        case .ruler(let s):
            spans = data.rulerContext(s, t0, t1)
            minor = data.ruler.minor(of: s).flatMap { m in m.nominal * f.k >= 6 ? data.rulerTicks(m, t0, t1) : nil }
            symbol = P.lane(s.level).text
        }
        let ctxStyle = font(.ui(10.5, 600))
        let shade = CGMutablePath(), seps = CGMutablePath()
        var ctxLabels: [(String, CGFloat)] = []
        for s in spans {
            let a = X(s.t0), b = X(s.t1)
            if b < px0 || a > px1 { continue }
            let ca = max(a, px0), cb = min(b, px1)
            if s.ord % 2 != 0 { shade.addRect(CGRect(x: ca, y: ay, width: cb - ca, height: L.ctxH)) }
            if a >= px0 { seps.addRect(CGRect(x: snap(a), y: ay + 3, width: f.pixel * 2, height: L.ctxH - 5)) }
            if let lab = text.fit(s.labels, ctxStyle, room: cb - ca - 14) {
                let lw = text.width(lab, ctxStyle)
                var tx = ca + 6
                if tx + lw > cb - 4 { tx = cb - 4 - lw }
                ctxLabels.append((lab, tx))
            }
        }
        cg.addPath(shade)
        cg.setFillColor(P.ink(0.035))
        cg.fillPath()
        cg.addPath(seps)
        cg.setFillColor(P.ink2(0.4))
        cg.fillPath()
        for (lab, tx) in ctxLabels { td.draw(lab, x: tx, y: ay + L.ctxH / 2, ctxStyle, P.ink(0.88)) }
        if spans.isEmpty {
            // zoomed out past every calendar unit: name the catalogue itself over its extent
            let a = max(px0, X(clock.tMin)), b = min(px1, X(clock.tMax))
            let variants = ["Saros 141 catalogue · \(f.words.catalogueRange)", f.words.catalogueRange, "Saros 141 catalogue"]
            if b > a, let lab = text.fit(variants, ctxStyle, room: b - a - 12) {
                td.draw(lab, x: (a + b) / 2, y: ay + L.ctxH / 2, ctxStyle, P.ink2(0.9), align: .center)
            }
        }

        if showsWeekends {
            let path = CGMutablePath()
            for s in data.weekends(t0, t1, f.words.earth) {
                let a = X(s.t0), b = X(s.t1)
                if b >= px0, a <= px1 { path.addRect(CGRect(x: max(a, px0), y: yTick, width: b - max(a, px0), height: rowH)) }
            }
            cg.addPath(path)
            cg.setFillColor(P.cursor(0.07))
            cg.fillPath()
        }

        if let minor {
            let path = CGMutablePath()
            for tk in minor {
                let x = X(tk.t)
                if x >= px0, x <= px1 { path.addRect(CGRect(x: snap(x), y: yTick + rowH - 5, width: f.pixel * 2, height: 5)) }
            }
            cg.addPath(path)
            cg.setFillColor(P.minorTick)
            cg.fillPath()
        }

        // labelled ticks: one label variant for the whole row, the longest that fits between the closest visible pair
        let tickStyle = font(.mono(11)), majorStyle = font(.mono(11, 600))
        let wordStyle = font(.ui(11, 500)), wordMajor = font(.ui(11, 600))
        func style(_ tk: TimelineTick, _ lab: String) -> TimelineText.Style {
            if f.pure, lab.contains(where: { $0.isLetter && $0.isASCII }) && lab.filter({ $0.isLetter && $0.isASCII }).count >= 2 {
                return tk.major ? wordMajor : wordStyle
            }
            return tk.major ? majorStyle : tickStyle
        }
        let ticks = axisTicks()
        var visible: [(tk: TimelineTick, x: CGFloat, room: CGFloat)] = []
        for (i, tk) in ticks.enumerated() {
            let x = X(tk.t)
            if x < px0 || x > px1 { continue }
            let next = i + 1 < ticks.count ? min(X(ticks[i + 1].t), px1 + 100) : px1 + 100
            visible.append((tk, x, next - x - 8))
            hits.ticks.append(tk.t)
        }
        let maxVariants = visible.reduce(1) { max($0, $1.tk.labels.count) }
        var variant = 0
        while variant < maxVariants - 1 {
            let fits = visible.allSatisfy { v in
                let lab = v.tk.labels.isEmpty ? "" : v.tk.labels[min(variant, v.tk.labels.count - 1)]
                return text.width(lab, style(v.tk, lab)) <= v.room
            }
            if fits { break }
            variant += 1
        }
        let majorPath = CGMutablePath(), minorPath = CGMutablePath()
        for v in visible {
            if v.tk.major {
                majorPath.addRect(CGRect(x: snap(v.x), y: yTick + 1, width: f.pixel * 2, height: rowH - 1))
            } else {
                minorPath.addRect(CGRect(x: snap(v.x), y: yTick + 4, width: f.pixel * 2, height: rowH - 4))
            }
        }
        cg.addPath(majorPath)
        cg.setFillColor(P.ink(0.7))
        cg.fillPath()
        cg.addPath(minorPath)
        cg.setFillColor(P.ink2(0.6))
        cg.fillPath()
        for v in visible where !v.tk.labels.isEmpty {
            let lab = v.tk.labels[min(variant, v.tk.labels.count - 1)]
            let st = style(v.tk, lab)
            let lw = text.width(lab, st)
            guard lw <= v.room + 4, v.x + 4 + lw <= px1 + 40 else { continue }
            countText(td, lab, x: v.x + 4, y: yTick + rowH / 2 - 1, st, v.tk.major ? P.ink(0.95) : P.ink2(0.95), symbol: symbol)
        }
        fill(cg, CGRect(x: px0, y: yTick + rowH - f.pixel * 2, width: L.plotWidth, height: f.pixel * 2), P.axisBase)
        cg.restoreGState()
    }

    // MARK: - Cursor, now, pointer

    private func flagLabel(_ t: Double) -> String {
        f.words.flagLabel(t, span: f.window.span, refYear: f.refYear, ruler: data.ruler, rulerUnit: f.rulerUnit)
    }

    @discardableResult
    private func flag(_ cg: CGContext, _ td: TimelineTextDrawing, _ x: CGFloat, _ label: String, _ color: CGColor, side: Int) -> CGRect {
        let style = font(.mono(10.5, 600))
        let w = text.width(label, style) + 12
        let y = L.markY + 1, h = L.markH - 3
        var x0 = side < 0 ? x - w + 1 : side > 0 ? x - 1 : x - w / 2
        x0 = min(L.px1 - w, max(L.px0, x0))
        let r = CGRect(x: x0, y: y, width: w, height: h)
        cg.addPath(roundRect(r, 5))
        cg.setFillColor(color)
        cg.fillPath()
        td.draw(label, x: x0 + w / 2, y: y + h / 2, style, P.background, align: .center)
        return r
    }

    /// The now line (rose; solid while live) and the cursor line; returns the x of each line drawn.
    private func markerLines(_ cg: CGContext) -> [CGFloat] {
        let cx = X(f.cursor), nx = X(f.now)
        let cVis = f.cursorIn && cx >= L.px0 && cx <= L.px1
        let nVis = f.nowShow && nx >= L.px0 && nx <= L.px1
        var xs: [CGFloat] = []
        if nVis {
            vline(cg, nx, L.markY, L.bottom, f.live ? P.now : P.nowDim, width: f.live ? 2 : 1.25, dash: f.live ? nil : [5, 3])
            xs.append(nx)
        }
        if cVis, !f.live {
            vline(cg, cx, L.markY, L.bottom, P.cursor, width: 1.75)
            xs.append(cx)
        }
        return xs
    }

    private func markers(_ cg: CGContext, _ td: TimelineTextDrawing) {
        let px0 = L.px0, px1 = L.px1
        let top = L.markY, bottom = L.bottom
        var flags: [CGRect] = []

        let cx = X(f.cursor), nx = X(f.now)
        let cVis = f.cursorIn && cx >= px0 && cx <= px1
        let nVis = f.nowShow && nx >= px0 && nx <= px1
        let same = f.live || abs(cx - nx) < 1

        if same, nVis {
            let r = flag(cg, td, nx, f.live ? "NOW \(flagLabel(f.now))" : flagLabel(f.cursor), f.live ? P.now : P.cursor, side: 0)
            flags.append(r)
            hits.cursorFlag = r
        } else {
            var cSide = 0, nSide = 0
            if cVis, nVis, abs(cx - nx) < 130 { (cSide, nSide) = cx < nx ? (-1, 1) : (1, -1) }
            if nVis { flags.append(flag(cg, td, nx, "now \(flagLabel(f.now))", P.now, side: nSide)) }
            if cVis {
                let r = flag(cg, td, cx, flagLabel(f.cursor), P.cursor, side: cSide)
                flags.append(r)
                hits.cursorFlag = r
            }
        }

        // the pointer's crosshair and its time
        if let hv = f.hover, hv.x >= px0, hv.x <= px1, hv.y >= L.axisY {
            vline(cg, hv.x, top, bottom, P.ink(0.4), dash: [2, 3])
            let t = f.scale.t(hv.x)
            let label = clock.inRange(t) || !f.pure ? flagLabel(t) : ""
            if !label.isEmpty {
                let style = font(.mono(10.5, 500))
                let w = text.width(label, style) + 12
                let x0 = min(px1 - w, max(px0, hv.x - w / 2))
                let r = CGRect(x: x0, y: top + 1, width: w, height: L.markH - 3)
                if !flags.contains(where: { r.insetBy(dx: -3, dy: 0).intersects($0) }) {
                    cg.addPath(roundRect(r, 5))
                    cg.setFillColor(P.cg(Theme.panel3))
                    cg.setStrokeColor(P.ink(0.35))
                    cg.setLineWidth(1)
                    cg.drawPath(using: .fillStroke)
                    td.draw(label, x: x0 + w / 2, y: r.midY, style, P.ink, align: .center)
                }
            }
        }
        offscreenChips(cg, td, flags: flags)
    }

    // MARK: - Lane heads

    private func gutter(_ cg: CGContext, _ td: TimelineTextDrawing) {
        let x1 = L.px0
        let small = font(.mono(9.5)), title = font(.ui(L.compact ? 9.5 : 10.5, 600))
        fill(cg, CGRect(x: 0, y: L.lanesY, width: x1 - 2, height: L.laneH * Double(L.lanes)), P.background(0.35))
        fill(cg, CGRect(x: 0, y: L.eclipseY, width: x1 - 2, height: L.eclipseH), P.background(0.35))
        if L.showsOverview {
            let oy = L.overviewY + L.overviewH / 2
            if L.compact {
                td.draw("Map", x: 8, y: oy, title, P.ink2(0.95))
            } else {
                td.draw("Catalogue", x: 10, y: oy - 7, title, P.ink2(0.95))
                td.draw(f.words.catalogueYears, x: 10, y: oy + 7, small, P.mutedText)
            }
        }
        let eh = L.eclipseH
        if eh >= 32 {
            td.draw(L.compact ? "Saros" : "Saros 141", x: L.compact ? 8 : 10, y: L.eclipseY + eh * 0.34, title, P.teal)
            td.draw(L.compact ? "70" : "70 eclipses", x: L.compact ? 8 : 10, y: L.eclipseY + eh * 0.68, small, P.mutedText)
        } else {
            td.draw("Saros", x: 8, y: L.eclipseY + eh / 2, title, P.teal)
        }
        // the axis key: what the ticks are
        let keyStyle = font(.mono(L.compact ? 9.5 : 10.5, 600))
        switch f.axis {
        case .ruler(let s):
            if s.ctx >= 0 { td.draw(data.ruler.units[s.ctx].sym, x: 10, y: L.axisY + L.ctxH / 2, keyStyle, P.mutedText) }
            td.draw(s.m > 1 ? "\(s.sym) ×\(s.m)" : s.sym, x: 10, y: L.tickY + L.tickH / 2, keyStyle, P.teal)
        case .gregorian:
            td.draw(f.words.earth.tag(f.window.c), x: L.compact ? 6 : 10, y: L.tickY + L.tickH / 2, font(.mono(L.compact ? 8.5 : 9.5)), P.mutedText)
        }

        let letterStyle = font(.ui(L.laneH < 16 ? 11.5 : L.laneH < 22 ? 13 : 15, 600))
        for (i, level) in f.levels.enumerated() {
            let info = clock.levelInfo(level)
            let st = P.lane(level)
            let y = L.laneY(i)
            let sel = level == f.selected
            if sel {
                fill(cg, CGRect(x: 0, y: y + 1, width: x1 - 2, height: L.laneH - 2), st.tint)
                cg.addPath(roundRect(CGRect(x: 0, y: y + 3, width: 3, height: L.laneH - 6), 1.5))
                cg.setFillColor(st.solid)
                cg.fillPath()
            }
            let two = L.laneH >= 28
            let ly = y + (two ? min(L.laneH * (L.laneH < 32 ? 0.33 : 0.36), 20) : L.laneH / 2)
            let lx: CGFloat = L.compact ? 9 : 12
            let lw = td.draw(info.letter, x: lx, y: ly, letterStyle, sel ? st.text : st.textDim)
            let depthStyle = font(.mono(10, sel ? 600 : 400))
            let room = x1 - 8 - (lx + lw + 4)
            let depth = text.fit(["depth \(info.depth)", "\(info.depth)"], depthStyle, room: room) ?? "\(info.depth)"
            td.draw(depth, x: lx + lw + 4, y: ly + 1, depthStyle, sel ? P.ink(0.95) : P.ink2(0.8))
            let length = f.words.laneLength(level, compact: L.compact)
            if two {
                let lenStyle = font(.mono(L.compact ? 9 : 9.5))
                td.draw(length, x: L.compact ? 7 : lx, y: min(y + L.laneH * (L.laneH < 32 ? 0.76 : 0.72), ly + 19), lenStyle, P.mutedText)
            } else if !L.compact {
                let roomLen = x1 - 8 - (lx + lw + 4 + text.width(depth, depthStyle) + 8)
                if let lab = text.fit([length], small, room: roomLen) {
                    td.draw(lab, x: x1 - 8, y: ly, small, P.mutedText, align: .right)
                }
            }
        }
        fill(cg, CGRect(x: x1 - 1, y: L.lanesY, width: f.pixel * 2, height: L.laneH * Double(L.lanes) + L.eclipseH), P.ink2(0.16))
    }

    // MARK: - Chips

    private func chipWidth(_ label: String) -> CGFloat { text.width(label, font(.ui(10.5, 600))) + 16 }

    /// A pill (registered for hits). `right` true: x is its right edge; false: its left edge; nil: its centre.
    @discardableResult
    private func chip(_ cg: CGContext, _ td: TimelineTextDrawing, _ label: String, x: CGFloat, cy: CGFloat, right: Bool?,
                      color: CGColor, action: TimelineHitMap.Action) -> CGRect {
        let style = font(.ui(10.5, 600))
        let w = chipWidth(label), h: CGFloat = 20
        let x0 = right == true ? x - w : right == false ? x : x - w / 2
        let r = CGRect(x: x0, y: cy - h / 2, width: w, height: h)
        cg.addPath(roundRect(r, h / 2))
        cg.setFillColor(P.chipFill)
        cg.setStrokeColor(color)
        cg.setLineWidth(1)
        cg.drawPath(using: .fillStroke)
        td.draw(label, x: r.midX, y: cy, style, color, align: .center)
        hits.chips.append(.init(rect: r, action: action, label: label))
        return r
    }

    private func planSelectedChip() -> SelChip? {
        guard f.cursorIn, let sel = data.cycle(f.selected, at: f.cursor) else { return nil }
        let ex = X(sel.end)
        guard ex > L.px1 || ex < L.px0 else { return nil }
        // a view wholly outside the catalogue has its own way back; the turnover pointer would only crowd it
        guard X(clock.tMax) > L.px0, X(clock.tMin) < L.px1 else { return nil }
        let info = clock.levelInfo(f.selected)
        let right = ex > L.px1
        let rel = f.pure ? data.ruler.relText(sel.end, to: f.cursor) : EarthTime.countdown(sel.end - f.cursor)
        let label = f.words.endsChip(letter: info.letter, rel: rel, right: right)
        let laneIdx = f.levels.firstIndex(of: f.selected)
        let cy = laneIdx.map { L.laneY($0) + L.laneH / 2 } ?? (L.markY + L.markH / 2)
        guard L.laneH >= 18 || laneIdx == nil else { return nil }
        return SelChip(right: right, cy: cy, label: label, width: chipWidth(label), end: sel.end, color: P.lane(f.selected).cur)
    }

    private func chips(_ cg: CGContext, _ td: TimelineTextDrawing, _ c: SelChip?) {
        guard let c else { return }
        chip(cg, td, c.label, x: c.right ? L.px1 - 8 : L.px0 + 8, cy: c.cy, right: c.right, color: c.color,
             action: .reveal(c.end, right: c.right))
    }

    /// The cursor and now when they are out of view, stacked along the edge they lie beyond; a chip gives way (shorter,
    /// else none) rather than cover a flag.
    private func offscreenChips(_ cg: CGContext, _ td: TimelineTextDrawing, flags: [CGRect]) {
        let markY = L.markY + L.markH / 2 - 0.5
        var left = L.px0 + 8, right = L.px1 - 8
        func inView(_ t: Double) -> Bool { let x = X(t); return x >= L.px0 && x <= L.px1 }
        func offscreen(_ t: Double, _ name: String, _ color: CGColor, _ action: TimelineHitMap.Action) {
            let toRight = X(t) > L.px1
            let label = f.pure ? data.ruler.flagText(t, u: f.rulerUnit) : f.words.earth.short(t, refYear: f.words.earth.parts(f.window.c).year)
            for v in f.words.markerChip(name: name, label: label, right: toRight) {
                let w = chipWidth(v)
                let x0 = toRight ? right - w : left
                if x0 < L.px0 || x0 + w > L.px1 { continue }
                if flags.contains(where: { x0 < $0.maxX + 4 && x0 + w > $0.minX - 4 }) { continue }
                chip(cg, td, v, x: toRight ? right : left, cy: markY, right: toRight, color: color, action: action)
                if toRight { right -= w + 6 } else { left += w + 6 }
                return
            }
        }
        if f.cursorIn, !inView(f.cursor), !f.live { offscreen(f.cursor, "cursor", P.cursor, .centreCursor) }
        if f.nowShow, !inView(f.now) { offscreen(f.now, "now", P.now, .centreNow) }
    }
}
