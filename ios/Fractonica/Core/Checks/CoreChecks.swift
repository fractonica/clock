import FractonicaKit
import Foundation
import SwiftUI

// The shell's state against the web app's semantics: AppSettings (src/core/store.js validation and persistence),
// ClockStore (the store's time model and src/main.js stepCycle), ClockTickSchedule (the periodic cadence) and
// AppLink (URL round trips). Run: ios/scripts/check.sh ios/Fractonica/Core/Checks

@main @MainActor
struct CoreChecks {
    static func main() async {
        settingsChecks()
        storeChecks()
        await edgeStopChecks()
        scheduleChecks()
        linkChecks()
        wordingChecks()
        Checks.finish()
    }
}

@MainActor
private func settingsChecks() {
    let suite = "fx.checks.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }

    let a = AppSettings(defaults: defaults)
    check(a.values == AppSettings.Values(), "fresh settings are the defaults")
    check(!a.pure && a.zone == nil && a.faceMode == .journal && a.journalUnit == 5 && a.topDepth == 7
        && a.selectedLevel == 6 && a.minDepth == 1 && a.maxDepth == 10 && !a.showLetters && a.haptics,
        "the defaults are store.js DEFAULTS: \(a.values)")

    a.pure = true
    a.zone = "Europe/Moscow"
    a.topDepth = 9
    a.faceMode = .watch
    a.journalUnit = 2
    a.selectedLevel = 13
    a.minDepth = 3
    a.maxDepth = 12
    a.showLetters = true
    a.haptics = false
    check(AppSettings(defaults: defaults).values == a.values, "every setting persists")

    a.zone = "Mars/Olympus_Mons"
    a.topDepth = 12
    a.topDepth = 1
    a.selectedLevel = 14
    a.selectedLevel = -1
    a.journalUnit = 7
    a.minDepth = 0
    a.maxDepth = 15
    check(a.zone == "Europe/Moscow" && a.topDepth == 9 && a.selectedLevel == 13 && a.journalUnit == 2
        && a.minDepth == 3 && a.maxDepth == 12, "invalid values are ignored: \(a.values)")
    check(AppSettings(defaults: defaults).values == a.values, "invalid values are never stored")

    a.maxDepth = 2
    check(a.minDepth == 2 && a.maxDepth == 2, "a max below the min pulls the min down to it: \(a.minDepth)…\(a.maxDepth)")
    a.minDepth = 5
    check(a.minDepth == 2, "a min above the max keeps the current min: \(a.minDepth)")
    a.zone = nil
    check(AppSettings(defaults: defaults).zone == nil, "the system zone persists as nil")

    a.pure = false
    a.override(pure: true, zone: "UTC")
    check(a.pure && a.zone == "UTC", "launch overrides are shown")
    a.topDepth = 4
    let reloaded = AppSettings(defaults: defaults)
    check(!reloaded.pure && reloaded.zone == nil && reloaded.topDepth == 4, "overrides are never saved: \(reloaded.values)")
    check(a.pure && a.zone == "UTC", "overrides stay shown after other changes are saved")

    let before = AppSettings(defaults: defaults).values
    a.override(selectedLevel: 3, minDepth: 12, maxDepth: 14)
    check(a.selectedLevel == 3 && a.minDepth == 12 && a.maxDepth == 14, "level and depth overrides are shown: \(a.values)")
    check(AppSettings(defaults: defaults).values == before, "level and depth overrides are never saved")
    a.override(selectedLevel: 99, minDepth: 0)
    check(a.selectedLevel == 3 && a.minDepth == 12, "invalid overrides are ignored: \(a.values)")
    a.override(minDepth: 2, maxDepth: 5)
    check(a.minDepth == 2 && a.maxDepth == 5, "a depth range moves as a pair: \(a.values)")
    a.topDepth = 9
    let saved = AppSettings(defaults: defaults).values
    check(saved.topDepth == 9 && saved.selectedLevel == before.selectedLevel && saved.minDepth == before.minDepth
          && saved.maxDepth == before.maxDepth, "a later change is saved without the overrides: \(saved)")

    defaults.set(Data(#"{"pure":"yes","zone":"Nowhere/Land","topDepth":3.5,"selectedLevel":2,"minDepth":9,"maxDepth":4,"faceMode":"analog","haptics":false}"#.utf8), forKey: "settings.v1")
    let g = AppSettings(defaults: defaults)
    check(!g.pure && g.zone == nil && g.topDepth == 7 && g.selectedLevel == 2 && g.minDepth == 1 && g.maxDepth == 4
        && g.faceMode == .journal && !g.haptics, "stored garbage falls back per field: \(g.values)")
    defaults.set(Data("not json".utf8), forKey: "settings.v1")
    check(AppSettings(defaults: defaults).values == AppSettings.Values(), "unreadable storage gives the defaults")
}

@MainActor
private func storeChecks() {
    let clock = FractonicaClock.shared
    let s = ClockStore(clock: clock)
    check(s.isLive && abs(s.time() - Date.now.timeIntervalSince1970) < 0.5, "live shows the device clock")

    let a = 1_791_460_800.0  // SPEC vector A
    s.travel(to: a)
    check(s.isPaused && s.time() == a && s.lastChange == .jump, "travel from live pauses there")
    let revision = s.revision
    s.travel(to: clock.tMax + 1e9)
    check(s.time() == clock.tMax && s.revision == revision + 1, "travel is clamped to the catalogue")
    s.travel(to: a)
    s.setRate(3600)
    check(s.isPlaying && s.playRate == 3600 && s.lastChange == .rate, "setRate runs a time-lapse")
    s.travel(to: a + 100)
    check(s.isPlaying && s.rate == 3600, "travel keeps a running rate")
    s.pause()
    check(s.isPaused && s.playRate == 3600 && s.lastChange == .pause, "pause keeps Play's speed")

    // stepCycle (src/main.js)
    s.travel(to: a)
    let current = clock.level(at: a, 6)!
    check(s.step(level: 6, direction: 1) == nil && abs(s.time() - (current.end + 0.001)) < 1e-6 && s.lastChange == .cycle,
        "next goes 1 ms past the cycle's end")
    s.travel(to: a)
    s.step(level: 6, direction: -1)
    check(abs(s.time() - (current.start + 0.001)) < 1e-6, "previous goes to the current cycle's start first")
    s.step(level: 6, direction: -1)
    let previous = clock.level(at: current.start - 0.002, 6)!
    check(abs(s.time() - (previous.start + 0.001)) < 1e-6 && previous.cycle == current.cycle - 1,
        "previous within a second of the start goes to the previous cycle")
    s.travel(to: clock.tMax)
    check(s.step(level: 0, direction: 1) == .end, "no next cycle at the end")
    s.travel(to: clock.tMin)
    check(s.step(level: 0, direction: -1) == .start, "no previous cycle at the start")
    check(s.play() == nil && s.isPlaying, "play forwards from the start")
    s.travel(to: clock.tMax)
    s.pause()
    check(s.play() == .end && s.isPaused, "play refuses at the end")

    s.goLive()
    check(s.isLive && s.lastChange == .live, "back to live")
    s.selectSpeed(1)
    check(s.isLive, "real time while live stays live")
    s.setDirection(-1)
    check(s.isLive && s.playRate == -1, "turning around while live changes only Play's speed: \(s.playRate)")
    s.playRate = TimeLapse.earthPlayRate
    s.adoptPlayRate(pure: true)
    check(abs(s.playRate - Notation.standard.playRate) < 1e-9, "pure mode plays at 4ι per Blink")
    s.adoptPlayRate(pure: false)
    check(s.playRate == TimeLapse.earthPlayRate, "Earth mode plays at one hour per second")
}

/// A time-lapse stops exactly at the catalogue edge it runs into, in either direction.
@MainActor
private func edgeStopChecks() async {
    let clock = FractonicaClock.shared
    let s = ClockStore(clock: clock)
    s.travel(to: clock.tMax - 30)
    s.setRate(100)
    try? await Task.sleep(for: .seconds(0.6))
    check(s.isPaused && s.time() == clock.tMax && s.lastChange == .edge, "a forward time-lapse stops at the end")
    s.travel(to: clock.tMin + 20)
    s.setRate(-100)
    try? await Task.sleep(for: .seconds(0.5))
    check(s.isPaused && s.time() == clock.tMin && s.lastChange == .edge, "a backward time-lapse stops at the start")
}

private func scheduleChecks() {
    let real = 1_000_000.25
    func next(_ schedule: ClockTickSchedule) -> Double {
        schedule.tick(after: Date(timeIntervalSince1970: real), lowFrequency: false)!.timeIntervalSince1970 - real
    }
    check(abs(next(ClockTickSchedule(base: .live, interval: 1, paused: false)) - 0.75) < 1e-6,
        "live, a periodic(1) clock ticks on the second")
    check(abs(next(ClockTickSchedule(base: .init(t0: 0, real0: real, rate: 3600), interval: 1, paused: false)) - 1.0 / 30) < 1e-6,
        "a fast time-lapse redraws at most 30 times a second")
    check(abs(next(ClockTickSchedule(base: .init(t0: 10.5, real0: real, rate: -2), interval: 1, paused: false)) - 0.25) < 1e-6,
        "backwards, the next tick is the multiple below")
    var entries = ClockTickSchedule(base: .init(t0: 5, real0: real, rate: 0), interval: 1, paused: true)
        .entries(from: Date(timeIntervalSince1970: real), mode: .normal).makeIterator()
    check(entries.next() != nil && entries.next() == nil, "paused, the content draws once")
}

private func linkChecks() {
    for screen in Screen.allCases {
        check(AppLink(url: AppLink(screen: screen).url) == AppLink(screen: screen), "\(screen) round-trips")
    }
    let moment = AppLink(screen: .rings, time: 1_791_460_800.125)
    check(moment.url.absoluteString == "fractonica://rings?t=1791460800.125", "URL form: \(moment.url)")
    check(AppLink(url: moment.url) == moment, "a moment round-trips")
    check(AppLink(userInfo: moment.userInfo) == moment, "a notification's link round-trips")
    check(AppLink(url: URL(string: "fractonica://")!) == AppLink(screen: .now), "no screen opens Now")
    check(AppLink(url: URL(string: "fractonica://Timeline?t=nan")!) == AppLink(screen: .timeline), "case and bad times")
    check(AppLink(url: URL(string: "fractonica://bogus")!) == AppLink(screen: .now), "an unknown screen opens Now")
    check(AppLink(url: URL(string: "https://fractonica.app/rings")!) == nil, "other schemes are not links")
}

/// Wording's SPEC §8 labels: the year joins the short date only for a moment in another year.
@MainActor
private func wordingChecks() {
    let words = Wording(pure: false, zone: "UTC")
    let ref = 1_791_460_800.0                                   // 2026-10-08 12:00:00 UTC
    check(words.label(ref + 3_723, relativeTo: ref) == "13:02:03", "same day: the time with seconds")
    check(words.label(ref + 86_400 + 600, relativeTo: ref) == "Oct 9 12:10", "another day: month, day and time")
    let nextYear = words.label(ref + 365 * 86_400, relativeTo: ref)
    check(nextYear == "Oct 8 2027 12:00", "another year: with the year (\(nextYear))")
    let lastYear = words.label(ref - 300 * 86_400, relativeTo: ref)
    check(lastYear.hasSuffix(" 2025 12:00") || lastYear.contains(" 2025 "), "a past year too (\(lastYear))")
    let pure = Wording(pure: true, zone: "UTC")
    let far = pure.label(ref + 365 * 86_400, relativeTo: ref)
    check(!far.contains("2027") && !far.contains("Oct"), "pure labels stay in Fractonica terms (\(far))")
}
