import SwiftUI

/// Jump: go to any moment by date, cycle address, position or offset (src/ui/jump.js).
struct JumpScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.jump.title, systemImage: Screen.jump.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.jump.title)
    }
}
