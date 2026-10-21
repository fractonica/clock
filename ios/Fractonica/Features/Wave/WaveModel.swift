import Foundation
import Observation
import SwiftUI

/// The wave screen's own state: the catalogue / focus choice and the solar wave (remembered under `wave.` keys), the
/// cadence the stage needs, the item under the pointer, and the stage itself.
@MainActor @Observable
final class WaveModel {
    /// The whole catalogue instead of the focus level; remembered between visits.
    var overview: Bool {
        didSet { if overview != oldValue, !overrides.contains(.overview) { defaults.set(overview, forKey: Self.overviewKey) } }
    }
    /// The yellow solar wave; remembered between visits.
    var solar: Bool {
        didSet { if solar != oldValue, !overrides.contains(.solar) { defaults.set(solar, forKey: Self.solarKey) } }
    }
    /// The stage needs every display frame (an animation, a gesture), even while the clock stands still.
    private(set) var continuous = false
    /// Displayed seconds between visible changes of the stage (a power of two), as the stage last measured it.
    private(set) var cadence = 1.0 / 128
    /// The user has pinched or panned away from the fitted view (Recenter shows).
    var adjusted = false
    /// The item under the pointer or a holding finger, and where.
    var tip: (pick: WavePick, location: CGPoint)?
    /// The stage is on screen: it draws only then.
    var visible = false
    var showInfo = false

    @ObservationIgnored let stage = WaveStage()
    @ObservationIgnored private var until = 0.0
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var overrides: Set<Override> = []
    @ObservationIgnored private(set) var launchLevel: Int?
    @ObservationIgnored private(set) var launchInspect: CGPoint?
    @ObservationIgnored private(set) var launchRate: Double?
    /// -FXWaveOffset <seconds>: this screen shows the displayed time shifted by that much (the clock itself never leaves
    /// the catalogue, so this is how screenshots reach the out-of-range state).
    @ObservationIgnored let offset: Double
    /// -FXWaveDemo "+1,+1,-1": zoom steps played two seconds apart after launch (to watch the camera glide).
    @ObservationIgnored private(set) var demo: [Int] = []
    /// -FXWaveWide 1|0: force the side-panel (or the header) layout, to look at both on one device.
    @ObservationIgnored private(set) var forceWide: Bool?
    @ObservationIgnored private var launched = false

    private enum Override { case overview, solar }

    static let overviewKey = "wave.overview"
    static let solarKey = "wave.solar"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        overview = defaults.bool(forKey: Self.overviewKey)
        solar = defaults.bool(forKey: Self.solarKey)
        // launch hooks for screenshots (never saved): -FXWaveSolar 1|0, -FXWaveOverview 1|0, -FXWaveLevel n,
        // -FXWaveInspect x,y (show the tooltip of what lies at that stage point), -FXWavePlay rate (start a time-lapse),
        // -FXWaveOffset seconds (see `offset`), -FXWaveWide 1|0 (the layout), -FXWaveDemo +1,-1 (zoom steps)
        let args = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        func flag(_ key: String) -> Bool? {
            string(key).flatMap { ["1", "yes", "true"].contains($0.lowercased()) ? true : ["0", "no", "false"].contains($0.lowercased()) ? false : nil }
        }
        if let s = flag("FXWaveSolar") {
            overrides.insert(.solar)
            solar = s
        }
        if let o = flag("FXWaveOverview") {
            overrides.insert(.overview)
            overview = o
        }
        offset = string("FXWaveOffset").flatMap(Double.init).flatMap { $0.isFinite ? $0 : nil } ?? 0
        forceWide = flag("FXWaveWide")
        demo = string("FXWaveDemo")?.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) } ?? []
        launchLevel = string("FXWaveLevel").flatMap(Int.init).map { min(max($0, 0), 13) }
        launchRate = string("FXWavePlay").flatMap(Double.init).flatMap { $0.isFinite && $0 != 0 ? $0 : nil }
        if let parts = string("FXWaveInspect")?.split(separator: ",").compactMap({ Double($0.trimmingCharacters(in: .whitespaces)) }), parts.count == 2 {
            launchInspect = CGPoint(x: parts[0], y: parts[1])
        }
    }

    /// The launch hooks apply once per process.
    func takeLaunchHooks() -> (level: Int?, rate: Double?)? {
        guard !launched else { return nil }
        launched = true
        return (launchLevel, launchRate)
    }

    /// The demo's zoom steps, once.
    func takeDemo() -> [Int] {
        defer { demo = [] }
        return demo
    }

    /// The point a launch hook wants inspected, once.
    func takeLaunchInspect() -> CGPoint? {
        defer { launchInspect = nil }
        return launchInspect
    }

    /// Keeps the stage drawing every frame for at least `seconds` (animations, gestures, gliding labels).
    func keepDrawing(for seconds: Double) {
        let target = WaveStage.now + seconds
        guard target > until else { return }
        until = target
        if !continuous { continuous = true }
        guard task == nil else { return }
        task = Task { [weak self] in
            while let self, !Task.isCancelled {
                let wait = self.until - WaveStage.now
                if wait <= 0 {
                    self.continuous = false
                    self.task = nil
                    return
                }
                try? await Task.sleep(for: .seconds(wait))
            }
        }
    }

    /// The stage's measured interval, kept as a power of two so small changes never switch the cadence; deferred.
    func requestCadence(_ interval: Double) {
        let bucket = exp2(max(-7, min(12, log2(max(interval, 1e-6)).rounded(.down))))
        guard bucket != cadence else { return }
        Task { @MainActor [weak self] in self?.cadence = bucket }
    }

    /// The same, from inside a frame: deferred, so no observed state changes while SwiftUI draws.
    func requestFrames(_ seconds: Double) {
        guard !continuous || until < WaveStage.now + seconds * 0.5 else { return }
        Task { @MainActor [weak self] in self?.keepDrawing(for: seconds) }
    }
}
