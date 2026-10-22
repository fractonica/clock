import FractonicaKit
import Foundation
import Observation

/// The converter's one moment and how it is being looked at. Unpinned, the moment follows the displayed time (a live
/// readout of the clock); editing anything pins it on the result, so it can be studied while the clock runs on; "Go
/// there" travels the whole app to it. Shared by both converters (Earth and pure) and kept across tab switches, so a
/// pinned moment survives a visit to another screen (src/ui/calendar/converter.js `S`).
@MainActor @Observable
final class ConverterModel {
    static let shared = ConverterModel()

    /// Where an edit came from: the address and sync editors keep showing what was typed while it stays valid.
    enum Source: Sendable { case earth, unix, position, address, glyph, sync, pure, eclipse }

    /// The converter's own zone: the app's, UTC, or any other.
    enum ZoneMode: Hashable, Sendable {
        case app, utc
        case zone(String)
    }

    private(set) var isPinned = false
    private var pinnedT: Double = 0
    private var followT: Double = 0

    /// The moment the converter shows (Unix seconds, whole milliseconds).
    var t: Double { isPinned ? pinnedT : followT }
    /// The displayed time, as last pushed by the screen (what a pinned moment is compared with).
    var displayedT: Double { followT }

    var zoneMode: ZoneMode = .app
    /// How deep the cycle address goes (1 … 14).
    var depth = 5
    var point: CalMath.Point = .begin
    /// The address as last edited, while the moment comes from the address editor (the end of a cycle shows the next
    /// one, so the edited path is kept rather than read back).
    private(set) var editedPath: [Int]?
    /// A glyph state picker to open, and the section to scroll to (launch arguments).
    var pickLevel: Int?
    var scrollTarget: String?
    @ObservationIgnored private var launched = false

    /// Gregorian input is accepted for years 1000 … 9999 (outside the catalogue the Fractonica side says so).
    static let earthRange = -30_610_224_000.0...253_402_300_799.0

    /// The displayed time, pushed by the screen's clock timeline.
    func follow(_ t: Double) {
        let r = CalMath.r3(t)
        if followT != r { followT = r }
    }

    /// Pin the converter on `t` (an edit). Returns false when it is not a time the converter can hold.
    @discardableResult
    func set(_ t: Double, from source: Source) -> Bool {
        guard t.isFinite, Self.earthRange.contains(t) else { return false }
        pinnedT = CalMath.r3(t)
        isPinned = true
        if source != .address { editedPath = nil }
        return true
    }

    /// Pin on the cycle at `path` (the address editor) at the chosen point.
    func setAddress(_ path: [Int], t: Double) {
        set(t, from: .address)
        editedPath = path
    }

    /// Freeze the moment that is showing.
    func pin() {
        pinnedT = followT
        isPinned = true
    }

    /// Follow the displayed time again.
    func unpin() {
        isPinned = false
        editedPath = nil
    }

    func timeZone(app: TimeZone) -> TimeZone { Self.zone(zoneMode, app: app) }

    static func zone(_ mode: ZoneMode, app: TimeZone) -> TimeZone {
        switch mode {
        case .app: app
        case .utc: TimeZone(identifier: "UTC")!
        case .zone(let id): TimeZone(identifier: id) ?? app
        }
    }

    /// The launch arguments, once (-FXConverterTime, -FXConverterZone, -FXConverterPick, -FXConverterDepth,
    /// -FXConverterPoint, -FXCalendarScroll).
    func applyLaunchOptions() {
        guard !launched else { return }
        launched = true
        if let t = CalendarLaunch.time("FXConverterTime") { set(t, from: .unix) }
        if let zone = CalendarLaunch.string("FXConverterZone") {
            zoneMode = zone == "UTC" ? .utc : TimeZone(identifier: zone) != nil ? .zone(zone) : .app
        }
        if let level = CalendarLaunch.int("FXConverterPick"), (0...13).contains(level) { pickLevel = level }
        if let d = CalendarLaunch.int("FXConverterDepth"), (1...14).contains(d) { depth = d }
        if let p = CalendarLaunch.string("FXConverterPoint").flatMap(CalMath.Point.init(rawValue:)) { point = p }
        // the glyph tiles live in a lazy grid: the picker can only open on a tile that is on screen
        scrollTarget = CalendarLaunch.string("FXCalendarScroll") ?? (pickLevel != nil ? "glyphs" : nil)
    }
}
