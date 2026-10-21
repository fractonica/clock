import SwiftUI

/// Stopwatch: elapsed time with laps, read in Earth or Fractonica units.
struct StopwatchScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.stopwatch.title, systemImage: Screen.stopwatch.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.stopwatch.title)
    }
}
