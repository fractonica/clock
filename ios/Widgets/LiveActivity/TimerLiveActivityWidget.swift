#if os(iOS)
import ActivityKit
import SwiftUI
import WidgetKit

/// A running timer or stopwatch on the Lock Screen and in the Dynamic Island. The system keeps the countdown and the
/// draining ring moving on its own (`Text(timerInterval:)`, `ProgressView(timerInterval:)`), so the activity needs no
/// updates until the run changes; the views are shared with the app (Shared/TimerActivity.swift). A timer that rang
/// while the app could not end its activity goes stale at its end and reads "Done".
struct TimerLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerActivityAttributes.self) { context in
            TimerActivityLockScreen(attributes: context.attributes, state: context.state)
                .environment(\.timerActivityStale, context.isStale)
                .activityBackgroundTint(Theme.background.opacity(0.92))
                .activitySystemActionForegroundColor(Theme.teal)
                .widgetURL(link(context.attributes))
        } dynamicIsland: { context in
            let attributes = context.attributes
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 10) {
                        TimerActivityBadge(attributes: attributes, state: state, size: 36, lineWidth: 4)
                        VStack(alignment: .leading, spacing: 1) {
                            if attributes.kind == .timer {
                                Text("Timer")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(Theme.ink3)
                            }
                            Text(state.title)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                        }
                    }
                    .padding(.leading, 4)
                    .environment(\.timerActivityStale, context.isStale)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TimerActivityReading(attributes: attributes, state: state, size: 34)
                        .frame(maxWidth: 150, alignment: .trailing)
                        .padding(.trailing, 4)
                        .environment(\.timerActivityStale, context.isStale)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(state.detail)
                                .font(.footnote.monospacedDigit())
                                .foregroundStyle(Theme.ink2)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                            if attributes.kind == .timer {
                                TimerActivityBar(state: state)
                            }
                        }
                        Spacer(minLength: 4)
                        TimerActivityButtons(attributes: attributes, state: state, compact: true)
                    }
                    .padding(.horizontal, 4)
                    .padding(.top, 4)
                    .environment(\.timerActivityStale, context.isStale)
                }
            } compactLeading: {
                TimerActivityBadge(attributes: attributes, state: state, size: 22, lineWidth: 3)
                    .environment(\.timerActivityStale, context.isStale)
            } compactTrailing: {
                TimerActivityCompactReading(attributes: attributes, state: state)
                    .environment(\.timerActivityStale, context.isStale)
            } minimal: {
                TimerActivityBadge(attributes: attributes, state: state, size: 22, lineWidth: 3)
                    .environment(\.timerActivityStale, context.isStale)
            }
            .widgetURL(link(attributes))
            .keylineTint(Theme.teal)
        }
    }

    private func link(_ attributes: TimerActivityAttributes) -> URL {
        AppLink(screen: attributes.kind == .timer ? .timer : .stopwatch).url
    }
}

#endif
