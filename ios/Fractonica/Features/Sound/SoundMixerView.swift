import FractonicaKit
import SwiftUI

/// The voices: one strip per depth in its level colour with a live meter (the same glyph wave the engine plays), its
/// letter to mute it, a tap on the meter to inspect it; below, the inspected voice — where its note comes from, how
/// much of it stays at its valley, solo — and one-tap depth presets in the header.
struct SoundMixerView: View {
    let words: SoundWords
    var stripHeight: CGFloat = 120

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var explained: Int?

    private var engine: SoundEngine { .shared }

    var body: some View {
        SoundCard("Voices") {
            presets
        } content: {
            VStack(alignment: .leading, spacing: 14) {
                strips
                inspector(settings.selectedLevel)
                Text(words.mixerHint)
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onAppear(perform: openLaunchExplanation)
    }

    // MARK: Presets

    private var presets: some View {
        let current = SoundPreset.matching(engine.preferences.levels)
        return HStack(spacing: 4) {
            ForEach(SoundPreset.allCases) { preset in
                Button {
                    engine.update { $0.levels = preset.levels }
                } label: {
                    Text(preset.range)
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .foregroundStyle(current == preset ? Theme.background : Theme.ink2)
                        .background(current == preset ? Theme.teal : Theme.panel3, in: .capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(preset.title), depths \(preset.depths.lowerBound) to \(preset.depths.upperBound)")
                .accessibilityAddTraits(current == preset ? .isSelected : [])
                .help("\(preset.title) (\(preset.range))")
            }
        }
        .sensoryFeedback(.selection, trigger: current) { _, _ in settings.haptics }
    }

    // MARK: Strips

    private var strips: some View {
        let prefs = engine.preferences
        return VStack(spacing: 8) {
            ZStack {
                ClockTimeline(engine.isRunning && !reduceMotion ? .continuous : .animation) { t in
                    let live = SoundLive.at(t, rate: store.rate, prefs: prefs)
                    Canvas { context, size in
                        drawMeters(&context, size: size, live: live, prefs: prefs)
                    }
                }
                HStack(spacing: Self.spacing) {
                    ForEach(SoundTuning.standard) { row in
                        meterTarget(row)
                    }
                }
            }
            .frame(height: stripHeight)
            HStack(spacing: Self.spacing) {
                ForEach(SoundTuning.standard) { row in
                    letterButton(row, on: prefs.levels[row.level])
                }
            }
        }
    }

    private static let spacing: CGFloat = 4

    private func drawMeters(_ context: inout GraphicsContext, size: CGSize, live: SoundLive, prefs: SoundPreferences) {
        let count = CGFloat(SoundTuning.levelCount)
        let width = (size.width - Self.spacing * (count - 1)) / count
        let selected = settings.selectedLevel
        for row in SoundTuning.standard {
            let level = row.level
            let x = CGFloat(level) * (width + Self.spacing)
            let track = CGRect(x: x, y: 0, width: width, height: size.height)
            let shape = Path(roundedRect: track, cornerRadius: min(9, width / 2), style: .continuous)
            let on = prefs.levels[level]
            if !on {
                context.stroke(shape, with: .color(Theme.ink3.opacity(0.35)), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                continue
            }
            context.fill(shape, with: .color(Theme.levelColor(level, opacity: 0.1, lightness: 0.5)))
            let floor = prefs.voiceFloors[level]
            let sounding = prefs.chord && live.inRange
            let loud = sounding ? live.shown[level] : 0
            var clipped = context
            clipped.clip(to: shape)
            if floor > 0 {
                let h = CGFloat(floor) * size.height
                clipped.fill(Path(CGRect(x: x, y: size.height - h, width: width, height: h)), with: .color(Theme.levelColor(level, opacity: 0.22, lightness: 0.55)))
            }
            let h = max(2, CGFloat(loud) * size.height)
            let fill = CGRect(x: x, y: size.height - h, width: width, height: h)
            clipped.fill(Path(fill), with: .linearGradient(
                Gradient(colors: [Theme.levelColor(level, opacity: engine.isOn ? 0.95 : 0.6, lightness: 0.7), Theme.levelColor(level, opacity: engine.isOn ? 0.55 : 0.3, lightness: 0.5)]),
                startPoint: CGPoint(x: x, y: size.height - h), endPoint: CGPoint(x: x, y: size.height)))
            if floor > 0 {
                let y = size.height - CGFloat(floor) * size.height
                var mark = Path()
                mark.move(to: CGPoint(x: x + 2, y: y))
                mark.addLine(to: CGPoint(x: x + width - 2, y: y))
                clipped.stroke(mark, with: .color(Theme.ink.opacity(0.7)), lineWidth: 1)
            }
            context.stroke(shape, with: .color(level == selected ? Theme.cursor : Theme.levelColor(level, opacity: 0.28, lightness: 0.6)), lineWidth: level == selected ? 1.5 : 1)
        }
    }

    /// The invisible meter on top of the drawing: tap to inspect, hold to have its note explained.
    private func meterTarget(_ row: SoundTuning.Row) -> some View {
        Color.clear
            .contentShape(.rect)
            .onTapGesture {
                settings.selectedLevel = row.level
                Haptics.play(.selection)
            }
            .onLongPressGesture {
                settings.selectedLevel = row.level
                explained = row.level
            }
            .popover(isPresented: Binding(get: { explained == row.level }, set: { if !$0 { explained = nil } })) {
                SoundVoiceExplanation(row: row, words: words)
                    .presentationCompactAdaptation(.popover)
            }
            .accessibilityElement()
            .accessibilityLabel("\(row.letter), depth \(row.depth)")
            .accessibilityValue(engine.preferences.levels[row.level] ? "on" : "muted")
            .accessibilityAddTraits(settings.selectedLevel == row.level ? [.isButton, .isSelected] : .isButton)
            .accessibilityHint("Shows this voice below the meters")
            .accessibilityAction(named: "Explain its note") { explained = row.level }
    }

    private func letterButton(_ row: SoundTuning.Row, on: Bool) -> some View {
        Button {
            engine.update { $0.levels[row.level].toggle() }
        } label: {
            Text(row.letter)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(on ? Theme.levelColor(row.level, lightness: 0.72) : Theme.ink3.opacity(0.6))
                .frame(maxWidth: .infinity, minHeight: 30)
                .background(on ? Theme.levelColor(row.level, opacity: 0.14, lightness: 0.5) : .clear, in: .rect(cornerRadius: 8, style: .continuous))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.selection, trigger: on) { _, _ in settings.haptics }
        .accessibilityLabel("\(row.letter), depth \(row.depth)")
        .accessibilityValue(on ? "sounding" : "muted")
        .accessibilityHint(on ? "Mutes this voice" : "Lets this voice sound")
        .help(on ? "Mute \(row.letter) (depth \(row.depth))" : "Let \(row.letter) sound (depth \(row.depth))")
    }

    // MARK: Inspector

    private func inspector(_ level: Int) -> some View {
        let row = SoundTuning.standard[min(max(0, level), SoundTuning.levelCount - 1)]
        let prefs = engine.preferences
        let on = prefs.levels[row.level]
        let floor = Binding(
            get: { engine.preferences.voiceFloors[row.level] },
            set: { value in engine.update { $0.voiceFloors[row.level] = value } }
        )
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(row.letter)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Theme.levelColor(row.level, lightness: 0.72))
                Text("\(row.depth)")
                    .font(.reading(13, weight: .semibold))
                    .foregroundStyle(Theme.ink3)
                Text(words.ratio(row))
                    .font(.code(13))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 4)
                Button(isSolo(row.level) ? "All" : "Solo") {
                    let solo = isSolo(row.level)
                    engine.update { $0.levels = solo ? SoundPreset.standard.levels : (0..<SoundTuning.levelCount).map { $0 == row.level } }
                }
                .font(.caption.weight(.semibold))
                .buttonStyle(.bordered)
                .controlSize(.small)
                .help(isSolo(row.level) ? "Back to the default voices" : "Hear only this voice")
                Button {
                    explained = row.level
                } label: {
                    Image(systemName: "info.circle")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Where the note of \(row.letter) comes from")
            }
            Text(words.voiceLine(row, baseHz: prefs.baseHz))
                .font(.reading(13))
                .foregroundStyle(on ? Theme.ink2 : Theme.ink3)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            HStack(spacing: 10) {
                Text("Floor")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .help("How much of the voice stays at its cycle’s valley")
                Slider(value: floor, in: SoundPreferences.voiceFloorRange)
                    .tint(Theme.levelColor(row.level, lightness: 0.64))
                    .accessibilityLabel("How much of \(row.letter) stays at its valley")
                    .accessibilityValue(words.pure ? pairWords(floor.wrappedValue / 0.5) : "\(Int((floor.wrappedValue * 100).rounded())) percent")
                SoundReadout(text: floor.wrappedValue == 0 ? "silent" : "\(Int((floor.wrappedValue * 100).rounded())) %",
                             fraction: floor.wrappedValue / 0.5, label: "floor", pure: words.pure)
            }
            .disabled(!on)
            .opacity(on ? 1 : 0.5)
        }
        .padding(12)
        .background(Theme.panel2.opacity(0.7), in: .rect(cornerRadius: 16, style: .continuous))
        .animation(.snappy, value: level)
    }

    private func isSolo(_ level: Int) -> Bool {
        engine.preferences.levels == (0..<SoundTuning.levelCount).map { $0 == level }
    }

    private func pairWords(_ fraction: Double) -> String {
        let pair = Notation.pair(fraction)
        return "\(pair.hi) and \(pair.lo) of 256"
    }

    /// `-FXSoundExplain <level>` opens a voice's explanation (screenshots).
    private func openLaunchExplanation() {
        let args = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        let value = (args["FXSoundExplain"] as? String) ?? (args["FXSoundExplain"] as? NSNumber)?.stringValue
        guard let level = value.flatMap(Int.init), (0..<SoundTuning.levelCount).contains(level), explained == nil else { return }
        settings.selectedLevel = level
        Task {
            try? await Task.sleep(for: .milliseconds(600))
            explained = level
        }
    }
}

/// Where a voice's note comes from (the mixer tooltip of the web app): its depth, its true rate against α, the ratio
/// folded into one octave, its place in the register, and what it does now.
struct SoundVoiceExplanation: View {
    let row: SoundTuning.Row
    let words: SoundWords

    @Environment(ClockStore.self) private var store

    private var engine: SoundEngine { .shared }

    var body: some View {
        let prefs = engine.preferences
        let hz = SoundTuning.frequency(row, baseHz: prefs.baseHz)
        let prefix = Double(row.prefix)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(row.letter)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Theme.levelColor(row.level, lightness: 0.72))
                Text("depth \(row.depth)")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 0)
                Text("one cycle = \(words.pure ? words.cycleLength(row.level) : words.wording.duration(row.cycleSeconds, at: store.time(), parts: 2))")
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Theme.ink2)
            }
            if words.pure {
                Text(words.depthKind(row.level))
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
            fact(prefix == 1
                ? "The slowest cycle of the hierarchy is the ground itself: 1 : 1."
                : "\(words.pure ? SoundWords.groupNarrow(prefix) : SoundWords.int(prefix)) such cycles fit in one α cycle: its true rate is \(words.pure ? SoundWords.groupNarrow(prefix) : SoundWords.int(prefix)) : 1 to α.")
            fact("Folded into one octave: \(row.slashText) = ×\(SoundWords.plain(Double(row.num) / Double(row.den), 4)) (\(SoundWords.fixed(row.pcCents, 1))¢).")
            fact(placement(hz))
            fact("True rate of this cycle: \(words.pitch(row.trueHz)).", dim: true)
            ClockTimeline(.periodic(0.5)) { t in
                now(t)
            }
        }
        .padding(18)
        .frame(idealWidth: 360, maxWidth: 420, alignment: .leading)
        .background(Theme.panel.opacity(0.4))
    }

    private func placement(_ hz: Double) -> String {
        let place = row.octave == 0 ? (words.pure ? "in the ground octave" : "at the base octave")
            : "\(row.octave) octave\(row.octave > 1 ? "s" : "") above the \(words.pure ? "ground" : "base")"
        let sounds = row.rel == 1 ? "" : ", sounding at \(SoundWords.plain(row.rel, row.rel < 10 ? 3 : 4)) : 1 to α"
        if words.pure { return "Placed \(place): \(words.pitch(hz))\(sounds)." }
        return "Placed \(place): \(SoundWords.hz(hz)), \(SoundTuning.noteLabel(hz))\(sounds)."
    }

    /// What the voice does now: in pure mode its phase and loudness as glyph pairs (a major period says its running
    /// cycle in words instead of drawing its phase).
    @ViewBuilder
    private func now(_ t: Double) -> some View {
        if let reading = store.clock.level(at: t, row.level) {
            let hz = SoundSchedule.cycleHz(meanSeconds: row.cycleSeconds, rate: store.rate)
            let loud = SoundSchedule.voiceLoudness(phase: reading.phase, hz: hz, floor: engine.preferences.voiceFloors[row.level])
            let p = reading.phase
            let state = abs(p - 0.25) < 0.02 ? "at its peak" : abs(p - 0.75) < 0.02 ? "in its valley" : p < 0.25 || p > 0.75 ? "rising" : "falling"
            if words.pure {
                VStack(alignment: .leading, spacing: 6) {
                    if Notation.isMajor(row.level) {
                        fact("Now: \(words.notation.majorText(at: t, level: row.level)) (\(state))")
                    } else {
                        HStack(spacing: 6) {
                            fact("Now: phase")
                            pair(p, label: "phase")
                            fact("(\(state))")
                        }
                    }
                    HStack(spacing: 6) {
                        fact("Loudness")
                        pair(loud, label: "loudness")
                    }
                }
            } else {
                fact("Now: \(Int((p * 100).rounded())) % through its cycle (\(state)), loudness \(Int((loud * 100).rounded())) %.")
            }
        } else {
            fact("Now: outside the catalogue.")
        }
    }

    private func pair(_ fraction: Double, label: String) -> some View {
        let p = Notation.pair(fraction)
        return PairView(fraction: fraction, color: Theme.levelColor(row.level, lightness: 0.72), height: 22)
            .accessibilityLabel(Text("\(label) \(p.hi) and \(p.lo) of 256"))
    }

    private func fact(_ text: String, dim: Bool = false) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(dim ? Theme.ink3 : Theme.ink2)
            .fixedSize(horizontal: false, vertical: true)
    }
}
