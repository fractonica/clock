import FractonicaKit
import Foundation
import Observation

/// The dial's layers the viewer can switch off (src/ui/rings.js toggles), persisted under `rings.layers`.
@MainActor @Observable
final class RingsPreferences {
    static let shared = RingsPreferences()

    var sectors: Bool { didSet { save() } }
    var quarters: Bool { didSet { save() } }
    var funnels: Bool { didSet { save() } }

    @ObservationIgnored private let defaults: UserDefaults
    private static let key = "rings.layers"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.dictionary(forKey: Self.key) ?? [:]
        sectors = stored["sectors"] as? Bool ?? true
        quarters = stored["quarters"] as? Bool ?? true
        funnels = stored["funnels"] as? Bool ?? true
    }

    var layers: RingsLayers { RingsLayers(sectors: sectors, quarters: quarters, funnels: funnels) }

    private func save() {
        defaults.set(["sectors": sectors, "quarters": quarters, "funnels": funnels], forKey: Self.key)
    }
}

/// Which optional layers the dial draws.
struct RingsLayers: Equatable, Sendable {
    var sectors = true
    var quarters = true
    var funnels = true
}

/// One ring of a frame: its level, and its reading unless it is too fast to draw a hand for.
struct RingFrame: Sendable {
    let level: Int
    let factor: Int
    let meanSeconds: Double
    /// Nil outside the catalogue, and for a blurred ring that is not selected (nothing exact is computed for it).
    let reading: LevelReading?
    /// Too fast to follow at the current speed: drawn as a glow.
    let blur: Bool
    /// Fast enough for Reduce Motion to freeze its hand.
    let fast: Bool
}

/// Everything the dial shows at one displayed instant: one reading per ring, read once per frame.
struct RingsFrame: Sendable {
    /// The displayed time.
    let t: Double
    /// The instant the readings are taken at: `t`, or 1 ms inside the catalogue's closing instant.
    let readTime: Double
    let inRange: Bool
    /// Displayed seconds per real second (1 live, 0 paused).
    let speed: Double
    let rings: [RingFrame]
    let selected: Int
    let selectedReading: LevelReading?

    init(t: Double, range: DepthRange, selected: Int, speed: Double, outOfRange: Bool = false, clock: FractonicaClock = .shared) {
        self.t = t
        inRange = !outOfRange && clock.inRange(t)
        // exactly at the catalogue's end, read the last instant of the last cycle (as rings.js does)
        readTime = t >= clock.tMax ? clock.tMax - 0.001 : t
        self.speed = speed
        self.selected = selected
        let inRange = self.inRange
        let readTime = self.readTime
        var selectedReading: LevelReading?
        rings = range.levels.map { level in
            let info = clock.levelInfo(level)
            let blur = RingsMath.isBlur(meanSeconds: info.meanSeconds, speed: speed)
            let reading = inRange && (!blur || level == selected) ? clock.level(at: readTime, level) : nil
            if level == selected { selectedReading = reading }
            return RingFrame(level: level, factor: info.factor, meanSeconds: info.meanSeconds, reading: reading, blur: blur,
                             fast: RingsMath.isFast(meanSeconds: info.meanSeconds, speed: speed))
        }
        self.selectedReading = selectedReading ?? (inRange ? clock.level(at: readTime, selected) : nil)
    }
}

/// The phases Reduce Motion holds still: a fast ring keeps the phase it had when the displayed time last jumped
/// (`ClockStore.revision`), so nothing spins; slow rings move as usual.
@MainActor
final class FrozenPhases {
    private var held: [Int: (phase: Double, revision: Int)] = [:]

    func phase(level: Int, live: Double, revision: Int) -> Double {
        if let h = held[level], h.revision == revision { return h.phase }
        held[level] = (live, revision)
        return live
    }

    func reset() { held.removeAll() }
}
