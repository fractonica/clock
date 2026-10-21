#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import Foundation

/// The Live Activity of a running timer, on the Lock Screen and in the Dynamic Island. The Timer feature
/// (Features/Timer) starts, updates and ends it; Widgets/LiveActivity/TimerLiveActivityWidget.swift draws it.
/// Shared by the app and the widget extension, which must agree on this type exactly.
struct TimerActivityAttributes: ActivityAttributes {
    /// What changes while the timer runs.
    struct ContentState: Codable, Hashable {
        /// When the timer rings (device time).
        var endDate: Date
    }

    /// The timer's name as the user sees it.
    var title: String
}
#endif
