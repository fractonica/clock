import FractonicaKit
import SwiftUI

/// The floating controls under the timeline (Liquid Glass): zoom out · the width of the view (a menu of presets) ·
/// zoom in, the presets inline where they fit, "fit the selected cycle" and Follow.
struct TimelineControlBar: View {
    let controller: TimelineController
    let words: TimelineWords
    /// A column on the trailing side (a phone in landscape) instead of a row under the canvas.
    var vertical = false

    @Environment(AppSettings.self) private var settings
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var glass
    /// The bar's width, which picks its arrangement (measured once per size, not on every frame as ViewThatFits would).
    @State private var width: CGFloat = 0

    private var viewport: TimelineViewport { controller.viewport }

    var body: some View {
        let w = viewport.target
        let presets = controller.presets(pure: words.pure)
        let active = controller.activePreset(pure: words.pure, window: w)
        let strip = presets.filter(\.strip)
        // the inline presets need about this much room beside the zoom, fit and follow controls
        let stripWidth = strip.reduce(0) { $0 + max(34, CGFloat($1.label.count) * 9 + 20) + 2 }
        GlassEffectContainer(spacing: 10) {
            if vertical {
                VStack(spacing: 10) {
                    zoomCluster(w, presets: presets, active: active)
                    Spacer(minLength: 4)
                    fitButton(labelled: false)
                    followButton
                }
            } else {
                HStack(spacing: 10) {
                    zoomCluster(w, presets: presets, active: active)
                    // large text: the presets stay in the width's menu and Fit keeps to its icon
                    if width >= stripWidth + 330, !typeSize.isAccessibilitySize { presetStrip(strip, active: active) }
                    Spacer(minLength: 4)
                    fitButton(labelled: width >= 330 && !typeSize.isAccessibilitySize)
                    followButton
                }
            }
        }
        .frame(maxWidth: vertical ? nil : .infinity, maxHeight: vertical ? .infinity : nil)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .controlSize(.regular)
        // one row of glass under the canvas: it grows with Dynamic Type up to the first accessibility size
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }

    /// − · width · + (+ · width · − in a column), one glass capsule; the width opens every preset under the window's
    /// extent.
    private func zoomCluster(_ w: TimelineWindow, presets: [TimelineController.Preset], active: String?) -> some View {
        let lim = viewport.limits
        let plot = viewport.plotWidth
        let stack = vertical ? AnyLayout(VStackLayout(spacing: 0)) : AnyLayout(HStackLayout(spacing: 0))
        let zoomOut = Button {
            controller.zoom(by: 2)
        } label: {
            Image(systemName: "minus")
                .frame(width: vertical ? 44 : 40, height: 36)
                .contentShape(.rect)
        }
        .disabled(w.span >= lim.maxSpan * 0.999)
        .keyboardShortcut("-", modifiers: .command)
        .accessibilityLabel("Zoom out")
        .help("Zoom out (− or ⌘−)")
        let zoomIn = Button {
            controller.zoom(by: 0.5)
        } label: {
            Image(systemName: "plus")
                .frame(width: vertical ? 44 : 40, height: 36)
                .contentShape(.rect)
        }
        .disabled(w.span <= lim.minSpan * 1.001)
        .keyboardShortcut("+", modifiers: .command)
        .accessibilityLabel("Zoom in")
        .help("Zoom in (+ or ⌘+)")
        let divider = Rectangle().fill(Theme.line2).frame(width: vertical ? 22 : 1, height: vertical ? 1 : 18)
        return stack {
            if vertical { zoomIn } else { zoomOut }
            divider
            Menu {
                Section(windowText(w)) {
                    ForEach(presets.filter { !$0.calendar }) { p in presetItem(p, active: active) }
                }
                let calendar = presets.filter(\.calendar)
                if !calendar.isEmpty {
                    Section("Calendar") {
                        ForEach(calendar) { p in presetItem(p, active: active) }
                    }
                }
            } label: {
                widthLabel(w, plot: plot, chevron: !vertical)
            }
            .menuIndicator(.hidden)
            .accessibilityLabel("Zoom presets")
            .accessibilityValue("\(words.spanText(w, ruler: controller.data.ruler, plotWidth: plot)) across")
            .help("The width of the view; choose a preset")
            divider
            if vertical { zoomOut } else { zoomIn }
        }
        .buttonStyle(.plain)
        .font(.body.weight(.semibold))
        .foregroundStyle(Theme.ink)
        .glassEffect(.regular.interactive(), in: vertical ? AnyShape(.rect(cornerRadius: 22)) : AnyShape(.capsule))
        .glassEffectID("zoom", in: glass)
    }

    private func presetItem(_ p: TimelineController.Preset, active: String?) -> some View {
        Button {
            controller.apply(preset: p.id)
        } label: {
            if p.id == active {
                Label(p.title, systemImage: "checkmark")
            } else {
                Text(p.title)
            }
        }
    }

    /// The window's extent, the menu's heading: "Oct 7 12:00 → Oct 9 12:00 · 1 d 16 h across".
    private func windowText(_ w: TimelineWindow) -> String {
        let cursor = controller.store?.time() ?? w.c
        let refYear = words.pure ? 0 : words.earth.parts(cursor).year
        let unit = words.pure ? controller.data.ruler.pick(pxPerSec: viewport.plotWidth / w.span, plotWidth: viewport.plotWidth).u : TimelineRuler.iota
        return words.windowText(w, refYear: refYear, ruler: controller.data.ruler, rulerUnit: unit, plotWidth: viewport.plotWidth)
    }

    private func widthLabel(_ w: TimelineWindow, plot: Double, chevron: Bool) -> some View {
        let text = words.pure
            ? controller.data.ruler.spanText(w.t0, w.t1, parts: 1, slack: 0.5 / max(1, plot))
            : TimelineWords.widthText(w.span)
        return HStack(spacing: 4) {
            Text(text)
                .font(.subheadline.weight(.semibold).monospacedDigit())
                .contentTransition(.numericText())
                .lineLimit(1)
                .fixedSize()
            if chevron {
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .padding(.horizontal, vertical ? 4 : 10)
        .frame(minWidth: vertical ? 44 : 70, minHeight: 36)
        .contentShape(.rect)
    }

    /// The presets in a row, the active one lit.
    private func presetStrip(_ presets: [TimelineController.Preset], active: String?) -> some View {
        HStack(spacing: 2) {
            ForEach(presets) { p in
                Button {
                    controller.apply(preset: p.id)
                } label: {
                    Text(p.label)
                        .font(.subheadline.weight(p.id == active ? .semibold : .regular))
                        .foregroundStyle(p.id == active ? Theme.ink : Theme.ink2)
                        .padding(.horizontal, 10)
                        .frame(minWidth: 34, minHeight: 32)
                        .background {
                            if p.id == active {
                                Capsule().fill(Theme.teal.opacity(0.22))
                                    .overlay(Capsule().strokeBorder(Theme.teal.opacity(0.5), lineWidth: 1))
                            }
                        }
                        .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(p.title)
                .accessibilityAddTraits(p.id == active ? .isSelected : [])
                .help(p.title)
            }
        }
        .padding(2)
        .glassEffect(.regular.interactive(), in: .capsule)
        .glassEffectID("presets", in: glass)
        .animation(reduceMotion ? nil : .snappy(duration: 0.22), value: active)
    }

    private func fitButton(labelled: Bool) -> some View {
        let info = controller.data.clock.levelInfo(settings.selectedLevel)
        return Button {
            controller.fitSelected()
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "arrow.left.and.line.vertical.and.arrow.right")
                if labelled {
                    Text("Fit \(info.letter)")
                        .font(.subheadline.weight(.semibold))
                }
            }
            .padding(.horizontal, labelled ? 14 : 11)
            .frame(minHeight: 36)
            .foregroundStyle(Theme.levelColor(settings.selectedLevel, lightness: 0.78))
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .capsule)
        .glassEffectID("fit", in: glass)
        .accessibilityLabel("Fit the \(info.letter) cycle at the cursor")
        .help("Zoom to the cycle of the selected depth (\(info.letter)) at the cursor (F)")
    }

    private var followButton: some View {
        let on = viewport.follow
        return Button {
            controller.toggleFollow()
        } label: {
            Image(systemName: on ? "location.fill" : "location")
                .font(.body.weight(.semibold))
                .foregroundStyle(on ? Theme.teal : Theme.ink2)
                .frame(width: 40, height: 36)
                .contentShape(.capsule)
                .contentTransition(.symbolEffect(.replace))
        }
        .buttonStyle(.plain)
        .glassEffect(on ? .regular.tint(Theme.teal.opacity(0.25)).interactive() : .regular.interactive(), in: .capsule)
        .glassEffectID("follow", in: glass)
        .accessibilityLabel("Follow the cursor")
        .accessibilityValue(on ? "On" : "Off")
        .accessibilityAddTraits(on ? .isSelected : [])
        .help("Keep the cursor at the middle of the view while time runs. Dragging turns it off.")
    }
}
