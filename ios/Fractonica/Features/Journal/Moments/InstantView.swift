import FractonicaKit
import SwiftUI

/// The instant view: full screen (a sheet on the Mac), from 11 Flavons before a moment until it is captured. The
/// moment's name in its level's colour, the cameras live (back with the front inset, BeReal style), a big countdown in
/// Flavons and Blinks (and seconds outside pure mode) ticking to the exact moment, an emoji and a line to write, and
/// the voice recording with its meter and a mute switch. At the moment: a flash and a strong haptic, the entry saves
/// itself and shows as its card, with its rarity's frame and the streak.
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
            writing = false
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
            .accessibilityLabel(model.savedID == nil ? "Close without capturing" : "Close")
            .keyboardShortcut(.cancelAction)
            Spacer()
            RarityBadge(rarity: rarity)
        }
        .padding(.top, 6)
    }

    private func title(_ words: Wording) -> some View {
        VStack(spacing: 4) {
            Text(verbatim: model.moment.title(words.notation))
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
        case .waiting: "\(model.moment.rarity.title) moment · captured at the exact moment"
        case .capturing: "Capturing…"
        case .saved: "Captured and saved"
        case .failed(let reason): reason
        }
    }

    /// The cameras with the countdown over them.
    private func cameras(_ rarity: MomentRarity, _ words: Wording) -> some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        return ZStack {
            Theme.panel
            if let main = model.camera.mainLayer {
                MomentCameraPreview(layer: main)
            } else {
                CameraPlaceholder(moment: model.moment, mode: model.camera.mode)
            }
        }
        .overlay(alignment: .topLeading) {
            if let inset = model.camera.insetLayer {
                MomentCameraPreview(layer: inset)
                    .aspectRatio(3 / 4, contentMode: .fit)
                    .frame(width: 112)
                    .clipShape(.rect(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(.white.opacity(0.7), lineWidth: 1.5))
                    .padding(12)
            }
        }
        .overlay(alignment: .bottom) {
            InstantCountdown(model: model, pure: words.pure, color: rarity.color)
                .padding(14)
        }
        .clipShape(shape)
        .rarityFrame(rarity, cornerRadius: 28)
        .frame(maxHeight: .infinity)
        .layoutPriority(-1)
    }

    /// Emoji, the line, the microphone.
    private var composer: some View {
        VStack(spacing: 10) {
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
                    .disabled(model.phase != .waiting)
            }
            MicrophoneRow(model: model)
        }
    }

    /// The saved entry as its card, the streak, Edit and Done.
    private func saved(_ record: HubRecord, _ words: Wording) -> some View {
        ScrollView {
            VStack(spacing: 18) {
                JournalCard(record: record, words: words)
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
            .padding(.top, 6)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// "10λ 13ν" and the seconds, ticking to the moment; the last three Flavons in the rarity's colour.
private struct InstantCountdown: View {
    let model: InstantModel
    let pure: Bool
    let color: Color

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 15, paused: model.phase != .waiting)) { context in
            let t = context.date.timeIntervalSince1970
            let f = model.flavons(at: t)
            let whole = Int(f)
            let blinks = min(24, Int((f - Double(whole)) * 25))
            let seconds = max(0, model.moment.time - t)
            let done = model.phase != .waiting
            VStack(spacing: 2) {
                Text(verbatim: done ? "Now" : "\(whole)λ \(String(format: "%02d", blinks))ν")
                    .font(.reading(46, weight: .semibold))
                    .foregroundStyle(f < 3 || done ? color : .white)
                    .contentTransition(.identity)
                if !pure && !done {
                    Text(verbatim: String(format: "%.1f s", seconds))
                        .font(.reading(15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.7))
                }
                ProgressTrack(fraction: done ? 0 : min(1, f / Double(MomentCalendar.leadFlavons)), color: color)
                    .frame(width: 180, height: 4)
                    .padding(.top, 4)
            }
            .padding(.horizontal, 22)
            .padding(.vertical, 12)
            .background(.black.opacity(0.42), in: .rect(cornerRadius: 22, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(done ? "Captured" : "\(whole) Flavons \(blinks) Blinks to the moment")
        }
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

/// The recording's meter, its state and the mute switch.
private struct MicrophoneRow: View {
    @Bindable var model: InstantModel

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 18)
            Text(label)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
            MicLevelMeter(levels: Array(model.recorder.levels.suffix(28)), active: model.recorder.state == .recording)
                .frame(height: 22)
            Button {
                model.muted.toggle()
            } label: {
                Image(systemName: model.muted ? "mic.slash.fill" : "mic.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 40, height: 34)
                    .contentShape(.capsule)
            }
            .buttonStyle(.plain)
            .foregroundStyle(model.muted ? Theme.danger : Theme.ink)
            .background(Theme.panel2, in: .capsule)
            .disabled(!model.recorder.isActive)
            .accessibilityLabel(model.muted ? "Unmute the microphone" : "Mute the microphone")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.panel.opacity(0.8), in: .capsule)
        .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
    }

    private var icon: String {
        switch model.recorder.state {
        case .recording: "record.circle"
        case .paused: "pause.circle"
        case .denied, .failed: "mic.slash"
        case .idle: "waveform"
        }
    }

    private var tint: Color {
        model.recorder.state == .recording ? Theme.danger : Theme.ink3
    }

    private var label: String {
        switch model.recorder.state {
        case .recording: "Recording"
        case .paused: "Muted"
        case .denied: "Microphone off"
        case .failed(let reason): reason
        case .idle: model.phase == .waiting ? "Listening soon" : "Saved"
        }
    }
}

/// Recent levels as bars, newest on the right.
private struct MicLevelMeter: View {
    let levels: [Float]
    let active: Bool

    var body: some View {
        GeometryReader { proxy in
            HStack(alignment: .center, spacing: 2) {
                ForEach(Array(levels.enumerated()), id: \.offset) { _, level in
                    Capsule()
                        .fill(active ? Theme.teal : Theme.ink3.opacity(0.5))
                        .frame(height: max(3, proxy.size.height * CGFloat(level)))
                }
            }
            .frame(maxHeight: .infinity)
        }
        .accessibilityHidden(true)
    }
}

/// Where there is no camera (the Simulator, a Mac without one) or it is not allowed: the moment's letter on its
/// rarity's colours.
private struct CameraPlaceholder: View {
    let moment: Moment
    let mode: MomentCamera.Mode

    var body: some View {
        let c = moment.rarity.color
        ZStack {
            LinearGradient(colors: [c.opacity(0.35), Theme.panel, Theme.background], startPoint: .top, endPoint: .bottom)
            Circle().fill(c.opacity(0.25)).blur(radius: 60).frame(width: 220).offset(x: -60, y: -90)
            VStack(spacing: 10) {
                Text(verbatim: moment.level.letter)
                    .font(.system(size: 120, weight: .ultraLight, design: .serif))
                    .foregroundStyle(.white.opacity(0.85))
                Label(caption, systemImage: mode == .denied ? "video.slash" : "camera.aperture")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.65))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .padding(.bottom, 90)
        }
    }

    private var caption: String {
        switch mode {
        case .starting: "Starting the cameras…"
        case .denied: "Camera access is off — the moment is captured with your voice"
        default: "No camera here — a still of the moment stands in"
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
