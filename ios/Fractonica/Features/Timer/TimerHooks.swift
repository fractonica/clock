import UserNotifications

/// Lifecycle entry points of the Timer and Stopwatch: restores both at launch (ringing a timer that ended while the
/// app was closed), keeps the timer's notification and Live Activities in step with the app's state, decides how the
/// timer's notification shows while the app is in front, and opens the Timer from it.
enum TimerHooks: FeatureHooks {
    static func launch() {
        TimerChime.prepare()
        let demo = TimerDemo.current()
        if !demo.apply(timer: .shared) { TimerStore.shared.restore() }
        if !demo.apply(stopwatch: .shared) { StopwatchStore.shared.restore() }
        #if DEBUG
        // debug builds: start a real timer (-FXTimerStart <Blinks>) or the stopwatch (-FXStopwatchStart 1) at launch,
        // to exercise notifications, the Live Activity and the ring end to end
        let blinks = UserDefaults.standard.integer(forKey: "FXTimerStart")
        if blinks > 0, demo.timer == nil, demo.now == nil { TimerStore.shared.start(.ladder(LadderSpan(blinks: blinks))) }
        if UserDefaults.standard.bool(forKey: "FXStopwatchStart"), demo.stopwatch == nil, demo.now == nil {
            StopwatchStore.shared.reset()
            StopwatchStore.shared.start()
        }
        #endif
        #if os(iOS) && canImport(ActivityKit)
        TimerActivityAction.handler = perform
        #endif
    }

    static func becameActive() {
        TimerStore.shared.becameActive()
    }

    static func enteredBackground() {
        TimerStore.shared.enteredBackground()
        StopwatchStore.shared.enteredBackground()
    }

    /// In front, the app rings the timer itself: on the Timer screen with its alert (so the banner stays away), elsewhere
    /// with a toast and the banner (the chime has already played, so the banner is silent).
    static func presentation(ofNotification identifier: String) -> UNNotificationPresentationOptions? {
        guard identifier.hasPrefix(TimerNotifications.prefix) else { return nil }
        let store = TimerStore.shared
        store.reconcile()
        return store.isScreenVisible ? [] : [.banner, .list]
    }

    static func open(_ notification: NotificationResponse) -> Bool {
        guard notification.identifier.hasPrefix(TimerNotifications.prefix) else { return false }
        TimerStore.shared.reconcile()
        AppRouter.shared.show(.timer)
        return true
    }

    #if os(iOS) && canImport(ActivityKit)
    /// The Live Activity's buttons.
    private static func perform(_ action: TimerActivityAction) {
        let timer = TimerStore.shared
        let stopwatch = StopwatchStore.shared
        switch action {
        case .pause: timer.pause()
        case .resume: timer.resume()
        case .cancel:
            timer.cancel()
            timer.dismissRinging()
        case .start: stopwatch.start()
        case .stop: stopwatch.stop()
        case .lap: stopwatch.lap()
        }
    }
    #endif
}
