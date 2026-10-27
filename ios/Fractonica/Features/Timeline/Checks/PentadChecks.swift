import FractonicaKit
import Foundation

// When a cursor, now or pointer flag leads its moment with the Pentad (SPEC §15.3): where it names a time of day or a
// date (Earth) or counts Helions (pure), never on flags years wide.

@MainActor
func flagPentadChecks() {
    let earth = TimelineWords(pure: false, earth: EarthFormatter(zone: "UTC"))
    let pure = TimelineWords(pure: true, earth: EarthFormatter(zone: "UTC"))
    check(earth.flagShowsPentad(span: 3600, rulerUnit: 0), "an Earth flag over an hour leads with the Pentad")
    check(earth.flagShowsPentad(span: 400 * 86_400, rulerUnit: 0), "… up to a window of 400 days (a short date)")
    check(!earth.flagShowsPentad(span: 401 * 86_400, rulerUnit: 0), "a flag that says only a date years across does not")
    let ruler = TimelineData().ruler
    for u in 0..<ruler.units.count {
        let names = ruler.flagUnits(u).contains(TimelineRuler.eta)
        check(pure.flagShowsPentad(span: 0, rulerUnit: u) == (names || u > TimelineRuler.eta),
              "a pure flag leads with the Pentad exactly when it counts Helions (unit \(u))")
    }
}
