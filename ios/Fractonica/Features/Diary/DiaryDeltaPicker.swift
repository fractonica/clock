import FractonicaKit
import SwiftUI

/// Choosing the Delta of the diary: the fracton names of its Alpha, Beta, Gamma and Delta (src/ui/diary/picker.js),
/// or the Delta of the displayed moment, with when it runs.
struct DiaryDeltaPicker: View {
    let model: DiaryModel

    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    private static let levelNames = ["Alpha", "Beta", "Gamma", "Delta"]

    var body: some View {
        let path = model.path
        NavigationStack {
            Form {
                Section {
                    Toggle(isOn: Binding(get: { model.follow }, set: { model.setFollow($0, time: store.time()) })) {
                        Label("Delta of the shown moment", systemImage: "scope")
                    }
                    .tint(Theme.teal)
                } footer: {
                    Text(followNote)
                }

                Section("Delta") {
                    ForEach(0..<4, id: \.self) { level in
                        Picker(selection: Binding(get: { path[level] }, set: { pick(level: level, ordinal: $0) })) {
                            ForEach(DiaryDelta.choices(level: level, path: path, range: model.range), id: \.ordinal) { choice in
                                Text(DiaryDelta.name(level: level, ordinal: choice.ordinal))
                                    .tag(choice.ordinal)
                                    .selectionDisabled(!choice.ok)
                            }
                        } label: {
                            HStack(spacing: 10) {
                                Text(DiaryDelta.letters[level])
                                    .font(.code(15, weight: .semibold))
                                    .foregroundStyle(Theme.levelColor(level))
                                    .frame(width: 18)
                                Text(Self.levelNames[level])
                            }
                        }
                        .pickerStyle(.menu)
                    }
                    HStack {
                        Button("Previous", systemImage: "chevron.left") { model.choose(delta: model.delta - 1) }
                            .disabled(model.delta <= model.range.lowerBound)
                        Spacer()
                        Button("Next", systemImage: "chevron.right") { model.choose(delta: model.delta + 1) }
                            .labelStyle(TrailingIcon())
                            .disabled(model.delta >= model.range.upperBound)
                    }
                    .buttonStyle(.borderless)
                }

                Section {
                    LabeledContent("Stamp") {
                        Text(DiaryDelta.stamp(path)).font(.code(14)).foregroundStyle(Theme.teal)
                    }
                    if let span = model.span {
                        LabeledContent("Begins") { Text(moment(span.t0)).multilineTextAlignment(.trailing) }
                        LabeledContent("Ends") { Text(moment(span.t1)).multilineTextAlignment(.trailing) }
                    }
                    LabeledContent("Holds", value: "5 Nuclides · 385 Helions")
                } header: {
                    Text(DiaryDelta.name(level: 3, ordinal: path[3]))
                } footer: {
                    Text((0..<3).map { DiaryDelta.name(level: $0, ordinal: path[$0]) }.joined(separator: " · "))
                }
            }
            .formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background { Backdrop() }
            .navigationTitle("Delta")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 460)
        #endif
    }

    private func pick(level: Int, ordinal: Int) {
        var p = model.path
        p[level] = ordinal
        model.choose(path: p)
        Haptics.play(.selection)
    }

    /// A moment in full: "Tue 28 Jul 2026, 07:39" · pure "α#6 β#4 γ#9 δ#3 ε#1 1η 0ι".
    private func moment(_ t: Double) -> String {
        let words = settings.wording
        return words.pure ? words.notation.stamp(at: min(t + 1e-3, store.clock.tMax), upTo: "iota") : words.earth.long(t, seconds: false)
    }

    private var followNote: String {
        let t = store.time()
        if !store.clock.inRange(t) { return "The shown moment is outside the catalogue: the nearest Delta is shown." }
        return model.follow ? "The diary changes with the displayed time." : "The diary stays on the Delta chosen here."
    }
}

/// A label with its icon after the title ("Next ›").
private struct TrailingIcon: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.title
            configuration.icon
        }
    }
}
