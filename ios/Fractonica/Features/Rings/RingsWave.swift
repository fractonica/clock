import FractonicaKit
import SwiftUI

/// The waveform inset (src/ui/rings/wave.js): the glyph value of the selected level over one cycle, 0 → +M → 0 → −M → 0,
/// its sixteen states as bars, the four quarter bands, a cursor at the current phase and the five boundaries under
/// it. Drag along it (or tap) to move inside the cycle; this is what makes peak, node and valley intuitive.
struct RingsWave: View {
    let level: Int
    let model: RingsScreenModel

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @State private var hoverPhase: Double?
    @State private var scrubCycle: Int64?
    @State private var lastIndex: Int?
    @ScaledMetric(relativeTo: .body) private var height: CGFloat = 176

    private let clock = FractonicaClock.shared
    private let cycles = RingsCycles()

    var body: some View {
        GeometryReader { geo in
            let layout = WaveLayout(width: geo.size.width, height: geo.size.height, left: 28, right: 10, top: 32, bottom: 44)
            content(layout)
                .contentShape(.rect)
                .modifier(WaveGestures(
                    layout: layout,
                    tap: { scrub(.ended, x: $0.x, layout: layout, single: true) },
                    scrub: { step, p in scrub(step, x: p.x, layout: layout, single: false) },
                    hover: { hoverPhase = $0.map { layout.phase(atX: $0.x) } }
                ))
        }
        .frame(height: max(150, min(height, 240)))
        .accessibilityElement()
        .accessibilityLabel(Text("Position inside the selected cycle"))
        .accessibilityValue(Text(accessibilityValue))
        .accessibilityAdjustableAction { direction in step(direction == .increment ? 1 : -1) }
    }

    @ViewBuilder
    private func content(_ layout: WaveLayout) -> some View {
        let speed = RingsScreenModel.speed(of: store)
        let mean = clock.levelInfo(level).meanSeconds
        // the cursor moves visibly only on short cycles: a long one is redrawn when its cursor has moved a little
        let cadence: ClockCadence = speed > 0 && mean / speed < 20 ? .animation : .periodic(max(0.001, mean / 3000))
        if model.isVisible {
            ClockTimeline(cadence) { t in canvas(t, layout: layout, speed: speed) }
        } else {
            canvas(store.time(), layout: layout, speed: speed)
        }
    }

    private func canvas(_ t: Double, layout: WaveLayout, speed: Double) -> some View {
        let input = waveInput(t, layout: layout, speed: speed)
        return Canvas { context, _ in RingsWaveRenderer.draw(&context, input) }
    }

    private func waveInput(_ t: Double, layout: WaveLayout, speed: Double) -> WaveInput {
        let inRange = !model.outOfRange && clock.inRange(t)
        let blurred = RingsMath.isBlur(meanSeconds: clock.levelInfo(level).meanSeconds, speed: speed)
        guard inRange, !blurred, let r = clock.level(at: min(t, clock.tMax - 0.001), level) else {
            return WaveInput(layout: layout, level: level, state: inRange ? (blurred ? .blurred : .outside) : .outside)
        }
        let times = r.thresholds.map(\.time)
        let next = (r.quarter + 1...4).first { times[$0] != nil }
        let countdown: String = next.map { i in
            guard let x = times[i] else { return "" }
            return settings.pure ? RingsPureText().inText(now: t, x) : EarthTime.countdown(x - t)
        } ?? ""
        var hover: (phase: Double, text: String)?
        let limit = cycles.phaseLimit(level: level, cycle: r.cycle)
        if let h = hoverPhase, !model.scrubbingWave {
            let p = min(h, limit)
            if let x = cycles.time(level: level, cycle: r.cycle, phase: p) {
                let text = settings.pure ? RingsPureText().pointerText(level: level, x)
                    : RingsText.whenText(settings.wording.earth, x, span: r.duration, compact: true, refYear: settings.wording.earth.parts(t).year)
                hover = (p, text)
            }
        }
        return WaveInput(
            layout: layout, level: level, state: .reading,
            phase: r.phase, index: r.index, quarter: r.quarter, limit: limit,
            passed: (0...4).map { times[$0] != nil && $0 <= r.quarter },
            next: next, countdown: countdown, scrubbing: model.scrubbingWave, hover: hover
        )
    }

    // MARK: Scrubbing

    private func scrub(_ step: DragStep, x: CGFloat, layout: WaveLayout, single: Bool) {
        let t = store.time()
        guard !model.outOfRange, clock.inRange(t), !RingsMath.isBlur(meanSeconds: clock.levelInfo(level).meanSeconds, speed: RingsScreenModel.speed(of: store)) else { return }
        switch step {
        case .began:
            guard let r = clock.level(at: min(t, clock.tMax - 0.001), level) else { return }
            scrubCycle = r.cycle
            lastIndex = r.index
            model.scrubbingWave = true
            move(to: layout.phase(atX: x))
        case .changed:
            move(to: layout.phase(atX: x))
        case .ended, .cancelled:
            if single, let r = clock.level(at: min(t, clock.tMax - 0.001), level) {
                scrubCycle = r.cycle
                move(to: layout.phase(atX: x))
                Haptics.play(.selection)
            }
            scrubCycle = nil
            model.scrubbingWave = false
        }
    }

    private func move(to phase: Double, snap: Bool = false) {
        guard let cycle = scrubCycle, let t = cycles.scrubTime(level: level, cycle: cycle, phase: phase, snap: snap) else { return }
        store.travel(to: t)
        let index = clock.level(at: t, level)?.index
        if index != lastIndex {
            lastIndex = index
            if model.scrubbingWave { Haptics.play(.selection) }
        }
    }

    /// One glyph state forwards or back (VoiceOver's adjustable action).
    private func step(_ d: Int) {
        let t = store.time()
        guard let r = clock.level(at: min(t, clock.tMax - 0.001), level) else { return }
        scrubCycle = r.cycle
        move(to: Double(min(max(r.index + d, 0), r.states)) / Double(r.states), snap: true)
        scrubCycle = nil
    }

    private var accessibilityValue: String {
        let t = store.time()
        guard !model.outOfRange, let r = clock.level(at: min(t, clock.tMax - 0.001), level) else { return "Outside the catalogue" }
        let word = RingsText.phaseWord(index: r.index, derivative: r.derivative)
        if settings.pure {
            return RingsPureText.sliderText(word: word, phase: r.phase, name: RingsPureText().cycleName(level: level, cycle: r.cycle), level: level)
        }
        return "\(word), \(RingsText.percent(r.phase)) through \(RingsText.cycleTag(r))"
    }
}

// MARK: - Drawing

struct WaveInput {
    enum State { case reading, blurred, outside }

    let layout: WaveLayout
    let level: Int
    let state: State
    var phase = 0.0
    var index = 0
    var quarter = 0
    var limit = 1.0
    var passed: [Bool] = []
    var next: Int?
    var countdown = ""
    var scrubbing = false
    var hover: (phase: Double, text: String)?
}

enum RingsWaveRenderer {
    static let names = ["begin", "peak", "node", "valley", "end"]
    static let bands = ["rising", "falling", "falling", "rising"]
    static let m = RingsMath.glyphExtreme(strokes: 2)

    static func draw(_ g: inout GraphicsContext, _ s: WaveInput) {
        let L = s.layout
        let col = { (a: Double, l: Double) in Theme.levelColor(s.level, opacity: a, lightness: l) }
        let label = Theme.ink3

        switch s.state {
        case .outside:
            notice(&g, L, "Outside the Saros 141 catalogue", "no cycle to draw", tint: nil)
            return
        case .blurred:
            notice(&g, L, "This cycle is too fast to follow at this speed", "slow the time-lapse down to see its wave", tint: col(0.08, 0.64))
            return
        case .reading:
            break
        }

        // quarter bands, the current one stronger, with their captions
        for q in 0..<4 {
            let xa = L.x(Double(q) / 4)
            let xb = L.x(Double(q + 1) / 4)
            let band = CGRect(x: xa, y: L.y0, width: xb - xa, height: L.y1 - L.y0)
            g.fill(Path(band), with: .color(q == 0 || q == 3 ? col(0.1, 0.64) : Theme.ink.opacity(0.035)))
            if q == s.quarter { g.fill(Path(band), with: .color(col(0.09, 0.64))) }
            let caption = g.resolve(Text(bands[q]).font(.system(size: 9.5, weight: .medium)).foregroundStyle(q == s.quarter ? col(1, 0.74) : label))
            g.draw(caption, at: CGPoint(x: (xa + xb) / 2, y: L.y0 - 21), anchor: .center)
        }
        var separators = Path()
        for q in 0...4 {
            let x = (L.x(Double(q) / 4)).rounded() + 0.5
            separators.move(to: CGPoint(x: x, y: L.y0 - 4))
            separators.addLine(to: CGPoint(x: x, y: L.y1 + 5))
        }
        g.stroke(separators, with: .color(Theme.ink.opacity(0.09)), lineWidth: 1)

        // value grid and its labels
        var extremes = Path()
        for v in [1.0, -1.0] {
            extremes.move(to: CGPoint(x: L.x0, y: L.y(v).rounded() + 0.5))
            extremes.addLine(to: CGPoint(x: L.x1, y: L.y(v).rounded() + 0.5))
        }
        g.stroke(extremes, with: .color(Theme.ink.opacity(0.14)), style: StrokeStyle(lineWidth: 1, dash: [3, 4]))
        var zero = Path()
        zero.move(to: CGPoint(x: L.x0, y: L.yMid.rounded() + 0.5))
        zero.addLine(to: CGPoint(x: L.x1, y: L.yMid.rounded() + 0.5))
        g.stroke(zero, with: .color(Theme.ink.opacity(0.3)), lineWidth: 1)
        for v in [1, 0, -1] {
            let text = g.resolve(Text(RingsText.value(v * m)).font(.system(size: 10, weight: .medium, design: .monospaced)).foregroundStyle(label))
            g.draw(text, at: CGPoint(x: L.x0 - 6, y: L.y(Double(v))), anchor: .trailing)
        }

        // the sixteen glyph states and the ideal wave, faint; the part already run, bright
        let states = 4 * m
        let bw = (L.x1 - L.x0) / CGFloat(states)
        func bars() -> Path {
            var p = Path()
            for k in 0..<states {
                let v = Double(RingsMath.stateValue(k, m: m)) / Double(m)
                let ya = L.y(0)
                let yb = L.y(v)
                let h = max(1.5, abs(ya - yb))
                p.addRect(CGRect(x: L.x0 + CGFloat(k) * bw + 1, y: v == 0 ? ya - 0.75 : min(ya, yb), width: max(1, bw - 2), height: h))
            }
            return p
        }
        var wave = Path()
        wave.move(to: CGPoint(x: L.x(0), y: L.y(0)))
        wave.addLine(to: CGPoint(x: L.x(0.25), y: L.y(1)))
        wave.addLine(to: CGPoint(x: L.x(0.75), y: L.y(-1)))
        wave.addLine(to: CGPoint(x: L.x(1), y: L.y(0)))
        let barPath = bars()
        g.fill(barPath, with: .color(col(0.2, 0.64)))
        g.stroke(wave, with: .color(col(0.5, 0.64)), style: StrokeStyle(lineWidth: 1.6, lineJoin: .round))

        let cx = L.x(min(s.phase, s.limit))
        g.drawLayer { past in
            past.clip(to: Path(CGRect(x: L.x0 - 2, y: 0, width: cx - L.x0 + 2, height: L.y1 + 8)))
            past.fill(barPath, with: .color(col(0.42, 0.64)))
            past.stroke(wave, with: .color(col(1, 0.7)), style: StrokeStyle(lineWidth: 2.4, lineJoin: .round))
        }
        // the state showing now
        do {
            let v = Double(RingsMath.stateValue(s.index, m: m)) / Double(m)
            let ya = L.y(0)
            let yb = L.y(v)
            g.fill(Path(CGRect(x: L.x0 + CGFloat(s.index) * bw + 1, y: v == 0 ? ya - 1.25 : min(ya, yb), width: max(1.5, bw - 2), height: max(2.5, abs(ya - yb)))),
                   with: .color(col(0.95, 0.66)))
        }

        // beyond the catalogue: hatch the part of a clipped cycle that does not exist
        if s.limit < 0.9999 {
            let xl = L.x(s.limit)
            let rect = CGRect(x: xl, y: L.y0 - 2, width: L.x1 - xl + 1, height: L.y1 - L.y0 + 4)
            g.fill(Path(rect), with: .color(Theme.background.opacity(0.75)))
            g.drawLayer { hatch in
                hatch.clip(to: Path(rect))
                var lines = Path()
                var x = xl - (L.y1 - L.y0)
                while x < L.x1 {
                    lines.move(to: CGPoint(x: x, y: L.y1 + 2))
                    lines.addLine(to: CGPoint(x: x + (L.y1 - L.y0) + 4, y: L.y0 - 2))
                    x += 7
                }
                hatch.stroke(lines, with: .color(Theme.ink.opacity(0.08)), lineWidth: 1)
            }
            if L.x1 - xl > 70 {
                let text = g.resolve(Text("beyond the catalogue").font(.system(size: 10, weight: .medium)).foregroundStyle(label))
                g.draw(text, at: CGPoint(x: (xl + L.x1) / 2, y: L.yMid - 14), anchor: .center)
            }
        }

        // the time axis and the five boundaries
        var axis = Path()
        axis.move(to: CGPoint(x: L.x0, y: L.y1.rounded() + 5.5))
        axis.addLine(to: CGPoint(x: L.x1, y: L.y1.rounded() + 5.5))
        g.stroke(axis, with: .color(Theme.ink.opacity(0.22)), lineWidth: 1)
        for i in 0...4 {
            let x = L.x(Double(i) / 4)
            let isNext = s.next == i
            let passed = i < s.passed.count && s.passed[i]
            g.fill(Path(CGRect(x: x.rounded() - 1, y: L.y1 + 3, width: 2, height: 5)), with: .color(isNext ? col(1, 0.72) : Theme.ink.opacity(0.35)))
            let name = g.resolve(Text(isNext ? "▸ \(names[i])" : names[i])
                .font(.system(size: 10, weight: isNext ? .bold : .semibold))
                .foregroundStyle(isNext ? col(1, 0.74) : passed ? Theme.ink2.opacity(0.7) : label))
            let anchor: UnitPoint = i == 0 ? .topLeading : i == 4 ? .topTrailing : .top
            let nx = i == 0 ? x - 2 : i == 4 ? x + 2 : x
            g.draw(name, at: CGPoint(x: nx, y: L.y1 + 11), anchor: anchor)
            if isNext, !s.countdown.isEmpty {
                let text = g.resolve(Text(s.countdown).font(.system(size: 10, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.ink))
                let size = text.measure(in: CGSize(width: 400, height: 40))
                let left = min(max(nx - (i == 0 ? 0 : i == 4 ? size.width : size.width / 2), 0), L.x1 + 10 - size.width)
                g.draw(text, at: CGPoint(x: left, y: L.y1 + 25), anchor: .topLeading)
            }
        }

        // the cursor: a line, a handle at the top and a dot on the wave
        let cur = Theme.cursor
        var line = Path()
        line.move(to: CGPoint(x: cx.rounded() + 0.5, y: L.y0 - 6))
        line.addLine(to: CGPoint(x: cx.rounded() + 0.5, y: L.y1 + 5))
        g.stroke(line, with: .color(cur), lineWidth: s.scrubbing ? 2.4 : 1.8)
        var handle = Path()
        handle.move(to: CGPoint(x: cx - 6, y: L.y0 - 12))
        handle.addLine(to: CGPoint(x: cx + 6, y: L.y0 - 12))
        handle.addLine(to: CGPoint(x: cx, y: L.y0 - 3))
        handle.closeSubpath()
        g.fill(handle, with: .color(cur))
        let dot = CGPoint(x: cx, y: L.y(RingsMath.triangle(s.phase)))
        let r: CGFloat = s.scrubbing ? 6 : 4.8
        let dotPath = Path(ellipseIn: CGRect(x: dot.x - r, y: dot.y - r, width: 2 * r, height: 2 * r))
        g.fill(dotPath, with: .color(cur))
        g.stroke(dotPath, with: .color(Theme.background.opacity(0.9)), lineWidth: 2)

        // the pointer's position and its moment
        if let h = s.hover {
            let hx = L.x(h.phase).rounded() + 0.5
            var marker = Path()
            marker.move(to: CGPoint(x: hx, y: L.y0 - 4))
            marker.addLine(to: CGPoint(x: hx, y: L.y1 + 5))
            g.stroke(marker, with: .color(Theme.ink.opacity(0.55)), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
            let text = g.resolve(Text(h.text).font(.system(size: 10.5, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.ink))
            let size = text.measure(in: CGSize(width: 400, height: 40))
            let w = size.width + 12
            let bx = min(L.x1 - w, max(L.x0, hx - w / 2))
            let bubble = Path(roundedRect: CGRect(x: bx, y: L.y0 + 4, width: w, height: 18), cornerRadius: 9)
            g.fill(bubble, with: .color(Theme.background.opacity(0.94)))
            g.stroke(bubble, with: .color(Theme.ink.opacity(0.22)), lineWidth: 1)
            g.draw(text, at: CGPoint(x: bx + w / 2, y: L.y0 + 13), anchor: .center)
        }
    }

    private static func notice(_ g: inout GraphicsContext, _ L: WaveLayout, _ first: String, _ second: String, tint: Color?) {
        if let tint { g.fill(Path(CGRect(x: L.x0, y: L.y0, width: L.x1 - L.x0, height: L.y1 - L.y0)), with: .color(tint)) }
        var mid = Path()
        mid.move(to: CGPoint(x: L.x0, y: L.yMid))
        mid.addLine(to: CGPoint(x: L.x1, y: L.yMid))
        g.stroke(mid, with: .color(Theme.ink.opacity(0.18)), style: StrokeStyle(lineWidth: 1, dash: [4, 5]))
        let a = g.resolve(Text(first).font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.ink2))
        let b = g.resolve(Text(second).font(.system(size: 12)).foregroundStyle(Theme.ink3))
        g.draw(a, at: CGPoint(x: (L.x0 + L.x1) / 2, y: L.yMid - 14), anchor: .center)
        g.draw(b, at: CGPoint(x: (L.x0 + L.x1) / 2, y: L.yMid + 10), anchor: .center)
    }
}

// MARK: - Gestures

private struct WaveGestures: ViewModifier {
    let layout: WaveLayout
    let tap: (CGPoint) -> Void
    let scrub: (DragStep, CGPoint) -> Void
    let hover: (CGPoint?) -> Void

    #if os(macOS)
    @State private var dragging = false
    #endif

    private func inPlot(_ p: CGPoint) -> Bool {
        p.x >= layout.x0 - 12 && p.x <= layout.x1 + 12 && p.y >= layout.y0 - 16 && p.y <= layout.y1 + 10
    }

    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .gesture(LocatedTapGesture { p in if inPlot(p) { tap(p) } })
            .gesture(DirectionalPanGesture(
                shouldBegin: { start, translation in inPlot(start) && RingsMath.isHorizontalDrag(translation) },
                onChange: scrub
            ))
            .onContinuousHover { phase in
                if case .active(let p) = phase, inPlot(p) { hover(p) } else { hover(nil) }
            }
        #else
        content
            .onContinuousHover { phase in
                if case .active(let p) = phase, inPlot(p) { hover(p) } else { hover(nil) }
            }
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard inPlot(value.startLocation) else { return }
                        if !dragging {
                            dragging = true
                            scrub(.began, value.location)
                        } else {
                            scrub(.changed, value.location)
                        }
                    }
                    .onEnded { value in
                        guard dragging else { return }
                        dragging = false
                        scrub(.changed, value.location)
                        scrub(.ended, value.location)
                    }
            )
        #endif
    }
}
