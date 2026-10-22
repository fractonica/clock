import FractonicaKit
import SwiftUI

/// The depth bar floating at the foot of the stage: the catalogue (∿) and one chip per depth α … ξ, each with its
/// letter, its depth and where its level is in its current half-arc (crest + / trough −), flanked by the previous /
/// next half-arc buttons. Choosing a depth selects it everywhere (the shared selection).
struct WaveDepthBar: View {
    let model: WaveModel
    let control: WaveController

    var body: some View {
        let rate = control.store.isLive ? 1 : abs(control.store.rate)
        let halves = (0...Fractonica.maxLevel).map { control.engine.clock.levelInfo($0).meanSeconds / 2 }
        let pace = WaveChipPace(halfSeconds: halves, rate: rate)
        GlassEffectContainer {
            HStack(spacing: 2) {
                stepButton(-1)
                ScrollViewReader { proxy in
                    ScrollView(.horizontal) {
                        ClockTimeline(.periodic(pace.interval)) { t in
                            let states = WaveChipState.all(t: control.shown(t), engine: control.engine)
                            HStack(spacing: 3) {
                                chip(nil, state: nil, enabled: states != nil)
                                Rectangle().fill(Theme.line2).frame(width: 1, height: 26).padding(.horizontal, 2)
                                ForEach(0...Fractonica.maxLevel, id: \.self) { l in
                                    chip(l, state: pace.followable(l) ? states?[l] : nil, enabled: states != nil)
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

    private func chip(_ level: Int?, state: WaveChipState?, enabled: Bool) -> some View {
        WaveDepthChip(
            level: level, state: state, enabled: enabled, selected: selection == level,
            fastSelected: level != nil && level == control.level && control.eff < control.level && !model.overview,
            shownInstead: level != nil && level == control.eff && control.eff < control.level && !model.overview,
            pure: control.words.pure, control: control
        )
        .equatable()
    }
}

/// One chip of the depth bar. Equatable on what it shows, so a refresh only redraws the chips whose bar moved.
private struct WaveDepthChip: View, Equatable {
    let level: Int?
    /// nil: no live state (the catalogue, outside the catalogue, or too fast to follow).
    let state: WaveChipState?
    let enabled: Bool
    let selected: Bool
    /// The selection, while a time-lapse is too fast for it (a red dot).
    let fastSelected: Bool
    /// The depth shown instead (a dashed frame).
    let shownInstead: Bool
    let pure: Bool
    let control: WaveController

    nonisolated static func == (a: Self, b: Self) -> Bool {
        a.level == b.level && a.state == b.state && a.enabled == b.enabled && a.selected == b.selected
            && a.fastSelected == b.fastSelected && a.shownInstead == b.shownInstead && a.pure == b.pure
    }

    var body: some View {
        let tint = level.map { Theme.levelColor($0) } ?? Theme.ink
        Button { control.select(level) } label: {
            VStack(spacing: 1) {
                ZStack(alignment: .topTrailing) {
                    Text(level.map { Fractonica.periodName($0).text } ?? "∿")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(enabled ? tint : Theme.ink3)
                        .frame(maxWidth: .infinity)
                    if let state {
                        Text(state.crest ? "+" : "−")
                            .font(.system(size: 9, weight: .bold).monospacedDigit())
                            .foregroundStyle(Theme.ink3.opacity(0.8))
                            .offset(x: 1, y: -2)
                    }
                }
                Text(level.map { "\($0 + 1)" } ?? "all")
                    .font(.system(size: 10, weight: .medium).monospacedDigit())
                    .foregroundStyle(selected ? Theme.ink : Theme.ink3)
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.line2)
                    if let level {
                        // a level too fast to follow shows a still, faint bar
                        Capsule().fill(Theme.levelColor(level, opacity: state == nil ? 0.3 : 0.95))
                            .frame(width: state.map { max(0, 18 * $0.progress) } ?? (enabled ? 18 : 0))
                    }
                }
                .frame(width: 18, height: 2)
                .opacity(level == nil ? 0 : 1)
            }
            .frame(width: 34, height: 44)
            .background {
                // the depth actually shown while a time-lapse is too fast for the selection
                if shownInstead {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(tint.opacity(0.6), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                }
                if selected {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(tint.opacity(0.16))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(tint.opacity(0.55), lineWidth: 1))
                }
            }
            .overlay(alignment: .top) {
                if fastSelected {
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
        .accessibilityValue(Text(selected ? liveValue : ""))
        .help(level.map { control.words.chipTitle($0) } ?? control.words.catalogueTitle())
    }

    /// The selected chip also says where its level is now (a screen reader cannot see the bar under it).
    private var liveValue: String {
        guard let level, let state else { return "" }
        return control.words.chipLive(control.engine.describe(level, state.idx), local: state.local)
    }
}
