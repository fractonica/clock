import FractonicaKit
import SwiftUI

/// When a series' Helions meet the ordinary clock: the solar sync's Helions on a 24- or 12-hour dial in local time
/// (`HelionDialView`), syncs before and after it a step away, and the next nodes with their times of day. Follows the
/// displayed time (time travel moves it). From a series' page, or the catalogue for the clock's own series;
/// `-FXSarosHelions 1` opens it at launch (with `-FXTab settings` and `-FXSarosSeries <n>`, else the reference series).
struct HelionDialScreen: View {
    let series: SarosSeries
    @Environment(AppSettings.self) private var settings
    @AppStorage("saros.helionDial.hours") private var hours = 24
    /// Syncs from the one running now.
    @State private var offset = 0

    var body: some View {
        let words = settings.wording
        ClockTimeline(.periodic(1)) { t in
            if let clock = FractonicaClock.on(series: series.number),
               let dial = HelionDial(clock: clock, at: t, earth: words.earth, sync: offset) {
                List {
                    Section {
                        HelionDialView(dial: dial, now: t, hours: hours, pure: words.pure)
                            .padding(.vertical, 4)
                            .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                        controls(dial)
                    } footer: {
                        Text(caption(dial, now: t, words: words))
                    }
                    Section {
                        ForEach(HelionDial.nodes(clock: clock, after: t, count: 12, earth: words.earth)) { node in
                            NodeRow(node: node, now: t, words: words)
                        }
                    } header: {
                        Text("Next nodes")
                    } footer: {
                        Text(explanation(words: words))
                    }
                }
            } else {
                ContentUnavailableView("Outside Saros \(series.number)", systemImage: "circle.dashed",
                                       description: Text("The displayed time is outside the series' eclipses."))
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Helions · Saros \(series.number)")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private func controls(_ dial: HelionDial) -> some View {
        HStack {
            Picker("Dial", selection: $hours) {
                Text("24 h").tag(24)
                Text("12 h").tag(12)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 140)
            Spacer()
            Button { offset -= 1 } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Previous sync")
            Button(offset == 0 ? "This sync" : "Now") { offset = 0 }
                .font(.subheadline)
                .disabled(offset == 0)
            Button { offset += 1 } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Next sync")
        }
        .buttonStyle(.borderless)
    }

    private func caption(_ dial: HelionDial, now: Double, words: Wording) -> String {
        let span = "Solar sync \(dial.sync): \(words.short(dial.start)) to \(words.short(dial.end))"
        guard let current = dial.helions.first(where: { $0.start <= now && now < $0.end }) else { return span }
        let pentad = current.pentad == 3 ? "the Hypopentad" : "Pentad \(Notation.pentadNumerals[current.pentad])"
        return "\(span). Now: \(current.label), Helion \(current.place) of \(pentad)."
    }

    private func explanation(words: Wording) -> String {
        let helion = FractonicaClock.on(series: series.number)?.levelInfo(HelionDial.helionLevel).meanSeconds ?? 18_189
        let length = words.pure ? "a Helion" : "a Helion (\(EarthTime.duration(helion, parts: 2)))"
        return "Each Helion has two nodes: the ascending one where it begins (●) and the descending one half way (○). \(length.prefix(1).uppercased() + length.dropFirst()) runs a little past a fifth of a day, so 4¾ Helions make a day and every node comes a quarter Helion later each day; a Pentad (⬠, 5 Helions) is a day and a quarter Helion, and the Hypopentad (◻, 4 Helions) brings the next sync back to the same times of day — the spiral's four turns are its four days — a few seconds earlier, the drift of Saros \(series.number)."
    }
}

/// One node: which Helion, ascending or descending, the Pentad it begins, and when.
private struct NodeRow: View {
    let node: HelionDial.Node
    let now: Double
    let words: Wording

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: node.ascending ? "circle.fill" : "circle")
                .font(.caption)
                .foregroundStyle(Theme.levelColor(HelionDial.helionLevel))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(node.helion.label).font(.code(14, weight: .semibold))
                    Text(node.ascending ? "ascending node" : "descending node").foregroundStyle(Theme.ink2)
                    if let pentad = node.beginsPentad {
                        PentadMark(index: pentad).foregroundStyle(Theme.gold).font(.caption.weight(.bold))
                    }
                }
                Text(words.countdown(node.time - now, at: now))
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            }
            Spacer()
            if !words.pure {
                Text(timeOfDay)
                    .font(.reading(17, weight: .medium))
                    .foregroundStyle(Theme.ink)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// "17:03", or "Fri 17:03" on another day.
    private var timeOfDay: String {
        let a = words.earth.parts(node.time), b = words.earth.parts(now)
        let time = words.earth.time(node.time, seconds: false)
        return a.year == b.year && a.month == b.month && a.day == b.day ? time : "\(EarthTime.weekdaysShort[a.weekday]) \(time)"
    }
}
