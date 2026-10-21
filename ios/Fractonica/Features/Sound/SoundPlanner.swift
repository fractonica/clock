import Foundation

/// Turns what should sound into commands for the renderer (the planning half of src/audio/engine.js; pure, so the
/// logic checks run it): the drone voices of a set of preferences, the bells of a chime event, the arpeggio of "Hear
/// this moment" and the voices of the physical register.
enum SoundPlanner {
    static let chimeAmp = 0.44
    static let momentAmp = 0.48
    static let physicalAmp = 0.07

    /// Stereo place of a level: coarse cycles left, fine ones right, within ±0.45.
    static func pan(_ level: Int, spread: Double = 0.45) -> Double {
        (Double(level) / 13 - 0.5) * 2 * spread
    }

    /// The drone voices for `prefs`: pitch, loudness compensation, whether each sounds and where its 2nd harmonic would
    /// beat against another sounding voice (`clashingHarmonics`, from the set that sounds).
    static func voices(_ prefs: SoundPreferences, rows: [SoundTuning.Row] = SoundTuning.standard) -> [SoundVoiceConfig] {
        let freqs = rows.map { SoundTuning.frequency($0, baseHz: prefs.baseHz) }
        let skip = SoundTuning.clashingHarmonics(freqs, on: rows.map { prefs.levels[$0.level] })
        return rows.map { row in
            SoundVoiceConfig(
                level: Int32(row.level),
                hz: freqs[row.level],
                weight: Float(SoundTuning.weight(for: freqs[row.level])),
                on: prefs.levels[row.level],
                noHarmonic: skip[row.level],
                floor: Float(prefs.voiceFloors[row.level]),
                pan: Float(pan(row.level))
            )
        }
    }

    /// One bell per part of a chime event, strummed coarse → fine 15 ms apart in real time (fine → coarse while the
    /// clock runs backwards); the more cycles end together, the louder and longer it rings. Times are displayed time,
    /// so a strum offset of `spacing` real seconds is `spacing · rate` displayed seconds.
    static func bells(for event: SoundSchedule.Event, prefs: SoundPreferences, rate: Double, epoch: UInt32,
                      rows: [SoundTuning.Row] = SoundTuning.standard) -> [SoundBell] {
        let parts = rate < 0 ? Array(event.parts.reversed()) : event.parts
        let n = parts.count
        let spacing = min(0.015, 0.24 / Double(max(1, n)))
        let grow = 1 + 0.28 * log(Double(max(1, event.ends)))
        return parts.enumerated().compactMap { i, part in
            guard part.level < rows.count else { return nil }
            let voice = SoundTuning.frequency(rows[part.level], baseHz: prefs.baseHz)
            let hz = SoundTuning.chimeFrequency(voice, valley: part.kind == .valley)
            let recipe = SoundRenderer.recipe(part.kind.rawValue)
            let amp = chimeAmp * Double(recipe.gain) * event.strength * pow(Double(n), -0.35)
                * SoundSchedule.bellTaper(part.level) * SoundTuning.weight(for: hz)
            return SoundBell(
                t: event.time + Double(i) * spacing * rate,
                host: 0,
                hz: Float(hz),
                amp: Float(amp),
                decay: recipe.decay * Float(grow) * (hz < 300 ? 1.2 : 1),
                pan: Float(pan(part.level)),
                kind: part.kind.rawValue,
                level: Int8(part.level),
                epoch: epoch,
                moment: false
            )
        }
    }

    /// One note of "Hear this moment": its level, when it starts (seconds after the first) and how loud it is (the
    /// height of its cycle's glyph wave right now, 0.06 … 1).
    struct MomentNote: Hashable, Sendable {
        let level: Int
        let offset: Double
        let loudness: Double
    }

    /// The arpeggio of the chord at displayed time `t`, α → the finest sounding voice (every voice when none sounds);
    /// nil outside the catalogue.
    static func moment(at t: Double, prefs: SoundPreferences, clock: FractonicaClockFacts = .standard,
                       position: (Double) -> Double?) -> [MomentNote]? {
        guard let pos = position(t) else { return nil }
        var levels = prefs.soundingLevels
        if levels.isEmpty { levels = Array(0..<SoundTuning.levelCount) }
        let step = min(0.4, max(0.12, 2.2 / Double(levels.count)))
        return levels.enumerated().map { i, level in
            let phase = SoundSchedule.phase(position: pos, prefix: clock.prefixes[level])
            let loud = 0.06 + 0.94 * SoundSchedule.loudness(SoundSchedule.triangle(phase))
            return MomentNote(level: level, offset: Double(i) * step, loudness: loud)
        }
    }

    /// How long a moment rings after its first note.
    static func momentLength(_ notes: [MomentNote]) -> Double {
        (notes.last?.offset ?? 0) + Double(SoundRenderer.recipe(SoundSchedule.Kind.moment.rawValue).decay) + 0.2
    }

    /// The bells of a moment, starting at host time `start` (`host(offset)` converts a delay to host time).
    static func momentBells(_ notes: [MomentNote], prefs: SoundPreferences, host: (Double) -> UInt64,
                            rows: [SoundTuning.Row] = SoundTuning.standard) -> [SoundBell] {
        let recipe = SoundRenderer.recipe(SoundSchedule.Kind.moment.rawValue)
        let count = notes.count
        return notes.enumerated().map { i, note in
            let hz = SoundTuning.frequency(rows[note.level], baseHz: prefs.baseHz)
            return SoundBell(
                t: 0,
                host: host(note.offset),
                hz: Float(hz),
                amp: Float(momentAmp * note.loudness * SoundTuning.weight(for: hz)),
                decay: recipe.decay,
                pan: Float(count > 1 ? (Double(i) / Double(count - 1) - 0.5) * 1.2 : 0),
                kind: SoundSchedule.Kind.moment.rawValue,
                level: Int8(note.level),
                epoch: 0,
                moment: true
            )
        }
    }

    /// The physical register for `prefs`: the frequency and gain of every audible cycle (nothing when off).
    static func physicalWanted(_ prefs: SoundPreferences, on: Bool) -> [(hz: Double, gain: Double)] {
        guard on && prefs.physical else { return [] }
        return SoundTuning.physicalLevels(shift: prefs.physShift).map { ($0.hz, physicalAmp * SoundTuning.weight(for: $0.hz)) }
    }
}

/// Which renderer slot plays which voice of the physical register. A voice that changes pitch never glides inside its
/// slot: the old one fades out where it is and the new one starts in a slot that has rested for a while.
struct SoundPhysicalSlots: Sendable {
    struct Slot: Sendable {
        var hz = 0.0
        var gain = 0.0
        var freedAt = -Double.infinity
    }

    /// How long a slot rests after fading out before it is used again (its tail is then below −60 dB).
    static let rest = 0.35
    private(set) var slots = Array(repeating: Slot(), count: SoundRenderer.physicalSlots)

    /// Assigns the wanted voices at real time `now` (seconds); returns the changes for the renderer.
    mutating func assign(_ wanted: [(hz: Double, gain: Double)], now: Double) -> [(slot: Int, hz: Double, gain: Double)] {
        var out: [(slot: Int, hz: Double, gain: Double)] = []
        var keep = Set<Int>()
        for want in wanted {
            if let i = slots.indices.first(where: { slots[$0].gain > 0 && abs(slots[$0].hz - want.hz) < 1e-6 && !keep.contains($0) }) {
                keep.insert(i)
                if slots[i].gain != want.gain {
                    slots[i].gain = want.gain
                    out.append((i, want.hz, want.gain))
                }
            }
        }
        for i in slots.indices where slots[i].gain > 0 && !keep.contains(i) {
            slots[i].gain = 0
            slots[i].freedAt = now
            out.append((i, slots[i].hz, 0))
        }
        for want in wanted where !slots.contains(where: { $0.gain > 0 && abs($0.hz - want.hz) < 1e-6 }) {
            let free = slots.indices.filter { slots[$0].gain == 0 }
            let rested = free.filter { now - slots[$0].freedAt >= Self.rest }
            guard let i = (rested.isEmpty ? free : rested).min(by: { slots[$0].freedAt < slots[$1].freedAt }) else { break }
            slots[i] = Slot(hz: want.hz, gain: want.gain, freedAt: slots[i].freedAt)
            out.append((i, want.hz, want.gain))
        }
        return out
    }
}
