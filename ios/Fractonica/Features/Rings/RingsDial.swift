import FractonicaKit
import SwiftUI

/// The concentric dial (src/ui/rings/dial.js): one ring per depth shown, outermost the longest cycle, with the centre
/// read-out in the hole.
///
/// - Tap a ring to select its level; tap a sector of the selected ring to go to the start of that child cycle.
/// - Drag around a ring to wind its hand: the time follows, through the cycle and on into the next.
/// - Touch and hold (iOS) for a preview of the ring or sector. With a pointer (Mac, iPad), hovering highlights what a
///   click would do and a tooltip says what is under the pointer; on the Mac the context menu holds the same facts
///   and actions, and once clicked the dial takes the arrow keys.
struct RingsDial: View {
    let size: CGFloat
    let model: RingsScreenModel
    /// The dial sits in a page that scrolls vertically (iPhone): a steeply vertical drag scrolls it.
    var inVerticalScroll = false

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var frozen = FrozenPhases()
    /// What the pointer is over (Mac, iPad with a pointer): changes only when the ring or sector under it does.
    @State private var pointer: RingsPointerTarget?
    @FocusState private var focused: Bool
    @State private var scrub: Scrub?
    @State private var lastLongPress = Date.distantPast
    /// A launch argument's virtual pointer (screenshots of the tooltip).
    @State private var virtualPointer: RingsVirtualPointer?

    private let clock = FractonicaClock.shared
    private let cycles = RingsCycles()

    /// A drag winding one ring's hand: `position` counts cycles of its level (index plus phase).
    private struct Scrub {
        var ring: Int
        var level: Int
        var position: Double
        var lastPhase: Double
        var lastIndex: Int?
    }

    var body: some View {
        let range = model.range(settings)
        let selected = model.selected(settings)
        let layout = RingLayout(size: size, count: range.count)
        DialStack(
            step: model.selectionStep,
            targetStep: model.selectionStep,
            layout: layout,
            range: range,
            selected: selected,
            previous: model.previousSelection,
            layers: RingsPreferences.shared.layers,
            highlight: highlight(layout: layout, range: range, selected: selected),
            scrubbing: model.scrubbingRing,
            outOfRange: model.outOfRange,
            animated: model.isVisible,
            frozen: frozen,
            reduceMotion: reduceMotion
        )
        .overlay {
            RingsCentre(radius: layout.rHole, selected: selected, outOfRange: model.outOfRange, model: model)
        }
        .frame(width: size, height: size)
        .contentShape(Circle())
        .modifier(DialGestures(
            layout: layout,
            tap: { tap(at: $0, layout: layout, range: range, selected: selected) },
            longPress: { longPress(at: $0, layout: layout, range: range) },
            canScrub: { start, translation in
                guard case .ring? = layout.hit(start) else { return false }
                return RingsMath.beginsWinding(start: start, translation: translation, center: layout.center, inVerticalScroll: inVerticalScroll)
            },
            scrub: { step, point in scrub(step, at: point, layout: layout, range: range, selected: selected) },
            target: { pointerTarget(at: $0, layout: layout, range: range) },
            onTarget: { pointer = $0 },
            showsTip: scrub == nil && model.preview == nil && !model.outOfRange,
            tip: { RingsHoverTip(target: $0, selected: $0.level == selected) },
            virtualPointer: virtualPointer.flatMap { v in
                v.ring < layout.count ? layout.point(radius: layout.track(v.ring).mid, phase: v.phase) : nil
            }
        ))
        #if os(macOS)
        .contextMenu { contextMenu(layout: layout, range: range, selected: selected) }
        #endif
        .overlay(alignment: .topLeading) {
            // the preview hangs from a point-sized view where the finger is
            let p = model.preview.map { layout.point(radius: layout.track(min($0.ring, layout.count - 1)).mid, phase: $0.phase) } ?? layout.center
            Color.clear
                .frame(width: 10, height: 10)
                .popover(item: Bindable(model).preview, arrowEdge: p.y > size * 0.55 ? .bottom : .top) { target in
                    RingsPreviewCard(target: target, model: model)
                        .presentationCompactAdaptation(.popover)
                }
                .position(p)
                .allowsHitTesting(false)
        }
        .task {
            // after the first layout pass, when the dial has its real size
            try? await Task.sleep(for: .milliseconds(600))
            model.takePendingPreview(range: model.range(settings), at: store.time())
            virtualPointer = model.takePendingHover(range: model.range(settings))
        }
        .onChange(of: store.revision) { frozen.reset() }
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .home, .end, .pageUp, .pageDown, .return]) { press in
            // arrow keys carry the numeric-pad and function flags on the Mac: only real modifiers make it someone else's
            guard press.modifiers.isDisjoint(with: [.command, .option, .control, .shift]) else { return .ignored }
            switch press.key {
            case .home: selectAbsolute(range.minLevel, selected: selected)
            case .end: selectAbsolute(range.maxLevel, selected: selected)
            // the keyboard's way to the sectors (rings.js `jumpChild`): Return restarts the running child cycle, Page
            // Up / Page Down step through the children
            case .return: goToRunningChild(selected: selected)
            case .pageUp: stepChild(1, selected: selected)
            case .pageDown: stepChild(-1, selected: selected)
            default:
                let d = press.key == .leftArrow || press.key == .upArrow ? -1 : 1
                selectRelative(d, range: range, selected: selected)
            }
            return .handled
        }
        .accessibilityElement()
        .accessibilityLabel(Text("Rings dial, \(RingsText.levelTag(range.minLevel)) to \(RingsText.levelTag(range.maxLevel))"))
        .accessibilityValue(Text(accessibilityValue(selected: selected)))
        .accessibilityHint(Text("Swipe up or down to select another ring"))
        .accessibilityAdjustableAction { direction in
            selectRelative(direction == .increment ? 1 : -1, range: range, selected: selected)
        }
        .accessibilityAction(named: Text(model.outOfRange ? "Go to the start of the catalogue" : "Go to the start of the running child cycle")) {
            if model.outOfRange {
                model.outOfRange = false
                store.travel(to: clock.tMin + 0.001)
            } else {
                goToRunningChild(selected: selected)
            }
        }
    }

    // MARK: Highlight

    private func highlight(layout: RingLayout, range: DepthRange, selected: Int) -> DialHighlight? {
        if let preview = model.preview { return DialHighlight(ring: preview.ring, sector: preview.sector) }
        guard scrub == nil, let p = pointer, p.ring < range.count else { return nil }
        return DialHighlight(ring: p.ring, sector: p.level == selected ? p.sector : nil)
    }

    private func pointerTarget(at p: CGPoint, layout: RingLayout, range: DepthRange) -> RingsPointerTarget? {
        guard !model.outOfRange, case .ring(let i, let phase, _)? = layout.hit(p), i < range.count else { return nil }
        let level = range.levels[i]
        let sector = level < Fractonica.maxLevel ? RingsMath.sector(of: phase, factor: clock.levelInfo(level).factor) : nil
        return RingsPointerTarget(ring: i, level: level, sector: sector)
    }

    // MARK: Actions

    private var readTime: Double { min(store.time(), clock.tMax - 0.001) }

    private func tap(at p: CGPoint, layout: RingLayout, range: DepthRange, selected: Int) {
        #if os(macOS)
        focused = true // the arrow keys follow the dial once it has been clicked
        #endif
        // the lift that ends a touch-and-hold is not a tap
        guard model.preview == nil, Date.now.timeIntervalSince(lastLongPress) > 0.6 else { return }
        guard !model.outOfRange, case .ring(let i, let phase, _)? = layout.hit(p) else { return }
        let level = range.levels[i]
        if level != selected {
            model.select(level, settings: settings, reduceMotion: reduceMotion)
            Haptics.play(.selection)
            return
        }
        guard let reading = clock.level(at: readTime, level) else { return }
        let sector = RingsMath.sector(of: phase, factor: reading.factor)
        guard let child = cycles.child(level: level, cycle: reading.cycle, sector: sector) else {
            Haptics.play(.warning)
            toasts.show(level >= Fractonica.maxLevel ? "Finer than the dial shows" : "Beyond the end of the catalogue")
            return
        }
        store.travel(to: child.start + 0.001)
        Haptics.play(.step)
    }

    private func longPress(at p: CGPoint, layout: RingLayout, range: DepthRange) {
        guard !model.outOfRange, case .ring(let i, let phase, _)? = layout.hit(p) else { return }
        lastLongPress = .now
        let level = range.levels[i]
        let sector = level < Fractonica.maxLevel ? RingsMath.sector(of: phase, factor: clock.levelInfo(level).factor) : nil
        model.preview = RingsPreviewTarget(level: level, ring: i, sector: sector, phase: phase)
        Haptics.play(.selection)
    }

    private func scrub(_ step: DragStep, at p: CGPoint, layout: RingLayout, range: DepthRange, selected: Int) {
        switch step {
        case .began:
            guard !model.outOfRange, case .ring(let i, let phase, _)? = layout.hit(p) else { return }
            let level = range.levels[i]
            guard let reading = clock.level(at: readTime, level) else { return }
            if level != selected { model.select(level, settings: settings, reduceMotion: reduceMotion) }
            scrub = Scrub(ring: i, level: level, position: Double(reading.cycle) + phase, lastPhase: phase, lastIndex: reading.index)
            model.scrubbingRing = i
            model.preview = nil
            applyScrub()
        case .changed:
            guard var s = scrub else { return }
            let phase = RingsMath.phase(of: p, around: layout.center)
            let total = Double(clock.extent) * clock.levelInfo(s.level).prefixDouble / 4
            s.position = min(max(s.position + RingsMath.unwrappedStep(from: s.lastPhase, to: phase), 0), total)
            s.lastPhase = phase
            scrub = s
            applyScrub()
        case .ended, .cancelled:
            scrub = nil
            model.scrubbingRing = nil
        }
    }

    /// Moves the displayed time to where the wound hand points; a tick of feedback for each glyph state passed.
    private func applyScrub() {
        guard var s = scrub, let t = cycles.scrubTime(level: s.level, position: s.position) else { return }
        store.travel(to: t)
        let index = clock.level(at: t, s.level)?.index
        if index != s.lastIndex {
            s.lastIndex = index
            scrub = s
            Haptics.play(.selection)
        }
    }

    private func selectRelative(_ d: Int, range: DepthRange, selected: Int) {
        let next = range.contains(selected) ? range.clamp(selected + d) : range.clamp(selected)
        guard next != selected else { return }
        model.select(next, settings: settings, reduceMotion: reduceMotion)
        Haptics.play(.selection)
    }

    private func selectAbsolute(_ level: Int, selected: Int) {
        guard level != selected else { return }
        model.select(level, settings: settings, reduceMotion: reduceMotion)
        Haptics.play(.selection)
    }

    private func goToRunningChild(selected: Int) {
        guard !model.outOfRange, selected < Fractonica.maxLevel, let r = clock.level(at: readTime, selected),
              let child = cycles.child(level: selected, cycle: r.cycle, sector: RingsMath.sector(of: r.phase, factor: r.factor)) else { return }
        store.travel(to: child.start + 0.001)
        Haptics.play(.step)
    }

    /// The previous or next child cycle of the selected ring (one sector on).
    private func stepChild(_ direction: Int, selected: Int) {
        guard !model.outOfRange, selected < Fractonica.maxLevel else { return }
        if let edge = store.step(level: selected + 1, direction: direction) {
            toasts.show(edge)
        } else {
            Haptics.play(.step)
        }
    }

    private func accessibilityValue(selected: Int) -> String {
        guard !model.outOfRange, let r = clock.level(at: readTime, selected) else { return "Outside the catalogue" }
        let word = RingsText.phaseWord(index: r.index, derivative: r.derivative).lowercased()
        if settings.pure {
            let pure = RingsPureText()
            return "Selected \(pure.displayName(r)), \(RingsText.cycleTag(r)), \(word), \(r.clipped ? "the catalogue ends" : "ends") in \(pure.between(store.time(), r.end))"
        }
        return "Selected \(RingsText.cycleTag(r)), \(word), \(r.clipped ? "the catalogue ends" : "ends") in \(RingsText.countdownBody(r.remaining))"
    }

    // MARK: Mac context menu

    #if os(macOS)
    @ViewBuilder
    private func contextMenu(layout: RingLayout, range: DepthRange, selected: Int) -> some View {
        if let p = pointer, p.ring < range.count, let r = clock.level(at: readTime, p.level) {
            let level = p.level
            let words = RingsPreviewWords(pure: settings.pure, earth: settings.wording.earth)
            let facts = words.ring(r, now: store.time())
            Section(facts.title) {
                Text(facts.detail)
                Text(facts.ends)
            }
            if let sector = p.sector {
                if let child = cycles.child(level: level, cycle: r.cycle, sector: sector) {
                    let c = words.child(child, parent: r, now: store.time())
                    Section(c.title) {
                        Text(c.span)
                        Button("Go to Its Start", systemImage: "arrow.right.to.line") {
                            store.travel(to: child.start + 0.001)
                            Haptics.play(.step)
                        }
                    }
                }
            }
            if level != selected {
                Button("Select \(RingsText.levelTag(level))", systemImage: "scope") {
                    model.select(level, settings: settings, reduceMotion: reduceMotion)
                }
            }
        }
    }
    #endif
}

// MARK: - The canvases

/// The three layers at one displayed instant. Animatable so the selection's emphasis can move from ring to ring even
/// while the clock stands still.
private struct DialStack: View, Animatable {
    /// The selection count, interpolated while the emphasis moves; `targetStep` is where it is going.
    var step: Double
    let targetStep: Double
    let layout: RingLayout
    let range: DepthRange
    let selected: Int
    let previous: Int?
    let layers: RingsLayers
    let highlight: DialHighlight?
    let scrubbing: Int?
    let outOfRange: Bool
    let animated: Bool
    let frozen: FrozenPhases
    let reduceMotion: Bool

    @Environment(ClockStore.self) private var store

    nonisolated var animatableData: Double {
        get { step }
        set { step = newValue }
    }

    /// 0 when the selection has just moved, 1 when the emphasis has arrived.
    private var progress: Double { min(1, max(0, 1 - (targetStep - step))) }

    var body: some View {
        if animated {
            ClockTimeline(cadence) { t in canvases(t) }
        } else {
            canvases(store.time())
        }
    }

    /// Every display frame while a hand moves fast enough to need it; otherwise only as often as the fastest hand
    /// moves half a point (live, the default rings need about ten redraws a second, not 120).
    private var cadence: ClockCadence {
        let speed = RingsScreenModel.speed(of: store)
        guard speed > 0 else { return .animation }
        let rings = range.levels.enumerated().map { i, level in
            (meanSeconds: FractonicaClock.shared.levelInfo(level).meanSeconds, radius: layout.track(i).mid)
        }
        let hz = RingsMath.redrawRate(rings: rings, speed: speed, frozenWhenFast: reduceMotion)
        return hz > 30 ? .animation : .periodic(speed / max(hz, 1))
    }

    private func canvases(_ t: Double) -> some View {
        let frame = RingsFrame(t: t, range: range, selected: selected, speed: RingsScreenModel.speed(of: store), outOfRange: outOfRange)
        let emphasis = DialEmphasis(selected: selected, previous: previous, progress: progress)
        let revision = store.revision
        let shown: [Double?] = frame.rings.map { ring in
            guard let r = ring.reading, !ring.blur else { return nil }
            return reduceMotion && ring.fast ? frozen.phase(level: ring.level, live: r.phase, revision: revision) : r.phase
        }
        let rings = zip(frame.rings, shown).map { ring, phase in
            DialRing(
                level: ring.level,
                factor: ring.factor,
                blur: ring.blur,
                sector: phase.map { RingsMath.sector(of: $0, factor: ring.factor) },
                counter: ring.blur ? nil : ring.reading.map(RingsText.counter)
            )
        }
        let live = zip(frame.rings, shown).map { ring, phase in DialLiveRing(level: ring.level, phase: phase) }
        return ZStack {
            DialBaseLayer(input: DialBaseInput(layout: layout, rings: rings, emphasis: emphasis, inRange: frame.inRange, layers: layers))
                .equatable()
            DialLiveLayer(input: DialLiveInput(layout: layout, rings: live, factors: frame.rings.map(\.factor), emphasis: emphasis,
                                               inRange: frame.inRange, quarters: layers.quarters, highlight: highlight, scrubbing: scrubbing))
            DialLabelLayer(input: DialLabelInput(layout: layout, rings: rings, emphasis: emphasis, inRange: frame.inRange, quarters: layers.quarters))
                .equatable()
        }
    }
}

// MARK: - Gestures per platform

private struct DialGestures: ViewModifier {
    let layout: RingLayout
    let tap: (CGPoint) -> Void
    let longPress: (CGPoint) -> Void
    let canScrub: (CGPoint, CGSize) -> Bool
    let scrub: (DragStep, CGPoint) -> Void
    /// What lies under a pointer.
    let target: (CGPoint) -> RingsPointerTarget?
    /// Told only when the target under the pointer changes (not on every pointer move).
    let onTarget: (RingsPointerTarget?) -> Void
    let showsTip: Bool
    let tip: (RingsPointerTarget) -> RingsHoverTip
    var virtualPointer: CGPoint?

    /// The pointer and its target live here, so a moving pointer redraws only the tip, not the dial.
    @State private var point: CGPoint?
    @State private var current: RingsPointerTarget?
    #if os(macOS)
    @State private var dragging: Bool?
    #endif

    func body(content: Content) -> some View {
        gestures(content)
            .onContinuousHover { phase in
                if case .active(let p) = phase { track(p) } else { track(nil) }
            }
            .onChange(of: virtualPointer) { _, p in if let p { track(p) } }
            .overlay(alignment: .topLeading) {
                if showsTip, let p = point, let c = current {
                    // hung from a point-sized anchor at the pointer, on whichever side keeps it over the dial
                    let left = p.x > layout.size * 0.55
                    let up = p.y > layout.size * 0.6
                    Color.clear
                        .frame(width: 0, height: 0)
                        .overlay(alignment: Alignment(horizontal: left ? .trailing : .leading, vertical: up ? .bottom : .top)) {
                            tip(c)
                                .fixedSize()
                                .padding(.leading, left ? 0 : 16)
                                .padding(.trailing, left ? 12 : 0)
                                .padding(.top, up ? 0 : 18)
                                .padding(.bottom, up ? 12 : 0)
                        }
                        .offset(x: p.x, y: p.y)
                        .allowsHitTesting(false)
                }
            }
    }

    private func track(_ p: CGPoint?) {
        point = p
        let t = p.flatMap(target)
        if t != current {
            current = t
            onTarget(t)
        }
    }

    @ViewBuilder
    private func gestures(_ content: Content) -> some View {
        #if os(iOS)
        content
            .gesture(LocatedTapGesture(action: tap))
            .gesture(LocatedLongPressGesture(action: longPress))
            .gesture(DirectionalPanGesture(shouldBegin: canScrub, onChange: scrub))
        #else
        content
            .gesture(
                DragGesture(minimumDistance: 3)
                    .onChanged { value in
                        if dragging == nil {
                            var onRing = false
                            if case .ring? = layout.hit(value.startLocation) { onRing = true }
                            dragging = onRing
                            if onRing { scrub(.began, value.startLocation) }
                        }
                        if dragging == true { scrub(.changed, value.location) }
                    }
                    .onEnded { value in
                        if dragging == true { scrub(.ended, value.location) }
                        dragging = nil
                    }
            )
            .onTapGesture(coordinateSpace: .local) { tap($0) }
        #endif
    }
}
