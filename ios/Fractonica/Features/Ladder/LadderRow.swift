import FractonicaKit
import SwiftUI

/// One depth of the ladder (src/ui/ladder.js): chip, place in the parent, time left, the segmented bar and the phase;
/// the selected row opens its details. Each row redraws on its own, at the cadence its bar needs (one device pixel,
/// at most 4 Hz for slow cycles, every frame for the fast ones), and reads its level once per redraw.
struct LadderRow: View {
    let level: Int
    let isSelected: Bool
    let isExpanded: Bool
    let navigator: LadderNavigator
    let onTap: () -> Void

    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @ScaledMetric(relativeTo: .subheadline) private var readingSize = 15.0

    private var info: LevelInfo { FractonicaClock.shared.levelInfo(level) }
    /// Too fast to count down or to follow (ν, ξ).
    private var still: Bool { info.meanSeconds < LadderCadence.stillBelow }

    /// Displayed seconds between redraws; nil every frame.
    private var cadence: Double? {
        if still { return isExpanded ? LadderCadence.readout : 60 }
        return LadderCadence.row(meanSeconds: info.meanSeconds)
    }

    var body: some View {
        let words = settings.wording
        let cadence = cadence
        ClockTimeline(cadence.map { .periodic($0) } ?? .animation) { raw in
            let t = LadderLaunch.shown(raw)
            let lv = store.clock.level(at: t, level)
            VStack(alignment: .leading, spacing: 0) {
                header(lv, t: t, words: words, container: cadence)
                if isExpanded, let lv {
                    LadderDetail(reading: lv, t: t, still: still, words: words, container: cadence, navigator: navigator)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
        }
    }

    // MARK: Header

    private func header(_ lv: LevelReading?, t: Double, words: Wording, container: Double?) -> some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                LevelChip(level: level, prominent: isSelected, dimmed: lv == nil)
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(counter(lv, words: words))
                            .font(.subheadline)
                            .foregroundStyle(lv == nil ? Theme.ink3 : Theme.ink2)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 4)
                        left(lv, t: t, words: words, container: container)
                            .font(.reading(readingSize, weight: .medium))
                            .foregroundStyle(lv == nil ? Theme.ink3 : still ? Theme.ink2 : Theme.ink)
                            .lineLimit(1)
                            .layoutPriority(1)
                    }
                    SegmentBar(level: level, factor: info.factor, phase: lv?.phase, still: still, emphasized: isSelected, clip: clip(lv))
                }
                PhaseMark(reading: still ? nil : lv, pure: words.pure)
            }
            .padding(.vertical, 7)
            .contentShape(.rect)
        }
        .buttonStyle(LadderPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText(lv, t: t, words: words))
        .accessibilityHint(isExpanded ? "Hides the details" : "Selects this depth and shows its details")
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
        .accessibilityAction(named: "Just after") { navigator.justAfter(level) }
        .accessibilityAction(named: "Just before") { navigator.justBefore(level) }
        .accessibilityAction(named: "Start of this cycle") { navigator.start(level) }
    }

    /// "6 of 18" · pure "Trifracton Node", "ε#5", "34η".
    private func counter(_ lv: LevelReading?, words: Wording) -> String {
        guard let lv else { return "—" }
        if still { return "too fast to follow" }
        return words.pure ? LadderPureText(notation: words.notation).rowLabel(lv) : LadderText.counter(local: lv.local, siblings: lv.siblings)
    }

    @ViewBuilder
    private func left(_ lv: LevelReading?, t: Double, words: Wording, container: Double?) -> some View {
        if let lv {
            if still {
                Text(words.pure ? LadderPureText(notation: words.notation).periodBlinks(info.meanSeconds) : "every \(EarthTime.duration(info.meanSeconds))")
            } else {
                let end = lv.end
                let pure = words.pure
                let text = LadderPureText(notation: words.notation)
                LiveCountdown(target: end, t: t, container: container, pure: pure) { now in
                    pure ? text.left(from: now, to: end) : LadderText.remaining(end - now)
                }
            }
        } else {
            Text("—")
        }
    }

    /// The phase at which the catalogue ends inside a clipped cycle.
    private func clip(_ lv: LevelReading?) -> Double? {
        guard let lv, lv.clipped else { return nil }
        let p = info.prefix
        return Double(Int128(store.clock.extent) * p - 4 * Int128(lv.cycle)) / 4
    }

    private func accessibilityText(_ lv: LevelReading?, t: Double, words: Wording) -> String {
        let head = words.pure ? LadderPureText.depthWords(level) : "\(LadderText.letter(level)), depth \(level + 1)"
        guard let lv else { return "\(head): outside the catalogue" }
        if still {
            let length = words.pure ? LadderPureText(notation: words.notation).periodBlinks(info.meanSeconds) : EarthTime.duration(info.meanSeconds)
            return "\(head): too fast to follow, one cycle lasts \(length)"
        }
        let clipped = lv.clipped ? ", clipped by the end of the catalogue" : ""
        if words.pure {
            let text = LadderPureText(notation: words.notation)
            let phase = Notation.isMajor(level)
                ? "\(LadderPureText.quarterWord(lv.phase)) quarter"
                : "phase \(Notation.pair(lv.phase).hi) and \(Notation.pair(lv.phase).lo) of 256"
            let next = text.nextCycle(level: level, cycle: lv.cycle)?.name
            return "\(head): \(text.cycleTitle(level: level, cycle: lv.cycle)), \(lv.local + 1) of \(lv.siblings), \(phase), "
                + "\(text.left(from: t, to: lv.end)) left, then \(next.map { "\($0) begins" } ?? "the catalogue ends")\(clipped)"
        }
        let whole = LadderText.pctWhole(lv.phase)
        let pct = info.meanSeconds >= 120 ? whole : whole / 10 * 10
        return "\(head): \(LadderText.counter(local: lv.local, siblings: lv.siblings)), \(pct) percent through this cycle, "
            + "\(LadderText.remaining(lv.end - t)) left, ends \(LadderText.whenFull(words.earth, lv.end))\(clipped)"
    }
}

// MARK: - Details

/// The open row's details: when the cycle ends (or what begins), its quarter thresholds, where the displayed time is
/// inside it, its span, and the three ways to travel along it.
struct LadderDetail: View {
    let reading: LevelReading
    let t: Double
    let still: Bool
    let words: Wording
    let container: Double?
    let navigator: LadderNavigator

    private var level: Int { reading.level }
    private var pure: Bool { words.pure }
    private var text: LadderPureText { LadderPureText(notation: words.notation) }
    private var clock: FractonicaClock { words.notation.model }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Rectangle().fill(Theme.line).frame(height: 1).padding(.top, 6)
            ends
            thresholds
            facts
            actions
        }
        .padding(.bottom, 10)
        .padding(.leading, 2)
    }

    // MARK: Ends

    @ViewBuilder
    private var ends: some View {
        let lv = reading
        if pure {
            let next = text.nextCycle(level: level, cycle: lv.cycle)
            VStack(alignment: .leading, spacing: 3) {
                DetailKey(text: next == nil ? "Catalogue ends" : "Ends")
                if let next {
                    Text(LadderPureText.endsText(next.name))
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text(next.address)
                        .font(.code(12))
                        .foregroundStyle(Theme.ink3)
                        .textSelection(.enabled)
                } else {
                    LiveCountdown(target: lv.end, t: t, container: container, pure: true) { now in
                        "in " + text.left(from: now, to: lv.end)
                    }
                    .font(.title3.weight(.semibold).monospacedDigit())
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 3) {
                DetailKey(text: lv.clipped ? "Catalogue ends" : "Ends")
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(LadderText.whenFull(words.earth, lv.end, precise: lv.duration < 10))
                        .font(.title3.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.ink)
                        .minimumScaleFactor(0.7)
                    Text(words.tag(lv.end))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                }
                .lineLimit(1)
            }
        }
    }

    // MARK: Thresholds

    private var thresholds: some View {
        let lv = reading
        let names = Notation.quarterWords
        let fractions = ["¼", "½", "¾", "1"]
        return VStack(alignment: .leading, spacing: 6) {
            DetailKey(text: pure && !still && level < 12 ? "Quarters end at" : "Quarters")
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 7) {
                ForEach(0..<4, id: \.self) { i in
                    let when = lv.thresholds[i + 1].time
                    let state = still ? 2 : i < lv.quarter ? 0 : i == lv.quarter ? 1 : 2
                    GridRow {
                        Circle()
                            .fill(state == 0 ? Theme.ink3 : state == 1 ? Theme.levelColor(level) : .clear)
                            .overlay { Circle().strokeBorder(state == 2 ? Theme.ink3 : .clear, lineWidth: 1) }
                            .frame(width: 7, height: 7)
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Text(names[i]).foregroundStyle(state == 0 ? Theme.ink3 : Theme.ink)
                            Text(fractions[i]).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        Text(place(when))
                            .monospacedDigit()
                            .foregroundStyle(state == 0 ? Theme.ink3 : Theme.ink2)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                        relative(when, state: state)
                            .monospacedDigit()
                            .foregroundStyle(state == 1 ? Theme.levelColor(level) : Theme.ink3)
                            .lineLimit(1)
                            .gridColumnAlignment(.trailing)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    }
                    .font(.subheadline)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// Where a threshold falls: a Gregorian label at the cycle's resolution · pure two stamp tokens ("34η 9ι").
    private func place(_ when: Double?) -> String {
        guard let when else { return "—" }
        if pure {
            let where_ = text.quarterWhere(when, level: level)
            return where_.isEmpty ? "—" : where_
        }
        return LadderText.whenLabel(words.earth, when, ref: reading.start, span: reading.duration)
    }

    @ViewBuilder
    private func relative(_ when: Double?, state: Int) -> some View {
        if let when {
            if still {
                Text(pure ? "+" + text.periodBlinks(when - reading.start) : "+\(Int(LadderText.jsRound((when - reading.start) * 1000))) ms")
            } else if state == 0 {
                Text("passed")
            } else {
                LiveCountdown(target: when, t: t, container: container, pure: pure) { now in
                    pure ? text.left(from: now, to: when) : "in " + LadderText.countdown(when - now)
                }
            }
        } else {
            Text("after the end")
        }
    }

    // MARK: Facts

    private var facts: some View {
        let lv = reading
        let seg = LadderText.segment(phase: lv.phase, factor: lv.factor)
        let span = LadderText.positionSpan(cycle: lv.cycle, prefix: clock.levelInfo(level).prefix, extent: clock.extent, clipped: lv.clipped)
        return Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 9) {
            if pure {
                pureFacts(lv, seg: seg)
            } else {
                fact("Cycle", LadderText.place(level: level, local: lv.local, siblings: lv.siblings, cycle: lv.cycle))
                fact("Through", still ? "too fast to follow" : "\(LadderText.pctTenths(lv.phase)) of this cycle")
                fact("Sector", still ? "—" : LadderText.sector(level: level, index: seg.index, frac: seg.frac, factor: lv.factor))
                fact("Started", LadderText.whenFull(words.earth, lv.start, precise: lv.duration < 10))
                fact("Length", EarthTime.duration(lv.duration) + (lv.clipped ? " · clipped" : ""))
            }
            fact(pure ? "Position" : "Saros span", "\(span.from) → \(span.to)", code: true)
        }
        .font(.subheadline)
    }

    @ViewBuilder
    private func pureFacts(_ lv: LevelReading, seg: (index: Int, frac: Double)) -> some View {
        let major = Notation.isMajor(level)
        GridRow {
            label(major ? "Quarter" : "Phase")
            if still {
                Text("too fast to follow").foregroundStyle(Theme.ink2)
            } else if major {
                HStack(spacing: 8) {
                    QuarterPips(quarter: lv.quarter)
                    Text(verbatim: "\(LadderPureText.quarterWord(lv.phase)) · \(lv.quarter + 1) of 4").foregroundStyle(Theme.ink)
                }
            } else {
                HStack(spacing: 8) {
                    PairView(fraction: lv.phase, color: Theme.teal, height: 15)
                    Text(Notation.pairText(lv.phase)).monospacedDigit().foregroundStyle(Theme.ink)
                }
            }
        }
        GridRow {
            label("Sector")
            if still {
                Text("—").foregroundStyle(Theme.ink2)
            } else {
                let sector = text.sectorName(lv, index: seg.index, frac: seg.frac)
                HStack(spacing: 8) {
                    if !sector.major { PairView(fraction: seg.frac, color: Theme.teal.opacity(0.8), height: 13) }
                    Text(verbatim: "\(sector.name)\(sector.quarter.map { " \($0)" } ?? "") · \(seg.index + 1) of \(lv.factor)")
                        .foregroundStyle(Theme.ink)
                }
            }
        }
        GridRow {
            label("Cycle")
            VStack(alignment: .leading, spacing: 2) {
                Text(text.cycleTitle(level: level, cycle: lv.cycle)).foregroundStyle(Theme.ink)
                Text(text.cycleAddress(level: level, cycle: lv.cycle))
                    .font(.code(12))
                    .foregroundStyle(Theme.ink3)
                    .textSelection(.enabled)
            }
        }
        GridRow {
            label("Started")
            Text(verbatim: "\(text.left(from: lv.start, to: t)) ago")
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
        }
        GridRow {
            label("Length")
            VStack(alignment: .leading, spacing: 2) {
                Text(text.length(lv) + (lv.clipped ? " · clipped" : "")).foregroundStyle(Theme.ink)
                Text(text.unitSentence(level)).font(.caption).foregroundStyle(Theme.ink3)
            }
        }
    }

    private func fact(_ key: String, _ value: String, code: Bool = false) -> some View {
        GridRow {
            label(key)
            Text(value)
                .font(code ? .code(12) : nil)
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
                .textSelection(.enabled)
                .lineLimit(code ? 1 : nil)
                .minimumScaleFactor(code ? 0.7 : 1)
                .fixedSize(horizontal: false, vertical: !code)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .foregroundStyle(Theme.ink3)
            .fixedSize()
            .gridColumnAlignment(.leading)
    }

    // MARK: Actions

    private var actions: some View {
        let color = Theme.levelColor(level)
        let lead = LadderText.justBeforeLead(reading.duration)
        let leadText = pure ? text.blinks(lead) : LadderText.lead(lead)
        let last = reading.end >= clock.tMax - 0.002
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { actionButtons(color: color, compact: false, last: last, leadText: leadText) }.fixedSize(horizontal: true, vertical: false)
            HStack(spacing: 8) { actionButtons(color: color, compact: true, last: last, leadText: leadText) }.fixedSize(horizontal: true, vertical: false)
        }
        .controlSize(.small)
        .padding(.top, 2)
        .accessibilityElement(children: .contain)
        .accessibilityHint("Just before stops \(leadText) ahead of the end, then plays in real time")
    }

    @ViewBuilder
    private func actionButtons(color: Color, compact: Bool, last: Bool, leadText: String) -> some View {
        Button {
            navigator.start(level)
        } label: {
            ActionLabel(title: "Start", symbol: "backward.end")
        }
        .buttonStyle(.bordered)
        .tint(Theme.ink2)
        .help("Go to the start of this cycle")
        Button {
            navigator.justBefore(level)
        } label: {
            ActionLabel(title: compact ? "Before" : "Just before", symbol: "play")
        }
        .buttonStyle(.bordered)
        .tint(color)
        .disabled(last)
        .help("Just before: \(leadText) ahead of the end, then real time, to watch it turn over (⇧↩)")
        Button {
            navigator.justAfter(level)
        } label: {
            ActionLabel(title: compact ? "After" : "Just after", symbol: "forward.end")
        }
        .buttonStyle(.borderedProminent)
        .tint(color.opacity(0.85))
        .foregroundStyle(Theme.background)
        .disabled(last)
        .help("Just after: \(pure ? text.blinks(0.001) : "1 ms") into the next cycle (↩)")
    }
}

/// An icon and a title of a small action button, on one line at their natural width.
private struct ActionLabel: View {
    let title: String
    let symbol: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).imageScale(.small)
            Text(title).lineLimit(1)
        }
        .font(.subheadline.weight(.medium))
        .fixedSize()
    }
}
