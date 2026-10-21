import FractonicaKit
import SwiftUI

// The parts of the jump screen: the line saying what relative input counts from, the card of the best reading, the
// rows of the other readings and of recent jumps, the error card and the example chips.

// MARK: - Where relative input starts

/// "● Showing Thu 8 Oct 2026, 12:00:00 UTC": the displayed moment offsets and "next" count from.
struct JumpOrigin: View {
    let pure: Bool
    let earth: EarthFormatter

    @Environment(ClockStore.self) private var store

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            let notation = Notation.standard
            let inside = store.clock.inRange(t)
            HStack(spacing: 2) {
                StatusDot(live: store.isLive)
                    .padding(.leading, -6)
                Text(store.isLive ? "Live" : "Showing")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(store.isLive ? Theme.live : Theme.cursor)
                    .padding(.trailing, 6)
                Group {
                    if !inside {
                        Text(pure ? "outside the catalogue (\(notation.catalogueText()))" : "\(earth.long(t)) · outside the catalogue")
                    } else if pure {
                        Text(notation.stamp(at: t, upTo: "iota"))
                    } else {
                        Text("\(earth.long(t)) \(earth.tag(t))")
                    }
                }
                .font(.footnote.monospacedDigit())
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            }
            .accessibilityElement(children: .combine)
            .accessibilityHint("Offsets and next or previous count from this moment")
        }
    }
}

// MARK: - The best reading

/// The best reading: what the text was read as, and the moment it lands on — its date and time with the Fractonica
/// address in Earth mode, the date in words and the clock in pure mode — with the distance from the displayed time and
/// a Go button.
struct JumpResultCard: View {
    let candidate: JumpCandidate
    let pure: Bool
    let earth: EarthFormatter
    let go: () -> Void

    @Environment(ClockStore.self) private var store
    @ScaledMetric(relativeTo: .largeTitle) private var readingSize: CGFloat = 44
    @ScaledMetric(relativeTo: .title) private var pairHeight: CGFloat = 36

    var body: some View {
        JumpCard(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .center) {
                    JumpKindBadge(kind: candidate.kind, live: candidate.live)
                    Spacer(minLength: 8)
                    #if os(macOS)
                    Text("Return ↩︎")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Theme.ink3)
                    #endif
                }
                if let reading {
                    Text(reading)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if candidate.live {
                    liveMoment
                } else if let t = candidate.time {
                    moment(t)
                }
                Rectangle().fill(Theme.line).frame(height: 1)
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        if let t = candidate.time, !candidate.live {
                            ClockTimeline(.periodic(1)) { now in
                                Text(distance(t, from: now))
                                    .font(.subheadline.monospacedDigit().weight(.medium))
                                    .foregroundStyle(Theme.cursor)
                            }
                        }
                        if showsNote {
                            Text(candidate.note)
                                .font(.footnote)
                                .foregroundStyle(Theme.ink3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 8)
                    Button(action: go) {
                        Label(candidate.live ? "Go live" : "Go", systemImage: candidate.live ? "dot.radiowaves.left.and.right" : "arrow.right")
                            .font(.body.weight(.semibold))
                            .padding(.horizontal, 6)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.teal)
                    .accessibilityHint(candidate.live ? "Returns to the live clock" : "Travels to this moment and shows Now")
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    /// What the text was read as. A date's label is its own long form, which the card shows anyway: only what it
    /// says more is kept ("Read as day/month", "June 2031").
    private var reading: String? {
        guard candidate.kind == .date, let t = candidate.time else { return candidate.label }
        return JumpInterpreter.dateReading(label: candidate.label, long: "\(earth.long(t)) \(earth.tag(t))").map { reading in
            reading.contains("/") || reading.contains("first") || reading == "compact" ? "Read as \(reading)" : reading
        }
    }

    /// The note, unless the card already says it (the words of the majors under a date in words).
    private var showsNote: Bool {
        guard !candidate.note.isEmpty, let t = candidate.time else { return false }
        let notation = Notation.standard
        let lines = pure ? [notation.dateText(at: t, upTo: "epsilon")] : [notation.majorText(at: t, level: 3)]
        return !JumpInterpreter.repeats(candidate.note, in: lines)
    }

    @ViewBuilder
    private func moment(_ t: Double) -> some View {
        let notation = Notation.standard
        let clock = store.clock
        let helion = clock.level(at: t, 6)
        VStack(alignment: .leading, spacing: 8) {
            Text(pure ? notation.dateText(at: t, upTo: "epsilon") : day(t))
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text(pure ? notation.clockText(at: t, upTo: "lambda") : earth.time(t))
                    .font(.reading(readingSize, weight: .light))
                    .foregroundStyle(Theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if !pure {
                    Text(earth.tag(t))
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                if let helion {
                    PairView(fraction: helion.phase, color: Theme.teal, height: pairHeight)
                        .accessibilityLabel(Text("Helion phase \(Notation.pairText(helion.phase))"))
                }
            }
            JumpAddressStrip(t: t)
            if !pure {
                Text(notation.majorText(at: t, level: 3))
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
        }
    }

    /// "now": the live clock, ticking with the device.
    private var liveMoment: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let real = context.date.timeIntervalSince1970
            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text(pure ? Notation.standard.clockText(at: real, upTo: "lambda") : earth.time(real))
                    .font(.reading(readingSize, weight: .light))
                    .foregroundStyle(Theme.live)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if !pure {
                    Text(earth.tag(real))
                        .font(.callout.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                }
            }
        }
    }

    private func day(_ t: Double) -> String {
        let p = earth.parts(t)
        return "\(EarthTime.weekdaysShort[p.weekday]) \(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year)"
    }

    /// "in 4 y 235 d" · pure "in 2ε 5η", measured from the displayed time.
    private func distance(_ t: Double, from now: Double) -> String {
        if pure {
            if abs(t - now) < 0.0005 { return "the shown moment" }
            let span = Notation.standard.between(min(t, now), max(t, now))
            return t > now ? "in \(span)" : "\(span) ago"
        }
        return abs(t - now) < 0.5 ? "the displayed time" : EarthTime.countdown(t - now)
    }
}

/// The moment's Fractonica address, each entry in its level's colour: "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι".
struct JumpAddressStrip: View {
    let t: Double

    @Environment(ClockStore.self) private var store

    var body: some View {
        let notation = Notation.standard
        if let address = store.clock.address(at: t), let c = notation.clock(at: t) {
            let entries: [(String, Int)] = address.enumerated().map { level, n in ("\(Fractonica.periodName(level).letter)#\(n)", level) }
                + [("\(c.eta)η", 6), ("\(c.iota)ι", 8)]
            HStack(spacing: 7) {
                ForEach(entries, id: \.1) { text, level in
                    Text(text)
                        .foregroundStyle(Theme.levelColor(level))
                }
            }
            .font(.code(15, weight: .medium))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(notation.stamp(at: t, upTo: "iota")))
        }
    }
}

/// The kind of a reading: an icon and its name in a small capsule.
struct JumpKindBadge: View {
    let kind: JumpCandidate.Kind
    var live = false

    var body: some View {
        Label(live ? "Live" : kind.title, systemImage: live ? "dot.radiowaves.left.and.right" : kind.systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(kind == .error ? Theme.danger : live ? Theme.live : Theme.teal)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background((kind == .error ? Theme.danger : live ? Theme.live : Theme.teal).opacity(0.12), in: .capsule)
    }
}

// MARK: - Rows

/// Another reading of the text: what it was read as and where it lands; a tap goes there.
struct JumpCandidateRow: View {
    let candidate: JumpCandidate
    let pure: Bool
    let earth: EarthFormatter
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: candidate.kind.systemImage)
                    .font(.body)
                    .foregroundStyle(Theme.teal)
                    .frame(width: 26)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.ink3)
            }
            .padding(.vertical, 11)
            .padding(.horizontal, 14)
            .contentShape(.rect)
        }
        .buttonStyle(JumpRowStyle())
        .accessibilityHint("Travels to this moment")
    }

    /// The moment in words, with what the text was read as under it; a date is its own long form, so its title is
    /// the date and its subtitle how it was read.
    private var title: String {
        guard candidate.kind == .date, let t = candidate.time else { return candidate.label }
        return "\(earth.long(t)) \(earth.tag(t))"
    }

    private var subtitle: String? {
        guard let t = candidate.time else { return nil }
        if candidate.kind == .date {
            return JumpInterpreter.dateReading(label: candidate.label, long: title).map { "Read as \($0)" }
        }
        return pure ? Notation.standard.stamp(at: t, upTo: "eta") : "\(earth.long(t)) \(earth.tag(t))"
    }
}

/// A recent jump: the text as typed and how it was read; a tap runs it again, the arrow puts it into the field.
struct JumpRecentRow: View {
    let entry: JumpHistory.Entry
    let run: () -> Void
    let fill: () -> Void
    let remove: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: run) {
                HStack(spacing: 12) {
                    Image(systemName: JumpCandidate.Kind(rawValue: entry.kind)?.systemImage ?? "clock.arrow.circlepath")
                        .font(.body)
                        .foregroundStyle(Theme.ink3)
                        .frame(width: 26)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(entry.text)
                            .font(.body.monospacedDigit())
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        if !entry.label.isEmpty && entry.label != entry.text {
                            Text(entry.label)
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                }
                .padding(.vertical, 10)
                .padding(.leading, 14)
                .contentShape(.rect)
            }
            .buttonStyle(JumpRowStyle())
            .accessibilityLabel(Text(entry.text))
            .accessibilityHint("Jumps there again")
            Button(action: fill) {
                Image(systemName: "arrow.up.backward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.ink3)
                    .frame(width: 44, height: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("Edit in the field")
            .accessibilityLabel("Edit \(entry.text)")
            .padding(.trailing, 2)
        }
        .contextMenu {
            Button("Jump There", systemImage: "arrow.right", action: run)
            Button("Edit", systemImage: "pencil", action: fill)
            Button("Remove", systemImage: "trash", role: .destructive, action: remove)
        }
    }
}

/// The highlight of a pressed row.
private struct JumpRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Theme.panel3 : .clear)
    }
}

// MARK: - Errors

/// Why the text does not read, and how to write it.
struct JumpErrorCard: View {
    let errors: [JumpCandidate]

    var body: some View {
        JumpCard(padding: 18) {
            VStack(alignment: .leading, spacing: 10) {
                JumpKindBadge(kind: .error)
                ForEach(Array(errors.enumerated()), id: \.offset) { i, error in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(error.label)
                            .font(i == 0 ? .headline : .subheadline.weight(.medium))
                            .foregroundStyle(Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        let hint = JumpInterpreter.hint(error.detail, examplesShown: true)
                        if !hint.isEmpty {
                            Text(hint)
                                .font(.callout)
                                .foregroundStyle(Theme.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Examples

/// An example to try: the text in a capsule; a tap puts it into the field. Its meaning is the tooltip and the hint.
struct JumpExampleChip: View {
    let text: String
    let meaning: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(Theme.ink)
                .padding(.horizontal, 11)
                .padding(.vertical, 6)
                .background(Theme.panel2, in: .capsule)
                .overlay(Capsule().strokeBorder(Theme.line))
                .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .help(meaning)
        .accessibilityHint(meaning)
    }
}

// MARK: - Layout parts

/// A titled group of the screen.
struct JumpSection<Content: View, Accessory: View>: View {
    let title: String
    @ViewBuilder let content: Content
    @ViewBuilder let accessory: Accessory

    init(title: String, @ViewBuilder content: () -> Content, @ViewBuilder accessory: () -> Accessory = { EmptyView() }) {
        self.title = title
        self.content = content()
        self.accessory = accessory()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink2)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                accessory
            }
            .padding(.horizontal, 4)
            content
        }
    }
}

/// The panel behind a group of rows or a card.
struct JumpCard<Content: View>: View {
    var padding: CGFloat = 0
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel, in: .rect(cornerRadius: 22, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.line))
            .clipShape(.rect(cornerRadius: 22, style: .continuous))
    }
}

/// A hairline between rows, inset past the icon column.
struct JumpDivider: View {
    var body: some View {
        Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, 52)
    }
}

/// Lays its subviews out left to right, wrapping onto new lines (the example chips).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.reduce(0) { $0 + $1.height } + spacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            let needed = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if needed > width && !row.indices.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}
