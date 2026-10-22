import FractonicaKit
import SwiftUI

/// What lies under the pointer (or a finger holding still): a half-arc, a point on the focused arc, a level's dot or
/// the solar pin, with its span, place, length, countdown and glyph state (src/ui/wave/tooltip.js).
struct WaveTipView: View {
    let pick: WavePick
    let location: CGPoint
    let stageSize: CGSize
    let control: WaveController
    /// Above the point (a finger covers what is below it).
    let above: Bool

    @State private var size = CGSize(width: 260, height: 140)

    #if os(iOS)
    private let verb = "Tap"
    #else
    private let verb = "Click"
    #endif

    var body: some View {
        ClockTimeline(.periodic(0.25)) { t in
            card(control.shown(t))
        }
        .fixedSize()
        .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
        .offset(x: placement.x, y: placement.y)
    }

    private var placement: CGPoint {
        var x = location.x + 16
        var y = above ? location.y - size.height - 28 : location.y + 18
        if x + size.width > stageSize.width - 8 { x = location.x - size.width - 16 }
        if y + size.height > stageSize.height - 8 { y = location.y - size.height - 14 }
        if y < 8 { y = min(stageSize.height - size.height - 8, location.y + 28) }
        return CGPoint(x: max(8, x), y: max(8, y))
    }

    @ViewBuilder
    private func card(_ t: Double) -> some View {
        Group {
            if pick.kind == .sun {
                sunCard(t)
            } else {
                arcCard(t)
            }
        }
        .padding(12)
        .frame(maxWidth: 300, alignment: .leading)
        .glassSurface(.regular.tint(Theme.panel.opacity(0.55)), in: .rect(cornerRadius: 16))
    }

    private func arcCard(_ t: Double) -> some View {
        let engine = control.engine
        let d = engine.describe(pick.level, pick.idx)
        let marker = pick.kind == .marker
        let at = marker ? nil : engine.timeAt(pick.level, pick.idx, pick.t)
        let action: String? = switch pick.kind {
        case .child: "\(verb) to jump to the start of this half-arc"
        case .alpha: "\(verb) or drag to travel along the wave"
        case .focus: "\(verb) or drag to travel along this arc"
        case .marker: pick.level == control.eff && !control.overview ? nil : "\(verb) to focus this depth"
        case .sun: nil
        }
        let tip = control.words.tip(d, p: pick.t, at: at, now: t, marker: marker, action: action)
        let tint = Theme.levelColor(tip.level)
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(tip.letter)
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(tint)
                    .frame(width: 22, height: 22)
                    .background(RoundedRectangle(cornerRadius: 6).fill(tint.opacity(0.15)))
                Text(tip.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(tip.sign).font(.caption2).foregroundStyle(Theme.ink3)
            }
            Text(tip.span).font(.caption.monospaced()).foregroundStyle(Theme.ink2).lineLimit(2)
            Text(tip.place).font(.caption).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 4) {
                Text(tip.length)
                if let pair = tip.pair {
                    PairView(fraction: pair, color: Theme.ink2, height: 12)
                    Text(tip.pairSuffix)
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(Theme.ink3)
            Text(tip.when).font(.caption.monospacedDigit()).foregroundStyle(Theme.ink)
            if tip.clipped {
                Text("clipped by the end of the catalogue").font(.caption2).foregroundStyle(Theme.ink3)
            }
            if let g = tip.glyph {
                HStack(alignment: .top, spacing: 8) {
                    GlyphView(index: g.index, strokes: 2, color: Theme.levelColor(tip.level, lightness: 0.7))
                        .frame(height: 26)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(Text(g.label).font(.caption.monospaced().weight(.semibold)).foregroundStyle(Theme.ink)) \(Text(g.direction).font(.caption).foregroundStyle(Theme.ink2))")
                        Text(g.note).font(.caption2).foregroundStyle(Theme.ink3)
                        if let at = g.at { Text(at).font(.caption2.monospaced()).foregroundStyle(Theme.ink3) }
                    }
                }
                .padding(.top, 2)
            }
            if let action = tip.action {
                Text(action).font(.caption2.weight(.medium)).foregroundStyle(Theme.teal).padding(.top, 2)
            }
        }
    }

    private func sunCard(_ t: Double) -> some View {
        let words = control.words
        let s = WaveSolarReadout.make(t: t, words: words)
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Circle().fill(Theme.gold).frame(width: 8, height: 8)
                Text("Solar sync \(s?.number ?? "")").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                Text(words.sunDefinition()).font(.caption2).foregroundStyle(Theme.ink3)
            }
            if let s, s.edge == nil {
                HStack(spacing: 4) {
                    Text("Phase")
                    WaveShareView(share: s.share, size: 12, color: Theme.ink2, label: "sync phase")
                    Text("of this sync")
                }
                .font(.caption)
                .foregroundStyle(Theme.ink2)
                Text("Next \(s.next)").font(.caption.monospacedDigit()).foregroundStyle(Theme.ink)
                Text(s.drift).font(.caption.monospacedDigit()).foregroundStyle(Theme.ink3)
                Text("peak, node, valley, end: \(words.pure ? "a quarter of the sync apart" : "about a day apart")")
                    .font(.caption2).foregroundStyle(Theme.ink3)
                Text("Drag the pin to travel within this sync").font(.caption2.weight(.medium)).foregroundStyle(Theme.gold)
            } else {
                Text(words.sunEdge()).font(.caption).foregroundStyle(Theme.ink2)
            }
        }
    }
}
