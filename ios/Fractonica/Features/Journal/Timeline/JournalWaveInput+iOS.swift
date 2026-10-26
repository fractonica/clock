#if os(iOS)
import SwiftUI
import UIKit

/// The wave's touch, trackpad and pointer input on iPhone and iPad: a transparent view over the canvas with UIKit
/// recognisers (the pinch centroid as it moves, flick velocity, trackpad scrolling).
///
///     drag            move through time, with momentum
///     pinch           zoom about the fingers (trackpad pinch too)
///     tap             open the entry under the finger (a cluster zooms in until it comes apart)
///     double tap      zoom in there          two-finger tap   zoom out
///     scroll          trackpad: move through time
struct JournalWaveInputSurface: UIViewRepresentable {
    let model: JournalWaveModel

    func makeUIView(context: Context) -> JournalWaveTouchView {
        let view = JournalWaveTouchView()
        view.model = model
        return view
    }

    func updateUIView(_ view: JournalWaveTouchView, context: Context) {
        view.model = model
    }
}

final class JournalWaveTouchView: UIView, UIGestureRecognizerDelegate {
    weak var model: JournalWaveModel?

    private let pan = UIPanGestureRecognizer()
    private let scrollPan = UIPanGestureRecognizer()
    private let pinch = UIPinchGestureRecognizer()
    private let tap = UITapGestureRecognizer()
    private let doubleTap = UITapGestureRecognizer()
    private let twoFingerTap = UITapGestureRecognizer()
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
        // a tap on an emoji opens it at once; elsewhere it waits to see whether it is a double tap
        tap.delegate = self
        twoFingerTap.addTarget(self, action: #selector(onTwoFingerTap(_:)))
        twoFingerTap.numberOfTouchesRequired = 2
        for r in [pan, scrollPan, pinch, tap, doubleTap, twoFingerTap] as [UIGestureRecognizer] {
            r.delegate = self
            addGestureRecognizer(r)
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func gestureRecognizer(_ a: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith b: UIGestureRecognizer) -> Bool {
        let pair: Set<ObjectIdentifier> = [ObjectIdentifier(a), ObjectIdentifier(b)]
        return pair == [ObjectIdentifier(pan), ObjectIdentifier(pinch)]
    }

    func gestureRecognizer(_ a: UIGestureRecognizer, shouldRequireFailureOf b: UIGestureRecognizer) -> Bool {
        // a single tap away from every emoji waits for the double tap; on an emoji it opens at once
        guard a === tap, b === doubleTap else { return false }
        return model?.hits.badge(at: a.location(in: self), slop: 8) == nil
    }

    @objc private func onPan(_ r: UIPanGestureRecognizer) {
        guard let model else { return }
        switch r.state {
        case .began:
            model.panBegan()
        case .changed:
            model.panChanged(r.translation(in: self).y)
        case .ended, .cancelled, .failed:
            model.panEnded(velocity: r.state == .ended ? r.velocity(in: self).y : 0)
        default:
            break
        }
    }

    @objc private func onPinch(_ r: UIPinchGestureRecognizer) {
        guard let model else { return }
        switch r.state {
        case .began:
            pinchStart = r.location(in: self)
            model.pinchBegan()
        case .changed:
            model.pinchChanged(scale: r.scale, y: r.location(in: self).y, startY: pinchStart.y)
        case .ended, .cancelled, .failed:
            model.pinchEnded()
            // a pan that goes on with the remaining finger starts afresh from here
            if pan.state == .changed || pan.state == .began {
                pan.setTranslation(.zero, in: self)
                model.restartPan()
            }
        default:
            break
        }
    }

    @objc private func onScroll(_ r: UIPanGestureRecognizer) {
        guard let model else { return }
        let t = r.translation(in: self)
        switch r.state {
        case .began:
            lastScroll = t
        case .changed:
            let dy = t.y - lastScroll.y
            lastScroll = t
            model.scroll(dy: dy)
        default:
            lastScroll = .zero
        }
    }

    @objc private func onTap(_ r: UITapGestureRecognizer) {
        model?.tap(at: r.location(in: self), touch: true)
    }

    @objc private func onDoubleTap(_ r: UITapGestureRecognizer) {
        model?.doubleTap(at: r.location(in: self))
    }

    @objc private func onTwoFingerTap(_ r: UITapGestureRecognizer) {
        model?.twoFingerTap(at: r.location(in: self))
    }
}
#endif
