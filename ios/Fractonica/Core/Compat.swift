import SwiftUI
#if os(iOS)
import UIKit
#endif

// iOS 18 compatibility. The iOS app runs from iOS 18.6 (the Mac app from macOS 26): on iOS 26 and later, and always
// on the Mac, each wrapper here is exactly the Liquid Glass API it names; on iOS 18 it draws that system's own
// equivalent — a material in the same shape with a hairline, bordered buttons — so the screens look intentional there
// too.
//
// Never call an iOS 26-only API directly: use these (or add one here), or guard a one-off use with
// `if #available(iOS 26.0, macOS 26.0, *)` and give it an iOS 18 branch. The compiler refuses unguarded uses, but not
// SF Symbols newer than iOS 18 (they draw nothing there): check a new symbol's availability before using it.
//
//     .glassSurface(.regular.interactive(), in: .capsule)       // .glassEffect(.regular.interactive(), in: .capsule)
//     .glassButtonStyle()                                       // .buttonStyle(.glass)
//     GlassContainer(spacing: 10) { … }                         // GlassEffectContainer(spacing: 10) { … }
//     .sheetDetents([.medium, .large])                          // .presentationDetents([.medium, .large])

/// A Liquid Glass variant, spelled as `Glass` spells it (`.regular`, `.regular.tint(c)`, `.regular.interactive()`),
/// for `glassSurface(_:in:)`.
struct GlassStyle: Equatable, Sendable {
    /// The colour the glass takes (`Glass.tint`); on iOS 18 a wash over the material.
    var tint: Color?
    /// The glass reacts to touches (`Glass.interactive`); iOS 18 leaves that to the buttons inside.
    var isInteractive = false

    /// The standard glass.
    static let regular = GlassStyle()

    func tint(_ color: Color?) -> GlassStyle {
        var style = self
        style.tint = color
        return style
    }

    func interactive(_ isEnabled: Bool = true) -> GlassStyle {
        var style = self
        style.isInteractive = isEnabled
        return style
    }

    /// The `Glass` it stands for: built with the same calls the call sites made before the wrapper.
    @available(iOS 26.0, macOS 26.0, *)
    var glass: Glass {
        var glass = Glass.regular
        if let tint { glass = glass.tint(tint) }
        if isInteractive { glass = glass.interactive() }
        return glass
    }
}

extension View {
    /// Liquid Glass behind this view, in `shape` (`glassEffect(_:in:)`). iOS 18: a thin material in the same shape, the
    /// tint washed over it, and a hairline.
    @ViewBuilder
    func glassSurface(_ style: GlassStyle = .regular, in shape: some Shape) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            glassEffect(style.glass, in: shape)
        } else {
            background {
                ZStack {
                    shape.fill(.ultraThinMaterial)
                    if let tint = style.tint { shape.fill(tint) }
                    shape.stroke(Theme.line, lineWidth: 1)
                }
            }
        }
    }

    /// Ties this view's glass to its counterparts in other states, so the container morphs between them
    /// (`glassEffectID(_:in:)`). Nothing on iOS 18, where glass does not morph.
    @ViewBuilder
    func glassID(_ id: some Hashable & Sendable, in namespace: Namespace.ID) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            glassEffectID(id, in: namespace)
        } else {
            self
        }
    }

    /// A sheet's heights (`presentationDetents(_:)`). iPad on iOS 18 draws a medium detent as half of its form sheet,
    /// where only a few rows show: there a sheet that can be large opens large, as the whole form sheet.
    @ViewBuilder
    func sheetDetents(_ detents: Set<PresentationDetent>) -> some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            presentationDetents(detents)
        } else if UIDevice.current.userInterfaceIdiom == .pad, detents.contains(.large) {
            presentationDetents([.large])
        } else {
            presentationDetents(detents)
        }
        #else
        presentationDetents(detents)
        #endif
    }

    /// `.buttonStyle(.glass)`. iOS 18: `.bordered`, which takes the same `tint` and `buttonBorderShape`.
    @ViewBuilder
    func glassButtonStyle() -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            buttonStyle(.glass)
        } else {
            buttonStyle(.bordered)
        }
    }

    /// `.buttonStyle(.glassProminent)`. iOS 18: `.borderedProminent`, filled with the `tint` the same way.
    @ViewBuilder
    func glassProminentButtonStyle() -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            buttonStyle(.glassProminent)
        } else {
            buttonStyle(.borderedProminent)
        }
    }
}

/// Glass shapes that blend and morph into each other (`GlassEffectContainer`). iOS 18: the content as it is.
struct GlassContainer<Content: View>: View {
    var spacing: CGFloat?
    var content: Content

    init(spacing: CGFloat? = nil, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { content }
        } else {
            content
        }
    }
}

extension ButtonRole {
    /// `.confirm`: the button that confirms a sheet, drawn prominent. iOS 18 has no such role (a confirmation action is
    /// already set in bold there), so none.
    static var confirmIfAvailable: ButtonRole? {
        if #available(iOS 26.0, macOS 26.0, *) { .confirm } else { nil }
    }
}
