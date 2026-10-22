import FractonicaKit
import SwiftUI

/// Quiet hours: a nightly window in which alerts stay silent or are held back. Normal mode edits it as times of day;
/// pure mode, which cannot name a time of day, places it in the solar quarter (4η 27ι, a quarter of the solar sync,
/// in step with the civil day). The setting itself is always local minutes in the settings' zone.
struct QuietHoursSection: View {
    @Binding var quiet: QuietHours
    let words: Wording
    let zone: TimeZone
    /// The device's real now (Alerts never reads the travelled time).
    let now: Double

    var body: some View {
        Section {
            Toggle(isOn: $quiet.enabled.animation(.snappy)) {
                Label(title, systemImage: "moon")
            }
            if quiet.enabled {
                QuietBar(quiet: quiet, words: words, zone: zone, now: now)
                    .frame(height: 34)
                    .padding(.vertical, 4)
                if words.pure, let quarter = SolarQuarter(at: now) {
                    pureRow("From", \.start, quarter)
                    pureRow("To", \.end, quarter)
                } else {
                    earthRow("From", \.start)
                    earthRow("To", \.end)
                }
                Picker("During \(title.lowercased())", selection: $quiet.mode) {
                    Text("Deliver silently").tag(QuietHours.Mode.silence)
                    Text("Hold back").tag(QuietHours.Mode.skip)
                }
            }
        } header: {
            Text(title)
        } footer: {
            Text(footer)
        }
    }

    private var title: String { words.pure ? "Quiet time" : "Quiet hours" }

    private var footer: String {
        guard quiet.enabled else {
            return "Keep alerts from sounding while you sleep. Alerts can ring through it one by one."
        }
        let what = quiet.mode == .silence ? "Alerts arrive silently in the notification list" : "Alerts are held back"
        if words.pure {
            return "\(what) between these points of each solar quarter: 4η 27ι, a quarter of the solar sync, in step with the Sun."
        }
        return "\(what) between these times each day (\(words.tag(now)))."
    }

    // MARK: Normal mode: times of day

    private func earthRow(_ label: String, _ key: WritableKeyPath<QuietHours, Int>) -> some View {
        DatePicker(label, selection: dateBinding(key), displayedComponents: .hourAndMinute)
            .environment(\.timeZone, zone)
    }

    private func dateBinding(_ key: WritableKeyPath<QuietHours, Int>) -> Binding<Date> {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let midnight = calendar.startOfDay(for: Date(timeIntervalSince1970: now))
        return Binding(
            get: {
                let m = quiet[keyPath: key]
                return calendar.date(bySettingHour: m / 60, minute: m % 60, second: 0, of: midnight) ?? midnight
            },
            set: { date in
                let c = calendar.dateComponents([.hour, .minute], from: date)
                quiet[keyPath: key] = (c.hour ?? 0) * 60 + (c.minute ?? 0)
            }
        )
    }

    // MARK: Pure mode: points of the solar quarter

    /// Offsets every 4ι (one θ): 43 points across the quarter's 171ι.
    private static let steps = Array(stride(from: 0, to: SolarQuarter.preons, by: 4))

    private func pureRow(_ label: String, _ key: WritableKeyPath<QuietHours, Int>, _ quarter: SolarQuarter) -> some View {
        let binding = Binding<Int>(
            get: {
                let p = quarter.preons(ofMinute: quiet[keyPath: key], zone: zone)
                let step = Int((p / 4).rounded()) * 4
                return step >= SolarQuarter.preons ? 0 : step
            },
            set: { quiet[keyPath: key] = quarter.minute(atPreons: Double($0), zone: zone) }
        )
        return Picker(label, selection: binding) {
            ForEach(Self.steps, id: \.self) { p in
                Text(SolarQuarter.label(preons: p)).monospacedDigit().tag(p)
            }
        }
    }
}

/// The quiet window on one day (pure: one solar quarter): a slim track with the window shaded, ticks every 3 hours
/// (every Helion) and the real now.
private struct QuietBar: View {
    let quiet: QuietHours
    let words: Wording
    let zone: TimeZone
    let now: Double

    var body: some View {
        let layout = self.layout
        Canvas { context, size in
            let track = CGRect(x: 0, y: 6, width: size.width, height: 12)
            context.fill(Path(roundedRect: track, cornerRadius: 6), with: .color(Theme.panel3))
            for (a, b) in layout.spans {
                let r = CGRect(x: track.minX + a * track.width, y: track.minY, width: max(2, (b - a) * track.width),
                               height: track.height)
                context.fill(Path(roundedRect: r, cornerRadius: 6), with: .color(Theme.cursor.opacity(0.35)))
            }
            for tick in layout.ticks {
                let x = track.minX + tick.at * track.width
                var p = Path()
                p.move(to: CGPoint(x: x, y: track.maxY + 2))
                p.addLine(to: CGPoint(x: x, y: track.maxY + 5))
                context.stroke(p, with: .color(Theme.ink3), lineWidth: 1)
                context.draw(Text(tick.label).font(.system(size: 9).monospacedDigit()).foregroundStyle(Theme.ink3),
                             at: CGPoint(x: min(max(x, 8), size.width - 8), y: track.maxY + 11))
            }
            let x = track.minX + layout.now * track.width
            context.fill(Path(ellipseIn: CGRect(x: x - 4, y: track.midY - 4, width: 8, height: 8)), with: .color(Theme.teal))
        }
        .accessibilityElement()
        .accessibilityLabel(words.pure ? "Quiet time in the solar quarter" : "Quiet hours in the day")
    }

    private struct Layout {
        var spans: [(Double, Double)] = []
        var ticks: [(at: Double, label: String)] = []
        var now: Double = 0
    }

    private var layout: Layout {
        var out = Layout()
        let start: Double, end: Double
        if words.pure, let quarter = SolarQuarter(at: now) {
            let total = Double(SolarQuarter.preons)
            start = quarter.preons(ofMinute: quiet.start, zone: zone) / total
            end = quarter.preons(ofMinute: quiet.end, zone: zone) / total
            out.ticks = (0...4).map { (Double($0 * 36) / total, "\($0)η") }
            out.now = min(1, max(0, (now - quarter.start) / quarter.length))
        } else {
            let day = Double(QuietHours.minutesPerDay)
            start = Double(quiet.start) / day
            end = Double(quiet.end) / day
            out.ticks = stride(from: 0, through: 24, by: 6).map { (Double($0) / 24, String(format: "%02d", $0 % 24)) }
            let p = EarthTime.zonedParts(now, zone: zone)
            out.now = Double(p.hour * 60 + p.minute) / day
        }
        out.spans = start <= end ? [(start, end)] : [(start, 1), (0, end)]
        return out
    }
}
