import FractonicaKit
import SwiftUI

/// A Pentad over its days in the journal's stack (SPEC §7.5), as a week over its days: the Pentad's shape and name,
/// where it lies (the Earth span; pure mode its Helions and the sync), and a cell for each of its Helions — five, four
/// in the Hypopentad, which shows a cell short — lit where the journal has entries.
struct JournalPentadHeader: View {
    let band: JournalPentadBand
    let words: Wording

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .center, spacing: 10) {
                PentadBadge(index: band.index, size: 24, color: Theme.gold.opacity(0.9))
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: PentadWords.name(band.index))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.gold.opacity(0.92))
                    Text(verbatim: span)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                Spacer(minLength: 8)
                JournalPentadCells(helions: band.helions, places: band.places)
            }
            Rectangle()
                .fill(Theme.gold.opacity(0.16))
                .frame(height: 1)
        }
        .padding(.top, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(band.summary), \(span)"))
        .accessibilityAddTraits(.isHeader)
    }

    /// "Thu 8 Oct 15:02 – Fri 16:18" · pure "30η – 34η · sync 4820".
    private var span: String {
        let start = band.start + 1e-3, last = max(band.start, band.end - 1e-3)
        if words.pure {
            let n = words.notation
            guard let a = n.clock(at: start), let b = n.clock(at: last) else { return "sync \(band.sync)" }
            return "\(a.eta)η – \(b.eta)η · sync \(band.sync)"
        }
        return JournalPentadWords.earthSpan(start: band.start, end: band.end, earth: words.earth)
    }
}

extension Text {
    /// A reading in the code face led by its Pentad's mark in the system face of the same size (the monospaced face
    /// spreads the mark's thin space and numeral over whole cells): "⬠II δ#3 ε#2 5η 5ι". Without a Pentad (outside
    /// the catalogue, or `t` nil) the reading alone.
    static func journalCode(_ reading: String, at t: Double?, size: CGFloat, weight: Font.Weight = .medium) -> Text {
        let code = Text(verbatim: reading).font(.code(size, weight: weight))
        guard let t, FractonicaClock.shared.inRange(t), let index = Pentads.index(at: t) else { return code }
        return Text.ledByPentad(index, code).font(.system(size: size, weight: weight))
    }
}

/// A Pentad's Helions as small cells in time order, lit where the journal has entries.
struct JournalPentadCells: View {
    let helions: Int
    let places: Set<Int>
    var cell: CGFloat = 9

    var body: some View {
        HStack(spacing: 3) {
            ForEach(1...max(1, helions), id: \.self) { place in
                let lit = places.contains(place)
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .strokeBorder(lit ? Color.clear : Theme.line2, lineWidth: 1)
                    .background(lit ? Theme.gold.opacity(0.8) : Color.clear, in: .rect(cornerRadius: 2, style: .continuous))
                    .frame(width: cell, height: cell)
            }
        }
        .accessibilityHidden(true)
    }
}
