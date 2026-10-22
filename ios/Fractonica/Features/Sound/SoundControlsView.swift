import FractonicaKit
import SwiftUI

/// The mix: volume, room, the ground the chord stands on, the layers, the chime floor, the physical register and (iOS)
/// playing in the background.
struct SoundControlsView: View {
    let words: SoundWords

    @Environment(AppSettings.self) private var settings
    @State private var floorHelp = false

    private var engine: SoundEngine { .shared }

    var body: some View {
        let prefs = engine.preferences
        SoundCard("Mix") {
            VStack(alignment: .leading, spacing: 16) {
                volume(prefs)
                reverb(prefs)
                ground(prefs)
                Divider().overlay(Theme.line)
                layers(prefs)
                floor(prefs)
                if prefs.physical { physical(prefs) }
                #if os(iOS)
                Divider().overlay(Theme.line)
                Toggle(isOn: binding(\.backgroundPlay)) {
                    Label("Play in the background", systemImage: "lock.iphone")
                        .labelStyle(SoundRowLabelStyle())
                }
                .tint(Theme.teal)
                #endif
            }
        }
    }

    private func binding<T>(_ key: WritableKeyPath<SoundPreferences, T>) -> Binding<T> {
        Binding(get: { engine.preferences[keyPath: key] }, set: { value in engine.update { $0[keyPath: key] = value } })
    }

    private func volume(_ prefs: SoundPreferences) -> some View {
        let range = SoundPreferences.volumeRange
        let fraction = (prefs.volumeDb - range.lowerBound) / (range.upperBound - range.lowerBound)
        return SoundSliderRow(title: "Volume", systemImage: "speaker.wave.2.fill", value: binding(\.volumeDb), range: range, step: 1,
                              accessibilityValue: words.pure ? pairWords(fraction, "volume") : SoundWords.db(prefs.volumeDb)) {
            SoundReadout(text: SoundWords.db(prefs.volumeDb), fraction: fraction, label: "volume", pure: words.pure)
        }
    }

    private func reverb(_ prefs: SoundPreferences) -> some View {
        SoundSliderRow(title: "Reverb", systemImage: "dot.radiowaves.left.and.right", value: binding(\.reverb), range: SoundPreferences.reverbRange,
                       accessibilityValue: words.pure ? pairWords(prefs.reverb, "reverb") : "\(Int((prefs.reverb * 100).rounded())) percent") {
            SoundReadout(text: "\(Int((prefs.reverb * 100).rounded())) %", fraction: prefs.reverb, label: "reverb", pure: words.pure)
        }
    }

    private func ground(_ prefs: SoundPreferences) -> some View {
        let value = Binding(get: { Double(engine.preferences.baseSemitones) }, set: { v in engine.update { $0.baseSemitones = Int(v.rounded()) } })
        let g = words.ground(prefs.baseSemitones)
        return SoundSliderRow(title: words.pure ? "Ground" : "Base pitch", systemImage: "tuningfork", value: value,
                              range: Double(SoundPreferences.semitoneRange.lowerBound)...Double(SoundPreferences.semitoneRange.upperBound), step: 1,
                              accessibilityValue: "\(g.head), \(g.sub)") {
            VStack(alignment: .trailing, spacing: 0) {
                Text(g.head)
                    .font(.reading(12))
                    .foregroundStyle(Theme.ink2)
                Text(g.sub)
                    .font(.reading(11))
                    .foregroundStyle(Theme.ink3)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(minWidth: 58, alignment: .trailing)
        }
        .sensoryFeedback(.selection, trigger: prefs.baseSemitones) { _, _ in settings.haptics }
        .help(words.pure
            ? "The ground of the chord: α stands on it as 1/1 and every other voice is an exact ratio above it. Steps of 100 cents, an octave at either end."
            : "The note of α, the 1/1 of the chord. Every other voice is an exact ratio above it.")
    }

    private func layers(_ prefs: SoundPreferences) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Layers")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
            HStack(spacing: 8) {
                layer("Chord", systemImage: "waveform", key: \.chord,
                      help: "One soft voice per cycle at its just-intonation pitch: it swells to the cycle’s peak and fades to its valley; μ ν ξ beat at their true rates.")
                layer("Chimes", systemImage: "bell.fill", key: \.chimes,
                      help: "A bell at every peak, node, valley and end; a cycle end strums every finer cycle that ends with it, so a major turnover rings as a big chord.")
                layer("Physical", systemImage: "atom", key: \.physical, help: words.physicalHelp)
            }
        }
    }

    private func layer(_ title: String, systemImage: String, key: WritableKeyPath<SoundPreferences, Bool>, help: String) -> some View {
        let on = engine.preferences[keyPath: key]
        return Button {
            engine.update { $0[keyPath: key].toggle() }
        } label: {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .foregroundStyle(on ? Theme.teal : Theme.ink3)
                .background(on ? Theme.teal.opacity(0.14) : Theme.panel3.opacity(0.6), in: .capsule)
                .overlay { Capsule().strokeBorder(on ? Theme.teal.opacity(0.4) : Theme.line2, lineWidth: 1) }
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: on) { _, _ in settings.haptics }
        .accessibilityValue(on ? "on" : "off")
        .accessibilityAddTraits(.isToggle)
        .accessibilityHint(help)
        .help(help)
    }

    private func floor(_ prefs: SoundPreferences) -> some View {
        HStack(spacing: 12) {
            Label("Chime floor", systemImage: "metronome")
                .labelStyle(SoundRowLabelStyle())
            Button {
                floorHelp.toggle()
            } label: {
                Image(systemName: "questionmark.circle")
                    .foregroundStyle(Theme.ink3)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("What the chime floor does")
            .popover(isPresented: $floorHelp) {
                Text(words.floorHelp)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
                    .frame(idealWidth: 320, maxWidth: 360)
                    .presentationCompactAdaptation(.popover)
            }
            Spacer(minLength: 4)
            Menu {
                Picker("Chime floor", selection: Binding(get: { engine.preferences.nearestFloor }, set: { v in engine.update { $0.floor = v } })) {
                    ForEach(SoundPreferences.floors, id: \.seconds) { option in
                        Text(words.floorOption(option.seconds, name: option.name)).tag(option.seconds)
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Text(words.floorOption(prefs.nearestFloor, name: nil))
                        .font(.reading(14, weight: .semibold))
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption2.weight(.semibold))
                }
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(prefs.chimes ? Theme.teal : Theme.ink3)
            }
            .menuIndicator(.hidden)
            .accessibilityLabel("Chime floor")
            .accessibilityValue(words.floorOption(prefs.nearestFloor, name: SoundPreferences.floors.first { $0.seconds == prefs.nearestFloor }?.name))
            .disabled(!prefs.chimes)
        }
    }

    private func physical(_ prefs: SoundPreferences) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                Label("Transpose", systemImage: "arrow.up.and.down")
                    .labelStyle(SoundRowLabelStyle())
                Spacer(minLength: 4)
                Text(words.octaveShift(prefs.physShift))
                    .font(.reading(13))
                    .foregroundStyle(Theme.ink2)
                Stepper("Transpose", value: binding(\.physShift), in: SoundPreferences.physShiftRange)
                    .labelsHidden()
                    .accessibilityValue(words.octaveShift(prefs.physShift))
            }
            Text(words.physicalList(prefs.physShift))
                .font(.code(12))
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
    }

    private func pairWords(_ fraction: Double, _ label: String) -> String {
        let pair = Notation.pair(fraction)
        return "\(label) \(pair.hi) and \(pair.lo) of 256"
    }
}
