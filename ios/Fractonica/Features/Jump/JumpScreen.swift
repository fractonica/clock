import FractonicaKit
import SwiftUI

/// Jump: go to any moment by typing it (src/ui/jump.js, docs/design/60-calendar.md §1). The search tab of the app: on
/// iPhone its field sits in the tab bar's place, on iPad and Mac it is the sidebar's search item (⌘K).
///
/// As you type, the best reading shows the moment it lands on — in Earth and Fractonica terms, or only Fractonica
/// terms in pure mode — with the other readings below and a precise message for text that does not read. Return
/// (or a tap) travels there and goes back to Now. With an empty field: the recent jumps of the mode and examples to try.
///
/// Launch arguments for screenshots: `-FXJumpQuery <text>` starts with that text, `-FXJumpFocus 0` keeps the keyboard
/// down, `-FXJumpDemo 1` shows a sample history (never saved).
struct JumpScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = JumpModel()
    @State private var width: CGFloat = 0
    @FocusState private var searchFocused: Bool

    /// Does the device's locale write the day first in 06/01/2031? (it ranks the two readings)
    private static let dayFirst = JumpParser.dayFirst()

    var body: some View {
        @Bindable var model = model
        ScrollView {
            content
                .frame(maxWidth: width > 900 ? 860 : 680)
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        #if os(iOS)
        .scrollDismissesKeyboard(.immediately)
        #endif
        .navigationTitle(Screen.jump.title)
        .searchable(text: $model.query, placement: searchPlacement, prompt: Text(settings.pure ? "Jump to a moment" : "Jump to a time"))
        .searchFocused($searchFocused)
        .autocorrectionDisabled()
        #if os(iOS)
        .textInputAutocapitalization(.never)
        #endif
        .onSubmit(of: .search) { submit() }
        .task(id: refreshKey) { await refreshLoop() }
        .onAppear { if JumpModel.launchFocus { searchFocused = true } }
        .onChange(of: router.selection) { _, screen in
            if screen == .jump { searchFocused = true }
        }
        .sensoryFeedback(.success, trigger: model.jumps) { _, _ in settings.haptics }
        .sensoryFeedback(.error, trigger: model.rejections) { _, _ in settings.haptics }
    }

    /// iOS: the field stays in view under the title (inside the search tab's own navigation stack the system does not
    /// move it into the tab bar). macOS: the window toolbar.
    private var searchPlacement: SearchFieldPlacement {
        #if os(iOS)
        .navigationBarDrawer(displayMode: .always)
        #else
        .automatic
        #endif
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
                JumpResultCard(candidate: best, pure: settings.pure, earth: earth) { go(model.fresh(best, situation()), text: model.query) }
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
        if width > 760 && !model.history.entries.isEmpty {
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
                            searchFocused = true
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
                        }
                        FlowLayout(spacing: 8) {
                            ForEach(group.items, id: \.text) { example in
                                JumpExampleChip(text: example.text, meaning: example.meaning) {
                                    model.query = example.text
                                    searchFocused = true
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

    private struct RefreshKey: Hashable {
        var query: String
        var pure: Bool
        var zone: String?
        var level: Int
        var revision: Int
        var paused: Bool
        var active: Bool
    }

    private var refreshKey: RefreshKey {
        RefreshKey(query: model.query, pure: settings.pure, zone: settings.zone, level: settings.selectedLevel,
                   revision: store.revision, paused: store.isPaused, active: scenePhase == .active)
    }

    /// Reads the field at once, then again while the displayed time moves: once a second live, four times a second
    /// during a time-lapse (offsets and the distances shown count from the displayed time); never while paused.
    private func refreshLoop() async {
        while !Task.isCancelled {
            model.refresh(situation())
            guard !model.isEmpty, scenePhase == .active, !store.isPaused else { return }
            try? await Task.sleep(for: store.isLive ? .seconds(1) : .milliseconds(250))
        }
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
            store.goLive()
            toasts.show(settings.pure ? "Back to the live clock" : "Back to the device clock")
        } else if let t = candidate.time {
            store.travel(to: t)
            let moment = settings.pure ? Notation.standard.stamp(at: t, upTo: "eta") : EarthFormatter(zone: settings.zone).long(t)
            toasts.show("Jumped to \(moment)")
        } else {
            return
        }
        model.didJump(to: candidate, text: text, pure: settings.pure)
        searchFocused = false
        router.show(.now)
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
