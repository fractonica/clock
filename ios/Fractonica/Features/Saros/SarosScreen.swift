import FractonicaKit
import SwiftUI

/// Cycles › Saros: the Saros search (the eclipses nearest a date, and how rare the date is), the dates the person
/// keeps (with their nearest eclipse's series and rarity, on a list or the wave, and their echoes), the Helions of the
/// clock's series on a 24-hour dial, and the catalogue — the 40 solar Saros series running now, each with its drift
/// against the civil day and its lap, the reference series (the one the clock runs on) ticked; a series opens its
/// eclipses (`SarosSeriesScreen`).
///
/// Launch arguments (with `-FXTab saros`): `-FXSarosSeries <n>` opens a series (with `-FXSarosEclipse <ordinal>` that
/// eclipse's map), `-FXSarosHelions 1` the Helion dial (of `-FXSarosSeries <n>`, else of the reference series),
/// `-FXSarosSearch <yyyy-mm-dd[Thh:mm]>` the search on that day (or moment, in the app's zone), `-FXSarosDates 1` the
/// dates (`list` or `wave`), `-FXSarosDate <n>` the n-th date (oldest first), `-FXSarosAddDate 1` the editor for a new
/// one; `-FXDatesSeed 1` adds sample dates to a store without any.
struct SarosScreen: View {
    @Environment(AppSettings.self) private var settings
    @State private var book = DateBook.shared
    @State private var order: Order = .number
    @State private var route: SarosRoute?
    @State private var editing: SavedDate?
    /// The launch arguments' route and editor are applied once a launch (a destination or sheet set before the view
    /// first appears is not presented).
    @MainActor private static var launched = false

    enum Order: String, CaseIterable, Identifiable {
        case number, drift, lap, next
        var id: String { rawValue }
        var title: String {
            switch self {
            case .number: "Number"
            case .drift: "Drift"
            case .lap: "Lap"
            case .next: "Next eclipse"
            }
        }
    }

    var body: some View {
        let words = SarosWords(words: settings.wording)
        let now = Date.now.timeIntervalSince1970
        let reference = ReferenceSaros.shared.series
        let rows = SarosCatalogue.all.compactMap { s in s.drift(at: now).map { (series: s, drift: $0) } }
        List {
            searchSection(now: now)
            datesSection(words: settings.wording)
            if let series = SarosCatalogue.series(reference) {
                Section {
                    NavigationLink {
                        HelionDialScreen(series: series)
                    } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Helions on the clock")
                                Text("When Saros \(reference)'s Helion nodes come on a 24-hour dial, by Pentad")
                                    .font(.caption)
                                    .foregroundStyle(Theme.ink3)
                            }
                        } icon: {
                            Image(systemName: "clock.arrow.circlepath").foregroundStyle(Theme.teal)
                        }
                    }
                }
            }
            Section {
                ForEach(sorted(rows, now: now), id: \.series.number) { row in
                    NavigationLink {
                        SarosSeriesScreen(series: row.series)
                    } label: {
                        SarosSeriesRow(series: row.series, drift: row.drift, words: words, now: now,
                                       isReference: row.series.number == reference)
                    }
                }
            } header: {
                HStack {
                    Text("\(rows.count) series running now")
                    Spacer()
                    Menu {
                        Picker("Sort series by", selection: $order) {
                            ForEach(Order.allCases) { Text($0.title).tag($0) }
                        }
                    } label: {
                        Label(order == .number ? "drift a sync · lap" : "by \(order.title.lowercased())", systemImage: "arrow.up.arrow.down")
                            .labelStyle(.titleAndIcon)
                            .font(.caption)
                    }
                    .accessibilityLabel("Sort series")
                }
            } footer: {
                Text(footer(rows.map(\.drift), words: words))
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle(Screen.saros.title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Add Date", systemImage: "plus") { editing = DateEditor.blank() }
                    .help("Keep a date")
            }
        }
        .navigationDestination(isPresented: Binding(get: { route != nil }, set: { if !$0 { route = nil } })) {
            if let route { destination(route) }
        }
        .sheet(item: $editing) { date in
            DateEditor(date: date, isNew: book.date(date.id) == nil)
        }
        .onChange(of: book.opened, initial: true) { _, id in
            guard let id else { return }
            book.opened = nil
            route = .date(id)
        }
        .onChange(of: book.drafted, initial: true) { _, date in
            guard let date else { return }
            book.drafted = nil
            editing = date
        }
        .task {
            // after the launch's first layouts (a screen replaced meanwhile has its task cancelled and leaves it)
            guard !Self.launched else { return }
            try? await Task.sleep(for: .milliseconds(700))
            guard !Task.isCancelled, !Self.launched else { return }
            Self.launched = true
            if let launch = SarosLaunch.route { route = launch }
            if JournalLaunch.flag("FXSarosAddDate") { editing = DateEditor.blank() }
            // -FXSarosDate <n>: once the store has loaded
            guard let n = JournalLaunch.int("FXSarosDate") else { return }
            await JournalStore.shared.load()
            if book.dates.indices.contains(n) { route = .date(book.dates[n].id) }
        }
    }

    @ViewBuilder
    private func destination(_ route: SarosRoute) -> some View {
        switch route {
        case .series(let series): SarosSeriesScreen(series: series)
        case .eclipse(let e): if let series = SarosCatalogue.anySeries(e.series) { EclipseMapScreen(series: series, ordinal: e.ordinal) }
        case .helions(let series): HelionDialScreen(series: series)
        case .search(let t, let hasTime): SarosSearchScreen(start: t, hasTime: hasTime)
        case .dates(let wave): DatesScreen(mode: wave ? .wave : .list)
        case .date(let id): DateDetailScreen(id: id)
        }
    }

    // MARK: Search

    private func searchSection(now: Double) -> some View {
        let zone = settings.timeZone
        let today = SarosSearch.matches(.day(containing: now, zone: zone), count: 1).first
        return Section {
            NavigationLink {
                SarosSearchScreen(start: now, hasTime: false)
            } label: {
                Label {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Search a date")
                        Text("The three eclipses nearest any day, of all 180 Saros series, and how rare the day is")
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                        if let today {
                            HStack(spacing: 6) {
                                Text("Today")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(Theme.ink2)
                                RarityBadge(rarity: today.rarity, compact: true)
                                Text("Saros \(today.eclipse.series)")
                                    .font(.code(11))
                                    .foregroundStyle(Theme.ink3)
                            }
                            .padding(.top, 2)
                        }
                    }
                } icon: {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.teal)
                }
            }
        }
    }

    // MARK: Dates

    private func datesSection(words: Wording) -> some View {
        let dates = book.dates
        let shown = dates.count <= 8 ? dates : Array(dates.suffix(6))
        let dateWords = DateWords(pure: words.pure, notation: words.notation)
        return Section {
            if dates.isEmpty {
                Button {
                    editing = DateEditor.blank()
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Keep a date")
                            Text("A birthday, a wedding, a launch: its Saros series, its rarity, and echoes when it comes round again")
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                        }
                    } icon: {
                        Image(systemName: "calendar.badge.plus").foregroundStyle(Theme.gold)
                    }
                }
            } else {
                ForEach(shown) { date in
                    NavigationLink {
                        DateDetailScreen(id: date.id)
                    } label: {
                        DateRow(date: date, words: dateWords)
                    }
                    .swipeActions {
                        Button("Delete", systemImage: "trash", role: .destructive) { book.delete(date.id) }
                    }
                }
                NavigationLink {
                    DatesScreen(mode: .list)
                } label: {
                    Label(dates.count > shown.count ? "All \(dates.count) dates, on the wave" : "On the wave", systemImage: "water.waves")
                }
            }
        } header: {
            Text(dates.isEmpty ? "Dates" : "Dates · \(dates.count)")
        }
    }

    private func sorted(_ rows: [(series: SarosSeries, drift: SarosDrift)], now: Double) -> [(series: SarosSeries, drift: SarosDrift)] {
        switch order {
        case .number: rows
        case .drift: rows.sorted { $0.drift.perSync > $1.drift.perSync }
        case .lap: rows.sorted { $0.drift.lapOrEstimate < $1.drift.lapOrEstimate }
        case .next: rows.sorted { ($0.series.neighbours(of: now).next?.time ?? .infinity) < ($1.series.neighbours(of: now).next?.time ?? .infinity) }
        }
    }

    private func footer(_ drifts: [SarosDrift], words: SarosWords) -> String {
        guard !drifts.isEmpty else { return "" }
        let mean = drifts.map(\.perSync).reduce(0, +) / Double(drifts.count)
        let lap = drifts.map(\.lapOrEstimate).reduce(0, +) / Double(drifts.count)
        let alpha = drifts.map(\.alpha).reduce(0, +) / Double(drifts.count)
        let meanText = words.pure ? words.words.notation.blinks(abs(mean)) : String(format: "%.3f s", abs(mean))
        let lapText = words.pure ? words.words.notation.duration(lap, parts: 2, at: drifts[0].at)
                                 : String(format: "%.1f years, an Alpha and %.1f", lap / SarosWords.year, (lap - alpha) / SarosWords.year)
        return "Each solar sync — 19 Helions, about 4 days — ends a few seconds before the 4 days are up, so the syncs come earlier and earlier in the day: a drift of −\(meanText) a sync on average now. The lap is how long until the sync comes back to the same time of day, a day earlier: \(lapText) on average, walking each series' real Saros intervals from now (≈ where the series ends first). The tick marks the series the clock runs on."
    }
}

/// Where the Saros screen goes at launch, or when a date is to be opened.
enum SarosRoute: Hashable, Identifiable {
    case series(SarosSeries)
    case eclipse(SarosEclipse)
    case helions(SarosSeries)
    case search(Double, hasTime: Bool)
    case dates(wave: Bool)
    case date(String)

    var id: Self { self }
}

/// One series: its number, the reference tick, its eclipses' span and kinds, its drift a sync and its lap (and how far
/// the lap runs past an Alpha), and the map of its next eclipse.
private struct SarosSeriesRow: View {
    let series: SarosSeries
    let drift: SarosDrift
    let words: SarosWords
    let now: Double
    let isReference: Bool

    var body: some View {
        HStack(spacing: 12) {
            if let next = series.neighbours(of: now).next {
                EclipseThumbnail(eclipse: next, side: 52)
            }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("Saros \(series.number)")
                        .font(.reading(17, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                    if isReference {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(Theme.teal)
                            .accessibilityLabel("The clock's series")
                    }
                    Spacer(minLength: 6)
                    Text(words.driftShort(drift))
                        .font(.code(13, weight: .medium))
                        .foregroundStyle(Theme.gold)
                }
                HStack(spacing: 6) {
                    Text([String("\(series.eclipses.count) eclipses"), words.span(series)].compactMap { $0 }.joined(separator: " · "))
                        .foregroundStyle(Theme.ink3)
                    Spacer(minLength: 6)
                    Text("lap \(words.lapShort(drift))")
                        .font(.code(12))
                        .foregroundStyle(Theme.ink2)
                }
                .font(.caption)
                HStack(spacing: 6) {
                    Text(SarosWords.kinds(series))
                        .foregroundStyle(Theme.ink3)
                    Spacer(minLength: 6)
                    Text(words.lapPastAlpha(drift))
                        .foregroundStyle(Theme.ink3)
                }
                .font(.code(11))
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
