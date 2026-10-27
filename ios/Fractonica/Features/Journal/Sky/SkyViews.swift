import FractonicaKit
import Observation
import SwiftUI

// How the journal shows sky events: each family's colour and name, the diary's symbols as text (never as emoji), what
// shows (the families on or off and the solar sync's ticks, remembered under `journal.sky…`), and the small views the
// timeline, the cards and the detail share.

extension SkyFamily {
    /// The family's name in the journal's menus and lists.
    var title: String {
        switch self {
        case .synodic: "Moon Phases"
        case .anomalistic: "Perigee and Apogee"
        case .draconic: "Lunar Nodes"
        case .sidereal: "Galactic Centre"
        case .lunistice: "Lunistices"
        case .solar: "Seasons and the Sun"
        case .eclipse: "Eclipses"
        case .planet: "Planets"
        }
    }

    /// A symbol that stands for the family (its first kind's).
    var symbol: String {
        switch self {
        case .synodic: "◐"
        case .anomalistic: "■"
        case .draconic: "☊"
        case .sidereal: "★"
        case .lunistice: "△"
        case .solar: "◒"
        case .eclipse: "◍"
        case .planet: "♃"
        }
    }

    /// The family's colour: the Moon's phases silver, the Sun's events the solar gold, eclipses a hot orange, the rest
    /// soft hues apart from the levels' and the entries' teal.
    var color: Color {
        switch self {
        case .synodic: Theme.ink
        case .anomalistic: Color(hue: 0.58, saturation: 0.42, brightness: 1)
        case .draconic: Color(hue: 0.77, saturation: 0.40, brightness: 1)
        case .sidereal: Color(hue: 0.69, saturation: 0.35, brightness: 1)
        case .lunistice: Color(hue: 0.33, saturation: 0.40, brightness: 0.92)
        case .solar: Theme.gold
        case .eclipse: Color(hue: 0.05, saturation: 0.82, brightness: 1)
        case .planet: Color(hue: 0.93, saturation: 0.45, brightness: 1)
        }
    }
}

enum SkyStyle {
    /// A diary symbol as text: the variation selector keeps ♀ ♂ ★ ▲ … from turning into emoji.
    static func text(_ symbol: String) -> String { symbol + "\u{FE0E}" }

    /// "Full Moon", "Northward equinox" in pure mode.
    static func label(_ info: SkyKindInfo, pure: Bool) -> String { pure ? info.labelPure : info.label }

    /// "Total solar eclipse, Full Moon": for accessibility labels.
    static func spoken(_ events: [SkyEvent], pure: Bool) -> String {
        events.map { $0.label(pure: pure) }.joined(separator: ", ")
    }
}

/// What sky events the journal shows (the wave and the stack; an entry's tags are not filtered): families on or off,
/// and the solar sync's ticks on the wave. Remembered under `journal.sky…` keys.
@MainActor @Observable
final class SkyDisplay {
    static let shared = SkyDisplay()

    /// Families switched off.
    var hidden: Set<SkyFamily> {
        didSet { defaults.set(hidden.map(\.rawValue).sorted(), forKey: Keys.hidden) }
    }
    /// The solar sync's quarter thresholds as ticks across the wave.
    var solarTicks: Bool {
        didSet { defaults.set(solarTicks, forKey: Keys.solar) }
    }

    @ObservationIgnored private let defaults: UserDefaults

    private enum Keys {
        static let hidden = "journal.skyHidden"
        static let solar = "journal.skySolarTicks"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        hidden = Set((defaults.stringArray(forKey: Keys.hidden) ?? []).compactMap(SkyFamily.init(rawValue:)))
        solarTicks = defaults.object(forKey: Keys.solar) as? Bool ?? true
    }

    func binding(_ family: SkyFamily) -> Binding<Bool> {
        Binding(get: { !self.hidden.contains(family) },
                set: { on in if on { self.hidden.remove(family) } else { self.hidden.insert(family) } })
    }
}

/// The families on and off, and the solar ticks: a menu section (the timeline's options).
struct SkyMenuSection: View {
    @State private var display = SkyDisplay.shared

    var body: some View {
        Menu {
            ForEach(SkyFamily.allCases, id: \.self) { family in
                Toggle(isOn: display.binding(family)) {
                    Text(verbatim: "\(SkyStyle.text(family.symbol))  \(family.title)")
                }
            }
            Divider()
            Toggle(isOn: Bindable(display).solarTicks) {
                Text("Solar Sync Ticks")
            }
        } label: {
            Label("Sky Events", systemImage: "moon.stars")
        }
    }
}

/// A diary symbol in its family's colour.
struct SkySymbol: View {
    let info: SkyKindInfo
    var size: CGFloat = 13

    var body: some View {
        Text(verbatim: SkyStyle.text(info.symbol))
            .font(.system(size: size, weight: .semibold))
            .foregroundStyle(info.family.color)
    }
}

/// Events as a list: each symbol, label, the Fractonica moment and the Earth time (pure mode: Fractonica only).
struct SkyEventList: View {
    let events: [SkyEvent]
    let words: Wording
    var title: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.ink3)
            }
            ForEach(events) { event in
                SkyEventRow(event: event, words: words)
            }
        }
    }
}

/// One event: its symbol, its label, where it is on the clock and on Earth.
struct SkyEventRow: View {
    let event: SkyEvent
    let words: Wording

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            SkySymbol(info: event.info, size: event.tier == .eclipse ? 20 : 17)
                .frame(minWidth: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: event.label(pure: words.pure))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                if FractonicaClock.shared.inRange(event.time) {
                    Text.journalCode(words.notation.dateText(at: event.time, letters: true, upTo: "iota"), at: event.time, size: 12)
                        .foregroundStyle(Theme.teal)
                }
                if !words.pure {
                    Text(verbatim: words.earth.long(event.time, seconds: false) + " " + words.earth.tag(event.time))
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A popover's body for some events.
struct SkyEventCard: View {
    let events: [SkyEvent]
    let words: Wording
    var title: String?

    var body: some View {
        ScrollView {
            SkyEventList(events: events, words: words, title: title)
                .padding(16)
                .frame(minWidth: 240, maxWidth: 340, alignment: .leading)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: 420)
        .fixedSize(horizontal: false, vertical: events.count <= 5)
    }
}

/// A Helion's events beside its header: their symbols, tap for their names and times.
struct SkyHelionStrip: View {
    let events: [SkyEvent]
    let words: Wording

    @State private var shown = false

    var body: some View {
        Button { shown = true } label: {
            HStack(spacing: 5) {
                ForEach(Array(events.prefix(6))) { event in
                    SkySymbol(info: event.info, size: event.tier == .eclipse ? 17 : 14)
                }
                if events.count > 6 {
                    Text(verbatim: "+\(events.count - 6)").font(.caption2.weight(.semibold)).foregroundStyle(Theme.ink3)
                }
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Theme.panel.opacity(0.9), in: .capsule)
            .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .popover(isPresented: $shown) {
            SkyEventCard(events: events, words: words)
                .presentationCompactAdaptation(.popover)
        }
        .help(SkyStyle.spoken(events, pure: words.pure))
        .accessibilityLabel("Sky: \(SkyStyle.spoken(events, pure: words.pure))")
        .accessibilityHint("Shows when they happen")
    }
}

/// A block's notable events: a few symbols (eclipses first, then equinoxes and solstices, new and full moons, the
/// rest) and "+N" for the others; tap for their names and times.
struct SkyBlockRow: View {
    let shown: [SkyEvent]
    let more: Int
    let words: Wording

    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            HStack(spacing: 4) {
                ForEach(shown) { event in
                    SkySymbol(info: event.info, size: event.tier == .eclipse ? 19 : 15)
                        .frame(width: 26, height: 26)
                        .background(Theme.panel3, in: .circle)
                        .overlay(Circle().stroke(event.tier == .eclipse ? event.family.color.opacity(0.7) : Theme.line2.opacity(0.6),
                                                 lineWidth: event.tier == .eclipse ? 1.5 : 1))
                }
                if more > 0 {
                    Text(verbatim: "+\(Self.count(more))")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.ink2)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background(Theme.panel3, in: .capsule)
                        .overlay(Capsule().stroke(Theme.line2.opacity(0.6), lineWidth: 1))
                        .padding(.leading, 4)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .popover(isPresented: $open) {
            SkyEventCard(events: shown, words: words, title: more > 0 ? "The most notable of \(shown.count + more)" : nil)
                .presentationCompactAdaptation(.popover)
        }
        .accessibilityLabel("Sky: \(SkyStyle.spoken(shown, pure: words.pure))\(more > 0 ? ", and \(more) more" : "")")
    }

    /// "12", "3.9k".
    static func count(_ n: Int) -> String {
        n < 1000 ? "\(n)" : String(format: "%.1fk", Double(n) / 1000)
    }
}

/// An entry's sky tags as tiny symbols (cards).
struct SkyTagSymbols: View {
    let tags: [String]?
    let words: Wording

    var body: some View {
        let kinds = SkyTags.kinds(in: tags)
        if !kinds.isEmpty {
            HStack(spacing: 2) {
                ForEach(Array(kinds.prefix(5).enumerated()), id: \.offset) { _, info in
                    SkySymbol(info: info, size: 11)
                }
                if kinds.count > 5 {
                    Text(verbatim: "+\(kinds.count - 5)").font(.caption2).foregroundStyle(Theme.ink3)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(kinds.map { SkyStyle.label($0, pure: words.pure) }.joined(separator: ", "))
        }
    }
}

/// An entry's sky tags in its detail: each as a chip (symbol and label); tap one for when it happened.
struct SkyTagChips: View {
    let record: HubRecord
    let words: Wording

    @State private var open: SkyEvent?

    var body: some View {
        let kinds = SkyTags.kinds(in: record.tags)
        if !kinds.isEmpty {
            let events = SkyTags.events(of: record)
            VStack(alignment: .leading, spacing: 8) {
                Label("In the sky", systemImage: "moon.stars")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.ink3)
                SkyFlow(spacing: 6) {
                    ForEach(Array(kinds.enumerated()), id: \.offset) { _, info in
                        let event = events.first { $0.name == info.name }
                        Button { open = event } label: {
                            HStack(spacing: 6) {
                                SkySymbol(info: info, size: 15)
                                Text(verbatim: event?.label(pure: words.pure) ?? SkyStyle.label(info, pure: words.pure))
                                    .font(.footnote.weight(.medium))
                                    .foregroundStyle(Theme.ink)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Theme.panel, in: .capsule)
                            .overlay(Capsule().stroke(info.family.color.opacity(0.35), lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .disabled(event == nil)
                        .popover(item: Binding(get: { open?.name == info.name ? open : nil }, set: { open = $0 })) { event in
                            SkyEventCard(events: [event], words: words)
                                .presentationCompactAdaptation(.popover)
                        }
                    }
                }
            }
        }
    }
}

/// Chips laid out in rows that wrap.
struct SkyFlow: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                y += row + spacing
                x = 0
                row = 0
            }
            x += size.width + spacing
            row = max(row, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: min(width, widest), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += row + spacing
                x = bounds.minX
                row = 0
            }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}
