import FractonicaKit
import SwiftUI

/// The dial's options, in a popover from the toolbar: which depths the rings show, which layers they draw, and how to
/// read them.
struct RingsOptions: View {
    let model: RingsScreenModel

    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable private var prefs = RingsPreferences.shared

    var body: some View {
        let range = model.range(settings)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Depth range")
                        .font(.headline)
                    DepthStrip(range: range) { set($0) }
                    Stepper {
                        rangeLabel("Outermost ring", level: range.minLevel)
                    } onIncrement: {
                        set(range.stepped(outer: true, by: 1))
                    } onDecrement: {
                        set(range.stepped(outer: true, by: -1))
                    }
                    Stepper {
                        rangeLabel("Innermost ring", level: range.maxLevel)
                    } onIncrement: {
                        set(range.stepped(outer: false, by: 1))
                    } onDecrement: {
                        set(range.stepped(outer: false, by: -1))
                    }
                }
                Divider()
                VStack(alignment: .leading, spacing: 12) {
                    Text("Layers")
                        .font(.headline)
                    Toggle(isOn: $prefs.sectors) {
                        option("Sectors", "Every ring cut into its child cycles, the running one tinted")
                    }
                    Toggle(isOn: $prefs.quarters) {
                        option("Quarters", "Begin, peak, node and valley marks")
                    }
                    Toggle(isOn: $prefs.funnels) {
                        option("Funnels", "How a running sector opens into the next ring")
                    }
                }
                Divider()
                DisclosureGroup(isExpanded: Bindable(model).showsHelp) {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(RingsHelp.items(pure: settings.pure)) { item in
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.title)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Theme.ink)
                                Text(item.body)
                                    .font(.footnote)
                                    .foregroundStyle(Theme.ink2)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(.top, 10)
                } label: {
                    Label("How to read", systemImage: "questionmark.circle")
                        .font(.headline)
                }
                .tint(Theme.ink)
            }
            .padding(20)
        }
        .frame(idealWidth: 360, maxWidth: 400, idealHeight: model.showsHelp ? 620 : 470)
        .scrollBounceBehavior(.basedOnSize)
    }

    private func set(_ range: DepthRange) {
        guard range != model.range(settings) else { return }
        model.setRange(range, settings: settings, reduceMotion: reduceMotion)
        Haptics.play(.selection)
    }

    private func rangeLabel(_ title: String, level: Int) -> some View {
        HStack {
            Text(title)
            Spacer()
            Text(RingsText.levelTag(level))
                .font(.body.monospacedDigit().weight(.semibold))
                .foregroundStyle(Theme.levelColor(level, lightness: 0.74))
        }
    }

    private func option(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
            Text(detail)
                .font(.caption)
                .foregroundStyle(Theme.ink3)
        }
    }
}

/// The fourteen depths as a strip of their colours, the shown range lit; tapping a depth moves the nearer end there.
private struct DepthStrip: View {
    let range: DepthRange
    let set: (DepthRange) -> Void

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0...DepthRange.deepest, id: \.self) { level in
                let inside = range.contains(level)
                Button {
                    set(target(for: level))
                } label: {
                    VStack(spacing: 4) {
                        Text(Fractonica.periodName(level).text)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(inside ? Theme.levelColor(level, lightness: 0.76) : Theme.ink3)
                        Capsule()
                            .fill(Theme.levelColor(level, opacity: inside ? 0.9 : 0.16))
                            .frame(height: 8)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("\(RingsText.levelTag(level))\(inside ? ", shown" : "")"))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Depths shown, \(RingsText.levelTag(range.minLevel)) to \(RingsText.levelTag(range.maxLevel))"))
    }

    private func target(for level: Int) -> DepthRange {
        if level < range.minLevel { return DepthRange(minLevel: level, maxLevel: range.maxLevel) }
        if level > range.maxLevel { return DepthRange(minLevel: range.minLevel, maxLevel: level) }
        return level - range.minLevel <= range.maxLevel - level
            ? DepthRange(minLevel: level, maxLevel: range.maxLevel)
            : DepthRange(minLevel: range.minLevel, maxLevel: level)
    }
}
