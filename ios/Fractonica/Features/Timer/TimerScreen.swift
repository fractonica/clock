import SwiftUI

/// Timer: countdowns set in Earth or Fractonica units.
struct TimerScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.timer.title, systemImage: Screen.timer.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.timer.title)
    }
}
