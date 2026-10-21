import FractonicaKit
import SwiftUI

/// Wave: the library's circular harmonic geometry as a you-are-here map (src/ui/wave.js, docs/design/50-wave.md).
///
/// Every half-cycle of a level is an arc (crest +, trough −) and its next-depth half-cycles are the loops that hug it,
/// like epicycles. The stage focuses on the half-arc of the chosen depth that holds the displayed time, with its
/// children and grandchildren, and puts one marker per level on its own arc joined by tethers. Pinch or the depth bar
/// changes the depth (the camera glides between them), drag along the bright arc travels in time, tap a loop to jump
/// to it or a dot to focus its depth; the catalogue (∿) shows the whole Saros 141 wave, and the solar wave adds the
/// 19-Helion sync as a yellow ripple.
struct WaveScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    @State private var model = WaveModel()

    /// iPhone: the navigation bar's centre holds the group's segmented control, so About moves onto the stage.
    private var compact: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    var body: some View {
        let control = controller
        GeometryReader { geo in
            if model.forceWide ?? Self.isWide(geo.size) {
                HStack(spacing: 0) {
                    WaveStageView(model: model, control: control, infoOnStage: compact)
                    Rectangle().fill(Theme.line).frame(width: 1).ignoresSafeArea(edges: .bottom)
                    WaveSidePanel(model: model, control: control)
                        .frame(width: min(380, max(280, geo.size.width * 0.32)))
                }
            } else {
                VStack(spacing: 0) {
                    WaveHeader(model: model, control: control)
                    WaveStageView(model: model, control: control, infoOnStage: compact)
                }
            }
        }
        .navigationTitle(Screen.wave.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    model.solar.toggle()
                    model.keepDrawing(for: 0.4)
                } label: {
                    Label(model.solar ? "Hide the solar wave" : "Show the solar wave", systemImage: model.solar ? "sun.max.fill" : "sun.max")
                        .foregroundStyle(model.solar ? Theme.gold : Theme.ink)
                }
                .help("Solar sync wave: one yellow wave of \(settings.pure ? "19η" : "19 η cycles (about 4 days)")")
                .accessibilityValue(model.solar ? "on" : "off")
                if !compact {
                    Button("About the wave", systemImage: "info.circle") { model.showInfo = true }
                        .help("How to read the wave")
                }
            }
        }
        .sheet(isPresented: Bindable(model).showInfo) {
            WaveInfoView(words: control.words)
        }
        .onAppear {
            model.visible = true
            model.stage.reset()
            wireStage()
            if let hooks = model.takeLaunchHooks() {
                if let level = hooks.level {
                    settings.selectedLevel = level
                    model.overview = false
                }
                if let rate = hooks.rate { store.setRate(rate) }
            }
            let demo = model.takeDemo()
            if !demo.isEmpty {
                Task { @MainActor in
                    for step in demo {
                        try? await Task.sleep(for: .seconds(2))
                        controller.zoom(step)
                    }
                }
            }
        }
        .onDisappear { model.visible = false }
        .onChange(of: settings.selectedLevel) {
            // a selection made anywhere focuses it here
            if model.overview { model.overview = false }
            model.keepDrawing(for: 1.1)
        }
        .onChange(of: store.revision) { model.keepDrawing(for: 1.1) }
        .onChange(of: model.overview) { model.keepDrawing(for: 1.1) }
        .onChange(of: settings.pure) { model.keepDrawing(for: 0.3) }
        .sensoryFeedback(.selection, trigger: settings.selectedLevel) { _, _ in settings.haptics }
        .sensoryFeedback(.selection, trigger: model.overview) { _, _ in settings.haptics }
    }

    /// What the stage reports from inside its frames, deferred so nothing observed changes while SwiftUI draws.
    private func wireStage() {
        let stage = model.stage
        let model = model
        let settings = settings
        let store = store
        stage.requestFrames = { [weak model] seconds in model?.requestFrames(seconds) }
        stage.userReset = { [weak model] in
            Task { @MainActor in model?.adjusted = false }
        }
        stage.tick = {
            Task { @MainActor in Haptics.play(.selection) }
        }
        stage.sceneChanged = { [weak stage] info, t in
            // VoiceOver hears where the view moved when the clock stands still (the user moved it), never the
            // clock's own progress
            guard let info, let stage, store.isPaused else { return }
            let text = WaveWords(wording: settings.wording, engine: stage.engine).announce(info, t: t)
            Task { @MainActor in AccessibilityNotification.Announcement(text).post() }
        }
    }

    /// A stage beside a reading panel when there is width to spare (iPad landscape, Mac, iPhone landscape).
    static func isWide(_ size: CGSize) -> Bool {
        size.width >= 680 && size.width >= size.height * 0.95
    }

    private var controller: WaveController {
        let rate = store.isLive ? 1 : store.isPlaying ? abs(store.rate) : 0
        let level = settings.selectedLevel
        let engine = model.stage.engine
        let eff = WaveNav.followableLevel(level, rate: rate, reduced: reduceMotion) { engine.clock.levelInfo($0).meanSeconds }
        return WaveController(
            store: store, settings: settings, toasts: toasts, model: model,
            words: WaveWords(wording: settings.wording, engine: engine),
            level: level, eff: eff, reduceMotion: reduceMotion
        )
    }
}

/// What the wave's controls do, bound to the app's state for one body evaluation.
@MainActor
struct WaveController {
    let store: ClockStore
    let settings: AppSettings
    let toasts: ToastCenter
    let model: WaveModel
    let words: WaveWords
    /// The shared selection, and the level focused (coarser while a time-lapse is too fast to follow).
    let level: Int
    let eff: Int
    let reduceMotion: Bool

    var engine: WaveEngine { model.stage.engine }
    var inRange: Bool { store.clock.inRange(now) }
    /// The displayed time as this screen shows it.
    var now: Double { shown(store.time()) }

    /// A displayed time as this screen shows it (shifted only by the -FXWaveOffset launch hook).
    func shown(_ t: Double) -> Double { t + model.offset }
    var overview: Bool { model.overview }

    /// The readings refresh at the pace their finest number changes (at most 10 Hz, at least once a second).
    var readoutInterval: Double {
        let half = store.clock.levelInfo(eff).meanSeconds / 2
        return min(1, max(0.1, half / 200))
    }

    /// One depth deeper (dir > 0) or out; out of α leads to the catalogue. `quiet` (a pinch) never toasts a limit.
    @discardableResult
    func zoom(_ dir: Int, quiet: Bool = false) -> Bool {
        let plan = WaveNav.zoomPlan(inRange: inRange, overview: model.overview, level: level, eff: eff, dir: dir)
        switch plan {
        case .select(let l):
            settings.selectedLevel = l
        case .focus(let l):
            model.overview = false
            settings.selectedLevel = l
        case .overview:
            model.overview = true
        case .limit(let why):
            if !quiet {
                switch why {
                case .outOfRange: toasts.show("Outside the catalogue: go to its first or last eclipse")
                case .deepest: toasts.show("Depth 14 (ξ) is the deepest shown")
                case .catalogueShown: toasts.show("The whole catalogue is already shown")
                }
                Haptics.play(.warning)
            }
            return false
        }
        model.keepDrawing(for: 1.1)
        return true
    }

    /// Whether a zoom step in that direction would do anything.
    func canZoom(_ dir: Int) -> Bool {
        let z = WaveNav.zoomEnabled(inRange: inRange, overview: model.overview, level: level)
        return dir > 0 ? z.zoomIn : z.zoomOut
    }

    /// The previous (dir < 0) or next half-arc of the level in view.
    func step(_ dir: Int) {
        let t = now
        guard let cur = engine.readHalves(t) else {
            toasts.show("Outside the catalogue: go to its first or last eclipse")
            return
        }
        let l = model.overview ? 0 : eff
        switch engine.stepTarget(l, cur[l].idx, t: t, dir: dir) {
        case .time(let x):
            store.travel(to: x)
            Haptics.play(.step)
        case .edge(let edge):
            toasts.show(edge == .end ? "End of the catalogue" : "Start of the catalogue")
            Haptics.play(.warning)
        }
        model.keepDrawing(for: 1.1)
    }

    /// Focus a depth (nil: the whole catalogue).
    func select(_ l: Int?) {
        if let l {
            model.overview = false
            settings.selectedLevel = l
        } else {
            model.overview = true
        }
        model.keepDrawing(for: 1.1)
    }

    func travel(to t: Double) {
        store.travel(to: t)
    }

    /// Jump to the start of a half-arc (a tapped loop).
    func jump(level: Int, idx: Int64) {
        let span = engine.halfSpan(level, idx)
        store.travel(to: min(span.end - 0.0005, span.start + waveLand))
        Haptics.play(.step)
        model.keepDrawing(for: 1.1)
    }

    /// To the first or last eclipse, from outside the catalogue.
    func goToEdge(_ edge: WaveEdge) {
        store.travel(to: edge == .start ? store.clock.tMin + waveLand : store.clock.tMax - waveLand)
        model.keepDrawing(for: 1.1)
    }

    /// What one frame of the stage needs.
    func frameInput(size: CGSize, avoid: [WaveRect], bottomInset: Double, topInset: Double, trailingInset: Double) -> WaveFrameInput {
        #if os(iOS)
        let touch = true
        #else
        let touch = false
        #endif
        let compact = size.width < 500
        let side = compact ? 28.0 : 56
        return WaveFrameInput(
            overview: model.overview, level: level, eff: eff, solar: model.solar, words: words, reduceMotion: reduceMotion,
            // the focused figure is centred and only its edges meet the floating controls; the catalogue fills the stage
            focusPad: WavePad(l: side, r: side + trailingInset * 0.5, t: 24 + topInset * 0.5, b: 34 + bottomInset),
            overviewPad: WavePad(l: 20, r: 20 + trailingInset, t: 8 + topInset, b: 14 + bottomInset),
            avoid: avoid, touch: touch
        )
    }
}
