import FractonicaKit
import SwiftUI

/// Now: the clock face, the app's hero (src/ui/face.js, docs/design/10-face.md, SPEC §8–§10).
///
/// Two faces as pages — the journal face (the default: "34η 29ι 21λ" with the lead unit's phase above and its cycle
/// below) and the spec's watch face (period odometers over the solar sync) — switched by a sideways drag, the dots,
/// the face menu or ← →. On a face, a tap on the top or bottom third (or a drag down or up, or ↑ ↓) moves to a longer
/// or shorter unit or depth, with a haptic tick, and a soft bounce at the ends; the watch face shows its info labels
/// on a tap in the middle and keeps its letters on a double tap. A rail of letters beside the face shows where it
/// stands on the ladder. Around it: the date line and what turns over next (compact), or a column of readings (wide).
struct NowScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The launch hooks, each dropped by the first interaction that changes what it set.
    @State private var launch = FaceLaunch.current
    /// The last step: −1 longer, +1 shorter (the direction a new reading arrives from, or bounces).
    @State private var stepDirection = 0
    /// Each face's tap wash and end-of-ladder bounce (separate, so switching faces replays neither).
    @State private var journalFlash = FaceFlash()
    @State private var watchFlash = FaceFlash()
    @State private var journalBounce = 0
    @State private var watchBounce = 0
    @State private var steps = 0
    @State private var refusals = 0
    @State private var overlay = TransientOverlay()
    @State private var lastMiddleTap: TimeInterval?
    @State private var guideShown = FaceLaunch.current.guide
    @FocusState private var focused: Bool

    private var face: AppSettings.FaceMode { launch.face ?? settings.faceMode }
    private var unit: Int { launch.unit ?? settings.journalUnit }
    private var depth: Int { launch.depth ?? settings.topDepth }
    private var page: Int { face == .journal ? 0 : 1 }
    /// The level whose turnover the line below the face counts down to.
    private var leadLevel: Int { face == .journal ? Journal.units[FaceStepper.clampUnit(unit)].level : depth - 1 }

    var body: some View {
        GeometryReader { geo in
            // the -FXFaceCanvas hook lays the screen out in a box of another size (landscape, Mac windows)
            let size = launch.canvas ?? geo.size
            let layout = NowLayout(size: size)
            Group {
                if layout.wide {
                    wide(layout)
                } else {
                    compact(layout)
                }
            }
            .frame(width: size.width, height: size.height)
            .overlay {
                if launch.canvas != nil { Rectangle().strokeBorder(Theme.cursor.opacity(0.4), lineWidth: 1) }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .navigationTitle(Screen.now.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { faceMenu }
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow, "i", "l"]) { press in
            keyPressed(press.key)
        }
        .onAppear { focused = true }
        .onChange(of: face, initial: true) { _, face in
            if face == .watch { orientLetters() }
        }
        .task(id: overlay.id) {
            guard let until = overlay.until else { return }
            try? await Task.sleep(for: .seconds(max(0, until.timeIntervalSinceNow)))
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.25)) { overlay.mode = .none }
        }
        .overlay(alignment: .bottom) {
            if let row = launch.tip, face == .watch {
                FaceTipPreview(row: row, tips: rowTips(depth: FaceStepper.clampDepth(depth), words: settings.wording))
                    .clipShape(.rect(cornerRadius: 22))
                    .shadow(color: .black.opacity(0.5), radius: 20)
                    .padding(.bottom, 24)
            }
        }
        .sheet(isPresented: $guideShown) {
            NavigationStack { FaceGuide() }
                #if os(iOS)
                .presentationDetents([.medium, .large])
                #else
                .frame(minWidth: 480, minHeight: 560)
                #endif
        }
        .sensoryFeedback(.selection, trigger: steps) { _, _ in settings.haptics }
        .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: refusals) { _, _ in settings.haptics }
    }

    // MARK: - Layouts

    /// iPhone portrait (and narrow windows): the date line, the face filling the height, the turnover line and dots.
    private func compact(_ layout: NowLayout) -> some View {
        VStack(spacing: 0) {
            NowDateLine(fixed: launch.time)
                .padding(.horizontal, 20)
                .padding(.top, 6)
            pager(layout)
                .padding(.vertical, 10)
            TurnoverLine(level: leadLevel, fixed: launch.time)
                .padding(.horizontal, 20)
            dots
        }
    }

    /// iPad, Mac and iPhone landscape: the face (with its rail and dots) beside a column of readings.
    private func wide(_ layout: NowLayout) -> some View {
        HStack(spacing: layout.gap) {
            VStack(spacing: 2) {
                pager(layout)
                    .frame(width: layout.faceAreaWidth, height: layout.wideFaceHeight)
                dots
            }
            ReadingsPanel(leadLevel: leadLevel, fixed: launch.time, showsPeriods: layout.size.height >= 460, roomy: layout.roomy)
                .frame(width: layout.panelWidth, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var dots: some View {
        PageDots(page: page, titles: ["Journal", "Watch"]) { setFace($0 == 0 ? .journal : .watch) }
    }

    private func pager(_ layout: NowLayout) -> some View {
        FacePager(page: page, onPage: { setFace($0 == 0 ? .journal : .watch) }, onStep: { step($0) }) {
            FacePage(layout: layout) {
                journalFace
            } rail: {
                UnitRail(items: UnitRail.journal(unit: unit), title: "Journal unit", scale: layout.railScale) { selectUnit($0) }
            }
        } second: {
            FacePage(layout: layout) {
                watchFace
            } rail: {
                UnitRail(items: UnitRail.watch(topDepth: depth), title: "Watch depth", scale: layout.railScale) { selectDepth($0 + 2) }
            }
        }
    }

    // MARK: - The faces

    /// Time-lapses change the faces faster than an animation lasts: then they simply redraw.
    private var animated: Bool { !(store.isPlaying && abs(store.rate) > 1) }

    private var journalFace: some View {
        let unit = FaceStepper.clampUnit(self.unit)
        let words = settings.wording
        return NowTimeline(fixed: launch.time, next: { FaceCadence.journal(after: $0, unit: unit) }) { t in
            let frame = JournalFrame.make(at: t, unit: unit)
            JournalFaceView(frame: frame, outOfRange: FaceWords.outOfRange(words: words), animated: animated,
                            stepDirection: stepDirection, flash: journalFlash, bounce: journalBounce,
                            onTap: journalTap)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: frame?.accessibilityLabel ?? FaceWords.outOfRange(words: words).title.joined(separator: " ")))
                .accessibilityHint(Text("Adjust up for a longer unit, down for a shorter one"))
                .accessibilityAdjustableAction { direction in adjust(direction) }
                .accessibilityAction(named: Text("Watch face")) { setFace(.watch) }
        }
    }

    private var watchFace: some View {
        let depth = FaceStepper.clampDepth(self.depth)
        let words = settings.wording
        let shown = shownOverlay
        let countdowns = words.pure && shown == .info
        // a depth of 11 over 12 changes every few milliseconds (SPEC §10): follow it at the display's pace
        return NowTimeline(fixed: launch.time, minimumStep: 1.0 / 60,
                           next: { FaceCadence.watch(after: $0, topDepth: depth, countdowns: countdowns) }) { t in
            let frame = WatchFrame.make(at: t, topDepth: depth, words: words, info: shown == .info)
            WatchFaceView(frame: frame, overlay: shown, outOfRange: FaceWords.outOfRange(words: words),
                          solarUnavailable: FaceWords.solarUnavailable(pure: words.pure), selectedLevel: settings.selectedLevel,
                          animated: animated, flash: watchFlash, bounce: watchBounce,
                          bounceDirection: stepDirection, onTap: watchTap, tips: rowTips(depth: depth, words: words))
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: frame?.accessibilityLabel ?? FaceWords.outOfRange(words: words).title.joined(separator: " ")))
                .accessibilityValue(Text(verbatim: watchValue(frame, words: words)))
                .accessibilityHint(Text("Adjust up for a longer period, down for a shorter one"))
                .accessibilityAdjustableAction { direction in adjust(direction) }
                .accessibilityAction(named: Text("Show info labels")) { showInfo() }
                .accessibilityAction(named: Text(settings.showLetters ? "Hide period letters" : "Keep period letters")) { toggleLetters() }
                .accessibilityAction(named: Text("Journal face")) { setFace(.journal) }
                .accessibilityActions {
                    if let frame {
                        Button("Select \(frame.top.letter) in Every View") { selectRow(.top) }
                        Button("Select \(frame.bottom.letter) in Every View") { selectRow(.bottom) }
                    }
                }
        }
    }

    /// What the watch rows' cards and menus say and do.
    private func rowTips(depth: Int, words: Wording) -> WatchRowTips {
        WatchRowTips(
            store: store, words: words, topDepth: depth, fixed: launch.time, lettersKept: settings.showLetters,
            selectedLevel: settings.selectedLevel,
            select: { row in
                selectRow(row)
                steps += 1
            },
            step: { step($0) },
            canStep: { canStep($0) },
            showInfo: { showInfo() },
            toggleLetters: { toggleLetters() }
        )
    }

    private func watchValue(_ frame: WatchFrame?, words: Wording) -> String {
        guard let frame else { return "" }
        if let info = frame.info, shownOverlay == .info { return FaceWords.infoSpeech(info, pure: words.pure) }
        return [frame.top.accessibilityLabel, frame.solarLabel, frame.bottom.accessibilityLabel].joined(separator: ". ")
    }

    /// What the watch face's gaps show now: info labels while they last, else the letters when kept or just changed.
    private var shownOverlay: WatchOverlay {
        if overlay.mode == .info { return .info }
        if settings.showLetters || overlay.mode == .letters { return .letters }
        return .none
    }

    // MARK: - The face menu

    @ToolbarContentBuilder
    private var faceMenu: some ToolbarContent {
        #if os(iOS)
        let placement = ToolbarItemPlacement.topBarLeading
        #else
        let placement = ToolbarItemPlacement.navigation
        #endif
        ToolbarItem(placement: placement) {
            Menu {
                Picker("Face", selection: Binding(get: { face }, set: { setFace($0) })) {
                    Label("Journal", systemImage: "text.line.first.and.arrowtriangle.forward").tag(AppSettings.FaceMode.journal)
                    Label("Watch", systemImage: "applewatch.watchface").tag(AppSettings.FaceMode.watch)
                }
                .pickerStyle(.inline)
                Section {
                    Button(face == .journal ? "Longer Unit" : "Longer Period", systemImage: "chevron.up") { step(-1) }
                        .disabled(!canStep(-1))
                        .keepsMenuOpen()
                    Button(face == .journal ? "Shorter Unit" : "Shorter Period", systemImage: "chevron.down") { step(1) }
                        .disabled(!canStep(1))
                        .keepsMenuOpen()
                }
                if face == .watch {
                    Section {
                        Button("Show Info Labels", systemImage: "info.circle") { showInfo() }
                        Toggle("Keep Period Letters", systemImage: "character", isOn: Binding(
                            get: { settings.showLetters }, set: { _ in toggleLetters() }))
                    }
                }
                Section {
                    Button("How to Read", systemImage: "questionmark.circle") { guideShown = true }
                }
            } label: {
                Label("Face", systemImage: "capsule.portrait")
            }
            .help("Choose the face and what it shows")
        }
    }

    // MARK: - Actions

    private func canStep(_ dir: Int) -> Bool {
        face == .journal ? FaceStepper.unit(unit, step: dir) != nil : FaceStepper.depth(depth, step: dir) != nil
    }

    /// −1 one unit (or depth) longer, +1 shorter, on the face that shows. `selected`: the same tap also selected a
    /// row's level, so a step that cannot happen is no refusal (helpers.js: no red pulse when a row was hit).
    private func step(_ dir: Int, selected: Bool = false) {
        stepDirection = dir
        let region: FaceRegion = dir < 0 ? .top : .bottom
        switch face {
        case .journal:
            guard let next = FaceStepper.unit(unit, step: dir) else { return refuse(region) }
            withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .smooth(duration: 0.42)) { setUnit(next) }
        case .watch:
            guard let next = FaceStepper.depth(depth, step: dir) else {
                guard selected else { return refuse(region) }
                pulse(region, refused: false)
                steps += 1
                return
            }
            withAnimation(.easeInOut(duration: 0.25)) { setDepth(next) }
        }
        pulse(region, refused: false)
        steps += 1
    }

    /// A period row's level becomes the level every view highlights (face.js `selectRow`); after a step the row stays
    /// on the face, under its plate.
    private func selectRow(_ row: WatchGeometry.Row) {
        let levels = WatchGeometry.levels(topDepth: depth)
        switch row {
        case .top: settings.selectedLevel = levels.top
        case .bottom: settings.selectedLevel = levels.bottom
        case .solar: break
        }
    }

    private func refuse(_ region: FaceRegion) {
        pulse(region, refused: true)
        if face == .journal { journalBounce += 1 } else { watchBounce += 1 }
        refusals += 1
        // what the web says in a toast (face.js `blockedMessage`), for VoiceOver
        let longer = region == .top
        let what = face == .journal ? (longer ? "Longest unit shown" : "Shortest units shown")
            : (longer ? "Longest period shown" : "Shortest periods shown")
        AccessibilityNotification.Announcement(what).post()
    }

    private func pulse(_ region: FaceRegion, refused: Bool) {
        if face == .journal {
            journalFlash = FaceFlash(id: journalFlash.id + 1, region: region, refused: refused)
        } else {
            watchFlash = FaceFlash(id: watchFlash.id + 1, region: region, refused: refused)
        }
    }

    private func setUnit(_ u: Int) {
        launch.unit = nil
        settings.journalUnit = u
        // the unit's level becomes the level the other views highlight (face.js `ctx.select`)
        settings.selectedLevel = Journal.units[u].level
    }

    private func setDepth(_ d: Int) {
        launch.depth = nil
        settings.topDepth = d
        lastMiddleTap = nil
        orientLetters()
    }

    private func setFace(_ new: AppSettings.FaceMode) {
        guard new != face else { return }
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.45, bounce: 0.12)) {
            launch.face = nil
            settings.faceMode = new
        }
        steps += 1
    }

    /// A rail pick: the journal window starting at unit index `i`.
    private func selectUnit(_ i: Int) {
        let next = FaceStepper.unit(startingAt: i)
        guard next != FaceStepper.clampUnit(unit) else { return }
        stepDirection = next < unit ? -1 : 1
        withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .smooth(duration: 0.42)) { setUnit(next) }
        steps += 1
    }

    /// A rail pick: the watch with depth `d` on top (or as the lower period, for the last one).
    private func selectDepth(_ d: Int) {
        let next = FaceStepper.depth(showing: d == 12 ? 11 : d)
        guard next != FaceStepper.clampDepth(depth) else { return }
        stepDirection = next < depth ? -1 : 1
        withAnimation(.easeInOut(duration: 0.25)) { setDepth(next) }
        steps += 1
    }

    private func journalTap(_ p: CGPoint) {
        guard let dir = JournalGeometry.region(at: p)?.step else { return }
        step(dir)
    }

    /// SPEC §10: top longer, bottom shorter, middle the info labels; a second middle tap within 0.4 s toggles the
    /// letters. A tap on a period row also selects its level (face.js `onTap`).
    private func watchTap(_ p: CGPoint) {
        guard let region = WatchGeometry.region(at: p) else { return }
        if let dir = region.step {
            lastMiddleTap = nil
            let row = WatchGeometry.row(at: p).flatMap { $0 == .solar ? nil : $0 }
            if let row { selectRow(row) }
            return step(dir, selected: row != nil)
        }
        let tap = MiddleTap.resolve(previous: lastMiddleTap, now: ProcessInfo.processInfo.systemUptime)
        lastMiddleTap = tap.remember
        switch tap.action {
        case .info: showInfo()
        case .letters: toggleLetters()
        }
    }

    /// The info labels for about 4 s (SPEC §10); VoiceOver hears them.
    private func showInfo() {
        launch.overlay = nil
        withAnimation(.easeInOut(duration: 0.2)) {
            overlay = TransientOverlay(mode: .info, until: .now + 4, id: overlay.id + 1)
        }
        let words = settings.wording
        if let info = WatchFrame.make(at: launch.time ?? store.time(), topDepth: depth, words: words, info: true)?.info {
            AccessibilityNotification.Announcement(FaceWords.infoSpeech(info, pure: words.pure)).post()
        }
    }

    private func toggleLetters() {
        withAnimation(.easeInOut(duration: 0.2)) {
            overlay = TransientOverlay(id: overlay.id + 1)
            settings.showLetters.toggle()
        }
    }

    /// The letters for a moment after the watch face appears or changes depth (a short orientation).
    private func orientLetters() {
        if let hook = launch.overlay {
            overlay = TransientOverlay(mode: hook, until: nil, id: overlay.id + 1)
            return
        }
        guard overlay.mode != .info else { return }
        withAnimation(.easeInOut(duration: 0.2)) {
            overlay = TransientOverlay(mode: .letters, until: .now + 4, id: overlay.id + 1)
        }
    }

    private func adjust(_ direction: AccessibilityAdjustmentDirection) {
        switch direction {
        case .increment: step(-1)
        case .decrement: step(1)
        @unknown default: break
        }
    }

    private func keyPressed(_ key: KeyEquivalent) -> KeyPress.Result {
        switch key {
        case .upArrow: step(-1)
        case .downArrow: step(1)
        case .leftArrow: setFace(.journal)
        case .rightArrow: setFace(.watch)
        case "i" where face == .watch: showInfo()
        case "l" where face == .watch: toggleLetters()
        default: return .ignored
        }
        return .handled
    }
}

extension View {
    /// A menu item that leaves its menu open (to step several times in a row); macOS menus always close.
    @ViewBuilder
    fileprivate func keepsMenuOpen() -> some View {
        #if os(iOS)
        menuActionDismissBehavior(.disabled)
        #else
        self
        #endif
    }
}

/// The watch face's passing overlay: the letters after a change, the info labels after a tap. `until` nil keeps it
/// (the `-FXFaceOverlay` hook).
struct TransientOverlay: Equatable {
    var mode: WatchOverlay = .none
    var until: Date?
    var id = 0
}

/// One face centred in its page with its rail beside it (and the rail's width of space on the other side, so the
/// face stays centred).
private struct FacePage<Face: View, Rail: View>: View {
    let layout: NowLayout
    @ViewBuilder let face: Face
    @ViewBuilder let rail: Rail

    var body: some View {
        GeometryReader { geo in
            let size = layout.faceSize(in: geo.size)
            HStack(spacing: layout.railGap) {
                Color.clear.frame(width: layout.railWidth, height: 1)
                face.frame(width: size.width, height: size.height)
                rail.frame(width: layout.railWidth)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

/// The Now screen's proportions for a size: compact (face over the turnover line) or wide (face beside readings).
struct NowLayout: Equatable {
    let size: CGSize

    /// Room for the rail of letters on each side of the face.
    var railWidth: CGFloat { 28 * railScale }
    var railGap: CGFloat { 14 * railScale }
    /// A tall face (a big iPad) gets a larger rail and readings, so neither looks lost beside it.
    var roomy: Bool { size.height >= 900 && size.width >= 700 }
    var railScale: CGFloat { roomy ? 1.3 : 1 }
    /// The face never grows past this height (a 13-inch iPad would make it a wall).
    let maxFaceHeight: CGFloat = 860
    /// Below the face on wide layouts: the page dots.
    let dotsHeight: CGFloat = 30

    /// Wide enough for a column of readings beside the face.
    var wide: Bool { size.width >= 640 && size.width >= size.height * 0.7 }

    var verticalPadding: CGFloat { size.height > 500 ? 28 : 10 }
    var gap: CGFloat { size.width > 900 ? 64 : 32 }

    /// The face's size inside a page of `page` points: as tall as fits, never wider than the page leaves.
    func faceSize(in page: CGSize) -> CGSize {
        let maxWidth = max(0, page.width - 2 * (railWidth + railGap))
        let height = max(0, min(page.height, maxFaceHeight, maxWidth / FaceSpace.aspectRatio))
        return CGSize(width: height * FaceSpace.aspectRatio, height: height)
    }

    /// Wide layouts: the face's height, as tall as the space allows.
    var wideFaceHeight: CGFloat {
        max(0, min(size.height - 2 * verticalPadding - dotsHeight, maxFaceHeight))
    }

    /// Wide layouts: the width of the face's column (face and rails).
    var faceAreaWidth: CGFloat { wideFaceHeight * FaceSpace.aspectRatio + 2 * (railWidth + railGap) }

    /// Wide layouts: the readings column, as wide as its longest line wants and the space allows.
    var panelWidth: CGFloat { max(200, min(roomy ? 460 : 360, size.width - faceAreaWidth - 2 * gap)) }
}
