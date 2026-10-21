import SwiftUI

/// Wave: the library's circular harmonic geometry as a you-are-here map, one marker per level, with the solar wave
/// (src/ui/wave.js, docs/design/50-wave.md).
struct WaveScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.wave.title, systemImage: Screen.wave.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.wave.title)
    }
}
