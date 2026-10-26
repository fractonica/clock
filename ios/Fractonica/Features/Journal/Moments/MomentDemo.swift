import Foundation

/// `-FXMomentsDemo 1`: captured entries for screenshots — a run of the last announced moments (a streak), the latest
/// Delta, Gamma, Beta and Alpha boundaries (epic … cosmic), all at their real moments, a few with stills for photos,
/// and two common entries. Only into a journal that has no capture yet (use it with `-FXJournalStore <dir>`).
@MainActor
enum MomentDemo {
    static func fill(_ store: JournalStore, calendar: MomentCalendar) {
        guard !store.entries.contains(where: { $0.capture != nil }) else { return }
        let now = Date.now.timeIntervalSince1970
        let zone = AppSettings.shared.timeZone
        let settings = MomentStore.shared.settings
        var moments: [Moment] = []
        // the run: the last nine announced moments
        var t = now
        while moments.count < 9, let m = calendar.previous(atOrBefore: t, where: { settings.prompts($0, zone: zone) }) {
            moments.append(m)
            t = m.time - 1
        }
        // one of each rarer kind
        for level in [MomentLevel.delta, .gamma, .beta, .alpha] {
            if let m = calendar.previous(atLeast: level, atOrBefore: now), !moments.contains(m) { moments.append(m) }
        }
        let lines: [(String, String)] = [
            ("☕️", "Coffee on the balcony, the light just turning."), ("🌿", "Walked the long way round the park."),
            ("🎧", "Deep in the mix, lost track of the hour."), ("📚", "Reading by the window."),
            ("🍜", "Lunch with Ana — the noodle place."), ("🌙", "The moon came up huge."),
            ("💻", "Shipping the build."), ("🚲", "Ride home along the river."), ("🔥", "Kept the streak going."),
        ]
        Task {
            for (i, m) in moments.enumerated() {
                let line = i < lines.count ? lines[i] : ([MomentLevel.delta: "🪐", .gamma: "🌕", .beta: "☄️", .alpha: "🌌"][m.level] ?? "✨", "\(m.title()), captured on the dot.")
                var blobs: [BlobRef] = []
                // the two latest were captured three times (back@-1 … front@1), the rare ones once (back, front)
                let offsets = i < 2 ? MomentCaptures.offsets(count: 3) : [0]
                let photos = i < 2 || i >= lines.count ? offsets.flatMap { k in
                    MomentStill.make(m, words: AppSettings.shared.wording, offset: offsets.count > 1 ? k : nil).map {
                        (name: MomentCaptures.photoName(camera: $0.name, offset: k, count: offsets.count), data: $0.data)
                    }
                } : []
                for photo in photos.sorted(by: { MomentCaptures.sortKey($0.name) < MomentCaptures.sortKey($1.name) }) {
                    let url = store.disk.temporaryFile(ext: "jpg")
                    guard (try? photo.data.write(to: url)) != nil,
                          let item = try? await JournalMedia.processImage(url, name: photo.name, quality: .optimised, disk: store.disk),
                          let refs = try? await store.adopt(item) else { continue }
                    blobs += refs
                }
                var record = HubRecord.journalEntry(time: m.time, zone: zone.identifier, entry: JournalEntry(emoji: line.0, markdown: line.1),
                                                    blobs: blobs, now: now)
                record.data = record.data.with(capture: m.capture)
                store.save(record)
            }
            for (k, text) in ["A thought between moments.", "Groceries, laundry, a long call."].enumerated() {
                let time = now - Double(k + 1) * 1900
                store.save(HubRecord.journalEntry(time: time, zone: zone.identifier, entry: JournalEntry(emoji: k == 0 ? "💭" : "🧺", markdown: text), blobs: [], now: now))
            }
            MomentStore.shared.refreshStats()
        }
    }
}
