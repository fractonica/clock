import FractonicaKit
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// A moment's call, full screen (a sheet on the Mac), as a phone shows one: the moment's period for the caller's name,
/// its boundary under it, and how far the moment is. Ringing: Mute and Decline over slide to answer. Answered, the
/// instant view takes its place; muted, the dark recording screen (`MutedView`). Declined or missed: Declined or Missed
/// Call (in red) while the entry is written, then the screen goes — a declined call leaves the app as a phone does, a
/// missed one just closes. Only when saving went amiss does it stay, saying so.
struct MomentCallView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var model: MomentCallModel
    @State private var moments = MomentStore.shared

    init(request: InstantRequest) {
        _model = State(initialValue: MomentCallModel(request: request))
    }

    var body: some View {
        Group {
            if let instant = model.instant {
                if instant.mode == .answered { InstantView(model: instant) } else { MutedView(model: instant) }
            } else {
                call
            }
        }
        .task { model.open() }
        .onDisappear {
            model.close()
            moments.instantClosed()
        }
        .onChange(of: model.finished) { _, outcome in
            guard let outcome else { return }
            leave(after: outcome)
        }
        .onChange(of: moments.pick) { _, pick in
            // the alarm's Answer or Stop for this call, its screen up already
            guard let pick, pick.index == model.moment.index, !model.demo else { return }
            if pick.answer { model.answer() } else { model.decline() }
        }
        .interactiveDismissDisabled(model.phase != .ended(.missed))
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
                case .filming:
                    Spacer()
                case .ended(let outcome):
                    ended(outcome)
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

    /// The caller: what calls, the period, its boundary, how far the moment is.
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
            TimelineView(.periodic(from: .now, by: 0.1)) { context in
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
        case .ended(.declined): return "Declined"
        case .ended(.missed): return "Missed Call"
        case .filming, .ended: return ""
        }
    }

    /// "in 0λ 18ν" while ringing (then "now", "0λ 6ν ago").
    private func status(at t: Double, pure: Bool) -> String? {
        let flavon = FractonicaClock.shared.levelInfo(10).meanSeconds
        switch model.phase {
        case .ended, .filming:
            return nil
        case .ringing:
            let ahead = model.moment.time - t
            if abs(ahead) < 0.15 { return "now" }
            let reading = Self.flavons(abs(ahead) / flavon)
            return ahead > 0 ? "in \(reading)" : "\(reading) ago"
        }
    }

    /// "0.5×", "1×", "3×".
    static func lensName(_ lens: Double) -> String {
        (lens == lens.rounded() ? String(Int(lens)) : String(format: "%.1f", lens)) + "×"
    }

    /// "0λ 18ν".
    static func flavons(_ f: Double) -> String {
        let whole = Int(f)
        return "\(whole)λ \(String(format: "%02d", min(24, Int((f - Double(whole)) * 25))))ν"
    }


    // MARK: Ringing

    private var ringing: some View {
        VStack(spacing: 34) {
            HStack(alignment: .top, spacing: 0) {
                CallButton(symbol: "bell.slash.fill", title: "Mute", fill: .white.opacity(0.2)) { model.mute() }
                    .accessibilityHint("Films both cameras with the screen dark until a Flavon after the moment")
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

    // MARK: Ended

    /// While the entry is written (or, when that went amiss, why, and Done).
    private func ended(_ outcome: MomentOutcome) -> some View {
        VStack(spacing: 18) {
            Spacer()
            if outcome == .missed {
                Image(systemName: "phone.down.circle.fill")
                    .font(.system(size: 76))
                    .foregroundStyle(.white, Theme.danger)
            }
            if let trouble = model.trouble {
                Text(verbatim: "Saved — \(trouble)")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
                Button {
                    dismiss()
                } label: {
                    Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .glassProminentButtonStyle()
                .tint(Theme.teal)
                .controlSize(.large)
                .buttonBorderShape(.capsule)
                .keyboardShortcut(.defaultAction)
            } else if outcome != .missed {
                ProgressView().tint(.white).controlSize(.large)
            }
            Spacer()
        }
    }

    /// The call is done: declined, out of the app (as a phone puts a declined call away); missed, back where it rang.
    private func leave(after outcome: MomentOutcome) {
        dismiss()
        switch outcome {
        case .declined:
            Task {
                // once the screen has gone
                try? await Task.sleep(for: .milliseconds(450))
                Self.leaveApp()
            }
        default:
            break
        }
    }

    /// Puts the app away to the Home Screen (or the Lock Screen it came from); the Mac hides it.
    static func leaveApp() {
        #if os(iOS)
        UIControl().sendAction(#selector(URLSessionTask.suspend), to: UIApplication.shared, for: nil)
        #else
        NSApp.hide(nil)
        #endif
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
