#if os(iOS)
import SwiftUI
import UIKit

/// The timeline's touch, trackpad and pointer input on iPhone and iPad: a transparent view over the canvas with UIKit
/// recognisers, which give what SwiftUI gestures do not (the pinch centroid as it moves, flick velocity, trackpad
/// scrolling, two-finger taps, pointer hover).
///
///     drag            pan, with momentum (from the cursor flag: scrub the time; on the map: move the window)
///     pinch           zoom anchored at the fingers (trackpad pinch too)
///     tap             a block's read-out, a lane head selects its depth, the ruler moves the cursor
///     double tap      zoom in there          two-finger tap   zoom out
///     press and hold  inspect: a crosshair with the moment and every lane's cycle under the finger
///     scroll          trackpad / wheel: sideways pans, up and down zooms
///     hover           the pointer's crosshair (iPad pointer, Pencil hover)
struct TimelineInputSurface: UIViewRepresentable {
    let controller: TimelineController

    func makeUIView(context: Context) -> TimelineTouchView {
        let view = TimelineTouchView()
        view.controller = controller
        return view
    }

    func updateUIView(_ view: TimelineTouchView, context: Context) {
        view.controller = controller
    }
}

final class TimelineTouchView: UIView, UIGestureRecognizerDelegate {
    weak var controller: TimelineController?

    private let pan = UIPanGestureRecognizer()
    private let scrollPan = UIPanGestureRecognizer()
    private let pinch = UIPinchGestureRecognizer()
    private let tap = UITapGestureRecognizer()
    private let doubleTap = UITapGestureRecognizer()
    private let twoFingerTap = UITapGestureRecognizer()
    private let press = UILongPressGestureRecognizer()
    private let hoverRecognizer = UIHoverGestureRecognizer()
    private var panStart = CGPoint.zero
    private var pinchStart = CGPoint.zero
    private var lastScroll = CGPoint.zero

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isMultipleTouchEnabled = true
        isAccessibilityElement = false

        pan.addTarget(self, action: #selector(onPan(_:)))
        pan.maximumNumberOfTouches = 2
        pan.allowedScrollTypesMask = []
        scrollPan.addTarget(self, action: #selector(onScroll(_:)))
        scrollPan.allowedScrollTypesMask = .all
        scrollPan.allowedTouchTypes = []
        pinch.addTarget(self, action: #selector(onPinch(_:)))
        tap.addTarget(self, action: #selector(onTap(_:)))
        doubleTap.addTarget(self, action: #selector(onDoubleTap(_:)))
        doubleTap.numberOfTapsRequired = 2
        tap.require(toFail: doubleTap)
        twoFingerTap.addTarget(self, action: #selector(onTwoFingerTap(_:)))
        twoFingerTap.numberOfTouchesRequired = 2
        press.addTarget(self, action: #selector(onPress(_:)))
        press.minimumPressDuration = 0.32
        hoverRecognizer.addTarget(self, action: #selector(onHover(_:)))
        for r in [pan, scrollPan, pinch, tap, doubleTap, twoFingerTap, press, hoverRecognizer] as [UIGestureRecognizer] {
            r.delegate = self
            addGestureRecognizer(r)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func gestureRecognizer(_ a: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith b: UIGestureRecognizer) -> Bool {
        let pair: Set<ObjectIdentifier> = [ObjectIdentifier(a), ObjectIdentifier(b)]
        if pair == [ObjectIdentifier(pan), ObjectIdentifier(pinch)] { return true }
        return a === hoverRecognizer || b === hoverRecognizer
    }

    @objc private func onPan(_ r: UIPanGestureRecognizer) {
        guard let controller else { return }
        switch r.state {
        case .began:
            let t = r.translation(in: self)
            let p = r.location(in: self)
            panStart = CGPoint(x: p.x - t.x, y: p.y - t.y)
            controller.panBegan(at: panStart, touch: true)
        case .changed:
            let t = r.translation(in: self)
            controller.panChanged(translation: CGSize(width: t.x, height: t.y), location: r.location(in: self))
        case .ended, .cancelled, .failed:
            let v = r.velocity(in: self)
            controller.panEnded(velocity: r.state == .ended ? CGSize(width: v.x, height: v.y) : .zero)
        default:
            break
        }
    }

    @objc private func onPinch(_ r: UIPinchGestureRecognizer) {
        guard let controller else { return }
        switch r.state {
        case .began:
            pinchStart = r.location(in: self)
            controller.pinchBegan()
        case .changed:
            controller.pinchChanged(scale: r.scale, location: r.location(in: self), start: pinchStart)
        case .ended, .cancelled, .failed:
            controller.pinchEnded()
            // a pan that goes on with the remaining finger starts afresh from here
            if pan.state == .changed || pan.state == .began { pan.setTranslation(.zero, in: self) }
        default:
            break
        }
    }

    @objc private func onScroll(_ r: UIPanGestureRecognizer) {
        guard let controller else { return }
        let t = r.translation(in: self)
        switch r.state {
        case .began:
            lastScroll = t
        case .changed:
            let dx = t.x - lastScroll.x, dy = t.y - lastScroll.y
            lastScroll = t
            // content follows the fingers: fingers to the left show later times; fingers up zoom out
            controller.scroll(dx: -dx, dy: -dy, at: r.location(in: self), precise: true)
        default:
            lastScroll = .zero
        }
    }

    @objc private func onTap(_ r: UITapGestureRecognizer) {
        controller?.tap(at: r.location(in: self), touch: true)
    }

    @objc private func onDoubleTap(_ r: UITapGestureRecognizer) {
        controller?.doubleTap(at: r.location(in: self))
    }

    @objc private func onTwoFingerTap(_ r: UITapGestureRecognizer) {
        controller?.twoFingerTap(at: r.location(in: self))
    }

    @objc private func onPress(_ r: UILongPressGestureRecognizer) {
        guard let controller else { return }
        switch r.state {
        case .began:
            Haptics.play(.selection)
            controller.inspect(at: r.location(in: self), touch: true)
        case .changed:
            controller.inspect(at: r.location(in: self), touch: true)
        default:
            controller.inspect(at: nil, touch: true)
        }
    }

    @objc private func onHover(_ r: UIHoverGestureRecognizer) {
        guard let controller else { return }
        switch r.state {
        case .began, .changed: controller.inspect(at: r.location(in: self), touch: false)
        default: controller.inspect(at: nil, touch: false)
        }
    }
}
#endif
