import FractonicaKit
import SwiftUI

/// Rings: the concentric dial of every cycle, outermost the longest, with the countdown to the end of the selected cycle
/// in its centre and the selected cycle in detail beside or below it (src/ui/rings.js, docs/design/20-rings.md).
///
/// iPhone: the dial on top, a strip of the rings to choose from, then the cycle card, in one scrolling page.
/// iPad and Mac (and iPhone in landscape): the dial on the left, the card in a column of its own.
struct RingsScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = RingsScreenModel()

    var body: some View {
        GeometryReader { geo in
            if model.forcesWide || Self.isWide(geo.size) {
                wide(geo.size)
            } else {
                tall(geo.size)
            }
        }
        .navigationTitle(Screen.rings.title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Dial Options", systemImage: "slider.horizontal.3") {
                    model.showsOptions = true
                }
                .help("Depth range, layers and how to read the dial")
                .popover(isPresented: Bindable(model).showsOptions) {
                    RingsOptions(model: model)
                        .presentationCompactAdaptation(.popover)
                        // a reading surface: the vivid dial behind clear glass would muddy the help text
                        .presentationBackground(.regularMaterial)
                }
            }
        }
        .onAppear {
            model.readLaunchArguments()
            model.startPendingRate(store)
            model.isVisible = true
            #if os(iOS)
            if model.turnsLandscape {
                model.turnsLandscape = false
                let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
                scene?.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
            }
            #endif
        }
        .onDisappear { model.isVisible = false }
        .task { await model.openPendingOptions() }
    }

    /// Side by side when there is width to spare and the window is not tall.
    static func isWide(_ size: CGSize) -> Bool { RingsScreenLayout.isWide(size) }

    // MARK: Layouts

    private func tall(_ size: CGSize) -> some View {
        let dial = RingsScreenLayout.tallDial(size)
        return ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 18) {
                    dialColumn(size: dial, inVerticalScroll: true)
                    RingsCard(model: model)
                        .frame(maxWidth: 720)
                        .id("card")
                }
                .padding(.horizontal, 12)
                .padding(.top, 6)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity)
            }
            .scrollBounceBehavior(.basedOnSize)
            .onChange(of: model.scrollsToCard, initial: true) { _, down in
                guard down else { return }
                Task {
                    try? await Task.sleep(for: .milliseconds(500))
                    proxy.scrollTo("card", anchor: .bottom)
                }
            }
        }
    }

    private func wide(_ size: CGSize) -> some View {
        let layout = RingsScreenLayout.wide(size)
        return HStack(alignment: .center, spacing: layout.spacing) {
            Group {
                if layout.stripWithCard {
                    // a short window (iPhone in landscape): the dial takes the whole height, the strip goes with the card
                    RingsDial(size: layout.dial, model: model)
                } else {
                    dialColumn(size: layout.dial)
                }
            }
            .frame(maxWidth: .infinity)
            ScrollView {
                VStack(spacing: 14) {
                    if layout.stripWithCard {
                        RingsLevelStrip(model: model)
                    }
                    RingsCard(model: model)
                }
                .padding(.vertical, layout.stripWithCard ? 8 : 16)
                .frame(minHeight: size.height, alignment: .center)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollIndicators(.hidden)
            .frame(width: layout.card)
        }
        .padding(.horizontal, layout.stripWithCard ? 8 : 20)
    }

    private func dialColumn(size: CGFloat, inVerticalScroll: Bool = false) -> some View {
        VStack(spacing: 12) {
            RingsDial(size: size, model: model, inVerticalScroll: inVerticalScroll)
            RingsLevelStrip(model: model)
                .frame(maxWidth: size)
        }
    }
}

/// The rings by name, one capsule each: the sure way to choose a thin ring, and the selection shown in words.
/// A selection that is not on the dial offers to put it there.
struct RingsLevelStrip: View {
    let model: RingsScreenModel

    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let range = model.range(settings)
        let selected = model.selected(settings)
        VStack(spacing: 10) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(range.levels, id: \.self) { level in
                            capsule(level, selected: level == selected)
                                .id(level)
                        }
                    }
                    .padding(.horizontal, 4)
                    .frame(minWidth: 0)
                }
                .scrollIndicators(.hidden)
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
                .onChange(of: selected) { _, level in
                    withAnimation(reduceMotion ? nil : .smooth) { proxy.scrollTo(level, anchor: .center) }
                }
            }
            if !range.contains(selected) {
                Button {
                    model.setRange(range.widened(to: selected), settings: settings, reduceMotion: reduceMotion)
                    Haptics.play(.selection)
                } label: {
                    Label("\(RingsText.levelTag(selected)) is not on the dial · Show it", systemImage: "plus.circle")
                        .font(.footnote.weight(.medium))
                }
                .buttonStyle(.bordered)
                .tint(Theme.levelColor(selected, lightness: 0.7))
            }
        }
    }

    private func capsule(_ level: Int, selected: Bool) -> some View {
        let color = Theme.levelColor(level, lightness: 0.74)
        return Button {
            model.select(level, settings: settings, reduceMotion: reduceMotion)
            Haptics.play(.selection)
        } label: {
            HStack(spacing: 3) {
                Text(Fractonica.periodName(level).text)
                    .font(.subheadline.weight(.semibold))
                Text("\(level + 1)")
                    .font(.caption2.monospacedDigit())
                    .opacity(0.7)
            }
            .foregroundStyle(selected ? Theme.ink : color)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background {
                Capsule()
                    .fill(Theme.levelColor(level, opacity: selected ? 0.32 : 0.08))
                    .overlay { Capsule().strokeBorder(Theme.levelColor(level, opacity: selected ? 0.9 : 0.25), lineWidth: selected ? 1 : 0.75) }
            }
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Ring \(RingsText.levelTag(level))"))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
