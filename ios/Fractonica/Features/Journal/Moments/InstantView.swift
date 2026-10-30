import FractonicaKit
import SwiftUI

/// The instant view: full screen (a sheet on the Mac), from 11 Flavons before a moment until its reel is saved. The
/// moment's name in its level's colour, the cameras live as the reel will show them (the selfie's square over the back
/// camera's; a tap on one keeps its frame as a photo), a big countdown in Flavons and Blinks (and seconds outside pure
/// mode) ticking to the film — half a Flavon before the moment — then, filming, to the moment itself (a flash and a
/// strong haptic there), an emoji, a line to write and a microphone to hold for a voice note. When the film ends the
/// reel is made (a progress bar), the entry saves itself and shows as its card — the reel playing — with its rarity's
/// frame and the streak.
struct InstantView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model: InstantModel
    @State private var moments = MomentStore.shared
    @State private var journal = JournalStore.shared
    @State private var showEmoji = false
    @State private var flash = 0.0
    @FocusState private var writing: Bool

    init(request: InstantRequest) {
        _model = State(initialValue: InstantModel(request: request))
    }

    var body: some View {
        let words = settings.wording
        let rarity = model.moment.rarity
        ZStack {
            background(rarity)
            VStack(spacing: 14) {
                topBar(rarity)
                title(words)
                if let id = model.savedID, let record = journal.record(id) {
                    saved(record, words)
                } else {
                    cameras(rarity, words)
                    composer
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .frame(maxWidth: 620)
            Color.white
                .opacity(flash)
                .ignoresSafeArea()
                .allowsHitTesting(false)
        }
        .preferredColorScheme(.dark)
        .task { model.open() }
        .onDisappear {
            model.close()
            moments.instantClosed()
        }
        .onChange(of: model.flashes) {
            flash = reduceMotion ? 0.5 : 0.95
            withAnimation(.easeOut(duration: reduceMotion ? 0.3 : 0.7)) { flash = 0 }
        }
        .onChange(of: model.phase) { _, phase in
            // the keyboard goes when the film ends (the line is saved with the entry)
            if phase == .developing { writing = false }
        }
        .animation(.snappy, value: model.phase)
        #if os(macOS)
        .frame(minWidth: 520, idealWidth: 560, minHeight: 760, idealHeight: 820)
        #endif
    }

    // MARK: Parts

    private func background(_ rarity: MomentRarity) -> some View {
        ZStack {
            Theme.background
            RadialGradient(colors: [rarity.color.opacity(0.22), .clear], center: .top, startRadius: 10, endRadius: 520)
        }
        .ignoresSafeArea()
    }

    private func topBar(_ rarity: MomentRarity) -> some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 36, height: 36)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.ink2)
            .background(Theme.panel2.opacity(0.8), in: .circle)
            .accessibilityLabel(model.savedID != nil ? "Close" : model.reachedMoment ? "Close and keep the film" : "Close without capturing")
            .keyboardShortcut(.cancelAction)
            Spacer()
            RarityBadge(rarity: rarity)
        }
        .padding(.top, 6)
    }

    private func title(_ words: Wording) -> some View {
        VStack(spacing: 4) {
            Text.ledByPentad(model.moment.pentad, Text(verbatim: model.moment.title(words.notation)), separator: " · ")
                .font(.title2.weight(.bold))
                .foregroundStyle(Theme.levelColor(model.moment.level.kitLevel, lightness: 0.7))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.7)
            Text(verbatim: subtitle)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.ink3)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var subtitle: String {
        switch model.phase {
        case .waiting: "Tap a camera for a photo · hold the microphone to talk"
        case .filming: "Filming"
        case .developing: "Making the reel…"
        case .saving: "Saving…"
        case .saved: model.reelFailure.map { "Saved the films as they are — \($0)" } ?? "Captured and saved"
        case .failed(let reason): reason
        }
    }

    /// The cameras as the reel will show them, the selfie's square over the back camera's, the countdown at their seam.
    private func cameras(_ rarity: MomentRarity, _ words: Wording) -> some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        let previews = model.camera.previews
        let squares = previews.isEmpty ? (model.camera.mode == .none ? ["front", "back"] : ["back"]) : ["front", "back", "camera"].filter { previews[$0] != nil }
        return VStack(spacing: 2) {
            ForEach(squares, id: \.self) { name in
                ZStack {
                    Theme.panel
                    if let layer = previews[name] {
                        MomentCameraPreview(layer: layer)
                    } else {
                        CameraPlaceholder(moment: model.moment, mode: model.camera.mode, camera: name)
                    }
                }
                .aspectRatio(1, contentMode: .fit)
                .clipped()
                .overlay { SnapFlash(count: model.snapFlashes[name] ?? 0) }
                .overlay(alignment: name == "front" ? .topLeading : .bottomLeading) {
                    if let n = model.snaps[name], n > 0 {
                        Label(n == 1 ? "1 photo" : "\(n) photos", systemImage: "photo")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 5)
                            .background(.black.opacity(0.5), in: .capsule)
                            .padding(12)
                    }
                }
                .contentShape(.rect)
                .onTapGesture { model.snap(name) }
                .allowsHitTesting(model.takesExtras)
                .accessibilityElement()
                .accessibilityLabel(name == "front" ? "Selfie camera" : "Back camera")
                .accessibilityHint("Takes a photo for the entry")
                .accessibilityAddTraits(.isButton)
            }
        }
        .background(.black)
        .overlay {
            InstantCountdown(model: model, pure: words.pure, color: rarity.color)
                .padding(14)
        }
        .overlay(alignment: .topTrailing) {
            if model.phase == .filming { RecordingDot().padding(16) }
        }
        .clipShape(shape)
        .rarityFrame(rarity, cornerRadius: 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .layoutPriority(-1)
    }

    /// Emoji and the line.
    private var composer: some View {
        HStack(spacing: 12) {
            Button { showEmoji = true } label: {
                ZStack {
                    Circle().fill(Theme.panel2)
                    Circle().stroke(Theme.line2, lineWidth: 1)
                    if let emoji = model.emoji, !emoji.isEmpty {
                        Text(verbatim: emoji).font(.system(size: 30))
                    } else {
                        Image(systemName: "face.smiling").font(.system(size: 22)).foregroundStyle(Theme.teal)
                    }
                }
                .frame(width: 54, height: 54)
                .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.emoji.map { "Emoji \($0), change" } ?? "Choose an emoji")
            .popover(isPresented: $showEmoji) {
                EmojiPicker(selection: $model.emoji) { showEmoji = false }
                    .frame(minWidth: 340, idealWidth: 380, minHeight: 440, idealHeight: 520)
                    .presentationDetents([.medium, .large])
            }
            TextField("What’s happening?", text: $model.text, axis: .vertical)
                .lineLimit(1...3)
                .focused($writing)
                .font(.body)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Theme.panel2, in: .rect(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
                .disabled(model.phase == .saving || model.savedID != nil)
            HoldToTalk(model: model)
        }
    }

    /// The saved entry as its card, the streak, Edit and Done.
    private func saved(_ record: HubRecord, _ words: Wording) -> some View {
        ScrollView {
            VStack(spacing: 18) {
                CaptureCard(record: record, words: words, plays: true)
                    .transition(.scale(scale: 0.92).combined(with: .opacity))
                StreakLine(stats: moments.stats, rarity: record.rarity)
                HStack(spacing: 12) {
                    Button {
                        let id = record.id
                        dismiss()
                        Task {
                            try? await Task.sleep(for: .milliseconds(650))
                            router.show(.journal)
                            JournalUI.shared.edit(id)
                        }
                    } label: {
                        Label("Edit", systemImage: "pencil").frame(maxWidth: .infinity)
                    }
                    .glassButtonStyle()
                    Button {
                        dismiss()
                    } label: {
                        Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity)
                    }
                    .glassProminentButtonStyle()
                    .tint(Theme.teal)
                    .keyboardShortcut(.defaultAction)
                }
                .controlSize(.large)
                .buttonBorderShape(.capsule)
            }
            .padding(.top, 16)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// "10λ 13ν" and the seconds, ticking to the film; filming, to the moment (then "Now"); then the reel's progress.
private struct InstantCountdown: View {
    let model: InstantModel
    let pure: Bool
    let color: Color

    var body: some View {
        let waiting = model.phase == .waiting || model.phase == .filming
        TimelineView(.animation(minimumInterval: 1 / 15, paused: !waiting)) { context in
            let t = context.date.timeIntervalSince1970
            let filming = model.phase == .filming
            let f = model.flavons(at: t)
            VStack(spacing: 2) {
                switch model.phase {
                case .waiting, .filming:
                    Text(verbatim: filming ? (model.reachedMoment ? "The moment" : "The moment in") : "Filming in")
                        .font(.caption.weight(.bold))
                        .textCase(.uppercase)
                        .kerning(1)
                        .foregroundStyle(.white.opacity(0.75))
                    Text(verbatim: filming && model.reachedMoment ? "Now" : Self.reading(f))
                        .font(.reading(46, weight: .semibold))
                        .foregroundStyle(filming || f < 3 ? color : .white)
                        .contentTransition(.identity)
                    if !pure && !(filming && model.reachedMoment) {
                        Text(verbatim: String(format: "%.1f s", max(0, (filming ? model.center : model.filmStart) - t)))
                            .font(.reading(15, weight: .medium))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                    ProgressTrack(fraction: filming ? min(1, max(0, (t - model.filmStart) / (model.filmEnd - model.filmStart)))
                                      : min(1, f / Double(MomentCalendar.leadFlavons)), color: color)
                        .frame(width: 180, height: 4)
                        .padding(.top, 4)
                case .developing, .saving:
                    Text("Making the reel")
                        .font(.caption.weight(.bold))
                        .textCase(.uppercase)
                        .kerning(1)
                        .foregroundStyle(.white.opacity(0.75))
                    ProgressTrack(fraction: model.phase == .saving ? 1 : model.developed, color: color)
                        .frame(width: 180, height: 4)
                        .padding(.top, 6)
                case .saved, .failed:
                    EmptyView()
                }
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 12)
            .background(.black.opacity(0.42), in: .rect(cornerRadius: 22, style: .continuous))
            .animation(.snappy, value: model.developed)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibility(f))
        }
    }

    /// "10λ 13ν".
    static func reading(_ flavons: Double) -> String {
        let f = max(0, flavons)
        let whole = Int(f)
        return "\(whole)λ \(String(format: "%02d", min(24, Int((f - Double(whole)) * 25))))ν"
    }

    private func accessibility(_ f: Double) -> String {
        let whole = Int(f), blinks = min(24, Int((f - Double(whole)) * 25))
        switch model.phase {
        case .waiting: return "\(whole) Flavons \(blinks) Blinks to the film"
        case .filming: return model.reachedMoment ? "Filming past the moment" : "Filming, \(whole) Flavons \(blinks) Blinks to the moment"
        case .developing, .saving: return "Making the reel"
        default: return "Captured"
        }
    }
}

/// A camera square's flash when its frame is kept.
private struct SnapFlash: View {
    let count: Int
    @State private var opacity = 0.0

    var body: some View {
        Color.white
            .opacity(opacity)
            .allowsHitTesting(false)
            .onChange(of: count) {
                opacity = 0.85
                withAnimation(.easeOut(duration: 0.45)) { opacity = 0 }
            }
    }
}

/// The microphone to hold: the voice note records while it is held (red, a little larger), its length so far above.
private struct HoldToTalk: View {
    let model: InstantModel
    @GestureState private var pressed = false

    var body: some View {
        let on = model.talking
        ZStack {
            Circle().fill(on ? Theme.danger : Theme.panel2)
            Circle().stroke(on ? Theme.danger : Theme.line2, lineWidth: 1)
            Image(systemName: on ? "waveform" : "mic.fill")
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(on ? .white : model.takesExtras ? Theme.teal : Theme.ink3)
                .symbolEffect(.variableColor.iterative, isActive: on)
        }
        .frame(width: 54, height: 54)
        .scaleEffect(on ? 1.12 : 1)
        .animation(.snappy, value: on)
        .overlay(alignment: .top) {
            if on || model.voiceSeconds > 0 {
                TimelineView(.periodic(from: .now, by: 0.25)) { context in
                    Text(verbatim: Self.length(model.voiceLength(at: context.date.timeIntervalSince1970)))
                        .font(.caption2.weight(.bold).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(on ? Theme.danger : .black.opacity(0.6), in: .capsule)
                        .fixedSize()
                }
                .offset(y: -16)
            }
        }
        .contentShape(.circle)
        .gesture(DragGesture(minimumDistance: 0).updating($pressed) { _, pressed, _ in pressed = true })
        .onChange(of: pressed) { _, held in model.talk(held) }
        .opacity(model.takesExtras || model.voiceSeconds > 0 ? 1 : 0.5)
        .allowsHitTesting(model.takesExtras)
        .accessibilityElement()
        .accessibilityLabel(on ? "Recording a voice note" : "Hold to record a voice note")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { model.talk(!model.talking) }
    }

    /// "0:07".
    static func length(_ seconds: Double) -> String {
        let s = Int(seconds)
        return "\(s / 60):\(String(format: "%02d", s % 60))"
    }
}

/// A red dot breathing while the cameras film.
private struct RecordingDot: View {
    @State private var on = false

    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Theme.danger).frame(width: 10, height: 10).opacity(on ? 1 : 0.35)
            Text("REC").font(.caption.weight(.heavy)).kerning(1).foregroundStyle(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.black.opacity(0.45), in: .capsule)
        .onAppear { withAnimation(.easeInOut(duration: 0.6).repeatForever()) { on = true } }
        .accessibilityLabel("Filming")
    }
}

private struct ProgressTrack: View {
    let fraction: Double
    let color: Color

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.18))
                Capsule().fill(color).frame(width: proxy.size.width * fraction)
            }
        }
    }
}

/// Where there is no camera (the Simulator, a Mac without one) or it is not allowed: the moment's letter on its
/// rarity's colours.
private struct CameraPlaceholder: View {
    let moment: Moment
    let mode: MomentCamera.Mode
    var camera = "back"

    var body: some View {
        let c = moment.rarity.color
        ZStack {
            LinearGradient(colors: [camera == "back" ? c.opacity(0.35) : Theme.teal.opacity(0.3), Theme.panel, Theme.background],
                           startPoint: .top, endPoint: .bottom)
            Circle().fill(c.opacity(0.25)).blur(radius: 50).frame(width: 160).offset(x: camera == "back" ? -50 : 50, y: -40)
            VStack(spacing: 6) {
                Text(verbatim: moment.level.letter)
                    .font(.system(size: 64, weight: .ultraLight, design: .serif))
                    .foregroundStyle(.white.opacity(0.85))
                if camera == "back" {
                    Label(caption, systemImage: mode == .denied ? "video.slash" : "camera.aperture")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.white.opacity(0.65))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                }
            }
        }
    }

    private var caption: String {
        switch mode {
        case .starting: "Starting the cameras…"
        case .denied: "Camera access is off — the moment is kept without its film"
        default: "No camera here — a drawn film stands in"
        }
    }
}

/// "🔥 12 in a row · best 30", or the first capture's welcome.
struct StreakLine: View {
    let stats: MomentStats
    var rarity: MomentRarity = .rare

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "flame.fill")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(stats.current > 0 ? Theme.gold : Theme.ink3)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: stats.current == 1 ? "1 moment in a row" : "\(stats.current) moments in a row")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Text(verbatim: "Best \(stats.best) · \(stats.capturedCount) captured")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(Theme.panel.opacity(0.8), in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
