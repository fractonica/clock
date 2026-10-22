#if os(macOS)
import AppKit

/// Mac: the scroll wheel over the stage (src/ui/wave.js, the canvas `wheel` handler). A mouse wheel, or any scroll with
/// ⌘ or ⌃ held, changes the depth: small deltas add up, a pause or a change of direction starts over, and steps come at
/// most every 230 ms. A trackpad's two-finger scroll pans the view, like a map.
@MainActor
final class WaveWheel {
    /// The pointer is over the stage (the stage's hover sets it): only then does the wheel belong to the wave.
    var hovering = false
    /// One depth deeper (+1) or out (−1).
    var zoom: (Int) -> Void = { _ in }
    /// Points to move the view by.
    var pan: (Double, Double) -> Void = { _, _ in }

    private var monitor: Any?
    private var acc = 0.0
    private var last = -Double.infinity
    private var stepped = -Double.infinity

    func start() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
            let used = MainActor.assumeIsolated { self?.handle(event) ?? false }
            return used ? nil : event
        }
    }

    func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        hovering = false
    }

    private func handle(_ event: NSEvent) -> Bool {
        guard hovering else { return false }
        let precise = event.hasPreciseScrollingDeltas
        let modified = !event.modifierFlags.intersection([.command, .control]).isEmpty
        guard modified || !precise else {
            pan(event.scrollingDeltaX, event.scrollingDeltaY)
            return true
        }
        // web sign: negative (wheel up, away from you) zooms in; a notch of a mouse wheel is one step
        let d = -event.scrollingDeltaY * (precise ? 1 : 48)
        guard d != 0 else { return true }
        let step = WaveWheelSteps.next(acc: acc, last: last, stepped: stepped, delta: d, now: event.timestamp)
        acc = step.acc
        last = event.timestamp
        if let dir = step.zoom {
            stepped = event.timestamp
            zoom(dir)
        }
        return true
    }
}
#endif

/// The wheel's arithmetic (src/ui/wave.js): deltas add up until they reach 48 points, a pause of 260 ms or a change of
/// direction starts over, and a step comes at most every 230 ms. Times in seconds.
enum WaveWheelSteps {
    static func next(acc: Double, last: Double, stepped: Double, delta: Double, now: Double) -> (acc: Double, zoom: Int?) {
        var acc = acc
        if now - last > 0.26 || (acc != 0 && (delta > 0) != (acc > 0)) { acc = 0 }
        acc += delta
        guard abs(acc) >= 48, now - stepped > 0.23 else { return (acc, nil) }
        return (0, acc < 0 ? 1 : -1)
    }
}
