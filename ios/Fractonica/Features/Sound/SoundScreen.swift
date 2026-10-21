import SwiftUI

/// Sound: the harmonic hierarchy as a just-intonation chord with chimes at the thresholds
/// (src/ui/sound.js, src/audio/, docs/design/70-sound.md).
struct SoundScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.sound.title, systemImage: Screen.sound.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .navigationTitle(Screen.sound.title)
    }
}
