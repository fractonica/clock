import FractonicaKit
import SwiftUI

/// The Saros catalogue: the 40 solar Saros series running now, each with its drift against the civil day and its lap,
/// the reference series (the one the clock runs on) ticked. A series opens its eclipses (`SarosSeriesScreen`).
/// Settings › Saros series; `-FXSarosCatalogue 1` opens it at launch (with `-FXTab settings`).
struct SarosCatalogueScreen: View {
    @Environment(AppSettings.self) private var settings
    @State private var order: Order = .number
    @State private var opened: SarosSeries? = JournalLaunch.int("FXSarosSeries").flatMap(SarosCatalogue.series)

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
                    Text("drift a sync · lap")
                }
            } footer: {
                Text(footer(rows.map(\.drift), words: words))
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Saros series")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Sort by", selection: $order) {
                        ForEach(Order.allCases) { Text($0.title).tag($0) }
                    }
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
            }
        }
        .navigationDestination(item: $opened) { SarosSeriesScreen(series: $0) }
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
