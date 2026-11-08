import FractonicaKit
import SwiftUI

/// One kept date in a list: its emoji, title, when, and its badges — the Saros series of its nearest eclipse and the
/// rarity that gives — and a bell when it has echoes.
struct DateRow: View {
    let date: SavedDate
    let words: DateWords

    var body: some View {
        let nearest = SarosSearch.matches(date.query, count: 1).first
        HStack(spacing: 12) {
            DateEmoji(emoji: date.emoji, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(date.title.isEmpty ? "Untitled date" : date.title)
                        .font(.reading(17, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    if !date.echoes.isEmpty {
                        Image(systemName: "bell.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(Theme.gold)
                            .accessibilityLabel("With echoes")
                    }
                }
                Text(words.when(date))
                    .font(.code(12))
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let nearest {
                    HStack(spacing: 6) {
                        SarosBadge(series: nearest.eclipse.series, compact: true)
                        RarityBadge(rarity: nearest.rarity, compact: true)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// A date's emoji in its disc (a calendar when it has none).
struct DateEmoji: View {
    let emoji: String?
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(Theme.panel3)
            Circle().stroke(Theme.line2, lineWidth: 1)
            if let emoji {
                Text(verbatim: emoji).font(.system(size: size * 0.54))
            } else {
                Image(systemName: "calendar")
                    .font(.system(size: size * 0.38, weight: .medium))
                    .foregroundStyle(Theme.teal)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Every kept date: a list (searchable, swipe to delete) or the wave — the journal's wave, the dates' emoji on it at
/// their moments, pinch to zoom from Preons to Betas. Cycles › Saros › the dates; `-FXSarosDates list|wave`.
struct DatesScreen: View {
    enum Mode: String, CaseIterable, Identifiable {
        case list, wave
        var id: String { rawValue }
    }

    @Environment(AppSettings.self) private var settings
    @State private var book = DateBook.shared
    @State var mode: Mode
    @State private var query = ""
    @State private var opened: DateRoute?
    @State private var editing: SavedDate?

    var body: some View {
        let words = settings.wording
        Group {
            switch mode {
            case .list: list(DateWords(pure: words.pure, notation: words.notation))
            case .wave:
                JournalWaveView(records: book.records, revision: book.revision, model: .dates) { id in opened = DateRoute(id: id) }
                    .ignoresSafeArea(edges: .bottom)
            }
        }
        .background { Backdrop() }
        .navigationTitle("Dates")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Picker("Show", selection: $mode) {
                    Label("List", systemImage: "list.bullet").tag(Mode.list)
                    Label("Wave", systemImage: "water.waves").tag(Mode.wave)
                }
                .pickerStyle(.segmented)
                .labelStyle(.iconOnly)
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Add Date", systemImage: "plus") { editing = DateEditor.blank() }
            }
        }
        .navigationDestination(item: $opened) { DateDetailScreen(id: $0.id) }
        .sheet(item: $editing) { DateEditor(date: $0, isNew: true) }
    }

    private func list(_ words: DateWords) -> some View {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        let dates = book.dates.reversed().filter { q.isEmpty || $0.title.lowercased().contains(q) || $0.text.lowercased().contains(q) || ($0.emoji ?? "") == q }
        return List {
            if book.dates.isEmpty {
                ContentUnavailableView {
                    Label("No dates yet", systemImage: "calendar.badge.plus")
                } description: {
                    Text("Keep a birthday, a wedding or a launch: each shows the Saros series of its nearest eclipse and its rarity, and can send echoes.")
                } actions: {
                    Button("Add Date") { editing = DateEditor.blank() }
                }
                .listRowBackground(Color.clear)
            }
            ForEach(dates) { date in
                NavigationLink(value: DateRoute(id: date.id)) {
                    DateRow(date: date, words: words)
                }
                .swipeActions {
                    Button("Delete", systemImage: "trash", role: .destructive) { book.delete(date.id) }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .searchable(text: $query, prompt: "Search dates")
        .navigationDestination(for: DateRoute.self) { DateDetailScreen(id: $0.id) }
    }
}

/// A date to open.
struct DateRoute: Hashable, Identifiable {
    let id: String
}
