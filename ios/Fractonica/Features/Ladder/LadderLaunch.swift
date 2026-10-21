import Foundation

/// The ladder's own test hooks for screenshots (debug builds only; read from the launch arguments, never persisted):
///
///     -FXLadderExpand <0…13|none>  the row whose details are open (and selected) at launch
///     -FXLadderDepths <min-max>     the depth range shown, e.g. 1-14
///     -FXLadderScroll upnext        scroll the iPhone layout to Up next
///     -FXLadderShift <seconds>      show the ladder that many seconds away from the displayed time (to see the
///                                   out-of-catalogue state, which travel never reaches: it clamps)
///     -ladder.importance <γ…η>      Up next's importance for this launch (the argument domain shadows the stored value)
///
///     ios/scripts/shoot.sh --device fx-ladder shot.png -FXTab ladder -FXTime 1791460800 -FXLadderExpand 3
enum LadderLaunch {
    #if DEBUG
    private static func string(_ key: String) -> String? {
        let arguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        return (arguments[key] as? String) ?? (arguments[key] as? NSNumber)?.stringValue
    }

    static let shift: Double = string("FXLadderShift").flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil } ?? 0
    /// nil: no hook; −1: everything collapsed.
    static let expand: Int? = string("FXLadderExpand").map { Int($0).map { min(13, max(0, $0)) } ?? -1 }
    static let depths: ClosedRange<Int>? = string("FXLadderDepths").flatMap { text in
        let parts = text.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2, (1...14).contains(parts[0]), (1...14).contains(parts[1]), parts[0] <= parts[1] else { return nil }
        return parts[0]...parts[1]
    }
    static let scrollToUpNext = string("FXLadderScroll")?.lowercased() == "upnext"
    #else
    static let shift = 0.0
    static let expand: Int? = nil
    static let depths: ClosedRange<Int>? = nil
    static let scrollToUpNext = false
    #endif

    /// The time the ladder shows for a displayed time.
    static func shown(_ t: Double) -> Double { t + shift }
    /// The displayed time of a time the ladder shows.
    static func unshown(_ t: Double) -> Double { t - shift }
}
