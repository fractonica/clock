import FractonicaKit
import SwiftUI

/// What the Pentads are (SPEC §7.5), opened from the Pentad card: the two-way relation between the Helion and the Sun
/// in a few lines, a diagram of the four Pentads in the time of day — the Sun a quarter Helion further on at each
/// Pentad's start, back in step after the Hypopentad — and the four Pentads with their lengths. The diagram plays its
/// steps in turn (still with Reduce Motion, showing the running Pentad).
struct PentadExplainer: View {
    var fixed: Double?

    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let pure = settings.pure
        let t = fixed ?? store.time()
        let now = Pentads.at(t)
        List {
            Section {
                VStack(alignment: .leading, spacing: 14) {
                    Text(verbatim: PentadExplainerText.lead(pure: pure))
                        .font(.body)
                        .foregroundStyle(Theme.ink)
                    PentadDayDiagram(animated: !reduceMotion, current: now?.index ?? 0, pure: pure)
                }
                .padding(.vertical, 6)
            }
            Section {
                relation(symbol: "sun.max", title: "From the Sun", text: PentadExplainerText.fromSun(pure: pure))
                relation(symbol: "pentagon", title: "From the Helion", text: PentadExplainerText.fromHelion(pure: pure))
            } footer: {
                Text(verbatim: PentadExplainerText.weekday(pure: pure))
            }
            Section("The four Pentads of a sync") {
                ForEach(PentadExplainerText.rows(pure: pure), id: \.index) { row in
                    HStack(spacing: 12) {
                        PentadBadge(index: row.index, size: 26, filled: row.index == now?.index)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: PentadWords.name(row.index)).font(.body.weight(.semibold))
                            Text(verbatim: "\(row.helions) · \(row.length)")
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                        }
                        Spacer()
                        Text(verbatim: row.start)
                            .font(.callout.monospacedDigit())
                            .foregroundStyle(Theme.gold)
                            .accessibilityLabel(Text(verbatim: "starts \(row.start) later in the day"))
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            if let now {
                Section("Now") {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("\(Text.pentadMark(now.index).foregroundStyle(Theme.gold)) \(Text(verbatim: PentadWords.full(now)))")
                            .font(.body.weight(.medium))
                        Text(verbatim: "sync \(now.sync) · " + example(t, pure: pure))
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Pentads")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
    }

    private func relation(symbol: String, title: String, text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(Theme.gold)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline)
                Text(verbatim: text)
                    .font(.callout)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    /// The moment as a date leads with it: "Pentad II · δ#3 ε#2 5η 5ι".
    private func example(_ t: Double, pure: Bool) -> String {
        let n = settings.wording.notation
        return PentadWords.lead(n.dateText(at: t, letters: true, upTo: "iota"), at: t)
    }
}

/// The four Pentads of a sync in the time of day: one solar day (4¾η) between two gold lines, each Pentad's Helions a
/// row starting ¼η further right than the one above, the Hypopentad ending on the fourth day's turn, and the next
/// sync's Pentad I back at the start. The Sun stands over the start of the Pentad in focus: a quarter Helion further
/// on each Pentad, back after the Hypopentad. Animated, it steps through them (Pentad I, II, III, the Hypopentad, the
/// next Pentad I); still, it shows `current`.
struct PentadDayDiagram: View {
    var animated: Bool
    var current: Int
    var pure: Bool

    private static let steps = [0, 1, 2, 3, 4]

    var body: some View {
        if animated {
            PhaseAnimator(Self.steps) { step in
                diagram(step: step)
            } animation: { _ in
                .easeInOut(duration: 0.7).delay(1.6)
            }
        } else {
            diagram(step: current)
        }
    }

    private func diagram(step: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            DiagramRows(step: step)
                .frame(height: DiagramRows.height)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: "Four rows of Helions in the time of day: each Pentad starts a quarter Helion later than the one before, and the Hypopentad, one Helion short, ends where the fourth day turns."))
            Text(verbatim: PentadExplainerText.step(step, pure: pure))
                .font(.callout)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .topLeading)
                .contentTransition(.opacity)
        }
    }
}

/// The diagram's rows, laid out in Helions of the day (`PentadCardModel.rows`, and a fifth: the next Pentad I).
private struct DiagramRows: View {
    let step: Int

    static let rowHeight: CGFloat = 16
    static let rowGap: CGFloat = 9
    static let sky: CGFloat = 34
    static var height: CGFloat { sky + 5 * rowHeight + 4 * rowGap + 4 }
    /// Room for the labels left of the rows.
    static let gutter: CGFloat = 34
    /// The span drawn, in Helions of the day.
    static let span = 5.75

    var body: some View {
        GeometryReader { geo in
            let unit = (geo.size.width - Self.gutter) / Self.span
            let x = { (h: Double) in Self.gutter + h * unit }
            let focus = min(step, 4)
            let sunAt = focus == 4 ? 0 : Pentads.dayOffset(focus)
            ZStack(alignment: .topLeading) {
                // the solar day: two gold lines a day apart, the bracket between them
                ForEach([0.0, Pentads.solarDay], id: \.self) { line in
                    Rectangle()
                        .fill(Theme.gold.opacity(0.6))
                        .frame(width: 1, height: Self.height - Self.sky + 10)
                        .offset(x: x(line), y: Self.sky - 6)
                }
                Text(verbatim: "1 solar day = 4¾η")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.gold)
                    .frame(width: Pentads.solarDay * unit)
                    .offset(x: x(0), y: Self.sky - 18)
                // the Sun over the start of the Pentad in focus: a quarter Helion on each time, back after the Hypopentad
                Image(systemName: "sun.max.fill")
                    .font(.system(size: 15))
                    .foregroundStyle(Theme.gold)
                    .frame(width: 20, height: 18)
                    .offset(x: x(sunAt) - 10, y: 0)
                if focus > 0 && focus < 4 {
                    Text(verbatim: ["", "+¼η", "+½η", "+¾η"][focus])
                        .font(.caption2.monospacedDigit().weight(.semibold))
                        .foregroundStyle(Theme.gold)
                        .fixedSize()
                        .offset(x: x(sunAt) + 12, y: 2)
                }
                ForEach(0..<5, id: \.self) { r in
                    let row = PentadCardModel.rows[r % 4]
                    let offset = r == 4 ? 0 : row.offset
                    let y = Self.sky + CGFloat(r) * (Self.rowHeight + Self.rowGap)
                    let lit = r == focus
                    Group {
                        Text.pentadMark(row.index)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(lit ? Theme.gold : Theme.ink3)
                            .frame(width: Self.gutter - 6, height: Self.rowHeight, alignment: .leading)
                            .offset(x: 0, y: y)
                        ForEach(0..<row.cells, id: \.self) { c in
                            let cellX = x(offset + Double(c))
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(lit ? Theme.gold.opacity(0.85) : Theme.panel3)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                                        .strokeBorder(lit ? Theme.gold : Theme.line2, lineWidth: 1)
                                }
                                .frame(width: max(1, unit - 3), height: Self.rowHeight)
                                .offset(x: cellX + 1.5, y: y)
                        }
                    }
                    .opacity(r == 4 && focus < 4 ? 0.35 : 1)
                }
            }
        }
    }
}
