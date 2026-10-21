import FractonicaKit
import SwiftUI

/// The reading above the stage on narrow screens: the focused half-arc and, with the solar wave on, the solar strip.
struct WaveHeader: View {
    let model: WaveModel
    let control: WaveController

    @State private var width = 400.0

    var body: some View {
        VStack(spacing: 10) {
            ClockTimeline(.periodic(control.readoutInterval)) { t in
                WaveReadoutCard(readout: WaveReadout.make(t: control.shown(t), overview: model.overview, level: control.level, eff: control.eff, words: control.words),
                                control: control, wide: false, row: width >= 700)
            }
            .onGeometryChange(for: Double.self) { $0.size.width } action: { width = $0 }
            if model.solar {
                WaveSolarStrip(model: model, control: control, wide: false)
                    .frame(maxWidth: 640, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .animation(control.reduceMotion ? nil : .snappy, value: model.solar)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

/// The reading beside the stage on wide screens: the half-arc, the solar strip and the legend.
struct WaveSidePanel: View {
    let model: WaveModel
    let control: WaveController

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ClockTimeline(.periodic(control.readoutInterval)) { t in
                    WaveReadoutCard(readout: WaveReadout.make(t: control.shown(t), overview: model.overview, level: control.level, eff: control.eff, words: control.words),
                                    control: control, wide: true)
                }
                if model.solar {
                    WaveSolarStrip(model: model, control: control, wide: true)
                        .transition(.opacity)
                }
                WaveLegend(words: control.words, overview: model.overview, solar: model.solar, tint: Theme.levelColor(model.overview ? 0 : control.eff))
                    .padding(.top, 4)
            }
            .padding(20)
        }
        .scrollIndicators(.hidden)
        .background(Theme.background2.opacity(0.55))
        .animation(control.reduceMotion ? nil : .snappy, value: model.solar)
    }
}

/// A share as the reading shows it: a percentage, a glyph pair (pure, minor levels) or a quarter word (pure, majors).
struct WaveShareView: View {
    let share: WaveShare
    var size: CGFloat = 26
    var color: Color = Theme.ink
    var label = "phase"

    var body: some View {
        switch share {
        case .percent(let s):
            Text(s).font(.system(size: size, weight: .semibold).monospacedDigit()).foregroundStyle(color)
        case .pair(let f):
            PairView(fraction: f, color: color, height: max(13, size * 0.95))
                .accessibilityLabel(Text(WaveWords.pairSpoken(f, label: label)))
        case .quarter(let q):
            Text(q).font(.system(size: size * 0.82, weight: .semibold)).foregroundStyle(color)
        }
    }
}

/// The focused half-arc in words: what it is, where the displayed time is in it, what comes next.
struct WaveReadoutCard: View {
    let readout: WaveReadout
    let control: WaveController
    /// A column beside the stage (the side panel).
    let wide: Bool
    /// One row across a wide header (iPad portrait).
    var row = false

    var body: some View {
        switch readout.kind {
        case .outOfRange: outOfRange
        default: wide ? AnyView(column) : row ? AnyView(rowLayout) : AnyView(header)
        }
    }

    private var tint: Color { Theme.levelColor(readout.level) }

    /// A date and its time stay together ("2026-10-09 11:40"), so a span that has to wrap breaks at its arrow.
    static func glue(_ s: String) -> String {
        s.replacingOccurrences(of: #"(\d) (?=\d)"#, with: "$1\u{a0}", options: .regularExpression)
    }

    private var badge: some View {
        Text(readout.badge)
            .font(.system(size: wide ? 24 : 20, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: wide ? 46 : 40, height: wide ? 46 : 40)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(tint.opacity(0.12)))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tint.opacity(0.45), lineWidth: 1))
            .accessibilityHidden(true)
    }

    private var titleRow: some View {
        HStack(spacing: 6) {
            Text(readout.title).font(.headline).foregroundStyle(Theme.ink)
            if !readout.note.isEmpty {
                Text(readout.note)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().strokeBorder(Theme.line2, lineWidth: 1))
                    .lineLimit(1)
            }
        }
    }

    /// While a time-lapse outruns the selected depth, the reading follows a coarser one and says so.
    @ViewBuilder
    private var fastLine: some View {
        if let fast = readout.fast {
            Label(fast, systemImage: "hare")
                .font(.caption2.weight(.medium))
                .foregroundStyle(Theme.now)
                .lineLimit(1)
                .help(readout.fastHelp)
        }
    }

    private var bar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.line)
                Capsule().fill(tint).frame(width: max(2, geo.size.width * readout.progress))
            }
        }
        .frame(height: 3)
        .accessibilityHidden(true)
    }

    private var nextLines: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { ForEach(Array(readout.next.enumerated()), id: \.offset) { nextLine($0.element) } }
            VStack(alignment: .leading, spacing: 2) { ForEach(Array(readout.next.enumerated()), id: \.offset) { nextLine($0.element) } }
        }
    }

    private func nextLine(_ line: WaveNextLine) -> some View {
        let gap = line.dim.isEmpty || line.text.isEmpty ? "" : " "
        return Text("\(Text(line.dim).foregroundStyle(Theme.ink3))\(gap)\(Text(line.text).foregroundStyle(Theme.ink))")
            .font(.footnote.monospacedDigit())
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }

    @ViewBuilder
    private var glyph: some View {
        if let g = readout.glyph {
            GlyphView(index: g, strokes: 2, color: Theme.levelColor(readout.level, lightness: 0.7))
                .frame(height: wide ? 30 : 24)
                .accessibilityHidden(true)
        }
    }

    // MARK: Narrow: a compact header

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                badge
                VStack(alignment: .leading, spacing: 3) {
                    titleRow
                    fastLine
                    Text(WaveReadoutCard.glue(readout.span))
                        .font(.caption.monospaced())
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(2)
                        .minimumScaleFactor(0.85)
                        .fixedSize(horizontal: false, vertical: true)
                    Text([readout.loop, readout.cycle].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 3) {
                    WaveShareView(share: readout.primary, size: 24, label: "half-arc phase")
                    Text(readout.primaryWhat).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(1)
                    bar.frame(width: 76)
                }
                .fixedSize()
            }
            HStack(alignment: .center, spacing: 10) {
                nextLines
                Spacer(minLength: 4)
                if let s = readout.secondary {
                    HStack(spacing: 4) {
                        WaveShareView(share: s, size: 13, color: Theme.ink2, label: "cycle phase")
                        Text(readout.secondaryWhat).font(.caption2).foregroundStyle(Theme.ink3).lineLimit(1)
                    }
                    .fixedSize()
                }
                glyph
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: A wide header: one row

    private var rowLayout: some View {
        HStack(alignment: .top, spacing: 16) {
            badge
            VStack(alignment: .leading, spacing: 3) {
                titleRow
                fastLine
                Text(WaveReadoutCard.glue(readout.span)).font(.footnote.monospaced()).foregroundStyle(Theme.ink2).lineLimit(1).minimumScaleFactor(0.8)
                Text([readout.loop, readout.cycle].compactMap { $0 }.joined(separator: " · "))
                    .font(.footnote).foregroundStyle(Theme.ink3).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 460, alignment: .leading)
            Spacer(minLength: 12)
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(readout.next.enumerated()), id: \.offset) { nextLine($0.element) }
                if let s = readout.secondary {
                    HStack(spacing: 5) {
                        WaveShareView(share: s, size: 14, color: Theme.ink2, label: "cycle phase")
                        Text(readout.secondaryWhat).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                    }
                }
            }
            .fixedSize()
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 4) {
                WaveShareView(share: readout.primary, size: 28, label: "half-arc phase")
                Text(readout.primaryWhat).font(.caption).foregroundStyle(Theme.ink3).lineLimit(1)
                bar.frame(width: 110)
            }
            .fixedSize()
            glyph
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Wide: a column

    private var column: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                badge
                VStack(alignment: .leading, spacing: 2) {
                    titleRow
                    fastLine
                    Text(WaveReadoutCard.glue(readout.span)).font(.footnote.monospaced()).foregroundStyle(Theme.ink2).lineLimit(2).minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
                glyph
            }
            VStack(alignment: .leading, spacing: 2) {
                if let loop = readout.loop { Text(loop).font(.subheadline).foregroundStyle(Theme.ink2).help(readout.loopHint) }
                Text(readout.cycle).font(.subheadline).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    WaveShareView(share: readout.primary, size: 30, label: "half-arc phase")
                    Text(readout.primaryWhat).font(.footnote).foregroundStyle(Theme.ink3)
                }
                bar
                if let s = readout.secondary {
                    HStack(spacing: 6) {
                        WaveShareView(share: s, size: 15, color: Theme.ink2, label: "cycle phase")
                        Text(readout.secondaryWhat).font(.footnote).foregroundStyle(Theme.ink3)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                ForEach(Array(readout.next.enumerated()), id: \.offset) { nextLine($0.element) }
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Outside the catalogue

    private var outOfRange: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label {
                Text(readout.title).font(.headline).foregroundStyle(Theme.ink)
            } icon: {
                Image(systemName: "circle.dashed").foregroundStyle(Theme.now)
            }
            Text(readout.message ?? "")
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { edgeButtons }
                VStack(alignment: .leading, spacing: 8) { edgeButtons }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .tint(Theme.teal)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var edgeButtons: some View {
        Button { control.goToEdge(.start) } label: {
            Label("First eclipse", systemImage: "backward.end")
        }
        .accessibilityLabel("Go to \(control.words.edgeName(.start))")
        Button { control.goToEdge(.end) } label: {
            Label("Last eclipse", systemImage: "forward.end")
        }
        .accessibilityLabel("Go to \(control.words.edgeName(.end))")
    }
}

/// The solar strip: the sync at every depth — a mini wave of one sync with its quarters and the present phase (drag
/// it to travel within the sync), the sync number, the phase, the next quarter and, where the stage shows no ripple,
/// the depths that carry one (src/ui/wave/sun.js).
struct WaveSolarStrip: View {
    let model: WaveModel
    let control: WaveController
    let wide: Bool

    var body: some View {
        ClockTimeline(.periodic(0.5)) { t in
            if let s = WaveSolarReadout.make(t: control.shown(t), words: control.words) {
                content(s)
            }
        }
    }

    private func content(_ s: WaveSolarReadout) -> some View {
        let hint = model.stage.rippleVisible() ? "" : control.words.sunRange(model.stage.rippleDepths(pad: model.stage.focusPad))
        return VStack(alignment: .leading, spacing: 6) {
            if wide {
                column(s, hint: hint)
            } else {
                row(s, hint: hint)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.gold.opacity(0.06)))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.gold.opacity(0.22), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(s.spoken))
    }

    private func heading(_ s: WaveSolarReadout) -> some View {
        HStack(spacing: 8) {
            Circle().fill(Theme.gold).frame(width: 7, height: 7)
            Text("Solar sync").font(.caption.weight(.semibold)).foregroundStyle(Theme.gold).textCase(.uppercase)
            Text(s.number).font(.footnote.monospacedDigit().weight(.semibold)).foregroundStyle(Theme.ink)
            Spacer(minLength: 4)
            if s.edge == nil {
                WaveShareView(share: s.share, size: 15, color: Theme.ink, label: "sync phase")
            }
        }
    }

    private func wave(_ s: WaveSolarReadout) -> some View {
        WaveSyncWave(phase: s.phase, quarter: s.quarter, enabled: s.edge == nil) { phase in
            guard s.edge == nil else { return }
            control.travel(to: WaveSolar.travelTime(start: s.start, end: s.end, phase: phase))
        }
    }

    private func column(_ s: WaveSolarReadout, hint: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            heading(s)
            wave(s).frame(height: 34)
            Text(s.edge ?? s.next).font(.caption.monospacedDigit()).foregroundStyle(s.edge == nil ? Theme.ink : Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            if !s.drift.isEmpty { Text(s.drift).font(.caption2.monospacedDigit()).foregroundStyle(Theme.ink3) }
            if !hint.isEmpty { Text(hint).font(.caption2).foregroundStyle(Theme.gold.opacity(0.75)) }
        }
    }

    private func row(_ s: WaveSolarReadout, hint: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            heading(s)
            HStack(spacing: 10) {
                wave(s).frame(width: 130, height: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.edge ?? s.next).font(.caption.monospacedDigit()).foregroundStyle(s.edge == nil ? Theme.ink : Theme.ink2)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    if !s.drift.isEmpty {
                        Text(s.drift).font(.caption2.monospacedDigit()).foregroundStyle(Theme.ink3).lineLimit(1).minimumScaleFactor(0.8)
                    }
                    if !hint.isEmpty {
                        Text(hint).font(.caption2).foregroundStyle(Theme.gold.opacity(0.75)).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

/// One sync as a small sine with its four quarter points (passed filled, the coming one ringed) and the present
/// phase; drag along it to travel within the sync.
struct WaveSyncWave: View {
    let phase: Double
    let quarter: Int
    let enabled: Bool
    let travel: (Double) -> Void

    @State private var width = 130.0

    var body: some View {
        Canvas { g, size in
            let w = size.width
            let h = size.height
            var wave = Path()
            for i in 0...64 {
                let p = WaveSolar.dialPoint(phase: Double(i) / 64, width: w, height: h)
                if i == 0 { wave.move(to: CGPoint(x: p.x, y: p.y)) } else { wave.addLine(to: CGPoint(x: p.x, y: p.y)) }
            }
            var axis = Path()
            axis.move(to: CGPoint(x: 7, y: h / 2))
            axis.addLine(to: CGPoint(x: w - 7, y: h / 2))
            g.stroke(axis, with: .color(Theme.gold.opacity(0.15)), lineWidth: 1)
            g.stroke(wave, with: .color(Theme.gold.opacity(0.35)), style: StrokeStyle(lineWidth: 1.4, lineCap: .round))
            g.stroke(wave.trimmedPath(from: 0, to: phase), with: .color(Theme.gold), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
            for k in 1...4 {
                let p = WaveSolar.dialPoint(phase: Double(k) / 4, width: w, height: h)
                let next = k == quarter + 1
                let r = next ? 3.2 : 2.2
                let dot = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r))
                if k <= quarter {
                    g.fill(dot, with: .color(Theme.gold.opacity(0.85)))
                } else {
                    g.fill(dot, with: .color(Theme.background2))
                    g.stroke(dot, with: .color(Theme.gold.opacity(next ? 1 : 0.6)), lineWidth: next ? 1.5 : 1)
                }
            }
            if enabled {
                let p = WaveSolar.dialPoint(phase: phase, width: w, height: h)
                g.fill(Path(ellipseIn: CGRect(x: p.x - 6, y: p.y - 6, width: 12, height: 12)), with: .color(Theme.gold.opacity(0.25)))
                g.fill(Path(ellipseIn: CGRect(x: p.x - 3.6, y: p.y - 3.6, width: 7.2, height: 7.2)), with: .color(Theme.gold))
            }
        }
        .contentShape(Rectangle())
        .onGeometryChange(for: Double.self) { $0.size.width } action: { width = $0 }
        .gesture(DragGesture(minimumDistance: 0).onChanged { v in
            guard enabled else { return }
            travel(min(1, max(0, (v.location.x - 7) / max(1, width - 14))))
        })
        .accessibilityHidden(true)
    }
}

/// The picture's one-sentence explanation and its keys, in the current vocabulary.
struct WaveLegend: View {
    let words: WaveWords
    let overview: Bool
    let solar: Bool
    /// The colour of the level in view, which the keys wear.
    var tint = Theme.levelColor(6)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(words.caption()).font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 7) {
                key(dot: true, "displayed time, one dot per depth")
                key(line: 1, "travelled")
                key(line: 0.34, "remaining")
                if overview {
                    key(symbol: "circle.fill", words.eclipseLegend(), color: Theme.ink2)
                } else {
                    key(text: "+3  −2", "crest · trough: the n-th loop in the parent half-arc")
                    key(text: "┼", "begin · peak or valley · node or end")
                    key(symbol: "line.diagonal", "tether to the next depth's dot; a lettered circle on the edge is a dot off the stage")
                }
                if solar { key(symbol: "water.waves", words.sunLegend(), color: Theme.gold) }
            }
            .font(.caption)
            .foregroundStyle(Theme.ink3)
            if words.pure {
                Text("The glossary in Settings explains every term.").font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }

    private func key(dot: Bool = false, line: Double? = nil, symbol: String? = nil, text: String? = nil, _ label: String, color: Color? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Group {
                if dot {
                    Circle().fill(tint).frame(width: 8, height: 8).overlay(Circle().fill(.white).frame(width: 3, height: 3))
                } else if let line {
                    Capsule().fill(tint.opacity(line)).frame(width: 18, height: 3)
                } else if let symbol {
                    Image(systemName: symbol).font(.caption2).foregroundStyle(color ?? tint)
                } else if let text {
                    Text(text).font(.caption2.monospaced().weight(.semibold)).foregroundStyle(tint)
                }
            }
            .frame(width: 34, alignment: .center)
            Text(label).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// How to read the wave: the explanation, the legend and the gestures.
struct WaveInfoView: View {
    let words: WaveWords
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    WaveLegend(words: words, overview: false, solar: true)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Gestures").font(.headline).foregroundStyle(Theme.ink)
                        gesture("hand.draw", "Drag along the bright arc to travel in time")
                        gesture("hand.tap", "Tap a loop to jump to its start, a dot to focus its depth")
                        gesture("hand.pinch", "Pinch to change the depth; drag elsewhere to look around")
                        gesture("hand.point.up.left", "Hold still on anything to see what it is")
                        gesture("keyboard", "← → step by half-arc, ↑ ↓ change the depth, Home shows the catalogue")
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Solar wave").font(.headline).foregroundStyle(Theme.ink)
                        Text(words.sunCaption()).font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(20)
            }
            .scrollContentBackground(.hidden)
            .background { Backdrop() }
            .navigationTitle("Reading the wave")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 520)
        #endif
    }

    private func gesture(_ symbol: String, _ text: String) -> some View {
        Label {
            Text(text).font(.footnote).foregroundStyle(Theme.ink2)
        } icon: {
            Image(systemName: symbol).foregroundStyle(Theme.teal)
        }
    }
}
