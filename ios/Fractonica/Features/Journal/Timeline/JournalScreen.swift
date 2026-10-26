import FractonicaKit
import SwiftUI

/// Journal: the journaling home. Entries newest first, grouped by Helion — the Fractonica unit that numbers like the day
/// of a month — each a post card (emoji, title, Markdown excerpt, media, the Fractonica stamp and the Earth time).
/// Search (keywords; semantic when the sync layer offers it), records of other kinds on demand, pull to refresh (the
/// sync layer's hook), swipe or hold a card to edit or delete. The composer opens from the toolbar (⌘N), and the
/// printable Diary from the menu.
struct JournalScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router

    @State private var store = JournalStore.shared
    @State private var prefs = JournalPreferences.shared
    @State private var ui = JournalUI.shared
    @State private var feed = JournalFeed()
    @State private var query = JournalLaunch.string("FXJournalSearch") ?? ""
    @State private var results: [String]?
    @State private var deleting: HubRecord?
    @State private var opened: JournalRoute?
    @State private var launched = false

    var body: some View {
        let words = settings.wording
        content(words)
            .navigationTitle(Screen.journal.title)
            .searchable(text: $query, placement: searchPlacement, prompt: Text("Search entries"))
            .refreshable { await JournalHooks.refresh?() }
            .toolbar { toolbar }
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
    }

    // MARK: Content

    @ViewBuilder
    private func content(_ words: Wording) -> some View {
        if !store.isLoaded {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if feed.days.isEmpty {
            JournalEmptyState { ui.compose() }
        } else {
            List {
                if let results {
                    resultsSection(results, words)
                } else {
                    // the day headers are rows, not pinned section headers: a journal reads as one flowing page
                    ForEach(feed.days) { day in
                        Section {
                            JournalDayHeader(day: day, words: words)
                                .listRowBackground(Color.clear)
                                .listRowSeparator(.hidden)
                                .listRowInsets(EdgeInsets(top: day.id == feed.days.first?.id ? 4 : 18, leading: 20, bottom: 2, trailing: 20))
                            ForEach(day.ids, id: \.self) { id in
                                if let record = feed.records[id] { row(record, words) }
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
        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button { ui.compose() } label: {
                Label("New Entry", systemImage: "square.and.pencil")
            }
            .help("New entry (⌘N)")
            .composeButtonStyle()
        }
        ToolbarItem(placement: secondaryPlacement) {
            Menu {
                Toggle(isOn: $prefs.showsOtherKinds) {
                    Label("Records from Other Sources", systemImage: "tray.full")
                }
                Divider()
                Button("Print Diary…", systemImage: Screen.diary.systemImage) { router.show(.diary) }
            } label: {
                Label("Options", systemImage: prefs.showsOtherKinds ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
            }
            .help("Show records from other sources, print the diary")
        }
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
    private(set) var revision = 0

    func update(store: JournalStore, includeOthers: Bool) {
        let list = includeOthers ? (store.entries + store.otherRecords).sorted(by: JournalStore.newestFirst) : store.entries
        records = Dictionary(list.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        days = JournalDays.group(list)
        revision += 1
    }
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
