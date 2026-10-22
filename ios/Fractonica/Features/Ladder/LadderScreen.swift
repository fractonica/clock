import FractonicaKit
import SwiftUI

/// Ladder: one row per depth with where the displayed time sits inside every cycle of the hierarchy at once, and Up
/// next, what turns over soon (src/ui/ladder.js, src/ui/upnext.js, docs/design/30-ladder.md).
///
/// Narrow widths stack the two in one list; wide ones (iPad, Mac) put Up next in a column beside the ladder. Tap a
/// row to select its depth (shared with the rings, the timeline and the transport's steps) and open its details; swipe
/// it for Just after / Just before / Start. On the Mac, ↑ ↓ move the selection, ↩ is Just after and ⇧↩ Just before.
struct LadderScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The row whose details are open.
    @State private var expanded: Int?
    @State private var started = false
    #if os(macOS)
    /// The ladder takes the keyboard when the screen appears, so ↑ ↓ ↩ work without a click first.
    @FocusState private var keyboardFocus: Bool
    #endif

    /// Up next gets a column of its own from this width on.
    private static let wideWidth: CGFloat = 700

    var body: some View {
        GeometryReader { geo in
            let wide = geo.size.width >= Self.wideWidth
            if wide {
                HStack(spacing: 0) {
                    ladder(includingUpNext: false)
                    Rectangle().fill(Theme.line).frame(width: 1).ignoresSafeArea(edges: .bottom)
                    UpNextColumn()
                        .frame(width: min(440, max(360, geo.size.width * 0.38)))
                }
            } else {
                ladder(includingUpNext: true)
            }
        }
        .navigationTitle(Screen.ladder.title)
        .onAppear(perform: start)
        .onChange(of: settings.selectedLevel) { _, level in
            // the selection moved elsewhere (the rings, the keyboard): open details follow it
            if expanded != nil, expanded != level { setExpanded(level) }
        }
        .sensoryFeedback(.selection, trigger: settings.selectedLevel) { _, _ in settings.haptics }
    }

    private var levels: [Int] { Array((settings.minDepth - 1)...(settings.maxDepth - 1)) }

    private var navigator: LadderNavigator {
        LadderNavigator(store: store, toasts: toasts, pure: settings.pure)
    }

    // MARK: The ladder

    private func ladder(includingUpNext: Bool) -> some View {
        let navigator = navigator
        return ScrollViewReader { proxy in
            List {
                Section {
                    ForEach(levels, id: \.self) { level in
                        row(level, navigator: navigator)
                    }
                } header: {
                    LadderHeader()
                } footer: {
                    LadderFooter()
                }
                if includingUpNext {
                    Section {
                        UpNextView()
                            .padding(.vertical, 6)
                            .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16))
                            .listRowBackground(Color.clear)
                    } header: {
                        Text("Up next")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Theme.ink)
                            .textCase(nil)
                            .accessibilityAddTraits(.isHeader)
                    }
                    .id(UpNextColumn.anchor)
                }
            }
            #if os(iOS)
            .listStyle(.insetGrouped)
            #else
            .listStyle(.inset)
            #endif
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 44)
            .onAppear {
                if includingUpNext, LadderLaunch.scrollToUpNext {
                    Task { @MainActor in proxy.scrollTo(UpNextColumn.anchor, anchor: .top) }
                }
            }
            #if os(macOS)
            .focusable()
            .focusEffectDisabled()
            .focused($keyboardFocus)
            .onAppear { keyboardFocus = true }
            .onKeyPress(.upArrow) { move(-1) }
            .onKeyPress(.downArrow) { move(1) }
            .onKeyPress(.home) { move(-levels.count) }
            .onKeyPress(.end) { move(levels.count) }
            .onKeyPress(.return, phases: .down) { press in
                if press.modifiers.contains(.shift) { navigator.justBefore(settings.selectedLevel) } else { navigator.justAfter(settings.selectedLevel) }
                return .handled
            }
            #endif
        }
    }

    private func row(_ level: Int, navigator: LadderNavigator) -> some View {
        let selected = settings.selectedLevel == level
        let color = Theme.levelColor(level)
        return LadderRow(
            level: level,
            isSelected: selected,
            isExpanded: expanded == level,
            navigator: navigator,
            onTap: { tap(level) }
        )
        .id(level)
        .listRowInsets(EdgeInsets(top: 2, leading: 12, bottom: 2, trailing: 10))
        .listRowBackground(
            ZStack {
                Theme.panel.opacity(0.92)
                if selected { Theme.levelColor(level, opacity: 0.075) }
            }
        )
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button { navigator.justAfter(level) } label: { Label("Just after", systemImage: "forward.end.fill") }
                .tint(color.opacity(0.8))
            Button { navigator.justBefore(level) } label: { Label("Just before", systemImage: "play.fill") }
                .tint(Theme.panel3)
        }
        .swipeActions(edge: .leading) {
            Button { navigator.start(level) } label: { Label("Start", systemImage: "backward.end.fill") }
                .tint(Theme.line2)
        }
        .contextMenu {
            Button("Just after", systemImage: "forward.end") { navigator.justAfter(level) }
            Button("Just before", systemImage: "play") { navigator.justBefore(level) }
            Button("Start of this cycle", systemImage: "backward.end") { navigator.start(level) }
        }
    }

    // MARK: Selection

    private func start() {
        guard !started else { return }
        started = true
        LadderLaunch.rotateIfAsked()
        #if DEBUG
        if let depths = LadderLaunch.depths { setRange(depths.lowerBound, depths.upperBound) }
        if let level = LadderLaunch.expand {
            if level >= 0 { settings.selectedLevel = level }
            expanded = level >= 0 ? level : nil
            return
        }
        #endif
        expanded = levels.contains(settings.selectedLevel) ? settings.selectedLevel : nil
    }

    private func tap(_ level: Int) {
        if settings.selectedLevel != level { settings.selectedLevel = level }
        setExpanded(expanded == level ? nil : level)
    }

    private func setExpanded(_ level: Int?) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.32)) { expanded = level }
    }

    #if os(macOS)
    private func move(_ step: Int) -> KeyPress.Result {
        let all = levels
        let i = all.firstIndex(of: settings.selectedLevel).map { $0 + step } ?? (step > 0 ? 0 : all.count - 1)
        let level = all[min(max(i, 0), all.count - 1)]
        settings.selectedLevel = level
        setExpanded(level)
        return .handled
    }
    #endif
}

// MARK: - Header and footer

/// "Cycle ladder" and the depth range (shared with the rings and the timeline); outside the catalogue, a note with
/// the way back.
private struct LadderHeader: View {
    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        let words = settings.wording
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Cycle ladder")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                DepthMenu()
            }
            // the displayed time leaves the catalogue only by a jump (travel clamps, and a time-lapse stops at the
            // edge), so this is read when the clock changes (`revision`), not on a timer
            let _ = store.revision
            let t = LadderLaunch.shown(store.time())
            if !store.clock.inRange(t) {
                outside(t, words: words)
            }
        }
        .textCase(nil)
        .padding(.bottom, 2)
    }

    private func outside(_ t: Double, words: Wording) -> some View {
        let clock = store.clock
        let before = t < clock.tMin
        let edge = before ? clock.tMin : clock.tMax
        let side = before ? "the start" : "the end"
        let navigator = LadderNavigator(store: store, toasts: toasts, pure: words.pure)
        return VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(verbatim: words.pure
                    ? "Outside the catalogue (\(words.notation.catalogueText()))."
                    : "Outside the Saros 141 catalogue (\(words.earth.parts(clock.tMin).year)–\(words.earth.parts(clock.tMax).year)).")
            } icon: {
                Image(systemName: "clock.badge.xmark")
            }
            .font(.subheadline)
            .foregroundStyle(Theme.ink2)
            Button {
                navigator.edge(before ? clock.tMin + 0.001 : clock.tMax)
            } label: {
                Text(verbatim: "Go to \(side) (\(words.pure ? words.notation.stamp(at: edge, upTo: "beta") : words.earth.date(edge)))")
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel2, in: .rect(cornerRadius: 12, style: .continuous))
    }
}

/// The depth range of the ladder, rings and timeline: "α 1 – κ 10".
private struct DepthMenu: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        let words = settings.wording
        Menu {
            Picker("Coarsest depth", selection: minBinding) {
                ForEach(AppSettings.depths, id: \.self) { d in Text(words.levelLabel(d - 1)).tag(d) }
            }
            .pickerStyle(.menu)
            Picker("Finest depth", selection: maxBinding) {
                ForEach(AppSettings.depths, id: \.self) { d in Text(words.levelLabel(d - 1)).tag(d) }
            }
            .pickerStyle(.menu)
            Divider()
            if settings.minDepth != 1 || settings.maxDepth != 14 {
                Button("All depths (α – ξ)", systemImage: "arrow.up.and.down") { setRange(1, 14) }
            }
            if settings.minDepth != 1 || settings.maxDepth != 10 {
                Button("Default depths (α – κ)", systemImage: "arrow.uturn.backward") { setRange(1, 10) }
            }
        } label: {
            HStack(spacing: 4) {
                Text(verbatim: "\(LadderText.chip(settings.minDepth - 1)) – \(LadderText.chip(settings.maxDepth - 1))")
                    .monospacedDigit()
                Image(systemName: "chevron.up.chevron.down").imageScale(.small)
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Theme.ink2)
        }
        .menuStyle(.button)
        .buttonStyle(.borderless)
        .fixedSize()
        .accessibilityLabel("Depths shown")
        .accessibilityValue("\(LadderText.chip(settings.minDepth - 1)) to \(LadderText.chip(settings.maxDepth - 1))")
        .help("The depths shown here, in the rings and on the timeline")
    }

    private var minBinding: Binding<Int> {
        Binding(get: { settings.minDepth }, set: { setRange($0, max($0, settings.maxDepth)) })
    }

    private var maxBinding: Binding<Int> {
        Binding(get: { settings.maxDepth }, set: { setRange(min($0, settings.minDepth), $0) })
    }
}

/// The finer depths beyond the range, one tap away; a word on what the bars show.
private struct LadderFooter: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    #if os(macOS)
    private static let how = "Click a depth for its quarters; right-click it, or press ↩ or ⇧↩, to travel."
    #else
    private static let how = "Tap a depth for its quarters, swipe it to travel."
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if settings.maxDepth < 14 {
                let hidden = (settings.maxDepth...13).map(LadderText.letter)
                Button {
                    withAnimation(reduceMotion ? nil : .snappy) { setRange(settings.minDepth, 14) }
                } label: {
                    Label {
                        Text(verbatim: "\(hidden.count) finer \(hidden.count == 1 ? "depth" : "depths") (\(hidden.joined(separator: " ")))")
                    } icon: {
                        Image(systemName: "plus")
                    }
                }
            } else if settings.minDepth <= 10 {
                Button {
                    withAnimation(reduceMotion ? nil : .snappy) { setRange(settings.minDepth, 10) }
                } label: {
                    Label("Fewer depths (hide λ μ ν ξ)", systemImage: "minus")
                }
            }
            Text(verbatim: "Each bar is split into its sub-cycles; the \(settings.pure ? "glyphs show" : "glyph shows") the phase. \(Self.how)")
                .foregroundStyle(Theme.ink3)
        }
        .font(.footnote)
        .buttonStyle(.borderless)
        .tint(Theme.ink2)
        .textCase(nil)
        .padding(.top, 4)
    }
}

/// Change the shared depth range and keep the selection inside it (as the web ladder does). The settings refuse a
/// minimum above the maximum, so the order of the two writes matters.
@MainActor
private func setRange(_ min: Int, _ max: Int) {
    let settings = AppSettings.shared
    if min > settings.maxDepth {
        settings.maxDepth = max
        settings.minDepth = min
    } else {
        settings.minDepth = min
        settings.maxDepth = max
    }
    let inside = Swift.min(Swift.max(settings.selectedLevel, settings.minDepth - 1), settings.maxDepth - 1)
    if inside != settings.selectedLevel { settings.selectedLevel = inside }
}

// MARK: - Up next column

/// Up next beside the ladder on wide layouts.
private struct UpNextColumn: View {
    static let anchor = "upnext"

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Up next")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                UpNextView()
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 16)
        }
        .scrollIndicators(.hidden)
        .background(Theme.background2.opacity(0.55))
    }
}
