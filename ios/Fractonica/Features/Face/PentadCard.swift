import FractonicaKit
import SwiftUI

/// The Pentad card (SPEC §7.5): the Helion's link to the Sun at a glance. The running solar sync's 19 Helions as four
/// rows — Pentad I, II, III and the Hypopentad — laid out in the time of day between two gold lines a solar day (4¾η)
/// apart, so each row starts ¼η later than the one above and the Hypopentad, a Helion short, ends exactly on the
/// fourth day's turn; the running Helion lit with its completed Preons, and when the next Pentad begins. A tap opens
/// the explainer. It redraws once a Preon (and once a minute for an Earth countdown), never per second.
struct PentadCard: View {
    /// A still instant (the face's `-FXFaceTime` hook), else the displayed time.
    var fixed: Double?
    /// Tighter rows and no caption (iPhone portrait under the face).
    var compact = false

    @Environment(AppSettings.self) private var settings
    @State private var explainerShown: Bool

    /// `explains`: open the explainer at once (the `-FXFacePentads` hook).
    init(fixed: Double? = nil, compact: Bool = false, explains: Bool = false) {
        self.fixed = fixed
        self.compact = compact
        _explainerShown = State(initialValue: explains)
    }

    var body: some View {
        let pure = settings.pure
        Button {
            explainerShown = true
        } label: {
            NowTimeline(fixed: fixed, next: { PentadCardModel.change(after: $0, pure: pure) }) { t in
                if let model = PentadCardModel.make(at: t) {
                    content(model, at: t, pure: pure)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(Text(verbatim: model.spoken(at: t, pure: pure)))
                } else {
                    Text(verbatim: "No Pentad outside the catalogue")
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.horizontal, compact ? 12 : 14)
            .padding(.vertical, compact ? 9 : 12)
            .background(Theme.panel.opacity(0.7), in: .rect(cornerRadius: compact ? 14 : 16, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: compact ? 14 : 16, style: .continuous).strokeBorder(Theme.line, lineWidth: 1)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Shows how the Pentads follow the Sun"))
        .help("How the Pentads follow the Sun")
        .sheet(isPresented: $explainerShown) {
            NavigationStack { PentadExplainer(fixed: fixed) }
                #if os(iOS)
                .sheetDetents([.large])
                #else
                .frame(minWidth: 520, minHeight: 640)
                #endif
        }
    }

    @ViewBuilder
    private func content(_ m: PentadCardModel, at t: Double, pure: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 7 : 10) {
            HStack(alignment: .center, spacing: 8) {
                PentadBadge(index: m.index, size: compact ? 18 : 22, filled: true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: PentadWords.name(m.index))
                        .font((compact ? Font.subheadline : .headline).weight(.semibold))
                        .foregroundStyle(Theme.gold)
                    if !compact {
                        Text(verbatim: "\(PentadWords.ordinal(m.helion)) Helion of \(m.helions) · sync \(m.sync)")
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                    }
                }
                if compact {
                    Text(verbatim: "\(PentadWords.ordinal(m.helion)) Helion of \(m.helions)")
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: 6)
                if let next = m.nextIndex, let countdown = PentadCardModel.countdown(at: t, to: m.end, pure: pure) {
                    Text("\(Text.pentadMark(next).foregroundStyle(Theme.ink2)) \(Text(verbatim: countdown))")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Theme.ink2)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            PentadRows(model: m, rowHeight: compact ? 8 : 12, spacing: compact ? 4 : 6)
            if !compact {
                Text(verbatim: pure
                     ? "4¾η is a solar day: each Pentad starts ¼η later in the day, and the Hypopentad, one Helion short, brings the Sun back."
                     : "A solar day is 4¾ Helions: each Pentad starts ¼ Helion (≈ 1.26 h) later in the day, and the Hypopentad, one Helion short, brings the Sun back.")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// The four rows of a sync's Helions in the time of day (`PentadCardModel.rows`): row marks on the left, the cells
/// placed ¼η further right each row, gold lines where the solar day turns (the sync's start time of day and a day
/// later); the running Helion lit with its progress, the ones before it filled.
struct PentadRows: View {
    let model: PentadCardModel
    var rowHeight: CGFloat = 12
    var spacing: CGFloat = 6

    private var height: CGFloat { 4 * rowHeight + 3 * spacing }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: spacing) {
                ForEach(PentadCardModel.rows, id: \.index) { row in
                    Text.pentadMark(row.index)
                        .font(.system(size: rowHeight * 0.95, weight: .semibold))
                        .foregroundStyle(row.index == model.index ? Theme.gold : Theme.ink3)
                        .frame(height: rowHeight)
                }
            }
            .frame(width: rowHeight * 2.4, alignment: .leading)
            .accessibilityHidden(true)
            Canvas { context, size in draw(in: &context, size: size) }
                .frame(height: height)
                .accessibilityHidden(true)
        }
        .frame(height: height)
    }

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let unit = size.width / PentadCardModel.span
        let gap = max(1.5, min(3, unit * 0.06))
        let radius = min(rowHeight * 0.3, 3)
        // the solar day's turns, under the cells
        for line in PentadCardModel.dayLines {
            let x = (line * unit).rounded() + (line == 0 ? 0.5 : -0.5)
            var path = Path()
            path.move(to: CGPoint(x: x, y: -2))
            path.addLine(to: CGPoint(x: x, y: size.height + 2))
            context.stroke(path, with: .color(Theme.gold.opacity(0.75)), style: StrokeStyle(lineWidth: 1, dash: [2, 2]))
        }
        for row in PentadCardModel.rows {
            let y = CGFloat(row.index) * (rowHeight + spacing)
            for c in 0..<row.cells {
                let place = row.first + c
                let x0 = (row.offset + Double(c)) * unit
                let rect = CGRect(x: x0 + gap / 2, y: y, width: unit - gap, height: rowHeight)
                let shape = Path(roundedRect: rect, cornerRadius: radius, style: .continuous)
                // past the day's turn the Helion belongs to the next solar day: a little fainter
                let tomorrow = row.offset + Double(c) + 0.5 > Pentads.solarDay
                if place < model.cell {
                    context.fill(shape, with: .color(Theme.gold.opacity(tomorrow ? 0.28 : 0.4)))
                } else if place == model.cell {
                    context.fill(shape, with: .color(Theme.gold.opacity(0.14)))
                    let lit = CGRect(x: rect.minX, y: rect.minY, width: rect.width * model.progress, height: rect.height)
                    context.drawLayer { layer in
                        layer.clip(to: shape)
                        layer.fill(Path(lit), with: .color(Theme.gold))
                    }
                    context.stroke(shape, with: .color(Theme.gold), lineWidth: 1)
                } else {
                    context.stroke(shape, with: .color(Theme.line2.opacity(tomorrow ? 0.7 : 1)), lineWidth: 1)
                }
            }
        }
    }
}
