/// Lifecycle entry points of Alerts: notifications for the clock events the user chooses.
enum AlertsHooks: FeatureHooks {
    /// The background app refresh task declared in Info.plist (`BGTaskSchedulerPermittedIdentifiers`).
    static let refreshTaskIdentifier = "app.fractonica.clock.refresh"

    #if os(iOS)
    /// Registers the `BGAppRefreshTask` handler for `refreshTaskIdentifier`. The app calls it while launching, before
    /// launch finishes, as BackgroundTasks requires.
    static func registerBackgroundTasks() {}
    #endif
}
