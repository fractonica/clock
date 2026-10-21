#if os(iOS)
import ActivityKit
import SwiftUI
import WidgetKit

/// A running timer on the Lock Screen and in the Dynamic Island: its name and the time left, counting down on its own
/// (`Text(timerInterval:)`), so the activity needs no updates until the timer changes.
struct TimerLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerActivityAttributes.self) { context in
            HStack {
                Label(context.attributes.title, systemImage: "timer")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Spacer()
                Countdown(end: context.state.endDate)
                    .font(.system(size: 34, weight: .semibold).monospacedDigit())
                    .foregroundStyle(Theme.teal)
            }
            .padding()
            .activityBackgroundTint(Theme.background)
            .activitySystemActionForegroundColor(Theme.teal)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(context.attributes.title, systemImage: "timer")
                        .foregroundStyle(Theme.ink)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Countdown(end: context.state.endDate)
                        .font(.title2.monospacedDigit())
                        .foregroundStyle(Theme.teal)
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(Theme.teal)
            } compactTrailing: {
                Countdown(end: context.state.endDate)
                    .monospacedDigit()
                    .frame(maxWidth: 64)
                    .foregroundStyle(Theme.teal)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(Theme.teal)
            }
        }
    }
}

/// The time left until `end`, counting down by itself; zero once it has passed.
private struct Countdown: View {
    let end: Date

    var body: some View {
        let now = Date.now
        Text(timerInterval: now...max(now, end), countsDown: true)
            .multilineTextAlignment(.trailing)
    }
}
#endif
