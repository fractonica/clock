import AudioToolbox
import Foundation
import os
#if os(iOS)
import ObjectiveC
import UIKit
#endif

/// The interface's sounds, honouring the Sounds setting: Half-Life 2's weapon selection (ios/scripts/import-sounds.swift,
/// Resources/Sounds/ui-<name>.caf), played as system sounds, so the silent switch silences them (on the Mac the alert
/// volume sets them) and the app's audio session is left alone. A tab switched sounds `.tab` (`AppRouter.selection`);
/// on iOS a page pushed sounds `.open` and a page popped or a window dismissed `.back`, whatever does it
/// (`launch()` hooks UIKit's navigation and presentation controllers, which SwiftUI's stacks and sheets are underneath).
///
///     InterfaceSound.play(.tab)
@MainActor
enum InterfaceSound: String, CaseIterable {
    /// Into a page (its back button appears).
    case open
    /// Back from a page, or a window (a sheet, a full-screen cover, a popover) dismissed.
    case back
    /// Another tab.
    case tab

    /// The bundled sound.
    nonisolated var fileName: String { "ui-\(rawValue).caf" }

    static func play(_ sound: InterfaceSound) {
        let now = Date.now
        // not while the launch sets the first screens up, nor twice at once (UIKit and SwiftUI may both move)
        guard AppSettings.shared.sounds, now > quietUntil, !(last?.sound == sound && now.timeIntervalSince(last!.at) < 0.25),
              let id = id(sound) else { return }
        last = (sound, now)
        Logger(subsystem: "app.fractonica.clock", category: "ui").debug("sound \(sound.rawValue, privacy: .public)")
        AudioServicesPlaySystemSound(id)
    }

    /// At launch: quiet for a moment, and on iOS the navigation and dismissal hooked.
    static func launch() {
        quietUntil = Date.now.addingTimeInterval(1.5)
        #if os(iOS)
        installNavigationSounds()
        #endif
    }

    private static var quietUntil = Date.distantPast
    private static var last: (sound: InterfaceSound, at: Date)?

    /// Each sound's system sound, made on its first play.
    private static var ids: [InterfaceSound: SystemSoundID] = [:]

    private static func id(_ sound: InterfaceSound) -> SystemSoundID? {
        if let id = ids[sound] { return id }
        guard let url = Bundle.main.url(forResource: "ui-\(sound.rawValue)", withExtension: "caf") else { return nil }
        var id: SystemSoundID = 0
        guard AudioServicesCreateSystemSoundID(url as CFURL, &id) == noErr else { return nil }
        ids[sound] = id
        return id
    }
}

#if os(iOS)
extension InterfaceSound {
    private static var installed = false

    /// Exchanges UINavigationController's push, pops and `setViewControllers`, and UIPresentationController's
    /// dismissal, for versions that sound first (once).
    private static func installNavigationSounds() {
        guard !installed else { return }
        installed = true
        let nav = UINavigationController.self
        exchange(nav, #selector(UINavigationController.pushViewController(_:animated:)),
                 #selector(UINavigationController.fx_pushViewController(_:animated:)))
        exchange(nav, #selector(UINavigationController.popViewController(animated:)),
                 #selector(UINavigationController.fx_popViewController(animated:)))
        exchange(nav, #selector(UINavigationController.popToViewController(_:animated:)),
                 #selector(UINavigationController.fx_popToViewController(_:animated:)))
        exchange(nav, #selector(UINavigationController.popToRootViewController(animated:)),
                 #selector(UINavigationController.fx_popToRootViewController(animated:)))
        exchange(nav, #selector(UINavigationController.setViewControllers(_:animated:)),
                 #selector(UINavigationController.fx_setViewControllers(_:animated:)))
        exchange(UIPresentationController.self, #selector(UIPresentationController.dismissalTransitionWillBegin),
                 #selector(UIPresentationController.fx_dismissalTransitionWillBegin))
    }

    private static func exchange(_ type: AnyClass, _ original: Selector, _ replacement: Selector) {
        guard let a = class_getInstanceMethod(type, original), let b = class_getInstanceMethod(type, replacement) else { return }
        method_exchangeImplementations(a, b)
    }
}

// Each `fx_` method, exchanged, is the original's place: calling it calls the original.
extension UINavigationController {
    /// On screen and showing a page already (not a stack being set up).
    private var moves: Bool { view.window != nil && !viewControllers.isEmpty }

    @objc fileprivate func fx_pushViewController(_ controller: UIViewController, animated: Bool) {
        if moves { InterfaceSound.play(.open) }
        fx_pushViewController(controller, animated: animated)
    }

    @objc fileprivate func fx_popViewController(animated: Bool) -> UIViewController? {
        if moves, viewControllers.count > 1 { InterfaceSound.play(.back) }
        return fx_popViewController(animated: animated)
    }

    @objc fileprivate func fx_popToViewController(_ controller: UIViewController, animated: Bool) -> [UIViewController]? {
        if moves, viewControllers.last !== controller { InterfaceSound.play(.back) }
        return fx_popToViewController(controller, animated: animated)
    }

    @objc fileprivate func fx_popToRootViewController(animated: Bool) -> [UIViewController]? {
        if moves, viewControllers.count > 1 { InterfaceSound.play(.back) }
        return fx_popToRootViewController(animated: animated)
    }

    @objc fileprivate func fx_setViewControllers(_ controllers: [UIViewController], animated: Bool) {
        if moves, controllers.count != viewControllers.count { InterfaceSound.play(controllers.count > viewControllers.count ? .open : .back) }
        fx_setViewControllers(controllers, animated: animated)
    }
}

extension UIPresentationController {
    /// A window going: at once, or when a swipe that dismisses it lets go (not when it is called off). Alerts and
    /// confirmation dialogs go silently.
    @objc fileprivate func fx_dismissalTransitionWillBegin() {
        fx_dismissalTransitionWillBegin()
        guard !(presentedViewController is UIAlertController) else { return }
        if let coordinator = presentedViewController.transitionCoordinator, coordinator.isInteractive {
            coordinator.notifyWhenInteractionChanges { context in
                guard !context.isCancelled else { return }
                MainActor.assumeIsolated { InterfaceSound.play(.back) }
            }
        } else {
            InterfaceSound.play(.back)
        }
    }
}
#endif
