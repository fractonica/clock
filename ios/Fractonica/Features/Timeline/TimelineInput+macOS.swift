#if os(macOS)
import AppKit
import SwiftUI

/// The timeline's mouse and trackpad input on the Mac: a transparent view over the canvas.
///
///     drag            pan, with momentum (from the cursor flag: scrub the time; on the map: move the window)
///     two-finger scroll   sideways pans, up and down zooms (a mouse wheel zooms; ⇧ + wheel pans)
///     pinch           zoom about the pointer        smart zoom (two-finger double tap)   zoom out
///     click           a block's read-out, a lane head selects its depth, the ruler moves the cursor
///     double-click    zoom in there
///     hover           the pointer's crosshair with the moment and every lane's cycle under it
struct TimelineInputSurface: NSViewRepresentable {
    let controller: TimelineController

    func makeNSView(context: Context) -> TimelineMouseView {
        let view = TimelineMouseView()
        view.controller = controller
        return view
    }

    func updateNSView(_ view: TimelineMouseView, context: Context) {
        view.controller = controller
    }
}

final class TimelineMouseView: NSView {
    weak var controller: TimelineController?

    private var downPoint: CGPoint?
    private var dragging = false
    private var samples: [(time: TimeInterval, x: CGFloat)] = []
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
        samples = [(event.timestamp, p.x)]
        if event.clickCount >= 2 {
            pendingClick?.cancel()
            pendingClick = nil
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let controller, let start = downPoint else { return }
        let p = point(event)
        if !dragging {
            guard hypot(p.x - start.x, p.y - start.y) > 3 else { return }
            dragging = true
            pendingClick?.cancel()
            controller.inspect(at: nil, touch: false)
            controller.panBegan(at: start, touch: false)
            NSCursor.closedHand.set()
        }
        samples.append((event.timestamp, p.x))
        if samples.count > 8 { samples.removeFirst() }
        controller.panChanged(translation: CGSize(width: p.x - start.x, height: p.y - start.y), location: p)
    }

    override func mouseUp(with event: NSEvent) {
        guard let controller else { return }
        let p = point(event)
        defer { downPoint = nil }
        if dragging {
            dragging = false
            var v: CGFloat = 0
            if let a = samples.first, let b = samples.last, b.time - a.time > 0.02, event.timestamp - b.time < 0.09 {
                v = (b.x - a.x) / CGFloat(b.time - a.time)
            }
            controller.panEnded(velocity: CGSize(width: v, height: 0))
            NSCursor.arrow.set()
            controller.inspect(at: p, touch: false)
            return
        }
        if event.clickCount >= 2 {
            controller.doubleTap(at: p)
            return
        }
        // a single click waits briefly in case it becomes a double-click (which zooms instead)
        let delay = min(NSEvent.doubleClickInterval, 0.28)
        pendingClick?.cancel()
        pendingClick = Task { @MainActor [weak controller] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            controller?.tap(at: p, touch: false)
        }
    }

    override func scrollWheel(with event: NSEvent) {
        guard let controller else { return }
        let p = point(event)
        if event.hasPreciseScrollingDeltas {
            // content follows the fingers: fingers to the left show later times, fingers up zoom out
            controller.scroll(dx: -event.scrollingDeltaX, dy: -event.scrollingDeltaY, at: p, precise: true)
        } else {
            controller.scroll(dx: -event.scrollingDeltaX * 24, dy: -event.scrollingDeltaY * 24, at: p, precise: false)
        }
    }

    override func magnify(with event: NSEvent) {
        guard let controller else { return }
        let p = point(event)
        switch event.phase {
        case .began:
            magnification = 1
            magnifyStart = p
            controller.pinchBegan()
        case .changed:
            magnification = max(0.02, magnification * (1 + event.magnification))
            controller.pinchChanged(scale: magnification, location: p, start: magnifyStart)
        case .ended, .cancelled:
            controller.pinchEnded()
        default:
            break
        }
    }

    override func smartMagnify(with event: NSEvent) {
        controller?.twoFingerTap(at: point(event))
    }

    override func mouseMoved(with event: NSEvent) {
        guard let controller else { return }
        let p = point(event)
        controller.inspect(at: p, touch: false)
        if let layout = controller.layout, p.x < layout.px0 || controller.hits.chip(at: p, slop: 0) != nil {
            NSCursor.pointingHand.set()
        } else if let flag = controller.hits.cursorFlag, flag.contains(p) {
            NSCursor.resizeLeftRight.set()
        } else {
            NSCursor.crosshair.set()
        }
    }

    override func mouseExited(with event: NSEvent) {
        controller?.inspect(at: nil, touch: false)
        NSCursor.arrow.set()
    }
}
#endif
