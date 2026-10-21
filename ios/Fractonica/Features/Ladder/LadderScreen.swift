import SwiftUI

/// Ladder: one row per depth with its progress, counter and time left (src/ui/ladder.js, docs/design/30-ladder.md).
struct LadderScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.ladder.title, systemImage: Screen.ladder.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.ladder.title)
    }
}
