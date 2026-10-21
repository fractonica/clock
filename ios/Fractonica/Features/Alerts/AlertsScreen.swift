import SwiftUI

/// Alerts: the clock events that notify you (turnovers, thresholds, solar syncs).
struct AlertsScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.alerts.title, systemImage: Screen.alerts.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.alerts.title)
    }
}
