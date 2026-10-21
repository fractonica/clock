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
                    dial(size: min(h - 24, w * 0.56))
                        .frame(maxWidth: .infinity)
                    controls(vertical: true)
                        .frame(width: 210)
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 0) {
                    Spacer(minLength: 12)
                    dial(size: min(w - 40, h - 150, 620))
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
        return ZStack {
            TimelineView(.animation(minimumInterval: nil, paused: !run.isRunning)) { context in
                TimerDial(
                    fraction: run.fraction(at: context.date, clock: clock),
                    blinks: run.remainingBlinks(at: context.date, clock: clock),
                    units: units,
                    paused: !run.isRunning,
                    reduceMotion: reduceMotion
                )
            }
            center(innerDiameter: inner * 2)
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .contain)
    }

    /// Fields of the countdown: those of the total, at least Flavons and Blinks.
    private var lead: LadderUnit {
        LadderReadout.timerLead(total: run.totalSpan(at: .now, clock: store.clock))
    }

    private func center(innerDiameter: CGFloat) -> some View {
        let clock = store.clock
        let blink = clock.blinkSeconds(at: .now) ?? 0.311
        let fields = CGFloat(lead.downToBlink.count)
        let readoutSize = min(56 * readoutScale, innerDiameter * 0.84 / (fields * 1.72))
        let schedule = TickSchedule(anchor: run.end ?? .now, steps: settings.pure ? [blink] : [blink, 1], paused: !run.isRunning)
        return TimelineView(schedule) { context in
            let now = context.date
            let words = TimerWords(words: settings.wording, clock: clock, now: now)
            let blinks = run.remainingBlinks(at: now, clock: clock).map(LadderReadout.ceilBlinks)
            VStack(spacing: readoutSize * 0.18) {
                Text(words.title(run.spec))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(1)
                    .accessibilityLabel(words.spokenTitle(run.spec))
                LadderReadoutView(
                    span: blinks.map(LadderSpan.init(blinks:)),
                    lead: lead,
                    size: readoutSize,
                    weight: .light,
                    ink: run.isRunning ? Theme.ink : Theme.ink2
                )
                .accessibilityAddTraits(.updatesFrequently)
                if !words.pure {
                    Text(EarthClockText.countdown(run.remainingSeconds(at: now, clock: clock)))
                        .font(.reading(17))
                        .foregroundStyle(Theme.ink3)
                        .accessibilityLabel("\(EarthClockText.countdown(run.remainingSeconds(at: now, clock: clock))) left")
                }
                Group {
                    if let end = run.end {
                        Label(words.ringTime(end), systemImage: "bell.fill")
                            .accessibilityLabel("Rings at \(words.ringTime(end))")
                    } else {
                        Label("Paused", systemImage: "pause.fill")
                    }
                }
                .font(.footnote.monospacedDigit())
                .foregroundStyle(run.isRunning ? Theme.ink3 : Theme.teal)
                .labelStyle(TightLabelStyle())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
            .frame(maxWidth: innerDiameter * 0.9)
        }
    }

    // MARK: Controls

    @ViewBuilder
    private func controls(vertical: Bool) -> some View {
        let layout = vertical ? AnyLayout(VStackLayout(spacing: 22)) : AnyLayout(HStackLayout(spacing: 0))
        layout {
            RoundControl("Cancel") { withAnimation(.smooth) { store.cancel() } }
                .keyboardShortcut(.cancelAction)
            if !vertical { Spacer(minLength: 12) }
            addMenu
            if !vertical { Spacer(minLength: 12) }
            RoundControl(run.isRunning ? "Pause" : "Resume", tint: Theme.teal) {
                store.togglePause()
            }
            .keyboardShortcut(.defaultAction)
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
