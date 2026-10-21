import FractonicaKit
import Foundation

// The Timer's logic: the ladder units and readouts, real time measured in position, timer runs (start, pause,
// resume, add, aligned ends), the stopwatch and the tick schedule. Run: ios/scripts/check.sh ios/Fractonica/Features/Timer/Checks

@main
struct TimerChecks {
    static func main() {
        unitChecks()
        spanChecks()
        clockChecks()
        timerChecks()
        alignedChecks()
        stopwatchChecks()
        scheduleChecks()
        earthChecks()
        Checks.finish()
    }
}

/// SPEC §12 vector A, 2026-10-08 12:00 UTC: the clock reads ε#5 34η 29ι 21λ 3ν.
private let vectorA = 1_791_460_800.0
private let clock = FractonicaClock.shared
private let notation = Notation.standard

private func close(_ a: Double, _ b: Double, _ tolerance: Double) -> Bool { abs(a - b) <= tolerance }

private func unitChecks() {
    check(LadderUnit.eta.blinks == 36 * LadderUnit.iota.blinks, "a Helion is 36 Preons")
    check(LadderUnit.iota.blinks == 65 * LadderUnit.lambda.blinks, "a Preon is 65 Flavons")
    check(LadderUnit.lambda.blinks == 25 * LadderUnit.nu.blinks, "a Flavon is 25 Blinks")
    for unit in LadderUnit.allCases {
        let ratio = notation.cyclePos(unit.level) / notation.cyclePos(LadderUnit.nu.level)
        check(close(ratio, Double(unit.blinks), 1e-6), "\(unit.symbol) is \(unit.blinks) Blinks on the clock: \(ratio)")
        let parent = unit == .eta ? 4 : unit.level - 2
        let perParent = notation.cyclePos(parent) / notation.cyclePos(unit.level)
        check(close(perParent, Double(unit.perParent), 1e-6), "\(unit.perParent) \(unit.symbol) make the next unit: \(perParent)")
        let between = notation.cyclePos(unit.level - 1) / notation.cyclePos(unit.level)
        check(close(between, Double(unit.group), 1e-6), "the depth above \(unit.symbol) is \(unit.group) of it: \(between)")
    }
    check(LadderUnit.eta < .iota && LadderUnit.lambda < .nu, "coarse units sort first")
    check(LadderUnit.iota.downToBlink == [.iota, .lambda, .nu], "units down to the Blink")
    check(LadderUnit.nu.finer == nil && LadderUnit.eta.finer == .iota, "finer units")
}

private func spanChecks() {
    let a = LadderSpan(iota: 2, lambda: 13, nu: 7)
    check(a.readout(from: .iota) == "02ι 13λ 07ν", "the brief's countdown: \(a.readout(from: .iota))")
    check(a.name == "2ι 13λ 7ν", "the name skips nothing but zeros: \(a.name)")
    check(a.spokenReadout(from: .iota) == "2 Preons 13 Flavons 7 Blinks", "spoken: \(a.spokenReadout(from: .iota))")
    let b = LadderSpan(eta: 1, iota: 3, lambda: 22, nu: 14)
    check(b.readout(from: .eta, padLead: false) == "1η 03ι 22λ 14ν", "the brief's stopwatch: \(b.readout(from: .eta, padLead: false))")
    check(LadderSpan(iota: 4).readout(from: .iota) == "04ι 00λ 00ν", "a 4ι timer at its start")
    check(LadderSpan(iota: 4).name == "4ι" && LadderSpan(eta: 1, iota: 12).name == "1η 12ι", "names")
    check(LadderSpan(blinks: 0).name == "0ν" && LadderSpan(blinks: 0).lead == .nu, "the empty span")
    check(LadderSpan(eta: 80).count(.eta) == 80, "Helions are not wrapped")
    check(LadderSpan(blinks: 6497).readout(from: .iota) == "03ι 64λ 22ν", "carries: \(LadderSpan(blinks: 6497).readout(from: .iota))")
    check(LadderSpan(blinks: -5).blinks == 0, "negative spans are empty")

    check(LadderReadout.timerLead(total: LadderSpan(lambda: 13)) == .lambda, "a 13λ timer reads λ ν")
    check(LadderReadout.timerLead(total: LadderSpan(nu: 20)) == .lambda, "a 20ν timer still reads λ ν")
    check(LadderReadout.timerLead(total: LadderSpan(iota: 4)) == .iota, "a 4ι timer reads ι λ ν")
    check(LadderReadout.timerLead(total: LadderSpan(eta: 11)) == .eta, "an 11η timer reads η ι λ ν")
    check(LadderReadout.stopwatchLead(elapsed: LadderSpan(iota: 35, lambda: 64)) == .iota, "under a Helion: ι λ ν")
    check(LadderReadout.stopwatchLead(elapsed: LadderSpan(eta: 1)) == .eta, "from a Helion on: η ι λ ν")

    check(LadderReadout.ceilBlinks(6500.0000001) == 6500, "float noise does not add a Blink")
    check(LadderReadout.ceilBlinks(6499.2) == 6500, "a started Blink counts whole")
    check(LadderReadout.ceilBlinks(0.0004) == 0 && LadderReadout.ceilBlinks(-3) == 0 && LadderReadout.ceilBlinks(.nan) == 0, "nothing left")
    check(LadderReadout.floorBlinks(24.9999999) == 25 && LadderReadout.floorBlinks(24.6) == 24, "elapsed rounds down")

    check(TimerPresets.meaning(LadderSpan(iota: 1)) == "one Preon", "preset words: \(TimerPresets.meaning(LadderSpan(iota: 1)))")
    check(TimerPresets.meaning(LadderSpan(iota: 2)) == "2 Preons", "preset words: \(TimerPresets.meaning(LadderSpan(iota: 2)))")
    check(TimerPresets.meaning(LadderSpan(iota: 4)) == "one θ", "θ is 4ι")
    check(TimerPresets.meaning(LadderSpan(eta: 11)) == "one ζ", "ζ is 11η")
    check(TimerPresets.meaning(LadderSpan(lambda: 13)) == "one κ", "κ is 13λ")
    for span in TimerPresets.spans {
        let level = [325: 9, 1625: 8, 6500: 7, 58_500: 6, 643_500: 5][span.blinks]
        if let level {
            check(notation.cycleLength(level: level) == span.name, "preset \(span.name) is one cycle of level \(level): \(notation.cycleLength(level: level))")
        }
    }
}

private func clockChecks() {
    let real = RealClock(offset: vectorA - 1_000_000)
    let now = Date(timeIntervalSince1970: 1_000_000)
    check(real.t(now) == vectorA && real.date(vectorA) == now, "the offset maps device dates to the clock")
    guard let blink = real.blinkSeconds(at: now) else { return check(false, "a Blink at A") }
    check(close(blink, 0.31092, 0.0001), "a Blink is about 311 ms: \(blink)")
    guard let end = real.date(after: now, blinks: 6500) else { return check(false, "4ι after A") }
    let seconds = end.timeIntervalSince(now)
    check(close(seconds, 6500 * blink, 1e-4), "4ι is 6500 Blinks of real time: \(seconds)")
    check(notation.duration(seconds, at: vectorA) == "4ι", "the notation reads it as 4ι: \(notation.duration(seconds, at: vectorA))")
    guard let back = real.blinks(from: now, to: end) else { return check(false, "blinks back") }
    check(close(back, 6500, 1e-3) && LadderReadout.ceilBlinks(back) == 6500, "and measures back to 6500: \(back)")
    check(real.blinks(from: end, to: now).map { close($0, -6500, 1e-3) } == true, "backwards is negative")

    let outside = RealClock(offset: clock.tMax + 100 - 1_000_000)
    check(!outside.inRange(now) && outside.blinkSeconds(at: now) == nil, "past the catalogue there is no Blink")
    check(outside.date(after: now, blinks: 10) == nil && outside.blinks(from: now, to: now) == nil, "nor any span")
    let nearEnd = RealClock(offset: clock.tMax - 100 - 1_000_000)
    check(nearEnd.date(after: now, blinks: 6500) == nil, "a span past the catalogue's end cannot be laid out")
    check(nearEnd.date(after: now, blinks: 25).map { $0.timeIntervalSince(now) < 100 } == true, "one inside it can")
    let nearStart = RealClock(offset: clock.tMin + 0.5 - 1_000_000)
    check(nearStart.blinkSeconds(at: now) != nil && nearStart.date(after: now, blinks: 25) != nil, "the catalogue's first moments read")
}

private func timerChecks() {
    let real = RealClock(offset: vectorA - 1_000_000)
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    guard case .success(var run) = TimerRun.start(.ladder(LadderSpan(iota: 4)), at: t0, clock: real) else {
        return check(false, "a 4ι timer starts at A")
    }
    check(run.isRunning && run.measure == .ladder && run.total == 6500, "running, in Blinks")
    check(run.remaining(at: t0, clock: real).map { LadderReadout.ceilBlinks($0) } == 6500, "6500 Blinks left at the start")
    check(run.fraction(at: t0, clock: real) > 0.9999, "full at the start")
    let t1 = t0.addingTimeInterval(1)
    let left1 = run.remaining(at: t1, clock: real).map { LadderReadout.ceilBlinks($0) }
    check(left1 == 6497, "one second later 6497 Blinks are left: \(String(describing: left1))")
    check(run.totalSpan(at: t0, clock: real) == LadderSpan(iota: 4), "the total span")

    run.pause(at: t0.addingTimeInterval(100), clock: real)
    check(!run.isRunning && run.left.map { close($0, 6500 - 100 / 0.31092, 1) } == true, "pausing keeps what is left: \(String(describing: run.left))")
    let left = run.left!
    check(run.remaining(at: t0.addingTimeInterval(5000), clock: real) == left, "a paused timer does not run")
    check(!run.isDone(at: t0.addingTimeInterval(1e6)), "nor ring")
    let resumeAt = t0.addingTimeInterval(1000)
    check(run.resume(at: resumeAt, clock: real) && run.isRunning, "resumes")
    check(run.remaining(at: resumeAt, clock: real).map { close($0, left, 1e-3) } == true, "with the same span left")
    check(run.add(blinks: LadderUnit.iota.blinks, at: resumeAt, clock: real), "+1ι")
    check(run.total == 8125 && run.remaining(at: resumeAt, clock: real).map { close($0, left + 1625, 1e-3) } == true, "+1ι adds 1625 Blinks")
    check(run.isDone(at: run.end!) && !run.isDone(at: run.end!.addingTimeInterval(-0.01)), "rings at its end")
    check(run.fraction(at: run.end!.addingTimeInterval(5), clock: real) == 0, "empty after its end")

    check(TimerRun.start(.ladder(LadderSpan()), at: t0, clock: real).failure == .empty, "an empty timer does not start")
    let outside = RealClock(offset: clock.tMax + 100 - 1_000_000)
    check(TimerRun.start(.ladder(LadderSpan(iota: 1)), at: t0, clock: outside).failure == .outsideCatalogue, "nor one outside the catalogue")

    guard case .success(var earth) = TimerRun.start(.earth(seconds: 300), at: t0, clock: outside) else {
        return check(false, "an Earth timer runs anywhere")
    }
    check(earth.remaining(at: t0.addingTimeInterval(100), clock: outside) == 200, "Earth timers count seconds")
    check(earth.remainingBlinks(at: t0, clock: outside) == nil, "but have no Blinks outside the catalogue")
    earth.pause(at: t0.addingTimeInterval(100), clock: outside)
    check(earth.left == 200, "pausing an Earth timer keeps its seconds")
    _ = earth.resume(at: t0.addingTimeInterval(400), clock: outside)
    check(earth.end == t0.addingTimeInterval(600), "and resuming lays them out again")
    earth.add(seconds: 60, at: t0, clock: outside)
    check(earth.end == t0.addingTimeInterval(660) && earth.total == 360, "+1 min")

    let earthInside = TimerRun.start(.earth(seconds: 300), at: t0, clock: real)
    if case .success(let e) = earthInside {
        let blinks = e.remainingBlinks(at: t0, clock: real) ?? 0
        check(close(blinks, 300 / real.blinkSeconds(at: t0)!, 1e-6), "Earth seconds read as Blinks inside the catalogue")
    }

    // Codable round trip
    let data = try? JSONEncoder().encode(run)
    let decoded = data.flatMap { try? JSONDecoder().decode(TimerRun.self, from: $0) }
    check(decoded == run, "a run survives storage")
}

private func alignedChecks() {
    guard let iota = AlignedTarget.next(level: 8, after: vectorA) else { return check(false, "the next ι after A") }
    check(iota.time > vectorA && iota.time - vectorA <= clock.levelInfo(8).meanSeconds * 1.001, "within one Preon")
    check(iota.name(notation) == "30ι", "A reads 34η 29ι, so 30ι begins next: \(iota.name(notation))")
    check(AlignedTarget.next(level: 6, after: vectorA)?.name(notation) == "35η", "then 35η")
    check(AlignedTarget.next(level: 4, after: vectorA)?.name(notation) == "ε#1", "A is in ε#5, the last of its Delta: ε#1 is next")
    check(AlignedTarget.next(level: 7, after: vectorA)?.name(notation) == "32ι", "θ starts on multiples of 4ι: 32ι")
    if let next = AlignedTarget.next(level: 8, after: iota.time) {
        check(next.cycle == iota.cycle + 1 && close(next.time - iota.time, clock.levelInfo(8).meanSeconds, 1), "at a boundary the following cycle is next")
    }
    check(AlignedTarget.next(level: 8, after: clock.tMax + 10) == nil, "nothing outside the catalogue")
    check(AlignedTarget.next(level: 4, after: clock.tMax - 1000) == nil, "nor once the last cycle runs")
    check(AlignedTarget.word(level: 7) == "θ" && AlignedTarget.word(level: 8) == "Preon" && AlignedTarget.word(level: 4) == "Nuclide", "level words")

    let real = RealClock(offset: vectorA - 1_000_000)
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    guard case .success(let run) = TimerRun.start(.aligned(iota), at: t0, clock: real) else { return check(false, "an aligned timer starts") }
    check(run.end == real.date(iota.time), "and rings as the cycle begins")
    check(run.remaining(at: t0, clock: real).map { close($0, run.total, 1e-9) } == true, "its total is the Blinks to go")
    let reading = clock.level(at: vectorA, 8)!
    check(close(run.total * real.blinkSeconds(at: t0)!, reading.remaining, 1e-3), "which the clock reads as the Preon's remaining time")
    let late = RealClock(offset: iota.time + 1 - 1_000_000)
    check(TimerRun.start(.aligned(iota), at: t0, clock: late).failure == .empty, "a passed boundary does not start")
}

private func stopwatchChecks() {
    let t = { (s: Double) in Date(timeIntervalSince1970: 1_000_000 + s) }
    var w = StopwatchRun()
    check(w.isClear && !w.isRunning && w.laps(at: t(0)).isEmpty, "a clear stopwatch")
    w.start(at: t(0))
    w.lap(at: t(10))
    w.lap(at: t(25))
    w.stop(at: t(30))
    check(w.elapsed(at: t(35)) == 30 && !w.isRunning, "stopped at 30 s")
    w.lap(at: t(36))
    check(w.marks.count == 2, "no laps while stopped")
    w.start(at: t(40))
    check(w.elapsed(at: t(45)) == 35, "runs on from what it banked")
    check(w.zero(at: t(45)) == t(10), "a continuous run from 10 s would read the same")
    let laps = w.laps(at: t(45))
    check(laps.map(\.number) == [3, 2, 1], "newest lap first")
    check(laps[0].isCurrent && laps[0].span == 10 && laps[0].split == 35, "the running lap: \(laps[0])")
    check(laps[1].span == 15 && laps[1].split == 25 && laps[2].span == 10 && laps[2].split == 10, "finished laps")
    check(w.extremes.map { $0.fastest == 1 && $0.slowest == 2 } == true, "fastest and slowest")
    w.start(at: t(50))
    check(w.since == t(40), "starting a running stopwatch changes nothing")
    let data = try? JSONEncoder().encode(w)
    check(data.flatMap { try? JSONDecoder().decode(StopwatchRun.self, from: $0) } == w, "a stopwatch survives storage")
    w.reset()
    check(w.isClear, "reset clears")
    var same = StopwatchRun()
    same.start(at: t(0))
    same.lap(at: t(10))
    same.lap(at: t(20))
    check(same.extremes == nil, "equal laps have no extremes")
}

private func scheduleChecks() {
    let anchor = Date(timeIntervalSince1970: 100)
    let s = TickSchedule(anchor: anchor, steps: [1])
    check(s.tick(after: Date(timeIntervalSince1970: 100.5)) == Date(timeIntervalSince1970: 101), "the next second")
    check(s.tick(after: Date(timeIntervalSince1970: 98.2)) == Date(timeIntervalSince1970: 99), "grids run both ways from the anchor")
    check(s.tick(after: Date(timeIntervalSince1970: 100.999)) == Date(timeIntervalSince1970: 102), "never closer than the minimum gap")
    let both = TickSchedule(anchor: anchor, steps: [1, 0.3])
    check(both.tick(after: Date(timeIntervalSince1970: 100.5)).map { close($0.timeIntervalSince1970, 100.6, 1e-6) } == true, "the nearer grid wins")
    check(TickSchedule(anchor: anchor, steps: [0, .nan]).tick(after: anchor) == nil, "no usable grid, no ticks")
    var paused = TickSchedule(anchor: anchor, steps: [1], paused: true).entries(from: anchor, mode: .normal)
    check(paused.next() == anchor && paused.next() == nil, "paused: one entry")
}

private func earthChecks() {
    check(EarthClockText.countdown(299.2) == "5:00" && EarthClockText.countdown(300) == "5:00", "a countdown rounds up")
    check(EarthClockText.countdown(3600) == "1:00:00" && EarthClockText.countdown(59.5) == "1:00" && EarthClockText.countdown(0) == "0:00", "countdowns")
    check(EarthClockText.stopwatch(28.47) == "00:28.47", "stopwatch: \(EarthClockText.stopwatch(28.47))")
    check(EarthClockText.stopwatch(3725.1) == "1:02:05.10", "stopwatch hours: \(EarthClockText.stopwatch(3725.1))")
    check(EarthClockText.name(seconds: 300) == "5 min" && EarthClockText.name(seconds: 5445) == "1 h 30 min 45 s", "Earth names")
}

extension Result {
    var failure: Failure? {
        if case .failure(let error) = self { return error }
        return nil
    }
}
