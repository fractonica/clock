import FractonicaKit
import SwiftUI

/// Sound: the harmonic hierarchy as a just-intonation chord with bells at the thresholds (src/ui/sound.js, src/audio/,
/// docs/design/70-sound.md). The pitch ring with the power switch and "Hear this moment" on top, the live spectrum,
/// the voices, the mix and the tempo lock below; two columns where there is room (iPad, Mac), one on iPhone, where the
/// screen is a sheet over Now. The sound itself is `SoundEngine.shared` and keeps playing when the screen closes.
struct SoundScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @State private var width: CGFloat = 0
    @State private var height: CGFloat = 0

    private var engine: SoundEngine { .shared }

    /// Room for two columns.
    private var wide: Bool { width >= 760 }

    var body: some View {
        let words = SoundWords(settings.wording)
        ScrollViewReader { proxy in
            ScrollView {
                Group {
                    if wide {
                        HStack(alignment: .top, spacing: 20) {
                            VStack(spacing: 20) {
                                hero(words)
                                spectrum(words)
                                SoundMixerView(words: words, stripHeight: 150).id(Section.voices)
                            }
                            .frame(maxWidth: .infinity)
                            VStack(spacing: 20) {
                                SoundControlsView(words: words).id(Section.mix)
                                SoundTempoView(words: words).id(Section.tempo)
                                HowToListen(words: words).id(Section.how)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .frame(maxWidth: 1180)
                    } else {
                        VStack(spacing: 16) {
                            hero(words)
                            spectrum(words)
                            SoundMixerView(words: words).id(Section.voices)
                            SoundControlsView(words: words).id(Section.mix)
                            SoundTempoView(words: words).id(Section.tempo)
                            HowToListen(words: words).id(Section.how)
                        }
                        .frame(maxWidth: 620)
                    }
                }
                .padding(.horizontal, wide ? 24 : 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .onAppear { scrollToLaunchSection(proxy) }
        }
        .onGeometryChange(for: CGSize.self) { $0.size } action: {
            width = $0.width
            height = $0.height
        }
        .navigationTitle(Screen.sound.title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onChange(of: store.revision) { engine.clockChanged() }
        .onAppear { engine.clockChanged() }
        .animation(.snappy, value: engine.preferences.physical)
    }

    private func hero(_ words: SoundWords) -> some View {
        SoundHeroView(words: words, side: heroSide, horizontal: short)
            .padding(.top, 4)
    }

    /// A short, wide window (iPhone in landscape): the ring stands beside its words.
    private var short: Bool { height > 0 && height < 520 && width > height * 1.4 && !wide }

    private var heroSide: CGFloat {
        let available = wide ? (width - 68) / 2 : width - 32
        // keep the ring, its status and the moment button on screen together in a short sheet or window
        let tall = height > 0 ? height * (short ? 0.82 : 0.62) : .infinity
        return max(220, min(available, wide ? 440 : short ? 330 : 290, tall))
    }

    private func spectrum(_ words: SoundWords) -> some View {
        SoundCard {
            SoundScopeView(words: words, height: wide ? 190 : 150)
        }
        .id(Section.spectrum)
    }

    /// The sections `-FXSoundScroll <name>` scrolls to (screenshots of the lower cards).
    private enum Section: String {
        case spectrum, voices, mix, tempo, how
    }

    private func scrollToLaunchSection(_ proxy: ScrollViewProxy) {
        let args = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        #if os(iOS)
        // `-FXSoundLandscape 1` turns the window to landscape (screenshots of the short layout)
        if (args["FXSoundLandscape"] as? String) == "1" {
            Task {
                try? await Task.sleep(for: .milliseconds(800))
                for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
                    scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
                }
            }
        }
        #endif
        guard let name = args["FXSoundScroll"] as? String, let section = Section(rawValue: name) else { return }
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            proxy.scrollTo(section, anchor: .top)
        }
    }
}

/// Four lines on how to listen, folded away.
private struct HowToListen: View {
    let words: SoundWords
    @State private var open = true

    var body: some View {
        SoundCard {
            DisclosureGroup(isExpanded: $open) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(words.how, id: \.head) { item in
                        Text("\(Text(item.head).bold().foregroundStyle(Theme.ink)) \(item.body)")
                            .foregroundStyle(Theme.ink2)
                            .font(.subheadline)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text(footnote)
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 10)
            } label: {
                Label("How to listen", systemImage: "ear")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
            }
            .tint(Theme.ink2)
        }
    }

    private var footnote: String {
        #if os(iOS)
        "The sound keeps playing while you use the rest of the app, and on the lock screen unless you turn background play off. It never starts by itself."
        #else
        "The sound keeps playing while you use the rest of the app; the media keys play and pause it. It never starts by itself."
        #endif
    }
}
