import FractonicaKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

// The parts of the jump screen: the line saying what relative input counts from, the card of the best reading, the
// rows of the other readings and of recent jumps, the error card and the example chips.

// MARK: - Where relative input starts

/// "● Showing Thu 8 Oct 2026, 12:00:00 UTC": the displayed moment offsets and "next" count from.
struct JumpOrigin: View {
    let pure: Bool
    let earth: EarthFormatter

    @Environment(ClockStore.self) private var store
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        ClockTimeline(.periodic(1)) { t in
            let notation = Notation.standard
            let moment = !store.clock.inRange(t)
                ? (pure ? "outside the catalogue (\(notation.catalogueText()))" : "\(earth.long(t)) · outside the catalogue")
                : pure ? notation.stamp(at: t, upTo: "iota") : "\(earth.long(t)) \(earth.tag(t))"
            let status = Text(store.isLive ? "Live" : "Showing")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(store.isLive ? Theme.live : Theme.cursor)
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                StatusDot(live: store.isLive)
                    .padding(.leading, -6)
                    .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                Text("\(status)  \(Text(moment).foregroundStyle(Theme.ink2))")
                    .font(.footnote.monospacedDigit())
                    .lineLimit(typeSize.isAccessibilitySize ? 4 : 1)
                    .minimumScaleFactor(typeSize.isAccessibilitySize ? 1 : 0.7)
            }
            .accessibilityElement(children: .combine)
            .accessibilityHint("Offsets and next or previous count from this moment")
        }
    }
}

// MARK: - The best reading

/// The best reading: what the text was read as, and the moment it lands on — its date and time with the Fractonica
/// address in Earth mode (on a wide screen the Earth and Fractonica readings side by side), the date in words and the
/// clock in pure mode — with the distance from the displayed time and a Go button. "now" shows the device clock ticking.
/// A long press (secondary click) copies the moment or shares a link to it.
struct JumpResultCard: View {
    let candidate: JumpCandidate
    let pure: Bool
    let earth: EarthFormatter
    /// Room for the Earth and Fractonica readings side by side.
    var wide = false
    let go: () -> Void

    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .largeTitle) private var readingSize: CGFloat = 44
    @ScaledMetric(relativeTo: .title) private var pairHeight: CGFloat = 36

    /// Whole seconds: the "now" card ticks with the device clock's second.
    private static let secondAnchor = Date(timeIntervalSince1970: 0)

    var body: some View {
        JumpCard(padding: wide ? 22 : 18) {
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
                    TimelineView(.periodic(from: Self.secondAnchor, by: 1)) { context in
                        moment(context.date.timeIntervalSince1970, tint: Theme.live)
                    }
                } else if let t = candidate.time {
                    moment(t, tint: Theme.ink)
                }
                Rectangle().fill(Theme.line).frame(height: 1)
                let footer = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                    : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
                footer {
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
                        Label(candidate.live && !store.isLive ? "Go live" : "Go",
                              systemImage: candidate.live ? "dot.radiowaves.left.and.right" : "arrow.right")
                            .font(.body.weight(.semibold))
                            .padding(.horizontal, 6)
                    }
                    .buttonStyle(.glassProminent)
                    .tint(Theme.teal)
                    .fixedSize()
                    .accessibilityHint(candidate.live ? "Returns to the live clock" : "Travels to this moment and shows Now")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .contextMenu {
            if let t = candidate.time, !candidate.live {
                Button("Copy Moment", systemImage: "doc.on.doc") {
                    JumpPasteboard.copy(copyText(t))
                    toasts.show("Copied")
                }
                ShareLink(item: AppLink(screen: .now, time: t).url) {
                    Label("Share Link", systemImage: "square.and.arrow.up")
                }
            }
        }
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
        let lines = pure || wide ? [notation.dateText(at: t, upTo: "epsilon")] : [notation.majorText(at: t, level: 3)]
        return !JumpInterpreter.repeats(candidate.note, in: lines)
    }

    /// The moment the text lands on (or the device clock's, for "now").
    @ViewBuilder
    private func moment(_ t: Double, tint: Color) -> some View {
        if pure {
            fractonica(t, tint: tint, large: true)
        } else if wide {
            HStack(alignment: .top, spacing: 24) {
                earthReading(t, tint: tint)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Rectangle().fill(Theme.line).frame(width: 1)
                fractonica(t, tint: tint, large: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .fixedSize(horizontal: false, vertical: true)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                earthReading(t, tint: tint, withPair: true)
                JumpAddressStrip(t: t)
                Text(Notation.standard.majorText(at: t, level: 3))
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
        }
    }

    /// The Earth date and time in the app zone (with the Helion pair at the end of the time where there is no
    /// Fractonica column for it).
    private func earthReading(_ t: Double, tint: Color, withPair: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(day(t))
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text(earth.time(t))
                        .font(.reading(readingSize, weight: .light))
                        .foregroundStyle(tint)
                        .fixedSize()
                    zoneTag(t)
                    if withPair {
                        Spacer(minLength: 4)
                        pair(t)
                    }
                }
                // large text: the zone under the time
                HStack(alignment: .center, spacing: 10) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(earth.time(t))
                            .font(.reading(readingSize, weight: .light))
                            .foregroundStyle(tint)
                            .lineLimit(1)
                            .minimumScaleFactor(0.5)
                        zoneTag(t)
                    }
                    if withPair {
                        Spacer(minLength: 4)
                        pair(t)
                    }
                }
            }
        }
    }

    private func zoneTag(_ t: Double) -> some View {
        Text(earth.tag(t))
            .font(.callout.monospacedDigit())
            .foregroundStyle(Theme.ink3)
            .fixedSize()
    }

    /// The Fractonica reading: the date in words, the clock, the Helion pair and the address in level colours.
    private func fractonica(_ t: Double, tint: Color, large: Bool) -> some View {
        let notation = Notation.standard
        return VStack(alignment: .leading, spacing: 8) {
            Text(notation.dateText(at: t, upTo: "epsilon"))
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .center, spacing: 10) {
                Text(notation.clockText(at: t, upTo: "lambda"))
                    .font(.reading(large ? readingSize : readingSize * 0.82, weight: .light))
                    .foregroundStyle(tint)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                Spacer(minLength: 4)
                pair(t)
            }
            JumpAddressStrip(t: t)
        }
    }

    /// The Helion's phase pair (SPEC §15.3).
    @ViewBuilder
    private func pair(_ t: Double) -> some View {
        if let helion = store.clock.level(at: t, 6) {
            PairView(fraction: helion.phase, color: Theme.teal, height: pairHeight)
                .accessibilityLabel(Text("Helion phase \(Notation.pairText(helion.phase))"))
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

    /// The moment as text: the full stamp (the jump box reads it back), after the Earth date outside pure mode.
    private func copyText(_ t: Double) -> String {
        let stamp = Notation.standard.stamp(at: t, upTo: "nu")
        return pure ? stamp : "\(earth.long(t)) \(earth.tag(t)) · \(stamp)"
    }
}

/// The moment's Fractonica address, each entry in its level's colour: "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι".
struct JumpAddressStrip: View {
    let t: Double

    @Environment(ClockStore.self) private var store
    @ScaledMetric(relativeTo: .subheadline) private var size: CGFloat = 15

    var body: some View {
        let notation = Notation.standard
        if let address = store.clock.address(at: t), let c = notation.clock(at: t) {
            let entries: [(String, Int)] = address.enumerated().map { level, n in ("\(Fractonica.periodName(level).letter)#\(n)", level) }
                + [("\(c.eta)η", 6), ("\(c.iota)ι", 8)]
            FlowLayout(spacing: 7, lineSpacing: 2) {
                ForEach(entries, id: \.1) { text, level in
                    Text(text)
                        .foregroundStyle(Theme.levelColor(level))
                }
            }
            .font(.code(size, weight: .medium))
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

    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 26

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: candidate.kind.systemImage)
                    .font(.body)
                    .foregroundStyle(Theme.teal)
                    .frame(width: iconWidth)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Theme.ink)
                        .multilineTextAlignment(.leading)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(Theme.ink3)
                            .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
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

    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 26

    var body: some View {
        HStack(spacing: 0) {
            Button(action: run) {
                HStack(spacing: 12) {
                    Image(systemName: JumpCandidate.Kind(rawValue: entry.kind)?.systemImage ?? "clock.arrow.circlepath")
                        .font(.body)
                        .foregroundStyle(Theme.ink3)
                        .frame(width: iconWidth)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(entry.text)
                            .font(.body.monospacedDigit())
                            .foregroundStyle(Theme.ink)
                            .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
                        if !entry.label.isEmpty && entry.label != entry.text {
                            Text(entry.label)
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                                .lineLimit(typeSize.isAccessibilitySize ? 3 : 1)
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
            .accessibilityValue(Text(entry.label == entry.text ? "" : entry.label))
            .accessibilityHint("Jumps there again")
            .accessibilityAction(named: "Edit", fill)
            .accessibilityAction(named: "Remove", remove)
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

/// The highlight of a pressed row, and of a row under the pointer (iPad, Mac).
private struct JumpRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Highlighted(label: configuration.label, pressed: configuration.isPressed)
    }

    private struct Highlighted<Label: View>: View {
        let label: Label
        let pressed: Bool
        @State private var hovering = false

        var body: some View {
            label
                .background(pressed ? Theme.panel3 : hovering ? Theme.panel2 : .clear)
                .onHover { hovering = $0 }
        }
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
                .multilineTextAlignment(.leading)
                .padding(.horizontal, 11)
                .padding(.vertical, 6)
                .background(Theme.panel2, in: .rect(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.line))
                .contentShape(.rect(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .help(meaning)
        .accessibilityHint(meaning)
    }
}

// MARK: - Keyboard

#if os(iOS)
/// The notation's Greek letters in a glass bar over the keyboard, so "α#6 β#4", "next ε" or "+2ε 5η" need no Greek
/// keyboard. Pure mode offers its own letters (the units α β γ δ ε η ι λ ν); the Earth box every level's.
struct JumpLetterKeys: View {
    let pure: Bool
    let insert: (String) -> Void

    @ScaledMetric(relativeTo: .title3) private var keySize: CGFloat = 38

    private var keys: [String] {
        pure ? ["#", "α", "β", "γ", "δ", "ε", "η", "ι", "λ", "ν"]
            : ["#", "α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ", "ν", "ξ"]
    }

    var body: some View {
        // every key spread across the bar when they fit, a scrolling row when they do not
        ViewThatFits(in: .horizontal) {
            row(spread: true)
            ScrollView(.horizontal) { row(spread: false) }
                .scrollIndicators(.hidden)
                .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        }
        .fixedSize(horizontal: false, vertical: true)
        .glassEffect(.regular, in: .capsule)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Greek letters")
    }

    private func row(spread: Bool) -> some View {
        HStack(spacing: 0) {
            ForEach(keys, id: \.self) { key in
                Button {
                    insert(key)
                } label: {
                    Text(key)
                        .font(.title3)
                        .frame(minWidth: keySize * 0.62, maxWidth: spread ? .infinity : nil, minHeight: keySize)
                        .padding(.horizontal, 2)
                        .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .foregroundStyle(Theme.ink)
                .accessibilityLabel(key == "#" ? "Number sign" : key)
            }
        }
        .padding(.horizontal, 10)
    }
}
#endif

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
    @ScaledMetric(relativeTo: .body) private var inset: CGFloat = 52

    var body: some View {
        Rectangle().fill(Theme.line).frame(height: 1).padding(.leading, inset)
    }
}

/// Lays its subviews out left to right, wrapping onto new lines (the example chips). A subview wider than the
/// container (a long example at a large text size) gets the container's width and wraps its own text.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    /// Between lines; `spacing` when nil.
    var lineSpacing: CGFloat? = nil

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.reduce(0) { $0 + $1.height } + (lineSpacing ?? spacing) * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width.map { min($0, width) } ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for (index, size) in zip(row.indices, row.sizes) {
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + (lineSpacing ?? spacing)
        }
    }

    private struct Row {
        var indices: [Int] = []
        var sizes: [CGSize] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    /// The size of a subview: its ideal size, or wrapped to `width` when that is narrower.
    private func size(of subview: LayoutSubview, within width: CGFloat) -> CGSize {
        let ideal = subview.sizeThatFits(.unspecified)
        guard ideal.width > width, width.isFinite else { return ideal }
        return subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for (index, subview) in subviews.enumerated() {
            let size = size(of: subview, within: width)
            let needed = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            if needed > width && !row.indices.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.indices.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
            row.sizes.append(size)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

/// The system clipboard.
enum JumpPasteboard {
    @MainActor static func copy(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #else
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}
