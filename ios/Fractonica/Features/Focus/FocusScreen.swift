import FractonicaKit
import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Focus: the clock as a vivid full-screen animation driven by its harmonics. Presented full screen (a cover on iOS, its
/// own window on macOS, `isImmersive` true) and, on iPad and Mac, also listed as a screen of the window.
///
/// The picture (`FocusCanvas`) draws every level from δ to π as a harmonic in its own hue, in one of four styles, with a
/// breathing cue on the Flavon. Over it, a minimal overlay — the minor clock, the session and its controls — fades
/// after a few seconds and returns on a tap (or a mouse move). Swipe sideways (← →) to change the style, down (Esc) to
/// close. A session (1ι, 4ι, 1η or open) runs on the device clock and ends with a chime and a haptic; the screen stays
/// awake meanwhile.
struct FocusScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(\.isImmersive) private var isImmersive
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    @State private var stats = FocusFrameStats()
    @State private var overlayVisible = true
    /// Bumped by every interaction; the overlay hides a few seconds after the last one.
    @State private var interaction = 0
    @State private var lastReveal = Date.distantPast
    @State private var pull: CGFloat = 0
    @FocusState private var focused: Bool

    private var model: FocusModel { FocusModel.shared }
    private let launch = FocusLaunch.current

    /// Seconds the overlay stays after the last interaction.
    static let overlayLinger = 4.5

    var body: some View {
        @Bindable var model = model
        ZStack {
            FocusCanvas(config: canvasConfig, stats: stats)
                .ignoresSafeArea()
                .accessibilityElement()
                .accessibilityLabel(Text("Focus picture, \(model.style.title)"))
                .accessibilityHint(Text("Swipe up or down to change the style"))
                .accessibilityAddTraits(.isImage)
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: change(by: 1)
                    case .decrement: change(by: -1)
                    @unknown default: break
                    }
                }

            overlay
                .opacity(overlayShown ? 1 : 0)
                .allowsHitTesting(overlayShown)
        }
        .scaleEffect(1 - min(pull, 400) / 400 * 0.08)
        .offset(y: pull * 0.6)
        .opacity(1 - min(pull, 400) / 400 * 0.5)
        .contentShape(.rect)
        .onTapGesture { toggleOverlay() }
        .simultaneousGesture(swipe)
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(.leftArrow) {
            change(by: -1)
            return .handled
        }
        .onKeyPress(.rightArrow) {
            change(by: 1)
            return .handled
        }
        #if os(macOS)
        .onContinuousHover { phase in
            if case .active = phase { revealOnPointer() }
        }
        #endif
        .task(id: interaction) {
            guard launch.overlay != true, !voiceOver else { return }
            try? await Task.sleep(for: .seconds(Self.overlayLinger))
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.9)) { overlayVisible = false }
            #if os(macOS)
            if isImmersive { NSCursor.setHiddenUntilMouseMoves(true) }
            #endif
        }
        .onAppear {
            model.attach()
            if let elapsed = launch.elapsed { model.start(elapsed: elapsed) }
            if launch.overlay == false { overlayVisible = false }
            FocusAwake.hold(true)
            FocusChimePlayer.prepare()
            focused = true
        }
        .onDisappear {
            model.detach()
            FocusAwake.hold(false)
        }
        .onChange(of: model.style) {
            Haptics.play(.selection)
            reveal()
        }
        .onChange(of: model.completed) { _, completed in
            if completed != nil { reveal() }
        }
        .navigationTitle(Screen.focus.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarVisibility(isImmersive ? .hidden : .automatic, for: .navigationBar)
        .statusBarHidden(isImmersive)
        .persistentSystemOverlays(isImmersive && !overlayShown ? .hidden : .automatic)
        #endif
    }

    private var isRegular: Bool {
        #if os(iOS)
        sizeClass == .regular
        #else
        true
        #endif
    }

    private var overlayShown: Bool { overlayVisible || voiceOver || launch.overlay == true }

    private var canvasConfig: FocusCanvasConfig {
        FocusCanvasConfig(
            style: model.style,
            breathing: model.breathing,
            calm: reduceMotion || launch.calm,
            dimmed: overlayShown,
            active: scenePhase != .background,
            timeOverride: launch.time,
            logStats: launch.stats
        )
    }

    // MARK: Overlay

    private var overlay: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                FocusStyleIndicator(style: model.style)
                    .animation(.easeInOut(duration: 0.3), value: model.style)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 6)
                HStack(alignment: .top) {
                    Spacer()
                    if isImmersive {
                        Button("Close", systemImage: "xmark") { close() }
                            .labelStyle(.iconOnly)
                            .buttonStyle(.glass)
                            .buttonBorderShape(.circle)
                            .controlSize(.large)
                            .keyboardShortcut(.cancelAction)
                            .help("Close Focus (Esc)")
                    }
                }
            }
            if launch.stats {
                FocusStatsBadge(stats: stats)
                    .padding(.top, 12)
            }
            Spacer(minLength: 24)
            VStack(spacing: 12) {
                FocusClockReading(timeOverride: launch.time, regular: isRegular)
                VStack(spacing: 8) {
                    HStack(spacing: 14) {
                        if model.breathing {
                            FocusBreathWord(timeOverride: launch.time)
                        }
                        FocusSessionLine(model: model)
                    }
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    FocusSessionProgress(model: model)
                }
            }
            .shadow(color: .black.opacity(0.6), radius: 12)
            .padding(.bottom, 22)
            controls
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(maxWidth: 720)
    }

    private var controls: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(spacing: 12) {
                sessionMenu
                Button {
                    model.breathing.toggle()
                    touched()
                } label: {
                    Label(model.breathing ? "Breathing cue on" : "Breathing cue off", systemImage: model.breathing ? "lungs.fill" : "lungs")
                }
                .labelStyle(.iconOnly)
                .help("Breathing cue on the Flavon")
                styleMenu
                if !isImmersive {
                    Button("Full Screen", systemImage: "arrow.up.left.and.arrow.down.right") { router.show(.focus) }
                        .labelStyle(.iconOnly)
                        .help("Focus full screen")
                }
            }
            .buttonStyle(.glass)
            .controlSize(.large)
        }
    }

    private var sessionMenu: some View {
        Menu {
            Picker("Session", selection: Binding(get: { model.length }, set: { model.choose($0); touched() })) {
                ForEach(FocusLength.allCases) { length in
                    if let hint = FocusText.approximate(length, pure: settings.pure, at: Date.now.timeIntervalSince1970) {
                        Text("\(length.name)  \(hint)").tag(length)
                    } else {
                        Text(length.name).tag(length)
                    }
                }
            }
            .pickerStyle(.inline)
            Divider()
            Button("Restart Session", systemImage: "arrow.counterclockwise") {
                model.start()
                touched()
            }
        } label: {
            Label(model.length.title, systemImage: "timer")
                .font(.body.monospacedDigit())
        }
        .menuIndicator(.hidden)
        .help("Session length")
        .accessibilityLabel(Text("Session, \(model.length.name)"))
    }

    private var styleMenu: some View {
        Menu {
            Picker("Style", selection: Binding(get: { model.style }, set: { model.style = $0; touched() })) {
                ForEach(FocusStyle.allCases) { style in
                    Label(style.title, systemImage: style.systemImage).tag(style)
                }
            }
            .pickerStyle(.inline)
        } label: {
            Label(model.style.title, systemImage: model.style.systemImage)
                .labelStyle(.iconOnly)
        }
        .menuIndicator(.hidden)
        .help("Style (← →)")
    }

    // MARK: Interaction

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 24)
            .onChanged { value in
                let dx = value.translation.width, dy = value.translation.height
                if isImmersive, dy > 0, abs(dy) > abs(dx) { pull = dy }
            }
            .onEnded { value in
                let dx = value.translation.width, dy = value.translation.height
                let flingDown = value.predictedEndTranslation.height
                if abs(dx) > abs(dy) {
                    if abs(dx) > 50 { change(by: dx < 0 ? 1 : -1) }
                } else if isImmersive, dy > 140 || flingDown > 420 {
                    close()
                    return
                }
                withAnimation(.spring(duration: 0.35)) { pull = 0 }
            }
    }

    private func change(by step: Int) {
        withAnimation(.easeInOut(duration: 0.3)) { model.style = model.style.advanced(by: step) }
    }

    private func toggleOverlay() {
        if overlayShown && !voiceOver && launch.overlay != true {
            withAnimation(.easeInOut(duration: 0.5)) { overlayVisible = false }
        } else {
            reveal()
        }
    }

    /// Shows the overlay and restarts its timer.
    private func reveal() {
        withAnimation(.easeInOut(duration: 0.35)) { overlayVisible = true }
        interaction &+= 1
    }

    private func touched() { interaction &+= 1 }

    /// A pointer move brings the overlay back (at most twice a second).
    private func revealOnPointer() {
        guard Date.now.timeIntervalSince(lastReveal) > 0.5 else { return }
        lastReveal = .now
        reveal()
    }

    private func close() {
        dismiss()
    }
}

/// Keeps the display awake while any Focus view is on screen: the idle timer on iOS, a display-sleep assertion on
/// macOS.
@MainActor
enum FocusAwake {
    private static var holders = 0
    #if os(macOS)
    private static var activity: (any NSObjectProtocol)?
    #endif

    static func hold(_ on: Bool) {
        holders = max(0, holders + (on ? 1 : -1))
        let awake = holders > 0
        #if os(iOS)
        UIApplication.shared.isIdleTimerDisabled = awake
        #elseif os(macOS)
        if awake, activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: [.idleDisplaySleepDisabled, .userInitiated], reason: "Focus mode")
        } else if !awake, let current = activity {
            ProcessInfo.processInfo.endActivity(current)
            activity = nil
        }
        #endif
    }
}
