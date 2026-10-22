import FractonicaKit
import SwiftUI

/// Where the ladder and Up next send the clock: the start of a cycle, Just before its end (then real time, to watch
/// it turn over) and Just after it (1 ms into the next one). Every action reads the clock at the moment it runs, so a
/// time-lapse a frame ahead of the screen never sends the clock backwards.
@MainActor
struct LadderNavigator {
    let store: ClockStore
    let toasts: ToastCenter
    let pure: Bool

    private var clock: FractonicaClock { store.clock }
    private var now: Double { LadderLaunch.shown(store.time()) }

    /// The start of the running cycle of `level` (1 ms in).
    func start(_ level: Int) {
        guard let lv = clock.level(at: now, level) else { return outside() }
        go(to: lv.start + 0.001)
    }

    /// 2 s (or a quarter of a shorter cycle) before the running cycle of `level` ends, then real time.
    func justBefore(_ level: Int) {
        guard let lv = clock.level(at: now, level) else { return outside() }
        guard !isLast(lv) else { return }
        go(to: LadderText.justBeforeTime(end: lv.end, duration: lv.duration), rate: 1)
    }

    /// 1 ms into the cycle that follows the running one.
    func justAfter(_ level: Int) {
        guard let lv = clock.level(at: now, level) else { return outside() }
        guard !isLast(lv) else { return }
        go(to: LadderText.justAfterTime(end: lv.end))
    }

    /// Just after the next quarter threshold of `level`.
    func nextThreshold(_ level: Int) {
        guard let lv = clock.level(at: now, level) else { return outside() }
        guard let time = lv.next.time else { return lastCycle(lv) }
        go(to: LadderText.justAfterTime(end: time))
    }

    /// Just before the next turnover of the importance (read afresh: the list on screen may be a frame behind).
    func turnoverBefore(importance: Importance) {
        guard let next = Turnovers.upcoming(clock, after: now, importance: importance, maxLevel: importance.top, count: 1).first
        else { return noTurnover() }
        go(to: LadderText.justBeforeTurnover(clock: clock, time: next.time, top: next.top), rate: 1)
    }

    /// Just after the next turnover of the importance.
    func turnoverAfter(importance: Importance) {
        guard let next = Turnovers.upcoming(clock, after: now, importance: importance, maxLevel: importance.top, count: 1).first
        else { return noTurnover() }
        go(to: LadderText.justAfterTime(end: next.time))
    }

    /// Just before a listed turnover.
    func before(_ turnover: Turnover) {
        go(to: LadderText.justBeforeTurnover(clock: clock, time: turnover.time, top: turnover.top), rate: 1)
    }

    /// Just after a listed turnover.
    func after(_ turnover: Turnover) {
        go(to: LadderText.justAfterTime(end: turnover.time))
    }

    /// One of the catalogue's edges.
    func edge(_ t: Double) { go(to: t) }

    // MARK: -

    private func go(to t: Double, rate: Double? = nil) {
        store.travel(to: LadderLaunch.unshown(t), rate: rate)
        Haptics.play(.step)
    }

    /// The final cycle of a level has no turnover to travel to: the catalogue stops there.
    private func isLast(_ lv: LevelReading) -> Bool {
        guard lv.end >= clock.tMax - 0.002 else { return false }
        lastCycle(lv)
        return true
    }

    private func lastCycle(_ lv: LevelReading) {
        let name = pure ? LadderPureText.levelSay(lv.level) : LadderText.chip(lv.level)
        toasts.show(lv.clipped ? "The last \(name) cycle is clipped by the end of the catalogue" : "This is the last \(name) cycle: the catalogue ends with it")
        Haptics.play(.warning)
    }

    private func noTurnover() {
        toasts.show("No further turnover of this size before the catalogue ends")
        Haptics.play(.warning)
    }

    private func outside() {
        toasts.show("Outside the catalogue")
        Haptics.play(.warning)
    }
}
