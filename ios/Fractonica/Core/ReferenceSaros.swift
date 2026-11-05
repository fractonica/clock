import Foundation
import FractonicaKit
import Observation

/// The Saros series the whole app reads its clock from (`FractonicaClock.shared`), observable. Saros 141 unless the
/// person picks another in the Saros catalogue; the choice is stored in the app group, so the widgets follow it.
///
///     ReferenceSaros.shared.choose(145)     // the clock, every screen, the schedules and the widgets move to Saros 145
///     ReferenceSaros.shared.series          // 145
@MainActor @Observable
final class ReferenceSaros {
    static let shared = ReferenceSaros()

    /// The reference series now.
    private(set) var series: Int = FractonicaClock.shared.series

    /// Posted on the main actor after the clock has moved to another series.
    static let changed = Notification.Name("app.fractonica.referenceSarosChanged")

    /// Moves the clock onto `series` and stores it; nothing happens for the series already in use or one the
    /// catalogue lacks.
    func choose(_ series: Int) {
        guard series != self.series, SarosReference.choose(series) else { return }
        self.series = series
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }
}
