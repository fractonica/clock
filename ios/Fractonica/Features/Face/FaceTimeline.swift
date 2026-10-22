import SwiftUI

/// A `ClockTimeline` that redraws exactly when its content changes: `next(t)` gives the displayed time of the next
/// change after t (a `FaceCadence` function), and the view redraws just after it. Same rules as `ClockTimeline`: it
/// reads the displayed time from `ClockStore`, draws once and waits while the clock is paused, and stops in the
/// background.
///
///     FaceTimeline { t in FaceCadence.journal(after: t, unit: unit) } content: { t in JournalFaceView(…) }
///
/// Why not `.periodic`: a periodic tick is aligned to multiples of displayed seconds, not to the clock's own units, so
/// a λ count would turn up to a tick late and the face, the date line and the countdown could disagree for a moment.
/// (Requested for Core as `ClockCadence.changes`; see the face's report.)
struct FaceTimeline<Content: View>: View {
    /// The shortest real time between two redraws (a time-lapse can make changes far more frequent than a display).
    var minimumStep: Double = ChangeSchedule.defaultMinimumStep
    let next: @Sendable (Double) -> Double?
    @ViewBuilder let content: (Double) -> Content

    @Environment(ClockStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        let schedule = ChangeSchedule(
            base: store.base,
            paused: scenePhase == .background || store.isPaused,
            minimumStep: minimumStep,
            next: next
        )
        TimelineView(schedule) { context in
            content(store.time(at: context.date))
        }
    }
}

/// A `FaceTimeline`, or a still drawing of one fixed instant (the `-FXFaceTime` hook).
struct NowTimeline<Content: View>: View {
    let fixed: Double?
    var minimumStep: Double = ChangeSchedule.defaultMinimumStep
    let next: @Sendable (Double) -> Double?
    @ViewBuilder let content: (Double) -> Content

    var body: some View {
        if let fixed {
            content(fixed)
        } else {
            FaceTimeline(minimumStep: minimumStep, next: next, content: content)
        }
    }
}

/// The real instants at which a displayed-time quantity changes, for `FaceTimeline`.
struct ChangeSchedule: TimelineSchedule, Sendable {
    /// The displayed time as a function of real time.
    let base: ClockStore.TimeBase
    /// Only the first entry: the content draws once and waits.
    let paused: Bool
    /// Real seconds.
    let minimumStep: Double
    let next: @Sendable (Double) -> Double?

    /// 30 redraws per real second at most, like a periodic clock during a time-lapse.
    static let defaultMinimumStep = 1.0 / 30
    /// Redraw a little after a change, never on its edge: floating point could read the old value there, and pure spans
    /// count with a margin of 1e-12 Saros (0.6 ms) that moves their changes just past the boundary.
    static let lag = 0.002
    /// Without a known next change (none ahead) the content is checked this often.
    static let fallbackStep = 1.0
    /// At most this long between two redraws, whatever `next` says (a device clock that jumps is caught up).
    static let maximumStep = 60.0

    func entries(from startDate: Date, mode: TimelineScheduleMode) -> Entries {
        Entries(upcoming: startDate, schedule: self, lowFrequency: mode == .lowFrequency)
    }

    struct Entries: Sequence, IteratorProtocol {
        var upcoming: Date?
        let schedule: ChangeSchedule
        let lowFrequency: Bool

        mutating func next() -> Date? {
            guard let date = upcoming else { return nil }
            upcoming = schedule.paused ? nil : schedule.tick(after: date, lowFrequency: lowFrequency)
            return date
        }
    }

    /// The real instant of the first redraw after `date`; nil when the displayed time stands still.
    func tick(after date: Date, lowFrequency: Bool) -> Date? {
        let rate = base.rate
        guard rate != 0, rate.isFinite else { return nil }
        let real = date.timeIntervalSince1970
        let floor = lowFrequency ? max(1, minimumStep) : minimumStep
        let t = base.t(atReal: real)
        var step = Self.fallbackStep
        if rate > 0 {
            if let change = next(t), change.isFinite, change > t {
                step = base.real0 + (change - base.t0) / rate + Self.lag - real
            }
        } else if let change = Self.lastChange(atOrBefore: t, within: -rate * Self.defaultMinimumStep, next: next) {
            // backwards the content changes as the displayed time falls below the change that began it
            step = base.real0 + (change - base.t0) / rate + Self.lag - real
        } else {
            step = Self.defaultMinimumStep
        }
        return Date(timeIntervalSince1970: real + min(Self.maximumStep, max(floor, step)))
    }

    /// The latest change at or before t (what a clock running backwards meets next), from a `next` that only looks
    /// ahead: probe behind t, doubling the distance from about one frame of displayed time, then walk forward. Nil when
    /// nothing changes within 2⁴⁰ frames. A change within the last frame returns t itself (the next frame is due anyway).
    static func lastChange(atOrBefore t: Double, within frame: Double, next: (Double) -> Double?) -> Double? {
        var distance = max(frame, 1e-3)
        for probe in 0..<40 {
            if let change = next(t - distance), change.isFinite, change <= t {
                guard probe > 0 else { return t }
                var latest = change
                for _ in 0..<64 {
                    // just past the change: exactly on it, a reading may still be the cycle that ends there
                    guard let later = next(latest + 1e-5), later.isFinite, later > latest, later <= t else { break }
                    latest = later
                }
                return latest
            }
            distance *= 2
        }
        return nil
    }
}
