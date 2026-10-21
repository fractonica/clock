import Foundation

/// Screenshot states of the Timer and the Stopwatch, from launch arguments (UserDefaults' argument domain, never
/// persisted). A demo store saves nothing, posts no notification and starts no Live Activity.
///
///     -FXTimerNow <unix s>         the instant the device clock reads at launch, for these two screens only (other
///                                  catalogue instants, its edges, outside it); timing stays on the device clock
///     -FXTimerDemo <state>         setup · earth (Earth wheels) · running · paused · long (11η) · aligned (until the
///                                  next η) · earthrun (an Earth 5 min timer) · done (the ring alert)
///     -FXStopwatchDemo <state>     running · stopped · long (past a Helion)
///     -FXStopwatchFace digits|dial the stopwatch's face
///     -FXTimerActivity timer|paused|stopwatch   (debug builds) the Live Activity's views drawn in the app
struct TimerDemo {
    var now: Double?
    var timer: String?
    var stopwatch: String?

    static func current(_ defaults: UserDefaults = .standard) -> TimerDemo {
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        return TimerDemo(
            now: string("FXTimerNow").flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil },
            timer: string("FXTimerDemo")?.lowercased(),
            stopwatch: string("FXStopwatchDemo")?.lowercased()
        )
    }

    /// The real clock these screens use: shifted so that launch reads `now`.
    var clock: RealClock {
        guard let now else { return RealClock() }
        return RealClock(offset: now - Date.now.timeIntervalSince1970)
    }

    /// Puts the timer into its demo state; false (nothing done) without timer arguments.
    @MainActor
    func apply(timer store: TimerStore) -> Bool {
        guard timer != nil || now != nil else { return false }
        let clock = clock
        let now = Date.now
        /// Blinks as device seconds here (a mean Blink outside the catalogue).
        let blink = clock.blinkSeconds(at: now) ?? clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds
        func started(_ spec: TimerSpec, ago blinks: Int) -> TimerRun? {
            try? TimerRun.start(spec, at: now.addingTimeInterval(-Double(blinks) * blink), clock: clock).get()
        }
        var run: TimerRun?
        var draft: TimerStore.Draft?
        var ringing: TimerSpec?
        switch timer {
        case "earth":
            draft = TimerStore.Draft(ladder: LadderSpan(iota: 4), earthSeconds: 25 * 60, input: .earth)
        case "running":
            run = started(.ladder(LadderSpan(iota: 4)), ago: LadderSpan(iota: 1, lambda: 51, nu: 18).blinks)
        case "paused":
            run = started(.ladder(LadderSpan(iota: 4)), ago: LadderSpan(iota: 1, lambda: 51, nu: 18).blinks)
            run?.pause(at: now, clock: clock)
        case "long":
            run = started(.ladder(LadderSpan(eta: 11)), ago: LadderSpan(eta: 3, iota: 12, lambda: 40).blinks)
        case "aligned":
            if let target = AlignedTarget.next(level: 6, after: clock.t(now)) { run = started(.aligned(target), ago: 0) }
        case "earthrun":
            run = try? TimerRun.start(.earth(seconds: 300), at: now.addingTimeInterval(-72.4), clock: clock).get()
        case "done":
            ringing = .ladder(LadderSpan(iota: 4))
        default:
            draft = TimerStore.Draft(ladder: LadderSpan(iota: 4), earthSeconds: 300, input: .ladder)
        }
        store.demo(clock: clock, run: run, draft: draft, ringing: ringing)
        return true
    }

    /// Puts the stopwatch into its demo state; false without stopwatch arguments.
    @MainActor
    func apply(stopwatch store: StopwatchStore) -> Bool {
        guard stopwatch != nil || now != nil else { return false }
        let clock = clock
        let now = Date.now
        let blink = clock.blinkSeconds(at: now) ?? clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds
        func seconds(_ span: LadderSpan) -> Double { Double(span.blinks) * blink + 0.137 }
        var run = StopwatchRun()
        switch stopwatch {
        case "running", "stopped":
            let laps = [LadderSpan(lambda: 58, nu: 12), LadderSpan(iota: 1, lambda: 4, nu: 3), LadderSpan(lambda: 61, nu: 20)]
            let total = LadderSpan(iota: 3, lambda: 22, nu: 14)
            run.since = now.addingTimeInterval(-seconds(total))
            var mark = 0.0
            for lap in laps {
                mark += seconds(lap)
                run.marks.append(mark)
            }
            if stopwatch == "stopped" { run.stop(at: now) }
        case "long":
            run.since = now.addingTimeInterval(-seconds(LadderSpan(eta: 1, iota: 3, lambda: 22, nu: 14)))
            run.marks = [seconds(LadderSpan(iota: 20, lambda: 5)), seconds(LadderSpan(iota: 41, lambda: 30)), seconds(LadderSpan(eta: 1, iota: 1))]
        default:
            break
        }
        store.demo(clock: clock, run: run)
        return true
    }
}
