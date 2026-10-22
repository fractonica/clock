import SwiftUI

// Small parts the Timer and the Stopwatch share: the ladder readout, the round controls and section headers.

/// A ladder readout, "02ι 13λ 07ν": big monospaced digits, each unit's letter smaller in its level's colour.
struct LadderReadoutView: View {
    /// Nil reads "—" (outside the catalogue).
    let span: LadderSpan?
    let lead: LadderUnit
    var padLead = true
    var size: CGFloat
    var weight: Font.Weight = .light
    var ink: Color = Theme.ink

    var body: some View {
        Group {
            if let span {
                HStack(alignment: .firstTextBaseline, spacing: size * 0.2) {
                    ForEach(span.fields(from: lead, padLead: padLead), id: \.unit) { field in
                        HStack(alignment: .firstTextBaseline, spacing: size * 0.04) {
                            Text(field.digits)
                                .font(.reading(size, weight: weight))
                                .foregroundStyle(ink)
                            Text(field.unit.symbol)
                                .font(.system(size: size * 0.52, weight: .regular))
                                .foregroundStyle(Theme.levelColor(field.unit.level))
                        }
                    }
                }
            } else {
                Text("—")
                    .font(.reading(size, weight: weight))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .lineLimit(1)
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(span.map { $0.spokenReadout(from: lead) } ?? "Outside the catalogue")
    }
}

/// A large round control in Liquid Glass, as the system Clock's: a word in a circle, tinted for the main action. Its
/// word is sized with the circle, as the system Clock's is (a word in larger text would no longer fit the circle);
/// callers grow the circle with Dynamic Type through `RoundControl.size(_:)`.
struct RoundControl: View {
    let title: String
    var tint: Color?
    var size: CGFloat = 78
    let action: () -> Void

    @Environment(\.isEnabled) private var isEnabled

    init(_ title: String, tint: Color? = nil, size: CGFloat = 78, action: @escaping () -> Void) {
        self.title = title
        self.tint = tint
        self.size = size
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: max(15, size * 0.21), weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(size * 0.1)
                .frame(width: size, height: size)
                .foregroundStyle(tint ?? Theme.ink)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassSurface(.regular.tint((tint ?? Theme.ink2).opacity(tint == nil ? 0.08 : 0.22)).interactive(), in: .circle)
        .overlay {
            Circle().strokeBorder((tint ?? Theme.ink3).opacity(0.35), lineWidth: 1)
        }
        .opacity(isEnabled ? 1 : 0.4)
    }

    /// The circle's side for a base side at the reference text size, grown a little with Dynamic Type (at most 1.3×).
    static func size(_ base: CGFloat, dynamicType: DynamicTypeSize) -> CGFloat {
        let grow: CGFloat = switch dynamicType {
        case ...DynamicTypeSize.large: 1
        case .xLarge: 1.06
        case .xxLarge: 1.12
        case .xxxLarge: 1.18
        default: 1.3
        }
        return (base * grow).rounded()
    }
}

/// A small caps section title.
struct TimerSectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Theme.ink3)
            .textCase(.uppercase)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The cards of presets, aligned ends and recents.
struct TimerCard: ViewModifier {
    var highlighted = false

    func body(content: Content) -> some View {
        content
            .background(Theme.panel.opacity(0.85), in: .rect(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16).strokeBorder(highlighted ? Theme.teal.opacity(0.5) : Theme.line, lineWidth: 1)
            }
    }
}

extension View {
    func timerCard(highlighted: Bool = false) -> some View {
        modifier(TimerCard(highlighted: highlighted))
    }
}

/// A plain button that dims while pressed, for cards.
struct CardButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
    }
}
