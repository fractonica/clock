import FractonicaKit
import Foundation

/// The Fractonica hierarchy as a just-intonation series (src/audio/tuning.js; pure, no audio framework).
///
/// The prefixes P(L) = 1, 5, 65, 325, 1625, … are frequency ratios: level L cycles P(L) times faster than α. Folding a
/// ratio into one octave (P / 2^⌊log₂ P⌋, reduced exactly on integers) gives the level's pitch class and the clock
/// becomes a chord. Every note answers "this is the cycle of depth N".
///
///     SoundTuning.pitchClass(1625)   // 1625/1024, 800 cents
///     SoundTuning.octaves            // the audited register: one octave number per depth, never decreasing
///     SoundTuning.rows()             // one row per depth: ratio, cents, octave, true rate
enum SoundTuning {
    /// Depths that have a voice (α … ξ).
    static let levelCount = 14
    static let defaultBaseHz = 110.0
    /// Two voices closer than this many cents (absolute pitch) would beat roughly.
    static let keepApartCents = 45.0
    /// A voice's 2nd harmonic is left out when it would land this close (cents) to another sounding fundamental.
    static let clashCents = 120.0
    /// Octave above the base pitch of every depth 1 … 14: the audited register of tuning.js (`OCTAVES`). ζ sits an
    /// octave above the automatic rule, clear of δ (a 26 Hz pair at the roughness maximum otherwise).
    static let octaves = [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4]

    /// A ratio folded into one octave, exactly: `num / den` in [1, 2), `cents` above the ground, `shift` octaves removed.
    struct PitchClass: Hashable, Sendable {
        let num: Int128
        let den: Int128
        let cents: Double
        let shift: Int

        var ratio: Double { Double(num) / Double(den) }
    }

    /// One depth of the chord.
    struct Row: Hashable, Sendable, Identifiable {
        let level: Int
        let depth: Int
        let letter: String
        let prefix: Int128
        let num: Int128
        let den: Int128
        /// Cents of the folded ratio above the ground, 0 ..< 1200.
        let pcCents: Double
        /// Octaves above the ground the voice is placed at.
        let octave: Int
        /// Frequency relative to the base pitch: 2^((pcCents + 1200 · octave) / 1200).
        let rel: Double
        /// Mean real length of one cycle (seconds) and its true rate (Hz).
        let cycleSeconds: Double
        let trueHz: Double
        /// How many cycles of the next depth one cycle holds.
        let factor: Int

        var id: Int { level }
        /// "1625:1024" (normal mode); pure mode writes it with a slash.
        var ratioText: String { "\(num):\(den)" }
        var slashText: String { "\(num)/\(den)" }
    }

    /// Folds P:1 into one octave on integers (tuning.js `pitchClass`).
    static func pitchClass(_ prefix: Int128) -> PitchClass {
        precondition(prefix >= 1, "a prefix is at least 1")
        let k = Int128.bitWidth - prefix.leadingZeroBitCount - 1
        let tz = prefix.trailingZeroBitCount
        let num = prefix >> tz
        let denExp = k - tz
        let den = Int128(1) << denExp
        let cents = 1200 * (log2(Double(num)) - Double(denExp))
        return PitchClass(num: num, den: den, cents: cents, shift: k)
    }

    /// The tuning table for depths 1 … `count`, from the clock's level facts.
    static func rows(clock: FractonicaClock = .shared, count: Int = levelCount) -> [Row] {
        (0..<count).map { level in
            let info = clock.levelInfo(level)
            let pc = pitchClass(info.prefix)
            let octave = octaves[min(level, octaves.count - 1)]
            return Row(
                level: level,
                depth: info.depth,
                letter: info.letter,
                prefix: info.prefix,
                num: pc.num,
                den: pc.den,
                pcCents: pc.cents,
                octave: octave,
                rel: pow(2, (pc.cents + 1200 * Double(octave)) / 1200),
                cycleSeconds: info.meanSeconds,
                trueHz: 1 / info.meanSeconds,
                factor: info.factor
            )
        }
    }

    /// The rows of the shared clock, built once.
    static let standard = SoundTuning.rows()

    /// The frequency of a row above a base pitch.
    static func frequency(_ row: Row, baseHz: Double) -> Double { baseHz * row.rel }

    /// The base pitch of a slider position: `semitones` steps of 100 cents around 110 Hz (−12 … 12).
    static func baseHz(semitones: Int) -> Double { defaultBaseHz * pow(2, Double(semitones) / 12) }

    // MARK: Loudness compensation

    private static let weightTable: [(hz: Double, db: Double)] = [
        (40, 10), (80, 9.5), (160, 6), (320, 2.5), (640, 0.5), (1280, -1), (2560, -3.5), (5120, -5), (10240, -9),
    ]

    /// Linear gain so voices at different registers sound about equally loud at a quiet listening level: the bass is
    /// boosted (capped), the 2 – 4 kHz region trimmed (tuning.js `weightFor`).
    static func weight(for freq: Double) -> Double {
        let table = weightTable
        let f = min(max(freq, table[0].hz), table[table.count - 1].hz)
        var i = 1
        while i < table.count - 1 && f > table[i].hz { i += 1 }
        let (f0, d0) = table[i - 1]
        let (f1, d1) = table[i]
        let u = (log2(f) - log2(f0)) / (log2(f1) - log2(f0))
        return pow(10, (d0 + (d1 - d0) * u) / 20)
    }

    /// Bells ring an octave above their voice, folded into 60 Hz … 4.2 kHz; the valley bell is derived from that
    /// folded note and sounds an octave below it, so a quarter's identity is audible at every depth.
    static func chimeFrequency(_ freq: Double, valley: Bool) -> Double {
        var up = freq * 2
        while up > 4200 { up /= 2 }
        while up < 60 { up *= 2 }
        return valley ? up / 2 : up
    }

    /// Which voices must leave out their 2nd harmonic: 2f lies within `maxCents` of another sounding fundamental
    /// (an exact coincidence counts too). `on` says which levels sound.
    static func clashingHarmonics(_ freqs: [Double], on: [Bool], maxCents: Double = clashCents) -> [Bool] {
        freqs.indices.map { i in
            guard on[i] else { return false }
            return freqs.indices.contains { j in
                j != i && on[j] && abs(1200 * log2(2 * freqs[i] / freqs[j])) < maxCents
            }
        }
    }

    // MARK: Physical register

    /// A cycle whose true rate, transposed by whole octaves, can be heard.
    struct Physical: Hashable, Sendable {
        let level: Int
        let letter: String
        /// The sounding (transposed) frequency and the true rate, Hz.
        let hz: Double
        let trueHz: Double
    }

    /// Cycles of any depth up to `maxLevel` whose true rate × 2^shift falls inside [lo, hi] Hz.
    static func physicalLevels(clock: FractonicaClock = .shared, shift: Int, lo: Double = 25, hi: Double = 6000, maxLevel: Int = 16) -> [Physical] {
        (0...maxLevel).compactMap { level in
            let info = clock.levelInfo(level)
            let trueHz = 1 / info.meanSeconds
            let hz = trueHz * pow(2, Double(shift))
            guard hz >= lo, hz <= hi else { return nil }
            return Physical(level: level, letter: info.letter, hz: hz, trueHz: trueHz)
        }
    }

    /// The true rates (Hz) of the deepest cycles, for the physical register's explanation: ξ ο π ρ.
    static func deepRates(clock: FractonicaClock = .shared) -> [(letter: String, hz: Double)] {
        (13...16).map { (clock.levelInfo($0).letter, 1 / clock.levelInfo($0).meanSeconds) }
    }

    // MARK: Note names (normal mode only)

    private static let noteNames = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]

    /// The equal-tempered note nearest a frequency (A4 = 440 Hz) and the cents it is off.
    static func note(of freq: Double) -> (name: String, cents: Int, midi: Int) {
        let midi = 69 + 12 * log2(freq / 440)
        let n = Int(midi.rounded())
        let cents = Int(((midi - Double(n)) * 100).rounded())
        let octave = Int((Double(n) / 12).rounded(.down)) - 1
        return (noteNames[((n % 12) + 12) % 12] + String(octave), cents, n)
    }

    /// "F4 −1¢".
    static func noteLabel(_ freq: Double) -> String {
        let n = note(of: freq)
        let c = n.cents == 0 ? "±0" : n.cents > 0 ? "+\(n.cents)" : "−\(-n.cents)"
        return "\(n.name) \(c)¢"
    }
}
