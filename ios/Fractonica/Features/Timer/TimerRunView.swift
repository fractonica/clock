import SwiftUI

/// A started timer: the dial with the countdown in its middle, and Cancel, +1 and Pause / Resume.
struct TimerRunView: View {
    let run: TimerRun

    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var readoutScale: CGFloat = 1

    private var store: TimerStore { .shared }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            let side = w > h * 1.25 && h < 600
            if side {
                HStack(spacing: 24) {
                    dial(size: min(h - 16, w * 0.56))
                        .frame(maxWidth: .infinity)
                    controls(vertical: true, size: min(78, max(56, (h - 70) / 2)))
                        .frame(width: 220)
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 0) {
                    Spacer(minLength: 12)
                    dial(size: min(w - 40, h - 160, 700))
                    Spacer(minLength: 20)
                    controls(vertical: false)
                        .frame(maxWidth: 560)
                        .padding(.horizontal, 28)
                    Spacer(minLength: 24)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: run.isRunning) { _, _ in settings.haptics }
    }

    // MARK: Dial

    private func dial(size: CGFloat) -> some View {
        let clock = store.clock
        let units = lead.downToBlink
        let inner = size / 2 * TimerDial.innerRadius(rings: units.count)
        func face(_ now: Date) -> TimerDial {
            TimerDial(
                fraction: run.fraction(at: now, clock: clock),
                blinks: run.remainingBlinks(at: now, clock: clock),
                units: units,
                paused: !run.isRunning,
                reduceMotion: reduceMotion
            )
        }
        return ZStack {
            if reduceMotion {
                // whole segments only: redraw when a Blink is used up, not every frame
                let blink = clock.blinkSeconds(at: .now) ?? 0.311
                TimelineView(TickSchedule(anchor: run.end ?? .now, steps: [blink], paused: !run.isRunning)) { face($0.date) }
            } else {
                TimelineView(.animation(minimumInterval: nil, paused: !run.isRunning)) { face($0.date) }
            }
            center(innerDiameter: inner * 2, dial: size)
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .contain)
    }

    /// Fields of the countdown: those of the total, at least Flavons and Blinks.
    private var lead: LadderUnit {
        LadderReadout.timerLead(total: run.totalSpan(at: .now, clock: store.clock))
    }

    private func center(innerDiameter: CGFloat, dial: CGFloat) -> some View {
        let clock = store.clock
        let blink = clock.blinkSeconds(at: .now) ?? 0.311
        let fields = CGFloat(lead.downToBlink.count)
        let readoutSize = min(56 * readoutScale * max(1, dial / 420), innerDiameter * 0.86 / (fields * 1.72))
        let small = max(13, readoutSize * 0.32)
        let schedule = TickSchedule(anchor: run.end ?? .now, steps: settings.pure ? [blink] : [blink, 1], paused: !run.isRunning)
        return TimelineView(schedule) { context in
            let now = context.date
            let words = TimerWords(words: settings.wording, clock: clock, now: now)
            let blinks = run.remainingBlinks(at: now, clock: clock).map(LadderReadout.ceilBlinks)
            VStack(spacing: readoutSize * 0.18) {
                Text(words.title(run.spec))
                    .font(.system(size: small * 1.15, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(1)
                    .accessibilityLabel(words.spokenTitle(run.spec))
                let earth = EarthClockText.countdown(run.remainingSeconds(at: now, clock: clock))
                if run.measure == .earth && !words.pure {
                    // set in Earth units: the Earth countdown leads, the ladder follows
                    Text(earth)
                        .font(.reading(min(readoutSize * 1.35, innerDiameter * 0.84 / (CGFloat(earth.count) * 0.62)), weight: .light))
                        .foregroundStyle(run.isRunning ? Theme.ink : Theme.ink2)
                        .accessibilityLabel("\(earth) left")
                        .accessibilityAddTraits(.updatesFrequently)
                    LadderReadoutView(span: blinks.map(LadderSpan.init(blinks:)), lead: lead, size: max(19, readoutSize * 0.42), weight: .regular, ink: Theme.ink2)
                } else {
                    LadderReadoutView(
                        span: blinks.map(LadderSpan.init(blinks:)),
                        lead: lead,
                        size: readoutSize,
                        weight: .light,
                        ink: run.isRunning ? Theme.ink : Theme.ink2
                    )
                    .accessibilityAddTraits(.updatesFrequently)
                    if !words.pure {
                        Text(earth)
                            .font(.reading(max(17, readoutSize * 0.38)))
                            .foregroundStyle(Theme.ink3)
                            .accessibilityLabel("\(earth) left")
                    }
                }
                Group {
                    if let end = run.end {
                        // a small dial (iPhone landscape) has room for the ring time only without its clock reading
                        let text = words.ringTime(end, withReading: innerDiameter >= 180)
                        Label(text, systemImage: "bell.fill")
                            .accessibilityLabel("Rings at \(words.ringTime(end))")
                    } else {
                        Label("Paused", systemImage: "pause.fill")
                    }
                }
                .font(.system(size: small, weight: .regular).monospacedDigit())
                .foregroundStyle(run.isRunning ? Theme.ink3 : Theme.teal)
                .labelStyle(TightLabelStyle())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: innerDiameter * 0.9)
        }
    }

    // MARK: Controls

    /// In a row under the dial; beside it (landscape), the two round controls side by side above +1.
    @ViewBuilder
    private func controls(vertical: Bool, size: CGFloat = 78) -> some View {
        let cancel = RoundControl("Cancel", size: size) { withAnimation(.smooth) { store.cancel() } }
            .keyboardShortcut(.cancelAction)
        let toggle = RoundControl(run.isRunning ? "Pause" : "Resume", tint: Theme.teal, size: size) { store.togglePause() }
            .keyboardShortcut(.defaultAction)
        if vertical {
            VStack(spacing: 14) {
                HStack(spacing: 20) {
                    cancel
                    toggle
                }
                addMenu
            }
        } else {
            HStack(spacing: 0) {
                cancel
                Spacer(minLength: 12)
                addMenu
                Spacer(minLength: 12)
                toggle
            }
        }
    }

    /// +1 of the timer's natural unit; the menu offers the others.
    private var addMenu: some View {
        let earth = run.measure == .earth && !settings.pure
        let unit = addUnit
        return Menu {
            if earth {
                Button("+1 min", systemImage: "plus") { store.addMinute() }
            }
            ForEach([LadderUnit.eta, .iota, .lambda], id: \.self) { u in
                Button("+1\(u.symbol)  ·  one \(u.name)") { store.add(u) }
            }
        } label: {
            Text(earth ? "+1 min" : "+1\(unit.symbol)")
                .font(.callout.weight(.semibold).monospacedDigit())
                .padding(.horizontal, 6)
        } primaryAction: {
            if earth { store.addMinute() } else { store.add(unit) }
        }
        .menuIndicator(.hidden)
        .buttonStyle(.glass)
        .controlSize(.large)
        .fixedSize()
        .accessibilityLabel(earth ? "Add one minute" : "Add one \(unit.name)")
        .accessibilityHint("Hold for other units")
    }

    /// λ for timers under a Preon, ι under a ζ, else η.
    private var addUnit: LadderUnit {
        let total = Int(run.measure == .ladder ? run.total : Double(run.totalSpan(at: .now, clock: store.clock).blinks))
        if total < LadderUnit.iota.blinks { return .lambda }
        if total < 11 * LadderUnit.eta.blinks { return .iota }
        return .eta
    }
}

/// An icon and a title with a narrow gap.
struct TightLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 5) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}
