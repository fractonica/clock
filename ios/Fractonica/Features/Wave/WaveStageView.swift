import FractonicaKit
import SwiftUI

/// The stage: the Canvas with the wave, its gestures (drag along the arc to travel, tap a loop or a dot, pinch to
/// change depth, drag elsewhere to look around, hover or hold for details), the depth bar and the zoom controls.
struct WaveStageView: View {
    let model: WaveModel
    let control: WaveController
    /// About sits on the stage (iPhone) instead of in the toolbar.
    var infoOnStage = false
    /// The depth bar floats at the foot of the stage (else the side panel holds it).
    var depthBarOnStage = true

    @Environment(AppSettings.self) private var settings
    @State private var drag: DragState?
    @State private var pinch: PinchState?
    @State private var stageSize = CGSize.zero
    @State private var barHeight = 0.0
    @State private var barFrame = CGRect.zero
    @State private var zoomFrame = CGRect.zero
    @FocusState private var focused: Bool
    #if os(macOS)
    @State private var wheel = WaveWheel()
    #endif

    private struct DragState {
        var id = UUID()
        var start: CGPoint
        var pick: WavePick?
        /// The press landed on the arc it would scrub along.
        var target: Bool
        var scrub = false
        /// The press landed on the solar pin (a drag travels within its sync).
        var pin: Bool
        var sync = 0
        var pan = false
        var panBase = WavePoint(x: 0, y: 0)
        var inspecting = false
        /// A pinch took over this press: the finger left on the glass does nothing until it lifts.
        var spent = false
    }

    private struct PinchState {
        var anchor: CGPoint
        var base: Double
        var userBase: WaveUserTransform
        var lastCommit: Double
    }

    #if os(iOS)
    private let touch = true
    #else
    private let touch = false
    #endif

    var body: some View {
        let stage = model.stage
        let compact = stageSize.width < 500
        let input = control.frameInput(
            size: stageSize,
            avoid: ([barFrame, zoomFrame] + (infoOnStage ? [CGRect(x: 10, y: 12, width: 40, height: 40)] : []))
                .filter { $0.width > 0 }.map { WaveRect(x0: $0.minX - 6, y0: $0.minY - 6, x1: $0.maxX + 6, y1: $0.maxY + 6) },
            bottomInset: depthBarOnStage ? barHeight + 12 : 0, topInset: zoomFrame.maxY > 0 ? zoomFrame.maxY - 6 : 60, trailingInset: compact ? 0 : 52,
            leadingControl: infoOnStage
        )
        #if os(macOS)
        // the wheel acts on this evaluation's controller (its depth and selection)
        let _ = wireWheel()
        #endif
        ZStack {
            if model.visible {
                ClockTimeline(cadence) { t in
                    Canvas { context, size in
                        let now = WaveStage.now
                        if stage.update(size: size, t: control.shown(t), input: input, now: now) {
                            stage.draw(&context, now: now)
                        }
                    }
                }
                .accessibilityHidden(true)
            }
            WaveStageAccessibility(model: model, control: control)
        }
        .contentShape(Rectangle())
        .gesture(dragGesture)
        .simultaneousGesture(magnifyGesture)
        .onContinuousHover(coordinateSpace: .local) { phase in hover(phase) }
        .onGeometryChange(for: CGSize.self) { $0.size } action: { stageSize = $0 }
        .overlay(alignment: .bottom) {
            if depthBarOnStage {
                WaveDepthBar(model: model, control: control)
                    .frame(maxWidth: 680)
                    .padding(.horizontal, compact ? 10 : 16)
                    .padding(.bottom, 10)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("wave.stage")) } action: { r in
                        barFrame = r
                        barHeight = r.height
                    }
                    .onDisappear {
                        barFrame = .zero
                        barHeight = 0
                    }
            }
        }
        .overlay(alignment: .topTrailing) {
            zoomControls
                .padding(.top, 12)
                .padding(.trailing, compact ? 10 : 16)
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("wave.stage")) } action: { zoomFrame = $0 }
        }
        .overlay(alignment: .topLeading) {
            if infoOnStage {
                Button { model.showInfo = true } label: {
                    Image(systemName: "info").font(.body.weight(.semibold)).frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.ink2)
                .glassEffect(.regular.interactive(), in: .circle)
                .padding(.top, 12)
                .padding(.leading, 10)
                .accessibilityLabel("About the wave")
            }
        }
        .overlay(alignment: .topLeading) {
            if let tip = model.tip {
                // the card keeps clear of the depth bar floating at the foot of the stage
                let room = CGSize(width: stageSize.width, height: barFrame.height > 0 ? min(stageSize.height, barFrame.minY - 4) : stageSize.height)
                WaveTipView(pick: tip.pick, location: tip.location, stageSize: room, control: control, above: drag?.inspecting ?? false)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .coordinateSpace(.named("wave.stage"))
        .clipped()
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .home, "+", "-", "="]) { press in
            key(press.key)
        }
        #if os(macOS)
        .onAppear { wheel.start() }
        .onDisappear { wheel.stop() }
        #endif
        .task(id: model.visible) {
            // the -FXWaveInspect launch hook: the tooltip of what lies at a stage point, once the stage has drawn
            guard model.visible, let p = model.takeLaunchInspect() else { return }
            try? await Task.sleep(for: .seconds(1.2))
            if let pick = stage.pick(p, touch: touch) { model.tip = (pick, p) }
        }
    }

    /// Every frame while something moves of its own accord (a glide, a gesture); otherwise only as often as the
    /// picture visibly changes: a time-lapse at full frame rate, the live clock at η a few times a second.
    private var cadence: ClockCadence {
        if model.continuous { return .continuous }
        let rate = abs(control.store.isLive ? 1 : control.store.rate)
        guard rate > 0 else { return .animation }
        return model.cadence / rate < 1.0 / 30 ? .animation : .periodic(model.cadence)
    }

    // MARK: Controls

    private var zoomControls: some View {
        VStack(spacing: 10) {
            GlassEffectContainer {
                VStack(spacing: 0) {
                    Button { control.zoom(1) } label: {
                        Image(systemName: "plus").frame(width: 40, height: 40)
                    }
                    .disabled(!control.canZoom(1))
                    .accessibilityLabel("Zoom in to the next depth")
                    .help("Zoom in: the next depth (↑ or +)")
                    Rectangle().fill(Theme.line2).frame(width: 18, height: 1)
                    Button { control.zoom(-1) } label: {
                        Image(systemName: "minus").frame(width: 40, height: 40)
                    }
                    .disabled(!control.canZoom(-1))
                    .accessibilityLabel(control.overview ? "Zoom out" : control.eff == 0 ? "Show the whole catalogue" : "Zoom out to the previous depth")
                    .help("Zoom out: the previous depth (↓ or −)")
                }
                .font(.body.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(Theme.ink)
                .glassEffect(.regular.interactive(), in: .capsule)
            }
            if model.adjusted {
                Button {
                    model.stage.releaseUser()
                    model.adjusted = false
                } label: {
                    Image(systemName: "scope").font(.body.weight(.semibold)).frame(width: 40, height: 40)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.ink)
                .glassEffect(.regular.interactive(), in: .circle)
                .accessibilityLabel("Recenter")
                .help("Back to the fitted view")
                .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.snappy, value: model.adjusted)
    }

    // MARK: Gestures

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { v in dragChanged(v) }
            .onEnded { v in dragEnded(v) }
    }

    private func dragChanged(_ v: DragGesture.Value) {
        guard pinch == nil, !(drag?.spent ?? false) else { return }
        let stage = model.stage
        if drag == nil {
            // a fresh press reports no movement yet; one that arrives already far from its start is the finger left
            // over from a pinch
            if hypot(v.translation.width, v.translation.height) > 8 {
                drag = DragState(start: v.startLocation, pick: nil, target: false, pin: false, spent: true)
                return
            }
            let pick = stage.pick(v.startLocation, touch: touch)
            let target = pick.map { $0.kind == .focus || $0.kind == .alpha } ?? false
            let pin = pick?.kind == .sun && stage.sun != nil
            var d = DragState(start: v.startLocation, pick: pick, target: target, pin: pin, sync: pin ? stage.sun?.sync ?? 0 : 0,
                              panBase: stage.user.translation)
            focused = true
            // a mouse scrubs the moment it presses the arc; a finger first shows whether it means to drag along it
            if target && !touch {
                d.scrub = true
                stage.scrubbing = true
                if let t = stage.scrubTime(v.startLocation) { control.travel(to: t) }
            }
            stage.hover = pick
            drag = d
            model.keepDrawing(for: 0.5)
            if touch { scheduleInspect(d.id) }
            return
        }
        guard var d = drag else { return }
        let moved = hypot(v.location.x - d.start.x, v.location.y - d.start.y)
        if d.inspecting {
            inspect(at: v.location)
            return
        }
        if d.target && !d.scrub && moved > 6 {
            d.scrub = true
            stage.scrubbing = true
        }
        if d.pin && !d.scrub && moved > 3 { d.scrub = true }
        if d.scrub {
            let t = d.pin ? stage.pinTime(v.location, sync: d.sync) : stage.scrubTime(v.location)
            if let t { control.travel(to: t) }
        } else if !d.target && !d.pin && (d.pan || moved > 8) {
            d.pan = true
            stage.hover = nil
            var u = stage.user
            u.translation = WavePoint(x: d.panBase.x + v.translation.width, y: d.panBase.y + v.translation.height)
            stage.setUser(u)
            if !model.adjusted { model.adjusted = true }
        }
        drag = d
        model.keepDrawing(for: 0.4)
    }

    private func dragEnded(_ v: DragGesture.Value) {
        let stage = model.stage
        defer {
            drag = nil
            stage.scrubbing = false
            if touch {
                stage.hover = nil
                model.tip = nil
            }
            model.keepDrawing(for: 0.4)
        }
        guard pinch == nil, let d = drag, !d.inspecting, !d.pan, !d.spent else { return }
        let moved = hypot(v.location.x - d.start.x, v.location.y - d.start.y)
        if touch && d.target && !d.scrub {
            // a tap on the arc: travel to that point
            if let t = stage.scrubTime(d.start) {
                control.travel(to: t)
                Haptics.play(.selection)
            }
        } else if !d.scrub, moved < 7, let p = d.pick {
            switch p.kind {
            case .child: control.jump(level: p.level, idx: p.idx)
            case .marker: control.select(p.level)
            default: break
            }
        }
    }

    /// A finger that holds still shows what it is on (and follows it) instead of scrubbing.
    private func scheduleInspect(_ id: UUID) {
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.45))
            guard var d = drag, d.id == id, !d.scrub, !d.pan, pinch == nil else { return }
            d.inspecting = true
            drag = d
            inspect(at: d.start)
            Haptics.play(.selection)
        }
    }

    private func inspect(at p: CGPoint) {
        let pick = model.stage.pick(p, touch: touch)
        model.stage.hover = pick
        if let pick { model.tip = (pick, p) } else { model.tip = nil }
        model.keepDrawing(for: 0.3)
    }

    private func hover(_ phase: HoverPhase) {
        #if os(macOS)
        if case .active = phase { wheel.hovering = true } else { wheel.hovering = false }
        #endif
        guard drag == nil || !(drag?.scrub ?? false) else { return }
        switch phase {
        case .active(let p):
            let pick = model.stage.pick(p, touch: false)
            let same = pick.map { $0.same(model.stage.hover) } ?? (model.stage.hover == nil)
            if !same || model.tip != nil { model.keepDrawing(for: 0.25) }
            model.stage.hover = pick
            model.tip = pick.map { ($0, p) }
        case .ended:
            model.stage.hover = nil
            model.tip = nil
            model.keepDrawing(for: 0.25)
        }
    }

    private var magnifyGesture: some Gesture {
        MagnifyGesture(minimumScaleDelta: 0)
            .onChanged { v in pinchChanged(v) }
            .onEnded { _ in pinchEnded() }
    }

    private func pinchChanged(_ v: MagnifyGesture.Value) {
        let stage = model.stage
        if pinch == nil {
            // the press that began the pinch is spent: lifting one finger must not start a scrub or a pan (a trackpad
            // pinch has no press)
            if let d = drag { drag = DragState(id: d.id, start: d.start, pick: nil, target: false, pin: false, spent: true) }
            stage.scrubbing = false
            stage.hover = nil
            model.tip = nil
            let u = stage.user
            pinch = PinchState(anchor: v.startLocation, base: v.magnification, userBase: u, lastCommit: -1)
        }
        guard var p = pinch else { return }
        var ratio = v.magnification / max(1e-6, p.base)
        let dir = ratio > 1 ? 1 : -1
        let now = WaveStage.now
        if (ratio > 1.45 || ratio < 0.69) && now - p.lastCommit > 0.38 && control.canZoom(dir) {
            stage.setUser(transform(p, ratio))
            stage.commitUser()
            if control.zoom(dir, quiet: true) {
                p = PinchState(anchor: p.anchor, base: v.magnification, userBase: .identity, lastCommit: now)
                pinch = p
                ratio = 1
            }
        } else if !control.canZoom(dir) {
            // at a limit the picture gives a little, then holds
            ratio = 1 + (ratio - 1) * 0.25
        }
        stage.setUser(transform(p, ratio))
        if !model.adjusted && !stage.user.isIdentity { model.adjusted = true }
        model.keepDrawing(for: 0.5)
    }

    /// The pinch on top of what the user had: scale about the anchor, any earlier pan scaled along.
    private func transform(_ p: PinchState, _ ratio: Double) -> WaveUserTransform {
        WaveUserTransform(
            scale: p.userBase.scale * ratio,
            anchor: WavePoint(x: p.anchor.x, y: p.anchor.y),
            translation: WavePoint(x: p.userBase.translation.x * ratio, y: p.userBase.translation.y * ratio)
        )
    }

    private func pinchEnded() {
        pinch = nil
        model.stage.releaseUser()
        model.adjusted = false
        model.keepDrawing(for: 0.5)
    }

    #if os(macOS)
    private func wireWheel() {
        let control = control
        let model = model
        wheel.zoom = { dir in control.zoom(dir, quiet: true) }
        wheel.pan = { dx, dy in
            let stage = model.stage
            var u = stage.user
            u.translation = WavePoint(x: u.translation.x + dx, y: u.translation.y + dy)
            stage.setUser(u)
            if !model.adjusted { model.adjusted = true }
            model.keepDrawing(for: 0.3)
        }
    }
    #endif

    private func key(_ key: KeyEquivalent) -> KeyPress.Result {
        switch key {
        case .leftArrow: control.step(-1)
        case .rightArrow: control.step(1)
        case .upArrow, "+", "=": control.zoom(1)
        case .downArrow, "-": control.zoom(-1)
        case .home: control.select(nil)
        default: return .ignored
        }
        return .handled
    }
}

/// The stage as VoiceOver reads it: where the view is focused, refreshed every second, with the step and zoom actions.
private struct WaveStageAccessibility: View {
    let model: WaveModel
    let control: WaveController

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            let r = WaveReadout.make(t: control.shown(t), overview: model.overview, level: control.level, eff: control.eff, words: control.words)
            Color.clear
                .contentShape(Rectangle())
                .allowsHitTesting(false)
                .accessibilityElement()
                .accessibilityLabel(Text(r.spoken))
                .accessibilityHint(Text("Swipe up or down to step by half-arc."))
                .accessibilityAdjustableAction { direction in
                    control.step(direction == .increment ? 1 : -1)
                }
                .accessibilityAction(named: Text("Zoom in")) { control.zoom(1) }
                .accessibilityAction(named: Text("Zoom out")) { control.zoom(-1) }
                .accessibilityAction(named: Text("Show the whole catalogue")) { control.select(nil) }
        }
    }
}
