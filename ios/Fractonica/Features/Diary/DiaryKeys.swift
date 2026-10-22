#if os(macOS)
import AppKit
import SwiftUI

/// The Mac's page keys for the diary: ← → turn the pages (a spread at a time in the open book), Page Up / Page Down
/// too, Home and End go to the first and last page.
///
/// A bare-key `keyboardShortcut` on a button would take the arrows away from the text fields of the options inspector
/// (margins, the place, the zone search), so the keys are read here instead: from the diary's own window only, never
/// while a text field is being edited, a sheet is up or a modifier is held, and only while the diary is on screen.
struct DiaryKeys: NSViewRepresentable {
    let model: DiaryModel

    func makeNSView(context: Context) -> KeyView {
        let view = KeyView()
        view.model = model
        return view
    }

    func updateNSView(_ view: KeyView, context: Context) {
        view.model = model
    }

    static func dismantleNSView(_ view: KeyView, coordinator: ()) {
        view.stop()
    }

    final class KeyView: NSView {
        var model: DiaryModel?
        private var monitor: Any?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, self.handle(event) else { return event }
                return nil
            }
        }

        func stop() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }

        /// True when the key turned a page.
        private func handle(_ event: NSEvent) -> Bool {
            guard let model, let window, event.window === window, window.attachedSheet == nil, !isHiddenOrHasHiddenAncestor,
                  event.modifierFlags.intersection([.command, .option, .control, .shift]).isEmpty else { return false }
            // a text field or text view being edited keeps its keys
            if window.firstResponder is NSText || window.firstResponder is NSTextView { return false }
            let count = model.plan?.pages.count ?? 0
            guard count > 0 else { return false }
            switch Int(event.keyCode) {
            case 123, 116: model.step(-1) // ← , Page Up
            case 124, 121: model.step(1) // → , Page Down
            case 115: model.go(to: 1) // Home
            case 119: model.go(to: count) // End
            default: return false
            }
            return true
        }
    }
}
#endif
