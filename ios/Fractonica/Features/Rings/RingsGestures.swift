import SwiftUI

// Touch gestures that live inside a scrolling page on iOS (UIKit recognizers through UIGestureRecognizerRepresentable):
// a drag that only starts when it moves the right way (around a ring, along the wave) and otherwise leaves the touch
// to the page's scroll; a tap and a touch-and-hold that report where they happened. macOS uses SwiftUI's own
// gestures (a pointer never scrolls a page by dragging).

/// The phase of a drag.
enum DragStep {
    case began, changed, ended, cancelled
}

#if os(iOS)
import UIKit

/// A pan that begins only when `shouldBegin(start, translation)` agrees; the page's scroll waits for it to decide.
struct DirectionalPanGesture: UIGestureRecognizerRepresentable {
    var shouldBegin: (CGPoint, CGSize) -> Bool
    var onChange: (DragStep, CGPoint) -> Void

    @MainActor
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        let converter: CoordinateSpaceConverter
        var shouldBegin: (CGPoint, CGSize) -> Bool

        init(converter: CoordinateSpaceConverter, shouldBegin: @escaping (CGPoint, CGSize) -> Bool) {
            self.converter = converter
            self.shouldBegin = shouldBegin
        }

        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let translation = converter.localTranslation else { return false }
            let location = converter.localLocation
            let start = CGPoint(x: location.x - translation.x, y: location.y - translation.y)
            return shouldBegin(start, CGSize(width: translation.x, height: translation.y))
        }

        /// A scroll view's pan waits until this drag has decided whether it is one.
        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            other.view is UIScrollView && other is UIPanGestureRecognizer
        }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator(converter: converter, shouldBegin: shouldBegin)
    }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let recognizer = UIPanGestureRecognizer()
        recognizer.maximumNumberOfTouches = 1
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        context.coordinator.shouldBegin = shouldBegin
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let location = context.converter.localLocation
        switch recognizer.state {
        case .began: onChange(.began, location)
        case .changed: onChange(.changed, location)
        case .ended: onChange(.ended, location)
        case .cancelled, .failed: onChange(.cancelled, location)
        default: break
        }
    }
}

/// A tap that reports where it landed.
struct LocatedTapGesture: UIGestureRecognizerRepresentable {
    var action: (CGPoint) -> Void

    func makeUIGestureRecognizer(context: Context) -> UITapGestureRecognizer {
        let recognizer = UITapGestureRecognizer()
        // buttons inside the view (the read-out's) still get their touches
        recognizer.cancelsTouchesInView = false
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: UITapGestureRecognizer, context: Context) {
        if recognizer.state == .ended { action(context.converter.localLocation) }
    }
}

/// A touch held still that reports where it is held.
struct LocatedLongPressGesture: UIGestureRecognizerRepresentable {
    var minimumDuration: Double = 0.45
    var action: (CGPoint) -> Void

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let recognizer = UILongPressGestureRecognizer()
        recognizer.minimumPressDuration = minimumDuration
        recognizer.cancelsTouchesInView = false
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        if recognizer.state == .began { action(context.converter.localLocation) }
    }
}
#endif
