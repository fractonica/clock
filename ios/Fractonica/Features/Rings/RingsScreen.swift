import SwiftUI

/// Rings: the concentric dial of every cycle, outermost the longest, with the countdown to the end of the selected cycle
/// (src/ui/rings.js, docs/design/20-rings.md).
struct RingsScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.rings.title, systemImage: Screen.rings.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.rings.title)
    }
}
