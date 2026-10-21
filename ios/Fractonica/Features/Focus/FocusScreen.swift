import SwiftUI

/// Focus: the clock as a vivid full-screen animation driven by its harmonics. Presented full screen (a cover on iOS, its
/// own window on macOS, `isImmersive` true) and, on iPad and Mac, also listed as a screen of the window.
struct FocusScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.isImmersive) private var isImmersive
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            ContentUnavailableView {
                Label(Screen.focus.title, systemImage: Screen.focus.systemImage)
            } description: {
                Text(settings.wording.date(t))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay(alignment: .topTrailing) {
            if isImmersive {
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                    .padding()
            }
        }
        .navigationTitle(Screen.focus.title)
    }
}
