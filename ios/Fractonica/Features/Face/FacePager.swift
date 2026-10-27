import FractonicaKit
import SwiftUI

// How the Now screen moves: the faces side by side as pages (drag sideways, or the dots, the menu, ← →), a drag up or
// down on a stepping face steps its unit or depth, and a rail of letters beside it shows where the face stands on the
// ladder and jumps there with a tap or a scrub.

/// Pages side by side. A sideways drag pages between them (with a rubber band past the ends); an up or down drag steps
/// the face on the current page. A page out of sight is not drawn at all (a deep watch face would otherwise keep
/// redrawing offscreen): it comes back as soon as a drag or a page change brings it into view, and only its
/// neighbours are drawn while a drag is under way.
struct FacePager<Content: View>: View {
    /// 0 ..< count.
    let page: Int
    let count: Int
    let onPage: (Int) -> Void
    /// −1 longer (dragged down), +1 shorter (dragged up).
    let onStep: (Int) -> Void
    @ViewBuilder let content: (Int) -> Content

    @State private var dragX: CGFloat = 0
    @State private var nudgeY: CGFloat = 0
    @State private var axis: FaceSwipe.Axis?
    /// The page shown before the last change, kept drawn while it slides out.
    @State private var settled: Int?
    /// A released sideways drag is springing back into place: both pages stay drawn.
    @State private var springing = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            HStack(spacing: 0) {
                ForEach(0..<count, id: \.self) { i in
                    pageView(content(i), index: i, size: geo.size)
                }
            }
            .offset(x: -CGFloat(page) * w + dragX)
            .frame(width: w, height: geo.size.height, alignment: .leading)
            .contentShape(.rect)
            .gesture(drag(width: w))
        }
        .clipped()
        .onAppear { settled = page }
        .onChange(of: page) { _, new in
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(0.7))
                settled = new
            }
        }
    }

    private func pageView(_ content: some View, index: Int, size: CGSize) -> some View {
        let near = abs(index - page) <= 1 || abs(index - (settled ?? page)) <= 1
        let visible = index == page || index == (settled ?? page) || ((axis == .horizontal || springing) && near)
        return ZStack {
            if visible { content }
        }
        .offset(y: index == page ? nudgeY : 0)
        .frame(width: size.width, height: size.height)
        .allowsHitTesting(index == page)
        .accessibilityHidden(index != page)
    }

    private func drag(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                if axis == nil { axis = FaceSwipe.axis(of: value.translation) }
                switch axis {
                case .horizontal:
                    dragX = FaceSwipe.rubberBand(value.translation.width, page: page, count: count, width: width)
                case .vertical:
                    nudgeY = reduceMotion ? 0 : max(-12, min(12, value.translation.height * 0.12))
                case nil:
                    break
                }
            }
            .onEnded { value in
                defer { axis = nil }
                switch axis {
                case .horizontal:
                    let next = FaceSwipe.page(page, count: count, translation: value.translation.width,
                                              predicted: value.predictedEndTranslation.width, width: width)
                    springing = true
                    withAnimation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(duration: 0.42, bounce: 0.12)) {
                        dragX = 0
                        if next != page { onPage(next) }
                    } completion: {
                        springing = false
                    }
                case .vertical:
                    withAnimation(.spring(duration: 0.35, bounce: 0.3)) { nudgeY = 0 }
                    if let dir = FaceSwipe.step(translation: value.translation.height, predicted: value.predictedEndTranslation.height) {
                        onStep(dir)
                    }
                case nil:
                    break
                }
            }
    }
}

/// A dot for each face under the faces: which one shows; a tap switches.
struct PageDots: View {
    let page: Int
    let titles: [String]
    let onSelect: (Int) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(titles.indices, id: \.self) { i in
                Capsule()
                    .fill(i == page ? Theme.ink2 : Theme.ink3.opacity(0.45))
                    .frame(width: i == page ? 18 : 6, height: 6)
                    // a finger-sized target around a 6-point dot; the targets touch, never overlap
                    .frame(width: (i == page ? 18 : 6) + 12, height: 30)
                    .contentShape(.rect)
                    .onTapGesture { onSelect(i) }
                    .help(Text(verbatim: titles[i]))
            }
        }
        .animation(.smooth(duration: 0.3), value: page)
        .accessibilityElement()
        .accessibilityLabel(Text("Face"))
        .accessibilityValue(Text(titles[page]))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: onSelect(min(titles.count - 1, page + 1))
            case .decrement: onSelect(max(0, page - 1))
            @unknown default: break
            }
        }
    }
}

/// One letter of the rail.
struct RailItem: Identifiable, Equatable {
    enum State: Equatable { case lead, shown, off }

    let id: Int
    let level: Int
    let letter: String
    var state: State
}

/// The ladder beside a face: one letter per unit (journal) or depth (watch), the window the face shows lit in its
/// level colours over a soft capsule. Tap a letter, or scrub along the rail, to move the window there.
struct UnitRail: View {
    let items: [RailItem]
    /// What VoiceOver calls the rail ("Journal unit", "Watch depth").
    let title: String
    /// Larger beside a tall face.
    var scale: CGFloat = 1
    let onSelect: (Int) -> Void

    @ScaledMetric(relativeTo: .footnote) private var baseRow: CGFloat = 21
    private var row: CGFloat { baseRow * scale }
    @State private var scrubbing: Int?

    var body: some View {
        let lit = items.indices.filter { items[$0].state != .off }
        let lead = items.first { $0.state == .lead }
        ZStack(alignment: .top) {
            if let first = lit.first, let lead {
                Capsule()
                    .fill(Theme.levelColor(lead.level, opacity: 0.13))
                    .overlay { Capsule().strokeBorder(Theme.levelColor(lead.level, opacity: 0.25), lineWidth: 0.5) }
                    .frame(width: row * 1.25, height: row * CGFloat(lit.count))
                    .offset(y: row * CGFloat(first))
            }
            VStack(spacing: 0) {
                ForEach(items) { item in
                    Text(verbatim: item.letter)
                        .font((scale > 1.15 ? Font.body : .footnote).weight(item.state == .lead ? .bold : .medium))
                        .foregroundStyle(color(item))
                        .frame(width: row * 1.25, height: row)
                }
            }
        }
        .animation(.smooth(duration: 0.35), value: items)
        .frame(height: row * CGFloat(items.count), alignment: .top)
        .contentShape(.rect)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let i = min(items.count - 1, max(0, Int(value.location.y / row)))
                    if i != scrubbing {
                        scrubbing = i
                        onSelect(i)
                    }
                }
                .onEnded { _ in scrubbing = nil }
        )
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        .accessibilityElement()
        .accessibilityLabel(Text(title))
        .accessibilityValue(Text(items.filter { $0.state != .off }.map(\.letter).joined(separator: " ")))
        .accessibilityAdjustableAction { direction in
            guard let lead = items.firstIndex(where: { $0.state == .lead }) else { return }
            switch direction {
            case .increment: onSelect(max(0, lead - 1))
            case .decrement: onSelect(min(items.count - 1, lead + 1))
            @unknown default: break
            }
        }
    }

    private func color(_ item: RailItem) -> Color {
        switch item.state {
        case .lead: Theme.levelColor(item.level)
        case .shown: Theme.levelColor(item.level, opacity: 0.8)
        case .off: Theme.ink3.opacity(0.5)
        }
    }

    /// The journal's rail: α … ν, the face's window lit (a major period alone, three minor units together).
    static func journal(unit: Int) -> [RailItem] {
        let u = FaceStepper.clampUnit(unit)
        let major = Journal.units[u].level <= 3
        return Journal.units.enumerated().map { i, entry in
            let state: RailItem.State = i == u ? .lead : (!major && i > u && i <= u + 2) ? .shown : .off
            return RailItem(id: i, level: entry.level, letter: Fractonica.periodName(entry.level).letter, state: state)
        }
    }

    /// The watch's rail: depths 2 … 12 (β … μ), the two periods shown lit.
    static func watch(topDepth: Int) -> [RailItem] {
        let d = FaceStepper.clampDepth(topDepth)
        return (2...12).map { depth in
            let state: RailItem.State = depth == d ? .lead : depth == d + 1 ? .shown : .off
            return RailItem(id: depth, level: depth - 1, letter: Fractonica.periodName(depth - 1).letter, state: state)
        }
    }
}
