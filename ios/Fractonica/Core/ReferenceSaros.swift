import Foundation
import FractonicaKit
import Observation
import WidgetKit

/// The Saros series the whole app reads its clock from (`FractonicaClock.shared`), observable. Saros 141 unless the
/// person picks another in the Saros catalogue; the choice is stored in the app group, so the widgets follow it.
///
///     ReferenceSaros.shared.choose(145)     // the clock, every screen, the schedules and the widgets move to Saros 145
///     ReferenceSaros.shared.series          // 145
///
/// What a switch does, in order (`choose`):
/// 1. the kit's clock moves and the choice is stored in the app group (`SarosReference.choose`);
/// 2. `ClockStore` adopts the new clock: live stays live, a moment shown stays shown inside the new catalogue;
/// 3. every feature's `referenceChanged(from:)` (`AppHooks`): Alerts re-sanitize their rules and refill, Moments take
///    a new calendar, forget the calls kept by moment number and refill, the timer and the stopwatch re-word their
///    notification and Live Activities, the sound rebuilds its renderer, the converter drops an address typed on the
///    old series;
/// 4. `series` changes: the root gives the screens a new identity (`RootView`), so every screen's state is made again,
///    and the models kept per series (`ClockScoped`: the Timeline's, the Month's, the Diary's, the journal wave's) are
///    made anew on their next use;
/// 5. the widgets reload their timelines, and `changed` is posted.
@MainActor @Observable
final class ReferenceSaros {
    static let shared = ReferenceSaros()

    /// The reference series now.
    private(set) var series: Int = FractonicaClock.shared.series

    /// Posted on the main actor after the clock has moved to another series and the app has followed it.
    static let changed = Notification.Name("app.fractonica.referenceSarosChanged")

    /// Moves the clock onto `series` and stores it; nothing happens for the series already in use or one the
    /// catalogue lacks.
    func choose(_ series: Int) {
        move(to: series, storing: true)
    }

    /// `-FXSarosSwitch <n>`: the whole switch onto Saros n, two seconds after launch, for this run only (nothing is
    /// stored, so the widgets and the next launch stay on the stored series): to see a switch in screenshots and
    /// checks. (`-FXSaros <n>` starts on Saros n instead.)
    func applyLaunchOptions(_ defaults: UserDefaults = .standard) {
        let value = defaults.volatileDomain(forName: UserDefaults.argumentDomain)["FXSarosSwitch"]
        guard let series = ((value as? String) ?? (value as? NSNumber)?.stringValue).flatMap(Int.init) else { return }
        Task {
            try? await Task.sleep(for: .seconds(2))
            move(to: series, storing: false)
        }
    }

    private func move(to series: Int, storing: Bool) {
        let old = self.series
        guard series != old, storing ? SarosReference.choose(series) : FractonicaClock.use(series: series) else { return }
        ClockStore.shared.adopt(.shared)
        AppHooks.referenceChanged(from: old)
        self.series = series
        WidgetCenter.shared.reloadAllTimelines()
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }
}
