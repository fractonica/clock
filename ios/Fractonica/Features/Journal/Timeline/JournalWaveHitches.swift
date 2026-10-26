import Foundation
import QuartzCore
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// `-FXJournalWaveHitches 1` (debug builds): measures how smoothly the journal's wave moves, the way the Ladder's probe
/// does. It sweeps the wave without touches — three screens down and back over 6 s, then zooms out about nine times and
/// back over the next 6 s, and again — and once a real second prints to standard error the frames drawn and missed, the
/// main thread's busy time and its longest run-loop pass; after the first three seconds a running summary. `stack`
/// sweeps the Journal's stack (its list) instead.
///
///     xcrun simctl launch --console <device> app.fractonica.clock -FXTab journal -FXJournalMode wave \
///         -FXJournalSeed wide -FXJournalWaveHitches 1 | grep hitches
@MainActor
final class JournalWaveHitches: NSObject {
    private static var running: JournalWaveHitches?

    /// Starts measuring when the launch arguments ask for it (once).
    static func startIfAsked(_ model: JournalWaveModel?) {
        #if DEBUG
        guard running == nil, let mode = JournalLaunch.string("FXJournalWaveHitches"), mode != "0" else { return }
        let probe = JournalWaveHitches(model: mode == "stack" ? nil : model)
        running = probe
        probe.start()
        #endif
    }

    private struct Second {
        var frames = 0
        var missed = 0
        var busy: CFTimeInterval = 0
        var longest: CFTimeInterval = 0
    }

    private weak var model: JournalWaveModel?
    private var second = Second()
    private var total = Second()
    private var seconds = 0
    private var lastFrame: CFTimeInterval = 0
    private var secondStart: CFTimeInterval = 0
    private var sweepStart: CFTimeInterval = 0
    private var passStart: CFTimeInterval = 0
    private var observer: CFRunLoopObserver?
    private var link: CADisplayLink?
    private var startFrame: JournalWaveFrame?

    private init(model: JournalWaveModel?) {
        self.model = model
    }

    private func start() {
        let activities = CFRunLoopActivity.afterWaiting.rawValue | CFRunLoopActivity.beforeWaiting.rawValue
        observer = CFRunLoopObserverCreateWithHandler(nil, activities, true, Int.max) { [weak self] _, activity in
            MainActor.assumeIsolated { self?.pass(activity) }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        #if os(iOS)
        let link = CADisplayLink(target: self, selector: #selector(frame(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
        #else
        guard let link = NSScreen.main?.displayLink(target: self, selector: #selector(frame(_:))) else { return }
        #endif
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    private func pass(_ activity: CFRunLoopActivity) {
        let now = CACurrentMediaTime()
        if activity == .afterWaiting {
            passStart = now
            return
        }
        guard passStart > 0 else { return }
        let length = now - passStart
        passStart = 0
        second.busy += length
        second.longest = max(second.longest, length)
    }

    @objc private func frame(_ link: CADisplayLink) {
        let now = link.timestamp
        if lastFrame > 0 {
            let interval = max(1.0 / 120, link.targetTimestamp - link.timestamp)
            second.frames += 1
            second.missed += max(0, Int(((now - lastFrame) / interval).rounded()) - 1)
        } else {
            secondStart = now
            sweepStart = now
        }
        lastFrame = now
        sweep(now - sweepStart)
        guard now - secondStart >= 1 else { return }
        report()
        secondStart = now
    }

    private func sweep(_ elapsed: CFTimeInterval) {
        // the first second is the launch: start sweeping after it
        guard elapsed > 1 else { return }
        if let model {
            if startFrame == nil { startFrame = model.frame(at: .now) }
            if let startFrame { model.sweep(elapsed: elapsed - 1, from: startFrame) }
            return
        }
        #if os(iOS)
        guard let list = Self.scrollView() else { return }
        let inset = list.adjustedContentInset
        let range = max(0, list.contentSize.height + inset.top + inset.bottom - list.bounds.height)
        list.contentOffset.y = -inset.top + range * (1 - cos(2 * .pi * (elapsed - 1) / 6)) / 2
        #endif
    }

    private func report() {
        let ms = { (t: CFTimeInterval) in String(format: "%.1f", t * 1000) }
        FileHandle.standardError.write(Data(("[hitches] frames \(second.frames), missed \(second.missed) · busy \(ms(second.busy)) ms · "
            + "longest pass \(ms(second.longest)) ms\n").utf8))
        seconds += 1
        if seconds > 3 {
            total.frames += second.frames
            total.missed += second.missed
            total.busy += second.busy
            total.longest = max(total.longest, second.longest)
            let n = Double(seconds - 3)
            FileHandle.standardError.write(Data(("[hitches] over \(seconds - 3) s: frames \(String(format: "%.1f", Double(total.frames) / n))/s · "
                + "missed \(String(format: "%.2f", Double(total.missed) / n))/s · busy \(ms(total.busy / n)) ms/s · longest pass \(ms(total.longest)) ms\n").utf8))
        }
        second = Second()
    }

    #if os(iOS)
    /// The tallest scroll view in the key window: the stack's list.
    private static func scrollView() -> UIScrollView? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        func views(in view: UIView) -> [UIScrollView] {
            ((view as? UIScrollView).map { [$0] } ?? []) + view.subviews.flatMap(views)
        }
        return windows.filter(\.isKeyWindow).flatMap(views).filter { $0.contentSize.height > $0.bounds.height }
            .max { $0.bounds.height < $1.bounds.height }
    }
    #endif
}
