import FractonicaKit
import SwiftUI

/// The top of the Sound screen: the chord as a pitch ring around the power button, what is playing, and "Hear this
/// moment".
struct SoundHeroView: View {
    let words: SoundWords
    var side: CGFloat

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var engine: SoundEngine { .shared }

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                ClockTimeline(engine.isRunning && !reduceMotion ? .continuous : .animation) { t in
                    let live = SoundLive.at(t, rate: store.rate, prefs: engine.preferences)
                    SoundRingView(live: live, words: words, selected: settings.selectedLevel, running: engine.isOn,
                                  reduceMotion: reduceMotion, now: .now)
                }
                .contentShape(.circle)
                .gesture(SpatialTapGesture().onEnded { value in select(at: value.location) })
                PowerButton(words: words)
            }
            .frame(width: side, height: side)

            ClockTimeline(engine.isRunning ? .continuous : .periodic(1)) { t in
                statusLine(t)
            }
            chips
            MomentButton(words: words)
        }
        .frame(maxWidth: .infinity)
    }

    private func select(at location: CGPoint) {
        let geometry = SoundRingGeometry(size: CGSize(width: side, height: side), labelRoom: SoundRingView.labelRoom(pure: words.pure))
        guard let level = geometry.hit(location, cents: SoundTuning.standard.map(\.pcCents)) else { return }
        settings.selectedLevel = level
        Haptics.play(.selection)
    }

    private func statusLine(_ t: Double) -> some View {
        let inRange = store.clock.inRange(t)
        let bells = engine.isRunning ? engine.soundingBells : 0
        return HStack(spacing: 8) {
            Circle()
                .fill(!inRange ? Theme.danger : engine.isOn ? Theme.teal : Theme.ink3)
                .frame(width: 7, height: 7)
            Text(words.status(on: engine.isOn, inRange: inRange, sampleRate: engine.sampleRate, voices: engine.voiceCount, interrupted: engine.interrupted))
                .foregroundStyle(inRange ? Theme.ink2 : Theme.danger)
            if engine.isOn && inRange {
                Text("· \(bells) bell\(bells == 1 ? "" : "s")")
                    .foregroundStyle(Theme.ink3)
                    .contentTransition(.numericText())
            }
        }
        .font(.subheadline.monospacedDigit())
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .accessibilityElement(children: .combine)
    }

    private var chips: some View {
        let prefs = engine.preferences
        return HStack(spacing: 6) {
            SoundChip(text: words.clockChip(live: store.isLive, rate: store.rate),
                      color: store.isLive ? Theme.live : store.isPaused ? Theme.ink2 : Theme.cursor,
                      systemImage: store.isPaused ? "pause.fill" : store.isLive ? nil : "forward.fill")
            SoundChip(text: words.depths(prefs.levels))
            SoundChip(text: words.layers(prefs))
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// The big round switch in the middle of the ring.
private struct PowerButton: View {
    let words: SoundWords

    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var engine: SoundEngine { .shared }

    var body: some View {
        let on = engine.isOn
        Button {
            engine.toggle()
            if let failure = engine.failure { toasts.show("Audio could not start: \(failure)") }
        } label: {
            Image(systemName: on ? "speaker.wave.3.fill" : "speaker.slash.fill")
                .font(.system(size: 30, weight: .semibold))
                .symbolEffect(.variableColor.iterative.dimInactiveLayers.nonReversing, options: .repeating, isActive: on && !reduceMotion)
                .contentTransition(.symbolEffect(.replace))
                .foregroundStyle(on ? Theme.teal : Theme.ink2)
                .frame(width: 88, height: 88)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(on ? Theme.teal.opacity(0.2) : .clear).interactive(), in: .circle)
        .shadow(color: on ? Theme.teal.opacity(0.35) : .clear, radius: 18)
        .sensoryFeedback(.impact(weight: .medium), trigger: on) { _, _ in settings.haptics }
        .accessibilityLabel("Sound")
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityHint(on ? "Fades the sound out" : "Starts the chord and the bells of the clock")
        .help(on ? "Turn the sound off" : "Turn the sound on")
    }
}

/// "Hear this moment": the chord of the displayed instant as a short arpeggio, also while the sound is off.
private struct MomentButton: View {
    let words: SoundWords

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts

    private var engine: SoundEngine { .shared }
    @State private var plays = 0

    var body: some View {
        Button {
            if engine.playMoment(at: store.time()) {
                plays += 1
            } else if let failure = engine.failure {
                toasts.show("Audio could not start: \(failure)")
            } else {
                toasts.show(words.pure ? "Outside the catalogue: no chord to play" : "Outside the Saros 141 catalogue: no chord to play")
            }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "music.note.list")
                    .font(.body.weight(.semibold))
                    .symbolEffect(.bounce, value: plays)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Hear this moment")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    ClockTimeline(.periodic(1)) { t in
                        Text(words.moment(t))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
        }
        .buttonStyle(.glass)
        .sensoryFeedback(.impact(weight: .light), trigger: plays) { _, _ in settings.haptics }
        .accessibilityHint("Plays the chord of the displayed moment as a short arpeggio")
    }
}

/// The pitch ring: twelve spokes of 100 cents, one ring per depth, a dot per voice as large and bright as its cycle is
/// loud now; bells ripple out of their dots as they ring and the notes of "Hear this moment" light up in turn.
struct SoundRingView: View {
    let live: SoundLive
    let words: SoundWords
    let selected: Int
    let running: Bool
    let reduceMotion: Bool
    let now: Date

    private var engine: SoundEngine { .shared }

    static func labelRoom(pure: Bool) -> CGFloat { pure ? 30 : 22 }

    var body: some View {
        let prefs = engine.preferences
        let flashes = engine.flashes
        let moment = engine.moment
        Canvas { context, size in
            draw(&context, size: size, prefs: prefs, flashes: flashes, moment: moment)
        }
        .accessibilityElement()
        .accessibilityLabel("Pitch ring")
        .accessibilityValue(summary(prefs))
    }

    private func draw(_ context: inout GraphicsContext, size: CGSize, prefs: SoundPreferences, flashes: [SoundEngine.Flash], moment: SoundEngine.MomentPlay?) {
        let rows = SoundTuning.standard
        let g = SoundRingGeometry(size: size, labelRoom: Self.labelRoom(pure: words.pure))
        let chord = prefs.chord

        // a soft halo of the ground behind everything while the sound plays
        if running {
            let halo = Path(ellipseIn: CGRect(x: g.center.x - g.outer, y: g.center.y - g.outer, width: 2 * g.outer, height: 2 * g.outer))
            context.fill(halo, with: .radialGradient(Gradient(colors: [Theme.teal.opacity(0.10), .clear]), center: g.center, startRadius: g.inner * 0.6, endRadius: g.outer * 1.05))
        }
        // depth rings
        for level in rows.indices {
            let r = g.radius(level)
            let ring = Path(ellipseIn: CGRect(x: g.center.x - r, y: g.center.y - r, width: 2 * r, height: 2 * r))
            let isSelected = level == selected
            context.stroke(ring, with: .color(isSelected ? Theme.cursor.opacity(0.4) : Theme.line2.opacity(0.42)), lineWidth: isSelected ? 1.2 : 0.7)
        }
        // spokes and their names
        let base = SoundTuning.note(of: prefs.baseHz)
        let names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]
        for k in 0..<12 {
            var spoke = Path()
            spoke.move(to: g.point(radius: g.inner - 8, cents: Double(k) * 100))
            spoke.addLine(to: g.point(radius: g.outer + 5, cents: Double(k) * 100))
            context.stroke(spoke, with: .color(k == 0 ? Theme.ink3.opacity(0.8) : Theme.line2.opacity(0.55)), lineWidth: k == 0 ? 1 : 0.7)
            let label: String
            if words.pure {
                label = k % 3 == 0 ? (k == 0 ? "1/1" : "\(k * 100)¢") : ""
            } else {
                label = names[(((base.midi + k) % 12) + 12) % 12]
            }
            guard !label.isEmpty else { continue }
            let text = Text(label).font(.system(size: 10, weight: k == 0 ? .semibold : .regular)).foregroundStyle(k == 0 ? Theme.ink : Theme.ink3)
            context.draw(text, at: g.point(radius: g.outer + (words.pure ? 17 : 13), cents: Double(k) * 100))
        }

        // bells ringing now: ripples out of their dots
        if !reduceMotion {
            for flash in flashes {
                let age = now.timeIntervalSince(flash.at)
                guard age >= 0, age < 0.9, flash.level < rows.count else { continue }
                let u = age / 0.9
                let p = g.point(level: flash.level, cents: rows[flash.level].pcCents)
                let r = 6 + 26 * CGFloat(u)
                let ripple = Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r))
                context.stroke(ripple, with: .color(Theme.levelColor(flash.level, opacity: (1 - u) * (0.35 + 0.6 * flash.strength), lightness: 0.72)), lineWidth: 1.4)
            }
        }
        var momentLevels = Set<Int>()
        if let moment {
            for note in moment.notes {
                let age = now.timeIntervalSince(moment.start) - note.offset
                if age >= 0 && age < 0.45 { momentLevels.insert(note.level) }
            }
        }

        // the voices
        for row in rows {
            let level = row.level
            let p = g.point(level: level, cents: row.pcCents)
            let on = prefs.levels[level]
            guard on else {
                let dot = Path(ellipseIn: CGRect(x: p.x - 3, y: p.y - 3, width: 6, height: 6))
                context.stroke(dot, with: .color(Theme.ink3.opacity(0.5)), lineWidth: 1)
                continue
            }
            let loud = live.inRange && chord ? live.shown[level] : 0
            let size = 3 + 5.5 * CGFloat(loud)
            if running && loud > 0.18 && !reduceMotion {
                var glow = context
                glow.addFilter(.blur(radius: 4 + 8 * loud))
                let r = size * 1.9
                glow.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)),
                          with: .color(Theme.levelColor(level, opacity: 0.55 * loud, lightness: 0.62)))
            }
            let dot = Path(ellipseIn: CGRect(x: p.x - size, y: p.y - size, width: 2 * size, height: 2 * size))
            context.fill(dot, with: .color(Theme.levelColor(level, opacity: (running ? 0.45 : 0.32) + 0.55 * loud, lightness: 0.64)))
            if level == selected {
                let r = size + 3.5
                context.stroke(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)), with: .color(Theme.cursor), lineWidth: 1.4)
            }
            if momentLevels.contains(level) {
                let r = size + 6.5
                context.stroke(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)), with: .color(Theme.levelColor(level, lightness: 0.8)), lineWidth: 1.6)
            }
            // the letter beside the dot, clockwise along its ring (clear of the spoke names and of a voice that shares
            // the spoke at the next depth)
            let a = g.angle(cents: row.pcCents) + .pi / 2
            let lp = CGPoint(x: p.x + CGFloat(cos(a)) * (size + 7), y: p.y + CGFloat(sin(a)) * (size + 7))
            context.draw(Text(row.letter).font(.system(size: 9, weight: .semibold)).foregroundStyle(Theme.levelColor(level, lightness: 0.78)), at: lp)
        }
    }

    /// The ring in words: the loudest voices now.
    private func summary(_ prefs: SoundPreferences) -> String {
        guard live.inRange else { return "Outside the catalogue" }
        let loudest = SoundTuning.standard
            .filter { prefs.levels[$0.level] && prefs.chord }
            .sorted { live.loud[$0.level] > live.loud[$1.level] }
            .prefix(3)
            .map { row -> String in
                let l = live.loud[row.level]
                if words.pure {
                    let pair = Notation.pair(l)
                    return "\(row.letter) loudness \(pair.hi) and \(pair.lo) of 256"
                }
                return "\(row.letter) \(Int((l * 100).rounded())) percent"
            }
        return loudest.isEmpty ? "No voice sounds" : "Loudest voices now: " + loudest.joined(separator: ", ")
    }
}
