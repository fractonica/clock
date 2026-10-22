import FractonicaKit
import SwiftUI

/// Up next (src/ui/upnext.js): what turns over soon. A turnover is the instant a cycle ends and the next one begins;
/// every finer cycle ends with it. The next turnovers whose coarsest rolling level is within the chosen importance,
/// a hero for the very next one, the selected level's next quarter threshold, then the following turnovers grouped by
/// civil day (pure: by Nuclide). Countdowns refresh once a second, 4 times a second in the last seconds before a
/// turnover or the strip's threshold (`LadderCadence.upNext`); the list itself is recomputed only when a turnover passes
/// or the clock jumps, and grouped once per list (`TurnoverMemo`). Only what moves redraws with the clock — each
/// countdown and the hero's progress, inside the label of a button — so a tick rebuilds neither the card nor its
/// buttons.
struct UpNextView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(Importance.storageKey) private var importanceID = Importance.defaultID
    @State private var memo = TurnoverMemo()
    /// The card's cadence (`LadderCadence.upNext`): quick near a change, calm otherwise.
    @State private var cadence = LadderCadence.upNextCalm

    var body: some View {
        let importance = Importance.byID(importanceID)
        let words = settings.wording
        let maxLevel = settings.maxDepth - 1
        let navigator = LadderNavigator(store: store, toasts: toasts, pure: words.pure)
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Picker("Importance", selection: $importanceID) {
                    ForEach(Importance.all) { Text($0.label).tag($0.id) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .accessibilityLabel("Importance: the finest cycle whose turnover counts")
                Text(caption(importance, words: words))
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ClockTimeline(.periodic(cadence)) { raw in
                let t = LadderLaunch.shown(raw)
                let turnovers = memo.turnovers(store.clock, at: t, importance: importance, maxLevel: maxLevel, revision: store.revision)
                // the selected level, read once for the strip and for the cadence
                let selected = store.clock.level(at: t, settings.selectedLevel)
                let next = [turnovers.first?.time, selected?.next.time].compactMap { $0 }.min()
                let wanted = LadderCadence.upNext(untilNext: next.map { $0 - t })
                let animate = memo.passed && !reduceMotion
                // only what changes when a turnover or a threshold passes: the same card from one tick to the next
                UpNextContent(
                    inRange: store.clock.inRange(t),
                    turnovers: turnovers,
                    threshold: selected.map(NextThreshold.init),
                    rows: memo.rows(pure: words.pure, earth: words.earth, ref: t, text: LadderPureText(notation: words.notation)),
                    importance: importance,
                    maxLevel: maxLevel,
                    words: words,
                    navigator: navigator,
                    glow: animate,
                    cadence: cadence
                )
                .onChange(of: wanted, initial: true) { _, wanted in cadence = wanted }
                .animation(animate ? .snappy(duration: 0.35) : nil, value: turnovers.first?.time)
                .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: turnovers.first?.time) { _, _ in
                    // a turnover passed while the clock ran at about real speed (not a jump, not a time-lapse)
                    settings.haptics && memo.ranPast && (store.isLive || abs(store.rate) <= 1)
                }
            }
            Text(note(words))
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /// "Counting α–ζ turnovers · ζ cycles last about 2 d 7 h" · pure "… · a ζ cycle is 11η, not a unit".
    private func caption(_ importance: Importance, words: Wording) -> String {
        if words.pure {
            return "Counting \(importance.label) turnovers · \(LadderPureText(notation: words.notation).unitClause(importance.top))"
        }
        let mean = store.clock.levelInfo(importance.top).meanSeconds
        return "Counting \(importance.label) turnovers · \(importance.id) cycles last about \(EarthTime.duration(mean))"
    }

    #if os(macOS)
    private static let verb = "Click"
    #else
    private static let verb = "Tap"
    #endif

    private func note(_ words: Wording) -> String {
        let text = LadderPureText(notation: words.notation)
        let after = words.pure ? text.blinks(0.001) : "1 ms"
        let before = words.pure ? text.blinks(2) : "2 s"
        return "A turnover is the instant a cycle ends and the next one begins; every finer cycle ends with it. "
            + "\(Self.verb) a turnover for Just after (\(after) into the next cycle), or its ▶ for Just before (\(before) ahead, then real time)."
            + (words.pure ? " A Blink is the clock’s real-time tick." : "")
    }
}

/// The live part of Up next: the hero, the strip and the list, as they stand until a turnover or the threshold passes.
private struct UpNextContent: View {
    /// The displayed time is inside the catalogue.
    let inRange: Bool
    let turnovers: [Turnover]
    /// The selected level's next threshold (nil outside the catalogue).
    let threshold: NextThreshold?
    /// The turnovers after the first, grouped (`TurnoverMemo.rows`).
    let rows: [TurnoverRow]
    let importance: Importance
    let maxLevel: Int
    let words: Wording
    let navigator: LadderNavigator
    let glow: Bool
    /// The container's cadence, for the countdowns' lookahead.
    let cadence: Double

    var body: some View {
        let clock = words.notation.model
        VStack(alignment: .leading, spacing: 12) {
            if !inRange {
                UpNextNote(
                    symbol: "clock.badge.xmark",
                    text: words.pure
                        ? "Outside the catalogue (\(words.notation.catalogueText())): there are no turnovers to count down to."
                        : "Outside the Saros 141 catalogue (\(words.earth.date(clock.tMin)) to \(words.earth.date(clock.tMax))): there are no turnovers to count down to."
                )
            } else if let first = turnovers.first {
                TurnoverHero(turnover: first, importance: importance, maxLevel: maxLevel, words: words, navigator: navigator, glow: glow, cadence: cadence)
                ThresholdStrip(threshold: threshold, words: words, navigator: navigator, cadence: cadence)
                TurnoverList(rows: rows, words: words, navigator: navigator, cadence: cadence)
                if turnovers.count < Turnovers.listed {
                    // the catalogue ends before the list is full
                    Label(lastWords, systemImage: "flag.checkered")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                        .padding(.top, rows.isEmpty ? 0 : 4)
                }
            } else {
                ThresholdStrip(threshold: threshold, words: words, navigator: navigator, cadence: cadence)
                UpNextNote(symbol: "flag.checkered", text: lastWords)
            }
        }
    }

    private var lastWords: String {
        words.pure
            ? "No further turnovers of this size before the catalogue ends."
            : "No further turnovers of this size before the catalogue ends (\(words.earth.date(words.notation.model.tMax)))."
    }
}

// MARK: - Hero

/// The very next turnover: what rolls over, when, what ends with it, how far the ending cycle has come.
private struct TurnoverHero: View {
    let turnover: Turnover
    let importance: Importance
    let maxLevel: Int
    let words: Wording
    let navigator: LadderNavigator
    /// Glow: the previous hero has just passed (and Reduce Motion is off).
    let glow: Bool
    /// The card's cadence: how often the countdown and the progress redraw.
    let cadence: Double

    @ScaledMetric(relativeTo: .largeTitle) private var countSize = 30.0
    @Environment(\.dynamicTypeSize) private var typeSize

    private var pure: Bool { words.pure }
    private var text: LadderPureText { LadderPureText(notation: words.notation) }
    /// Accessibility text sizes stack what sits side by side, so nothing is cut short.
    private var stacked: Bool { typeSize.isAccessibilitySize }

    var body: some View {
        let top = turnover.top
        let color = Theme.levelColor(top)
        VStack(alignment: .leading, spacing: 12) {
            Text("Next major turnover")
                .font(.caption2.weight(.semibold))
                .tracking(1.1)
                .textCase(.uppercase)
                .foregroundStyle(color.opacity(0.9))
            headline
            Text(pure ? LadderPureText.turnoverWords(top: top, maxLevel: maxLevel) : LadderText.turnoverSentence(top: top, maxLevel: maxLevel))
                .font(.callout)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            ClockTimeline(.periodic(cadence)) { raw in
                progress(at: LadderLaunch.shown(raw), color: color)
            }
            buttons(color: color)
        }
        .padding(16)
        .background { card }
        .modifier(TurnoverGlow(level: top, trigger: turnover.time, enabled: glow))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Next major turnover")
    }

    /// The badge, the countdown and when (Earth) or what begins (pure).
    private var headline: some View {
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
        return layout {
            LevelChip(level: turnover.top, prominent: true, baseSide: stacked ? 38 : 54)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("in").font(.title3).foregroundStyle(Theme.ink3)
                    countdown
                }
                .lineLimit(1)
                when
            }
        }
    }

    private var countdown: some View {
        let end = turnover.time
        let pure = pure
        let text = text
        let cadence = cadence
        return ClockTimeline(.periodic(cadence)) { raw in
            LiveCountdown(target: end, t: LadderLaunch.shown(raw), container: cadence, pure: pure) { now in
                pure ? text.heroLeft(from: now, to: end) : LadderText.countdownLong(end - now)
            }
        }
        .font(.reading(countSize, weight: .semibold))
        .foregroundStyle(Theme.ink)
        .minimumScaleFactor(0.55)
    }

    @ViewBuilder
    private var when: some View {
        if pure {
            let info = text.turnoverInfo(time: turnover.time, top: turnover.top)
            Text(info.begins)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Theme.ink)
            if !info.address.isEmpty {
                Text(info.address).font(.code(11)).foregroundStyle(Theme.ink3).lineLimit(stacked ? nil : 1).minimumScaleFactor(0.7)
            }
        } else {
            let line = stacked
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 5))
            line {
                Text(LadderText.whenFull(words.earth, turnover.time))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Theme.ink2)
                Text(words.tag(turnover.time)).font(.caption).foregroundStyle(Theme.ink3)
            }
            .lineLimit(stacked ? nil : 1)
            .minimumScaleFactor(0.7)
            .fixedSize(horizontal: false, vertical: stacked)
        }
    }

    /// The turnover is read afresh when a button is pressed: during a fast time-lapse the hero can be a tick behind,
    /// and its turnover may already have passed (the clock would jump backwards).
    private func buttons(color: Color) -> some View {
        let layout = stacked ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(spacing: 10))
        return layout {
            Button {
                navigator.turnoverBefore(importance: importance)
            } label: {
                HeroButtonLabel(title: "Just before", symbol: "play.fill")
            }
            .buttonStyle(.bordered)
            .tint(color)
            Button {
                navigator.turnoverAfter(importance: importance)
            } label: {
                HeroButtonLabel(title: "Just after", symbol: "forward.end.fill")
            }
            .buttonStyle(.borderedProminent)
            .tint(color.opacity(0.85))
            .foregroundStyle(Theme.background)
        }
        .controlSize(.regular)
    }

    private var card: some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        let gradient = LinearGradient(
            colors: [Theme.levelColor(turnover.top, opacity: 0.2, lightness: 0.4), Theme.panel.opacity(0.9)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        return shape.fill(gradient).overlay { shape.strokeBorder(Theme.levelColor(turnover.top, opacity: 0.35), lineWidth: 1) }
    }

    /// How far the ending cycle has come at t.
    @ViewBuilder
    private func progress(at t: Double, color: Color) -> some View {
        let ending = words.notation.model.level(at: t, turnover.top)
        let start = ending?.start ?? turnover.time
        let span = turnover.time - start
        // Earth: the share of the time between the two turnovers; pure: the ending cycle's own phase
        let p = pure ? (ending?.phase ?? 0) : span > 0 ? min(1, max(0, (t - start) / span)) : 0
        VStack(alignment: .leading, spacing: 6) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.levelColor(turnover.top, opacity: 0.16))
                    Capsule().fill(color).frame(width: max(4, geo.size.width * p))
                }
            }
            .frame(height: 5)
            .accessibilityElement()
            .accessibilityLabel("Progress through the current \(pure ? LadderPureText.levelSay(turnover.top) : LadderText.chip(turnover.top)) cycle")
            .accessibilityValue(pure ? progressWords(p) : "\(LadderText.pctWhole(p)) percent")
            let caption = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(alignment: .center, spacing: 8))
            caption {
                if pure {
                    Text(verbatim: "began \(text.left(from: start, to: t)) ago")
                    if !stacked { Spacer(minLength: 6) }
                    if Notation.isMajor(turnover.top) {
                        Text(verbatim: "\(LadderPureText.quarterWord(p)) quarter")
                    } else {
                        PairView(fraction: p, color: Theme.teal, height: 13)
                    }
                } else {
                    Text(verbatim: "since \(LadderText.whenLabel(words.earth, start, ref: t, span: max(1, span)))")
                    if !stacked { Spacer(minLength: 6) }
                    Text(verbatim: "\(LadderText.pctWhole(p))\(LadderText.nnbsp)% of this cycle")
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(Theme.ink3)
            .lineLimit(stacked ? nil : 1)
        }
    }

    private func progressWords(_ p: Double) -> String {
        if Notation.isMajor(turnover.top) { return "\(LadderPureText.quarterWord(p)) quarter" }
        let pair = Notation.pair(p)
        return "phase \(pair.hi) and \(pair.lo) of 256"
    }
}

/// An icon and a title on one line, centred in a full-width button.
private struct HeroButtonLabel: View {
    let title: String
    let symbol: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: symbol).imageScale(.small)
            Text(title).lineLimit(1).minimumScaleFactor(0.8)
        }
        .font(.subheadline.weight(.semibold))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 2)
    }
}

/// A brief glow when the hero changes (a turnover passed, or the clock moved on).
private struct TurnoverGlow: ViewModifier {
    let level: Int
    let trigger: Double
    let enabled: Bool

    func body(content: Content) -> some View {
        content.keyframeAnimator(initialValue: 0.0, trigger: trigger) { view, glow in
            view.shadow(color: Theme.levelColor(level, opacity: 0.6 * glow), radius: 18 * glow)
        } keyframes: { _ in
            LinearKeyframe(enabled ? 1.0 : 0.0, duration: 0.15)
            LinearKeyframe(0.0, duration: 0.9)
        }
    }
}

// MARK: - Next threshold of the selected level

/// The selected level's next quarter threshold as the strip shows it: the same from one tick to the next until the
/// threshold passes.
private struct NextThreshold: Equatable {
    let level: Int
    /// The quarter the displayed time is in; the threshold ends it.
    let quarter: Int
    /// When the threshold falls (nil: none before the catalogue ends).
    let time: Double?
    /// The cycle's length: the resolution of the place label.
    let duration: Double

    init(_ lv: LevelReading) {
        level = lv.level
        quarter = lv.quarter
        time = lv.next.time
        duration = lv.duration
    }
}

/// The selected level's next quarter threshold, one tap from Just after it.
private struct ThresholdStrip: View {
    /// The selected level's next threshold (nil outside the catalogue).
    let threshold: NextThreshold?
    let words: Wording
    let navigator: LadderNavigator
    /// How often the countdown redraws.
    let cadence: Double

    @Environment(AppSettings.self) private var settings
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let level = settings.selectedLevel
        Button {
            navigator.nextThreshold(level)
        } label: {
            ClockTimeline(.periodic(cadence)) { raw in
                let t = LadderLaunch.shown(raw)
                strip(level: level, t: t)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(accessibilityText(level: level, t: t))
            }
        }
        .buttonStyle(LadderPressStyle())
        .disabled(threshold?.time == nil)
        .accessibilityHint("Just after this threshold")
        .accessibilityAddTraits(.isButton)
    }

    private func strip(level: Int, t: Double) -> some View {
        let pure = words.pure
        let text = LadderPureText(notation: words.notation)
        return Group {
            if let threshold, let when = threshold.time {
                let quarter = Text(verbatim: "next \(Notation.quarterWords[threshold.quarter])")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.ink)
                let countdown = LiveCountdown(target: when, t: t, container: cadence, pure: pure) { now in
                    "in " + (pure ? text.left(from: now, to: when) : LadderText.countdown(when - now))
                }
                .font(.footnote.monospacedDigit())
                .foregroundStyle(Theme.ink2)
                let spot = Text(place(threshold, when: when, t: t, text: text))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Theme.ink3)
                let go = Image(systemName: "forward.end")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.levelColor(level))
                if typeSize.isAccessibilitySize {
                    // accessibility sizes: one fact per line
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 10) {
                            MiniChip(level: level)
                            quarter
                            Spacer(minLength: 6)
                            go
                        }
                        countdown
                        spot
                    }
                } else {
                    HStack(spacing: 10) {
                        MiniChip(level: level)
                        VStack(alignment: .leading, spacing: 1) {
                            quarter
                            countdown
                        }
                        Spacer(minLength: 6)
                        spot.lineLimit(1).minimumScaleFactor(0.75)
                        go
                    }
                }
            } else {
                HStack(spacing: 10) {
                    MiniChip(level: level)
                    Text("No further threshold before the catalogue ends")
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink3)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.panel2.opacity(0.85), in: .rect(cornerRadius: 14, style: .continuous))
        .contentShape(.rect)
    }

    /// "η, depth 7: next End in 56 min 12 s, at 12:56:12" · pure "Eta, depth 7: next End in 6ι 43λ, at 35η 0ι".
    private func accessibilityText(level: Int, t: Double) -> String {
        let head = words.pure ? LadderPureText.depthWords(level) : "\(LadderText.letter(level)), depth \(level + 1)"
        guard let threshold, let when = threshold.time else { return "\(head): no further threshold before the catalogue ends" }
        let text = LadderPureText(notation: words.notation)
        let left = words.pure ? text.left(from: t, to: when) : LadderText.countdown(when - t)
        let spot = place(threshold, when: when, t: t, text: text)
        return "\(head): next \(Notation.quarterWords[threshold.quarter]) in \(left)\(spot.isEmpty ? "" : ", \(spot)")"
    }

    /// Where the threshold falls: a Gregorian label · pure: the next quarter word (a major) or two stamp tokens.
    private func place(_ threshold: NextThreshold, when: Double, t: Double, text: LadderPureText) -> String {
        guard words.pure else { return LadderText.whenLabel(words.earth, when, ref: t, span: threshold.duration) }
        if Notation.isMajor(threshold.level) { return "→ \(Notation.quarterWords[(threshold.quarter + 1) % 4])" }
        let where_ = text.quarterWhere(when, level: threshold.level)
        return where_.isEmpty ? "" : "at \(where_)"
    }
}

// MARK: - The following turnovers

private struct TurnoverList: View {
    let rows: [TurnoverRow]
    let words: Wording
    let navigator: LadderNavigator
    let cadence: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(rows) { row in
                if let heading = row.heading {
                    Text(heading)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink3)
                        .padding(.top, row.separated ? 14 : 6)
                        .padding(.bottom, 2)
                        .accessibilityAddTraits(.isHeader)
                } else if row.separated {
                    Rectangle().fill(Theme.line2).frame(height: 1).padding(.vertical, 6)
                }
                TurnoverRowView(row: row, words: words, navigator: navigator, cadence: cadence)
            }
        }
    }
}

private struct TurnoverRowView: View {
    let row: TurnoverRow
    let words: Wording
    let navigator: LadderNavigator
    /// How often the countdown redraws.
    let cadence: Double

    @ScaledMetric(relativeTo: .subheadline) private var readingSize = 15.0
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let e = row.turnover
        let color = Theme.levelColor(e.top)
        HStack(spacing: 8) {
            Button {
                navigator.after(e)
            } label: {
                ClockTimeline(.periodic(cadence)) { raw in
                    let t = LadderLaunch.shown(raw)
                    content(at: t)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(label(e, t: t))
                }
            }
            .buttonStyle(LadderPressStyle())
            .accessibilityHint("Just after this turnover")
            Button {
                navigator.before(e)
            } label: {
                Image(systemName: "play.circle")
                    .font(.title3)
                    .foregroundStyle(color)
                    .frame(width: 32, height: 32)
                    .contentShape(.rect)
            }
            .buttonStyle(LadderPressStyle())
            .accessibilityLabel("Just before")
            .help("Just before this turnover, then real time")
        }
        .contextMenu {
            Button("Just after", systemImage: "forward.end") { navigator.after(e) }
            Button("Just before", systemImage: "play") { navigator.before(e) }
        }
    }

    /// The chip, the countdown at t and when.
    private func content(at t: Double) -> some View {
        let e = row.turnover
        let pure = words.pure
        let text = LadderPureText(notation: words.notation)
        let countdown = LiveCountdown(target: e.time, t: t, container: cadence, pure: pure) { now in
            pure ? text.left(from: now, to: e.time) : LadderText.countdown(e.time - now)
        }
        .font(.reading(readingSize, weight: .medium))
        .foregroundStyle(Theme.ink)
        .lineLimit(1)
        let when = HStack(spacing: 8) {
            Text(row.label)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
            if e.finer > 0 {
                Text(verbatim: "+\(e.finer)")
                    .font(.caption2.weight(.medium).monospacedDigit())
                    .foregroundStyle(Theme.ink3)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Theme.panel3, in: .capsule)
            }
        }
        return Group {
            if typeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 10) {
                        MiniChip(level: e.top)
                        countdown
                    }
                    when
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 10) {
                    MiniChip(level: e.top)
                    countdown
                    Spacer(minLength: 6)
                    when
                }
            }
        }
        .padding(.vertical, 9)
        .contentShape(.rect)
    }

    private func label(_ e: Turnover, t: Double) -> String {
        let text = LadderPureText(notation: words.notation)
        let finer = e.finer > 0 ? ", \(e.finer) finer \(e.finer == 1 ? "cycle ends" : "cycles end") with it" : ""
        if words.pure {
            // the row's label is what begins there (`Turnovers.byNuclide`)
            let what = words.notation.model.inRange(e.time + 0.001) ? "\(row.label) begins" : "the catalogue ends"
            return "\(LadderPureText.depthWords(e.top)) turns over in \(text.left(from: t, to: e.time)): \(what)\(finer)"
        }
        return "\(LadderText.letter(e.top)), depth \(e.top + 1) turns over in \(LadderText.countdown(e.time - t)), "
            + "\(LadderText.whenFull(words.earth, e.time))\(finer)"
    }
}

/// A one-line state of the card: outside the catalogue, nothing left to count down to.
private struct UpNextNote: View {
    let symbol: String
    let text: String

    var body: some View {
        Label {
            Text(text).fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol).foregroundStyle(Theme.ink3)
        }
        .font(.subheadline)
        .foregroundStyle(Theme.ink2)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel2.opacity(0.85), in: .rect(cornerRadius: 14, style: .continuous))
    }
}
