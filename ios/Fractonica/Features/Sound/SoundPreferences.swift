import Foundation

/// What the user chose for the sound (src/audio/settings.js), persisted in UserDefaults under `sound.v1` as one JSON
/// value. Every value is validated like the web panel's `sanitize`: a missing, mistyped or out-of-range value keeps its
/// default (or is clamped into its range), so garbage in storage can never reach the audio thread.
struct SoundPreferences: Codable, Equatable, Sendable {
    /// Master volume in dB (the default is quiet).
    var volumeDb = -18.0
    /// Reverb amount, 0 … 1.
    var reverb = 0.22
    /// Layers: the drone chord, the bells at the thresholds, the true rates of the deepest cycles.
    var chord = true
    var chimes = true
    var physical = false
    /// Whole octaves the physical register is transposed by.
    var physShift = -1
    /// Base pitch in steps of 100 cents around 110 Hz (−12 … 12: 55 … 220 Hz).
    var baseSemitones = 0
    /// Chime floor: a level rings only while its quarters (or at least its cycles) last this many real seconds.
    var floor = SoundSchedule.defaultFloor
    /// Which depths 1 … 14 sound (index = level).
    var levels: [Bool] = (0..<SoundTuning.levelCount).map { $0 < 12 }
    /// Per depth: how much of the voice stays at its cycle's valley (0 … 0.5); 0 is the web app's silent valley.
    var voiceFloors: [Double] = Array(repeating: 0, count: SoundTuning.levelCount)
    /// Tempo lock: make one cycle of `tempoDepth` last `tempoSeconds` of real time.
    var tempoDepth = 7
    var tempoSeconds = 4.0
    /// iOS: keep sounding while the app is in the background.
    var backgroundPlay = true

    static let volumeRange = -48.0 ... -3.0
    static let reverbRange = 0.0 ... 1.0
    static let physShiftRange = -3 ... 3
    static let semitoneRange = -12 ... 12
    static let floorRange = 0.03 ... 2.0
    static let voiceFloorRange = 0.0 ... 0.5
    static let tempoDepthRange = 2 ... 14
    static let tempoSecondsRange = 0.25 ... 600.0

    /// The chime floors offered, real seconds, with the words of the web panel.
    static let floors: [(seconds: Double, name: String?)] = [
        (0.05, "dense"), (0.12, "lively"), (0.25, nil), (0.5, "default"), (1, "sparse"),
    ]

    var baseHz: Double { SoundTuning.baseHz(semitones: baseSemitones) }
    var volumeGain: Double { pow(10, volumeDb / 20) }

    /// The floor offered closest to the stored one.
    var nearestFloor: Double {
        Self.floors.map(\.seconds).min { abs($0 - floor) < abs($1 - floor) } ?? SoundSchedule.defaultFloor
    }

    /// The levels that sound, ascending.
    var soundingLevels: [Int] { levels.indices.filter { levels[$0] } }

    init() {}

    /// Reads what it can; anything invalid keeps its default.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func read<T: Decodable>(_ key: CodingKeys, _ type: T.Type) -> T? { (try? c.decodeIfPresent(type, forKey: key)) ?? nil }
        var v = SoundPreferences()
        if let x = read(.volumeDb, Double.self) { v.volumeDb = x }
        if let x = read(.reverb, Double.self) { v.reverb = x }
        if let x = read(.chord, Bool.self) { v.chord = x }
        if let x = read(.chimes, Bool.self) { v.chimes = x }
        if let x = read(.physical, Bool.self) { v.physical = x }
        if let x = read(.physShift, Int.self) { v.physShift = x }
        if let x = read(.baseSemitones, Int.self) { v.baseSemitones = x }
        if let x = read(.floor, Double.self) { v.floor = x }
        if let x = read(.levels, [Bool].self) { v.levels = x }
        if let x = read(.voiceFloors, [Double].self) { v.voiceFloors = x }
        if let x = read(.tempoDepth, Int.self) { v.tempoDepth = x }
        if let x = read(.tempoSeconds, Double.self) { v.tempoSeconds = x }
        if let x = read(.backgroundPlay, Bool.self) { v.backgroundPlay = x }
        self = v.sanitized()
    }

    /// Every value clamped into its range; a non-finite number or a list of the wrong length takes the default.
    func sanitized() -> SoundPreferences {
        let d = SoundPreferences()
        var v = self
        func number(_ x: Double, _ range: ClosedRange<Double>, _ fallback: Double) -> Double {
            x.isFinite ? min(range.upperBound, max(range.lowerBound, x)) : fallback
        }
        func integer(_ x: Int, _ range: ClosedRange<Int>) -> Int { min(range.upperBound, max(range.lowerBound, x)) }
        v.volumeDb = number(v.volumeDb, Self.volumeRange, d.volumeDb)
        v.reverb = number(v.reverb, Self.reverbRange, d.reverb)
        v.physShift = integer(v.physShift, Self.physShiftRange)
        v.baseSemitones = integer(v.baseSemitones, Self.semitoneRange)
        v.floor = number(v.floor, Self.floorRange, d.floor)
        if v.levels.count != SoundTuning.levelCount { v.levels = d.levels }
        if v.voiceFloors.count != SoundTuning.levelCount {
            v.voiceFloors = d.voiceFloors
        } else {
            v.voiceFloors = v.voiceFloors.map { number($0, Self.voiceFloorRange, 0) }
        }
        v.tempoDepth = integer(v.tempoDepth, Self.tempoDepthRange)
        v.tempoSeconds = number(v.tempoSeconds, Self.tempoSecondsRange, d.tempoSeconds)
        return v
    }

    // MARK: Persistence

    static let storageKey = "sound.v1"

    static func load(from defaults: UserDefaults = .standard) -> SoundPreferences {
        guard let data = defaults.data(forKey: storageKey),
              let saved = try? JSONDecoder().decode(SoundPreferences.self, from: data) else { return SoundPreferences() }
        return saved
    }

    func save(to defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(sanitized()) { defaults.set(data, forKey: Self.storageKey) }
    }
}

/// Depth ranges offered as one tap in the mixer (settings.js `PRESETS`).
enum SoundPreset: String, CaseIterable, Identifiable, Sendable {
    case slow, standard, all

    var id: String { rawValue }

    /// First and last depth.
    var depths: ClosedRange<Int> {
        switch self {
        case .slow: 1...7
        case .standard: 1...12
        case .all: 1...14
        }
    }

    var title: String {
        switch self {
        case .slow: "Slow"
        case .standard: "Default"
        case .all: "All"
        }
    }

    /// "1–7".
    var range: String { "\(depths.lowerBound)–\(depths.upperBound)" }

    var levels: [Bool] { (0..<SoundTuning.levelCount).map { depths.contains($0 + 1) } }

    /// The preset a level mask equals, if any.
    static func matching(_ levels: [Bool]) -> SoundPreset? {
        allCases.first { $0.levels == levels }
    }
}
