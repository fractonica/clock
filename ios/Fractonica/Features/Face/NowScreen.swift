import SwiftUI

/// Now: the clock face (the journal face and the spec's watch face), with the cycle ladder and what turns over next
/// (src/ui/face.js, src/ui/upnext.js, docs/design/10-face.md).
struct NowScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.now.title, systemImage: Screen.now.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.now.title)
    }
}
