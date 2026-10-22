import SwiftUI

/// Stopwatch: elapsed time counted on the ladder ("1η 03ι 22λ 14ν"), as digits or as an analog dial, with laps (each
/// lap's own span and the total at its end, the fastest and slowest marked). It runs on stored dates, so it keeps
/// counting while the app is closed.
struct StopwatchScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("timer.stopwatch.face") private var face = Face.digits.rawValue

    private var store: StopwatchStore { .shared }

    enum Face: String, CaseIterable {
        case digits, dial
    }

    /// The face asked for by the `-FXStopwatchFace digits|dial` launch argument (screenshots).
    private static var forcedFace: String? {
        UserDefaults.standard.string(forKey: "FXStopwatchFace").flatMap { Face(rawValue: $0)?.rawValue }
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            if w >= 760 {
                wide(width: w, height: h)
            } else if w > h * 1.2 && h < 520 {
                landscape(width: w, height: h)
            } else {
                compact(width: w, height: h)
            }
        }
        .navigationTitle(Screen.stopwatch.title)
        .sensoryFeedback(.impact(weight: .light), trigger: store.run.isRunning) { _, _ in settings.haptics }
        .sensoryFeedback(.impact(weight: .medium), trigger: store.lapCount) { old, new in settings.haptics && new > old }
        .onAppear {
            #if DEBUG && os(iOS)
            TimerDemo.rotateIfAsked()
            #endif
            if let forced = Self.forcedFace { face = forced }
        }
    }

    // MARK: Layouts

    /// iPhone: the face (swipe between digits and dial), the controls, the laps.
    private func compact(width: CGFloat, height: CGFloat) -> some View {
        let faceHeight = min(width - 32, height * 0.46)
        return VStack(spacing: 0) {
            ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                HStack(spacing: 0) {
                    digitsFace(size: 60)
                        .containerRelativeFrame(.horizontal)
                        .id(Face.digits.rawValue)
                    dialFace
                        .padding(.top, 14)
                        .padding(.bottom, 4)
                        .containerRelativeFrame(.horizontal)
                        .id(Face.dial.rawValue)
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: Binding(get: { face }, set: { if let new = $0 { face = new } }))
            .scrollIndicators(.hidden)
            .frame(height: faceHeight)
            .onAppear { proxy.scrollTo(Self.forcedFace ?? face) }
            }
            pageDots
                .padding(.top, 6)
            controls
                .padding(.horizontal, 28)
                .padding(.vertical, 14)
            laps
        }
    }

    /// iPhone in landscape: the dial, then the digits over the controls, then the laps.
    private func landscape(width: CGFloat, height: CGFloat) -> some View {
        let dial = min(height - 12, width * 0.34)
        return HStack(spacing: 16) {
            dialFace
                .frame(width: dial, height: dial)
            VStack(spacing: 6) {
                digitsFace(size: 30, bars: false)
                    .fixedSize(horizontal: false, vertical: true)
                controls(size: min(64, max(50, height - 110)))
            }
            .frame(width: min(300, width * 0.36))
            laps
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    /// iPad and Mac: the dial and controls on the left; the digits above the laps on the right.
    private func wide(width: CGFloat, height: CGFloat) -> some View {
        let dial = min(height - 170, width * 0.5, 620)
        return HStack(alignment: .center, spacing: 40) {
            VStack(spacing: 28) {
                dialFace
                    .frame(width: dial, height: dial)
                controls
                    .frame(width: min(dial, 420))
            }
            VStack(spacing: 18) {
                digitsFace(size: 64)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 12)
                laps
                    .frame(maxHeight: dial + 60)
            }
            .frame(maxWidth: 520)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Faces

    /// The digits: the ladder readout, the Earth reading in Earth mode, and the phase of λ, ι and η.
    private func digitsFace(size: CGFloat, bars: Bool = true) -> some View {
        let run = store.run
        let clock = store.clock
        return TimelineView(.animation(minimumInterval: nil, paused: !run.isRunning)) { context in
            let now = context.date
            let seconds = run.elapsed(at: now)
            let blink = clock.blinkSeconds(at: now)
            let blinks = blink.map { seconds / $0 }
            let span = blinks.map { LadderSpan(blinks: LadderReadout.floorBlinks($0)) }
            VStack(spacing: size * 0.22) {
                let lead = span.map(LadderReadout.stopwatchLead(elapsed:)) ?? .iota
                LadderReadoutView(
                    span: span,
                    lead: lead,
                    padLead: lead != .eta,
                    size: size,
                    weight: .thin,
                    ink: run.isRunning || run.isClear ? Theme.ink : Theme.ink2
                )
                .minimumScaleFactor(0.5)
                if !settings.pure {
                    Text(EarthClockText.stopwatch(seconds))
                        .font(.reading(size * 0.32))
                        .foregroundStyle(Theme.ink3)
                        .accessibilityLabel("\(EarthClockText.stopwatch(seconds)) elapsed")
                }
                if bars, let blinks {
                    PhaseBars(blinks: reduceMotion ? blinks.rounded(.down) : blinks)
                        .frame(maxWidth: size * 4.6)
                }
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var dialFace: some View {
        let run = store.run
        let clock = store.clock
        return TimelineView(.animation(minimumInterval: nil, paused: !run.isRunning)) { context in
            let now = context.date
            let blink = clock.blinkSeconds(at: now) ?? clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds
            let elapsed = run.elapsed(at: now)
            StopwatchDial(
                elapsed: elapsed / blink,
                lap: run.marks.isEmpty ? nil : (elapsed - run.currentLapStart) / blink,
                reduceMotion: reduceMotion
            )
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel("Stopwatch dial")
        .accessibilityValue(spokenElapsed)
    }

    private var spokenElapsed: String {
        guard let blink = store.clock.blinkSeconds(at: .now) else { return "" }
        let span = LadderSpan(blinks: LadderReadout.floorBlinks(store.run.elapsed(at: .now) / blink))
        return span.spokenReadout(from: LadderReadout.stopwatchLead(elapsed: span))
    }

    private var pageDots: some View {
        HStack(spacing: 8) {
            ForEach(Face.allCases, id: \.self) { f in
                Button {
                    withAnimation(.snappy) { face = f.rawValue }
                } label: {
                    Circle()
                        .fill(face == f.rawValue ? Theme.ink2 : Theme.line2)
                        .frame(width: 7, height: 7)
                        .padding(4)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(f == .digits ? "Digits" : "Dial")
                .accessibilityAddTraits(face == f.rawValue ? .isSelected : [])
            }
        }
    }

    // MARK: Controls

    private var controls: some View { controls() }

    private func controls(size: CGFloat = 78) -> some View {
        let run = store.run
        return HStack {
            RoundControl(run.isRunning || run.isClear ? "Lap" : "Reset", size: size) {
                withAnimation(.snappy) { store.lapOrReset() }
            }
            .disabled(run.isClear)
            .keyboardShortcut("l", modifiers: .command)
            Spacer()
            RoundControl(run.isRunning ? "Stop" : "Start", tint: run.isRunning ? Theme.danger : Theme.teal, size: size) {
                store.toggle()
            }
            .keyboardShortcut(.defaultAction)
        }
    }

    // MARK: Laps

    @ViewBuilder
    private var laps: some View {
        let run = store.run
        let clock = store.clock
        if run.isClear {
            Text(settings.pure ? "Laps are counted on the ladder." : "Laps are counted on the ladder, in Preons, Flavons and Blinks.")
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .multilineTextAlignment(.center)
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else {
            let blink = clock.blinkSeconds(at: .now) ?? clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds
            TimelineView(TickSchedule(anchor: run.zero(at: .now), steps: [blink], paused: !run.isRunning)) { context in
                let rows = run.laps(at: context.date)
                let extremes = run.extremes
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(rows) { lap in
                            LapRow(lap: lap, blink: blink, mark: mark(lap, extremes))
                            Divider().overlay(Theme.line)
                        }
                    }
                    .padding(.horizontal, 20)
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    private func mark(_ lap: StopwatchRun.Lap, _ extremes: (fastest: Int, slowest: Int)?) -> LapRow.Mark {
        guard !lap.isCurrent, let extremes else { return .none }
        if lap.number == extremes.fastest { return .fastest }
        if lap.number == extremes.slowest { return .slowest }
        return .none
    }
}

/// One lap: its number, its own span on the ladder and the total at its end.
private struct LapRow: View {
    enum Mark { case none, fastest, slowest }

    let lap: StopwatchRun.Lap
    let blink: Double
    let mark: Mark

    var body: some View {
        let span = LadderSpan(blinks: LadderReadout.floorBlinks(lap.span / blink))
        let split = LadderSpan(blinks: LadderReadout.floorBlinks(lap.split / blink))
        let color: Color = switch mark {
        case .none: lap.isCurrent ? Theme.ink : Theme.ink2
        case .fastest: Theme.live
        case .slowest: Theme.danger
        }
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Lap \(lap.number)")
                    .font(.body)
                    .foregroundStyle(color)
                if mark != .none {
                    Text(mark == .fastest ? "fastest" : "slowest")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(color.opacity(0.8))
                        .textCase(.uppercase)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(span.readout(from: LadderReadout.stopwatchLead(elapsed: span), padLead: span.count(.eta) == 0))
                    .font(.reading(19, weight: .light))
                    .foregroundStyle(color)
                Text("at \(split.name(parts: 3))")
                    .font(.reading(12))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .padding(.vertical, 10)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Lap \(lap.number)\(mark == .fastest ? ", fastest" : mark == .slowest ? ", slowest" : ""): \(span.spoken), total \(split.spoken)")
    }
}

/// Where the stopwatch stands inside the current Flavon, Preon and Helion: three thin bars in their levels' colours.
private struct PhaseBars: View {
    let blinks: Double

    var body: some View {
        VStack(spacing: 7) {
            bar(.lambda)
            bar(.iota)
            bar(.eta)
        }
        .accessibilityHidden(true)
    }

    private func bar(_ unit: LadderUnit) -> some View {
        let f = (blinks / Double(unit.blinks)).truncatingRemainder(dividingBy: 1)
        let color = Theme.levelColor(unit.level)
        return HStack(spacing: 8) {
            Text(unit.symbol)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 14)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.line.opacity(0.8))
                    Capsule().fill(color.opacity(0.85))
                        .frame(width: max(3, geo.size.width * f))
                }
            }
            .frame(height: 3)
        }
    }
}
