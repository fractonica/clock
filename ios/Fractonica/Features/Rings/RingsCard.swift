import FractonicaKit
import SwiftUI

/// The selected cycle in detail, below the dial on iPhone and beside it on wide layouts: its name and phase, the
/// waveform inset, its four quarter thresholds (each a jump) and its facts.
struct RingsCard: View {
    let model: RingsScreenModel

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .title) private var readingSize: CGFloat = 30
    /// The Pentads of the cycle on show, read once a cycle (its moments lead with them).
    @State private var pentads = RingsPentads()

    private let clock = FractonicaClock.shared
    private let cycles = RingsCycles()

    var body: some View {
        let selected = model.selected(settings)
        let speed = RingsScreenModel.speed(of: store)
        VStack(alignment: .leading, spacing: 16) {
            ClockTimeline(.periodic(RingsCentre.cadence(level: selected, speed: speed))) { t in
                header(t, level: selected)
            }
            RingsWave(level: selected, model: model)
            ClockTimeline(.periodic(RingsCentre.cadence(level: selected, speed: speed))) { t in
                VStack(alignment: .leading, spacing: 16) {
                    chips(t, level: selected)
                    facts(t, level: selected)
                }
            }
        }
        .padding(18)
        .background {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Theme.panel.opacity(0.72))
                .overlay {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(Theme.line.opacity(0.9), lineWidth: 0.75)
                }
        }
    }

    private var readTime: (Double) -> Double { { min($0, FractonicaClock.shared.tMax - 0.001) } }

    private func reading(_ t: Double, _ level: Int) -> LevelReading? {
        guard !model.outOfRange, clock.inRange(t) else { return nil }
        return clock.level(at: readTime(t), level)
    }

    // MARK: Header

    @ViewBuilder
    private func header(_ t: Double, level: Int) -> some View {
        let color = Theme.levelColor(level, lightness: 0.74)
        // large type: the reading goes under the name instead of squeezing it
        let stacked = typeSize.isAccessibilitySize
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
        layout {
            VStack(alignment: .leading, spacing: 5) {
                Text("\(settings.wording.levelName(level)) · \(settings.wording.levelLength(level))")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.ink3)
                if let r = reading(t, level) {
                    let word = RingsText.phaseWord(index: r.index, derivative: r.derivative)
                    Text(settings.pure ? RingsPureText().cycleName(level: level, cycle: r.cycle) : RingsText.cycleTag(r))
                        .font(.system(.title3, design: .monospaced).weight(.semibold))
                        .foregroundStyle(color)
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                    Label {
                        Text("\(word) · value \(RingsText.value(r.value))\(r.dotted ? " · dotted" : "")")
                    } icon: {
                        Image(systemName: RingsText.phaseSymbol(word))
                    }
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                } else {
                    Text("Outside the catalogue")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.ink2)
                }
            }
            if !stacked { Spacer(minLength: 8) }
            if let r = reading(t, level) {
                phase(r, color: color, alignment: stacked ? .leading : .trailing)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// How far through the cycle: a percentage, or in pure mode two glyphs (256 states) for a minor cycle and the
    /// quarter word for a major one.
    @ViewBuilder
    private func phase(_ r: LevelReading, color: Color, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 3) {
            if !settings.pure {
                Text(RingsText.percent(r.phase))
                    .font(.reading(readingSize, weight: .light))
                    .foregroundStyle(Theme.ink)
                Text("through this cycle")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            } else if RingsPureText.isMajor(r.level) {
                Text(RingsPureText.quarterWord(r.phase))
                    .font(.system(size: readingSize * 0.8, weight: .light))
                    .foregroundStyle(Theme.ink)
                Text("quarter")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            } else {
                PairView(fraction: r.phase, color: color, height: readingSize * 0.85)
                Text("phase \(Notation.pairText(r.phase))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.ink3)
                    .accessibilityHidden(true)
            }
        }
    }

    // MARK: Thresholds

    @ViewBuilder
    private func chips(_ t: Double, level: Int) -> some View {
        if let r = reading(t, level) {
            let columns = typeSize >= .xxLarge ? 2 : 4
            let items = chipItems(r, t: t)
            Grid(horizontalSpacing: 8, verticalSpacing: 8) {
                ForEach(0..<(4 / columns), id: \.self) { row in
                    GridRow {
                        ForEach(0..<columns, id: \.self) { col in
                            chip(items[row * columns + col], r: r, now: t)
                        }
                    }
                }
            }
        }
    }

    private struct ChipItem {
        let k: Int
        let time: Double?
        let date: String
        let clock: String
        let count: String
        let label: String
        /// The threshold's Pentad, which leads its moment's first line.
        var pentad: Int? = nil
    }

    private func chipItems(_ r: LevelReading, t: Double) -> [ChipItem] {
        let times = r.thresholds.map(\.time)
        let events = pentads.events(of: r)
        let led = { (k: Int) in events.indices.contains(k + 1) ? events[k + 1] : nil }
        if settings.pure {
            let words = RingsPureText()
            let labels = words.boundaryLabels(level: r.level, times: times)
            return (0..<4).map { k in
                let c = words.chip(r, k: k, t: times[k + 1], now: t, label: labels[k + 1])
                return ChipItem(k: k, time: times[k + 1], date: c.date, clock: c.time, count: c.count, label: c.label, pentad: led(k))
            }
        }
        let earth = settings.wording.earth
        let refYear = earth.parts(t).year
        let day = earth.date(r.start)
        return (0..<4).map { k in
            guard let x = times[k + 1] else {
                return ChipItem(k: k, time: nil, date: "—", clock: "", count: "", label: "\(Fractonica.quarterNames[k]): beyond the end of the catalogue")
            }
            let p = RingsText.whenParts(earth, x, span: r.duration, compact: true, refYear: refYear)
            // a short cycle that stays inside one civil day needs only the time of day
            let sameDay = r.duration < 86_400 && !p.time.isEmpty && earth.date(x) == day
            let isNext = r.quarter == k
            let count = isNext ? RingsText.countdownBody(x - t) : ""
            return ChipItem(k: k, time: x, date: sameDay ? "" : p.date, clock: p.time, count: count,
                            label: "\(Fractonica.quarterNames[k]), \(RingsText.whenText(earth, x, span: r.duration))\(count.isEmpty ? "" : ", in \(count)")",
                            pentad: led(k))
        }
    }

    private func chip(_ item: ChipItem, r: LevelReading, now: Double) -> some View {
        let passed = r.quarter > item.k
        let isNext = r.quarter == item.k && item.time != nil
        let color = Theme.levelColor(r.level, lightness: 0.74)
        return Button {
            jump(to: item.time)
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(Fractonica.quarterNames[item.k])
                    .font(.caption.weight(isNext ? .bold : .semibold))
                    .foregroundStyle(isNext ? color : passed ? Theme.ink3 : Theme.ink2)
                // the moment leads with its Pentad, on the date's line (alone there when the time of day says it all)
                if !item.date.isEmpty || item.pentad != nil {
                    Text.ledByPentad(item.pentad, Text(item.date))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                }
                if !item.clock.isEmpty {
                    Text(item.clock)
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(passed ? Theme.ink3 : Theme.ink)
                        .strikethrough(passed, color: Theme.ink3)
                }
                if !item.count.isEmpty {
                    Text(item.count)
                        .font(.caption2.monospacedDigit().weight(.medium))
                        .foregroundStyle(isNext ? Theme.ink : Theme.ink3)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            // every chip of a row as tall as the tallest (the next one carries a countdown line)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isNext ? Theme.levelColor(r.level, opacity: 0.14) : Theme.panel2.opacity(0.7))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(isNext ? Theme.levelColor(r.level, opacity: 0.6) : Theme.line, lineWidth: isNext ? 1 : 0.75)
                    }
            }
            .contentShape(.rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(item.time == nil)
        .opacity(item.time == nil ? 0.5 : 1)
        .accessibilityLabel(Text(item.label))
        .accessibilityHint(Text(passed ? "Jumps back to this moment of the cycle" : "Jumps just past this moment"))
    }

    /// 1 ms past a threshold of the cycle on show: back to a passed one, ahead to one to come.
    private func jump(to threshold: Double?) {
        switch cycles.thresholdJump(threshold, now: store.time()) {
        case .back(let t), .ahead(let t):
            store.travel(to: t)
            Haptics.play(.step)
        case .end:
            toasts.show(.end)
        case .here, .void:
            break
        }
    }

    // MARK: Facts

    /// One fact: a label, its lines and a dimmer note under them.
    private struct Fact {
        let label: String
        let lines: [String]
        var note: String?
        /// The fact is a moment: its first line leads with this Pentad.
        var pentad: Int?
    }

    @ViewBuilder
    private func facts(_ t: Double, level: Int) -> some View {
        if let r = reading(t, level) {
            let rows = settings.pure ? pureFacts(r, t: t) : earthFacts(r, t: t)
            if typeSize.isAccessibilitySize {
                // large type: each label above its value, the full width for both
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(rows.indices, id: \.self) { i in
                        VStack(alignment: .leading, spacing: 2) {
                            factLabel(rows[i].label)
                            factValue(rows[i].lines, note: rows[i].note, pentad: rows[i].pentad)
                        }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        factLabel("Address")
                        addressText(r)
                    }
                }
            } else {
                Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 14, verticalSpacing: 10) {
                    ForEach(rows.indices, id: \.self) { i in
                        GridRow {
                            factLabel(rows[i].label)
                            factValue(rows[i].lines, note: rows[i].note, pentad: rows[i].pentad)
                        }
                    }
                    GridRow {
                        factLabel("Address")
                        addressText(r)
                    }
                }
            }
        }
    }

    private func earthFacts(_ r: LevelReading, t: Double) -> [Fact] {
        let earth = settings.wording.earth
        let start = RingsText.whenParts(earth, r.start, span: r.duration)
        let end = RingsText.whenParts(earth, r.end, span: r.duration)
        return [
            Fact(label: "Started", lines: [start.date, start.time],
                 note: t >= r.start ? "\(RingsText.countdownBody(t - r.start)) ago" : "in \(RingsText.countdownBody(r.start - t))",
                 pentad: pentads.start(of: r)),
            Fact(label: "Ends", lines: [end.date, end.time] + (r.clipped ? ["end of the catalogue"] : []), note: "in \(RingsText.countdownBody(r.end - t))",
                 pentad: pentads.end(of: r)),
            Fact(label: "Length", lines: ["\(EarthTime.duration(r.duration))\(r.clipped ? " (clipped by the catalogue)" : "")"]),
            Fact(label: "Glyph", lines: ["state \(r.index) of 0–\(r.states - 1)", "value \(RingsText.value(r.value))\(r.dotted ? " · dotted" : "")"]),
        ]
    }

    private func pureFacts(_ r: LevelReading, t: Double) -> [Fact] {
        let words = RingsPureText()
        let res = words.resolution(span: words.cycleSpan(r.level))
        let start = words.when(r.start, res: res, dateTokens: 3, timeTokens: 3)
        let end = words.when(r.end, res: res, dateTokens: 3, timeTokens: 3)
        return [
            Fact(label: "Started", lines: [start.date, start.time], note: words.inText(now: t, r.start), pentad: pentads.start(of: r)),
            Fact(label: "Ends", lines: [end.date, end.time, words.endLine(r)], note: words.inText(now: t, r.end), pentad: pentads.end(of: r)),
            Fact(label: "Length", lines: ["\(words.lengthWithName(level: r.level, start: r.start, end: r.end, clipped: r.clipped))\(r.clipped ? " (clipped by the catalogue)" : "")"]),
            Fact(label: "Glyph", lines: [RingsPureText.stateText(r.phase, level: r.level), "value \(RingsText.value(r.value))\(r.dotted ? " · dotted" : "")"]),
        ]
    }

    private func factLabel(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.medium))
            .foregroundStyle(Theme.ink3)
            .gridColumnAlignment(.leading)
    }

    private func factValue(_ lines: [String], note: String?, pentad: Int? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(lines.filter { !$0.isEmpty }.enumerated()), id: \.offset) { i, line in
                Text.ledByPentad(i == 0 ? pentad : nil, Text(line))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Theme.ink)
            }
            if let note {
                Text(note)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.ink3)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func addressText(_ r: LevelReading) -> some View {
        Text(address(r))
            .font(.footnote.monospaced())
            .fixedSize(horizontal: false, vertical: true)
    }

    /// The path of the cycle from α down, each step in its level's colour.
    private func address(_ r: LevelReading) -> AttributedString {
        let tokens: [(level: Int, text: String)] = settings.pure
            ? RingsPureText().addressTokens(level: r.level, cycle: r.cycle)
            : clock.cycleToPath(level: r.level, cycle: r.cycle).enumerated().map { ($0.offset, "\(Fractonica.periodName($0.offset).text) \($0.element)") }
        var out = AttributedString()
        for (i, token) in tokens.enumerated() {
            if i > 0 {
                var sep = AttributedString(" › ")
                sep.foregroundColor = Theme.ink3
                out += sep
            }
            // a token never breaks across lines ("ζ 4" stays together)
            var part = AttributedString(token.text.replacingOccurrences(of: " ", with: "\u{00A0}"))
            part.foregroundColor = Theme.levelColor(token.level, lightness: 0.72)
            out += part
        }
        return out
    }
}
