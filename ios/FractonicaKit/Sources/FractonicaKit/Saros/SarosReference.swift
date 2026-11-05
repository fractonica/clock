import Foundation

/// Which Saros series carries the clock: Saros 141 unless the person chose another of the ongoing series. Kept in the
/// app group's defaults, so the app, its widgets and its intents read the same series (`FractonicaClock.shared` takes it
/// on first use); `-FXSaros <n>` on the command line overrides it for one run without storing anything.
///
///     SarosReference.choose(145)        // stores it and moves FractonicaClock.shared onto Saros 145
public enum SarosReference {
    /// The series the clock was made on and runs on by default (SPEC §14).
    public static let standard = 141

    /// The app group the app and its widgets share (the iOS form; on macOS prefixed with the team).
    public static let suiteName: String = {
        #if os(macOS)
        "G23G724G3D.app.fractonica.clock"
        #else
        "group.app.fractonica.clock"
        #endif
    }()

    static let key = "sarosReference"

    /// The stored choice (or the launch argument's), when it is a series of the catalogue; otherwise `standard`.
    public static var stored: Int {
        if let argument = UserDefaults.standard.string(forKey: "FXSaros"), let n = Int(argument),
           SarosCatalogue.ongoing.contains(n) {
            return n
        }
        let n = UserDefaults(suiteName: suiteName)?.integer(forKey: key) ?? 0
        return SarosCatalogue.ongoing.contains(n) ? n : standard
    }

    /// Stores `series` as the reference and moves `FractonicaClock.shared` onto it. False, and nothing changes, for a
    /// series the catalogue lacks.
    @discardableResult
    public static func choose(_ series: Int) -> Bool {
        guard FractonicaClock.use(series: series) else { return false }
        UserDefaults(suiteName: suiteName)?.set(series, forKey: key)
        return true
    }
}
