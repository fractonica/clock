import FractonicaKit
import SwiftUI

// How rare an entry is, drawn: a card's frame by its capture's rarity (MomentMath.swift) — a grey hairline for common
// entries, blue, purple, gold and red glowing borders for rare, epic, legendary and mythic, a slowly turning rainbow
// for cosmic — and a small badge. The hub's web page draws the same frames (hub/web/style.css).
//
//     .rarityFrame(for: record)                 // a timeline card (JournalCard), corner radius 22
//     .momentHeader(for: record)                // the detail view's header: the capture and its frame

extension MomentRarity {
    /// The rarity's colour (cosmic: the rainbow's first hue; `RarityStroke` draws the rainbow).
    var color: Color {
        switch self {
        case .common: Theme.ink3
        case .rare: Color(hue: 0.60, saturation: 0.72, brightness: 1.0)
        case .epic: Color(hue: 0.76, saturation: 0.62, brightness: 1.0)
        case .legendary: Theme.gold
        case .mythic: Color(hue: 0.995, saturation: 0.72, brightness: 1.0)
        case .cosmic: Color(hue: 0.48, saturation: 0.6, brightness: 1.0)
        }
    }

    /// The rainbow of cosmic frames.
    static let rainbow: [Color] = stride(from: 0.0, through: 1.0, by: 1.0 / 6).map { Color(hue: $0, saturation: 0.7, brightness: 1) }

    var symbol: String {
        switch self {
        case .common: "circle"
        case .rare: "diamond.fill"
        case .epic: "seal.fill"
        case .legendary: "crown.fill"
        case .mythic: "flame.fill"
        case .cosmic: "sparkles"
        }
    }

    /// The border's width and the glow around it.
    var lineWidth: CGFloat { self == .common ? 1 : self >= .legendary ? 2 : 1.5 }
    var glow: CGFloat {
        switch self {
        case .common: 0
        case .rare: 5
        case .epic: 7
        case .legendary, .mythic: 9
        case .cosmic: 10
        }
    }
}

extension View {
    /// A card's frame by the record's rarity: nothing for a common entry (its own hairline stays), a glowing border
    /// and a badge for a captured one.
    func rarityFrame(for record: HubRecord, cornerRadius: CGFloat = 22, badge: Bool = true) -> some View {
        modifier(RarityFrame(rarity: record.rarity, cornerRadius: cornerRadius, badge: badge))
    }

    /// The frame for a rarity, on anything. `turns` false keeps the cosmic rainbow still (a screen that stays open).
    func rarityFrame(_ rarity: MomentRarity, cornerRadius: CGFloat = 22, badge: Bool = false, turns: Bool = true) -> some View {
        modifier(RarityFrame(rarity: rarity, cornerRadius: cornerRadius, badge: badge, turns: turns))
    }

    /// The detail view's header: for a captured entry, the moment it captured and the rarity's frame around it.
    func momentHeader(for record: HubRecord) -> some View {
        modifier(MomentHeader(record: record))
    }
}

struct RarityFrame: ViewModifier {
    let rarity: MomentRarity
    var cornerRadius: CGFloat = 22
    var badge = false
    var turns = true

    func body(content: Content) -> some View {
        if rarity == .common {
            content
        } else {
            content
                .overlay {
                    RarityStroke(rarity: rarity, cornerRadius: cornerRadius, turns: turns)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                .overlay(alignment: .topTrailing) {
                    if badge {
                        // on the frame's top edge, like a tab: clear of the card's own title
                        RarityBadge(rarity: rarity, compact: true, solid: true)
                            .padding(.trailing, cornerRadius)
                            .offset(y: -9)
                            .allowsHitTesting(false)
                    }
                }
        }
    }
}

/// The border and its glow. Cosmic turns its rainbow slowly while it is on screen (unless Reduce Motion is on): a
/// hue rotation of this small layer only, so the list around it is never redrawn.
struct RarityStroke: View {
    let rarity: MomentRarity
    var cornerRadius: CGFloat = 22
    /// Cosmic turns its rainbow while on screen; false holds it still.
    var turns = true

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var turning = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        if rarity == .cosmic {
            shape
                .strokeBorder(AngularGradient(colors: MomentRarity.rainbow, center: .center), lineWidth: rarity.lineWidth + 0.5)
                .background(shape.stroke(AngularGradient(colors: MomentRarity.rainbow, center: .center), lineWidth: 3).blur(radius: rarity.glow * 0.8).opacity(0.75))
                .hueRotation(.degrees(turning ? 360 : 0))
                .onAppear {
                    guard turns, !reduceMotion else { return }
                    withAnimation(.linear(duration: 8).repeatForever(autoreverses: false)) { turning = true }
                }
                .onDisappear {
                    var t = Transaction()
                    t.disablesAnimations = true
                    withTransaction(t) { turning = false }
                }
        } else {
            shape
                .strokeBorder(rarity.color, lineWidth: rarity.lineWidth)
                .background(shape.stroke(rarity.color, lineWidth: 2).blur(radius: rarity.glow * 0.7).opacity(0.7))
        }
    }
}

/// "EPIC" with the rarity's symbol, in its colour (cosmic: the rainbow).
struct RarityBadge: View {
    let rarity: MomentRarity
    var compact = false
    /// On an edge: an opaque background, so the border does not show through.
    var solid = false

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: rarity.symbol)
                .font(.system(size: compact ? 9 : 11, weight: .bold))
            Text(rarity.title.uppercased())
                .font(.system(size: compact ? 9 : 11, weight: .heavy))
                .kerning(compact ? 0.8 : 1.1)
        }
        .foregroundStyle(rarity == .cosmic ? AnyShapeStyle(LinearGradient(colors: MomentRarity.rainbow, startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(rarity.color))
        .padding(.horizontal, compact ? 7 : 9)
        .padding(.vertical, compact ? 3 : 4)
        .background(rarity.color.opacity(0.14), in: .capsule)
        .background(solid ? Theme.background : .clear, in: .capsule)
        .overlay(Capsule().stroke(rarity.color.opacity(0.45), lineWidth: 0.5))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(rarity.title) moment")
    }
}

/// The detail header of a captured entry: the badge and the moment above the header, the frame around them.
private struct MomentHeader: ViewModifier {
    let record: HubRecord

    @Environment(AppSettings.self) private var settings

    func body(content: Content) -> some View {
        if let capture = record.capture {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    RarityBadge(rarity: capture.rarity)
                    // the moment led by its Pentad
                    Text.ledByPentad(Pentads.index(at: capture.at + 1e-3), Text(verbatim: captureName(capture)))
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                content
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel.opacity(0.7), in: .rect(cornerRadius: 22, style: .continuous))
            .rarityFrame(capture.rarity)
        } else {
            content
        }
    }

    /// "Delta Trifracton Node" when the capture is on a moment; its level and boundary otherwise.
    private func captureName(_ capture: MomentCapture) -> String {
        let calendar = MomentCalendar()
        if let q = calendar.index(near: capture.at), let m = calendar.moment(q), abs(m.time - capture.at) < 1 {
            return m.title(settings.wording.notation)
        }
        return [capture.momentLevel?.name ?? capture.level.capitalized, capture.momentBoundary?.word ?? capture.boundary].joined(separator: " ")
    }
}
