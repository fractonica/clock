#if os(macOS)
import AppKit
#endif
import FractonicaKit
import SwiftUI
#if os(iOS)
import UIKit
#endif

// The global time-travel control (the header transport of src/main.js): what moment the app shows, back to live,
// previous / next cycle of the selected level, play / pause and the time-lapse speed. Tapping the moment opens
// `TransportPanel` (a sheet on iOS, a popover on macOS) to go to a date, step by any cycle or pick a speed.
//
//   iOS    On the Now screen only: `TransportBar` in the tab bar's bottom accessory (Liquid Glass, iOS 26.1, which
//          can hide it on the other screens); minimised with the tab bar, it keeps only the moment and Play. iOS 18
//          (and 26.0): `TransportInsetBar`, a bar of its own just above the tab bar. Every other screen shows
//          `TravelIndicator` while the clock is not live.
//   macOS  `TransportControls` in the window toolbar; its moment ticks through an AppKit view (`ToolbarTicker`).

#if os(iOS)
/// The transport in the tab bar's bottom accessory (iOS 26).
@available(iOS 26.0, *)
struct TransportBar: View {
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        TransportRow(inline: placement == .inline)
    }
}

/// The transport above the tab bar on iOS 18, at the foot of each tab's content (`safeAreaInset`, so the content
/// scrolls under it and ends above it): the accessory's row on a capsule of material, on a band of the bars' material
/// that runs on to the foot of the screen, under the tab bar (which then draws no background of its own), as the
/// system's mini players do: one bar, with no content showing through between the two. It steps aside while the
/// keyboard is up, as the tab bar does.
struct TransportInsetBar: View {
    @State private var keyboardShown = false

    var body: some View {
        VStack(spacing: 0) {
            if !keyboardShown {
                TransportRow(inline: false)
                    .padding(.vertical, 4)
                    .glassSurface(in: .capsule)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.bar)
                    .overlay(alignment: .top) { Divider() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardShown = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardShown = false
        }
    }
}

/// Every screen but Now while the clock is not live (travelling, paused or playing a time-lapse): a small glass chip
/// at the foot of the screen, where Now's transport sits, with the displayed moment (tap: time travel) and Back to live,
/// so the app never shows another moment unannounced. Nothing while live. It lies over the content (an overlay, never a
/// safe area inset: its moment ticks during a time-lapse, see ClockTimeline) and steps aside while the keyboard is up.
struct TravelIndicator: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppRouter.self) private var router
    @Environment(AppSettings.self) private var settings
    @State private var keyboardShown = false

    var body: some View {
        ZStack {
            if !store.isLive && !keyboardShown {
                chip.transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: store.isLive)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            keyboardShown = true
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            keyboardShown = false
        }
    }

    private var chip: some View {
        let words = settings.wording
        return HStack(spacing: 6) {
            Button {
                router.isTransportPresented = true
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: store.isPlaying ? "play.fill" : "pause.fill")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Theme.cursor)
                        .frame(width: 16)
                    ClockTimeline(.periodic(1)) { t in
                        Text.ledByPentad(at: t, words.label(t, relativeTo: Date.now.timeIntervalSince1970))
                            .font(.reading(14, weight: .semibold))
                            .foregroundStyle(Theme.cursor)
                            .lineLimit(1)
                    }
                }
                .padding(.leading, 6)
                .frame(minHeight: 32)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(store.isPlaying ? "Time-lapse playing" : "Travelling in time"))
            .accessibilityHint("Opens time travel")
            LiveButton()
        }
        .padding(.leading, 8)
        .padding(.trailing, 4)
        .padding(.vertical, 4)
        .glassSurface(.regular.interactive(), in: .capsule)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
    }
}

/// The moment, Back to live, the steps and Play in one row; `inline` (the accessory minimised with the tab bar) keeps
/// only the moment and Play.
private struct TransportRow: View {
    var inline: Bool

    @Environment(ClockStore.self) private var store
    @Environment(AppRouter.self) private var router

    var body: some View {
        HStack(spacing: inline ? 4 : 0) {
            Button {
                router.isTransportPresented = true
            } label: {
                MomentLabel(showsDetail: !inline)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens time travel")
            if !inline {
                if !store.isLive { LiveButton().padding(.trailing, 4) }
                StepButton(direction: -1)
            }
            PlayButton()
            if !inline { StepButton(direction: 1) }
        }
        .padding(.leading, inline ? 12 : 16)
        .padding(.trailing, inline ? 4 : 8)
    }
}
#endif

#if os(macOS)
/// The transport in the window toolbar; the moment opens the time-travel popover.
struct TransportControls: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppRouter.self) private var router

    var body: some View {
        @Bindable var router = router
        HStack(spacing: 6) {
            Button {
                router.isTransportPresented.toggle()
            } label: {
                MomentLabel(showsDetail: false)
                    .padding(.horizontal, 6)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("Time travel: go to a moment, step by a cycle, choose a speed")
            .popover(isPresented: $router.isTransportPresented, arrowEdge: .bottom) {
                TransportPanel().frame(width: 380, height: 560)
            }
            if !store.isLive { LiveButton() }
            StepButton(direction: -1)
            PlayButton()
            StepButton(direction: 1)
        }
    }
}
#endif

// MARK: - Parts

/// The displayed moment in one or two lines, with the live / travelling dot, led by its Pentad: "● ⬠II 14:23:07 /
/// Thu 8 Oct 2026", in pure mode "● ⬠II 34η 29ι 21λ / Delta Trifracton End ε#5". During a time-lapse the second line
/// is the speed.
struct MomentLabel: View {
    var showsDetail: Bool

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings

    var body: some View {
        let words = settings.wording
        HStack(spacing: 10) {
            StatusDot(live: store.isLive)
            #if os(macOS)
            // In the window toolbar: drawn by AppKit, because a SwiftUI update inside a toolbar item rebuilds and
            // re-lays out the whole toolbar (see ToolbarTicker).
            ToolbarTicker(
                base: store.base,
                paused: store.isPaused,
                time: { [store] in store.time(at: $0) },
                text: { words.time($0) },
                lead: { Pentads.index(at: $0) },
                color: NSColor(store.isLive ? Theme.ink : Theme.cursor)
            )
            #else
            ClockTimeline(.periodic(1)) { t in
                VStack(alignment: .leading, spacing: 1) {
                    // the moment leads with its Pentad (SPEC §15.3); `Pentads` keeps it for the Helion, so a tick
                    // pays a range check for it
                    Text.ledByPentad(at: t, words.time(t))
                        .font(.reading(showsDetail ? 16 : 15, weight: .semibold))
                        .foregroundStyle(store.isLive ? Theme.ink : Theme.cursor)
                        // a pure reading with its Pentad beside Back to live and the steps shrinks a little, never cut
                        .minimumScaleFactor(0.7)
                    if showsDetail {
                        Text(detail(t, words))
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Theme.ink3)
                            .minimumScaleFactor(0.75)
                    }
                }
                .lineLimit(1)
            }
            #endif
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(store.isLive ? "Live clock" : "Displayed moment"))
    }

    private func detail(_ t: Double, _ words: Wording) -> String {
        store.isPlaying ? words.rateLabel(store.rate) : words.day(t)
    }
}

/// Green with a still halo while live; the cursor blue while the displayed time is elsewhere. Deliberately not animated:
/// a repeating ripple redraws the window every frame (SPEC §10: no blinking), and the ticking time already shows life.
struct StatusDot: View {
    var live: Bool

    var body: some View {
        Circle()
            .fill(live ? Theme.live : Theme.cursor)
            .frame(width: 8, height: 8)
            .background {
                if live {
                    Circle().fill(Theme.live.opacity(0.22)).frame(width: 16, height: 16)
                }
            }
            .frame(width: 20, height: 20)
            .accessibilityHidden(true)
    }
}

/// Back to the device clock (shown while travelling).
struct LiveButton: View {
    @Environment(ClockStore.self) private var store

    var body: some View {
        Button {
            store.goLive()
            Haptics.play(.step)
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "arrow.uturn.backward")
                Text("LIVE").tracking(0.6)
            }
            .font(.caption2.weight(.bold))
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(Theme.live.opacity(0.14), in: .capsule)
            .foregroundStyle(Theme.live)
        }
        .buttonStyle(.plain)
        .help("Back to the live clock (N)")
        .accessibilityLabel("Back to the live clock")
    }
}

/// The previous / next cycle of the selected level; hold to repeat.
struct StepButton: View {
    /// −1 previous (or the start of the current cycle), +1 next.
    let direction: Int

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        let chip = settings.wording.levelChip(settings.selectedLevel)
        Button {
            if let edge = store.step(level: settings.selectedLevel, direction: direction) {
                toasts.show(edge)
                Haptics.play(.warning)
            } else {
                Haptics.play(.step)
            }
        } label: {
            Image(systemName: direction < 0 ? "backward.end.fill" : "forward.end.fill")
                .transportGlyph()
        }
        .transportButtonStyle()
        .buttonRepeatBehavior(.enabled)
        .help(direction < 0 ? "Previous \(chip) cycle ([)" : "Next \(chip) cycle (])")
        .accessibilityLabel(direction < 0 ? "Previous \(chip) cycle" : "Next \(chip) cycle")
    }
}

/// Play / pause; long-press (or click the arrow on macOS) for the direction and the speed.
struct PlayButton: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        Menu {
            SpeedMenuContent()
        } label: {
            Image(systemName: store.isPlaying ? "pause.fill" : "play.fill")
                .contentTransition(.symbolEffect(.replace))
                .transportGlyph()
        } primaryAction: {
            if let edge = store.togglePlay() {
                toasts.show(edge)
                Haptics.play(.warning)
            }
        }
        .menuIndicator(.hidden)
        .transportButtonStyle()
        .help(store.isPlaying ? "Pause the time-lapse (Space)" : "Play the time-lapse at \(settings.wording.rateLabel(store.playRate)) (Space)")
        .accessibilityLabel(store.isPlaying ? "Pause" : "Play time-lapse")
    }
}

/// The direction and speed choices shared by the Play menu.
private struct SpeedMenuContent: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings

    var body: some View {
        let words = settings.wording
        let sign = Double(store.direction)
        Picker("Direction", selection: Binding(get: { store.direction }, set: { store.setDirection($0) })) {
            Label("Forward", systemImage: "forward").tag(1)
            Label("Backward", systemImage: "backward").tag(-1)
        }
        .pickerStyle(.palette)
        Section("Speed") {
            ForEach(words.rates.filter { sign > 0 || $0.rate != 1 }) { preset in
                let rate = sign * preset.rate
                Button {
                    store.selectSpeed(rate)
                } label: {
                    if TransportSpeed.matches(store.chosenRate, rate) {
                        Label(preset.label, systemImage: "checkmark")
                    } else {
                        Text(preset.label)
                    }
                }
            }
        }
    }
}

/// Speed comparisons of the transport.
enum TransportSpeed {
    /// Two rates are the same preset when they agree in sign and within half a percent.
    static func matches(_ a: Double, _ b: Double) -> Bool {
        a.sign == b.sign && abs(abs(a) - abs(b)) / abs(b) < 0.005
    }
}

private extension View {
    /// A transport symbol with a comfortable hit area.
    func transportGlyph() -> some View {
        #if os(iOS)
        font(.system(size: 17, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .frame(width: 40, height: 40)
            .contentShape(.rect)
        #else
        self
        #endif
    }

    /// Plain inside the iOS accessory (already glass); the toolbar style on macOS.
    @ViewBuilder
    func transportButtonStyle() -> some View {
        #if os(iOS)
        buttonStyle(.plain)
        #else
        self
        #endif
    }
}
