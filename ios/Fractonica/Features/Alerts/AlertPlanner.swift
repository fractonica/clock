import FractonicaKit
import Foundation

// Which notifications Alerts posts: every rule's upcoming events from the engine, read from the real now, merged
// where they fall together and fair-shared across rules within the system's budget of pending notifications. Pure
// logic on `FractonicaClock` (no UI, no UserNotifications), checked by Checks/AlertsChecks.swift.

/// One moment a rule notifies about.
struct AlertOccurrence: Hashable, Sendable {
    let ruleID: UUID
    let subject: AlertSubject
    /// The event that names the moment: `.begin` for a turnover (one cycle ending where the next begins).
    let event: AlertEvent
    /// Every event of the rule at this instant, in cycle order (a turnover is [.begin, .end] when both are chosen).
    let events: [AlertEvent]
    /// Level: the cycle the event belongs to (the one beginning at a turnover, the one ending at an end); solar: the
    /// sync number; eclipse: the catalogue ordinal.
    let index: Int64
    /// Turnovers: the coarsest level whose cycle ends here too (≤ the rule's level). Otherwise the rule's level, or −1.
    let top: Int
    /// When the event happens and when its notification fires (earlier by the rule's lead), Unix seconds.
    let time: Double
    let fire: Double

    /// The event's part of the request identifier: "6.717212.begin", "sync.4821.node", "eclipse.23".
    var key: String {
        switch subject {
        case .level(let level): "\(level).\(index).\(event.rawValue)"
        case .solar: "sync.\(index).\(event.rawValue)"
        case .eclipse: "eclipse.\(index)"
        }
    }

    /// The notification request identifier, "alert.<rule>.<event>".
    var identifier: String { "\(AlertPlanner.prefix)\(ruleID.uuidString).\(key)" }
}

/// A notification in the plan: the occurrence that names it and those of other rules that fall at the same instant.
struct PlannedAlert: Identifiable, Hashable, Sendable {
    var occurrence: AlertOccurrence
    /// Occurrences of other rules folded into this one (same instant, less important subject).
    var also: [AlertOccurrence] = []
    /// Inside quiet hours with the "silence" mode: delivered without sound or banner.
    var silenced = false

    var id: String { occurrence.identifier }
    var fire: Double { occurrence.fire }
    var ruleID: UUID { occurrence.ruleID }
}

/// What the scheduler wants pending, soonest first.
struct AlertPlan: Hashable, Sendable {
    var alerts: [PlannedAlert] = []
    /// The next occurrence of every enabled rule (scheduled or not, merged or not), for the rule list.
    var next: [UUID: AlertOccurrence] = [:]
    /// The real now lies outside the catalogue: nothing can be read, nothing is scheduled.
    var outOfRange = false
    /// The instant the plan was made for.
    var now: Double = 0

    static let empty = AlertPlan()
}

struct AlertPlanner: Sendable {
    /// Identifier prefix of every Alerts request (ARCHITECTURE: features share the 64 pending requests by prefix).
    static let prefix = "alert."
    /// Alerts keeps at most this many requests pending, so Timer always has room within the system's 64.
    static let budget = 60

    let clock: FractonicaClock
    var budget = AlertPlanner.budget
    /// The most occurrences one rule is enumerated for.
    var perRule = AlertPlanner.budget
    /// Fair shares count a rule's occurrences up to this far ahead (a refill — opening the app, background refresh —
    /// almost always comes sooner); slots left over then reach further ahead, still fairly …
    var horizon: Double = 7 * 86_400
    /// … but always at least its next few.
    var minimumEach = 2

    init(clock: FractonicaClock = .shared) {
        self.clock = clock
    }

    // MARK: - The plan

    /// The notifications to keep pending at `now` (the device's real time, never the travelled one).
    func plan(rules: [AlertRule], quiet: QuietHours, zone: TimeZone, now: Double) -> AlertPlan {
        guard clock.inRange(now) else { return AlertPlan(outOfRange: true, now: now) }
        let active = rules.filter(\.enabled)
        var lists: [[AlertOccurrence]] = []
        var next: [UUID: AlertOccurrence] = [:]
        for rule in active {
            let skips = quiet.enabled && quiet.mode == .skip && !rule.ignoresQuietHours
            var list = occurrences(of: rule, after: now, limit: skips ? perRule * 3 : perRule)
            if skips { list.removeAll { quiet.contains($0.fire, zone: zone) } }
            list = Array(list.prefix(perRule))
            next[rule.id] = list.first
            lists.append(list)
        }

        // Moments that fall together are told once, by the most important subject.
        let merged = Self.mergeSimultaneous(lists, rank: active.map(\.subject.rank))
        let queues = merged.map { $0.map(\.fire) }
        let demands = queues.map { fires in
            max(min(minimumEach, fires.count), fires.count { $0 <= now + horizon })
        }
        var shares = Self.fairShare(queues, demands: demands, budget: budget)
        let left = budget - shares.reduce(0, +)
        if left > 0 {
            // Room to spare: queue further ahead, still fairly.
            let more = Self.fairShare(queues.enumerated().map { Array($1.dropFirst(shares[$0])) },
                                      demands: queues.enumerated().map { $1.count - shares[$0] }, budget: left)
            shares = zip(shares, more).map(+)
        }

        let ignores = Dictionary(active.map { ($0.id, $0.ignoresQuietHours) }, uniquingKeysWith: { a, _ in a })
        var alerts: [PlannedAlert] = []
        for (list, share) in zip(merged, shares) {
            for var alert in list.prefix(share) {
                let loud = ([alert.occurrence] + alert.also).contains { ignores[$0.ruleID] == true }
                alert.silenced = quiet.mode == .silence && !loud && quiet.contains(alert.fire, zone: zone)
                alerts.append(alert)
            }
        }
        alerts.sort { ($0.fire, $0.id) < ($1.fire, $1.id) }
        return AlertPlan(alerts: alerts, next: next, outOfRange: false, now: now)
    }

    /// Folds occurrences of different rules that fire within half a second of each other into the one whose subject
    /// ranks first (then the rule listed first). Returns each rule's remaining alerts, soonest first.
    static func mergeSimultaneous(_ lists: [[AlertOccurrence]], rank: [Double]) -> [[PlannedAlert]] {
        var all: [(rule: Int, occurrence: AlertOccurrence)] = []
        for (rule, list) in lists.enumerated() { all += list.map { (rule, $0) } }
        all.sort { ($0.occurrence.fire, $0.rule) < ($1.occurrence.fire, $1.rule) }
        var out = Array(repeating: [PlannedAlert](), count: lists.count)
        var i = 0
        while i < all.count {
            var j = i + 1
            while j < all.count && all[j].occurrence.fire - all[i].occurrence.fire < 0.5 { j += 1 }
            let group = all[i..<j]
            let winner = group.min { (rank[$0.rule], $0.rule) < (rank[$1.rule], $1.rule) }!
            let others = group.filter { $0.occurrence != winner.occurrence }.map(\.occurrence)
            out[winner.rule].append(PlannedAlert(occurrence: winner.occurrence, also: others))
            i = j
        }
        return out
    }

    /// Max-min fair shares of `budget` slots: every rule gets as many of its first `demands[i]` alerts as an equal
    /// split allows, what a rule does not need goes to the others, and slots that cannot be split evenly go to the
    /// rules whose next unshared alert is soonest. `queues[i]` are rule i's fire times, soonest first.
    static func fairShare(_ queues: [[Double]], demands: [Int], budget: Int) -> [Int] {
        let wants = zip(queues, demands).map { min($0.count, max(0, $1)) }
        var shares = Array(repeating: 0, count: queues.count)
        var left = max(0, budget)
        var active = wants.indices.filter { wants[$0] > 0 }
        while left > 0 && !active.isEmpty {
            let each = left / active.count
            if each == 0 {
                let soonest = active.sorted { (queues[$0][shares[$0]], $0) < (queues[$1][shares[$1]], $1) }
                for i in soonest.prefix(left) { shares[i] += 1 }
                break
            }
            for i in active {
                let give = min(each, wants[i] - shares[i])
                shares[i] += give
                left -= give
            }
            active.removeAll { shares[$0] >= wants[$0] }
        }
        return shares
    }

    // MARK: - Occurrences of one rule

    /// The rule's next `limit` occurrences that fire after `now`, soonest first; nothing outside the catalogue.
    func occurrences(of rule: AlertRule, after now: Double, limit: Int) -> [AlertOccurrence] {
        guard limit > 0, clock.inRange(now) else { return [] }
        // The earliest event whose notification can still fire: one lead after now.
        let from = eventTime(firingAt: now, lead: rule.lead) - 1
        guard from <= clock.tMax else { return [] }
        let start = max(clock.tMin, from)
        var list: [AlertOccurrence]
        switch rule.subject {
        case .level(let level): list = levelOccurrences(rule, level: level, from: start, now: now, limit: limit)
        case .solar: list = solarOccurrences(rule, from: start, now: now, limit: limit)
        case .eclipse: list = eclipseOccurrences(rule, now: now, limit: limit)
        }
        list.sort { ($0.time, $0.event) < ($1.time, $1.event) }
        return Array(Self.mergeTurnovers(list).prefix(limit))
    }

    /// When an event's notification fires: `lead` earlier. Earth leads are exact spans of seconds; Fractonica leads
    /// are exact counts of cycles, measured in position (so "1η before" a Helion begins is exactly the previous one).
    func fireTime(event t: Double, lead: AlertLead) -> Double {
        guard lead.count > 0 else { return t }
        if let seconds = lead.unit.seconds { return t - Double(lead.count) * seconds }
        let info = clock.levelInfo(lead.unit.level!)
        let span = Double(lead.count) * 4 / info.prefixDouble
        if let p = clock.position(at: t), p - span > 0 { return clock.time(atPosition: p - span) }
        return t - Double(lead.count) * info.meanSeconds
    }

    /// The inverse: the event time whose notification fires at `t`.
    func eventTime(firingAt t: Double, lead: AlertLead) -> Double {
        guard lead.count > 0 else { return t }
        if let seconds = lead.unit.seconds { return t + Double(lead.count) * seconds }
        let info = clock.levelInfo(lead.unit.level!)
        let span = Double(lead.count) * 4 / info.prefixDouble
        if let p = clock.position(at: t), p + span < Double(clock.extent) { return clock.time(atPosition: p + span) }
        return t + Double(lead.count) * info.meanSeconds
    }

    /// Cycle indices of `level` whose `event` the rule's filters allow: c ≡ r (mod m), or nil for none.
    /// The ordinal filter keeps one place in the parent; a coarser turnover keeps the cycles that begin (or end) on a
    /// coarser boundary, which are always the first (or last) in their parent.
    func progression(_ rule: AlertRule, level: Int, event: AlertEvent) -> (r: Int64, m: Int64)? {
        var r: Int64 = 0
        var m: Int64 = 1
        if let coarser = rule.coarser {
            guard event.isTurnover, coarser < level else { return nil }
            let ratio = Int64(clock.levelInfo(level).prefix / clock.levelInfo(coarser).prefix)
            r = event == .begin ? 0 : ratio - 1
            m = ratio
        }
        if let ordinal = rule.ordinal {
            let places = Int64(AlertRule.places(level: level, clock: clock))
            let want = Int64(ordinal - 1)
            guard (0..<places).contains(want) else { return nil }
            if m % places == 0 {
                guard r % places == want else { return nil }
            } else {
                r = want
                m = places
            }
        }
        return (r, m)
    }

    /// The coarsest level whose cycle begins where cycle `cycle` of `level` begins (the level itself if none).
    func topLevel(level: Int, beginning cycle: Int64) -> Int {
        var top = level
        var ratio: Int64 = 1
        var l = level
        while l > 0, let siblings = clock.levelInfo(l).siblings {
            ratio *= Int64(siblings)
            guard cycle % ratio == 0 else { break }
            top = l - 1
            l -= 1
        }
        return top
    }

    private func levelOccurrences(_ rule: AlertRule, level: Int, from: Double, now: Double, limit: Int) -> [AlertOccurrence] {
        guard let first = clock.level(at: from, level)?.cycle else { return [] }
        var out: [AlertOccurrence] = []
        for event in rule.events.sorted() {
            guard let (r, m) = progression(rule, level: level, event: event) else { continue }
            var c = first + (((r - first) % m) + m) % m
            var found = 0
            var steps = 0
            while found < limit && steps < limit + 4 {
                steps += 1
                guard let facts = clock.cycle(level: level, index: c), let t = facts.events[event.index].time else { break }
                let fire = fireTime(event: t, lead: rule.lead)
                if fire > now {
                    let top = event == .begin ? topLevel(level: level, beginning: c)
                        : event == .end ? topLevel(level: level, beginning: c + 1) : level
                    out.append(AlertOccurrence(ruleID: rule.id, subject: rule.subject, event: event, events: [event],
                                               index: c, top: top, time: t, fire: fire))
                    found += 1
                }
                let (next, overflow) = c.addingReportingOverflow(m)
                if overflow { break }
                c = next
            }
        }
        return out
    }

    private func solarOccurrences(_ rule: AlertRule, from: Double, now: Double, limit: Int) -> [AlertOccurrence] {
        let anchor = clock.catalogue[20]
        let syncSeconds = 4 * 86_400.0
        // The drift is about −10 s per sync: one sync of slack covers it for centuries.
        var n = Int(((from - anchor) / syncSeconds).rounded(.down)) - 1
        let events = rule.events.sorted()
        var out: [AlertOccurrence] = []
        var misses = 0
        while out.count < limit * events.count && misses < 3 {
            guard let sync = clock.solarSync(number: n) else {
                if !out.isEmpty || n > 0 && from > anchor { misses += 3 } else { misses += 1 }
                n += 1
                continue
            }
            let length = sync.end - sync.start
            for event in events {
                let t = event == .end ? sync.end : sync.start + length * Double(event.index) / 4
                let fire = fireTime(event: t, lead: rule.lead)
                if fire > now {
                    out.append(AlertOccurrence(ruleID: rule.id, subject: .solar, event: event, events: [event],
                                               index: Int64(n), top: -1, time: t, fire: fire))
                }
            }
            n += 1
        }
        return out
    }

    private func eclipseOccurrences(_ rule: AlertRule, now: Double, limit: Int) -> [AlertOccurrence] {
        var out: [AlertOccurrence] = []
        for (k, t) in clock.catalogue.enumerated() {
            let fire = fireTime(event: t, lead: rule.lead)
            guard fire > now else { continue }
            out.append(AlertOccurrence(ruleID: rule.id, subject: .eclipse, event: .begin, events: [.begin],
                                       index: Int64(k), top: -1, time: t, fire: fire))
            if out.count >= limit { break }
        }
        return out
    }

    /// One cycle's end and the next one's beginning are the same instant: told once, as the beginning (sorted input).
    static func mergeTurnovers(_ list: [AlertOccurrence]) -> [AlertOccurrence] {
        var out: [AlertOccurrence] = []
        for o in list {
            if let last = out.last, abs(o.time - last.time) < 0.002, last.subject == o.subject {
                let begin = last.event == .begin ? last : o.event == .begin ? o : last
                out[out.count - 1] = AlertOccurrence(
                    ruleID: begin.ruleID, subject: begin.subject, event: begin.event,
                    events: Array(Set(last.events + o.events)).sorted(), index: begin.index, top: min(last.top, o.top),
                    time: begin.time, fire: begin.fire)
            } else {
                out.append(o)
            }
        }
        return out
    }
}
