import FractonicaKit
import SwiftUI

/// The depth bar floating at the foot of the stage: the catalogue (∿) and one chip per depth α … ξ, each with its
/// letter, its depth and where its level is in its current half-arc (crest + / trough −), flanked by the previous /
/// next half-arc buttons. Choosing a depth selects it everywhere (the shared selection).
struct WaveDepthBar: View {
    let model: WaveModel
    let control: WaveController

    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        GlassEffectContainer {
            HStack(spacing: 2) {
                stepButton(-1)
                ScrollViewReader { proxy in
                    ScrollView(.horizontal) {
                        ClockTimeline(.periodic(0.2)) { t in
                            let states = WaveChipState.all(t: control.shown(t), engine: control.engine)
                            HStack(spacing: 3) {
                                chip(nil, state: nil, enabled: states != nil)
                                Rectangle().fill(Theme.line2).frame(width: 1, height: 26).padding(.horizontal, 2)
                                ForEach(0...Fractonica.maxLevel, id: \.self) { l in
                                    chip(l, state: states?[l], enabled: states != nil)
                                }
                            }
                            .padding(.horizontal, 4)
                        }
                    }
                    .scrollIndicators(.hidden)
                    .mask {
                        HStack(spacing: 0) {
                            LinearGradient(colors: [.clear, .black], startPoint: .leading, endPoint: .trailing).frame(width: 14)
                            Rectangle()
                            LinearGradient(colors: [.black, .clear], startPoint: .leading, endPoint: .trailing).frame(width: 14)
                        }
                    }
                    .onAppear { scroll(proxy, animated: false) }
                    .onChange(of: selection) { scroll(proxy, animated: true) }
                }
                stepButton(1)
            }
            .padding(4)
            .glassEffect(.regular, in: .capsule)
        }
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
    }

    /// nil: the catalogue.
    private var selection: Int? { model.overview ? nil : control.level }

    private func scroll(_ proxy: ScrollViewProxy, animated: Bool) {
        let id = selection.map { "d\($0)" } ?? "all"
        if animated && !control.reduceMotion {
            withAnimation(.snappy) { proxy.scrollTo(id, anchor: .center) }
        } else {
            proxy.scrollTo(id, anchor: .center)
        }
    }

    private func stepButton(_ dir: Int) -> some View {
        Button { control.step(dir) } label: {
            Image(systemName: dir < 0 ? "chevron.left" : "chevron.right")
                .font(.body.weight(.semibold))
                .frame(width: 36, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink2)
        .accessibilityLabel(dir < 0 ? "Previous half-arc" : "Next half-arc")
        .help(dir < 0 ? "Previous half-arc (←)" : "Next half-arc (→)")
    }

    @ViewBuilder
    private func chip(_ level: Int?, state: WaveChipState?, enabled: Bool) -> some View {
        let selected = selection == level
        let tint = level.map { Theme.levelColor($0) } ?? Theme.ink
        let showsFast = level != nil && level == control.level && control.eff < control.level && !model.overview
        Button { control.select(level) } label: {
            VStack(spacing: 1) {
                ZStack(alignment: .topTrailing) {
                    Text(level.map { Fractonica.periodName($0).text } ?? "∿")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(enabled ? tint : Theme.ink3)
                        .frame(maxWidth: .infinity)
                    if let state {
                        Text(state.crest ? "+" : "−")
                            .font(.system(size: 8, weight: .bold).monospacedDigit())
                            .foregroundStyle(Theme.ink3.opacity(0.8))
                            .offset(x: 1, y: -2)
                    }
                }
                Text(level.map { "\($0 + 1)" } ?? "all")
                    .font(.system(size: 9, weight: .medium).monospacedDigit())
                    .foregroundStyle(selected ? Theme.ink : Theme.ink3)
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.line2)
                    Capsule().fill(level.map { Theme.levelColor($0, opacity: 0.95) } ?? Theme.ink2)
                        .frame(width: max(0, 18 * (state?.progress ?? (level == nil ? 0 : 0))))
                }
                .frame(width: 18, height: 2)
                .opacity(level == nil ? 0 : 1)
            }
            .frame(width: 34, height: 44)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(tint.opacity(0.16))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tint.opacity(0.55), lineWidth: 1))
                }
            }
            .overlay(alignment: .top) {
                if showsFast {
                    Circle().fill(Theme.now).frame(width: 5, height: 5).offset(y: 2)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .id(level.map { "d\($0)" } ?? "all")
        .disabled(!enabled)
        .accessibilityLabel(level.map { control.words.chipAccessibility($0) } ?? control.words.catalogueTitle())
        .accessibilityAddTraits(selected ? .isSelected : [])
        .help(level.map { control.words.chipTitle($0) } ?? control.words.catalogueTitle())
    }
}
