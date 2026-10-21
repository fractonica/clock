import FractonicaKit
import SwiftUI

/// The card that follows the pointer (iPad, Mac) or the finger held down (iPhone): the moment under it, how far it is
/// from now and from the cursor, and the cycle of every lane there — Earth: place in the parent and percent; pure: a
/// major period's place and quarter word, a minor depth's placing count and its phase pair (the web tooltip).
struct TimelineInspector: View {
    let frame: TimelineFrame
    let hover: TimelineHover
    let data: TimelineData

    @State private var size = CGSize(width: 230, height: 200)

    /// Whole percent through a cycle, floored so a running cycle never reads 100 (helpers.js `percentThrough`).
    static func percent(_ fraction: Double) -> Int {
        guard fraction > 0 else { return 0 }
        return min(999, Int((fraction * 1000 + 1e-7).rounded(.down))) / 10
    }

    var body: some View {
        let t = frame.scale.t(hover.x)
        card(t)
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .offset(offset)
            .allowsHitTesting(false)
            .transition(.opacity)
            .accessibilityHidden(true)
    }

    private var offset: CGSize {
        let L = frame.layout
        var x: Double, y: Double
        if hover.touch {
            x = hover.x - size.width / 2
            y = hover.y - size.height - 36
            if y < 4 { y = hover.y + 44 }
        } else {
            x = hover.x + 16
            y = hover.y + 18
            if x + size.width > L.width - 6 { x = hover.x - size.width - 16 }
            if y + size.height > L.height - 6 { y = hover.y - size.height - 14 }
        }
        x = min(L.width - size.width - 6, max(6, x))
        y = min(max(4, L.height - size.height - 4), max(4, y))
        return CGSize(width: x, height: y)
    }

    private func card(_ t: Double) -> some View {
        let words = frame.words
        let clock = data.clock
        let inRange = clock.inRange(t)
        let laneUnder: Int? = {
            if case .lane(let i) = frame.layout.region(x: hover.x, y: hover.y).region { return i }
            return nil
        }()
        return VStack(alignment: .leading, spacing: 6) {
            Text(head(t))
                .font(.reading(13, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if !inRange {
                Text("Outside the Saros 141 catalogue. The clock is not extrapolated.")
                    .font(.caption)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    Text("now · \(relative(t, frame.now))")
                    if !frame.live, frame.cursorIn { Text("cursor · \(relative(t, frame.cursor))") }
                    if let pos = clock.position(at: t) { Text(String(format: "pos %.6f", pos)) }
                }
                .font(.reading(11))
                .foregroundStyle(Theme.ink2)
                Divider().overlay(Theme.line2)
                Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 3) {
                    ForEach(Array(frame.levels.enumerated()), id: \.element) { i, level in
                        if let r = clock.level(at: t, level) {
                            row(level: level, reading: r, on: i == laneUnder, pure: words.pure)
                        }
                    }
                }
            }
        }
        .padding(12)
        .frame(width: frame.layout.compact ? 214 : 240, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 16))
    }

    private func head(_ t: Double) -> String {
        let words = frame.words
        if words.pure {
            return data.clock.inRange(t) ? words.notation.dateText(at: t, upTo: "lambda") : "—"
        }
        let ms = TimelineSearch.ms(t)
        let precise = frame.window.span < 60
        return words.earth.long(ms, seconds: true) + (precise ? String(format: ".%03d", words.earth.parts(ms).ms) : "")
            + " " + words.earth.tag(ms)
    }

    private func relative(_ t: Double, _ ref: Double) -> String {
        frame.words.pure ? data.ruler.relText(t, to: ref) : EarthTime.countdown(t - ref)
    }

    @ViewBuilder
    private func row(level: Int, reading r: LevelReading, on: Bool, pure: Bool) -> some View {
        let info = data.clock.levelInfo(level)
        let color = Theme.levelColor(level, lightness: on ? 0.8 : 0.72)
        GridRow {
            Text("\(info.letter) \(info.depth)")
                .font(.code(11, weight: on ? .bold : .medium))
                .foregroundStyle(color)
            if pure {
                if Notation.isMajor(level) {
                    Text("\(Notation.shortName(level: level, ordinal: r.local + 1)) \(Notation.quarterWords[r.quarter])")
                        .font(.reading(11, weight: on ? .semibold : .regular))
                        .foregroundStyle(Theme.ink)
                        .gridCellColumns(2)
                } else {
                    Text(data.names(level, r.cycle).short)
                        .font(.reading(11, weight: on ? .semibold : .regular))
                        .foregroundStyle(Theme.ink)
                    PairView(fraction: r.phase, color: color, height: 10)
                        .gridColumnAlignment(.trailing)
                }
            } else {
                Text("\(r.local + 1)/\(r.siblings)")
                    .font(.reading(11, weight: on ? .semibold : .regular))
                    .foregroundStyle(Theme.ink)
                Text("\(Self.percent(r.progress))%")
                    .font(.reading(11))
                    .foregroundStyle(Theme.ink2)
                    .gridColumnAlignment(.trailing)
            }
        }
    }
}
