#if DEBUG
import Foundation
import QuartzCore
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// `-FXLadderHitches 1` (debug builds): measures how smoothly the ladder ticks, for profiling. Once a real second it
/// prints to standard error the display frames drawn and missed, the main thread's busy time, the longest run-loop pass
/// and when in the second it began, and the same for the passes that begin in the first 60 ms of a second (where the
/// per-second ticks land); after the first three seconds, a running summary line. `-FXLadderHitches scroll` (iOS) also
/// sweeps the list down and up every 6 s, to measure scrolling without touches.
///
///     xcrun simctl launch --console <device> app.fractonica.clock -FXTab ladder -FXLadderHitches 1 | grep hitches
///     open Fractonica.app --stderr /tmp/hitches.txt --args -FXTab ladder -FXLadderHitches 1
@MainActor
final class LadderHitches: NSObject {
    private static var running: LadderHitches?

    /// Starts measuring when the launch arguments ask for it (once).
    static func startIfAsked() {
        let arguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        guard running == nil,
              let mode = (arguments["FXLadderHitches"] as? String) ?? (arguments["FXLadderHitches"] as? NSNumber)?.stringValue
        else { return }
        let hitches = LadderHitches(sweeps: mode == "scroll")
        running = hitches
        hitches.start()
    }

    private struct Second {
        var frames = 0
        var missed = 0
        var busy: CFTimeInterval = 0
        var longest: CFTimeInterval = 0
        var longestAt = 0.0
        var tick: CFTimeInterval = 0
        var longestTick: CFTimeInterval = 0
    }

    private let sweeps: Bool
    private var second = Second()
    private var total = Second()
    private var seconds = 0
    private var lastFrame: CFTimeInterval = 0
    private var secondStart: CFTimeInterval = 0
    private var sweepStart: CFTimeInterval = 0
    private var passStart: CFTimeInterval = 0
    private var passPhase = 0.0
    private var observer: CFRunLoopObserver?
    private var link: CADisplayLink?

    private init(sweeps: Bool) {
        self.sweeps = sweeps
    }

    /// Where in its real second an instant falls, 0 ..< 1.
    private static var phase: Double { Date().timeIntervalSince1970.truncatingRemainder(dividingBy: 1) }

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

    /// A run-loop pass of the main thread begins (after waiting) or ends (before waiting).
    private func pass(_ activity: CFRunLoopActivity) {
        let now = CACurrentMediaTime()
        if activity == .afterWaiting {
            passStart = now
            passPhase = Self.phase
            return
        }
        guard passStart > 0 else { return }
        let length = now - passStart
        passStart = 0
        second.busy += length
        if length > second.longest {
            second.longest = length
            second.longestAt = passPhase
        }
        if passPhase < 0.06 {
            second.tick += length
            second.longestTick = max(second.longestTick, length)
        }
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
        if sweeps { sweep(now - sweepStart) }
        guard now - secondStart >= 1 else { return }
        report()
        secondStart = now
    }

    private func report() {
        let ms = { (t: CFTimeInterval) in String(format: "%.1f", t * 1000) }
        FileHandle.standardError.write(Data(("[hitches] frames \(second.frames), missed \(second.missed) · busy \(ms(second.busy)) ms · "
            + "longest pass \(ms(second.longest)) ms at .\(Int(second.longestAt * 100)) · on the second \(ms(second.tick)) ms, "
            + "longest \(ms(second.longestTick)) ms\n").utf8))
        seconds += 1
        if seconds > 3 {
            // the first seconds are the launch
            total.frames += second.frames
            total.missed += second.missed
            total.busy += second.busy
            total.tick += second.tick
            total.longest = max(total.longest, second.longest)
            total.longestTick = max(total.longestTick, second.longestTick)
            let n = Double(seconds - 3)
            FileHandle.standardError.write(Data(("[hitches] over \(seconds - 3) s: missed \(String(format: "%.2f", Double(total.missed) / n))/s · "
                + "busy \(ms(total.busy / n)) ms/s · on the second \(ms(total.tick / n)) ms/s · longest pass \(ms(total.longest)) ms, "
                + "on the second \(ms(total.longestTick)) ms\n").utf8))
        }
        second = Second()
    }

    /// Scrolls the ladder's list down and back up every 6 s (iOS).
    private func sweep(_ elapsed: CFTimeInterval) {
        #if os(iOS)
        guard let list = Self.list() else { return }
        let inset = list.adjustedContentInset
        let range = max(0, list.contentSize.height + inset.top + inset.bottom - list.bounds.height)
        list.contentOffset.y = -inset.top + range * (1 - cos(2 * .pi * elapsed / 6)) / 2
        #endif
    }

    #if os(iOS)
    /// The tallest collection view in the key window: the ladder's list.
    private static func list() -> UICollectionView? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        func lists(in view: UIView) -> [UICollectionView] {
            ((view as? UICollectionView).map { [$0] } ?? []) + view.subviews.flatMap(lists)
        }
        return windows.filter(\.isKeyWindow).flatMap(lists).max { $0.bounds.height < $1.bounds.height }
    }
    #endif
}
#endif
