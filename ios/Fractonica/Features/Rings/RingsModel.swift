import FractonicaKit
import Observation
import SwiftUI

/// What the Rings screen holds between frames: the long-press preview, the options popover, the ring a drag is
/// winding, the selection animation, and the screen's own launch arguments (shown, never saved).
///
/// Launch arguments (test hooks for screenshots, read once; none of them is persisted):
///
///     -FXRingsLevel <0…13>      show this level selected (until a ring is chosen)
///     -FXRingsRange <min>-<max> show this depth range, e.g. 4-14 (until the range is changed)
///     -FXRingsOut 1             show the dial as it looks outside the catalogue
///     -FXRingsPreview <level>[:<sector>]   open the touch-and-hold preview of a ring (or one of its sectors)
///     -FXRingsOptions 1         open the options popover
///     -FXRingsHelp 1            open the options popover with "How to read" expanded
///     -FXRingsScroll 1          scroll the iPhone page down to the bottom of the cycle card
///     -FXRingsRate <rate>       start a time-lapse at this many displayed seconds per real second (blurred rings)
///     -FXRingsWide 1            lay the screen out side by side whatever the window's shape (landscape checks)
///     -FXRingsLandscape 1       turn an iPhone to landscape when the screen appears (iOS)
///     -FXRingsHover <level>[:<sector>]     put a virtual pointer over a ring (or sector): its highlight and tooltip
@MainActor @Observable
final class RingsScreenModel {
    var selectionOverride: Int?
    var rangeOverride: DepthRange?
    var outOfRange = false
    var preview: RingsPreviewTarget?
    var showsOptions = false
    var showsHelp = false
    /// Launch: scroll the page down to the card.
    var scrollsToCard = false
    /// Launch: the side-by-side layout whatever the window's shape.
    var forcesWide = false
    /// Launch: turn the device to landscape.
    @ObservationIgnored var turnsLandscape = false
    /// The ring index a drag is winding.
    var scrubbingRing: Int?
    /// The wave's cursor is being dragged.
    var scrubbingWave = false
    /// The screen is on screen (animations run only then).
    var isVisible = false
    /// The level selected before the current one, and a count of selections: animating it by one moves the dial's
    /// emphasis from the old ring to the new one.
    var previousSelection: Int?
    var selectionStep = 0.0

    @ObservationIgnored private var pendingPreview: (level: Int, sector: Int?)?
    @ObservationIgnored private var pendingHover: (level: Int, sector: Int?)?
    @ObservationIgnored private var launchRead = false
    @ObservationIgnored private var pendingOptions = false
    @ObservationIgnored private var pendingRate: Double?

    func selected(_ settings: AppSettings) -> Int { selectionOverride ?? settings.selectedLevel }

    func range(_ settings: AppSettings) -> DepthRange {
        rangeOverride ?? DepthRange(minDepth: settings.minDepth, maxDepth: settings.maxDepth)
    }

    /// Select a level: the shared selection every screen follows.
    func select(_ level: Int, settings: AppSettings, reduceMotion: Bool) {
        let old = selected(settings)
        selectionOverride = nil
        guard level != old || settings.selectedLevel != level else { return }
        settings.selectedLevel = level
        animateSelection(from: old, reduceMotion: reduceMotion)
    }

    /// The emphasis of the old ring fades into the new one.
    func animateSelection(from old: Int, reduceMotion: Bool) {
        previousSelection = old
        if reduceMotion {
            selectionStep += 1
        } else {
            withAnimation(.smooth(duration: 0.4)) { selectionStep += 1 }
        }
    }

    /// Show `range` (saved in the shared settings); a selection the range leaves behind follows it inside.
    func setRange(_ range: DepthRange, settings: AppSettings, reduceMotion: Bool) {
        rangeOverride = nil
        // keep minDepth ≤ maxDepth at every step: AppSettings refuses an inverted pair
        if range.minDepth > settings.maxDepth {
            settings.maxDepth = range.maxDepth
            settings.minDepth = range.minDepth
        } else {
            settings.minDepth = range.minDepth
            settings.maxDepth = range.maxDepth
        }
        let sel = selected(settings)
        if !range.contains(sel) { select(range.clamp(sel), settings: settings, reduceMotion: reduceMotion) }
    }

    /// Reads the launch arguments once.
    func readLaunchArguments(_ defaults: UserDefaults = .standard) {
        guard !launchRead else { return }
        launchRead = true
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        if let level = string("FXRingsLevel").flatMap(Int.init), AppSettings.levels.contains(level) {
            selectionOverride = level
        }
        if let text = string("FXRingsRange") {
            let parts = text.split(separator: "-").compactMap { Int($0) }
            if parts.count == 2 { rangeOverride = DepthRange(minDepth: parts[0], maxDepth: parts[1]) }
        }
        if let out = string("FXRingsOut"), ["1", "yes", "true"].contains(out.lowercased()) { outOfRange = true }
        if let text = string("FXRingsPreview") {
            let parts = text.split(separator: ":").compactMap { Int($0) }
            if let level = parts.first, AppSettings.levels.contains(level) { pendingPreview = (level, parts.count > 1 ? parts[1] : nil) }
        }
        if let text = string("FXRingsHover") {
            let parts = text.split(separator: ":").compactMap { Int($0) }
            if let level = parts.first, AppSettings.levels.contains(level) { pendingHover = (level, parts.count > 1 ? parts[1] : nil) }
        }
        if let options = string("FXRingsOptions"), options == "1" { pendingOptions = true }
        if string("FXRingsScroll") == "1" { scrollsToCard = true }
        if string("FXRingsWide") == "1" { forcesWide = true }
        if string("FXRingsLandscape") == "1" { turnsLandscape = true }
        if let rate = string("FXRingsRate").flatMap(Double.init), rate.isFinite, rate != 0 { pendingRate = rate }
        if let help = string("FXRingsHelp"), help == "1" {
            pendingOptions = true
            showsHelp = true
        }
    }

    /// Starts the time-lapse a launch argument asked for.
    func startPendingRate(_ store: ClockStore) {
        guard let rate = pendingRate else { return }
        pendingRate = nil
        store.setRate(rate)
    }

    /// Opens the options a launch argument asked for, once the toolbar it hangs from is on screen.
    func openPendingOptions() async {
        guard pendingOptions else { return }
        pendingOptions = false
        try? await Task.sleep(for: .seconds(1))
        showsOptions = true
    }

    /// The preview a launch argument asked for, on that ring (or sector).
    func takePendingPreview(range: DepthRange, at t: Double, clock: FractonicaClock = .shared) {
        guard let pending = pendingPreview else { return }
        pendingPreview = nil
        guard range.contains(pending.level), let reading = clock.level(at: min(t, clock.tMax - 0.001), pending.level) else { return }
        let sector = pending.sector.map { min(max($0, 0), reading.factor - 1) }
        let phase = sector.map { (Double($0) + 0.5) / Double(reading.factor) } ?? 0.125
        preview = RingsPreviewTarget(level: pending.level, ring: pending.level - range.minLevel, sector: sector, phase: phase)
    }
}

extension RingsScreenModel {
    /// The virtual pointer a launch argument asked for: the ring it rests on and the dial phase (placed on the dial at
    /// its size of the moment, which the first layout pass does not know yet).
    func takePendingHover(range: DepthRange, clock: FractonicaClock = .shared) -> RingsVirtualPointer? {
        guard let pending = pendingHover else { return nil }
        pendingHover = nil
        guard range.contains(pending.level) else { return nil }
        let factor = clock.levelInfo(pending.level).factor
        let phase = pending.sector.map { (Double(min(max($0, 0), factor - 1)) + 0.5) / Double(factor) } ?? 0.125
        return RingsVirtualPointer(ring: pending.level - range.minLevel, phase: phase)
    }
}

/// Where a launch argument's virtual pointer rests: a ring index and a dial phase.
struct RingsVirtualPointer: Equatable {
    let ring: Int
    let phase: Double
}

/// What a touch-and-hold on the dial asks about: a ring, or one of its sectors (a child cycle).
struct RingsPreviewTarget: Identifiable, Equatable {
    let level: Int
    let ring: Int
    let sector: Int?
    /// Where on the ring it was asked: the preview points there (whatever size the dial has by then).
    let phase: Double

    var id: String { "\(level):\(sector.map(String.init) ?? "-")" }
}

extension RingsScreenModel {
    /// Displayed seconds per real second: 1 live, the rate during a time-lapse, 0 paused.
    static func speed(of store: ClockStore) -> Double {
        store.isLive ? 1 : store.isPlaying ? abs(store.rate) : 0
    }
}
