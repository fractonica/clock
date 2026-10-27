import FractonicaKit
import SwiftUI

/// The epicycle face's editor: the ladder (the base and the top period), each arm's length, whether it is on and which
/// way it turns, how the angles are measured, the tips' paths, and a reset. Every change shows on the face at once:
/// the Now screen presents it as an inspector (on iPhone a sheet a little under half the height, over which most of the
/// face stays in sight and keeps moving; a column beside the face on iPad and the Mac). Its title and Done button are
/// its own header, the same in a sheet and in a column.
struct EpicycleEditor: View {
    @Environment(AppSettings.self) private var settings

    /// The iPhone sheet's lower height: the dial's hub and most of the figure stay above it.
    static let sheetHeight = PresentationDetent.fraction(0.42)

    var body: some View {
        let store = EpicycleSettings.shared
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Epicycles")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Spacer()
                Button("Done") { store.editing = false }
                    .fontWeight(.semibold)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 4)
            form(store: store)
        }
        .background { Backdrop() }
        #if os(iOS)
        .sheetDetents([Self.sheetHeight, .large])
        .presentationBackgroundInteraction(.enabled(upThrough: Self.sheetHeight))
        #endif
        .inspectorColumnWidth(min: 300, ideal: 350, max: 440)
    }

    private func form(store: EpicycleSettings) -> some View {
        let config = store.config
        let words = settings.wording
        let figure = EpicycleFigure(config)
        return Form {
            Section {
                Picker("Base", selection: Binding(get: { config.base }, set: { store.setBase($0) })) {
                    ForEach(EpicycleConfig.bases, id: \.self) { level in
                        Text(verbatim: words.levelLabel(level)).tag(level)
                    }
                }
                Picker("Top", selection: Binding(get: { config.top }, set: { store.setTop($0) })) {
                    ForEach(EpicycleConfig.tops(base: config.base), id: \.self) { level in
                        Text(verbatim: words.levelLabel(level)).tag(level)
                    }
                }
            } header: {
                Text("Ladder")
            } footer: {
                Text(verbatim: "The base arm turns once a \(EpicycleWords.name(config.base)) and the figure closes with it. "
                    + "Each period below turns on the tip of the one before, as fast as its period makes it: at most \(EpicycleConfig.maxArms) arms.")
            }
            Section("Arms") {
                ForEach(figure.arms, id: \.level) { arm in
                    EpicycleArmRow(arm: arm, config: config, words: words)
                }
            }
            Section {
                Picker("Angles", selection: Binding(get: { config.frame }, set: { store.setFrame($0) })) {
                    Text("From the Top").tag(EpicycleFrame.dial)
                    Text("From the Carrier").tag(EpicycleFrame.carrier)
                }
                Toggle("Paths of Every Tip", isOn: Binding(get: { config.tips }, set: { store.setTips($0) }))
            } footer: {
                Text(verbatim: config.frame == .dial
                    ? "From the top: every arm is a hand of its own period, up as its cycle begins, right at its peak, down at its node, left at its valley."
                    : "From the carrier: an arm continues the arm that carries it as its cycle begins, so each of the base's children draws one lobe.")
            }
            Section {
                Button("Reset to Default", role: .destructive) {
                    withAnimation(.easeInOut(duration: 0.2)) { store.reset() }
                }
                .disabled(store.isStandard)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
    }
}

/// One arm: its letter in its colour, its name and how often it turns in the base cycle, which way it turns, whether
/// it is on, and its length.
private struct EpicycleArmRow: View {
    let arm: EpicycleArm
    let config: EpicycleConfig
    let words: Wording

    var body: some View {
        let store = EpicycleSettings.shared
        let level = arm.level
        let on = config.isOn(level)
        let reversed = config.reversed.contains(level)
        let color = on ? Theme.Epicycles.arm(level) : Theme.ink3
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Text(verbatim: Fractonica.periodName(level).text)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(color)
                    .frame(minWidth: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: words.levelLabel(level))
                        .foregroundStyle(on ? Theme.ink : Theme.ink3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    Text(verbatim: EpicycleWords.turns(level: level, cycles: arm.cycles, base: config.base))
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                Button {
                    store.setReversed(!reversed, level: level)
                } label: {
                    Image(systemName: reversed ? "arrow.counterclockwise" : "arrow.clockwise")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(on ? color : Theme.ink3)
                        .frame(width: 32, height: 28)
                        .contentShape(.rect)
                }
                .buttonStyle(.borderless)
                .disabled(!on)
                .accessibilityLabel(Text(reversed ? "Turns anticlockwise" : "Turns clockwise"))
                .accessibilityHint(Text("Changes which way the \(Fractonica.periodName(level).text) arm turns"))
                .help(reversed ? "Turns anticlockwise" : "Turns clockwise")
                Toggle("\(Fractonica.periodName(level).text) arm", isOn: Binding(get: { on }, set: { store.setOn($0, level: level) }))
                    .labelsHidden()
                    .disabled(on && config.onLevels.count == 1)
            }
            Slider(value: Binding(get: { Self.slider(config.radius(level)) }, set: { store.setRadius(Self.length($0), level: level) }),
                   in: 0...1) {
                Text("Length of the \(Fractonica.periodName(level).text) arm")
            }
            .tint(Theme.levelColor(level))
            .disabled(!on)
            .accessibilityValue(Text(verbatim: String(format: "%.2f", config.radius(level))))
        }
        .padding(.vertical, 2)
    }

    /// The slider runs over the lengths on a log scale (0.01 … 1), so a fine arm's length is as easy to set as the base's.
    static func slider(_ r: Double) -> Double {
        let range = EpicycleConfig.radiusRange
        return log(max(r, range.lowerBound) / range.lowerBound) / log(range.upperBound / range.lowerBound)
    }

    static func length(_ s: Double) -> Double {
        let range = EpicycleConfig.radiusRange
        return range.lowerBound * pow(range.upperBound / range.lowerBound, min(max(s, 0), 1))
    }
}
