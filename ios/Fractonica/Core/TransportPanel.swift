import FractonicaKit
import SwiftUI

/// Time travel in full, opened from the transport's moment: the displayed moment in both vocabularies (with Back to
/// live while travelling), a date picker (Earth mode; pure mode travels by steps and the Jump screen), stepping by
/// any cycle, and the time-lapse direction, speed and play / pause. A sheet on iOS, a popover on macOS.
struct TransportPanel: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let words = settings.wording
        NavigationStack {
            Form {
                Section {
                    ClockTimeline(.periodic(1)) { t in
                        MomentSummary(t: t, words: words)
                    }
                }
                if !words.pure {
                    Section("Go to") {
                        DatePicker("Moment", selection: momentBinding, in: catalogueDates, displayedComponents: [.date, .hourAndMinute])
                            .environment(\.timeZone, settings.timeZone)
                    }
                }
                Section("Step by cycle") {
                    Picker("Cycle", selection: Bindable(settings).selectedLevel) {
                        ForEach(AppSettings.levels, id: \.self) { level in
                            Text(words.levelLabel(level)).tag(level)
                        }
                    }
                    HStack {
                        Button("Previous", systemImage: "backward.end.fill") { step(-1) }
                        Spacer()
                        Button("Next", systemImage: "forward.end.fill") { step(1) }
                            .labelStyle(TrailingIconLabelStyle())
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .buttonRepeatBehavior(.enabled)
                }
                Section {
                    Picker("Direction", selection: Binding(get: { store.direction }, set: { store.setDirection($0) })) {
                        Text("Forward").tag(1)
                        Text("Backward").tag(-1)
                    }
                    .pickerStyle(.segmented)
                    Picker("Speed", selection: speedBinding(words)) {
                        ForEach(speedOptions(words), id: \.rate) { option in
                            Text(option.label).tag(option.rate)
                        }
                    }
                    Button {
                        if let edge = store.togglePlay() {
                            toasts.show(edge)
                            Haptics.play(.warning)
                        }
                    } label: {
                        Label(store.isPlaying ? "Pause" : "Play", systemImage: store.isPlaying ? "pause.fill" : "play.fill")
                    }
                } header: {
                    Text("Time-lapse")
                } footer: {
                    Text("Choosing a speed starts the time-lapse. It stops by itself at the ends of the catalogue.")
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Time travel")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
            #endif
        }
    }

    /// The displayed moment as a date for the picker; picking travels there and pauses (or keeps a running rate).
    private var momentBinding: Binding<Date> {
        Binding(
            get: { Date(timeIntervalSince1970: store.time()) },
            set: { store.travel(to: $0.timeIntervalSince1970) }
        )
    }

    private var catalogueDates: ClosedRange<Date> {
        Date(timeIntervalSince1970: store.catalogue.lowerBound)...Date(timeIntervalSince1970: store.catalogue.upperBound)
    }

    /// The presets in the chosen direction (real time only forwards), plus the chosen speed when it is none of them
    /// (a tempo lock may set any rate).
    private func speedOptions(_ words: Wording) -> [TimeLapse] {
        let sign = Double(store.direction)
        var options = words.rates
            .filter { sign > 0 || $0.rate != 1 }
            .map { TimeLapse(id: $0.id, rate: sign * $0.rate, label: $0.label) }
        if !options.contains(where: { TransportSpeed.matches(store.chosenRate, $0.rate) }) {
            options.insert(TimeLapse(id: "custom", rate: store.chosenRate, label: words.rateLabel(store.chosenRate)), at: 0)
        }
        return options
    }

    private func speedBinding(_ words: Wording) -> Binding<Double> {
        Binding(
            get: { speedOptions(words).first { TransportSpeed.matches(store.chosenRate, $0.rate) }?.rate ?? store.chosenRate },
            set: { rate in
                store.selectSpeed(rate)
                Haptics.play(.selection)
            }
        )
    }

    private func step(_ direction: Int) {
        if let edge = store.step(level: settings.selectedLevel, direction: direction) {
            toasts.show(edge)
            Haptics.play(.warning)
        } else {
            Haptics.play(.step)
        }
    }
}

/// The moment the app shows, large, with its other reading underneath: the Earth time with the pure stamp, or the
/// pure clock with its Helion pair.
private struct MomentSummary: View {
    let t: Double
    let words: Wording

    @Environment(ClockStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(status)
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(store.isLive ? Theme.live : Theme.cursor)
                Spacer()
                if !store.isLive { LiveButton() }
            }
            HStack(alignment: .center, spacing: 14) {
                Text(words.time(t))
                    .font(.reading(34, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                if words.pure, let helion = store.clock.level(at: t, 6) {
                    PairView(fraction: helion.phase, color: Theme.teal, height: 34)
                }
            }
            Text(words.pure ? words.day(t) : [words.day(t), words.tag(t)].joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
            Text(words.notation.stamp(at: t, upTo: words.pure ? "nu" : "iota"))
                .font(.code(12))
                .foregroundStyle(Theme.ink3)
                .textSelection(.enabled)
        }
        .padding(.vertical, 4)
    }

    private var status: String {
        if store.isLive { return "Live" }
        if store.isPlaying { return "Time-lapse · \(words.rateLabel(store.rate))" }
        return "Paused"
    }
}

/// Title first, icon after: "Next ▶︎".
private struct TrailingIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 6) {
            configuration.title
            configuration.icon
        }
    }
}
