import FractonicaKit
import SwiftUI
#if os(iOS)
import UIKit
#endif

/// The instant view: a moment's call, answered (MomentCallView shows it in the call's place), filming both cameras from
/// the pick-up until hung up. Nothing but the cameras live as the reel will show them (the selfie's square over the back
/// camera's): a tap on one keeps its frame as a photo, a long press lights the torch, the back camera's lens button
/// changes lens; a small countdown at their foot ticks to the moment itself (a flash and a strong haptic there) — or,
/// picked up after it, MISSED in red — and the red button hangs up. Then the reel is made (a progress bar), the entry
/// saves itself and the Journal shows it. Only when the reel or a camera went amiss does the view stay, its card — the
/// reel playing — saying so, with Done.
struct InstantView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model: InstantModel
    @State private var moments = MomentStore.shared
    @State private var journal = JournalStore.shared
    @State private var flash = 0.0

    init(model: InstantModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        let words = settings.wording
        let rarity = model.moment.rarity
        ZStack {
            background(rarity)
            VStack(spacing: 18) {
                if let id = model.savedID, let record = journal.record(id) {
                    saved(record, words)
                } else {
                    cameras(rarity, words)
                    footer
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
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
            // saved: the Journal shows it (unless something went amiss, which the card says)
            if case .saved = phase, model.reelFailure == nil, model.filmTrouble == nil {
                dismiss()
                router.show(.journal)
            }
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

    /// The cameras as the reel will show them, the selfie's square over the back camera's, the countdown at their foot.
    private func cameras(_ rarity: MomentRarity, _ words: Wording) -> some View {
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        let camera = model.camera
        let previews = camera.previews
        let squares = previews.isEmpty ? (camera.mode == .none ? ["front", "back"] : ["back"]) : ["front", "back", "camera"].filter { previews[$0] != nil }
        return VStack(spacing: 2) {
            ForEach(squares, id: \.self) { name in
                ZStack {
                    Theme.panel
                    if let layer = previews[name] {
                        MomentCameraPreview(layer: layer)
                    } else {
                        CameraPlaceholder(moment: model.moment, mode: camera.mode, camera: name)
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
                .overlay(alignment: .topLeading) {
                    if name == "back" { backControls }
                }
                .contentShape(.rect)
                .onTapGesture { model.snap(name) }
                .onLongPressGesture(minimumDuration: 0.5) { model.toggleTorch() }
                .allowsHitTesting(model.takesExtras)
                .accessibilityElement()
                .accessibilityLabel(name == "front" ? "Selfie camera" : "Back camera")
                .accessibilityHint("Takes a photo for the entry")
                .accessibilityAddTraits(.isButton)
                .accessibilityAction(named: camera.torch ? "Torch off" : "Torch on") { model.toggleTorch() }
            }
        }
        .background(.black)
        .overlay(alignment: .bottom) {
            if model.phase != .waiting {
                InstantCountdown(model: model, pure: words.pure, color: rarity.color)
                    .padding(12)
            }
        }
        .overlay(alignment: .topTrailing) {
            if model.phase == .filming { RecordingDot().padding(16) }
        }
        .clipShape(shape)
        .rarityFrame(rarity, cornerRadius: 28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .layoutPriority(-1)
    }

    /// On the back camera's square: the lens (a tap changes it) and the torch, lit.
    @ViewBuilder
    private var backControls: some View {
        let camera = model.camera
        HStack(spacing: 8) {
            if camera.lenses.count > 1 {
                Button {
                    Haptics.play(.selection)
                    camera.nextLens()
                } label: {
                    Text(verbatim: MomentCallView.lensName(camera.lenses[camera.lens]))
                        .font(.caption.weight(.bold).monospacedDigit())
                        .foregroundStyle(Theme.gold)
                        .frame(minWidth: 34, minHeight: 34)
                        .background(.black.opacity(0.55), in: .circle)
                        .contentTransition(.numericText())
                        .animation(.snappy, value: camera.lens)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Lens \(MomentCallView.lensName(camera.lenses[camera.lens]))")
                .accessibilityHint("Changes the back camera's lens")
            }
            if camera.torch {
                Image(systemName: "flashlight.on.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Theme.gold)
                    .frame(width: 34, height: 34)
                    .background(.black.opacity(0.55), in: .circle)
                    .accessibilityLabel("Torch on")
            }
        }
        .padding(12)
    }

    /// The red button while it films; the reel's progress after.
    @ViewBuilder
    private var footer: some View {
        switch model.phase {
        case .waiting, .filming:
            Button {
                model.hangUp()
            } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 72, height: 72)
                    .background(Color(red: 0.92, green: 0.2, blue: 0.22), in: .circle)
            }
            .buttonStyle(.plain)
            .keyboardShortcut(.cancelAction)
            .accessibilityLabel("Hang up")
            .accessibilityHint("Ends the film and makes the reel")
        case .developing, .saving:
            VStack(spacing: 8) {
                Text("Making the reel")
                    .font(.caption.weight(.bold))
                    .textCase(.uppercase)
                    .kerning(1)
                    .foregroundStyle(.white.opacity(0.75))
                ProgressTrack(fraction: model.phase == .saving ? 1 : model.developed, color: model.moment.rarity.color)
                    .frame(width: 200, height: 4)
            }
            .frame(height: 72)
            .animation(.snappy, value: model.developed)
        case .saved, .failed(_):
            if case .failed(let reason) = model.phase {
                Text(verbatim: reason).font(.footnote).foregroundStyle(Theme.ink3)
            }
        }
    }

    /// The saved entry as its card (when something went amiss, which it says), the streak and Done.
    private func saved(_ record: HubRecord, _ words: Wording) -> some View {
        ScrollView {
            VStack(spacing: 18) {
                Text(verbatim: model.reelFailure.map { "Saved the films as they are — \($0)" }
                    ?? model.filmTrouble.map { "Saved — \($0)" } ?? "Saved")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
                CaptureCard(record: record, words: words, plays: true)
                    .transition(.scale(scale: 0.92).combined(with: .opacity))
                StreakLine(stats: moments.stats, rarity: record.rarity)
                Button {
                    dismiss()
                    router.show(.journal)
                } label: {
                    Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .glassProminentButtonStyle()
                .tint(Theme.teal)
                .keyboardShortcut(.defaultAction)
                .controlSize(.large)
                .buttonBorderShape(.capsule)
            }
            .padding(.top, 16)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// A muted call: both cameras filming with the screen dark (its brightness down too, given back after) until a Flavon
/// after the moment, a dim line saying so and how long is left, and End to stop sooner. Then the film is saved and the
/// Journal shows it.
struct MutedView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var model: InstantModel
    @State private var moments = MomentStore.shared
    #if os(iOS)
    @State private var brightness: CGFloat?
    #endif

    init(model: InstantModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 14) {
                Spacer()
                TimelineView(.periodic(from: .now, by: 0.25)) { context in
                    Text(verbatim: line(at: context.date.timeIntervalSince1970, pure: settings.wording.pure))
                        .font(.reading(15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.28))
                        .multilineTextAlignment(.center)
                        .contentTransition(.identity)
                }
                Spacer()
                if model.takesExtras {
                    Button {
                        model.hangUp()
                    } label: {
                        Text("End")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.35))
                            .padding(.horizontal, 22)
                            .padding(.vertical, 10)
                            .overlay(Capsule().stroke(.white.opacity(0.18), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.cancelAction)
                    .accessibilityHint("Stops filming now and saves")
                } else {
                    ProgressView().tint(.white.opacity(0.4))
                }
            }
            .padding(.bottom, 24)
        }
        .preferredColorScheme(.dark)
        #if os(iOS)
        .statusBarHidden()
        #endif
        .task {
            dim(true)
            model.open()
        }
        .onDisappear {
            dim(false)
            model.close()
            moments.instantClosed()
        }
        .onChange(of: model.phase) { _, phase in
            if case .saved = phase {
                dim(false)
                dismiss()
                router.show(.journal)
            }
        }
    }

    /// "● Filming · the moment in 0λ 12ν" — "… ends in 0λ 20ν" after it — then "Saving".
    private func line(at t: Double, pure: Bool) -> String {
        switch model.phase {
        case .waiting, .filming:
            let flavon = model.flavonSeconds
            if !model.missed, model.moment.time > t {
                return "● Filming both cameras\nthe moment in \(MomentCallView.flavons((model.moment.time - t) / flavon))"
            }
            let left = model.filmEnd - t
            return left.isFinite ? "● Filming both cameras\nends in \(MomentCallView.flavons(max(0, left) / flavon))" : "● Filming both cameras"
        case .developing, .saving: return "Saving"
        case .saved: return "Saved"
        case .failed(let reason): return reason
        }
    }

    /// The screen's brightness right down while it films, and back as it was.
    private func dim(_ on: Bool) {
        #if os(iOS)
        guard let screen = (UIApplication.shared.connectedScenes.first { $0 is UIWindowScene } as? UIWindowScene)?.screen else { return }
        if on {
            if brightness == nil { brightness = screen.brightness }
            screen.brightness = 0
        } else if let brightness {
            screen.brightness = brightness
            self.brightness = nil
        }
        #endif
    }
}

/// "0λ 13ν" and the seconds, small, ticking to the moment while filming (then "Now"; MISSED in red for a film picked
/// up after it).
private struct InstantCountdown: View {
    let model: InstantModel
    let pure: Bool
    let color: Color

    var body: some View {
        let filming = model.phase == .filming
        TimelineView(.animation(minimumInterval: 1 / 15, paused: !filming)) { context in
            let t = context.date.timeIntervalSince1970
            let f = model.flavons(at: t)
            let reached = model.moment.time <= t
            HStack(spacing: 8) {
                if !filming {
                    EmptyView()
                } else if model.missed {
                    Text(verbatim: MomentReelText.missed)
                        .font(.reading(13, weight: .heavy))
                        .kerning(2)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(Theme.danger, in: .capsule)
                } else {
                    Text(verbatim: reached ? "The moment" : "The moment in")
                        .font(.caption2.weight(.bold))
                        .textCase(.uppercase)
                        .kerning(0.8)
                        .foregroundStyle(.white.opacity(0.75))
                    Text(verbatim: reached ? "Now" : Self.reading(f))
                        .font(.reading(18, weight: .semibold))
                        .foregroundStyle(color)
                        .contentTransition(.identity)
                    if !pure && !reached {
                        Text(verbatim: String(format: "%.1f s", max(0, model.moment.time - t)))
                            .font(.reading(12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.7))
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(.black.opacity(filming ? 0.45 : 0), in: .capsule)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibility(f, reached: reached))
        }
    }

    /// "0λ 13ν".
    static func reading(_ flavons: Double) -> String {
        let f = max(0, flavons)
        let whole = Int(f)
        return "\(whole)λ \(String(format: "%02d", min(24, Int((f - Double(whole)) * 25))))ν"
    }

    private func accessibility(_ f: Double, reached: Bool) -> String {
        let whole = Int(f), blinks = min(24, Int((f - Double(whole)) * 25))
        if model.missed { return "Filming, the moment missed" }
        return reached ? "Filming past the moment" : "Filming, \(whole) Flavons \(blinks) Blinks to the moment"
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
