import SwiftUI

/// Diary: the printable diary of one Delta, laid out by the web renderer the build copies into the bundle's web/ folder
/// (src/ui/diary.js, docs/design/90-diary.md).
struct DiaryScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.diary.title, systemImage: Screen.diary.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.diary.title)
    }
}
