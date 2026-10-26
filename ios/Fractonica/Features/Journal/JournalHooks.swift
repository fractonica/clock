import Foundation
import Observation

/// The Journal's lifecycle and the hooks the hub sync layer (`Features/Journal/Hub/`) plugs into. Everything here is
/// optional for the journal: without the sync layer it is a local journal.
///
///     JournalHooks.refresh = { await HubSync.shared.syncNow() }             // pull to refresh in the timeline
///     JournalHooks.fetchBlob = { try await HubSync.shared.ensureBlob($0) }   // a missing voice note, video, photo
///     JournalHooks.remoteThumbnail = { hash, px in await HubSync.shared.thumbnail(hash, px) }   // missing tiles
///     JournalSearch.semantic = { query in await HubSearch.shared.scores(query) }   // record id → similarity
///     JournalStore.shared.onLocalChange = { HubSync.shared.scheduleUpload() }   // after every local save or delete
@MainActor
enum JournalHooks: FeatureHooks {
    /// Pull to refresh in the timeline calls this (and waits for it); nil hides nothing, the pull just ends.
    static var refresh: (@MainActor () async -> Void)?

    /// A blob the device does not have yet: download it into the store and return its local file (the sync layer's
    /// `ensureBlob`). Voice notes, videos and full-size photos call it when their file is missing.
    static var fetchBlob: (@MainActor (_ hash: String) async throws -> URL)?

    /// A small JPEG of a blob the device does not have (an image, or a video's first frame), long side at most
    /// `pixels`, as the hub's `?thumb=` makes it: the bytes, fetched with the sync layer's credentials. Timeline and
    /// composer tiles call it before (or instead of) downloading the whole file.
    static var remoteThumbnail: (@MainActor (_ hash: String, _ pixels: Int) async -> Data?)?

    static func launch() {
        // every entry saved on the device carries the sky events near it as tags
        SkyTagging.install(JournalStore.shared)
        Task {
            async let sky: Void = SkyTagging.warm()
            await JournalStore.shared.load()
            await sky
            SkyTagging.backfill(JournalStore.shared)
            if JournalLaunch.flag("FXJournalSeed") {
                await JournalSeed.fillIfEmpty(JournalStore.shared)
                if JournalLaunch.string("FXJournalSeed")?.lowercased() == "wide" {
                    await JournalSeed.fillWide(JournalStore.shared)
                }
            }
            // -FXHubDemo attaches its own demo store to the sync engine instead
            if !JournalLaunch.flag("FXHubDemo") { JournalHubWiring.connect() }
        }
    }
}

/// Search in the timeline: local keyword search always; semantic ranking when the sync layer provides it.
@MainActor
enum JournalSearch {
    /// Set by the sync layer: scores for a query (record id → similarity, higher is closer), or nil when it cannot
    /// answer (offline, no worker). The timeline ranks by these scores when it gets them and falls back to the keyword
    /// search otherwise; keyword hits the scores miss follow them.
    static var semantic: (@MainActor (String) async -> [String: Double]?)?
}

/// What the Journal shows over its screen: the composer, for a new entry or an edit. Commands (⌘N), the timeline and
/// the detail view ask through it; the Journal screen presents it.
@MainActor @Observable
final class JournalUI {
    static let shared = JournalUI()

    /// The composer to present.
    var composer: ComposerRequest?

    /// A new entry (or the autosaved one in progress).
    func compose() { composer = ComposerRequest(key: JournalDraft.newKey) }

    /// Edit an entry.
    func edit(_ id: String) { composer = ComposerRequest(key: id) }
}

/// The composer to open: "new", or the id of the entry to edit (also the key of its autosaved draft).
struct ComposerRequest: Identifiable, Hashable, Sendable {
    let key: String
    var id: String { key }
}

/// The Journal's launch arguments, for screenshots and checks (never persisted):
///
///     -FXJournalStore <dir>     keep the journal in that folder instead of Application Support/Journal
///     -FXJournalSeed 1          fill an empty journal with sample entries (photos, a voice note, Markdown)
///     -FXJournalSeed wide       … and about 330 more over three years, with bursts (blocks and wave clusters)
///     -FXJournalMode, -FXJournalZoom, -FXJournalWaveZoom, -FXJournalWaveAt, -FXJournalWaveHitches
///                               the timeline's stack or wave and their zoom (JournalBrowsing.swift)
///     -FXJournalOthers 1        show records of other kinds in the timeline
///     -FXJournalSearch <text>   start with that search
///     -FXJournalCompose 1       open the composer (a new entry; "edit" edits the newest entry)
///     -FXJournalEmoji 1         … with the emoji picker open
///     -FXJournalEmojiPick <e>   a new entry starts with that emoji instead of a random one
///     -FXJournalAttach <paths>  … attaching copies of those files ("a.mov|b.jpg"), as if picked
///     -FXJournalSaveSoon 1      … then typing a line and tapping Save (which waits for the media)
///     -FXJournalRecord 1        … with the voice recorder open
///     -FXJournalPreview 1       … showing the Markdown preview
///     -FXJournalMoment 1        … with the moment picker open
///     -FXJournalDetail <n>      open the n-th entry (0 = newest)
///     -FXJournalGallery 1       … and its first photo full screen
///     -FXJournalSettings 1      open Settings › Journal (with -FXTab settings)
enum JournalLaunch {
    static func flag(_ key: String) -> Bool {
        let value = UserDefaults.standard.string(forKey: key)?.lowercased()
        return value != nil && value != "0" && value != "no" && value != "false"
    }

    static func string(_ key: String) -> String? {
        UserDefaults.standard.string(forKey: key).flatMap { $0.isEmpty ? nil : $0 }
    }

    static func int(_ key: String) -> Int? {
        string(key).flatMap(Int.init)
    }
}
