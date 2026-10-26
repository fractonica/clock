import FractonicaKit
import Foundation
import Observation

/// How the timeline shows the journal, remembered under `journal.` keys: as a stack of entries (zoomed to Helions, or
/// out to Delta, Gamma and Beta blocks) or as the wave. Launch arguments set them for one launch without saving:
///
///     -FXJournalMode stack|wave      the timeline's mode
///     -FXJournalZoom helion|delta|gamma|beta   the stack's zoom
///     -FXJournalWaveZoom preon|helion|nuclide|delta|gamma|beta   about one and a half of these on the wave's screen
///     -FXJournalWaveAt <unix s>      the moment the wave opens at (the middle of the screen)
///     -FXJournalWaveHitches 1        (debug builds) measure the wave's frames and sweep it up and down (scroll, zoom)
@MainActor @Observable
final class JournalBrowsing {
    static let shared = JournalBrowsing()

    enum Mode: String, CaseIterable, Identifiable, Sendable {
        case stack, wave

        var id: String { rawValue }

        var title: String {
            switch self {
            case .stack: "Stack"
            case .wave: "Wave"
            }
        }

        var systemImage: String {
            switch self {
            case .stack: "rectangle.stack"
            case .wave: "water.waves"
            }
        }
    }

    var mode: Mode {
        didSet { if !launchMode { defaults.set(mode.rawValue, forKey: Keys.mode) } }
    }

    var zoom: JournalZoom {
        didSet { if !launchZoom { defaults.set(zoom.rawValue, forKey: Keys.zoom) } }
    }

    /// The wave's seconds per 1000 points, kept between visits and launches; nil until the wave was first shown.
    var waveScale: Double? {
        didSet { if !launchWave, let waveScale { defaults.set(waveScale, forKey: Keys.wave) } }
    }

    /// The wave's opening moment from the launch arguments.
    let waveAt: Double?

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let launchMode: Bool
    @ObservationIgnored private let launchZoom: Bool
    @ObservationIgnored private let launchWave: Bool

    private enum Keys {
        static let mode = "journal.browseMode"
        static let zoom = "journal.stackZoom"
        static let wave = "journal.waveScale"
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let modeArgument = JournalLaunch.string("FXJournalMode").flatMap { Mode(rawValue: $0.lowercased()) }
        let zoomArgument = JournalLaunch.string("FXJournalZoom").flatMap(JournalZoom.init(launch:))
        let waveArgument = JournalLaunch.string("FXJournalWaveZoom").flatMap(Self.waveSpan(launch:))
        launchMode = modeArgument != nil
        launchZoom = zoomArgument != nil
        launchWave = waveArgument != nil
        mode = modeArgument ?? defaults.string(forKey: Keys.mode).flatMap(Mode.init(rawValue:)) ?? .stack
        zoom = zoomArgument ?? defaults.string(forKey: Keys.zoom).flatMap(JournalZoom.init(rawValue:)) ?? .helion
        let saved = defaults.double(forKey: Keys.wave)
        waveScale = waveArgument ?? (saved > 0 ? saved : nil)
        waveAt = JournalLaunch.string("FXJournalWaveAt").flatMap(Double.init)
    }

    /// Seconds per 1000 points for a launch word: about one and a half cycles of that unit on a 700-point screen.
    static func waveSpan(launch text: String) -> Double? {
        let level: Int
        switch text.lowercased() {
        case "preon", "preons", "iota", "ι": level = 8
        case "helion", "helions", "eta", "η", "day": level = 6
        case "nuclide", "nuclides", "epsilon", "ε": level = 4
        case "delta", "deltas", "δ": level = 3
        case "gamma", "gammas", "γ": level = 2
        case "beta", "betas", "β": level = 1
        default: return Double(text)
        }
        return FractonicaClock.shared.levelInfo(level).meanSeconds * 1.5 / 700 * 1000
    }
}
