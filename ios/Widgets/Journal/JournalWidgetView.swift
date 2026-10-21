import FractonicaKit
import SwiftUI
import WidgetKit

/// The journal face in a widget (src/ui/face/journal.js): the lead unit's phase on top, the counts in the middle, the
/// lead cycle as two half-arcs with a tick below. A major period (α β γ δ) is shown alone: its 3-stroke glyph and four
/// lines of words.
struct JournalWidgetView: View {
    enum Size: Sendable { case small, large }

    var snapshot: JournalSnapshot?
    var size: Size

    var body: some View {
        if let snapshot {
            Group {
                if snapshot.isMajor { major(snapshot) } else { minor(snapshot) }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Journal face: \(snapshot.accessibility)")
        } else {
            OutOfRangeView(compact: size == .small)
        }
    }

    private func leadColor(_ s: JournalSnapshot) -> Color { Theme.levelColor(s.leadLevel) }

    // MARK: Minor units: pair, counts, arc

    @ViewBuilder
    private func minor(_ s: JournalSnapshot) -> some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let large = size == .large
            let pairHeight = h * (large ? 0.25 : 0.27)
            let countSize = min(h * (large ? 0.14 : 0.2), w * 0.95 / (CGFloat(max(7, characters(s))) * 0.62))
            let arcHeight = h * (large ? 0.25 : 0.31)
            VStack(spacing: 0) {
                top(s, height: pairHeight, letterSize: large ? 15 : 11)
                Spacer(minLength: 0)
                VStack(spacing: large ? 9 : 5) {
                    TokensText(tokens: s.tokens, size: countSize)
                    if let preon = s.preon {
                        // the running Preon: the Flavons the widget cannot count, drawn as a moving bar
                        LiveBar(range: preon, color: Theme.levelColor(8), thickness: large ? 3 : 2)
                            .frame(width: min(w, countSize * CGFloat(characters(s)) * 0.6))
                            .opacity(0.9)
                    }
                }
                Spacer(minLength: 0)
                arc(s, height: arcHeight, letterSize: large ? 14 : 10)
                if large {
                    Text(s.caption)
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .padding(.top, 10)
                }
            }
            .frame(width: w, height: h)
        }
    }

    private func characters(_ s: JournalSnapshot) -> Int {
        s.tokens.map(\.text.count).reduce(max(0, s.tokens.count - 1), +)
    }

    /// The lead phase: the pair, with the lead's letter beside it.
    private func top(_ s: JournalSnapshot, height: CGFloat, letterSize: CGFloat) -> some View {
        HStack(alignment: .bottom, spacing: letterSize * 0.5) {
            if case .pair(let hi, let lo) = s.top {
                PairGlyphs(digits: [hi, lo], color: leadColor(s))
                    .frame(height: height)
                    .widgetAccentable()
            }
            Text(s.leadLetter)
                .font(.system(size: letterSize, weight: .medium))
                .foregroundStyle(leadColor(s))
                .widgetAccentable()
        }
        // keep the pair centred: the letter hangs to its right
        .padding(.leading, letterSize * 1.1)
    }

    private func arc(_ s: JournalSnapshot, height: CGFloat, letterSize: CGFloat) -> some View {
        JournalArc(phase: s.leadPhase, color: leadColor(s), tickColor: Theme.ink)
            .frame(height: height)
            .widgetAccentable()
    }

    // MARK: Major periods: glyph, four lines, arc

    @ViewBuilder
    private func major(_ s: JournalSnapshot) -> some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            if size == .large {
                VStack(spacing: 0) {
                    glyph(s, height: h * 0.3)
                    Spacer(minLength: 6)
                    lines(s, size: min(28, w / 12), alignment: .center)
                    Spacer(minLength: 6)
                    arc(s, height: h * 0.22, letterSize: 14)
                }
                .frame(width: w, height: h)
            } else {
                VStack(spacing: 0) {
                    HStack(alignment: .center, spacing: w * 0.08) {
                        glyph(s, height: h * 0.52)
                        lines(s, size: min(16, w / 8.6), alignment: .leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, w * 0.03)
                    Spacer(minLength: 0)
                    arc(s, height: h * 0.3, letterSize: 10)
                }
                .frame(width: w, height: h)
            }
        }
    }

    private func glyph(_ s: JournalSnapshot, height: CGFloat) -> some View {
        Group {
            if case .glyph3(let index) = s.top {
                GlyphView(index: index, strokes: 3, color: leadColor(s))
                    .frame(height: height)
                    .widgetAccentable()
            }
        }
    }

    /// "5th / Delta / Trifracton / End": the child's ordinal and the quarter small, the name and the fracton word in
    /// the level's colour.
    private func lines(_ s: JournalSnapshot, size: CGFloat, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: size * 0.08) {
            ForEach(Array(s.lines.enumerated()), id: \.offset) { i, line in
                let emphasis = i == 1 || i == 2
                Text(line)
                    .font(.system(size: emphasis ? size : size * 0.78, weight: emphasis ? .semibold : .regular))
                    .foregroundStyle(emphasis ? leadColor(s) : Theme.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
    }
}
