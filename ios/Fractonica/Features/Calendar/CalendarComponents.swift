import FractonicaKit
import SwiftUI
#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

// Small parts shared by the converter and the month views: cards, rows, chips, a nudge stepper, the eclipse mark, a
// flow layout, the pasteboard and the feature's launch arguments.

/// A rounded panel on the backdrop, with an optional title row.
struct CalCard<Content: View, Accessory: View>: View {
    var title: String?
    var systemImage: String?
    @ViewBuilder var accessory: Accessory
    @ViewBuilder var content: Content

    init(_ title: String? = nil, systemImage: String? = nil, @ViewBuilder accessory: () -> Accessory,
         @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.accessory = accessory()
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let title {
                HStack(spacing: 8) {
                    if let systemImage {
                        Image(systemName: systemImage)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.ink3)
                            .accessibilityHidden(true)
                    }
                    Text(title)
                        .font(.footnote.weight(.semibold))
                        .textCase(.uppercase)
                        .tracking(0.9)
                        .foregroundStyle(Theme.ink3)
                        .lineLimit(2)
                        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                        .accessibilityAddTraits(.isHeader)
                    Spacer(minLength: 8)
                    accessory
                }
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Theme.panel.opacity(0.78))
                .overlay {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Theme.line.opacity(0.9), lineWidth: 1)
                }
        }
    }
}

extension CalCard where Accessory == EmptyView {
    init(_ title: String? = nil, systemImage: String? = nil, @ViewBuilder content: () -> Content) {
        self.init(title, systemImage: systemImage, accessory: { EmptyView() }, content: content)
    }
}

/// A heading between groups of cards.
struct CalGroupHeader: View {
    let title: String
    var detail: String? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(title)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.ink)
            if let detail {
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink3)
            }
            Spacer()
        }
        .padding(.horizontal, 4)
        .padding(.top, 6)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A labelled value: the label on the left, the value (selectable, with Copy in its context menu) on the right, or
/// stacked when there is no room.
struct CalValueRow: View {
    let label: String
    let value: String
    var mono = false
    var tint: Color = Theme.ink
    var copyable = true

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                labelText
                Spacer(minLength: 8)
                valueText.multilineTextAlignment(.trailing).layoutPriority(1)
            }
            VStack(alignment: .leading, spacing: 3) {
                labelText
                valueText
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var labelText: some View {
        Text(label)
            .font(.subheadline)
            .foregroundStyle(Theme.ink3)
            .lineLimit(1)
    }

    private var valueText: some View {
        Text(value)
            .font(mono ? .code(14) : .body.monospacedDigit())
            .foregroundStyle(tint)
            .textSelection(.enabled)
            .contextMenu {
                if copyable {
                    Button("Copy", systemImage: "doc.on.doc") { CalPasteboard.copy(value) }
                }
            }
    }
}

/// A labelled row with a control on its right (an address entry, a date entry); at accessibility text sizes the
/// control moves under the label, so neither is squeezed into a column of single words.
struct CalStepRow<Label: View, Control: View>: View {
    @ViewBuilder var label: Label
    @ViewBuilder var control: Control
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 10) { label }
                control
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(spacing: 10) {
                label
                Spacer(minLength: 4)
                control
            }
        }
    }
}

/// "η 7"-style chip in a level's colour.
struct CalendarLevelChip: View {
    let text: String
    let level: Int
    var filled = false
    var compact = false

    var body: some View {
        CalTintChip(text: text, color: Theme.levelColor(level), filled: filled, compact: compact)
    }
}

/// A small capsule label in a colour (a level, the gold of the sun).
struct CalTintChip: View {
    let text: String
    let color: Color
    var filled = false
    var compact = false

    var body: some View {
        Text(verbatim: text)
            .font(compact ? .caption.weight(.semibold).monospacedDigit() : .subheadline.weight(.semibold).monospacedDigit())
            .foregroundStyle(filled ? Theme.background : color)
            .padding(.horizontal, compact ? 6 : 8)
            .padding(.vertical, compact ? 2 : 3)
            .background {
                Capsule().fill(filled ? color : color.opacity(0.14))
            }
    }
}

/// − value + with repeat on hold: the converter's way to step an entry. `onChange` gets the new value (already
/// clamped); a step past the end plays the warning haptic.
struct CalNudgeStepper: View {
    let value: Int
    let range: ClosedRange<Int>
    var label: String
    var display: (Int) -> String = { String($0) }
    var tint: Color = Theme.ink
    /// A menu of every value on the number (short ranges only).
    var menu = true
    /// Steps that carry past the range into the parent (the cycle address, odometer style): − and + call this with
    /// the step instead of changing the value inside `range`; it returns false at an end of the catalogue.
    var carry: ((Int) -> Bool)? = nil
    /// With `carry`: whether there is anywhere to go each way (dims the button that has nowhere to go).
    var canStep: (down: Bool, up: Bool)? = nil
    let onChange: (Int) -> Void

    var body: some View {
        HStack(spacing: 2) {
            button(-1, "minus")
            if menu { valueMenu } else { valueText }
            button(1, "plus")
        }
        .padding(3)
        .background(Capsule().fill(Theme.panel3.opacity(0.9)))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(display(value)))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: step(1)
            case .decrement: step(-1)
            @unknown default: break
            }
        }
    }

    private var valueText: some View {
        Text(display(value))
            .font(.reading(16, weight: .semibold))
            .foregroundStyle(tint)
            .lineLimit(1)
            .fixedSize()
            .frame(minWidth: 44)
            .padding(.horizontal, 4)
            .contentTransition(.numericText(value: Double(value)))
    }

    private var valueMenu: some View {
            Menu {
                Picker(label, selection: Binding(get: { value }, set: { set($0) })) {
                    ForEach(Array(range.prefix(400)), id: \.self) { n in
                        Text(display(n)).tag(n)
                    }
                }
            } label: {
                Text(display(value))
                    .font(.reading(16, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(minWidth: 44)
                    .contentTransition(.numericText(value: Double(value)))
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .fixedSize()
    }

    private func button(_ delta: Int, _ symbol: String) -> some View {
        Button {
            step(delta)
        } label: {
            Image(systemName: symbol)
                .font(.footnote.weight(.bold))
                .frame(width: 30, height: 30)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .foregroundStyle(possible(delta) ? Theme.ink2 : Theme.ink3.opacity(0.4))
        .buttonRepeatBehavior(.enabled)
        .accessibilityLabel(Text(delta < 0 ? "Previous" : "Next"))
    }

    private func possible(_ delta: Int) -> Bool {
        if carry != nil, let canStep { return delta < 0 ? canStep.down : canStep.up }
        return range.contains(value + delta)
    }

    private func step(_ delta: Int) {
        if let carry {
            Haptics.play(carry(delta) ? .selection : .warning)
            return
        }
        guard range.contains(value + delta) else {
            Haptics.play(.warning)
            return
        }
        set(value + delta)
    }

    private func set(_ v: Int) {
        guard v != value else { return }
        Haptics.play(.selection)
        onChange(v)
    }
}

/// The eclipse mark: a gold disc with the moon passing over it.
struct CalendarEclipseMark: View {
    var size: CGFloat = 14

    var body: some View {
        Canvas { context, canvasSize in
            let r = min(canvasSize.width, canvasSize.height) / 2
            let c = CGPoint(x: canvasSize.width / 2, y: canvasSize.height / 2)
            context.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)), with: .color(Theme.gold))
            let m = r * 0.86
            let o = CGPoint(x: c.x + r * 0.32, y: c.y - r * 0.18)
            context.fill(Path(ellipseIn: CGRect(x: o.x - m, y: o.y - m, width: 2 * m, height: 2 * m)), with: .color(Theme.background))
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Lays its children out in rows, wrapping where the width ends (the address chain).
struct CalFlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += line + lineSpacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            line = max(line, size.height)
        }
        return CGSize(width: min(widest, width), height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + lineSpacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

/// A capsule button on glass, the calendar's action style.
struct CalActionButton: View {
    let title: String
    let systemImage: String
    var prominent = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, 4)
        }
        .buttonStyle(.glass)
        .tint(prominent ? Theme.teal : nil)
        .buttonBorderShape(.capsule)
    }
}

extension EarthFormatter {
    /// A formatter for a zone, calling UTC by its name (Foundation reports it as "GMT").
    static func calendar(_ zone: TimeZone) -> EarthFormatter {
        ["GMT", "UTC", "GMT+0000"].contains(zone.identifier) && zone.secondsFromGMT() == 0 ? EarthFormatter(zone: "UTC") : EarthFormatter(timeZone: zone)
    }
}

/// The system pasteboard on both platforms.
enum CalPasteboard {
    @MainActor
    static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #elseif os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
        Haptics.play(.success)
        ToastCenter.shared.show("Copied")
    }
}

/// The calendar's launch arguments (harmless test hooks, never persisted): read from UserDefaults' argument domain.
///
///     -FXConverterTime <unix s|ISO>  pin the converter on a moment (not clamped: try 1600-01-01T12:00Z, outside the
///                                    catalogue)
///     -FXConverterZone <IANA id>     the converter's own zone
///     -FXConverterPick <level>       open the glyph state picker of a level (0 … 13)
///     -FXCalendarScroll <anchor>     scroll the converter or the month to a section: earth, position, address, glyphs,
///                                    solar, ribbon (Month), cycles (pure converter)
///     -FXMonth <yyyy-mm>             show a month (Month) instead of following the displayed time
///     -FXMonthBands <keys>           the month's bands for this launch, e.g. "3,4,6,sync"
///     -FXMonthDay <d>                open the detail of day d of the shown month (pure mode: cell d of the page, 0 … 34)
///     -FXConverterDepth <1…14>       the cycle address's depth
///     -FXConverterPoint <point>      the point in the cycle: begin, peak, node, valley, end, phase
///     -FXMonthPick 1                 open the month picker (pure mode: the Delta picker)
///     -FXCalendarShort 1             lay the month and the Delta page out as in a short window (iPhone in landscape)
enum CalendarLaunch {
    /// -FXCalendarShort 1: the flat cells of a short window, to look at them on any device.
    static let forcesShort = int("FXCalendarShort") == 1

    /// The value of `-<key>` ("FXMonth" for -FXMonth), if the app was launched with it.
    static func string(_ key: String) -> String? {
        let value = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)[key]
        return (value as? String) ?? (value as? NSNumber)?.stringValue
    }

    static func double(_ key: String) -> Double? { string(key).flatMap(Double.init) }
    /// Unix seconds, or an ISO date ("1600-01-01T12:00Z": a negative number would read as another argument).
    static func time(_ key: String) -> Double? {
        guard let s = string(key) else { return nil }
        return Double(s) ?? CalMath.parseISO(s, zone: TimeZone(identifier: "UTC")!)
    }
    static func int(_ key: String) -> Int? { string(key).flatMap { Int($0) } }
}
