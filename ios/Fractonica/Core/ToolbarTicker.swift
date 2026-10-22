#if os(macOS)
import AppKit
import SwiftUI

/// A one-line reading of the displayed time for a macOS window toolbar, drawn by AppKit on the `ClockTimeline`
/// cadence (`ClockTickSchedule`) instead of through SwiftUI.
///
/// Every SwiftUI update inside a toolbar item makes SwiftUI rebuild the toolbar's platform items (their menu forms
/// for the overflow menu) and AppKit re-lay out the toolbar and update the window's constraints: a `ClockTimeline`
/// ticking at 30 Hz in the toolbar during a time-lapse cost ~30 % of a core with nothing else on screen. This view
/// changes nothing SwiftUI can see while it ticks: it redraws its own text, in a width it reserves for the widest text
/// seen so far, and goes quiet while its window is hidden, occluded or the clock is paused. SwiftUI only updates it
/// when the clock's base, the wording or the colour change.
struct ToolbarTicker: NSViewRepresentable {
    /// The displayed time as a function of real time (`ClockStore.base`), and whether it stands still.
    var base: ClockStore.TimeBase
    var paused: Bool
    /// The displayed time at a real instant (`ClockStore.time(at:)`, which also clamps it to the catalogue).
    var time: @MainActor (Date) -> Double
    /// Displayed seconds between redraws (`ClockCadence.periodic`).
    var interval: Double = 1
    var text: @MainActor (Double) -> String
    var font: NSFont = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
    var color: NSColor

    func makeNSView(context: Context) -> TickerView { TickerView() }

    func updateNSView(_ view: TickerView, context: Context) {
        view.configure(
            schedule: ClockTickSchedule(base: base, interval: interval, paused: paused),
            time: time, text: text, font: font, color: color
        )
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: TickerView, context: Context) -> CGSize? {
        nsView.reservedSize
    }

    /// Draws `text(t)` and schedules its next redraw at the next tick of the displayed time.
    final class TickerView: NSView {
        private var schedule = ClockTickSchedule(base: .live, interval: 1, paused: true)
        private var time: @MainActor (Date) -> Double = { $0.timeIntervalSince1970 }
        private var text: @MainActor (Double) -> String = { _ in "" }
        private var attributes: [NSAttributedString.Key: Any] = [:]
        private var current = NSAttributedString()
        private var timer: Timer?
        private var occlusionObserver: NSObjectProtocol?
        /// The widest text seen with the current font and wording; only grows until they change.
        private(set) var reservedSize = CGSize(width: 1, height: 1)

        override var isFlipped: Bool { true }

        func configure(schedule: ClockTickSchedule, time: @escaping @MainActor (Date) -> Double,
                       text: @escaping @MainActor (Double) -> String, font: NSFont, color: NSColor) {
            let restyled = attributes[.font] as? NSFont != font || attributes[.foregroundColor] as? NSColor != color
            self.schedule = schedule
            self.time = time
            self.text = text
            if restyled { attributes = [.font: font, .foregroundColor: color] }
            // A new wording or font may need less room: measure afresh.
            render(resetWidth: true)
            start()
        }

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let occlusionObserver { NotificationCenter.default.removeObserver(occlusionObserver) }
            occlusionObserver = nil
            if let window {
                occlusionObserver = NotificationCenter.default.addObserver(
                    forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated { self?.start() }
                }
            }
            start()
        }

        override func draw(_ dirtyRect: NSRect) {
            let size = current.size()
            current.draw(at: CGPoint(x: 0, y: ((bounds.height - size.height) / 2).rounded()))
        }

        // MARK: Accessibility: a static text whose value is the reading.

        override func isAccessibilityElement() -> Bool { true }
        override func accessibilityRole() -> NSAccessibility.Role? { .staticText }
        override func accessibilityValue() -> Any? { current.string }

        // MARK: Ticking

        private var isVisible: Bool {
            guard let window else { return false }
            return window.occlusionState.contains(.visible)
        }

        /// (Re)starts the redraws from now, or stops them while nothing would show them.
        private func start() {
            stop()
            guard isVisible else { return }
            render(resetWidth: false)
            scheduleNext()
        }

        private func stop() {
            timer?.invalidate()
            timer = nil
        }

        private func scheduleNext() {
            guard !schedule.paused, let next = schedule.tick(after: .now, lowFrequency: false) else { return }
            let timer = Timer(fire: next, interval: 0, repeats: false) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.render(resetWidth: false)
                    self.scheduleNext()
                }
            }
            // Live readouts tick on the second; a little tolerance lets the system coalesce wake-ups.
            timer.tolerance = min(0.02, max(0.002, next.timeIntervalSinceNow * 0.05))
            RunLoop.main.add(timer, forMode: .common)
            self.timer = timer
        }

        /// Draws the reading of now; asks SwiftUI for more room only when the text outgrows the reserved width.
        private func render(resetWidth: Bool) {
            let t = time(.now)
            let next = NSAttributedString(string: text(t), attributes: attributes)
            let needed = next.size()
            let size = CGSize(width: ceil(needed.width), height: ceil(needed.height))
            let grow = resetWidth ? size : CGSize(width: max(size.width, reservedSize.width), height: max(size.height, reservedSize.height))
            if next != current {
                current = next
                needsDisplay = true
            }
            if grow != reservedSize {
                reservedSize = grow
                invalidateIntrinsicContentSize()
            }
        }

        override var intrinsicContentSize: NSSize { reservedSize }
    }
}
#endif
