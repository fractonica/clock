import FractonicaKit
import SwiftUI

/// Explains, before the system asks, why Alerts needs notifications: shown once the user has made their first alert
/// while the permission is undecided. "Continue" brings up the system's request; "Not Now" leaves the explanation card
/// at the top of the list for later. Shows what the new alert will say and the live rhythm it keeps.
struct PermissionPrimer: View {
    /// The rule that was just added, for the sample notification.
    let rule: AlertRule?
    let text: AlertText
    let allow: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var alerts = AlertStore.shared
    @State private var height: CGFloat = 520

    var body: some View {
        VStack(spacing: 22) {
            PrimerRings()
                .frame(width: 132, height: 132)
                .padding(.top, 8)
            VStack(spacing: 10) {
                Text("Let the clock reach you")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .multilineTextAlignment(.center)
                Text(explanation)
                    .font(.body)
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let sample {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    NotificationPreview(title: sample.title, message: sample.body,
                                        corner: text.words.countdown(sample.fire - alerts.now, at: alerts.now),
                                        silent: !sample.sound)
                }
            }
            VStack(spacing: 6) {
                Button {
                    Haptics.play(.success)
                    allow()
                    dismiss()
                } label: {
                    Text("Continue")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(Theme.background)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .keyboardShortcut(.defaultAction)
                Button("Not Now") { dismiss() }
                    .buttonStyle(.borderless)
                    .foregroundStyle(Theme.ink2)
                    .padding(.vertical, 8)
                    .keyboardShortcut(.cancelAction)
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 24)
        .padding(.bottom, 12)
        .frame(maxWidth: 460)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        .frame(maxWidth: .infinity)
        .background { Backdrop().ignoresSafeArea() }
        #if os(iOS)
        .presentationDetents([.height(height)])
        #else
        .frame(width: 440)
        #endif
        .presentationDragIndicator(.hidden)
    }

    private var explanation: String {
        #if os(iOS)
        "Your alerts arrive as notifications, on time even while Fractonica is closed. iOS asks you once; you can change it later in Settings."
        #else
        "Your alerts arrive as notifications, on time even while Fractonica is closed. macOS asks you once; you can change it later in System Settings."
        #endif
    }

    /// The new rule's next notification, as the system will show it.
    private var sample: (title: String, body: String, fire: Double, sound: Bool)? {
        guard let rule, let o = alerts.plan.next[rule.id] else { return nil }
        if let message = alerts.messages[o.identifier] {
            return (message.title, message.body, o.fire, message.sound)
        }
        return (text.title(rule, o), text.body(rule, o), o.fire, rule.sound)
    }
}

/// Three rings turning with the real clock — the Helion, its Preon and its Flavon — around a bell: the rhythm alerts
/// keep. Still (one redraw a second) with Reduce Motion.
private struct PrimerRings: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let levels = [6, 8, 10]

    var body: some View {
        ZStack {
            TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1 / 30)) { context in
                let t = context.date.timeIntervalSince1970
                let clock = FractonicaClock.shared
                let progress = Self.levels.map { clock.level(at: t, $0)?.progress }
                Canvas { gc, size in
                    let side = min(size.width, size.height)
                    let c = CGPoint(x: size.width / 2, y: size.height / 2)
                    for (i, level) in Self.levels.enumerated() {
                        let width: CGFloat = 4
                        let r = side / 2 - width / 2 - CGFloat(i) * 13
                        var track = Path()
                        track.addArc(center: c, radius: r, startAngle: .zero, endAngle: .degrees(360), clockwise: false)
                        gc.stroke(track, with: .color(Theme.levelColor(level, opacity: 0.16)), lineWidth: width)
                        guard let p = progress[i] else { continue }
                        var arc = Path()
                        arc.addArc(center: c, radius: r, startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * p),
                                   clockwise: false)
                        gc.stroke(arc, with: .color(Theme.levelColor(level)),
                                  style: StrokeStyle(lineWidth: width, lineCap: .round))
                    }
                }
            }
            Image(systemName: "bell.badge.fill")
                .font(.system(size: 34, weight: .medium))
                .symbolRenderingMode(.palette)
                .foregroundStyle(Theme.teal, Theme.ink)
                .symbolEffect(.wiggle, options: .repeat(.periodic(delay: 3)), isActive: !reduceMotion)
        }
        .accessibilityHidden(true)
    }
}
