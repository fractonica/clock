import FractonicaKit
import SwiftUI

// The small parts of the Alerts screens: the subject badge, the rhythm ring, the notification preview, the
// permission card and the rows.

extension AlertSubject {
    /// Each subject's colour: the level's hue, gold for the Sun's sync and its eclipses.
    var color: Color {
        switch self {
        case .level(let level): Theme.levelColor(level)
        case .solar, .eclipse: Theme.gold
        }
    }
}

/// A rounded tile naming a subject: the period letter in its level's colour, the Sun for the sync, an eclipsed disc
/// for eclipses.
struct SubjectBadge: View {
    let subject: AlertSubject
    var size: CGFloat = 36
    var dimmed = false

    var body: some View {
        let color = subject.color
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(color.opacity(dimmed ? 0.06 : 0.14))
            .strokeBorder(color.opacity(dimmed ? 0.15 : 0.32), lineWidth: 1)
            .overlay { symbol(color.opacity(dimmed ? 0.45 : 1)) }
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private func symbol(_ color: Color) -> some View {
        switch subject {
        case .level(let level):
            Text(Fractonica.periodName(level).text)
                .font(.system(size: size * 0.5, weight: .medium))
                .foregroundStyle(color)
        case .solar:
            Image(systemName: "sun.max.fill")
                .font(.system(size: size * 0.44, weight: .medium))
                .foregroundStyle(color)
        case .eclipse:
            EclipseMark(color: color)
                .frame(width: size * 0.5, height: size * 0.5)
        }
    }
}

/// A greatest eclipse: the Moon's disc over the Sun, with the corona around it.
struct EclipseMark: View {
    let color: Color

    var body: some View {
        Canvas { context, size in
            let r = min(size.width, size.height) / 2
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let sun = Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
            context.fill(sun, with: .color(color))
            let m = r * 0.86
            let moon = Path(ellipseIn: CGRect(x: c.x - m + r * 0.1, y: c.y - m - r * 0.04, width: 2 * m, height: 2 * m))
            context.blendMode = .destinationOut
            context.fill(moon, with: .color(.black))
        }
    }
}

/// The rhythm an alert is waiting on: the running cycle of its level (or the solar sync) at the real now, with the
/// quarter thresholds ticked and the moments the rule listens to marked. Drawn in a Canvas; redrawn by the caller.
struct RhythmRing: View {
    /// 0 ..< 1 through the running cycle; nil draws the bare ring.
    let progress: Double?
    let color: Color
    /// Which of begin (top), peak, node, valley (clockwise) to mark.
    var events: Set<AlertEvent> = []
    var lineWidth: CGFloat = 4

    var body: some View {
        Canvas { context, size in
            let side = min(size.width, size.height)
            let r = side / 2 - lineWidth
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            var track = Path()
            track.addArc(center: c, radius: r, startAngle: .zero, endAngle: .degrees(360), clockwise: false)
            context.stroke(track, with: .color(Theme.line2), lineWidth: lineWidth)
            if let progress {
                var arc = Path()
                arc.addArc(center: c, radius: r, startAngle: .degrees(-90),
                           endAngle: .degrees(-90 + 360 * min(1, max(0, progress))), clockwise: false)
                context.stroke(arc, with: .color(color), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
            }
            for q in 0..<4 {
                let a = Angle.degrees(-90 + Double(q) * 90).radians
                let marked = events.contains(AlertEvent.allCases[q]) || (q == 0 && events.contains(.end))
                let inner = r - lineWidth * (marked ? 2.2 : 1.4)
                let outer = r + lineWidth * (marked ? 1.2 : 0.5)
                var tick = Path()
                tick.move(to: CGPoint(x: c.x + inner * cos(a), y: c.y + inner * sin(a)))
                tick.addLine(to: CGPoint(x: c.x + outer * cos(a), y: c.y + outer * sin(a)))
                context.stroke(tick, with: .color(marked ? Theme.ink : Theme.ink3),
                               style: StrokeStyle(lineWidth: marked ? 2 : 1, lineCap: .round))
            }
        }
        .accessibilityHidden(true)
    }
}

/// A notification as it will appear on the Lock Screen: what the editor previews and the hero shows.
struct NotificationPreview: View {
    let title: String
    let message: String
    /// "now", "in 56 min" — the right-hand corner.
    let corner: String
    var silent = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(Theme.panel3)
                .overlay {
                    Image(systemName: "bell.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Theme.teal)
                }
                .frame(width: 38, height: 38)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                    Spacer(minLength: 8)
                    if silent {
                        Image(systemName: "bell.slash.fill")
                            .font(.caption2)
                            .foregroundStyle(Theme.ink3)
                            .accessibilityLabel("Silent")
                    }
                    Text(corner)
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(1)
                }
                if !message.isEmpty {
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(4)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Notification preview: \(title). \(message)")
    }
}

/// Explains why Alerts needs permission and asks for it at the user's request; when it was refused, says where to
/// turn it on.
struct AuthorizationCard: View {
    let state: AlertStore.Authorization
    let request: () -> Void

    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: state == .denied ? "bell.slash" : "bell.badge")
                    .font(.title2)
                    .foregroundStyle(state == .denied ? Theme.ink3 : Theme.teal)
                    .symbolRenderingMode(.hierarchical)
                    .frame(width: 32)
                Text(headline)
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
            }
            Text(explanation)
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            if state == .denied {
                Button("Open Settings", systemImage: "gearshape") { openSettings() }
                    .buttonStyle(.glass)
            } else {
                Button { request() } label: {
                    Label("Allow Notifications", systemImage: "bell.fill")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.background)
                }
                .buttonStyle(.glassProminent)
            }
        }
        .padding(.vertical, 6)
    }

    private var headline: String {
        switch state {
        case .denied: "Notifications are off"
        case .provisional: "Alerts arrive quietly"
        default: "Hear the clock turn over"
        }
    }

    private var explanation: String {
        switch state {
        case .denied:
            "Fractonica can't tell you when your cycles turn. Allow notifications for Fractonica in Settings, then come back."
        case .provisional:
            "They go straight to the notification list. Allow alerts to see banners and hear a sound."
        default:
            "Alerts tell you when the moments you choose arrive — a new Helion, a Delta's node, the next eclipse — even while Fractonica is closed. You'll be asked once."
        }
    }

    private func openSettings() {
        #if os(iOS)
        if let url = URL(string: UIApplication.openNotificationSettingsURLString) { openURL(url) }
        #else
        let id = Bundle.main.bundleIdentifier ?? "app.fractonica.clock"
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=\(id)") {
            openURL(url)
        }
        #endif
    }
}

/// A rule in the list: its badge, name, what it listens for, when it next fires (live), and its switch.
struct RuleRow: View {
    let rule: AlertRule
    let next: AlertOccurrence?
    let text: AlertText
    let now: () -> Double
    var outOfRange = false
    let isEnabled: Binding<Bool>

    var body: some View {
        HStack(spacing: 12) {
            SubjectBadge(subject: rule.subject, dimmed: !rule.enabled)
            VStack(alignment: .leading, spacing: 3) {
                Text(rule.name)
                    .font(.body.weight(.medium))
                    .foregroundStyle(rule.enabled ? Theme.ink : Theme.ink3)
                    .lineLimit(2)
                Text(text.summary(rule, at: now()))
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(2)
                nextLine
            }
            Spacer(minLength: 4)
            Toggle(rule.name, isOn: isEnabled)
                .labelsHidden()
                .accessibilityLabel(Text("\(rule.name) on"))
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
    }

    @ViewBuilder
    private var nextLine: some View {
        if !rule.enabled {
            Text("Off")
                .font(.caption)
                .foregroundStyle(Theme.ink3)
        } else if !rule.filtersCanMeet() {
            Label("These filters never meet", systemImage: "exclamationmark.triangle")
                .font(.caption)
                .foregroundStyle(Theme.danger)
        } else if let next {
            TimelineView(.periodic(from: .now, by: 1)) { _ in
                let t = now()
                Text("next \(text.words.countdown(next.fire - t, at: t))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(rule.subject.color.opacity(0.9))
            }
        } else {
            Text(outOfRange ? "Outside the catalogue" : "Nothing more in the catalogue")
                .font(.caption)
                .foregroundStyle(Theme.ink3)
        }
    }
}

/// A scheduled notification: its moment, what it will say and how far off it is.
struct UpcomingRow: View {
    let alert: PlannedAlert
    let message: AlertMessage?
    let ruleName: String?
    let text: AlertText
    let now: () -> Double
    var held = true

    var body: some View {
        let o = alert.occurrence
        HStack(alignment: .top, spacing: 12) {
            Capsule()
                .fill(o.subject.color.opacity(held ? 1 : 0.4))
                .frame(width: 3)
                .padding(.vertical, 2)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(message?.title ?? "")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(held ? Theme.ink : Theme.ink3)
                        .lineLimit(2)
                    Spacer(minLength: 6)
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        let t = now()
                        Text(text.words.countdown(alert.fire - t, at: t))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Theme.ink2)
                            .lineLimit(1)
                    }
                }
                HStack(spacing: 6) {
                    Text(text.words.time(alert.fire + 0.002))
                        .font(.reading(13))
                        .foregroundStyle(o.subject.color.opacity(held ? 0.95 : 0.5))
                    if let ruleName {
                        Text(ruleName)
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                    }
                    if alert.silenced || message?.sound == false {
                        Image(systemName: alert.silenced ? "moon.fill" : "speaker.slash.fill")
                            .font(.caption2)
                            .foregroundStyle(Theme.ink3)
                            .accessibilityLabel(alert.silenced ? "Quiet hours: silent" : "No sound")
                    }
                    if !alert.also.isEmpty {
                        Text("+\(alert.also.count)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Theme.ink2)
                            .padding(.horizontal, 5)
                            .background(Theme.panel3, in: .capsule)
                            .accessibilityLabel("and \(alert.also.count) more at the same moment")
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
