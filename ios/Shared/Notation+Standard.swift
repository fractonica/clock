import FractonicaKit

extension Notation {
    /// The pure-mode vocabulary (SPEC §15) bound to the shared clock: use it instead of building a `Notation` per view.
    /// Read anew each time, so it follows the reference series (`FractonicaClock.shared`); the clock keeps its tables, so
    /// this costs two lock round trips.
    static var standard: Notation { Notation(clock: .shared) }
}

/// The clock's catalogue in Earth words, for text that names it (never in pure mode, which has
/// `Notation.catalogueText()`). Its dates are UTC, as the catalogue's eclipses are given.
extension FractonicaClock {
    /// "Saros 141".
    var sarosName: String { "Saros \(series)" }

    /// The UTC years of the first and last eclipse: 1613 and 2857 for Saros 141.
    var firstYear: Int { Self.utcDay(tMin).year }
    var lastYear: Int { Self.utcDay(tMax).year }

    /// "1613–2857" for Saros 141.
    func yearSpan(_ separator: String = "–") -> String { "\(firstYear)\(separator)\(lastYear)" }

    /// "19 May 1613 … 13 June 2857" for Saros 141.
    var daySpan: String { "\(Self.dayText(tMin)) … \(Self.dayText(tMax))" }

    private static func utcDay(_ t: Double) -> (year: Int, month: Int, day: Int) {
        EarthTime.civilFromDays(Int((t / 86_400).rounded(.down)))
    }

    private static func dayText(_ t: Double) -> String {
        let d = utcDay(t)
        return "\(d.day) \(EarthTime.monthsLong[d.month - 1]) \(d.year)"
    }
}
