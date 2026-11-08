import FractonicaKit
import SwiftUI

/// One kept date: its header in its rarity's frame (emoji, title, when, the Saros series and rarity of its nearest
/// eclipse), its description, where it falls on the clock, its three nearest eclipses (each opens its map), and its
/// echoes — every year on its solar day, and every time a period of the clock's series comes back to the date's phase
/// in it, each with when it next comes. Edit and Delete in the toolbar.
struct DateDetailScreen: View {
    let id: String

    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var book = DateBook.shared
    @State private var editing: SavedDate?
    @State private var confirmsDelete = false

    var body: some View {
        Group {
            if let date = book.date(id) {
                content(date)
            } else {
                ContentUnavailableView("Date deleted", systemImage: "calendar.badge.minus")
            }
        }
        .background { Backdrop() }
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(item: $editing) { DateEditor(date: $0, isNew: false) }
    }

    private func content(_ date: SavedDate) -> some View {
        let words = settings.wording
        let dateWords = DateWords(pure: words.pure, notation: words.notation)
        let matches = SarosSearch.matches(date.query)
        return List {
            Section {
                header(date, words: dateWords, nearest: matches.first)
                    .listRowInsets(EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10))
                    .listRowBackground(Color.clear)
            }
            if !date.text.isEmpty {
                Section {
                    Text(date.text)
                        .font(.reading(16))
                        .foregroundStyle(Theme.ink)
                        .textSelection(.enabled)
                }
            }
            clockSection(date, words: words)
            Section {
                ForEach(Array(matches.enumerated()), id: \.element.id) { index, match in
                    NavigationLink {
                        if let series = match.series { EclipseMapScreen(series: series, ordinal: match.eclipse.ordinal) }
                    } label: {
                        SarosMatchRow(rank: index + 1, match: match, query: date.query, words: words)
                    }
                }
                NavigationLink {
                    SarosSearchScreen(start: date.time, hasTime: !date.allDay)
                } label: {
                    Label("Open in Saros Search", systemImage: "magnifyingglass")
                }
            } header: {
                Text("Nearest eclipses")
            }
            EchoSection(date: date, words: words)
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(date.title.isEmpty ? "Date" : date.title)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Edit") { editing = date }
                Button("Delete", systemImage: "trash", role: .destructive) { confirmsDelete = true }
            }
        }
        .confirmationDialog("Delete “\(date.name)”?", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("Delete Date", role: .destructive) {
                book.delete(date.id)
                dismiss()
            }
        } message: {
            Text("It goes from every device synced with your hub, with its echoes.")
        }
    }

    private func header(_ date: SavedDate, words: DateWords, nearest: SarosMatch?) -> some View {
        let rarity = nearest?.rarity ?? .common
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                DateEmoji(emoji: date.emoji, size: 64)
                VStack(alignment: .leading, spacing: 4) {
                    Text(date.title.isEmpty ? "Untitled date" : date.title)
                        .font(.reading(24, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    Text(words.when(date))
                        .font(.code(13))
                        .foregroundStyle(Theme.ink2)
                }
            }
            if let nearest {
                HStack(spacing: 6) {
                    SarosBadge(series: nearest.eclipse.series)
                    RarityBadge(rarity: rarity)
                }
                Text(sentence(nearest, date: date))
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel.opacity(0.75), in: .rect(cornerRadius: 22, style: .continuous))
        .rarityFrame(rarity, turns: false)
        .accessibilityElement(children: .combine)
    }

    private func sentence(_ m: SarosMatch, date: SavedDate) -> String {
        let say = SarosSearchWords(words: settings.wording)
        let name = SarosSearchWords.name(m.eclipse)
        let lower = name.prefix(1).lowercased() + name.dropFirst()
        if m.offset == 0 { return "The \(lower) falls \(date.allDay ? "on this very day" : "at this very moment")." }
        return "The nearest eclipse is the \(lower), \(say.relation(m, query: date.query)): \(SarosSearchWords.helions(m.helions))."
    }

    @ViewBuilder
    private func clockSection(_ date: SavedDate, words: Wording) -> some View {
        let clock = FractonicaClock.shared
        Section {
            if clock.inRange(date.time) {
                LabeledContent("Date") {
                    words.ledLetters(date.time, upTo: date.allDay ? "epsilon" : "iota")
                        .font(.code(13))
                        .multilineTextAlignment(.trailing)
                }
                if !date.allDay {
                    LabeledContent("Clock", value: words.notation.clockText(at: date.time))
                        .font(.code(13))
                }
            } else {
                Text("Outside Saros \(clock.series)'s catalogue (\(clock.yearSpan())): no reading on the clock, and no period echoes.")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
            }
        } header: {
            Text("On the clock · Saros \(clock.series)")
        } footer: {
            if date.allDay, clock.inRange(date.time) { Text("A whole day reads from its noon.") }
        }
    }
}

/// A date's echoes, saved as they are changed: the solar day each year (and when in it), and each period of the
/// clock, with when its next echo comes and the phase it repeats.
private struct EchoSection: View {
    let date: SavedDate
    let words: Wording

    @State private var book = DateBook.shared

    var body: some View {
        let clock = FractonicaClock.shared
        let now = Date.now.timeIntervalSince1970
        let zone = AppSettings.shared.timeZone
        Section {
            Toggle(isOn: binding(\.solarDay)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Same solar day, every year")
                    if date.echoes.solarDay, let next = DateEchoPlanner.solarDays(of: date, after: now, zone: zone, count: 1).first {
                        Text(nextText(next.time, now: now))
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                    }
                }
            }
            if date.echoes.solarDay {
                DatePicker("At", selection: minuteBinding, displayedComponents: .hourAndMinute)
                    .environment(\.timeZone, .gmt)
            }
            ForEach(DateEchoSettings.levels, id: \.self) { level in
                Toggle(isOn: levelBinding(level)) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text("Every \(DateEchoPlanner.periodName(level))")
                            Text(words.levelLength(level))
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                        }
                        if date.echoes.follows(level) {
                            if let phase = DateEchoPlanner.phase(level: level, at: date.time, notation: words.notation) {
                                Text("back at \(phase)")
                                    .font(.code(11))
                                    .foregroundStyle(Theme.ink2)
                            }
                            if let next = DateEchoPlanner.periods(of: date, level: level, after: now, clock: clock, count: 1).first {
                                Text(nextText(next.time, now: now))
                                    .font(.caption)
                                    .foregroundStyle(Theme.ink3)
                            } else {
                                Text("No echo left inside the catalogue")
                                    .font(.caption)
                                    .foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                }
                .disabled(!clock.inRange(date.time))
            }
        } header: {
            Text("Echoes")
        } footer: {
            Text("An echo is a notification when the date comes round again: on its solar day each year, or each time a period of Saros \(clock.series) is back at the same phase it was at on the date — the same reading below it on the clock. The soonest \(DateEchoPlanner.budget) of all your dates' echoes are kept waiting on this device.")
        }
    }

    /// "Next: Fri 12 May 2028, 09:00 · in 1 y 6 mo" · pure the stamp and countdown.
    private func nextText(_ t: Double, now: Double) -> String {
        "Next: \(words.pure ? words.notation.stamp(at: t, upTo: "iota") : words.earth.short(t, refYear: words.earth.parts(now).year)) · \(words.countdown(t - now, at: now))"
    }

    private func save(_ change: (inout DateEchoSettings) -> Void) {
        var d = date
        let wasEmpty = d.echoes.isEmpty
        change(&d.echoes)
        book.save(d)
        if wasEmpty, !d.echoes.isEmpty { DateEchoes.shared.requestPermission() }
    }

    private func binding(_ key: WritableKeyPath<DateEchoSettings, Bool>) -> Binding<Bool> {
        Binding(get: { date.echoes[keyPath: key] }, set: { on in save { $0[keyPath: key] = on } })
    }

    private func levelBinding(_ level: Int) -> Binding<Bool> {
        Binding(get: { date.echoes.follows(level) }, set: { on in save { $0.set(level, on) } })
    }

    /// The minute of the day as a date on 1970-01-01 UTC (the picker reads it in UTC, so it is a plain time of day).
    private var minuteBinding: Binding<Date> {
        Binding(get: { Date(timeIntervalSince1970: Double(date.echoes.solarMinute * 60)) },
                set: { d in
                    let m = Int(d.timeIntervalSince1970.truncatingRemainder(dividingBy: 86_400) / 60)
                    save { $0.solarMinute = (m + 1440) % 1440 }
                })
    }
}
