import SwiftUI

/// Timeline: the zoomable multi-scale timeline from the whole catalogue down to seconds, one lane per depth
/// (src/ui/timeline.js, docs/design/40-timeline.md).
struct TimelineScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.timeline.title, systemImage: Screen.timeline.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.timeline.title)
    }
}
