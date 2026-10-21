import SwiftUI

/// How often a `ClockTimeline` redraws its content.
enum ClockCadence: Sendable, Equatable {
    /// Every display frame, for canvases and moving markers. Idles while the displayed time stands still.
    case animation
    /// Every display frame even while the displayed time stands still, for views with motion of their own (Focus).
    case continuous
    /// Whenever the displayed time has moved on by `seconds`, for readouts. Live, that is once per `seconds` of real
    /// time, aligned to whole multiples of it (a `.periodic(1)` clock ticks on the second); during a time-lapse as
    /// often as the interval passes, at most 30 times per real second; never while paused.
    case periodic(Double)
}

/// The one way a screen reads the clock: hands `content` the displayed time `t` (Unix seconds, from `ClockStore`) at
/// the cadence it asks for, and stops redrawing while the scene is in the background. Features never run timers of
/// their own for the clock.
///
///     ClockTimeline(.periodic(1)) { t in
///         Text(settings.wording.time(t)).font(.reading(34))
///     }
///     ClockTimeline(.animation) { t in
///         Canvas { context, size in draw(at: t, in: context, size) }
///     }
///
/// Content that also needs the real instant (an animation running while the clock is paused) reads `Date.now`:
/// it is the moment of the tick.
struct ClockTimeline<Content: View>: View {
    private let cadence: ClockCadence
    private let content: (Double) -> Content

    @Environment(ClockStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase

    init(_ cadence: ClockCadence = .periodic(1), @ViewBuilder content: @escaping (Double) -> Content) {
        self.cadence = cadence
        self.content = content
    }

    var body: some View {
        let background = scenePhase == .background
        switch cadence {
        case .animation:
            TimelineView(.animation(minimumInterval: nil, paused: background || store.isPaused)) { context in
                content(store.time(at: context.date))
            }
        case .continuous:
            TimelineView(.animation(minimumInterval: nil, paused: background)) { context in
                content(store.time(at: context.date))
            }
        case .periodic(let interval):
            TimelineView(ClockTickSchedule(base: store.base, interval: interval, paused: background || store.isPaused)) { context in
                content(store.time(at: context.date))
            }
        }
    }
}

/// The real instants at which a displayed-time interval elapses, for `ClockCadence.periodic`.
struct ClockTickSchedule: TimelineSchedule, Sendable {
    /// The displayed time as a function of real time.
    let base: ClockStore.TimeBase
    /// Displayed seconds between ticks.
    let interval: Double
    /// Only the first entry: the content draws once and waits for the next change.
    let paused: Bool

    /// The fastest a periodic readout redraws during a time-lapse.
    static let minimumStep = 1.0 / 30

    func entries(from startDate: Date, mode: TimelineScheduleMode) -> Entries {
        Entries(upcoming: startDate, schedule: self, lowFrequency: mode == .lowFrequency)
    }

    struct Entries: Sequence, IteratorProtocol {
        var upcoming: Date?
        let schedule: ClockTickSchedule
        let lowFrequency: Bool

        mutating func next() -> Date? {
            guard let date = upcoming else { return nil }
            upcoming = schedule.paused ? nil : schedule.tick(after: date, lowFrequency: lowFrequency)
            return date
        }
    }

    /// The first real instant after `date` at which the displayed time crosses a multiple of `interval`.
    func tick(after date: Date, lowFrequency: Bool) -> Date? {
        let rate = base.rate
        guard rate != 0, interval > 0, interval.isFinite else { return nil }
        let real = date.timeIntervalSince1970
        let t = base.t(atReal: real)
        let k = (t / interval).rounded(rate > 0 ? .down : .up) + (rate > 0 ? 1 : -1)
        let target = base.real0 + (k * interval - base.t0) / rate
        let step = max(target - real, lowFrequency ? 1 : Self.minimumStep)
        return Date(timeIntervalSince1970: real + step)
    }
}
