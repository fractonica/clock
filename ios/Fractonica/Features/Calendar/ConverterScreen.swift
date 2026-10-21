import SwiftUI

/// Converter: Gregorian date and time ⇄ Saros position, cycle address, glyph states and solar sync; in pure mode the
/// Fractonica date forms (src/ui/calendar/converter.js, pure-converter.js, docs/design/60-calendar.md).
struct ConverterScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.converter.title, systemImage: Screen.converter.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.converter.title)
    }
}
