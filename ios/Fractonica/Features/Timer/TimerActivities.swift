#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import Foundation

/// Starts, updates and ends the Live Activities of the timer and the stopwatch (one of each at most). The activity of
/// a run is found by its id; activities of runs that are gone (cancelled, rung, reset, or left over from an earlier
/// launch) are ended.
@MainActor
enum TimerActivities {
    typealias Attributes = TimerActivityAttributes

    /// Shows `state` for the run `runID` of `kind`; nil ends every activity of that kind.
    static func show(_ kind: Attributes.Kind, runID: String?, state: Attributes.ContentState?, staleDate: Date? = nil) {
        let all = Activity<Attributes>.activities.filter { $0.attributes.kind == kind }
        let keep = runID.flatMap { id in
            all.first { $0.attributes.runID == id && ($0.activityState == .active || $0.activityState == .stale) }
        }
        for activity in all where activity.id != keep?.id {
            let id = activity.id
            Task { await end(id: id) }
        }
        guard let runID, let state else { return }
        let content = ActivityContent(state: state, staleDate: staleDate)
        if let keep {
            guard keep.content.state != state || keep.content.staleDate != staleDate else { return }
            let id = keep.id
            Task { await update(id: id, with: content) }
        } else if ActivityAuthorizationInfo().areActivitiesEnabled {
            _ = try? Activity.request(attributes: Attributes(kind: kind, runID: runID), content: content, pushType: nil)
        }
    }

    /// Activities are not Sendable: they are looked up again where they are ended or updated.
    nonisolated private static func end(id: String) async {
        for activity in Activity<Attributes>.activities where activity.id == id {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    nonisolated private static func update(id: String, with content: ActivityContent<Attributes.ContentState>) async {
        for activity in Activity<Attributes>.activities where activity.id == id {
            await activity.update(content)
        }
    }

    // MARK: Content

    /// The activity of a timer run.
    static func state(for run: TimerRun, words: TimerWords) -> Attributes.ContentState {
        let now = words.now
        let total = max(1, run.totalSeconds(at: now, clock: words.clock))
        let left = run.remainingSeconds(at: now, clock: words.clock)
        let title = words.title(run.spec)
        if let end = run.end {
            let reading = words.clockReading(end, upTo: "iota")
            return Attributes.ContentState(
                title: title,
                start: end.addingTimeInterval(-total),
                end: end,
                pausedAt: nil,
                reading: reading == "—" ? title : reading,
                compact: compactTitle(run, words: words),
                // the end led by its Pentad, in words: the Live Activity's strings stay plain text
                detail: words.pure ? "Ends at \(words.led(words.clockReading(end), at: end))"
                    : "Ends \(words.led(words.ringTime(end, short: true), at: end))",
                pure: words.pure
            )
        }
        let blinks = run.remainingBlinks(at: now, clock: words.clock).map(LadderReadout.ceilBlinks)
        let lead = LadderReadout.timerLead(total: run.totalSpan(at: now, clock: words.clock))
        let readout = blinks.map { LadderSpan(blinks: $0).readout(from: lead) } ?? "—"
        return Attributes.ContentState(
            title: title,
            start: now.addingTimeInterval(left - total),
            end: now.addingTimeInterval(left),
            pausedAt: now,
            reading: readout,
            compact: blinks.map { leadName(LadderSpan(blinks: $0)) } ?? "—",
            detail: words.pure ? "Paused" : "Paused · \(readout)",
            pure: words.pure
        )
    }

    /// The activity of a stopwatch that is not clear.
    static func state(for run: StopwatchRun, words: TimerWords) -> Attributes.ContentState {
        let now = words.now
        let zero = run.zero(at: now)
        let laps = run.marks.count
        let lapText = laps == 0 ? "" : " · \(laps) lap\(laps == 1 ? "" : "s")"
        let blink = words.clock.blinkSeconds(at: now) ?? words.clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds
        let blinks: Int? = LadderReadout.floorBlinks(run.elapsed(at: now) / blink)
        let reading = blinks.map { b in
            let span = LadderSpan(blinks: b)
            let lead = LadderReadout.stopwatchLead(elapsed: span)
            return span.readout(from: lead, padLead: lead != .eta)
        } ?? "—"
        let running = run.isRunning
        return Attributes.ContentState(
            title: "Stopwatch",
            start: zero,
            end: zero.addingTimeInterval(400 * 24 * 3600),
            pausedAt: running ? nil : now,
            reading: running ? "" : reading,
            compact: running ? "●" : (blinks.map { leadName(LadderSpan(blinks: $0)) } ?? "—"),
            detail: running
                ? (words.pure ? "Counting from \(words.clockReading(zero))" : "Running") + lapText
                : (words.pure ? "Stopped" : "Stopped at \(reading)") + lapText,
            pure: words.pure
        )
    }

    /// The compact island's pure reading: the timer's name when short ("4ι"), else its leading unit ("1η").
    private static func compactTitle(_ run: TimerRun, words: TimerWords) -> String {
        let title = words.title(run.spec)
        if title.count <= 4 { return title }
        return leadName(run.totalSpan(at: words.now, clock: words.clock))
    }

    /// "2ι": the leading unit of a span alone.
    private static func leadName(_ span: LadderSpan) -> String {
        "\(span.count(span.lead))\(span.lead.symbol)"
    }
}
#endif
