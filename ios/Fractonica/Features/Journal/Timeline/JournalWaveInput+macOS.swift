#if os(macOS)
import AppKit
import SwiftUI

/// The wave's mouse and trackpad input on the Mac: a transparent view over the canvas.
///
///     drag                move through time, with momentum
///     two-finger scroll   move through time (a mouse wheel too); with ⌘ it zooms
///     pinch               zoom about the pointer        smart zoom (two-finger double tap)   zoom in
///     click               open the entry under the pointer (a cluster zooms in until it comes apart)
///     double-click        zoom in there
struct JournalWaveInputSurface: NSViewRepresentable {
    let model: JournalWaveModel

    func makeNSView(context: Context) -> JournalWaveMouseView {
        let view = JournalWaveMouseView()
        view.model = model
        return view
    }

    func updateNSView(_ view: JournalWaveMouseView, context: Context) {
        view.model = model
    }
}

final class JournalWaveMouseView: NSView {
    weak var model: JournalWaveModel?

    private var downPoint: CGPoint?
    private var dragging = false
    private var samples: [(time: TimeInterval, y: CGFloat)] = []
    private var pendingClick: Task<Void, Never>?
    private var magnification: CGFloat = 1
    private var magnifyStart = CGPoint.zero
    private var tracking: NSTrackingArea?

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    private func point(_ event: NSEvent) -> CGPoint { convert(event.locationInWindow, from: nil) }

    override func mouseDown(with event: NSEvent) {
        let p = point(event)
        downPoint = p
        dragging = false
        samples = [(event.timestamp, p.y)]
        if event.clickCount >= 2 {
            pendingClick?.cancel()
            pendingClick = nil
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let model, let start = downPoint else { return }
        let p = point(event)
        if !dragging {
            guard hypot(p.x - start.x, p.y - start.y) > 3 else { return }
            dragging = true
            pendingClick?.cancel()
            model.panBegan()
            NSCursor.closedHand.set()
        }
        samples.append((event.timestamp, p.y))
        if samples.count > 8 { samples.removeFirst() }
        model.panChanged(p.y - start.y)
    }

    override func mouseUp(with event: NSEvent) {
        guard let model else { return }
        let p = point(event)
        defer { downPoint = nil }
        if dragging {
            dragging = false
            var v: CGFloat = 0
            if let a = samples.first, let b = samples.last, b.time - a.time > 0.02, event.timestamp - b.time < 0.09 {
                v = (b.y - a.y) / CGFloat(b.time - a.time)
            }
            model.panEnded(velocity: v)
            NSCursor.openHand.set()
            return
        }
        if event.clickCount >= 2 {
            model.doubleTap(at: p)
            return
        }
        // a click on an emoji opens it at once; elsewhere it waits in case it becomes a double-click
        if model.hits.badge(at: p, slop: 2) != nil {
            model.tap(at: p, touch: false)
            return
        }
        let delay = min(NSEvent.doubleClickInterval, 0.28)
        pendingClick?.cancel()
        pendingClick = Task { @MainActor [weak model] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            model?.tap(at: p, touch: false)
        }
    }

    override func scrollWheel(with event: NSEvent) {
        guard let model else { return }
        let p = point(event)
        let dy = event.hasPreciseScrollingDeltas ? event.scrollingDeltaY : event.scrollingDeltaY * 12
        if event.modifierFlags.contains(.command) {
            model.scrollZoom(dy * 0.006, atY: p.y)
        } else {
            model.scroll(dy: dy)
        }
    }

    override func magnify(with event: NSEvent) {
        guard let model else { return }
        let p = point(event)
        switch event.phase {
        case .began:
            magnification = 1
            magnifyStart = p
            model.pinchBegan()
        case .changed:
            magnification = max(0.02, magnification * (1 + event.magnification))
            model.pinchChanged(scale: magnification, y: p.y, startY: magnifyStart.y)
        case .ended, .cancelled:
            model.pinchEnded()
        default:
            break
        }
    }

    override func smartMagnify(with event: NSEvent) {
        model?.doubleTap(at: point(event))
    }

    override func mouseMoved(with event: NSEvent) {
        guard let model else { return }
        if model.hits.badge(at: point(event), slop: 2) != nil {
            NSCursor.pointingHand.set()
        } else {
            NSCursor.openHand.set()
        }
    }

    override func mouseExited(with event: NSEvent) {
        NSCursor.arrow.set()
    }
}
#endif
