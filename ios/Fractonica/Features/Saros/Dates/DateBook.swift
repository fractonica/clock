import FractonicaKit
import Foundation
import Observation

/// The kept dates (`SavedDate`), read from and written to the journal's store, which keeps them as `journal.date`
/// records and syncs them with the hub like its entries. Observable: a view reading `dates` follows every change, its
/// own and the hub's.
///
///     DateBook.shared.dates            // live dates, in time order
///     DateBook.shared.save(date)       // create or edit (pending until the hub has it)
///     DateBook.shared.delete(id)
@MainActor @Observable
final class DateBook {
    static let shared = DateBook()

    /// A date to show (a tapped echo, a launch argument): the Saros screen opens it and clears this.
    var opened: String?
    /// A date being made from the search (its moment and whether it is a whole day): the Saros screen presents the
    /// editor and clears this.
    var drafted: SavedDate?

    @ObservationIgnored private let store: JournalStore
    @ObservationIgnored private var cache: (revision: Int, dates: [SavedDate]) = (-1, [])

    init(store: JournalStore = .shared) {
        self.store = store
    }

    /// Every live date, oldest first.
    var dates: [SavedDate] {
        let revision = store.revision
        if cache.revision != revision {
            let dates = store.records.values.compactMap(SavedDate.init(record:))
                .sorted { $0.time != $1.time ? $0.time < $1.time : $0.id < $1.id }
            cache = (revision, dates)
        }
        return cache.dates
    }

    /// The dates' records, newest first (the wave's pins).
    var records: [HubRecord] {
        dates.reversed().compactMap { store.record($0.id) }
    }

    /// Bumped on every change to the store (the wave's revision).
    var revision: Int { store.revision }

    func date(_ id: String) -> SavedDate? {
        store.record(id).flatMap(SavedDate.init(record:))
    }

    /// Creates or replaces a date: the store makes it pending and the hub sync uploads it.
    func save(_ date: SavedDate) {
        let old = store.records[date.id].flatMap { $0.isDeleted ? nil : $0 }
        store.save(date.record(updating: old, now: Date.now.timeIntervalSince1970))
        DateEchoes.shared.scheduleRefill()
    }

    /// Deletes a date (a tombstone the hub sync uploads; its echoes go).
    func delete(_ id: String) {
        store.delete(id)
        DateEchoes.shared.scheduleRefill()
    }
}

/// Dates for screenshots and checks: `-FXDatesSeed 1` adds these to a store without dates.
enum DateSeed {
    @MainActor static func fillIfEmpty(_ book: DateBook) {
        guard book.dates.isEmpty else { return }
        let zone = AppSettings.shared.zone ?? TimeZone.current.identifier
        let tz = TimeZone(identifier: zone) ?? .current
        func day(_ y: Int, _ m: Int, _ d: Int) -> Double {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = tz
            let t = calendar.date(from: DateComponents(year: y, month: m, day: d, hour: 12))?.timeIntervalSince1970 ?? 0
            return t
        }
        let samples: [SavedDate] = [
            SavedDate(time: day(1988, 5, 12), zone: zone, allDay: true, emoji: "🎂", title: "Birthday",
                      text: "Born in the spring, half a year after a Saros 133 eclipse.",
                      echoes: DateEchoSettings(solarDay: true, periods: [3])),
            SavedDate(time: 1_503_340_200, zone: zone, allDay: false, emoji: "🌑", title: "The Great American Eclipse",
                      text: "Watched totality in Oregon.", echoes: DateEchoSettings(periods: [4])),
            SavedDate(time: day(2015, 6, 20), zone: zone, allDay: true, emoji: "💍", title: "Wedding",
                      text: "", echoes: DateEchoSettings(solarDay: true)),
            SavedDate(time: day(2024, 4, 8), zone: zone, allDay: true, emoji: "🚀", title: "Launch day",
                      text: "The first release went out the morning of the eclipse."),
            SavedDate(time: day(2026, 8, 12), zone: zone, allDay: true, emoji: "🇪🇸", title: "Spain trip",
                      text: "Totality over Spain.", echoes: DateEchoSettings(periods: [6])),
        ]
        for date in samples { book.save(date) }
    }
}
