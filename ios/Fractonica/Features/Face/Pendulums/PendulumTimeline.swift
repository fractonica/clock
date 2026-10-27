import SwiftUI

/// `ClockTimeline(.animation)` at most `interval` apart: every display frame on a 60 Hz screen, every other one on a
/// 120 Hz screen. Same rules as `ClockTimeline`: it reads the displayed time from `ClockStore`, idles while the clock is
/// paused, in the background and while held out of sight. The quick pendulums swing smoothly at 60 frames a second
/// (their trails carry the motion between frames) for half the work of 120.
/// (Requested for Core as `ClockCadence.animation(minimumInterval:)`; see the face's report.)
struct PendulumTimeline<Content: View>: View {
    var interval: Double = 1.0 / 60
    @ViewBuilder let content: (Double) -> Content

    @Environment(ClockStore.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.clockHeld) private var held

    var body: some View {
        TimelineView(.animation(minimumInterval: interval, paused: scenePhase == .background || held || store.isPaused)) { context in
            content(store.time(at: context.date))
        }
    }
}
