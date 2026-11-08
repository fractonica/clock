import FractonicaKit
import SwiftUI

/// Makes or edits a kept date: its emoji, title and description, the day and, if it has one, the time — read in the
/// date's own zone (the app's for a new one) — with the Saros series and rarity it comes to shown as it changes. A
/// sheet; Save writes it to the journal's store (and so to the hub).
struct DateEditor: View {
    let isNew: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var date: SavedDate
    @State private var day: Date
    @State private var hasTime: Bool
    @State private var showsEmoji = false
    @FocusState private var titleFocused: Bool

    init(date: SavedDate, isNew: Bool) {
        self.isNew = isNew
        _date = State(initialValue: date)
        _day = State(initialValue: Date(timeIntervalSince1970: date.time))
        _hasTime = State(initialValue: !date.allDay)
    }

    /// A new date: today, a whole day, in the app's zone.
    @MainActor static func blank() -> SavedDate {
        let zone = AppSettings.shared.timeZone
        let now = Date.now.timeIntervalSince1970
        return SavedDate(time: SavedDate.noon(of: now, zone: zone), zone: AppSettings.shared.zone ?? zone.identifier, allDay: true)
    }

    var body: some View {
        let edited = result
        let nearest = SarosSearch.matches(edited.query, count: 1).first
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        Button { showsEmoji = true } label: {
                            DateEmoji(emoji: date.emoji, size: 52)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(date.emoji == nil ? "Choose an emoji" : "Emoji \(date.emoji ?? ""), change")
                        .popover(isPresented: $showsEmoji) {
                            EmojiPicker(selection: $date.emoji) { showsEmoji = false }
                                .frame(minWidth: 340, idealWidth: 380, minHeight: 440, idealHeight: 520)
                                .presentationDetents([.medium, .large])
                        }
                        TextField("Title", text: $date.title)
                            .font(.reading(20, weight: .semibold))
                            .focused($titleFocused)
                            .submitLabel(.done)
                    }
                    TextField("Description", text: $date.text, axis: .vertical)
                        .lineLimit(3...10)
                }
                Section {
                    DatePicker("Date", selection: $day, in: SarosSearchScreen.range, displayedComponents: .date)
                    Toggle("Time of day", isOn: $hasTime.animation())
                    if hasTime {
                        DatePicker("Time", selection: $day, displayedComponents: .hourAndMinute)
                    }
                } footer: {
                    Text(hasTime ? "In \(date.zone)." : "A whole day, midnight to midnight in \(date.zone).")
                }
                .environment(\.timeZone, date.timeZone)
                .environment(\.calendar, SarosSearchScreen.calendar(date.timeZone))
                if let nearest {
                    Section {
                        HStack(spacing: 8) {
                            SarosBadge(series: nearest.eclipse.series)
                            RarityBadge(rarity: nearest.rarity)
                            Spacer()
                        }
                        Text("\(SarosSearchWords.name(nearest.eclipse)), \(SarosSearchWords.helions(nearest.helions)) away.")
                            .font(.footnote)
                            .foregroundStyle(Theme.ink2)
                    } header: {
                        Text("Nearest eclipse")
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(isNew ? "New Date" : "Edit Date")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        DateBook.shared.save(edited)
                        dismiss()
                    }
                    .disabled(edited.title.trimmingCharacters(in: .whitespaces).isEmpty && edited.emoji == nil)
                }
            }
            .onAppear { if isNew, date.title.isEmpty { titleFocused = true } }
        }
        .frame(minWidth: 380, minHeight: 520)
    }

    /// The date as edited: a moment, or the day's noon in its zone.
    private var result: SavedDate {
        var d = date
        d.allDay = !hasTime
        d.time = hasTime ? day.timeIntervalSince1970 : SavedDate.noon(of: day.timeIntervalSince1970, zone: date.timeZone)
        d.title = d.title.trimmingCharacters(in: .whitespacesAndNewlines)
        return d
    }
}
