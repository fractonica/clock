import FractonicaKit
import Foundation

/// How important a turnover must be to be listed in Up next: its coarsest rolling level is α … `top`
/// (lib.js `IMPORTANCE`: α–γ, α–δ, α–ε, α–ζ, α–η; α–ζ by default).
struct Importance: Hashable, Identifiable, Sendable {
    /// The finest counted level (2 … 6).
    let top: Int

    /// Its letter: the id persisted under `storageKey`.
    var id: String { LadderText.letter(top) }
    /// "α–ζ".
    var label: String { "α–\(id)" }

    static let all = (2...6).map(Importance.init(top:))
    static let defaultID = "ζ"
    /// The feature's own UserDefaults key.
    static let storageKey = "ladder.importance"

    /// The choice with that id, or the default.
    static func byID(_ id: String?) -> Importance {
        all.first { $0.id == id } ?? all.first { $0.id == defaultID }!
    }
}

/// One upcoming turnover: the instant cycles of one or more levels end together (lib.js `buildEvents`).
struct Turnover: Hashable, Identifiable, Sendable {
    let time: Double
    /// The coarsest level that rolls over.
    let top: Int
    /// How many levels of the ladder's range end with it.
    let finer: Int

    var id: Double { time }
}

/// A row of the Up next list with its group: a civil day (Earth) or a Nuclide (pure).
struct TurnoverRow: Hashable, Identifiable, Sendable {
    let turnover: Turnover
    /// What groups the row ("2026-10-18" in a zone, or a Nuclide index).
    let group: String
    /// The heading of the group, on its first row only: "Sun 18 Oct" (every Earth group) or "Delta Trifracton ε#5"
    /// (a pure group of two or more turnovers).
    let heading: String?
    /// A new group begins here (never on the first row).
    let separated: Bool
    /// "03:41" (Earth); what begins (pure): "45η".
    let label: String

    var id: Double { turnover.time }
}

enum Turnovers {
    /// How many turnovers Up next lists: the hero and seven more (upnext.js `COUNT`).
    static let listed = 8

    /// The next `count` turnovers after t whose top is within `importance` (lib.js `buildEvents`).
    static func upcoming(_ clock: FractonicaClock, after t: Double, importance: Importance, maxLevel: Int, count: Int = listed) -> [Turnover] {
        clock.upcomingEnds(after: t, fromLevel: 0, toLevel: importance.top, count: count, perLevel: 8).map {
            Turnover(time: $0.time, top: $0.top, finer: max(0, maxLevel - $0.top))
        }
    }

    /// Rows grouped by civil day in a zone (lib.js `groupByDay`): every day gets a heading.
    static func byDay(_ turnovers: [Turnover], earth: EarthFormatter, ref: Double) -> [TurnoverRow] {
        let refYear = earth.parts(ref).year
        var previous: String?
        return turnovers.enumerated().map { i, e in
            let key = earth.date(e.time)
            let first = key != previous
            previous = key
            return TurnoverRow(
                turnover: e,
                group: key,
                heading: first ? LadderText.dayLabel(earth, e.time, refYear: refYear) : nil,
                separated: i > 0 && first,
                label: LadderText.clockLabel(earth, e.time)
            )
        }
    }

    /// Rows grouped by the Nuclide they fall in (pure-text.js `groupByNuclide`): the Nuclide in words heads a group of
    /// two or more; a group of one is its own date.
    static func byNuclide(_ turnovers: [Turnover], words: (Turnover) -> TurnoverWords) -> [TurnoverRow] {
        let infos = turnovers.map(words)
        var size: [Int64: Int] = [:]
        for info in infos { size[info.group, default: 0] += 1 }
        var previous: Int64?
        return zip(turnovers, infos).enumerated().map { i, pair in
            let (e, info) = pair
            let first = info.group != previous
            previous = info.group
            return TurnoverRow(
                turnover: e,
                group: String(info.group),
                heading: first && (size[info.group] ?? 0) > 1 ? info.heading : nil,
                separated: i > 0 && first,
                label: info.name ?? "the catalogue ends"
            )
        }
    }

    /// How many leading turnovers of `previous` have passed when `next` is the same list advanced; −1 when the lists
    /// are unrelated (a jump, another importance) (lib.js `advancedBy`).
    static func advance(from previous: [Turnover], to next: [Turnover]) -> Int {
        guard let head = next.first, let at = previous.firstIndex(where: { $0.time == head.time }) else { return -1 }
        let overlap = min(previous.count - at, next.count)
        for i in 0..<overlap where previous[at + i].time != next[i].time { return -1 }
        return at
    }
}

/// The Up next list for the displayed time, recomputed only when it stops describing it: while t stays inside the
/// current cycle of the finest counted level, before the first listed turnover, the list is still exact
/// (lib.js `isStale`). A plain reference type, so a view can consult it while drawing a tick without invalidating
/// itself; it is never shared across threads.
final class TurnoverMemo {
    struct Key: Equatable {
        var importance: Importance
        var maxLevel: Int
    }

    private struct RowsKey: Equatable {
        var generation: Int
        var pure: Bool
        var zone: String
        var year: Int
    }

    /// Real seconds between two animated passes (upnext.js: 600 ms), so a fast time-lapse does not animate, glow and
    /// tap on every tick.
    static let passGap = 0.6

    private(set) var turnovers: [Turnover] = []
    /// How many turnovers passed at the last recomputation (1 or 2 animate the list; −1 a jump).
    private(set) var advanced = -1
    /// The last recomputation moved the list on by one or two turnovers, at least `passGap` after the previous such
    /// move: animate it.
    private(set) var passed = false
    /// … and the clock got there by running, not by a jump (`revision` unchanged): the moment for a haptic tap.
    private(set) var ranPast = false
    /// Bumps on every recomputation.
    private(set) var generation = 0
    private var key: Key?
    private var validFrom = -Double.infinity
    private var validUntil = -Double.infinity
    private var lastPass = -Double.infinity
    private var revision: Int?
    private var rowsKey: RowsKey?
    private var cachedRows: [TurnoverRow] = []

    /// The turnovers after t (empty outside the catalogue and past the last one). `now` is the real time (for the
    /// pass animation's pace), `revision` the clock's discontinuity counter (`ClockStore.revision`).
    func turnovers(_ clock: FractonicaClock, at t: Double, importance: Importance, maxLevel: Int,
                   now: Double = Date().timeIntervalSince1970, revision: Int = 0) -> [Turnover] {
        let k = Key(importance: importance, maxLevel: maxLevel)
        let sameRun = revision == self.revision
        self.revision = revision
        guard k != key || t < validFrom || t >= validUntil else { return turnovers }
        let fresh = clock.inRange(t) ? Turnovers.upcoming(clock, after: t, importance: importance, maxLevel: maxLevel) : []
        advanced = k == key ? Turnovers.advance(from: turnovers, to: fresh) : -1
        passed = (1...2).contains(advanced) && now - lastPass >= Self.passGap
        if passed { lastPass = now }
        ranPast = passed && sameRun
        key = k
        turnovers = fresh
        generation &+= 1
        if clock.inRange(t) {
            validFrom = clock.level(at: t, importance.top)?.start ?? -Double.infinity
            validUntil = fresh.first?.time ?? Double.infinity
        } else {
            // outside the catalogue: valid until t comes back in
            validFrom = t < clock.tMin ? -Double.infinity : clock.tMax + 1e-9
            validUntil = t < clock.tMin ? clock.tMin : Double.infinity
        }
        return fresh
    }

    /// The list after the hero, grouped by civil day (Earth, in `earth`'s zone) or by Nuclide (pure): worked out once
    /// per list, mode, zone and year (a pure grouping places every turnover exactly, ~0.1 ms).
    func rows(pure: Bool, earth: EarthFormatter, ref: Double, text: LadderPureText) -> [TurnoverRow] {
        let key = RowsKey(generation: generation, pure: pure, zone: pure ? "" : earth.zone, year: pure ? 0 : earth.parts(ref).year)
        if key == rowsKey { return cachedRows }
        let following = Array(turnovers.dropFirst())
        cachedRows = pure
            ? Turnovers.byNuclide(following) { text.turnoverInfo(time: $0.time, top: $0.top) }
            : Turnovers.byDay(following, earth: earth, ref: ref)
        rowsKey = key
        return cachedRows
    }

    /// Forget the list (a setting it depends on changed).
    func reset() { key = nil }
}
