import FractonicaKit
import Foundation

/// What the sonification plays and when (src/audio/schedule.js; pure, no audio framework):
///
///  - the glyph wave as a loudness curve: `triangle(phase)` → `loudness(x)`, and how faithfully a voice follows its
///    cycle at the rate it runs in real time (`amWeight`);
///  - chime events: every quarter threshold (peak, node, valley, end) of a sounding level inside a window of displayed
///    time, merged when several levels turn over together, so a major boundary is one chord;
///  - the linear map between displayed time and audio frames, and the tempo lock.
///
/// Quarter i of a level lies at position i / P(L) Saros (i mod 4: 1 peak, 2 node, 3 valley, 0 end — the end of one
/// cycle is the start of the next).
enum SoundSchedule {
    /// What a bell marks. The first four are the quarter kinds in the order of `i mod 4`.
    enum Kind: UInt8, Sendable, CaseIterable {
        case end, peak, node, valley, moment

        static func ofQuarter(_ i: Int64) -> Kind { [.end, .peak, .node, .valley][Int(((i % 4) + 4) % 4)] }
    }

    /// Cycle ends this close together (seconds) are one chord event.
    static let mergeEps = 5e-4

    // MARK: The glyph wave as a loudness curve

    /// The phase glyph wave normalised to [−1, 1] (ascending family, SPEC §4.1): 0 at the start, +1 at the peak, 0 at
    /// the node, −1 at the valley, back to 0.
    static func triangle(_ phase: Double) -> Double {
        let p = phase - phase.rounded(.down)
        if p < 0.25 { return 4 * p }
        if p < 0.75 { return 2 - 4 * p }
        return 4 * p - 4
    }

    /// +1 rising through the start node, −1 falling through the middle node, 0 at the extrema.
    static func directionCue(_ phase: Double) -> Double { cos(2 * .pi * phase) }

    static let loudnessCurve = 1.6

    /// Loudness 0 … 1 from the glyph value x in [−1, 1]: silent at the valley, full at the peak.
    static func loudness(_ x: Double, curve: Double = loudnessCurve) -> Double {
        pow((min(1, max(-1, x)) + 1) / 2, curve)
    }

    /// Mean loudness over a whole cycle: 1 / (curve + 1).
    static func meanLoudness(curve: Double = loudnessCurve) -> Double { 1 / (curve + 1) }

    /// The real-time rate (Hz) of a level's cycle at `rate` displayed seconds per real second.
    static func cycleHz(meanSeconds: Double, rate: Double) -> Double { abs(rate) / meanSeconds }

    /// Modulation up to this real-time rate is reproduced at full depth: ξ's true 22.5 Hz stays exact.
    static let amFullHz = 25.0
    /// From this rate on a voice no longer follows its cycle and rests at its mean loudness.
    static let amNoneHz = 32.0

    /// How faithfully a voice follows its cycle at `hz`: 1 up to 25 Hz, 0 from 32 Hz, a short cross-fade between (a
    /// deep modulation between 30 and 80 Hz is a buzz, not a rhythm).
    static func amWeight(_ hz: Double) -> Double {
        if hz <= amFullHz { return 1 }
        if hz >= amNoneHz { return 0 }
        return (amNoneHz - hz) / (amNoneHz - amFullHz)
    }

    /// What a voice does at a real-time cycle rate, for words in the UI.
    enum AMZone: Sendable { case full, fade, rest }

    static func amZone(_ hz: Double) -> AMZone {
        hz <= amFullHz ? .full : hz >= amNoneHz ? .rest : .fade
    }

    /// The loudness heard for a voice at `phase` while its cycle runs at `hz` (real time); `floor` keeps that much of
    /// the voice at its valley.
    static func voiceLoudness(phase: Double, hz: Double, curve: Double = loudnessCurve, floor: Double = 0) -> Double {
        let w = amWeight(hz)
        let v = w * loudness(triangle(phase), curve: curve) + (1 - w) * meanLoudness(curve: curve)
        return floor + (1 - floor) * v
    }

    /// The brightness cue is only audible for slow cycles: it fades out between 1 and 8 Hz.
    static func directionWeight(_ hz: Double) -> Double { min(1, max(0, 1 - (hz - 1) / 7)) }

    /// Continuous phase of a level from the catalogue position (cheap, float): frac(position · P / 4).
    static func phase(position: Double, prefix: Double) -> Double {
        let x = position * prefix / 4
        return x - x.rounded(.down)
    }

    // MARK: Chimes

    /// The calm default chime floor, real seconds.
    static let defaultFloor = 0.5

    /// Which thresholds of a level chime at this rate.
    enum ChimeMode: Sendable { case quarters, ends }

    /// `.quarters` when a quarter lasts at least `floor` real seconds, `.ends` when the whole cycle does, else nil.
    static func chimeMode(meanSeconds: Double, rate: Double, floor: Double = defaultFloor) -> ChimeMode? {
        let r = abs(rate)
        guard r > 0 else { return nil }
        let period = meanSeconds / r
        if period / 4 >= floor { return .quarters }
        if period >= floor { return .ends }
        return nil
    }

    /// How major an event is, 0 … 1: the base weight of its top threshold plus a saturating bonus for every further
    /// cycle ending at the same instant (one end is a bell, eight ends a big chord).
    static func eventStrength(_ kind: Kind, ends: Int = 0) -> Double {
        let base: Double = switch kind {
        case .peak: 0.52
        case .node: 0.34
        case .valley: 0.44
        case .end: 0.62
        case .moment: 0.4
        }
        guard ends > 1 else { return base }
        return min(1, base + (1 - base) * (1 - pow(0.78, Double(ends - 1))))
    }

    /// Coarse cycles ring bigger than fine ones: 1 at α down to 0.55 at ξ.
    static func bellTaper(_ level: Int) -> Double { 0.55 + 0.45 * (1 - Double(min(13, max(0, level))) / 13) }

    /// One threshold of a level inside an event.
    struct Part: Hashable, Sendable {
        let level: Int
        let kind: Kind
    }

    /// Thresholds that happen together: `top` is the coarsest level, `parts` coarse to fine.
    struct Event: Hashable, Sendable {
        let time: Double
        let kind: Kind
        let top: Int
        let parts: [Part]
        let ends: Int
        let strength: Double

        var levels: [Int] { parts.map(\.level) }
    }

    /// Time of quarter `i` of `level` (model.js `cycleStartTime(level, i / 4)`, the same float steps); nil beyond the
    /// catalogue end or before its start.
    static func quarterTime(clock: FractonicaClock, level: Int, quarter i: Int64) -> Double? {
        guard i >= 0 else { return nil }
        let p = clock.levelInfo(level).prefixDouble
        let n = Double(i)
        let k = (n / p).rounded(.down)
        let extent = Double(clock.extent)
        if k > extent { return nil }
        if k == extent { return n - k * p == 0 ? clock.tMax : nil }
        let e = clock.catalogue
        let ki = Int(k)
        let f = (n - k * p) / p
        return e[ki] + f * (e[ki + 1] - e[ki])
    }

    /// Chime events of the sounding `levels` in the half-open window (tA, tB] of displayed time, sorted by time.
    /// `rate` decides which levels are slow enough to chime (`chimeMode`); nothing outside the catalogue.
    static func events(clock: FractonicaClock = .shared, from tA: Double, to tB: Double, levels: [Int], rate: Double,
                       floor: Double = defaultFloor, limit: Int = 2000) -> [Event] {
        guard tB > tA else { return [] }
        let lo = max(tA, clock.tMin)
        let hi = min(tB, clock.tMax)
        guard hi > lo, let pLo = clock.position(at: lo), let pHi = clock.position(at: hi) else { return [] }

        var raw: [(time: Double, level: Int, kind: Kind)] = []
        for level in levels {
            let info = clock.levelInfo(level)
            guard let mode = chimeMode(meanSeconds: info.meanSeconds, rate: rate, floor: floor) else { continue }
            let p = info.prefixDouble
            let first = max(0, Int64((pLo * p).rounded(.down)) - 1)
            let last = Int64((pHi * p).rounded(.up)) + 1
            let step: Int64 = mode == .ends ? 4 : 1
            var i = mode == .ends ? (first / 4) * 4 : first
            while i <= last {
                guard let time = quarterTime(clock: clock, level: level, quarter: i) else { break }
                if time > lo && time <= hi { raw.append((time, level, Kind.ofQuarter(i))) }
                i += step
            }
        }
        raw.sort { $0.time != $1.time ? $0.time < $1.time : $0.level < $1.level }

        var out: [Event] = []
        var k = 0
        while k < raw.count {
            var j = k + 1
            while j < raw.count && raw[j].time - raw[k].time <= mergeEps { j += 1 }
            let group = raw[k..<j].sorted { $0.level < $1.level }
            let top = group[group.startIndex]
            let ends = group.filter { $0.kind == .end }.count
            out.append(Event(
                time: top.time,
                kind: top.kind,
                top: top.level,
                parts: group.map { Part(level: $0.level, kind: $0.kind) },
                ends: ends,
                strength: eventStrength(top.kind, ends: ends)
            ))
            k = j
            if out.count >= limit { break }
        }
        return out
    }

    // MARK: Displayed time ↔ audio frames

    /// t = t0 + rate · (frame − frame0) / sampleRate: the displayed time of an audio frame and back.
    struct ClockMap: Hashable, Sendable {
        var frame0: Double
        var t0: Double
        var rate: Double
        var sampleRate: Double

        func time(atFrame frame: Double) -> Double { t0 + rate * (frame - frame0) / sampleRate }

        /// The frame of displayed time `t`; infinite while paused.
        func frame(atTime t: Double) -> Double {
            rate == 0 ? .infinity : frame0 + (t - t0) / rate * sampleRate
        }
    }

    // MARK: Tempo lock

    /// The time-lapse rate that makes one cycle of `depth` last `seconds` of real time: the hierarchy becomes nested
    /// rhythm (quarters are pulses, finer levels the subdivisions 5 : 13 : 5 : 5 : 7 : 11 : 9 : 4 …).
    static func tempoRate(clock: FractonicaClock = .shared, depth: Int, seconds: Double) -> Double {
        clock.levelInfo(depth - 1).meanSeconds / seconds
    }

    /// A rate in musical terms for the cycle of `depth`.
    struct Tempo: Hashable, Sendable {
        /// Real seconds per cycle, per quarter (the beat), quarters per minute.
        let cycle: Double
        let beat: Double
        let bpm: Double
        /// Real seconds per cycle of the next finer level, and how many of them one cycle holds.
        let child: Double
        let childPerCycle: Int
    }

    static func tempo(clock: FractonicaClock = .shared, depth: Int, rate: Double) -> Tempo {
        let info = clock.levelInfo(depth - 1)
        let r = abs(rate)
        let cycle = r > 0 ? info.meanSeconds / r : .infinity
        let beat = cycle / 4
        return Tempo(cycle: cycle, beat: beat, bpm: r > 0 ? 60 / beat : 0, child: cycle / Double(info.factor), childPerCycle: info.factor)
    }
}
