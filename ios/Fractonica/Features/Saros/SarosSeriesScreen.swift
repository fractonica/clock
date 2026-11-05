import FractonicaKit
import SwiftUI

/// One Saros series: its figures — the kinds of eclipse, the span, the drift a sync now and over its life, the lap
/// and when it completes, the solar sync's anchor — the switch that puts the clock on it, and every eclipse with a
/// small gnomonic map of its path; an eclipse (or the last and next rows) opens its map (`EclipseMapScreen`).
/// `-FXSarosSeries <n>` opens a series at launch (inside the catalogue); with `-FXSarosEclipse <ordinal>`, Settings
/// opens that eclipse's map instead (`SarosLaunch`).
struct SarosSeriesScreen: View {
    let series: SarosSeries
    @Environment(AppSettings.self) private var settings
    @State private var confirming = false

    var body: some View {
        let words = SarosWords(words: settings.wording)
        let now = Date.now.timeIntervalSince1970
        let reference = ReferenceSaros.shared.series
        let next = series.neighbours(of: now).next
        List {
                Section {
                    figures(words: words, now: now)
                    referenceRow(isReference: reference == series.number)
                }
                Section {
                    ForEach(series.eclipses) { eclipse in
                        NavigationLink {
                            EclipseMapScreen(series: series, ordinal: eclipse.ordinal)
                        } label: {
                            EclipseRow(eclipse: eclipse, words: words, now: now, isNext: eclipse == next)
                        }
                                }
                } header: {
                    Text("Eclipses")
                } footer: {
                    Text("Maps are gnomonic, centred on the path: great circles are straight lines. Paths are drawn from 1582 to 2500; outside those years only the point of greatest eclipse is known. Every fourth eclipse starts an Alpha (α) on a clock the series carries.")
                }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Saros \(series.number)")
        .confirmationDialog("Run the clock on Saros \(series.number)?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Use Saros \(series.number)") { choose() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(confirmText(words: words))
        }
    }

    @ViewBuilder
    private func figures(words: SarosWords, now: Double) -> some View {
        let (last, next) = series.neighbours(of: now)
        if let d = series.drift(at: now) {
            LabeledContent("Drift now", value: words.drift(d))
            LabeledContent("Lap", value: [words.lap(d), words.lapEnd(d).map { "until \($0)" }].compactMap { $0 }.joined(separator: ", "))
            LabeledContent("Lap past an Alpha", value: words.lapPastAlpha(d))
            LabeledContent("Drift over its life", value: words.perSync(d.lifetimePerSync))
        }
        LabeledContent("Eclipses", value: "\(series.eclipses.count) · \(SarosWords.kinds(series))")
        if let span = words.span(series) { LabeledContent("Years", value: span) }
        if let last {
            NavigationLink { EclipseMapScreen(series: series, ordinal: last.ordinal) } label: {
                LabeledContent("Last", value: "\(SarosWords.ordinal(last)) · \(SarosWords.type(last)) · \(words.relative(last, now: now))")
            }
        }
        if let next {
            NavigationLink { EclipseMapScreen(series: series, ordinal: next.ordinal) } label: {
                LabeledContent("Next", value: "\(SarosWords.ordinal(next)) · \(SarosWords.type(next)) · \(words.relative(next, now: now))")
            }
        }
        let anchor = series.eclipses[series.solarAnchor]
        LabeledContent("Solar sync from", value: words.pure ? "#\(anchor.ordinal)" : "#\(anchor.ordinal) · \(words.utc.date(anchor.time))")
    }

    @ViewBuilder
    private func referenceRow(isReference: Bool) -> some View {
        if isReference {
            Label("The clock runs on this series", systemImage: "checkmark.circle.fill")
                .foregroundStyle(Theme.teal)
        } else {
            Button {
                confirming = true
            } label: {
                Label("Run the clock on Saros \(series.number)", systemImage: "arrow.triangle.2.circlepath")
            }
        }
    }

    private func confirmText(words: SarosWords) -> String {
        let span = words.span(series).map { " Its eclipses run \($0); outside them the clock shows nothing." } ?? ""
        return "Every reading, moment, alert and widget moves to Saros \(series.number)'s eclipses: they become the clock's Saros boundaries, its Helion is 4/125 125 of their intervals and the solar sync counts from eclipse #\(series.solarAnchor).\(span) You can switch back at any time."
    }

    private func choose() {
        ReferenceSaros.shared.choose(series.number)
        ToastCenter.shared.show("The clock runs on Saros \(series.number)")
    }
}

/// One eclipse of a series: its map, ordinal and kind, central duration, date and how far it is from now.
private struct EclipseRow: View {
    let eclipse: SarosEclipse
    let words: SarosWords
    let now: Double
    let isNext: Bool

    var body: some View {
        HStack(spacing: 12) {
            EclipseThumbnail(eclipse: eclipse, side: 56)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(SarosWords.ordinal(eclipse))
                        .font(Font.code(14, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                    Text(SarosWords.type(eclipse))
                        .font(.subheadline)
                        .foregroundStyle(EclipseArt.color(eclipse.type.kind))
                    if let duration = words.duration(eclipse) {
                        Text(duration)
                            .font(Font.code(12))
                            .foregroundStyle(Theme.ink2)
                    }
                }
                Text(words.date(eclipse))
                    .font(Font.code(12))
                    .foregroundStyle(Theme.ink2)
                Text(words.relative(eclipse, now: now))
                    .font(.caption)
                    .foregroundStyle(isNext ? Theme.now : Theme.ink3)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// The catalogue's launch arguments: `-FXSarosSeries <n> -FXSarosEclipse <ordinal>` names an eclipse to show at launch.
enum SarosLaunch {
    @MainActor static var eclipse: SarosEclipse? {
        guard let n = JournalLaunch.int("FXSarosSeries"), let k = JournalLaunch.int("FXSarosEclipse"),
              let series = SarosCatalogue.series(n), series.eclipses.indices.contains(k) else { return nil }
        return series.eclipses[k]
    }
}
