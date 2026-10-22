#if os(macOS)
import AppKit
#endif
import FractonicaKit
import SwiftUI

// The global time-travel control (the header transport of src/main.js): what moment the app shows, back to live,
// previous / next cycle of the selected level, play / pause and the time-lapse speed. Tapping the moment opens
// `TransportPanel` (a sheet on iOS, a popover on macOS) to go to a date, step by any cycle or pick a speed.
//
//   iOS    `TransportBar` in the tab bar's bottom accessory (Liquid Glass); minimised with the tab bar, it keeps
//          only the moment and Play.
//   macOS  `TransportControls` in the window toolbar; its moment ticks through an AppKit view (`ToolbarTicker`).

#if os(iOS)
/// The transport in the tab bar's bottom accessory.
struct TransportBar: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppRouter.self) private var router
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement

    var body: some View {
        let inline = placement == .inline
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

/// The displayed moment in one or two lines, with the live / travelling dot: "● 14:23:07 / Thu 8 Oct 2026",
/// in pure mode "● 34η 29ι 21λ / Delta Trifracton End ε#5". During a time-lapse the second line is the speed.
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
                color: NSColor(store.isLive ? Theme.ink : Theme.cursor)
            )
            #else
            ClockTimeline(.periodic(1)) { t in
                VStack(alignment: .leading, spacing: 1) {
                    Text(words.time(t))
                        .font(.reading(showsDetail ? 16 : 15, weight: .semibold))
                        .foregroundStyle(store.isLive ? Theme.ink : Theme.cursor)
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
