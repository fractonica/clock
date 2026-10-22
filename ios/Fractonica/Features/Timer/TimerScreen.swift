import SwiftUI

/// Timer: countdowns counted on the ladder (η ι λ ν), or in Earth units in Earth mode. Set one on the wheels, start a
/// preset, or wait for the clock's next cycle; a started timer shows its dial of phase rings and rings with an alert,
/// the chime and a haptic, or with its notification when the app is closed.
struct TimerScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var store: TimerStore { .shared }

    var body: some View {
        ZStack {
            if let run = store.run {
                TimerRunView(run: run)
                    .transition(transition)
            } else {
                TimerSetupView()
                    .transition(transition)
            }
        }
        .animation(.smooth(duration: 0.35), value: store.run?.id)
        .navigationTitle(Screen.timer.title)
        .alert(alertTitle, isPresented: ringingBinding, presenting: store.ringing) { _ in
            Button("Repeat") { store.repeatRinging() }
            Button("Stop", role: .cancel) { store.dismissRinging() }
        } message: { ringing in
            Text(alertMessage(ringing))
        }
        .onAppear {
            store.screen(visible: true)
            #if DEBUG && os(iOS)
            TimerDemo.rotateIfAsked()
            #endif
        }
        .onDisappear { store.screen(visible: false) }
        #if DEBUG && os(iOS) && canImport(ActivityKit)
        .overlay(alignment: .bottom) { TimerActivityPreview() }
        #endif
    }

    private var transition: AnyTransition {
        reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.97))
    }

    private var ringingBinding: Binding<Bool> {
        Binding(
            get: { store.ringing != nil },
            set: { shown in if !shown { store.dismissRinging() } }
        )
    }

    private var alertTitle: String {
        guard let ringing = store.ringing else { return "Timer" }
        if case .aligned(let target) = ringing.spec { return "\(target.name(settings.wording.notation)) begins" }
        return "Timer done"
    }

    private func alertMessage(_ ringing: TimerStore.Ringing) -> String {
        let words = store.words
        let title = words.title(ringing.spec)
        let at = words.pure ? words.clockReading(ringing.at) : words.moment(ringing.at)
        if case .aligned = ringing.spec { return "Rang at \(at)." }
        return "\(title) · rang at \(at)."
    }
}
