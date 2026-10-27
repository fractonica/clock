#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import AppIntents
import SwiftUI

// The Live Activity of a running timer or stopwatch, on the Lock Screen and in the Dynamic Island. The Timer feature
// (Features/Timer) starts, updates and ends it; Widgets/LiveActivity/TimerLiveActivityWidget.swift draws it with the
// views below. Shared by the app and the widget extension, which must agree on these types exactly (the app also
// draws the views for its own previews).
//
// A Live Activity cannot run code while it shows: only the system's own timers tick (`Text(timerInterval:)`,
// `ProgressView(timerInterval:)`). The app therefore words everything else when it updates the activity, and in pure
// mode the activity shows the ladder span, the end on the Fractonica clock and a draining bar, never Earth digits.

struct TimerActivityAttributes: ActivityAttributes {
    enum Kind: String, Codable, Hashable, Sendable {
        case timer, stopwatch
    }

    /// What changes while it runs.
    struct ContentState: Codable, Hashable, Sendable {
        /// "4ι", "Until 30ι", "Stopwatch".
        var title: String
        /// Timer: it counts down over `start … end` (device time) and rings at `end`. Stopwatch: `start` is the moment a
        /// continuous run would have read zero; `end` lies far ahead.
        var start: Date
        var end: Date
        /// Set while paused or stopped: the moment the display froze.
        var pausedAt: Date?
        /// Pure mode's big reading, which cannot tick: a running timer's end on the clock ("34η 30ι"), what a paused
        /// one has left ("02ι 13λ 07ν"), a stopped stopwatch's reading; empty for a running stopwatch.
        var reading: String
        /// Pure mode's reading in the compact Dynamic Island: "4ι", "2ι", "●".
        var compact: String
        /// The second line, worded by the app in the current mode: "ends 34η 30ι 12λ", "rings at 14:23 · 30ι".
        var detail: String
        /// Pure mode: Fractonica terms only, no Earth clock digits.
        var pure: Bool

        var isPaused: Bool { pausedAt != nil }

        /// What is left of a timer, 1 … 0, at `pausedAt` (or now).
        func fractionLeft(at now: Date = .now) -> Double {
            let span = end.timeIntervalSince(start)
            guard span > 0 else { return 0 }
            return min(1, max(0, end.timeIntervalSince(pausedAt ?? now) / span))
        }

        /// The interval the system timers run over (never inverted).
        var interval: ClosedRange<Date> { start...max(start, end) }
    }

    var kind: Kind
    /// The run this activity shows; the app ends activities whose run is gone.
    var runID: String
}

// MARK: - Buttons

/// The buttons of the Live Activity: pause or resume, cancel, lap. They run in the app's process (the system launches
/// it in the background if needed), where the Timer feature installs `handler` at launch.
struct TimerActivityIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Timer Control"
    static let isDiscoverable = false

    @Parameter(title: "Action")
    var action: String

    init() {}

    init(_ action: TimerActivityAction) {
        self.action = action.rawValue
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        if let action = TimerActivityAction(rawValue: action) {
            TimerActivityAction.handler?(action)
        }
        return .result()
    }
}

enum TimerActivityAction: String, Sendable {
    case pause, resume, cancel, stop, start, lap

    /// Set by the app at launch; nil in the widget extension, which never performs the intent.
    @MainActor static var handler: ((TimerActivityAction) -> Void)?
}

// MARK: - Views

extension EnvironmentValues {
    /// The activity is past its stale date: a timer that rang while the app could not end its activity.
    @Entry var timerActivityStale = false
    /// Draw the draining ring and bar as they stand now instead of with the system's self-updating timer views (the
    /// app's own previews: inside an app the circular timer view draws a spinner, not a ring).
    @Entry var timerActivityStill = false
}

/// A timer's ring draining with the system clock; static while paused (or in the app's previews).
struct TimerActivityRing: View {
    let state: TimerActivityAttributes.ContentState
    var lineWidth: CGFloat = 3

    @Environment(\.timerActivityStill) private var still

    var body: some View {
        if state.isPaused || still {
            ProgressView(value: state.fractionLeft())
                .progressViewStyle(TimerActivityRingStyle(lineWidth: lineWidth, paused: state.isPaused))
        } else {
            ProgressView(timerInterval: state.interval, countsDown: true) {
                EmptyView()
            } currentValueLabel: {
                EmptyView()
            }
            .progressViewStyle(.circular)
            .tint(Theme.teal)
            .labelsHidden()
        }
    }
}

/// The Lock Screen (and banner) presentation.
struct TimerActivityLockScreen: View {
    let attributes: TimerActivityAttributes
    let state: TimerActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 14) {
                TimerActivityBadge(attributes: attributes, state: state, size: 46, lineWidth: 4.5)
                VStack(alignment: .leading, spacing: 3) {
                    Text(state.title)
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    // the end led by its Pentad ("Ends P1 · 17:11 · 49η 3ι") may take a second line beside a
                    // running countdown
                    Text(state.detail)
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 8)
                TimerActivityReading(attributes: attributes, state: state, size: 40)
            }
            HStack(spacing: 10) {
                if attributes.kind == .timer {
                    TimerActivityBar(state: state)
                } else {
                    Spacer(minLength: 0)
                }
                TimerActivityButtons(attributes: attributes, state: state)
            }
        }
        .padding(16)
    }
}

/// The circular badge: a timer's ring draining with the system clock, or the stopwatch symbol.
struct TimerActivityBadge: View {
    let attributes: TimerActivityAttributes
    let state: TimerActivityAttributes.ContentState
    var size: CGFloat = 24
    var lineWidth: CGFloat = 3

    @Environment(\.timerActivityStale) private var stale

    var body: some View {
        Group {
            switch attributes.kind {
            case .timer:
                if state.pure && !state.isPaused && !stale && size > 30 {
                    Image(systemName: "timer")
                        .font(.system(size: size * 0.46, weight: .semibold))
                        .foregroundStyle(Theme.teal)
                        .frame(width: size, height: size)
                        .background(Theme.teal.opacity(0.16), in: .circle)
                } else if stale {
                    Image(systemName: "bell.fill")
                        .font(.system(size: size * 0.42, weight: .semibold))
                        .foregroundStyle(Theme.teal)
                        .frame(width: size, height: size)
                        .background(Theme.teal.opacity(0.16), in: .circle)
                } else {
                    TimerActivityRing(state: state, lineWidth: lineWidth)
                }
            case .stopwatch:
                Image(systemName: state.isPaused ? "stopwatch" : "stopwatch.fill")
                    .font(.system(size: size * 0.5, weight: .semibold))
                    .foregroundStyle(Theme.teal)
                    .frame(width: size, height: size)
                    .background(Theme.teal.opacity(0.16), in: .circle)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A static ring for a paused timer (the system's circular style only animates a running interval).
struct TimerActivityRingStyle: ProgressViewStyle {
    var lineWidth: CGFloat
    var paused: Bool

    func makeBody(configuration: Configuration) -> some View {
        let value = configuration.fractionCompleted ?? 0
        ZStack {
            Circle().stroke(Theme.teal.opacity(0.22), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: value)
                .stroke(Theme.teal.opacity(paused ? 0.6 : 1), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .padding(lineWidth / 2)
    }
}

/// The big reading: the system countdown (or count-up) in Earth mode; in pure mode the ladder span.
struct TimerActivityReading: View {
    let attributes: TimerActivityAttributes
    let state: TimerActivityAttributes.ContentState
    var size: CGFloat = 40

    @Environment(\.timerActivityStale) private var stale

    var body: some View {
        Group {
            if stale && attributes.kind == .timer {
                Text("Done")
                    .font(.system(size: size * 0.72, weight: .medium))
            } else if state.pure && attributes.kind == .timer && !state.isPaused {
                // no Earth digits: the timer's name inside its draining ring
                ZStack {
                    TimerActivityRing(state: state, lineWidth: size * 0.09)
                    Text(state.compact)
                        .font(.reading(size * 0.34, weight: .semibold))
                        .minimumScaleFactor(0.5)
                        .padding(size * 0.16)
                }
                .frame(width: size * 1.35, height: size * 1.35)
            } else if state.pure {
                Text(state.reading)
                    .font(.reading(size * 0.62, weight: .medium))
            } else {
                switch attributes.kind {
                case .timer:
                    Text(timerInterval: state.interval, pauseTime: state.pausedAt, countsDown: true, showsHours: true)
                        .font(.reading(size, weight: .light))
                case .stopwatch:
                    Text(timerInterval: state.interval, pauseTime: state.pausedAt, countsDown: false, showsHours: true)
                        .font(.reading(size, weight: .light))
                }
            }
        }
        .foregroundStyle(state.isPaused ? Theme.ink2 : Theme.teal)
        .multilineTextAlignment(.trailing)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

/// A timer's draining bar.
struct TimerActivityBar: View {
    let state: TimerActivityAttributes.ContentState

    @Environment(\.timerActivityStale) private var stale
    @Environment(\.timerActivityStill) private var still

    var body: some View {
        Group {
            if stale {
                ProgressView(value: 0.0)
            } else if state.isPaused || still {
                ProgressView(value: state.fractionLeft())
            } else {
                ProgressView(timerInterval: state.interval, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
            }
        }
        .progressViewStyle(.linear)
        .tint(Theme.teal)
        .labelsHidden()
        .accessibilityHidden(true)
    }
}

/// Pause / resume and cancel for a timer; lap, stop / start for a stopwatch.
struct TimerActivityButtons: View {
    let attributes: TimerActivityAttributes
    let state: TimerActivityAttributes.ContentState
    var compact = false

    @Environment(\.timerActivityStale) private var stale

    var body: some View {
        HStack(spacing: 8) {
            switch attributes.kind {
            case .timer where stale:
                button(.cancel, symbol: "xmark", label: "Dismiss", prominent: true)
            case .timer:
                button(state.isPaused ? .resume : .pause, symbol: state.isPaused ? "play.fill" : "pause.fill",
                       label: state.isPaused ? "Resume" : "Pause", prominent: true)
                button(.cancel, symbol: "xmark", label: "Cancel", prominent: false)
            case .stopwatch:
                if !state.isPaused {
                    button(.lap, symbol: "flag.fill", label: "Lap", prominent: false)
                }
                button(state.isPaused ? .start : .stop, symbol: state.isPaused ? "play.fill" : "pause.fill",
                       label: state.isPaused ? "Start" : "Stop", prominent: true)
            }
        }
    }

    private func button(_ action: TimerActivityAction, symbol: String, label: String, prominent: Bool) -> some View {
        Button(intent: TimerActivityIntent(action)) {
            Image(systemName: symbol)
                .font(.system(size: compact ? 13 : 15, weight: .bold))
                .frame(width: compact ? 34 : 40, height: compact ? 34 : 40)
                .foregroundStyle(prominent ? Theme.background : Theme.ink)
                .background(prominent ? Theme.teal : Theme.panel3, in: .circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

/// The compact trailing reading: the system countdown in Earth mode, the ladder span in pure mode.
struct TimerActivityCompactReading: View {
    let attributes: TimerActivityAttributes
    let state: TimerActivityAttributes.ContentState

    @Environment(\.timerActivityStale) private var stale

    var body: some View {
        Group {
            if stale && attributes.kind == .timer {
                Text("Done")
                    .font(.system(size: 15, weight: .semibold))
            } else if state.pure {
                Text(state.compact)
                    .font(.reading(15, weight: .semibold))
            } else {
                Text(timerInterval: state.interval, pauseTime: state.pausedAt, countsDown: attributes.kind == .timer, showsHours: true)
                    .font(.reading(15, weight: .semibold))
                    .multilineTextAlignment(.trailing)
            }
        }
        .foregroundStyle(state.isPaused ? Theme.ink2 : Theme.teal)
        .lineLimit(1)
        .frame(maxWidth: 64, alignment: .trailing)
    }
}
#endif
