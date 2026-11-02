import FractonicaKit
import SwiftUI

/// A moment's call, full screen (a sheet on the Mac), as a phone shows one: the moment's period for the caller's name,
/// its boundary under it, and how far the moment is. Ringing: Mute and Decline over slide to answer. Picked up: the
/// call's length, the back camera's picture small (the screen goes dark at the ear), a photo button and the red button
/// to hang up. Muted: the instant view takes its place. Then Call Ended, Declined (each camera's photo) or Missed Call
/// in red, with the entry written and Edit and Done.
struct MomentCallView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(\.dismiss) private var dismiss

    @State private var model: MomentCallModel
    @State private var moments = MomentStore.shared
    @State private var journal = JournalStore.shared

    init(request: InstantRequest) {
        _model = State(initialValue: MomentCallModel(request: request))
    }

    var body: some View {
        Group {
            if let instant = model.instant {
                InstantView(model: instant)
            } else {
                call
            }
        }
        .task { model.open() }
        .onDisappear {
            model.close()
            moments.instantClosed()
        }
        .onChange(of: moments.pick) { _, pick in
            // the alarm's Answer or Stop for this call, its screen up already
            guard let pick, pick.index == model.moment.index, !model.demo else { return }
            if pick.answer { model.answer() } else { model.decline() }
        }
        .interactiveDismissDisabled(model.phase == .ringing || model.phase == .talking)
        #if os(macOS)
        .frame(minWidth: 440, idealWidth: 480, minHeight: 720, idealHeight: 780)
        #endif
    }

    private var call: some View {
        let words = settings.wording
        return ZStack {
            CallBackdrop(moment: model.moment, missed: model.phase == .ended(.missed))
            VStack(spacing: 0) {
                header(words)
                    .padding(.top, 36)
                switch model.phase {
                case .ringing:
                    Spacer(minLength: 24)
                    ringing
                case .talking:
                    Spacer(minLength: 16)
                    talking
                case .filming:
                    Spacer()
                case .ended(let outcome):
                    ended(outcome, words)
                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
            .frame(maxWidth: 520)
        }
        .preferredColorScheme(.dark)
        .animation(.snappy, value: model.phase)
    }

    // MARK: Parts

    /// The caller: what calls, the period, its boundary, how far the moment is (or how long the call lasts).
    private func header(_ words: Wording) -> some View {
        let m = model.moment
        return VStack(spacing: 6) {
            Text(verbatim: caption)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(model.phase == .ended(.missed) ? Theme.danger : .white.opacity(0.7))
            Text(verbatim: m.periodName(words.notation))
                .font(.system(size: 42, weight: .semibold))
                .foregroundStyle(model.phase == .ended(.missed) ? Theme.danger : .white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(verbatim: m.boundaryWord)
                .font(.title3.weight(.medium))
                .foregroundStyle(Theme.levelColor(m.level.kitLevel, lightness: 0.75))
            TimelineView(.periodic(from: .now, by: model.phase == .talking ? 0.25 : 0.1)) { context in
                if let status = status(at: context.date.timeIntervalSince1970, pure: words.pure) {
                    Text(verbatim: status)
                        .font(.reading(17, weight: .medium))
                        .foregroundStyle(.white.opacity(0.75))
                        .contentTransition(.identity)
                }
            }
            .padding(.top, 2)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var caption: String {
        let rarity = model.moment.rarity.title
        switch model.phase {
        case .ringing: return "Fractonica · \(rarity) moment"
        case .talking: return "Recording · back camera"
        case .filming: return ""
        case .ended(.answered): return "Call Ended"
        case .ended(.declined): return "Declined"
        case .ended(.missed): return "Missed Call"
        case .ended(.muted): return ""
        }
    }

    /// "in 0λ 18ν" while ringing (then "now", "0λ 6ν ago"), the call's length while talking and after.
    private func status(at t: Double, pure: Bool) -> String? {
        let flavon = FractonicaClock.shared.levelInfo(10).meanSeconds
        switch model.phase {
        case .talking, .ended(.answered):
            return Self.length(model.talked(at: t), pure: pure, flavon: flavon)
        case .ended, .filming:
            return nil
        case .ringing:
            let ahead = model.moment.time - t
            if abs(ahead) < 0.15 { return "now" }
            let reading = Self.flavons(abs(ahead) / flavon)
            return ahead > 0 ? "in \(reading)" : "\(reading) ago"
        }
    }

    /// "0λ 18ν".
    static func flavons(_ f: Double) -> String {
        let whole = Int(f)
        return "\(whole)λ \(String(format: "%02d", min(24, Int((f - Double(whole)) * 25))))ν"
    }

    /// "1:23" ("10λ 17ν" in pure mode).
    static func length(_ seconds: Double, pure: Bool, flavon: Double) -> String {
        if pure { return flavons(seconds / flavon) }
        let s = Int(seconds)
        return "\(s / 60):\(String(format: "%02d", s % 60))"
    }

    // MARK: Ringing

    private var ringing: some View {
        VStack(spacing: 34) {
            HStack(alignment: .top, spacing: 0) {
                CallButton(symbol: "bell.slash.fill", title: "Mute", fill: .white.opacity(0.2)) { model.mute() }
                    .accessibilityHint("Films both cameras from now through the moment")
                    .frame(maxWidth: .infinity)
                CallButton(symbol: "phone.down.fill", title: "Decline", fill: Color(red: 0.92, green: 0.2, blue: 0.22)) { model.decline() }
                    .accessibilityHint("Takes a photo with each camera")
                    .keyboardShortcut(.cancelAction)
                    .frame(maxWidth: .infinity)
            }
            SlideToAnswer { model.answer() }
                .keyboardShortcut(.defaultAction)
        }
    }

    // MARK: Talking

    private var talking: some View {
        VStack(spacing: 26) {
            ZStack {
                Color.black
                if let main = model.camera.main, let layer = model.camera.previews[main] {
                    MomentCameraPreview(layer: layer)
                } else {
                    Image(systemName: model.camera.mode == .denied ? "video.slash" : "video")
                        .font(.system(size: 30))
                        .foregroundStyle(.white.opacity(0.4))
                }
                SnapFlash(count: model.snapFlashes)
            }
            .frame(width: 168, height: 224)
            .clipShape(.rect(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(.white.opacity(0.18), lineWidth: 1))
            .overlay(alignment: .topLeading) {
                Label("REC", systemImage: "circle.fill")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(.white)
                    .symbolEffect(.pulse)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.black.opacity(0.5), in: .capsule)
                    .padding(10)
            }
            .overlay(alignment: .bottom) {
                if model.reachedMoment {
                    Text("past the moment")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.white.opacity(0.8))
                        .padding(8)
                }
            }
            .accessibilityElement()
            .accessibilityLabel("The back camera, filming")
            Spacer(minLength: 0)
            CallButton(symbol: "camera.fill", title: model.snaps > 0 ? "Photo (\(model.snaps))" : "Photo", fill: .white.opacity(0.2)) {
                model.snap()
            }
            CallButton(symbol: "phone.down.fill", title: "End", fill: Color(red: 0.92, green: 0.2, blue: 0.22), size: 78) {
                model.hangUp()
            }
            .keyboardShortcut(.cancelAction)
        }
    }

    // MARK: Ended

    @ViewBuilder
    private func ended(_ outcome: MomentOutcome, _ words: Wording) -> some View {
        let record = model.savedID.flatMap { journal.record($0) }
        ScrollView {
            VStack(spacing: 18) {
                switch outcome {
                case .declined:
                    if let record { DeclinedPhotos(record: record) }
                case .missed:
                    Image(systemName: "phone.down.circle.fill")
                        .font(.system(size: 76))
                        .foregroundStyle(.white, Theme.danger)
                        .padding(.top, 30)
                    Text(model.demo ? "A test call rang out." : "Rang for \(MomentCalendar.ringFlavons) Flavons unanswered.")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                default:
                    if let record { CaptureCard(record: record, words: words) }
                }
                if model.saving || (record == nil && outcome != .missed && model.trouble == nil) {
                    ProgressView("Saving…")
                        .tint(.white)
                        .padding(.top, 24)
                }
                if let trouble = model.trouble {
                    Text(verbatim: "Saved — \(trouble)")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                }
                if record != nil {
                    StreakLine(stats: moments.stats, rarity: model.moment.rarity)
                }
                buttons(record)
            }
            .padding(.top, 24)
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private func buttons(_ record: HubRecord?) -> some View {
        HStack(spacing: 12) {
            if let record {
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
            }
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
        .disabled(model.saving)
    }
}

/// Behind the call: the moment's rarity colour glowing from the top over the dark, its level's letter large and faint,
/// as a contact's poster (red for a missed call).
private struct CallBackdrop: View {
    let moment: Moment
    var missed = false

    var body: some View {
        let color = missed ? Theme.danger : moment.rarity.color
        ZStack {
            Theme.background
            LinearGradient(colors: [color.opacity(0.42), color.opacity(0.12), Theme.background], startPoint: .top, endPoint: .bottom)
            Text(verbatim: moment.level.letter)
                .font(.system(size: 420, weight: .ultraLight, design: .serif))
                .foregroundStyle(.white.opacity(0.06))
                .offset(y: -60)
            RadialGradient(colors: [color.opacity(0.35), .clear], center: .top, startRadius: 0, endRadius: 420)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// A round button with its word under it, as on a phone's call screen.
private struct CallButton: View {
    let symbol: String
    let title: String
    let fill: Color
    var size: CGFloat = 72
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.38, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(fill, in: .circle)
                Text(title)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}

/// Slide to answer: the green knob dragged across the track (or a tap with VoiceOver, Return on the Mac).
private struct SlideToAnswer: View {
    let action: () -> Void

    @State private var offset: CGFloat = 0
    @State private var answered = false
    @State private var shine = false

    var body: some View {
        GeometryReader { proxy in
            let knob: CGFloat = 66
            let travel = max(1, proxy.size.width - knob - 10)
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.14))
                Capsule().stroke(.white.opacity(0.12), lineWidth: 1)
                Text("slide to answer")
                    .font(.title3)
                    .foregroundStyle(.white.opacity(0.55))
                    .overlay {
                        // the light sweeping across the words
                        GeometryReader { words in
                            LinearGradient(colors: [.clear, .white, .clear], startPoint: .leading, endPoint: .trailing)
                                .frame(width: 70)
                                .offset(x: shine ? words.size.width : -70)
                        }
                        .mask(Text("slide to answer").font(.title3))
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.leading, knob)
                    .opacity(1 - Double(offset / travel) * 1.6)
                Circle()
                    .fill(Color(red: 0.2, green: 0.78, blue: 0.35))
                    .overlay(Image(systemName: "phone.fill").font(.system(size: 26, weight: .medium)).foregroundStyle(.white))
                    .frame(width: knob, height: knob)
                    .offset(x: 5 + offset)
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                guard !answered else { return }
                                offset = min(max(0, value.translation.width), travel)
                            }
                            .onEnded { _ in
                                guard !answered else { return }
                                if offset > travel * 0.75 {
                                    answered = true
                                    withAnimation(.snappy) { offset = travel }
                                    action()
                                } else {
                                    withAnimation(.spring(duration: 0.35)) { offset = 0 }
                                }
                            }
                    )
            }
        }
        .frame(height: 76)
        .onAppear {
            withAnimation(.linear(duration: 1.8).repeatForever(autoreverses: false)) { shine = true }
        }
        .accessibilityElement()
        .accessibilityLabel("Slide to answer")
        .accessibilityHint("Films with the back camera until you hang up")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            answered = true
            action()
        }
    }
}

/// A declined call's photos as the reel shows its cameras: the selfie's square over the back camera's.
private struct DeclinedPhotos: View {
    let record: HubRecord

    var body: some View {
        let photos = record.mediaBlobs.filter { $0.role == "photo" }
        let ordered = ["front", "back", "camera"].compactMap { name in photos.first { $0.name == name } }
        VStack(spacing: 2) {
            ForEach(ordered, id: \.hash) { blob in
                Color.clear
                    .aspectRatio(1, contentMode: .fit)
                    .overlay { BlobImage(blob: blob, points: 420) }
                    .clipped()
            }
        }
        .background(.black)
        .clipShape(.rect(cornerRadius: 24, style: .continuous))
        .frame(maxWidth: 250)
        .accessibilityElement()
        .accessibilityLabel("A photo from each camera, taken as the call was declined")
    }
}

/// A flash over the camera when its frame is kept.
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
