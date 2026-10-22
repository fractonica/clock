import CoreText
import SwiftUI
#if os(iOS)
import UIKit
private typealias PlatformFont = UIFont
#else
import AppKit
private typealias PlatformFont = NSFont
#endif

/// Text for the timeline canvas: Core Text lines, laid out once and kept (a frame draws ~150 labels; laying each out
/// again every frame would cost milliseconds). Lines take their colour from the context, so one cached line serves
/// every colour.
@MainActor
final class TimelineText {
    static let shared = TimelineText()

    enum Face: Hashable {
        /// The system face.
        case ui
        /// Monospaced, for times and counts that sit in rows.
        case mono
    }

    struct Style: Hashable {
        let face: Face
        let size: CGFloat
        let weight: Int

        static func ui(_ size: CGFloat, _ weight: Int = 400) -> Style { Style(face: .ui, size: size, weight: weight) }
        static func mono(_ size: CGFloat, _ weight: Int = 400) -> Style { Style(face: .mono, size: size, weight: weight) }

        func scaled(_ s: CGFloat) -> Style { Style(face: face, size: (size * s * 2).rounded() / 2, weight: weight) }
    }

    /// A laid-out label.
    struct Line {
        let line: CTLine
        let width: CGFloat
        let ascent: CGFloat
        let descent: CGFloat
    }

    private struct Key: Hashable {
        let text: String
        let style: Style
    }

    private var lines: [Key: Line] = [:]
    private var fonts: [Style: CTFont] = [:]

    private func font(_ style: Style) -> CTFont {
        if let f = fonts[style] { return f }
        let weight: PlatformFont.Weight =
            switch style.weight {
            case ..<350: .light
            case ..<450: .regular
            case ..<550: .medium
            case ..<650: .semibold
            default: .bold
            }
        let f: PlatformFont =
            switch style.face {
            case .ui: .systemFont(ofSize: style.size, weight: weight)
            case .mono: .monospacedSystemFont(ofSize: style.size, weight: weight)
            }
        let ct = f as CTFont
        fonts[style] = ct
        return ct
    }

    func line(_ text: String, _ style: Style) -> Line {
        let key = Key(text: text, style: style)
        if let l = lines[key] { return l }
        if lines.count > 6000 { lines.removeAll(keepingCapacity: true) }
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font(style),
            NSAttributedString.Key(kCTForegroundColorFromContextAttributeName as String): true,
        ]
        let ct = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
        var ascent: CGFloat = 0, descent: CGFloat = 0, leading: CGFloat = 0
        let width = CGFloat(CTLineGetTypographicBounds(ct, &ascent, &descent, &leading))
        let l = Line(line: ct, width: width, ascent: ascent, descent: descent)
        lines[key] = l
        return l
    }

    func width(_ text: String, _ style: Style) -> CGFloat { line(text, style).width }

    /// The longest variant that fits in `room` points, or nil.
    func fit(_ variants: [String], _ style: Style, room: CGFloat) -> String? {
        variants.first { !$0.isEmpty && width($0, style) <= room }
    }
}

/// Drawing text into a Core Graphics context whose y axis points down (a Canvas's).
struct TimelineTextDrawing {
    enum Align { case left, center, right }

    let cg: CGContext
    let text: TimelineText

    /// Draws `s` with its vertical centre at y (cap-height centred), aligned at x; returns its width.
    @MainActor @discardableResult
    func draw(_ s: String, x: CGFloat, y: CGFloat, _ style: TimelineText.Style, _ color: CGColor, align: Align = .left) -> CGFloat {
        let l = text.line(s, style)
        let x0: CGFloat =
            switch align {
            case .left: x
            case .center: x - l.width / 2
            case .right: x - l.width
            }
        cg.setFillColor(color)
        cg.textPosition = CGPoint(x: x0, y: y + (l.ascent - l.descent) / 2 - 0.5)
        CTLineDraw(l.line, cg)
        return l.width
    }
}
