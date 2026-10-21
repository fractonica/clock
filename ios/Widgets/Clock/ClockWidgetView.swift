import FractonicaKit
import SwiftUI
import WidgetKit

/// The clock in a line, after the watch face's elements (SPEC §8): the Helion's phase pair over the gold solar
/// odometer on the left; the short date, the minor clock, the next Helion and the solar sync (pure) or the Earth day
/// (Earth words) on the right.
struct ClockWidgetView: View {
    var snapshot: ClockSnapshot?

    var body: some View {
        if let s = snapshot {
            GeometryReader { geo in
                let h = geo.size.height
                HStack(spacing: h * 0.16) {
                    instrument(s, height: h)
                    readout(s, height: h)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(width: geo.size.width, height: h)
            }
            .accessibilityElement(children: .combine)
        } else {
            OutOfRangeView()
        }
    }

    /// The watch face in miniature: the Helion pair (teal) over the solar odometer (gold).
    private func instrument(_ s: ClockSnapshot, height h: CGFloat) -> some View {
        VStack(spacing: h * 0.13) {
            PairGlyphs(digits: s.helionPair, color: Theme.teal)
                .frame(height: h * 0.44)
                .widgetAccentable()
            if let solar = s.solarDigits {
                OdometerView(digits: solar, strokes: 2, color: Theme.gold, spacing: 1.1)
                    .frame(height: h * 0.2)
                    .accessibilityLabel("solar odometer \(solar.map(String.init).joined(separator: " "))")
            }
        }
        .frame(width: h * 0.82)
    }

    private func readout(_ s: ClockSnapshot, height h: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: h * 0.035) {
            Text("\(s.major) · \(s.nuclide)")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            TokensText(tokens: s.tokens, size: h * 0.3)
            nextHelion(s)
                .font(.system(size: 13))
                .foregroundStyle(Theme.ink2)
            footnote(s)
                .font(.system(size: 11))
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
    }

    /// "→ 35η in 7ι" (pure: Preons still to start) or "→ 35η 12:56 · 56:12" (Earth, counting down live).
    @ViewBuilder
    private func nextHelion(_ s: ClockSnapshot) -> some View {
        if let next = s.nextHelion {
            if s.earthDay == nil {
                Text("→ \(next) in \(s.nextHelionWhen)").lineLimit(1)
            } else {
                HStack(spacing: 0) {
                    Text("→ \(next) at \(s.nextHelionWhen) · ").lineLimit(1)
                    LiveCountdown(end: s.helionEnd, size: 13, weight: .regular, color: Theme.ink2)
                        .fixedSize()
                }
            }
        } else {
            Text("the catalogue ends with this Helion").lineLimit(1).minimumScaleFactor(0.7)
        }
    }

    @ViewBuilder
    private func footnote(_ s: ClockSnapshot) -> some View {
        if let day = s.earthDay {
            Text("\(day) · \(s.earthZone ?? "")")
        } else if !s.solarText.isEmpty {
            HStack(spacing: 5) {
                Circle().fill(Theme.gold).frame(width: 5, height: 5)
                Text(s.solarText)
            }
        }
    }
}
