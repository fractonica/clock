import FractonicaKit
import SwiftUI
import WidgetKit

/// The extra-large overview (iPad, Mac): the clock on the left, the rings dial in the middle, up next on the right.
struct OverviewWidgetView: View {
    var snapshot: OverviewSnapshot?

    var body: some View {
        if let s = snapshot {
            GeometryReader { geo in
                let w = geo.size.width, h = geo.size.height
                HStack(spacing: 0) {
                    clock(s.clock, height: h)
                        .frame(width: w * 0.3, alignment: .leading)
                    Spacer(minLength: 0)
                    dial(s.rings, side: min(h, w * 0.29))
                    Spacer(minLength: 0)
                    upNext(s.upNext)
                        .frame(width: w * 0.36)
                }
                .frame(width: w, height: h)
            }
        } else {
            OutOfRangeView()
        }
    }

    // MARK: Clock

    private func clock(_ c: ClockSnapshot, height h: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(c.major) · \(c.nuclide)")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            TokensText(tokens: c.tokens, size: min(46, h * 0.17))
                .padding(.top, 2)
            nextHelion(c)
                .font(.system(size: 14))
                .foregroundStyle(Theme.ink2)
                .padding(.top, 4)
            Spacer(minLength: 8)
            HStack(alignment: .bottom, spacing: 18) {
                PairGlyphs(digits: c.helionPair, color: Theme.teal)
                    .frame(height: h * 0.24)
                    .widgetAccentable()
                if let solar = c.solarDigits {
                    OdometerView(digits: solar, strokes: 2, color: Theme.gold, spacing: 1.1)
                        .frame(height: h * 0.12)
                        .accessibilityLabel("solar odometer \(solar.map(String.init).joined(separator: " "))")
                }
            }
            Spacer(minLength: 8)
            Group {
                if let day = c.earthDay {
                    Text("\(day) · \(c.earthZone ?? "")")
                } else {
                    Text(c.solarText)
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(Theme.ink3)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func nextHelion(_ c: ClockSnapshot) -> some View {
        if let next = c.nextHelion {
            if c.earthDay == nil {
                Text("→ \(next) in \(c.nextHelionWhen)").lineLimit(1)
            } else {
                HStack(spacing: 0) {
                    Text("→ \(next) at \(c.nextHelionWhen) · ").lineLimit(1)
                    LiveCountdown(end: c.helionEnd, size: 14, weight: .regular, color: Theme.ink2)
                        .fixedSize()
                }
            }
        }
    }

    // MARK: Dial

    private func dial(_ r: RingsSnapshot, side: CGFloat) -> some View {
        ZStack {
            RingDial(rings: r.rings, inner: 0.44)
                .widgetAccentable()
            VStack(spacing: side * 0.03) {
                ForEach(Array(r.rings.suffix(3)), id: \.level) { ring in
                    HStack(spacing: 4) {
                        Text(Fractonica.periodName(ring.level).text)
                            .foregroundStyle(Theme.levelColor(ring.level))
                        Text("\(ring.local + 1)/\(ring.siblings)")
                            .foregroundStyle(Theme.ink2)
                    }
                    .font(.reading(side * 0.05, weight: .medium))
                }
            }
        }
        .frame(width: side, height: side)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(r.accessibility)
    }

    // MARK: Up next

    private func upNext(_ u: UpNextSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Up next")
                .font(.system(size: 11, weight: .semibold))
                .textCase(.uppercase)
                .tracking(0.5)
                .foregroundStyle(Theme.ink3)
                .padding(.bottom, 6)
            ForEach(u.turnovers.prefix(5)) { t in
                WidgetLink(link: AppLink(screen: .ladder, time: t.time + 0.001)) {
                    HStack(spacing: 8) {
                        LevelChip(level: t.level, size: 11)
                            .widgetAccentable()
                        VStack(alignment: .leading, spacing: 0) {
                            Text(t.begins ?? "the catalogue ends")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.ink)
                            Text(t.when)
                                .font(.system(size: 11))
                                .foregroundStyle(Theme.ink3)
                        }
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .layoutPriority(1)
                        Spacer(minLength: 4)
                        Group {
                            if let text = t.countdown {
                                Text(text).font(.reading(13))
                            } else {
                                LiveCountdown(end: t.time, size: 13, weight: .regular, color: Theme.ink2)
                            }
                        }
                        .foregroundStyle(Theme.ink2)
                        .fixedSize()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                if t.id != u.turnovers.prefix(5).last?.id {
                    Spacer(minLength: 2)
                }
            }
        }
    }
}
