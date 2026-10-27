import FractonicaKit
import SwiftUI

// The calendar's Pentads (SPEC §7.5): a chip for a Pentad, and Helions laid out like a week calendar — one row per
// Pentad, five Helion cells (the Hypopentad four, so its row is visibly shorter), the cells of the window the rows were
// laid out for bright and the rest of each Pentad dim. The grouping is CalendarPentads.swift's.

/// A Pentad as a small capsule: its shape and numeral, with its name when there is room.
struct CalPentadChip: View {
    let index: Int
    var named = false
    var filled = false
    var compact = true

    var body: some View {
        Text("\(Text.pentadMark(index))\(Text(verbatim: named ? " " + PentadWords.name(index) : ""))")
            .font(compact ? .caption.weight(.semibold) : .subheadline.weight(.semibold))
            .foregroundStyle(filled ? Theme.background : Theme.gold)
            .lineLimit(1)
            .padding(.horizontal, compact ? 6 : 8)
            .padding(.vertical, compact ? 2 : 3)
            .background { Capsule().fill(filled ? Theme.gold : Theme.gold.opacity(0.14)) }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: PentadWords.name(index)))
    }
}

/// Helions in Pentad rows, like days in week rows: the shape of each Pentad leads its row, a cell per Helion ("34η",
/// numbered in its Nuclide, with `detail` under it), tap a cell to go there.
struct CalPentadRowsView: View {
    let rows: [CalPentads.Row]
    /// The Helion holding the shown moment, ringed.
    var current: Int64?
    /// A second line for a cell (an Earth time); nil for none.
    var detail: (Int64) -> String? = { _ in nil }
    let go: (Int64) -> Void

    var body: some View {
        VStack(spacing: 6) {
            ForEach(rows) { row in
                HStack(spacing: 6) {
                    // filled: the shown moment's Pentad
                    PentadBadge(index: row.index, size: 24,
                                filled: current.map { $0 >= row.first && $0 < row.first + Int64(row.count) } ?? false)
                        .frame(width: 30)
                    ForEach(0..<5, id: \.self) { place in
                        if place < row.count {
                            cell(row, place)
                        } else {
                            // the Hypopentad's missing fifth: the row ends a Helion early
                            Color.clear.frame(maxWidth: .infinity, minHeight: 36)
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(verbatim: "\(PentadWords.name(row.index)), solar sync \(row.sync)"))
            }
        }
    }

    private func cell(_ row: CalPentads.Row, _ place: Int) -> some View {
        let h = row.first + Int64(place)
        let inside = row.inside.contains(place)
        let number = Int(((h % 77) + 77) % 77) + 1
        let sub = detail(h)
        return Button {
            go(h)
        } label: {
            VStack(spacing: 1) {
                Text(verbatim: "\(number)η")
                    .font(.reading(14, weight: .semibold))
                    .foregroundStyle(Theme.levelColor(6, opacity: inside ? 1 : 0.45))
                if let sub {
                    Text(verbatim: sub)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(inside ? Theme.ink3 : Theme.ink3.opacity(0.5))
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(inside ? Theme.panel2 : Theme.panel.opacity(0.35))
            }
            .overlay {
                if h == current {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(Theme.cursor, lineWidth: 1.5)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "\(number)η, \(PentadWords.ordinal(place + 1)) Helion of \(PentadWords.name(row.index))"
            + (inside ? "" : ", outside this span") + (sub.map { ", \($0)" } ?? "")))
        .accessibilityHint(Text("Goes there"))
    }
}
