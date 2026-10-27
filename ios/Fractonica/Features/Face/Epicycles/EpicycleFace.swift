import FractonicaKit
import SwiftUI

/// The epicycles (Features/Face/Epicycles): a ladder of arms, one a period from a base down to a top, each turning with
/// its own period's phase at the tip of the one before, and the path the last tip draws.
///
/// The base arm turns about the hub once a base cycle; every arm is a hand of its own period, up as its cycle begins,
/// right at the peak, down at the node, left at the valley (or, in the carrier frame, measured from the arm that
/// carries it). A level's phase is its cycles in the base times the base's phase, so the pen at the last tip draws a
/// closed figure once a base cycle and starts again: the figure so far is drawn, the rest a ghost, each other tip's
/// path faint in its level's colour, each arm's circle round its pivot. The base cycle's scale rings the dial (its
/// children long, theirs short, the quarters marked), so the base arm reads on it like an hour hand. Loops too close
/// for the display run into a band, and an arm a time-lapse turns faster than the eye follows is drawn as its blur.
///
/// The Pentads: the hub carries the running Pentad's badge inside the sync's 19 Helions (by Pentad, the running one in
/// gold, the Hypopentad's squares and double ring the bolder); for a base of a ζ or longer the scale carries each
/// Pentad's start by its shape and the running Pentad's stretch as a gold arc, and the pen's path glows gold through
/// it. Under the dial, the Pentad in words and when the next begins, and the arms' letters. A tap opens the Pentad
/// explainer; a long press (or the Now screen's face menu, or a right click on the Mac) the editor.
///
/// Layers, each redrawn as often as it changes: the plate (per base and size), the ghost figure and the scale's
/// Pentads (per figure, base cycle and Pentad), the traced prefix (720 steps a base cycle), the arms and the paths from
/// that step on (while the pen moves a third of a point, at most once a Blink; 30 times a real second in a
/// time-lapse), the hub (once a Helion).
struct EpicycleFace: View {
    /// Width over height of the face's frame: the round dial and its two caption lines.
    nonisolated static let aspectRatio: CGFloat = 0.86
    /// The -FXFaceTime instant, or nil to follow the clock.
    let fixed: Double?

    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var explains = false

    var body: some View {
        let words = settings.wording
        let config = EpicycleSettings.shared.config
        let figure = EpicycleFigure(config)
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height * Self.aspectRatio)
            VStack(spacing: 0) {
                dial(figure: figure, tips: config.tips, side: side, words: words)
                    .frame(width: side, height: side)
                EpicycleCaption(fixed: fixed, figure: figure, size: side)
                    .frame(width: side, height: max(0, side / Self.aspectRatio - side))
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .accessibilityHidden(true)
            .overlay { spoken(figure: figure, words: words) }
        }
        .contentShape(.rect)
        .onTapGesture { explains = true }
        .onLongPressGesture(minimumDuration: 0.45) { edit() }
        #if os(macOS)
        .contextMenu {
            Button("Edit Epicycles…", systemImage: "slider.horizontal.3") { edit() }
            Button("How the Pentads Follow the Sun", systemImage: "pentagon") { explains = true }
        }
        #endif
        .sheet(isPresented: $explains) {
            NavigationStack { PentadExplainer(fixed: fixed) }
                #if os(iOS)
                .sheetDetents([.large])
                #else
                .frame(minWidth: 520, minHeight: 640)
                #endif
        }
    }

    private func edit() {
        Haptics.play(.selection)
        EpicycleSettings.shared.editing = true
    }

    // MARK: - The dial

    private func dial(figure: EpicycleFigure, tips: Bool, side: CGFloat, words: Wording) -> some View {
        let reach = Double(side / 2 * EpicycleDial.reach)
        let detail = figure.detail(scale: reach)
        let base = figure.base
        let speed = fixed == nil ? store.base.rate : 0
        let seconds = FractonicaClock.shared.levelInfo(base).meanSeconds
        let blurred = figure.firstBlurred(speed: speed, seconds: seconds)
        let steps = EpicycleCadence.traceSteps(seconds: seconds, speed: speed)
        let step = EpicycleCadence.motionStep(penSpeed: figure.penSpeed(seconds: seconds, blurred: blurred), scale: reach,
                                              seconds: seconds, steps: steps, speed: speed, reduceMotion: reduceMotion)
        return ZStack {
            EpicyclePlateLayer(scale: EpicycleScale(base: base)).equatable()
            // what changes once a base cycle (the clipped end of the catalogue) or a Pentad: the ghost, the scale's Pentads
            // (a timeline lays several children out as a column: each layer pair sits in a ZStack of its own)
            NowTimeline(fixed: fixed, next: { EpicycleCadence.pentads(after: $0, base: base) }) { t in
                let endPhase = EpicycleReading.at(t, base: base)?.endPhase ?? 1
                ZStack {
                    EpicycleFigureLayer(figure: figure, detail: detail, endPhase: endPhase).equatable()
                    if let p = EpicyclePentads.at(t, base: base, endPhase: endPhase) {
                        EpicyclePentadLayer(pentads: p).equatable()
                    }
                }
            }
            // the traced prefix (redrawn once a step) and what moves, read at one instant so they always meet
            NowTimeline(fixed: fixed, minimumStep: reduceMotion ? 1 : EpicycleCadence.lapseStep, next: { $0 + step }) { t in
                if let r = EpicycleReading.at(t, base: base) {
                    let cut = Double(r.cut(steps: steps)) / Double(steps)
                    let stretch = EpicyclePentads.at(t, base: base, marks: false).map { $0.from...$0.to }
                    ZStack {
                        EpicycleTraceLayer(trace: EpicycleTrace(figure: figure, detail: detail, cycle: r.cycle, cut: cut,
                                                                endPhase: r.endPhase, tips: tips, stretch: stretch))
                            .equatable()
                        EpicycleMotionLayer(motion: EpicycleMotion(figure: figure, detail: detail, phase: min(r.phase, r.endPhase),
                                                                   from: min(cut, r.endPhase), tips: tips, blurred: blurred))
                            .equatable()
                    }
                } else {
                    EpicycleOutOfRange(words: words)
                }
            }
            // the hub caps the arms: the running Pentad in the sync, redrawn once a Helion
            NowTimeline(fixed: fixed, next: { EpicycleCadence.helion(after: $0) }) { t in
                if let p = Pentads.at(t) {
                    EpicycleHub(pentad: p.index, helion: 5 * p.index + p.helion - 1).equatable()
                }
            }
        }
    }

    // MARK: - VoiceOver

    /// One element over the whole face: the arms, then the reading led by its Pentad; the explainer as its action, the
    /// editor as another.
    private func spoken(figure: EpicycleFigure, words: Wording) -> some View {
        let pure = words.pure
        return NowTimeline(fixed: fixed, next: { PentadCardModel.change(after: $0, pure: pure) }) { t in
            let label = EpicycleReading.at(t, base: figure.base) == nil
                ? FaceWords.outOfRange(words: words).title.joined(separator: " ")
                : EpicycleWords.spoken(figure, at: t, pure: pure, notation: words.notation)
            Color.clear
                .contentShape(.rect)
                .accessibilityElement()
                .accessibilityLabel(Text(verbatim: label))
                .accessibilityHint(Text("Shows how the Pentads follow the Sun"))
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { explains = true }
                .accessibilityAction(named: Text("Edit Epicycles")) { edit() }
        }
    }
}

/// The plate and the base cycle's scale: drawn once per base and size.
private struct EpicyclePlateLayer: View, Equatable {
    let scale: EpicycleScale

    var body: some View {
        Canvas { context, size in EpicyclePainter.plate(&context, EpicycleCanvas(size: size), scale: scale) }
    }
}

/// The whole figure in ghost: once per configuration and size (and in the catalogue's clipped last cycle).
private struct EpicycleFigureLayer: View, Equatable {
    let figure: EpicycleFigure
    let detail: Int
    let endPhase: Double

    var body: some View {
        Canvas { context, size in
            EpicyclePainter.figure(&context, EpicycleCanvas(size: size), figure: figure, detail: detail, endPhase: endPhase)
        }
    }
}

/// The Pentads on the base's scale: once a base cycle or Pentad.
private struct EpicyclePentadLayer: View, Equatable {
    let pentads: EpicyclePentads

    var body: some View {
        Canvas { context, size in EpicyclePainter.pentads(&context, EpicycleCanvas(size: size), pentads) }
    }
}

/// The figure as drawn so far: once a step.
private struct EpicycleTraceLayer: View, Equatable {
    let trace: EpicycleTrace

    var body: some View {
        Canvas { context, size in EpicyclePainter.trace(&context, EpicycleCanvas(size: size), trace) }
    }
}

/// The arms, the pen and the paths from the trace's step on.
private struct EpicycleMotionLayer: View, Equatable {
    let motion: EpicycleMotion

    var body: some View {
        Canvas { context, size in EpicyclePainter.motion(&context, EpicycleCanvas(size: size), motion) }
    }
}

/// The hub: the running Pentad's badge capping the arms, inside the sync's 19 Helions; the Hypopentad's in a double
/// ring.
private struct EpicycleHub: View, Equatable {
    let pentad: Int
    /// The running Helion in the sync, 0 … 18.
    let helion: Int

    var body: some View {
        GeometryReader { geo in
            let c = EpicycleCanvas(size: geo.size)
            let size = c.radius * EpicycleDial.hub * 2
            let hypo = pentad == 3
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Theme.gold.opacity(hypo ? 0.16 : 0.07), Theme.gold.opacity(0)],
                                         center: .center, startRadius: size * 0.5, endRadius: size * 1.15))
                    .frame(width: size * 2.3, height: size * 2.3)
                Canvas { context, s in
                    EpicyclePainter.sync(&context, size: s, radius: c.radius * EpicycleDial.hubPips, pentad: pentad, helion: helion, unit: c.unit)
                }
                Circle()
                    .fill(Theme.Epicycles.plateEdge)
                    .frame(width: size * 1.12, height: size * 1.12)
                Circle()
                    .strokeBorder(Theme.gold.opacity(hypo ? 0.9 : 0.4), lineWidth: hypo ? 1.4 : 0.8)
                    .frame(width: size * 1.12, height: size * 1.12)
                if hypo {
                    Circle()
                        .strokeBorder(Theme.gold.opacity(0.45), lineWidth: 0.7)
                        .frame(width: size * 1.3, height: size * 1.3)
                }
                PentadBadge(index: pentad, size: size * 0.72, filled: true)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

/// Outside the catalogue: the plate and the ghost stay, with the catalogue's range in the middle.
private struct EpicycleOutOfRange: View {
    let words: Wording

    var body: some View {
        let text = FaceWords.outOfRange(words: words)
        GeometryReader { geo in
            let r = min(geo.size.width, geo.size.height) / 2
            VStack(spacing: r * 0.03) {
                ForEach(text.title, id: \.self) { line in
                    Text(verbatim: line).font(.system(size: max(12, r * 0.085), weight: .semibold))
                }
                .foregroundStyle(Theme.ink2)
                ForEach(text.range, id: \.self) { line in
                    Text(verbatim: line).font(.reading(max(10, r * 0.062)))
                }
                .foregroundStyle(Theme.ink3)
            }
            .multilineTextAlignment(.center)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .padding(.horizontal, r * 0.08)
            .padding(.vertical, r * 0.05)
            .background(Theme.Epicycles.plateEdge.opacity(0.92), in: .rect(cornerRadius: r * 0.06, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: r * 0.06, style: .continuous).strokeBorder(Theme.line2, lineWidth: 1)
            }
            .frame(width: r * 1.3)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }
}

/// Under the dial: the running Pentad and the Helion's place in it, when the next Pentad begins; the arms' letters in
/// their colours (an arm that is off struck through, one turning back marked ↺).
private struct EpicycleCaption: View {
    let fixed: Double?
    let figure: EpicycleFigure
    let size: CGFloat

    @Environment(AppSettings.self) private var settings

    var body: some View {
        let pure = settings.pure
        let fontSize = min(18, max(11, size * 0.04))
        VStack(spacing: fontSize * 0.3) {
            NowTimeline(fixed: fixed, next: { PentadCardModel.change(after: $0, pure: pure) }) { t in
                if let p = Pentads.at(t) {
                    HStack(spacing: fontSize * 0.45) {
                        PentadBadge(index: p.index, size: fontSize * 1.45, filled: true)
                        Text("\(Text(verbatim: PentadWords.name(p.index)).foregroundStyle(Theme.gold).fontWeight(.semibold))\(Text(verbatim: "  " + EpicycleWords.place(p)).foregroundStyle(Theme.ink3))")
                        if p.end < FractonicaClock.shared.tMax,
                           let countdown = PentadCardModel.countdown(at: t, to: p.end, pure: pure) {
                            Text("\(Text.pentadMark((p.index + 1) % 4)) \(Text(verbatim: countdown))")
                                .foregroundStyle(Theme.ink2)
                                .padding(.leading, fontSize * 0.5)
                        }
                    }
                    .font(.reading(fontSize))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                } else {
                    Text(verbatim: " ").font(.reading(fontSize))
                }
            }
            legend
                .font(.system(size: fontSize * 0.9, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var legend: Text {
        let parts: [Text] = figure.arms.map { arm in
            let letter = Text(verbatim: Fractonica.periodName(arm.level).text)
            let mark = arm.sign < 0 ? Text(verbatim: "\u{21BA}").font(.system(size: size * 0.03, weight: .regular)) : Text(verbatim: "")
            if arm.on {
                return Text("\(letter.foregroundStyle(Theme.Epicycles.arm(arm.level)))\(mark.foregroundStyle(Theme.Epicycles.arm(arm.level, opacity: 0.8)))")
            }
            return Text("\(letter.foregroundStyle(Theme.ink3.opacity(0.6)).strikethrough(color: Theme.ink3))\(mark.foregroundStyle(Theme.ink3.opacity(0.6)))")
        }
        return parts.enumerated().reduce(Text(verbatim: "")) { sum, part in
            part.offset == 0 ? part.element : Text("\(sum)\(Text(verbatim: "  "))\(part.element)")
        }
    }
}
