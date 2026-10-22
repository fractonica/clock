import FractonicaKit
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// Jump: go to any moment by typing it (src/ui/jump.js, docs/design/60-calendar.md §1). The search tab of the app: on
/// iPhone its field is the tab bar's own (the compact root's `.searchable`, shared through `JumpSearch`; under the
/// title on iOS 18); on iPad and Mac it is the sidebar's search item and draws its field under the title or in the
/// toolbar. ⌘K focuses the field.
///
/// As you type, the best reading shows the moment it lands on — in Earth and Fractonica terms (side by side on a wide
/// screen), or only Fractonica terms in pure mode — with the other readings below and a precise message for text that
/// does not read. Return (or a tap) travels there and goes back to Now. With an empty field: the recent jumps of the
/// mode and examples to try. On iPhone and iPad a glass bar of the notation's Greek letters floats over the keyboard.
/// The readings follow the displayed time while it moves (`ClockTimeline`, on screen only).
///
/// Launch arguments for screenshots: `-FXJumpQuery <text>` starts with that text, `-FXJumpFocus 0` keeps the keyboard
/// down, `-FXJumpDemo 1` shows a sample history (never saved), `-FXJumpSubmit 1` presses Return once (the jump lands
/// on Now with its toast), `-FXJumpLandscape 1` turns an iPhone to landscape (iOS).
struct JumpScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = JumpModel()
    @State private var width: CGFloat = 0
    /// On screen (the readings follow the clock only then).
    @State private var visible = false
    /// The focus of the field this screen draws (iPad and Mac), kept in step with `search.isFocused`.
    @FocusState private var searchFocused: Bool
    /// The query and focus shared with the iPhone tab bar's field.
    private var search: JumpSearch { .shared }

    /// Does the device's locale write the day first in 06/01/2031? (it ranks the two readings)
    private static let dayFirst = JumpParser.dayFirst()

    var body: some View {
        @Bindable var model = model
        ScrollView {
            content
                .frame(maxWidth: JumpLayout.contentWidth(for: width))
                .padding(.horizontal, JumpLayout.margin(for: width))
                .padding(.top, 8)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        #if os(iOS)
        .scrollDismissesKeyboard(.immediately)
        #endif
        .navigationTitle(Screen.jump.title)
        .modifier(JumpSearchField(owned: !router.isCompact, query: $model.query, focused: $searchFocused, pure: settings.pure, submit: submit))
        #if os(iOS)
        .safeAreaInset(edge: .bottom) {
            // the notation's Greek letters, floating above the keyboard while the field has focus
            if search.isFocused {
                JumpLetterKeys(pure: settings.pure) { model.query += $0 }
                    .frame(maxWidth: 720)
                    .padding(.horizontal, JumpLayout.margin(for: width))
                    .padding(.bottom, 8)
                    .transition(.opacity)
            }
        }
        #endif
        .onChange(of: search.submissions) {
            // Return in the iPhone tab bar's field
            if router.isCompact { submit() }
        }
        .onChange(of: searchFocused) { _, focused in
            if !router.isCompact, search.isFocused != focused { search.isFocused = focused }
        }
        .onChange(of: search.isFocused) { _, focused in
            if !router.isCompact, searchFocused != focused { searchFocused = focused }
        }
        .onChange(of: refreshKey) { model.refresh(situation()) }
        .background {
            // While the displayed time moves, read the field again with it: on the second live, four times a
            // second during a time-lapse; never while paused or in the background (ClockTimeline stops then).
            if visible && !model.isEmpty {
                ClockTimeline(.periodic(JumpLayout.refreshInterval(live: store.isLive, rate: store.rate))) { t in
                    Color.clear.onChange(of: t) { model.refresh(situation()) }
                }
            }
        }
        .onDisappear { visible = false }
        .onAppear {
            visible = true
            model.refresh(situation())
            if JumpModel.launchFocus || search.isFocused { focusField(true) }
            #if os(iOS)
            if JumpModel.launchLandscape {
                let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
                scene?.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
            }
            #endif
            if JumpModel.launchSubmit, !model.isEmpty {
                Task {
                    try? await Task.sleep(for: .seconds(1))
                    submit()
                }
            }
        }
        .onChange(of: router.selection) { _, screen in
            if screen == .jump { focusField(true) }
        }
        .sensoryFeedback(.success, trigger: model.jumps) { _, _ in settings.haptics }
        .sensoryFeedback(.error, trigger: model.rejections) { _, _ in settings.haptics }
    }

    /// Puts the keyboard focus in the field (or takes it away), whichever view draws the field.
    private func focusField(_ focused: Bool) {
        search.isFocused = focused
        if !router.isCompact { searchFocused = focused }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        let earth = EarthFormatter(zone: settings.zone)
        VStack(alignment: .leading, spacing: 22) {
            JumpOrigin(pure: settings.pure, earth: earth)
            if model.isEmpty {
                idle(earth)
            } else if let best = model.best {
                JumpResultCard(candidate: best, pure: settings.pure, earth: earth, wide: JumpLayout.isWide(width)) {
                    go(model.fresh(best, situation()), text: model.query)
                }
                .id(best.kind.rawValue + best.label)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
                if !model.alternatives.isEmpty {
                    JumpSection(title: "Other readings") {
                        JumpCard {
                            ForEach(Array(model.alternatives.enumerated()), id: \.offset) { i, candidate in
                                if i > 0 { JumpDivider() }
                                JumpCandidateRow(candidate: candidate, pure: settings.pure, earth: earth) {
                                    go(model.fresh(candidate, situation()), text: model.query)
                                }
                            }
                        }
                    }
                }
            } else if !model.errors.isEmpty {
                JumpErrorCard(errors: model.errors)
                    .modifier(Shake(trigger: model.rejections, enabled: !reduceMotion))
                examples(compact: true)
            }
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.28), value: phase)
    }

    /// Recent jumps and examples, side by side when there is room.
    @ViewBuilder
    private func idle(_ earth: EarthFormatter) -> some View {
        let recent = recentSection(earth)
        if JumpLayout.isWide(width) && !model.history.entries.isEmpty {
            HStack(alignment: .top, spacing: 24) {
                recent.frame(maxWidth: .infinity, alignment: .topLeading)
                examples(compact: false).frame(maxWidth: .infinity, alignment: .topLeading)
            }
        } else {
            recent
            examples(compact: false)
        }
    }

    @ViewBuilder
    private func recentSection(_ earth: EarthFormatter) -> some View {
        if !model.history.entries.isEmpty {
            JumpSection(title: "Recent") {
                JumpCard {
                    ForEach(Array(model.history.entries.enumerated()), id: \.element) { i, entry in
                        if i > 0 { JumpDivider() }
                        JumpRecentRow(entry: entry) {
                            if let c = model.replay(entry, situation()) { go(c, text: entry.text) }
                        } fill: {
                            model.query = entry.text
                            focusField(true)
                        } remove: {
                            withAnimation(reduceMotion ? nil : .snappy) { model.forget(entry, pure: settings.pure) }
                        }
                    }
                }
            } accessory: {
                Button("Clear") {
                    withAnimation(reduceMotion ? nil : .snappy) { model.forgetAll(pure: settings.pure) }
                }
                .font(.subheadline)
                .buttonStyle(.borderless)
                .tint(Theme.teal)
                .accessibilityLabel("Clear recent jumps")
            }
        }
    }

    private func examples(compact: Bool) -> some View {
        JumpSection(title: compact ? "Try instead" : "Try") {
            VStack(alignment: .leading, spacing: 14) {
                let groups = JumpInterpreter.examples(pure: settings.pure, dayFirst: Self.dayFirst)
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        if groups.count > 1 {
                            Text(group.title)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(Theme.ink3)
                                .padding(.leading, 4)
                        }
                        FlowLayout(spacing: 8) {
                            ForEach(group.items, id: \.text) { example in
                                JumpExampleChip(text: example.text, meaning: example.meaning) {
                                    model.query = example.text
                                    focusField(true)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: Reading and going

    /// What the screen shows: idle, a reading, or an error (the animation key).
    private var phase: Int { model.isEmpty ? 0 : model.best != nil ? 1 : 2 }

    /// What the readings depend on besides the displayed time: a change reads the field again at once.
    private struct RefreshKey: Hashable {
        var query: String
        var pure: Bool
        var zone: String?
        var level: Int
        var revision: Int
    }

    private var refreshKey: RefreshKey {
        RefreshKey(query: model.query, pure: settings.pure, zone: settings.zone, level: settings.selectedLevel,
                   revision: store.revision)
    }

    private func situation() -> JumpInterpreter.Situation {
        JumpInterpreter.Situation(
            now: store.time(),
            real: Date.now.timeIntervalSince1970,
            pure: settings.pure,
            zone: settings.zone ?? TimeZone.current.identifier,
            dayFirst: Self.dayFirst,
            level: settings.selectedLevel
        )
    }

    private func submit() {
        let text = model.query
        guard let candidate = model.submit(situation()) else { return }
        go(candidate, text: text)
    }

    /// Travels to a reading (or back to the live clock for "now"), remembers it, and shows Now.
    private func go(_ candidate: JumpCandidate, text: String) {
        if candidate.live {
            let wasLive = store.isLive
            store.goLive()
            toasts.show(wasLive ? "Showing the live clock" : settings.pure ? "Back to the live clock" : "Back to the device clock")
        } else if let t = candidate.time {
            store.travel(to: t)
            let moment = settings.pure ? Notation.standard.stamp(at: t, upTo: "eta") : EarthFormatter(zone: settings.zone).long(t)
            toasts.show("Jumped to \(moment)")
        } else {
            return
        }
        model.didJump(to: candidate, text: text, pure: settings.pure)
        focusField(false)
        router.show(.now)
    }
}

/// The search field Jump draws itself on iPad (under the title, always in view) and Mac (the window toolbar). On iPhone
/// the compact root owns the field (in the tab bar), so this adds nothing there.
private struct JumpSearchField: ViewModifier {
    var owned: Bool
    @Binding var query: String
    var focused: FocusState<Bool>.Binding
    var pure: Bool
    var submit: () -> Void

    func body(content: Content) -> some View {
        if owned {
            content
                .searchable(text: $query, placement: placement, prompt: Text(JumpSearch.prompt(pure: pure)))
                .searchFocused(focused)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif
                .onSubmit(of: .search, submit)
        } else {
            content
        }
    }

    private var placement: SearchFieldPlacement {
        #if os(iOS)
        .navigationBarDrawer(displayMode: .always)
        #else
        .automatic
        #endif
    }
}

/// Shakes its content sideways when `trigger` changes (Return on text that does not read).
private struct Shake: ViewModifier {
    var trigger: Int
    var enabled: Bool

    func body(content: Content) -> some View {
        if enabled {
            content.keyframeAnimator(initialValue: 0.0, trigger: trigger) { view, x in
                view.offset(x: x)
            } keyframes: { _ in
                KeyframeTrack {
                    LinearKeyframe(-9, duration: 0.06)
                    LinearKeyframe(8, duration: 0.08)
                    LinearKeyframe(-5, duration: 0.08)
                    LinearKeyframe(3, duration: 0.07)
                    LinearKeyframe(0, duration: 0.06)
                }
            }
        } else {
            content
        }
    }
}
