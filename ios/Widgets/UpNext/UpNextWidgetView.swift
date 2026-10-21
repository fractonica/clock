import FractonicaKit
import SwiftUI
import WidgetKit

/// Up next (src/ui/upnext.js): the next turnover of each unit from the Helion up, the nearest as a hero with its
/// countdown and the ending cycle's progress, the farther ones as rows. Earth countdowns under a day run live;
/// pure ones count the Preons still to start.
struct UpNextWidgetView: View {
    enum Size: Sendable { case small, medium, large }

    var snapshot: UpNextSnapshot?
    var size: Size

    var body: some View {
        if let s = snapshot, let first = s.turnovers.first {
            switch size {
            case .small:
                hero(first, countdownSize: 30)
            case .medium:
                HStack(spacing: 14) {
                    hero(first, countdownSize: 28)
                        .frame(maxWidth: .infinity)
                    Rectangle().fill(Theme.line).frame(width: 1)
                    rows(Array(s.turnovers.dropFirst().prefix(3)), compact: true)
                        .frame(maxWidth: .infinity)
                }
            case .large:
                VStack(alignment: .leading, spacing: 12) {
                    hero(first, countdownSize: 40)
                    Rectangle().fill(Theme.line).frame(height: 1)
                    rows(Array(s.turnovers.dropFirst().prefix(5)), compact: false)
                    Spacer(minLength: 0)
                }
            }
        } else {
            OutOfRangeView(compact: size == .small)
        }
    }

    // MARK: The nearest turnover

    private func hero(_ t: Turnover, countdownSize: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center) {
                LevelChip(level: t.level, size: size == .large ? 14 : 12)
                    .widgetAccentable()
                Spacer(minLength: 4)
                Text("Up next")
                    .font(.system(size: 11, weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(0.5)
                    .foregroundStyle(Theme.ink3)
            }
            if size == .large {
                Color.clear.frame(height: 10)
            } else {
                Spacer(minLength: 6)
            }
            Text(t.title)
                .font(.system(size: size == .large ? 20 : 15, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if t.countdown != nil {
                    Text("in").font(.system(size: countdownSize * 0.45, weight: .medium)).foregroundStyle(Theme.ink3)
                }
                countdown(t, size: countdownSize, color: Theme.ink)
            }
            .padding(.top, 1)
            LiveBar(range: t.start...t.time, color: Theme.levelColor(t.level), thickness: size == .large ? 4 : 3)
                .padding(.vertical, size == .large ? 8 : 6)
            Text(t.when)
                .font(.system(size: 12))
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: The farther ones

    private func rows(_ list: [Turnover], compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: compact ? 0 : 4) {
            if list.isEmpty {
                // the closing cycles all end with the catalogue
                Text("Nothing else turns over before the catalogue ends.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.ink3)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(list) { t in
                // a row opens the ladder just after its turnover
                WidgetLink(link: AppLink(screen: .ladder, time: t.time + 0.001)) {
                    row(t, compact: compact)
                }
                if compact && t.id != list.last?.id { Spacer(minLength: 0) }
            }
        }
    }

    private func row(_ t: Turnover, compact: Bool) -> some View {
        HStack(spacing: 8) {
            LevelChip(level: t.level, size: 11)
                .widgetAccentable()
            VStack(alignment: .leading, spacing: 1) {
                Text(t.begins ?? "the catalogue ends")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                if compact {
                    // a narrow column: the countdown under the name
                    countdown(t, size: 12, color: Theme.ink2, weight: .regular)
                } else {
                    Text(t.when)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(1)
                }
            }
            .layoutPriority(1)
            if !compact {
                Spacer(minLength: 4)
                countdown(t, size: 15, color: Theme.ink2, weight: .regular)
                    .fixedSize()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, compact ? 0 : 5)
        .accessibilityElement(children: .combine)
    }

    /// Pure: the span still to come ("5η 12ι"); Earth: live under a day ("1:05:12"), a static span beyond ("3 d 04 h").
    @ViewBuilder
    private func countdown(_ t: Turnover, size: CGFloat, color: Color, weight: Font.Weight = .semibold) -> some View {
        if let text = t.countdown {
            Text(text)
                .font(.reading(size, weight: weight))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        } else {
            LiveCountdown(end: t.time, size: size, weight: weight, color: color)
                .minimumScaleFactor(0.6)
        }
    }
}
