import FractonicaKit
import SwiftUI

/// Journal: the journaling home. Entries newest first, grouped by Helion — the Fractonica unit that numbers like the day
/// of a month — each a post card (emoji, title, Markdown excerpt, media, the Fractonica stamp and the Earth time).
/// Search (keywords; semantic when the sync layer offers it), records of other kinds on demand, pull to refresh (the
/// sync layer's hook), swipe or hold a card to edit or delete. The composer opens from the toolbar (⌘N), and the
/// printable Diary from the menu.
///
/// Two ways to move through time. The stack zooms: pinch out (or the menu, ⌘−) and the days collapse into blocks of
/// Deltas, then Gammas, then Betas, each with its count, emoji and pictures; pinch in or tap a block to go back down.
/// The wave (the toolbar's switch) shows the entries' emoji on the clock's arcs and loops, zoomable from Preons to Betas.
struct JournalScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var store = JournalStore.shared
    @State private var prefs = JournalPreferences.shared
    @State private var ui = JournalUI.shared
    @State private var browsing = JournalBrowsing.shared
    @State private var feed = JournalFeed()
    @State private var query = JournalLaunch.string("FXJournalSearch") ?? ""
    @State private var results: [String]?
    @State private var deleting: HubRecord?
    @State private var opened: JournalRoute?
    @State private var launched = false

    // the stack's zoom
    @State private var pinch: JournalPinch?
    @State private var lean = 1.0
    @State private var leanAnchor = UnitPoint.center
    /// +1 when the last zoom went out (to bigger periods), −1 when it went in: which way the levels fly.
    @State private var zoomDirection = 1
    @State private var indicatorShown = false
    @State private var indicatorTask: Task<Void, Never>?
    @State private var scrollTarget: JournalScrollTarget?
    @State private var stackSize = CGSize(width: 390, height: 700)
    @State private var visibility = JournalVisibility()

    var body: some View {
        let words = settings.wording
        content(words)
            .navigationTitle(Screen.journal.title)
            .searchable(text: $query, placement: searchPlacement, prompt: Text("Search entries"))
            .refreshable { await JournalHooks.refresh?() }
            .toolbar { toolbar }
            .background { zoomShortcuts }
            .navigationDestination(item: $opened) { route in
                JournalRecordView(id: route.id)
            }
            .sheet(item: $ui.composer) { request in
                ComposerSheet(request: request)
            }
            .confirmationDialog("Delete this entry?", isPresented: deletingBinding, titleVisibility: .visible, presenting: deleting) { record in
                Button("Delete Entry", role: .destructive) {
                    withAnimation { store.delete(record.id) }
                    Haptics.play(.warning)
                }
            } message: { _ in
                Text("Its photos, videos and voice notes are deleted with it.")
            }
            .onChange(of: feedKey, initial: true) { feed.update(store: store, includeOthers: prefs.showsOtherKinds) }
            .task(id: "\(feed.revision)|\(query)") { await search() }
            .onChange(of: store.isLoaded, initial: true) { applyLaunchOptions() }
            .onChange(of: browsing.mode) { old, new in modeChanged(from: old, to: new) }
            .onAppear {
                JournalWaveModel.shared.open = { id in opened = JournalRoute(id: id) }
                JournalWaveHitches.startIfAsked(browsing.mode == .wave ? JournalWaveModel.shared : nil)
            }
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ words: Wording) -> some View {
        if !store.isLoaded {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if feed.days.isEmpty {
            JournalEmptyState { ui.compose() }
        } else if let results {
            List {
                resultsSection(results, words)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .environment(\.defaultMinListRowHeight, 1)
        } else if browsing.mode == .wave {
            JournalWaveView(records: feed.list, revision: feed.revision) { id in opened = JournalRoute(id: id) }
                .transition(.opacity)
        } else {
            stack(words)
                .transition(.opacity)
        }
    }

    /// The stack at its zoom: the days' cards, or the blocks of bigger periods. It leans into a pinch and steps a level
    /// each time the fingers close or open far enough; the levels fly past each other with the step.
    private func stack(_ words: Wording) -> some View {
        ScrollViewReader { proxy in
            ZStack {
                Group {
                    if browsing.zoom == .helion {
                        dayList(words)
                    } else {
                        JournalBlockList(zoom: browsing.zoom, sections: feed.sections(browsing.zoom), words: words, visibility: visibility,
                                         open: { period, point in zoomInto(period, at: point) },
                                         showInWave: { period in showOnWave(period) })
                    }
                }
                .id(browsing.zoom)
                .transition(zoomTransition)
            }
            .scaleEffect(lean, anchor: leanAnchor)
            .onChange(of: scrollTarget) { _, target in
                guard let target else { return }
                // after the new level has laid out
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(20))
                    proxy.scrollTo(target.id, anchor: target.anchor)
                }
            }
        }
        .coordinateSpace(.named(JournalStackSpace.name))
        .onGeometryChange(for: CGSize.self) { $0.size } action: { stackSize = $0 }
        .simultaneousGesture(stackPinch)
        .overlay(alignment: .top) {
            if indicatorShown {
                JournalZoomIndicator(zoom: browsing.zoom)
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
    }

    /// The days: each Helion's header, then its entries' cards.
    private func dayList(_ words: Wording) -> some View {
        List {
            // the day headers are rows, not pinned section headers: a journal reads as one flowing page
            ForEach(feed.days) { day in
                Section {
                    JournalDayHeader(day: day, words: words)
                        .readableColumn()
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(top: day.id == feed.days.first?.id ? 4 : 18, leading: 20, bottom: 2, trailing: 20))
                        .id(day.id)
                        .onAppear { visibility.appear(day.id, time: day.start) }
                        .onDisappear { visibility.disappear(day.id) }
                    ForEach(day.ids, id: \.self) { id in
                        if let record = feed.records[id] {
                            row(record, words)
                                .onAppear { visibility.appear(id, time: record.time) }
                                .onDisappear { visibility.disappear(id) }
                        }
                    }
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 1)
        .animation(.default, value: feed.revision)
    }

    // MARK: Zoom

    /// Levels fly past each other: zooming out, the finer page shrinks away as the bigger blocks settle from a little
    /// larger; zooming in, the reverse. Reduce Motion: a cross-fade.
    private var zoomTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        let out = zoomDirection > 0
        return .asymmetric(
            insertion: .scale(scale: out ? 1.14 : 0.86, anchor: leanAnchor).combined(with: .opacity),
            removal: .scale(scale: out ? 0.86 : 1.14, anchor: leanAnchor).combined(with: .opacity)
        )
    }

    private var stackPinch: some Gesture {
        MagnifyGesture(minimumScaleDelta: 0.01)
            .onChanged { value in
                if pinch == nil {
                    pinch = JournalPinch()
                    leanAnchor = value.startAnchor
                    showIndicator(hold: true)
                }
                guard var p = pinch else { return }
                let step = p.step(value.magnification)
                if step != 0 {
                    if let next = JournalPinch.apply(step, to: browsing.zoom) {
                        setZoom(next, anchor: value.startAnchor, target: target(for: next, around: visibility.anchorTime))
                    } else {
                        Haptics.play(.warning)
                    }
                }
                pinch = p
                if !reduceMotion { lean = p.lean(value.magnification) }
            }
            .onEnded { _ in
                pinch = nil
                withAnimation(.spring(duration: 0.35, bounce: 0.25)) { lean = 1 }
                showIndicator(hold: false)
            }
    }

    /// Change the stack's zoom: the direction first (so both levels' transitions know it), then the level, animated,
    /// then the place to scroll to in it.
    private func setZoom(_ next: JournalZoom, anchor: UnitPoint = .center, target: JournalScrollTarget?) {
        guard next != browsing.zoom else { return }
        Haptics.play(.step)
        zoomDirection = next > browsing.zoom ? 1 : -1
        leanAnchor = anchor
        Task { @MainActor in
            withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.45, bounce: 0.14)) {
                browsing.zoom = next
            }
            scrollTarget = target
        }
        if pinch == nil { showIndicator(hold: false) }
    }

    /// One level out (+1) or in (−1), keeping the middle of what is in sight.
    private func stepZoom(_ step: Int) {
        guard let next = JournalPinch.apply(step, to: browsing.zoom) else { return }
        setZoom(next, target: target(for: next, around: visibility.anchorTime))
    }

    /// Tap a block: its period at the next level down, scrolled to it.
    private func zoomInto(_ period: JournalPeriod, at point: CGPoint?) {
        guard let finer = browsing.zoom.finer else { return }
        let anchor = point.map { UnitPoint(x: $0.x / max(1, stackSize.width), y: $0.y / max(1, stackSize.height)) } ?? .center
        let target: JournalScrollTarget?
        if finer == .helion {
            // its newest day
            target = feed.days.first { period.contains($0.start + 1) || period.contains($0.end - 1) }
                .map { JournalScrollTarget(id: $0.id, anchor: .top) }
        } else if let cycle = period.cycle {
            target = JournalScrollTarget(id: "s" + JournalPeriod.id(level: period.level, cycle: cycle), anchor: .top)
        } else {
            target = nil
        }
        setZoom(finer, anchor: anchor, target: target)
    }

    /// Where to scroll at a new zoom to keep moment t in sight: its day (Helions) or its block.
    private func target(for zoom: JournalZoom, around t: Double?) -> JournalScrollTarget? {
        guard let t else { return nil }
        if zoom == .helion {
            let days = feed.days.map { JournalPeriod(id: $0.id, level: 6, cycle: $0.cycle, start: $0.start, end: $0.end, ids: $0.ids) }
            return JournalPeriods.index(of: t, in: days).map { JournalScrollTarget(id: days[$0].id, anchor: .top) }
        }
        let periods = feed.sections(zoom).flatMap(\.periods)
        return JournalPeriods.index(of: t, in: periods).map { JournalScrollTarget(id: periods[$0].id, anchor: .center) }
    }

    /// The zoom indicator: shown while pinching, then for a moment after.
    private func showIndicator(hold: Bool) {
        indicatorTask?.cancel()
        withAnimation(.easeOut(duration: 0.2)) { indicatorShown = true }
        guard !hold else { return }
        indicatorTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.6))
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.3)) { indicatorShown = false }
        }
    }

    /// A block's "Show on the Wave": the wave, fitted to the period.
    private func showOnWave(_ period: JournalPeriod) {
        JournalWaveModel.shared.reveal(period.start, period.end)
        withAnimation { browsing.mode = .wave }
    }

    /// Switching to the wave shows what the stack showed; back to the stack, its place is kept.
    private func modeChanged(from old: JournalBrowsing.Mode, to new: JournalBrowsing.Mode) {
        Haptics.play(.selection)
        if new == .wave, old == .stack, let t = visibility.anchorTime {
            JournalWaveModel.shared.reveal(t)
        }
    }

    /// ⌘= and ⌘− zoom the stack or the wave; out of sight.
    private var zoomShortcuts: some View {
        ZStack {
            Button("Zoom In") { zoom(in: true) }
                .keyboardShortcut("=", modifiers: .command)
            Button("Zoom Out") { zoom(in: false) }
                .keyboardShortcut("-", modifiers: .command)
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func zoom(in closer: Bool) {
        guard results == nil else { return }
        if browsing.mode == .wave {
            JournalWaveModel.shared.zoom(by: closer ? 2 : 0.5)
        } else {
            stepZoom(closer ? -1 : 1)
        }
    }

    @ViewBuilder
    private func resultsSection(_ ids: [String], _ words: Wording) -> some View {
        Section {
            if ids.isEmpty {
                Text("No entries match “\(query)”.")
                    .font(.callout)
                    .foregroundStyle(Theme.ink3)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 40)
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
            }
            ForEach(ids, id: \.self) { id in
                if let record = feed.records[id] { row(record, words) }
            }
        } header: {
            Text(ids.count == 1 ? "1 entry" : "\(ids.count) entries")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.ink3)
        }
    }

    @ViewBuilder
    private func row(_ record: HubRecord, _ words: Wording) -> some View {
        Group {
            if record.kind == JournalEntry.kind {
                Button { opened = JournalRoute(id: record.id) } label: {
                    JournalCard(record: record, words: words, fullStamp: results != nil)
                }
                .buttonStyle(.plain)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) { deleting = record } label: { Label("Delete", systemImage: "trash") }
                }
                .swipeActions(edge: .leading) {
                    Button { ui.edit(record.id) } label: { Label("Edit", systemImage: "pencil") }
                        .tint(Theme.teal)
                }
                .contextMenu {
                    Button("Edit", systemImage: "pencil") { ui.edit(record.id) }
                    Button("Delete", systemImage: "trash", role: .destructive) { deleting = record }
                }
            } else {
                Button { opened = JournalRoute(id: record.id) } label: {
                    GenericRecordRow(record: record, words: words)
                }
                .buttonStyle(.plain)
            }
        }
        .listRowBackground(Color.clear)
        .listRowSeparator(.hidden)
        .readableColumn()
        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if !router.isCompact {
            // iPad and Mac: the switch in plain sight (iPhone has it first in the menu, the bar being full)
            ToolbarItem(placement: .primaryAction) {
                Picker("View", selection: $browsing.mode) {
                    ForEach(JournalBrowsing.Mode.allCases) { mode in
                        Label(mode.title, systemImage: mode.systemImage).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .fixedSize()
                .help("Show the journal as a stack of entries or on the wave")
            }
        }
        ToolbarItem(placement: .primaryAction) {
            Button { ui.compose() } label: {
                Label("New Entry", systemImage: "square.and.pencil")
            }
            .help("New entry (⌘N)")
            .composeButtonStyle()
        }
        ToolbarItem(placement: secondaryPlacement) {
            Menu {
                Picker(selection: $browsing.mode) {
                    ForEach(JournalBrowsing.Mode.allCases) { mode in
                        Label(mode.title, systemImage: mode.systemImage).tag(mode)
                    }
                } label: {
                    Text("View")
                }
                .pickerStyle(.inline)
                if browsing.mode == .stack {
                    Section("Zoom") {
                        Picker(selection: zoomChoice) {
                            ForEach(JournalZoom.allCases) { zoom in
                                Text(zoom.title).tag(zoom)
                            }
                        } label: {
                            Text("Zoom")
                        }
                        .pickerStyle(.inline)
                        Button("Zoom In", systemImage: "plus.magnifyingglass") { stepZoom(-1) }
                            .disabled(browsing.zoom.finer == nil)
                        Button("Zoom Out", systemImage: "minus.magnifyingglass") { stepZoom(1) }
                            .disabled(browsing.zoom.coarser == nil)
                    }
                } else {
                    Section("Wave") {
                        Button("Go to Now", systemImage: "arrow.up.to.line") { JournalWaveModel.shared.goTo(Date.now.timeIntervalSince1970) }
                        ForEach(Self.wavePresets, id: \.level) { preset in
                            Button(preset.title) { JournalWaveModel.shared.fit(level: preset.level) }
                        }
                    }
                }
                Divider()
                Toggle(isOn: $prefs.showsOtherKinds) {
                    Label("Records from Other Sources", systemImage: "tray.full")
                }
                Divider()
                Button("Print Diary…", systemImage: Screen.diary.systemImage) { router.show(.diary) }
            } label: {
                Label("Options", systemImage: optionsSymbol)
            }
            .help("Stack or wave, zoom, records from other sources, print the diary")
        }
    }

    /// iPhone's menu shows the view it switches; iPad and Mac the filter.
    private var optionsSymbol: String {
        if router.isCompact {
            return browsing.mode == .wave ? "water.waves" : prefs.showsOtherKinds ? "rectangle.stack.fill" : "rectangle.stack"
        }
        return prefs.showsOtherKinds ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"
    }

    /// The wave's zoom presets: about one and a half of each unit on the screen.
    private static let wavePresets: [(level: Int, title: String)] = [
        (8, "Preons (ι)"), (6, "Helions (η)"), (4, "Nuclides (ε)"), (3, "Deltas (δ)"), (2, "Gammas (γ)"), (1, "Betas (β)"),
    ]

    private var zoomChoice: Binding<JournalZoom> {
        Binding(get: { browsing.zoom }, set: { zoom in setZoom(zoom, target: target(for: zoom, around: visibility.anchorTime)) })
    }

    private var secondaryPlacement: ToolbarItemPlacement {
        #if os(iOS)
        router.isCompact ? .topBarLeading : .secondaryAction
        #else
        .secondaryAction
        #endif
    }

    private var searchPlacement: SearchFieldPlacement {
        #if os(iOS)
        .navigationBarDrawer(displayMode: .automatic)
        #else
        .automatic
        #endif
    }

    // MARK: Search

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            results = nil
            return
        }
        let pool = Array(feed.records.values)
        let keyword = JournalRanking.keyword(pool, query: text)
        results = JournalRanking.merge(keyword: keyword, semantic: nil, known: Set(feed.records.keys))
        guard let semantic = JournalSearch.semantic else { return }
        try? await Task.sleep(for: .milliseconds(300))
        guard !Task.isCancelled else { return }
        let scores = await semantic(text)
        guard !Task.isCancelled else { return }
        results = JournalRanking.merge(keyword: keyword, semantic: scores, known: Set(feed.records.keys))
    }

    // MARK: Helpers

    private var feedKey: [Int] { [store.revision, prefs.showsOtherKinds ? 1 : 0] }

    private var deletingBinding: Binding<Bool> {
        Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
    }

    private func applyLaunchOptions() {
        guard store.isLoaded, !launched else { return }
        launched = true
        if let n = JournalLaunch.int("FXJournalDetail"), store.entries.indices.contains(n) {
            opened = JournalRoute(id: store.entries[n].id)
        }
        if let compose = JournalLaunch.string("FXJournalCompose"), compose != "0" {
            if compose == "edit", let first = store.entries.first { ui.edit(first.id) } else { ui.compose() }
        }
    }
}

/// A record pushed from the timeline.
struct JournalRoute: Hashable, Identifiable {
    let id: String
}

/// The timeline's derived lists, rebuilt when the store or the filter changes (not on every redraw).
@MainActor @Observable
final class JournalFeed {
    private(set) var days: [JournalDay] = []
    private(set) var records: [String: HubRecord] = [:]
    /// Every record shown, newest first.
    private(set) var list: [HubRecord] = []
    private(set) var revision = 0
    /// The zoomed-out stack's blocks by zoom, made when first asked for.
    @ObservationIgnored private var blocks: [JournalZoom: [JournalPeriodSection]] = [:]

    func update(store: JournalStore, includeOthers: Bool) {
        let list = includeOthers ? (store.entries + store.otherRecords).sorted(by: JournalStore.newestFirst) : store.entries
        self.list = list
        records = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        days = JournalDays.group(list)
        blocks = [:]
        revision += 1
    }

    /// The blocks of a zoom under their parent periods (empty for Helions, which are the days).
    func sections(_ zoom: JournalZoom) -> [JournalPeriodSection] {
        guard let parent = zoom.sectionLevel else { return [] }
        if let cached = blocks[zoom] { return cached }
        let sections = JournalPeriods.sections(JournalPeriods.group(list, level: zoom.level), level: parent)
        blocks[zoom] = sections
        return sections
    }
}

/// Where the stack scrolls after its zoom changed.
struct JournalScrollTarget: Equatable {
    let id: String
    let anchor: UnitPoint
    /// Each request scrolls, even to the same place again.
    var token = UUID()
}

// MARK: - Parts

/// A Helion's header: "34η" with its Nuclide and Delta, and the Earth day and hours (not in pure mode).
struct JournalDayHeader: View {
    let day: JournalDay
    let words: Wording

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            if let names = day.names(notation: words.notation) {
                Text(verbatim: names.helion)
                    .font(.reading(22, weight: .semibold))
                    .foregroundStyle(Theme.teal)
                    .frame(minWidth: 44, alignment: .leading)
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: "\(names.nuclide) · \(names.delta)")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink2)
                    if !words.pure {
                        Text(verbatim: earthDay)
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Outside the catalogue")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink2)
                    if !words.pure {
                        Text(verbatim: earthDay).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .textCase(nil)
        .accessibilityElement(children: .combine)
    }

    private var earthDay: String {
        let p = words.earth.parts(day.start)
        let date = "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1])"
        guard day.cycle != nil else { return date }
        return "\(date) · \(words.earth.time(day.start, seconds: false))–\(words.earth.time(day.end, seconds: false))"
    }
}

/// The invitation to write the first entry.
struct JournalEmptyState: View {
    let compose: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle().fill(Theme.teal.opacity(0.12)).frame(width: 112, height: 112)
                Circle().stroke(Theme.teal.opacity(0.35), lineWidth: 1).frame(width: 112, height: 112)
                Text(verbatim: "🌙").font(.system(size: 52))
            }
            VStack(spacing: 8) {
                Text("Your journal starts here")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Text("Write a thought, add photos and videos, or just talk. Every entry is stamped with its Fractonica moment and kept on this device.")
                    .font(.callout)
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 340)
            }
            Button(action: compose) {
                Label("New Entry", systemImage: "square.and.pencil")
                    .font(.headline)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
            }
            .glassProminentButtonStyle()
            .buttonBorderShape(.capsule)
            .controlSize(.large)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

extension View {
    /// The timeline's column: full width on iPhone, a readable 720 points centred on iPad and Mac.
    func readableColumn() -> some View {
        frame(maxWidth: 720).frame(maxWidth: .infinity)
    }

    /// The compose button prominent in Liquid Glass (iOS 26, Mac); the standard bar button on iOS 18.
    @ViewBuilder
    func composeButtonStyle() -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            buttonStyle(.glassProminent).tint(Theme.teal)
        } else {
            self
        }
    }
}
