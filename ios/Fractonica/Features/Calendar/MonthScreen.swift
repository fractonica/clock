import SwiftUI

/// Month: a Gregorian month whose days show cycle boundaries at their time of day; in pure mode a page of one Delta
/// (src/ui/calendar/month.js, pure-month.js, docs/design/60-calendar.md).
struct MonthScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.month.title, systemImage: Screen.month.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.month.title)
    }
}
