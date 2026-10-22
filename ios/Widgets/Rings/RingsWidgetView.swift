import FractonicaKit
import SwiftUI
import WidgetKit

/// A snapshot of the Rings dial: α outermost through η, each cycle's progress from 12 o'clock, the Helion's pair and
/// the minor clock in the middle; the large size adds the next Helion and a legend of every ring's place in its parent.
struct RingsWidgetView: View {
    enum Size: Sendable { case small, large }

    var snapshot: RingsSnapshot?
    var size: Size

    var body: some View {
        if let s = snapshot {
            switch size {
            case .small: small(s)
            case .large: large(s)
            }
        } else {
            OutOfRangeView(compact: size == .small)
        }
    }

    private func small(_ s: RingsSnapshot) -> some View {
        GeometryReader { geo in
            let d = min(geo.size.width, geo.size.height)
            ZStack {
                RingDial(rings: s.rings, inner: 0.42)
                    .widgetAccentable()
                VStack(spacing: d * 0.025) {
                    PairGlyphs(digits: s.helionPair, color: Theme.teal, lineWidth: 1.3)
                        .frame(height: d * 0.12)
                    TokensText(tokens: s.tokens, size: d * 0.075)
                }
                .frame(width: d * 0.36)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.accessibility)
    }

    private func large(_ s: RingsSnapshot) -> some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let d = min(w, h * 0.84)
            VStack(spacing: 0) {
                ZStack {
                    RingDial(rings: s.rings, inner: 0.44)
                        .widgetAccentable()
                    VStack(spacing: d * 0.02) {
                        PairGlyphs(digits: s.helionPair, color: Theme.teal)
                            .frame(height: d * 0.11)
                        TokensText(tokens: s.tokens, size: d * 0.07)
                        if let next = s.next {
                            nextLine(next, size: d * 0.042)
                        }
                    }
                    .frame(width: d * 0.4)
                }
                .frame(width: d, height: d)
                Spacer(minLength: 0)
                legend(s, width: w)
            }
            .frame(width: w, height: h)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(s.accessibility)
    }

    /// "→ 35η in 7ι" or, with Earth words, "→ 35η" over the live countdown.
    @ViewBuilder
    private func nextLine(_ t: Turnover, size: CGFloat) -> some View {
        if let text = t.countdown {
            Text("→ \(t.begins ?? "end") in \(text)")
                .font(.system(size: size))
                .ink(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        } else {
            VStack(spacing: 0) {
                Text("→ \(t.begins ?? "end")")
                    .font(.system(size: size))
                    .ink(.secondary)
                LiveCountdown(end: t.time, size: size, weight: .regular, ink: .secondary)
                    .multilineTextAlignment(.center)
            }
        }
    }

    /// Each ring's place in its parent: "α 6/18", "β 4/5", … in the ring's colour.
    private func legend(_ s: RingsSnapshot, width: CGFloat) -> some View {
        HStack(spacing: 0) {
            ForEach(s.rings, id: \.level) { ring in
                VStack(spacing: 1) {
                    Text(Fractonica.periodName(ring.level).text)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.levelColor(ring.level))
                    Text(verbatim: "\(ring.local + 1)/\(ring.siblings)")
                        .font(.reading(10))
                        .ink(.tertiary)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(width: width)
    }
}
