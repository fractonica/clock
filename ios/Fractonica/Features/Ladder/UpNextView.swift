import FractonicaKit
import SwiftUI

/// Up next (src/ui/upnext.js): what turns over soon. A turnover is the instant a cycle ends and the next one begins;
/// every finer cycle ends with it. The next turnovers whose coarsest rolling level is within the chosen importance,
/// a hero for the very next one, the selected level's next quarter threshold, then the following turnovers grouped by
/// civil day (pure: by Nuclide). Countdowns refresh at 4 Hz; the list itself is recomputed only when a turnover
/// passes or the clock jumps (`TurnoverMemo`).
struct UpNextView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(Importance.storageKey) private var importanceID = Importance.defaultID
    @State private var memo = TurnoverMemo()

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
            ClockTimeline(.periodic(LadderCadence.readout)) { raw in
                let t = LadderLaunch.shown(raw)
                let turnovers = memo.turnovers(store.clock, at: t, importance: importance, maxLevel: maxLevel)
                UpNextContent(
                    t: t,
                    turnovers: turnovers,
                    importance: importance,
                    maxLevel: maxLevel,
                    words: words,
                    navigator: navigator
                )
                .animation(memo.advanced > 0 && memo.advanced <= 2 && !reduceMotion ? .snappy(duration: 0.35) : nil, value: turnovers.first?.time)
                .sensoryFeedback(.impact(weight: .light, intensity: 0.6), trigger: turnovers.first?.time) { _, _ in
                    settings.haptics && memo.advanced > 0 && memo.advanced <= 2
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

    private func note(_ words: Wording) -> String {
        let text = LadderPureText(notation: words.notation)
        let after = words.pure ? text.blinks(0.001) : "1 ms"
        let before = words.pure ? text.blinks(2) : "2 s"
        return "A turnover is the instant a cycle ends and the next one begins; every finer cycle ends with it. "
            + "Tap a turnover for Just after (\(after) into the next cycle), or its ▶ for Just before (\(before) ahead, then real time)."
            + (words.pure ? " A Blink is the clock’s real-time tick." : "")
    }
}

/// The live part of Up next at one tick.
private struct UpNextContent: View {
    let t: Double
    let turnovers: [Turnover]
    let importance: Importance
    let maxLevel: Int
    let words: Wording
    let navigator: LadderNavigator

    var body: some View {
        let clock = words.notation.model
        VStack(alignment: .leading, spacing: 12) {
            if !clock.inRange(t) {
                UpNextNote(
                    symbol: "clock.badge.xmark",
                    text: words.pure
                        ? "Outside the catalogue (\(words.notation.catalogueText())): there are no turnovers to count down to."
                        : "Outside the Saros 141 catalogue (\(words.earth.date(clock.tMin)) to \(words.earth.date(clock.tMax))): there are no turnovers to count down to."
                )
            } else if let first = turnovers.first {
                TurnoverHero(turnover: first, t: t, importance: importance, maxLevel: maxLevel, words: words, navigator: navigator)
                    .id(first.time)
                    .transition(.asymmetric(insertion: .opacity, removal: .opacity))
                ThresholdStrip(t: t, words: words, navigator: navigator)
                TurnoverList(t: t, turnovers: Array(turnovers.dropFirst()), words: words, navigator: navigator)
            } else {
                ThresholdStrip(t: t, words: words, navigator: navigator)
                UpNextNote(
                    symbol: "flag.checkered",
                    text: words.pure
                        ? "No further turnovers of this size before the catalogue ends."
                        : "No further turnovers of this size before the catalogue ends (\(words.earth.date(clock.tMax)))."
                )
            }
        }
    }
}

// MARK: - Hero

/// The very next turnover: what rolls over, when, what ends with it, how far the ending cycle has come.
private struct TurnoverHero: View {
    let turnover: Turnover
    let t: Double
    let importance: Importance
    let maxLevel: Int
    let words: Wording
    let navigator: LadderNavigator

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .largeTitle) private var countSize = 30.0
    @ScaledMetric(relativeTo: .body) private var badge = 54.0

    private var pure: Bool { words.pure }
    private var text: LadderPureText { LadderPureText(notation: words.notation) }

    var body: some View {
        let top = turnover.top
        let color = Theme.levelColor(top)
        let ending = words.notation.model.level(at: t, top)
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
            progress(ending, color: color)
            buttons(color: color)
        }
        .padding(16)
        .background { card }
        .modifier(TurnoverGlow(level: top, trigger: turnover.time, enabled: !reduceMotion))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Next major turnover")
    }

    /// The badge, the countdown and when (Earth) or what begins (pure).
    private var headline: some View {
        HStack(alignment: .center, spacing: 14) {
            LevelChip(level: turnover.top, prominent: true)
                .scaleEffect(badge / 38)
                .frame(width: badge, height: badge)
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
        return LiveCountdown(target: end, t: t, container: LadderCadence.readout, pure: pure) { now in
            pure ? text.heroLeft(from: now, to: end) : LadderText.countdownLong(end - now)
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
                Text(info.address).font(.code(11)).foregroundStyle(Theme.ink3).lineLimit(1).minimumScaleFactor(0.7)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(LadderText.whenFull(words.earth, turnover.time))
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(Theme.ink2)
                Text(words.tag(turnover.time)).font(.caption).foregroundStyle(Theme.ink3)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
    }

    private func buttons(color: Color) -> some View {
        HStack(spacing: 10) {
            Button {
                navigator.before(turnover)
            } label: {
                HeroButtonLabel(title: "Just before", symbol: "play.fill")
            }
            .buttonStyle(.bordered)
            .tint(color)
            Button {
                navigator.after(turnover)
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

    @ViewBuilder
    private func progress(_ ending: LevelReading?, color: Color) -> some View {
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
            HStack(alignment: .center, spacing: 8) {
                if pure {
                    Text(verbatim: "began \(text.left(from: start, to: t)) ago")
                    Spacer(minLength: 6)
                    if Notation.isMajor(turnover.top) {
                        Text(verbatim: "\(LadderPureText.quarterWord(p)) quarter")
                    } else {
                        PairView(fraction: p, color: Theme.teal, height: 13)
                    }
                } else {
                    Text(verbatim: "since \(LadderText.whenLabel(words.earth, start, ref: t, span: max(1, span)))")
                    Spacer(minLength: 6)
                    Text(verbatim: "\(LadderText.pctWhole(p))\(LadderText.nnbsp)% of this cycle")
                }
            }
            .font(.caption.monospacedDigit())
            .foregroundStyle(Theme.ink3)
            .lineLimit(1)
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

/// The selected level's next quarter threshold, one tap from Just after it.
private struct ThresholdStrip: View {
    let t: Double
    let words: Wording
    let navigator: LadderNavigator

    @Environment(AppSettings.self) private var settings

    var body: some View {
        let level = settings.selectedLevel
        let clock = words.notation.model
        let lv = clock.level(at: t, level)
        let pure = words.pure
        let text = LadderPureText(notation: words.notation)
        Button {
            navigator.nextThreshold(level)
        } label: {
            HStack(spacing: 10) {
                MiniChip(level: level)
                if let lv, let when = lv.next.time {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: "next \(Notation.quarterWords[lv.quarter])")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.ink)
                        LiveCountdown(target: when, t: t, container: LadderCadence.readout, pure: pure) { now in
                            "in " + (pure ? text.left(from: now, to: when) : LadderText.countdown(when - now))
                        }
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(Theme.ink2)
                    }
                    Spacer(minLength: 6)
                    Text(place(lv, when: when, text: text))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Image(systemName: "forward.end")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.levelColor(level))
                } else {
                    Text("No further threshold before the catalogue ends")
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink3)
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Theme.panel2.opacity(0.85), in: .rect(cornerRadius: 14, style: .continuous))
            .contentShape(.rect)
        }
        .buttonStyle(LadderPressStyle())
        .disabled(lv?.next.time == nil)
        .accessibilityHint("Just after this threshold")
    }

    /// Where the threshold falls: a Gregorian label · pure: the next quarter word (a major) or two stamp tokens.
    private func place(_ lv: LevelReading, when: Double, text: LadderPureText) -> String {
        guard words.pure else { return LadderText.whenLabel(words.earth, when, ref: t, span: lv.duration) }
        if Notation.isMajor(lv.level) { return "→ \(Notation.quarterWords[(lv.quarter + 1) % 4])" }
        let where_ = text.quarterWhere(when, level: lv.level)
        return where_.isEmpty ? "" : "at \(where_)"
    }
}

// MARK: - The following turnovers

private struct TurnoverList: View {
    let t: Double
    let turnovers: [Turnover]
    let words: Wording
    let navigator: LadderNavigator

    var body: some View {
        let rows = groupedRows
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
                TurnoverRowView(row: row, t: t, words: words, navigator: navigator)
            }
        }
    }

    private var groupedRows: [TurnoverRow] {
        if words.pure {
            let text = LadderPureText(notation: words.notation)
            return Turnovers.byNuclide(turnovers) { text.turnoverInfo(time: $0.time, top: $0.top) }
        }
        return Turnovers.byDay(turnovers, earth: words.earth, ref: t)
    }
}

private struct TurnoverRowView: View {
    let row: TurnoverRow
    let t: Double
    let words: Wording
    let navigator: LadderNavigator

    @ScaledMetric(relativeTo: .subheadline) private var readingSize = 15.0

    var body: some View {
        let e = row.turnover
        let pure = words.pure
        let text = LadderPureText(notation: words.notation)
        let color = Theme.levelColor(e.top)
        HStack(spacing: 8) {
            Button {
                navigator.after(e)
            } label: {
                HStack(spacing: 10) {
                    MiniChip(level: e.top)
                    LiveCountdown(target: e.time, t: t, container: LadderCadence.readout, pure: pure) { now in
                        pure ? text.left(from: now, to: e.time) : LadderText.countdown(e.time - now)
                    }
                    .font(.reading(readingSize, weight: .medium))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    Spacer(minLength: 6)
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
                .padding(.vertical, 9)
                .contentShape(.rect)
            }
            .buttonStyle(LadderPressStyle())
            .accessibilityLabel(label(e, text: text))
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

    private func label(_ e: Turnover, text: LadderPureText) -> String {
        let finer = e.finer > 0 ? ", \(e.finer) finer \(e.finer == 1 ? "cycle ends" : "cycles end") with it" : ""
        if words.pure {
            let info = text.turnoverInfo(time: e.time, top: e.top)
            let what = info.name.map { "\($0) begins" } ?? "the catalogue ends"
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
