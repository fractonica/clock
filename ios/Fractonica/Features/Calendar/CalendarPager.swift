import SwiftUI

/// Pages side by side that the person swipes through (a month, a Delta), with paging and momentum on iPhone, iPad and
/// the Mac trackpad. Only a window of pages around the current one exists in the scroll view; it re-centres when the
/// current page nears its end or jumps far, so ranges of thousands of pages stay light. `index` follows swipes and
/// moves the pager when it is set from outside.
struct CalendarPager<Page: View>: View {
    @Binding var index: Int
    let range: ClosedRange<Int>
    /// Called after a swipe (not after a change from outside).
    var onSwipe: () -> Void = {}
    @ViewBuilder let page: (Int) -> Page

    @State private var center: Int
    @State private var position: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static var reach: Int { 48 }

    init(index: Binding<Int>, range: ClosedRange<Int>, onSwipe: @escaping () -> Void = {}, @ViewBuilder page: @escaping (Int) -> Page) {
        _index = index
        self.range = range
        self.onSwipe = onSwipe
        self.page = page
        _center = State(initialValue: index.wrappedValue)
        _position = State(initialValue: index.wrappedValue)
    }

    var body: some View {
        let window = max(range.lowerBound, center - Self.reach)...min(range.upperBound, center + Self.reach)
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                ForEach(window, id: \.self) { i in
                    page(i)
                        .containerRelativeFrame(.horizontal)
                        .id(i)
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollIndicators(.hidden)
        .scrollPosition(id: $position)
        .onChange(of: index) { _, new in
            guard position != new else { return }
            let near = position.map { abs($0 - new) == 1 } ?? false
            if abs(new - center) > Self.reach - 8 { center = new }
            if near, !reduceMotion {
                withAnimation(.snappy) { position = new }
            } else {
                position = new
            }
        }
        .onChange(of: position) { _, p in
            guard let p, p != index else { return }
            index = p
            onSwipe()
        }
        .onScrollPhaseChange { _, phase in
            if phase == .idle, let p = position, abs(p - center) > Self.reach - 12 { center = p }
        }
    }
}
