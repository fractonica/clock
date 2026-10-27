import FractonicaKit
import SwiftUI

// The short form of a Pentad as the apps and widgets draw it (SPEC §7.5): the Helion count as a shape, a pentagon with
// the numeral for Pentads I–III, a square alone for the Hypopentad. Never the "⬠" character, which only Apple Symbols
// draws: the shapes are the SF Symbols `pentagon` and `square` where text flows (they take the line's font, size and
// colour), and `PentadPolygon` where a view draws them at its own size.
//
//   PentadMark(index: 1)                                    "⬠II" as a view, read "Pentad II" by VoiceOver
//   Text("\(Text.pentadMark(1)) \(Text(verbatim: "44η 15ι"))")  inline in a line of text
//   Text.ledByPentad(1, Text(verbatim: "44η 15ι"))          the same: a reading led by its Pentad
//   PentadBadge(index: 1, size: 22)                         the shape with the numeral inside (cards, diagrams)
//
// Compiled into the apps and the widget extensions.

/// A Pentad's shape and numeral in the line's font: "⬠II", a square alone for the Hypopentad.
struct PentadMark: View {
    let index: Int

    var body: some View {
        Text.pentadMark(index)
    }
}

extension Text {
    /// A Pentad's shape and numeral as text, to flow in a line in its font and colour; VoiceOver reads its name.
    static func pentadMark(_ index: Int) -> Text {
        let i = min(max(index, 0), 3)
        let shape = Text(Image(systemName: i == 3 ? "square" : "pentagon"))
        let numeral = Notation.pentadNumerals[i]
        let mark = numeral.isEmpty ? shape : Text("\(shape)\(Text(verbatim: "\u{200A}" + numeral))")
        return mark.accessibilityLabel(Text(verbatim: PentadWords.spoken(i)))
    }

    /// A reading led by its Pentad's mark, as a date by its weekday: "⬠II 44η 15ι". Without a Pentad (outside the
    /// catalogue) the reading alone.
    static func ledByPentad(_ index: Int?, _ reading: Text, separator: String = " ") -> Text {
        guard let index else { return reading }
        return Text("\(pentadMark(index))\(Text(verbatim: separator))\(reading)")
    }

    /// A plain reading led by the Pentad running at t.
    static func ledByPentad(at t: Double, _ reading: String, separator: String = " ") -> Text {
        ledByPentad(Pentads.index(at: t), Text(verbatim: reading), separator: separator)
    }
}

/// A regular polygon standing on a flat side: five sides for a Pentad, four (a square) for the Hypopentad.
struct PentadPolygon: InsettableShape {
    var sides: Int
    var inset: CGFloat = 0

    init(sides: Int) {
        self.sides = sides
    }

    /// The shape of Pentad `index`: a pentagon, or the Hypopentad's square.
    init(index: Int) {
        sides = index == 3 ? 4 : 5
    }

    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: inset, dy: inset)
        guard r.width > 0, r.height > 0 else { return Path() }
        if sides == 4 {
            // the square a little smaller than its box, so it weighs about what the pentagon does
            let side = min(r.width, r.height) * 0.84
            return Path(CGRect(x: r.midX - side / 2, y: r.midY - side / 2, width: side, height: side))
        }
        // a regular pentagon, point up, fitted to the box: its height is (1 + cos 36°)·R, its width 2·sin 72°·R
        let n = Double(sides)
        let radius = min(r.width / (2 * sin(2 * .pi / n)), r.height / (1 + cos(.pi / n)))
        let height = radius * (1 + cos(.pi / n))
        let centre = CGPoint(x: r.midX, y: r.midY - height / 2 + radius)
        var path = Path()
        for k in 0..<sides {
            let angle = -Double.pi / 2 + Double(k) * 2 * .pi / n
            let p = CGPoint(x: centre.x + radius * cos(angle), y: centre.y + radius * sin(angle))
            if k == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }

    func inset(by amount: CGFloat) -> PentadPolygon {
        var shape = self
        shape.inset += amount
        return shape
    }
}

/// A Pentad's shape with its numeral inside, at a size of its own (the Pentad card, the explainer's diagram).
struct PentadBadge: View {
    let index: Int
    var size: CGFloat = 22
    var color: Color = Theme.gold
    /// Filled (the running Pentad) or outlined.
    var filled = false

    var body: some View {
        let i = min(max(index, 0), 3)
        ZStack {
            if filled {
                PentadPolygon(index: i).fill(color)
            } else {
                PentadPolygon(index: i).strokeBorder(color, style: StrokeStyle(lineWidth: max(1, size / 14), lineJoin: .round))
            }
            Text(verbatim: Notation.pentadNumerals[i])
                .font(.system(size: size * (i == 2 ? 0.3 : 0.36), weight: .semibold, design: .serif))
                .foregroundStyle(filled ? Theme.background : color)
                .offset(y: size * 0.05)
        }
        .frame(width: size, height: size)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: PentadWords.spoken(i)))
    }
}
