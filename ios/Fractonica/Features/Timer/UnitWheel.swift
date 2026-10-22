import SwiftUI

/// A wheel of counts for one unit, as the system's duration picker but drawn in the app's own type and colours, so it
/// looks and behaves the same on iPhone, iPad and Mac: scroll or drag to a count (it snaps), tap a visible count, or
/// use the arrow keys (Mac, iPad keyboards) and VoiceOver's adjust gestures. The unit's letter sits beside the
/// selected row.
struct UnitWheel: View {
    @Binding var value: Int
    let range: ClosedRange<Int>
    /// "ι" or "min", beside the selected count.
    let symbol: String
    var color: Color = Theme.teal
    /// What VoiceOver calls it: "Preons".
    let label: String
    var rowHeight: CGFloat = 40
    var height: CGFloat = 200

    /// The wheel's frame, for measuring rows against the selection band.
    nonisolated static let space = "fx.timer.wheel"

    @State private var position: Int?
    @FocusState private var focused: Bool
    @Environment(AppSettings.self) private var settings

    init(value: Binding<Int>, range: ClosedRange<Int>, symbol: String, color: Color = Theme.teal, label: String,
         rowHeight: CGFloat = 40, height: CGFloat = 200) {
        _value = value
        self.range = range
        self.symbol = symbol
        self.color = color
        self.label = label
        self.rowHeight = rowHeight
        self.height = height
        _position = State(initialValue: value.wrappedValue)
    }

    var body: some View {
        HStack(alignment: .center, spacing: 4) {
            wheel
                .frame(width: rowHeight * 1.45)
            Text(symbol)
                .font(.system(size: rowHeight * 0.5, weight: .medium))
                .foregroundStyle(color)
                .frame(minWidth: rowHeight * 0.5, alignment: .leading)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue("\(value)")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: set(value + 1)
            case .decrement: set(value - 1)
            @unknown default: break
            }
        }
        .sensoryFeedback(.selection, trigger: value) { _, _ in settings.haptics }
    }

    private var wheel: some View {
        let rowHeight = rowHeight
        let height = height
        return ScrollViewReader { proxy in
        ScrollView(.vertical) {
            VStack(spacing: 0) {
                ForEach(range, id: \.self) { n in
                    Text(n < 10 ? "0\(n)" : "\(n)")
                        .font(.reading(rowHeight * 0.66, weight: n == value ? .medium : .light))
                        .foregroundStyle(n == value ? Theme.ink : Theme.ink2)
                        .frame(maxWidth: .infinity)
                        .frame(height: rowHeight)
                        .contentShape(.rect)
                        .onTapGesture { set(n) }
                        .visualEffect { content, proxy in
                            // distance from the selection band, in rows
                            let d = (proxy.frame(in: .named(UnitWheel.space)).midY - height / 2) / rowHeight
                            let a = min(abs(d), 3.2)
                            return content
                                .scaleEffect(1 - a * 0.07)
                                .opacity(1 - a * 0.27)
                                .rotation3DEffect(.degrees(Double(max(-3.2, min(3.2, d))) * -17), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
                        }
                }
            }
            .scrollTargetLayout()
        }
        .scrollPosition(id: $position, anchor: .center)
        .scrollTargetBehavior(.viewAligned)
        .safeAreaPadding(.vertical, (height - rowHeight) / 2)
        .scrollIndicators(.hidden)
        .scrollClipDisabled(false)
        .frame(height: height)
        .coordinateSpace(.named(UnitWheel.space))
        .mask {
            LinearGradient(stops: [
                .init(color: .clear, location: 0),
                .init(color: .black, location: 0.28),
                .init(color: .black, location: 0.72),
                .init(color: .clear, location: 1),
            ], startPoint: .top, endPoint: .bottom)
        }
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(.upArrow) { set(value - 1); return .handled }
        .onKeyPress(.downArrow) { set(value + 1); return .handled }
        .onAppear {
            proxy.scrollTo(value, anchor: .center)
            position = value
        }
        .onScrollGeometryChange(for: CGFloat.self, of: \.containerSize.height) { _, _ in
            // iOS 18 keeps the content offset, not the centred row, when the wheel changes size (its first layout is
            // narrower than the screen; a rotation lays it out anew) and ends at the top: centre the value again.
            proxy.scrollTo(value, anchor: .center)
        }
        .onChange(of: position) { _, new in
            if let new, new != value, range.contains(new) { value = new }
        }
        .onChange(of: value) { _, new in
            if position != new { withAnimation(.snappy) { position = new } }
        }
        }
    }

    private func set(_ n: Int) {
        let clamped = min(range.upperBound, max(range.lowerBound, n))
        guard clamped != value else { return }
        value = clamped
    }
}
