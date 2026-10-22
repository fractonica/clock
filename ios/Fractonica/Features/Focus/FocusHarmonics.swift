import FractonicaKit
import Foundation

/// What Focus draws in one frame: every level's place in its cycle, how visible it can be at this frame rate, the
/// boundary ripples and the breathing cue. Pure logic (no UI, no GPU), checked by Checks/FocusChecks.swift.
///
/// Levels 0 … 12 (α … ν) are exact engine readings at the displayed time, one `level(at:)` per level per frame. The
/// depths below the Blink, ξ ο π (levels 13 … 15), are continuous phases at their true rates (7, 77 and 693 cycles per
/// ν, SPEC §15.5) measured from the start of the running ν cycle, so they stay smooth below the engine's 1 ms grain.
struct FocusHarmonics: Sendable, Equatable {
    /// Levels the renderer receives: α (0) … π (15).
    static let levelCount = 16
    /// Levels read from the engine.
    static let engineLevels = 0...12
    /// ξ, ο and π: cycles per ν (true rates).
    static let subBlinkPerBlink: [Double] = [7, 77, 693]
    /// The Flavon, whose cycle (≈ 7.8 s) paces the breathing cue.
    static let breathLevel = 10
    /// Real seconds a boundary ripple lasts.
    static let rippleLifetime = 2.6
    /// A level ripples at its boundaries only while one cycle lasts at least this many real seconds (λ at real speed
    /// does, μ does not): faster boundaries would ripple all the time.
    static let rippleMinimumCycle = 3.0

    struct Level: Sendable, Equatable {
        /// 0 ..< 1 through the running cycle.
        var phase = 0.0
        /// 0 … 1: how much of the level the picture may show. Levels whose phase moves more than about a fifth of a
        /// cycle per frame alias into noise and fade out (a time-lapse fades the fast levels, Reduce Motion the lively
        /// ones); the sub-Blink depths are a shimmer whose strength is `shimmer`.
        var amplitude = 0.0
        /// 0 … 1: strength left of the ripple of the last boundary (0 when none).
        var ripple = 0.0
        /// Real seconds since that boundary.
        var rippleAge = 0.0
    }

    /// One frame's inputs.
    struct Input: Sendable {
        /// The displayed time, Unix seconds.
        var t: Double
        /// Displayed seconds per real second: 1 live, 0 paused, anything else a time-lapse.
        var rate: Double
        /// The real instant of the frame, Unix seconds (the breathing cue's fallback clock).
        var real: Double
        /// Real seconds between frames.
        var frameInterval: Double
        /// Real seconds since the displayed time last jumped (a boundary crossed by a jump does not ripple).
        var sinceDiscontinuity: Double
        /// Reduce Motion: the lively levels, ripples and shimmer rest.
        var calm = false
        /// The breathing cue is wanted.
        var breathing = true
    }

    var levels = [Level](repeating: Level(), count: FocusHarmonics.levelCount)
    /// The displayed time has readings (inside the catalogue).
    var inRange = false
    /// 0 … 1: lungs empty … full, following the Flavon's wave (full at its peak, empty at its valley).
    var breath = 0.5
    /// The Flavon is rising (breathe in) rather than falling (breathe out).
    var inhaling = true
    /// 0 … 1: how strongly the breathing cue shows.
    var breathCue = 0.0
    /// 0 … 1: the sub-Blink shimmer's strength.
    var shimmer = 0.0

    init() {}

    /// Recomputes every value for a frame, in place (no allocation of its own).
    mutating func update(_ input: Input, clock: FractonicaClock = .shared) {
        let speed = abs(input.rate)
        var blink: LevelReading?
        inRange = true
        for level in Self.engineLevels {
            guard let reading = clock.level(at: input.t, level) else {
                inRange = false
                break
            }
            levels[level] = Self.state(of: reading, input: input, speed: speed)
            if level == 12 { blink = reading }
        }
        guard inRange, let blink else {
            for i in levels.indices { levels[i] = Level() }
            shimmer = 0
            breathCue = 0
            return
        }

        // ξ ο π from the running ν cycle.
        shimmer = input.calm ? 0 : 1 - Self.smoothstep(2, 12, speed)
        let intoBlink = max(0, input.t - blink.start)
        for (k, perBlink) in Self.subBlinkPerBlink.enumerated() {
            let cycle = blink.duration / perBlink
            let phase = cycle > 0 ? (intoBlink / cycle).truncatingRemainder(dividingBy: 1) : 0
            levels[13 + k] = Level(phase: phase, amplitude: shimmer, ripple: 0, rippleAge: 0)
        }

        // The breath follows the displayed Flavon while the displayed time runs at real speed, else the live one.
        let flavon: Double?
        if abs(input.rate - 1) < 1e-9 {
            flavon = levels[Self.breathLevel].phase
        } else {
            flavon = clock.level(at: input.real, Self.breathLevel)?.phase
        }
        if let flavon, input.breathing {
            let wave = sin(2 * .pi * flavon)
            breath = 0.5 + 0.5 * wave
            inhaling = cos(2 * .pi * flavon) > 0
            breathCue = 1
        } else {
            breath = 0.5
            inhaling = true
            breathCue = 0
        }
    }

    /// Phase, visibility and ripple of one engine level.
    static func state(of reading: LevelReading, input: Input, speed: Double) -> Level {
        var out = Level(phase: reading.phase, amplitude: 1, ripple: 0, rippleAge: 0)
        let duration = max(reading.duration, 1e-9)
        out.amplitude = 1 - smoothstep(0.08, 0.25, speed * input.frameInterval / duration)
        if input.calm, reading.level >= 11 { out.amplitude = 0 }
        if input.calm, reading.level == 10 { out.amplitude *= 0.35 }

        guard !input.calm, speed > 0 else { return out }
        let realCycle = duration / speed
        guard realCycle >= rippleMinimumCycle else { return out }
        let displayedAge = input.rate > 0 ? input.t - reading.start : reading.end - input.t
        let age = displayedAge / speed
        guard age >= 0, age < rippleLifetime, age <= input.sinceDiscontinuity else { return out }
        let fade = 1 - age / rippleLifetime
        out.ripple = fade * fade * rippleWeight(reading.level)
        out.rippleAge = age
        return out
    }

    /// Coarser boundaries ripple more strongly.
    static func rippleWeight(_ level: Int) -> Double {
        min(1, 0.4 + 0.1 * Double(max(0, 10 - level)))
    }

    static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let u = min(1, max(0, (x - a) / (b - a)))
        return u * u * (3 - 2 * u)
    }
}
