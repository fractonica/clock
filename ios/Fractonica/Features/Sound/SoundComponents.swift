import FractonicaKit
import SwiftUI

/// What every voice does at one displayed instant: computed once per frame for the ring, the spectrum ticks and the
/// mixer meters (the same glyph wave the renderer plays; fast cycles that the eye cannot follow show their mean).
struct SoundLive: Sendable {
    let t: Double
    let inRange: Bool
    /// 0 … 1 through each level's cycle.
    let phase: [Double]
    /// Loudness heard now, 0 … 1 (the voice floor included).
    let loud: [Double]
    /// Loudness to draw: fast modulations (above 4 Hz of real time) are drawn as their mean, steady, so the screen
    /// never flickers at a cycle's rate.
    let shown: [Double]

    static func at(_ t: Double, rate: Double, prefs: SoundPreferences, clock: FractonicaClock = .shared) -> SoundLive {
        guard let pos = clock.position(at: t) else {
            let zero = Array(repeating: 0.0, count: SoundTuning.levelCount)
            return SoundLive(t: t, inRange: false, phase: zero, loud: zero, shown: zero)
        }
        var phase: [Double] = []
        var loud: [Double] = []
        var shown: [Double] = []
        for level in 0..<SoundTuning.levelCount {
            let info = clock.levelInfo(level)
            let p = SoundSchedule.phase(position: pos, prefix: info.prefixDouble)
            let hz = SoundSchedule.cycleHz(meanSeconds: info.meanSeconds, rate: rate)
            let floor = prefs.voiceFloors[level]
            let l = SoundSchedule.voiceLoudness(phase: p, hz: hz, floor: floor)
            phase.append(p)
            loud.append(l)
            shown.append(hz > 4 ? floor + (1 - floor) * SoundSchedule.meanLoudness() : l)
        }
        return SoundLive(t: t, inRange: true, phase: phase, loud: loud, shown: shown)
    }
}

/// A rounded panel with an optional header: the cards of the Sound screen.
struct SoundCard<Content: View, Accessory: View>: View {
    let title: String?
    @ViewBuilder var accessory: Accessory
    @ViewBuilder var content: Content

    init(_ title: String? = nil, @ViewBuilder accessory: () -> Accessory = { EmptyView() }, @ViewBuilder content: () -> Content) {
        self.title = title
        self.accessory = accessory()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let title {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(title)
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    accessory
                }
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel.opacity(0.72), in: .rect(cornerRadius: 22, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(Theme.line.opacity(0.9), lineWidth: 1)
        }
    }
}

/// A small capsule of information ("Live · ×1", "depth 1–12").
struct SoundChip: View {
    let text: String
    var color: Color = Theme.ink2
    var systemImage: String?

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).imageScale(.small) }
            Text(text).lineLimit(1)
        }
        .font(.caption.monospacedDigit())
        .foregroundStyle(color)
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(color.opacity(0.1), in: .capsule)
        .overlay { Capsule().strokeBorder(color.opacity(0.18), lineWidth: 1) }
    }
}

/// A value read-out beside a slider: text in normal mode, a glyph pair (no percentages) in pure mode.
struct SoundReadout: View {
    let text: String
    /// The fraction 0 … 1 a pure-mode glyph pair shows instead of `text`, if any.
    var fraction: Double?
    var label: String
    var pure: Bool

    var body: some View {
        Group {
            if pure, let fraction {
                PairView(fraction: fraction, color: Theme.teal, height: 20)
                    .accessibilityLabel(Text("\(label) \(Notation.pair(fraction).hi) and \(Notation.pair(fraction).lo) of 256"))
            } else {
                Text(text)
                    .font(.reading(13))
                    .foregroundStyle(Theme.ink2)
            }
        }
        .frame(minWidth: 58, alignment: .trailing)
    }
}

/// A labelled slider row of the Sound card.
struct SoundSliderRow<Readout: View>: View {
    let title: String
    let systemImage: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    var step: Double?
    var accessibilityValue: String
    @ViewBuilder var readout: Readout

    var body: some View {
        HStack(spacing: 12) {
            Label(title, systemImage: systemImage)
                .labelStyle(SoundRowLabelStyle())
                .frame(width: 92, alignment: .leading)
            Group {
                if let step {
                    Slider(value: $value, in: range, step: step)
                } else {
                    Slider(value: $value, in: range)
                }
            }
            .accessibilityLabel(title)
            .accessibilityValue(accessibilityValue)
            readout
        }
    }
}

/// An icon and a caption, the icon tinted.
struct SoundRowLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 7) {
            configuration.icon
                .foregroundStyle(Theme.teal)
                .frame(width: 18)
            configuration.title
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .font(.subheadline)
    }
}
