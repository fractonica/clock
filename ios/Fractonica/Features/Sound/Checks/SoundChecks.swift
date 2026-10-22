import FractonicaKit
import Foundation

// The sound's logic against the web app's (test/sound.test.js) and the renderer listened to offline: tuning, loudness,
// chime events (SPEC §12 vector A), the planner, preferences, the pure-mode wording, and the synthesiser rendered into
// buffers and measured — non-silence, no NaN or clipping, spectral peaks at the tuned pitches, ξ's 22.5 Hz modulation,
// the depth-7 end as a strummed chord starting on its sample, the polyphony cap, pause, jumps without clicks, the
// out-of-range silence, the reverb tail, and the cost per second of audio.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Sound/Checks

@main @MainActor
struct SoundChecks {
    static func main() {
        tuningChecks()
        loudnessChecks()
        eventChecks()
        plannerChecks()
        geometryChecks()
        preferenceChecks()
        wordChecks()
        pureWordChecks()
        renderChecks()
        Checks.finish()
    }
}

let clock = FractonicaClock.shared
let vectorA = 1_791_460_800.0
let etaEnd = 1_791_464_172.428
let table = SoundTuning.standard

func near(_ a: Double, _ b: Double, _ eps: Double, _ what: String, file: StaticString = #fileID, line: UInt = #line) {
    check(abs(a - b) <= eps, "\(what): \(a) vs \(b) (±\(eps))", file: file, line: line)
}

// MARK: - Tuning

func tuningChecks() {
    let want: [(String, Double)] = [("1/1", 0), ("5/4", 386), ("65/64", 27), ("325/256", 413), ("1625/1024", 800),
                                    ("11375/8192", 568), ("125125/65536", 1120), ("1126125/1048576", 124), ("1126125/1048576", 124)]
    for (level, (text, cents)) in want.enumerated() {
        check(table[level].slashText == text, "pitch class of depth \(level + 1): \(table[level].slashText)")
        near(table[level].pcCents, cents, 1, "cents of depth \(level + 1)")
    }
    for (i, c) in [510.0, 150, 537, 923, 692].enumerated() { near(table[9 + i].pcCents, c, 0.5, "cents of depth \(10 + i)") }
    for r in table {
        check(r.num % 2 == 1 && r.num >= r.den && r.num < 2 * r.den, "depth \(r.depth) folded exactly into [1, 2)")
        check(r.prefix * r.den == r.num << SoundTuning.pitchClass(r.prefix).shift, "depth \(r.depth): P · den = num · 2^k")
    }
    check(table.map(\.octave) == [0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4], "the audited register")
    let f = table.map { SoundTuning.frequency($0, baseHz: 110) }
    check(f[0] == 110, "α is the ground")
    check(f.allSatisfy { $0 >= 30 && $0 <= 3000.5 }, "every voice in 30 Hz … 3 kHz")
    near(f.max()!, 2999.5, 0.5, "ν is the highest voice")
    near(f[5], 611.0, 0.1, "ζ an octave above the automatic rule")
    near(f[3], 279.3, 0.1, "δ")
    near(f[1], 137.5, 0.01, "β")
    for i in f.indices {
        for j in f.indices where j > i {
            check(abs(1200 * log2(f[i] / f[j])) >= SoundTuning.keepApartCents, "depth \(i + 1) and \(j + 1) apart")
        }
    }
    let depths = { (skip: [Bool]) in skip.indices.filter { skip[$0] }.map { $0 + 1 } }
    let def = table.map { $0.level < 12 }
    check(depths(SoundTuning.clashingHarmonics(f, on: def)) == [1, 2, 3, 6, 8, 9, 10], "2nd harmonics left out where they clash")
    check(depths(SoundTuning.clashingHarmonics(f, on: def.map { _ in true })) == [1, 2, 3, 6, 8, 9, 10], "the same with all 14 voices")
    check(depths(SoundTuning.clashingHarmonics(f, on: table.map { $0.level < 7 })) == [1, 2], "Slow preset: only α/γ and β/δ")
    let withoutGamma = def.enumerated().map { $0.offset != 2 && $0.element }
    check(!depths(SoundTuning.clashingHarmonics(f, on: withoutGamma)).contains(1), "α keeps its 2f when γ is muted")
    for base in [55.0, 82.5, 220] {
        let fb = table.map { SoundTuning.frequency($0, baseHz: base) }
        check(depths(SoundTuning.clashingHarmonics(fb, on: def)) == [1, 2, 3, 6, 8, 9, 10], "only intervals matter (base \(base))")
    }
    for base in [55.0, 82.5, 110, 165, 220] {
        for r in table {
            let v = SoundTuning.frequency(r, baseHz: base)
            let peak = SoundTuning.chimeFrequency(v, valley: false)
            check(SoundTuning.chimeFrequency(v, valley: true) == peak / 2, "valley bell an octave lower (depth \(r.depth) @\(base))")
            check(peak >= 60 && peak <= 4200 && peak / 2 >= 30, "bell in the pleasant band")
        }
    }
    near(SoundTuning.chimeFrequency(f[11], valley: false), 2399.6, 0.5, "μ bell")
    near(SoundTuning.chimeFrequency(f[12], valley: true), 1499.7, 0.5, "ν valley bell")
    let hz = { (level: Int) in 1 / clock.levelInfo(level).meanSeconds }
    near(hz(13), 22.51, 0.02, "ξ true rate")
    near(hz(14), 247.65, 0.1, "ο true rate")
    near(hz(16), 8915.4, 3, "ρ true rate")
    check(SoundTuning.physicalLevels(shift: -1).map { $0.level + 1 } == [15, 16, 17], "physical at −1 octave: ο π ρ")
    check(SoundTuning.physicalLevels(shift: 0).map { $0.level + 1 } == [15, 16], "physical untransposed: ο π")
    check(SoundTuning.physicalLevels(shift: 3).map { $0.level + 1 } == [13, 14, 15], "physical +3 octaves: ν ξ ο")
    check(SoundTuning.note(of: 440).name == "A4" && SoundTuning.note(of: 110).name == "A2", "note names")
    check(SoundTuning.noteLabel(349.1) == "F4 −1¢" && SoundTuning.noteLabel(223.4) == "A3 +27¢", "note labels")
    check(SoundTuning.weight(for: 110) > SoundTuning.weight(for: 1000) && SoundTuning.weight(for: 1000) > SoundTuning.weight(for: 5000), "loudness weighting")
}

// MARK: - Loudness

func loudnessChecks() {
    typealias S = SoundSchedule
    for (p, v) in [(0.0, 0.0), (0.25, 1), (0.5, 0), (0.75, -1), (1, 0), (0.125, 0.5), (1.25, 1)] {
        near(S.triangle(p), v, 1e-12, "triangle(\(p))")
    }
    check(S.loudness(-1) == 0 && S.loudness(1) == 1, "silent valley, full peak")
    var sum = 0.0
    for i in 0..<4000 { sum += S.loudness(S.triangle((Double(i) + 0.5) / 4000)) }
    near(sum / 4000, S.meanLoudness(), 1e-4, "mean loudness")
    check(S.amWeight(22.5) == 1 && S.amWeight(25) == 1 && S.amWeight(32) == 0 && S.amWeight(80) == 0, "AM weight limits")
    near(S.amWeight(28.5), 0.5, 1e-12, "AM cross-fade")
    near(S.voiceLoudness(phase: 0.25, hz: 500), S.meanLoudness(), 1e-12, "too fast: the mean")
    check(S.voiceLoudness(phase: 0.25, hz: 0.5) == 1 && S.voiceLoudness(phase: 0.75, hz: 0.5) == 0, "slow: the glyph wave")
    near(S.voiceLoudness(phase: 0.75, hz: 0.5, floor: 0.06), 0.06, 1e-12, "a voice floor keeps some of the valley")
    near(S.cycleHz(meanSeconds: clock.levelInfo(11).meanSeconds, rate: 1), 0.643, 0.001, "μ heartbeat")
    near(S.cycleHz(meanSeconds: clock.levelInfo(13).meanSeconds, rate: 1), 22.51, 0.02, "ξ heartbeat")
    // the float phase from the catalogue position agrees with the exact reading
    for t in [vectorA, 946_684_800.123, 2_886_085_800.9] {
        let pos = clock.position(at: t)!
        for level in 0...13 {
            var d = abs(S.phase(position: pos, prefix: clock.levelInfo(level).prefixDouble) - clock.level(at: t, level)!.phase)
            d = min(d, 1 - d)
            check(d < 2e-4, "float phase of level \(level) at \(t): \(d)")
        }
    }
}

// MARK: - Chime events

func eventChecks() {
    typealias S = SoundSchedule
    let mean = { (level: Int) in clock.levelInfo(level).meanSeconds }
    check(S.chimeMode(meanSeconds: mean(11), rate: 1, floor: 0.12) == .quarters, "μ quarters at 0.12 s")
    check(S.chimeMode(meanSeconds: mean(12), rate: 1, floor: 0.12) == .ends, "ν ends at 0.12 s")
    check(S.chimeMode(meanSeconds: mean(13), rate: 1, floor: 0.12) == nil, "ξ never chimes at real speed")
    check(S.chimeMode(meanSeconds: mean(6), rate: 0) == nil, "paused: silence")
    check(S.chimeMode(meanSeconds: mean(10), rate: 1) == .quarters && S.chimeMode(meanSeconds: mean(11), rate: 1) == .ends
        && S.chimeMode(meanSeconds: mean(12), rate: 1) == nil, "the calm default floor: λ quarters, μ ends, ν silent")
    let all = Array(0...13)
    let dense = S.events(from: etaEnd - 1, to: etaEnd + 1, levels: all, rate: 1, floor: 0.12)
    let end = dense.first { abs($0.time - etaEnd) < 5e-4 }
    check(end != nil, "vector A: the depth-7 end at 1791464172.428 is found")
    if let end {
        check(end.kind == .end && end.top == 6 && end.levels == [6, 7, 8, 9, 10, 11, 12] && end.ends == 7, "merged into one chord: \(end.levels)")
    }
    check(dense.filter { abs($0.time - etaEnd) < 1e-3 }.count == 1, "coincident ends are one event")
    let calm = S.events(from: etaEnd - 1, to: etaEnd + 1, levels: all, rate: 1)
    check(calm.first { abs($0.time - etaEnd) < 5e-4 }?.levels == [6, 7, 8, 9, 10, 11], "the calm floor leaves ν out of the chord")
    // the thresholds of the current depth-7 cycle (SPEC §6.2)
    let cur = clock.level(at: vectorA, 6)!
    let evs = S.events(from: cur.start - 1, to: cur.end + 1, levels: [6], rate: 1)
    let names = ["peak": S.Kind.peak, "node": .node, "valley": .valley, "end": .end]
    for th in cur.thresholds {
        guard let kind = names[th.name], let time = th.time else { continue }
        check(evs.contains { $0.kind == kind && abs($0.time - time) < 2e-6 }, "the \(th.name) of η is an event")
    }
    // upcomingEnds (exact, merged across levels) and the float quarters agree
    let up = clock.upcomingEnds(after: vectorA, fromLevel: 4, toLevel: 8, count: 12, perLevel: 12)
    let mine = S.events(from: vectorA, to: up.last!.time + 0.01, levels: [4, 5, 6, 7, 8], rate: 1, floor: 1e-6)
    for u in up {
        let m = mine.first { abs($0.time - u.time) < 2e-3 }
        check(m?.parts.filter { $0.kind == .end }.map(\.level) == u.levels, "upcoming end at \(u.time)")
    }
    // consecutive windows tile the axis: every threshold exactly once
    let levels = Array(3...11)
    let whole = S.events(from: vectorA, to: vectorA + 400, levels: levels, rate: 1)
    var pieces: [S.Event] = []
    var t = vectorA
    while t < vectorA + 400 {
        pieces += S.events(from: t, to: min(t + 0.5, vectorA + 400), levels: levels, rate: 1)
        t += 0.5
    }
    check(whole.count > 100 && pieces == whole, "windows tile the time axis (\(whole.count) events)")
    let mu = S.events(from: vectorA, to: vectorA + 60, levels: [11], rate: 1, floor: 0.12)
    check(mu.count >= 152 && mu.count <= 156, "μ: a quarter every 0.39 s (\(mu.count))")
    let bells = S.events(from: vectorA, to: vectorA + 120, levels: Array(0..<12), rate: 1).reduce(0) { $0 + $1.parts.count }
    check(Double(bells) / 120 > 1.0 && Double(bells) / 120 < 1.5, "about 1.2 bells a second at the defaults: \(Double(bells) / 120)")
    check(S.events(from: vectorA, to: vectorA + 60, levels: [9], rate: 0).isEmpty, "paused: no events")
    check(S.events(from: clock.tMax + 5, to: clock.tMax + 50, levels: all, rate: 1).isEmpty, "nothing after the catalogue")
    check(S.events(from: clock.tMax - 30, to: clock.tMax + 3000, levels: [8, 9, 10, 11], rate: 1).allSatisfy { $0.time <= clock.tMax }, "never extrapolated")
    let lapse = Set(S.events(from: vectorA, to: vectorA + 3600 * 5, levels: all, rate: 3600).flatMap(\.levels))
    check(lapse.contains(7) && !lapse.contains(8), "×3,600 at the calm floor: θ is the finest that rings")
    for n in 1..<12 { check(S.eventStrength(.end, ends: n + 1) > S.eventStrength(.end, ends: n) || S.eventStrength(.end, ends: n) >= 0.99, "strength grows with the ends") }
    // tempo lock
    let rate = S.tempoRate(depth: 7, seconds: 4)
    near(rate, 4547.2, 0.5, "one η in 4 s")
    let tempo = S.tempo(depth: 7, rate: rate)
    near(tempo.cycle, 4, 1e-9, "cycle")
    near(tempo.bpm, 60, 1e-9, "60 BPM")
    check(tempo.childPerCycle == 9, "η holds 9 θ")
    var cycle = 4.0
    var seq: [Int] = []
    for d in 7..<13 {
        let child = S.tempo(depth: d, rate: rate).child
        seq.append(Int((cycle / child).rounded()))
        cycle = child
    }
    check(seq == [9, 4, 5, 13, 5, 5], "nested rhythm \(seq)")
    let map = S.ClockMap(frame0: 100, t0: 1000, rate: -4, sampleRate: 10)
    near(map.time(atFrame: 120), 992, 1e-12, "clock map backwards")
    near(map.frame(atTime: 992), 120, 1e-9, "clock map inverse")
    check(S.ClockMap(frame0: 0, t0: 5, rate: 0, sampleRate: 48000).frame(atTime: 6).isInfinite, "paused maps to ∞")
}

// MARK: - Planner

func plannerChecks() {
    let prefs = SoundPreferences()
    let voices = SoundPlanner.voices(prefs)
    check(voices.count == 14 && voices.filter(\.on).count == 12, "twelve default voices")
    check(voices.filter(\.noHarmonic).map { Int($0.level) + 1 } == [1, 2, 3, 6, 8, 9, 10], "the planner leaves out the clashing harmonics")
    let event = SoundSchedule.events(from: etaEnd - 1, to: etaEnd + 1, levels: prefs.soundingLevels, rate: 1).first { abs($0.time - etaEnd) < 5e-4 }!
    let bells = SoundPlanner.bells(for: event, prefs: prefs, rate: 1, epoch: 3)
    check(bells.map(\.level) == [6, 7, 8, 9, 10, 11], "strummed coarse → fine")
    for (i, b) in bells.enumerated() { near(b.t, event.time + Double(i) * 0.015, 1e-9, "strum \(i) 15 ms apart") }
    let back = SoundPlanner.bells(for: event, prefs: prefs, rate: -1, epoch: 3)
    check(back.map(\.level) == [11, 10, 9, 8, 7, 6], "backwards: fine → coarse")
    near(back[1].t, event.time - 0.015, 1e-9, "backwards the strum runs to earlier displayed times")
    check(bells.allSatisfy { $0.amp > 0 && $0.amp < 1 && $0.epoch == 3 && !$0.moment }, "bell levels")
    let single = SoundSchedule.events(from: vectorA, to: vectorA + 10, levels: [10], rate: 1).first!
    check(SoundPlanner.bells(for: event, prefs: prefs, rate: 1, epoch: 0)[0].decay > SoundPlanner.bells(for: single, prefs: prefs, rate: 1, epoch: 0)[0].decay, "a major turnover rings longer")
    let notes = SoundPlanner.moment(at: vectorA, prefs: prefs) { clock.position(at: $0) }!
    check(notes.map(\.level) == Array(0..<12), "the moment plays every sounding voice α → μ")
    near(notes[1].offset, 2.2 / 12, 1e-12, "moment step")
    for n in notes {
        let r = clock.level(at: vectorA, n.level)!
        near(n.loudness, 0.06 + 0.94 * SoundSchedule.loudness(SoundSchedule.triangle(r.phase)), 2e-3, "moment loudness of level \(n.level)")
    }
    check(SoundPlanner.moment(at: clock.tMax + 1, prefs: prefs) { clock.position(at: $0) } == nil, "no moment outside the catalogue")
    var none = prefs
    none.levels = Array(repeating: false, count: 14)
    check(SoundPlanner.moment(at: vectorA, prefs: none) { clock.position(at: $0) }?.count == 14, "with no voice on, the moment plays all")
    var slots = SoundPhysicalSlots()
    var phys = prefs
    phys.physical = true
    let first = slots.assign(SoundPlanner.physicalWanted(phys, on: true), now: 0)
    check(first.filter { $0.gain > 0 }.count == 3, "three physical voices at −1 octave")
    phys.physShift = 0
    let second = slots.assign(SoundPlanner.physicalWanted(phys, on: true), now: 0.1)
    let silenced = second.filter { $0.gain == 0 }.map(\.slot)
    let started = second.filter { $0.gain > 0 }.map(\.slot)
    check(silenced.count == 3 && started.count == 2 && Set(silenced).isDisjoint(with: started), "a new transposition fades the old voices out in their own slots")
    let third = slots.assign([], now: 0.2)
    check(third.count == 2 && third.allSatisfy { $0.gain == 0 }, "switching the layer off silences what sounds")
}

// MARK: - Ring geometry

func geometryChecks() {
    let g = SoundRingGeometry(size: CGSize(width: 300, height: 300), labelRoom: 22)
    let cents = table.map(\.pcCents)
    check(g.radius(0) == 128 && abs(g.radius(13) - 64) < 1e-9 && g.buttonDiameter == 88, "α outside, ξ inside, the button between")
    check(SoundRingGeometry(size: CGSize(width: 248, height: 248), labelRoom: 22).buttonDiameter < 2 * 51, "a small ring keeps its button clear of ξ")
    let top = g.point(level: 0, cents: 0)
    check(abs(top.x - 150) < 1e-9 && abs(top.y - 22) < 1e-9, "the ground at the top")
    let right = g.point(radius: 100, cents: 300)
    check(abs(right.x - 250) < 1e-9 && abs(right.y - 150) < 1e-9, "300 cents a quarter turn clockwise")
    for level in 0..<14 { check(g.hit(g.point(level: level, cents: cents[level]), cents: cents) == level, "a tap on dot \(level) hits it") }
    check(g.hit(g.center, cents: cents) == nil, "the centre (the power button) hits no voice")
    let theta = g.point(level: 7, cents: cents[7])
    let iota = g.point(level: 8, cents: cents[8])
    check(abs(cents[7] - cents[8]) < 1e-9 && hypot(theta.x - iota.x, theta.y - iota.y) > 4, "θ and ι share a spoke at different radii")
    check(soundLabelSlots([(key: 3, x: 50), (key: 1, x: 10), (key: 2, x: 20), (key: 0, x: 60)]) == [1, 3], "labels where there is room, in x order")
}

// MARK: - Preferences

@MainActor
func preferenceChecks() {
    let suite = "fx.sound.checks.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    check(SoundPreferences.load(from: defaults) == SoundPreferences(), "nothing stored: the defaults")
    let d = SoundPreferences()
    check(d.volumeDb == -18 && d.reverb == 0.22 && d.chord && d.chimes && !d.physical && d.physShift == -1 && d.baseHz == 110
        && d.floor == 0.5 && d.soundingLevels == Array(0..<12) && d.tempoDepth == 7 && d.tempoSeconds == 4, "the web defaults")
    var p = SoundPreferences()
    p.volumeDb = -9
    p.levels = SoundPreset.slow.levels
    p.voiceFloors[3] = 0.2
    p.baseSemitones = 7
    p.save(to: defaults)
    check(SoundPreferences.load(from: defaults) == p, "every preference persists")
    var bad = p
    bad.volumeDb = 40
    bad.reverb = .nan
    bad.baseSemitones = 99
    bad.levels = [true]
    bad.voiceFloors = Array(repeating: 3, count: 14)
    bad.tempoSeconds = 0
    bad.tempoDepth = 1
    let s = bad.sanitized()
    check(s.volumeDb == -3 && s.reverb == 0.22 && s.baseSemitones == 12 && s.levels == d.levels && s.voiceFloors.allSatisfy { $0 == 0.5 }
        && s.tempoSeconds == 0.25 && s.tempoDepth == 2, "invalid values are clamped or reset: \(s)")
    defaults.set(Data("{\"volumeDb\":\"loud\",\"chimes\":false,\"levels\":[1,2]}".utf8), forKey: SoundPreferences.storageKey)
    let g = SoundPreferences.load(from: defaults)
    check(g.volumeDb == -18 && !g.chimes && g.levels == d.levels, "garbage keeps the defaults, valid values survive")
    defaults.set(Data("nonsense".utf8), forKey: SoundPreferences.storageKey)
    check(SoundPreferences.load(from: defaults) == d, "unreadable storage: the defaults")
    check(SoundPreset.matching(SoundPreset.standard.levels) == .standard && SoundPreset.matching(p.levels) == .slow, "presets")
    check(d.nearestFloor == 0.5, "nearest floor")
}

// MARK: - Words

func wordChecks() {
    let w = SoundWords(Wording(pure: false, timeZone: TimeZone(identifier: "UTC")!))
    check(SoundWords.hz(349.08) == "349.1 Hz" && SoundWords.hz(2228.9) == "2.23 kHz" && SoundWords.hz(22.51) == "22.51 Hz", "Hz")
    check(SoundWords.hz(0.6432) == "643 mHz" && SoundWords.hz(4.394e-9) == "4.39 nHz", "slow rates: \(SoundWords.hz(0.6432)) \(SoundWords.hz(4.394e-9))")
    check(SoundWords.rate(4547.2) == "×4,547" && SoundWords.rate(-60) == "−×60" && SoundWords.rate(2_629_800) == "×2.63 M" && SoundWords.rate(0.011) == "×0.011", "rates")
    check(SoundWords.period(clock.levelInfo(4).meanSeconds) == "16.2 d" && SoundWords.period(clock.levelInfo(12).meanSeconds) == "311 ms", "periods: \(SoundWords.period(clock.levelInfo(4).meanSeconds))")
    check(SoundWords.seconds(4) == "4.00 s" && SoundWords.seconds(0.12) == "0.12 s" && SoundWords.secondsShort(4) == "4 s" && SoundWords.secondsShort(0.5) == "0.5 s", "seconds")
    check(SoundWords.db(-18) == "−18 dB", "dB")
    check(w.voiceLine(table[4], baseHz: 110) == "349.1 Hz · F4 −1¢ · 16.2 d", "a mixer line: \(w.voiceLine(table[4], baseHz: 110))")
    check(w.ground(0) == ("110 Hz", "A2") && w.ground(-12).head == "55.0 Hz", "base pitch")
    check(w.floorOption(0.5, name: "default") == "0.5 s · default" && w.floorOption(1, name: "sparse") == "1 s · sparse", "floors")
    check(w.tempoReadout(depth: 7, rate: SoundSchedule.tempoRate(depth: 7, seconds: 4)) == "×4,547: one η cycle lasts 4.00 s; a quarter (the beat) 1.00 s = 60.0 BPM.", "tempo readout")
    check(w.depths([true, true, true, false, false, false, true] + Array(repeating: false, count: 7)) == "depth 1–3, 7", "depth ranges")
    check(w.parseTempo("4") == 4 && w.parseTempo(" 1,5 s ") == 1.5 && w.parseTempo("0.1") == 0.25 && w.parseTempo("9000") == 600, "typed lengths are held to 0.25 … 600 s")
    check(w.parseTempo("") == nil && w.parseTempo("abc") == nil && w.parseTempo("-3") == nil && w.parseTempo("0") == nil, "a typed length must be a positive number")
    check(w.tempoPrompt(depth: 7) == "How many seconds of real time one η cycle lasts, 0.25 to 600.", "tempo prompt: \(w.tempoPrompt(depth: 7))")
    let chips = w.rhythm(depth: 7, rate: SoundSchedule.tempoRate(depth: 7, seconds: 4), prefs: SoundPreferences())
    check(chips.map(\.letter) == ["η", "θ", "ι", "κ"] && chips.first?.mark == .quarters && chips.first?.factor == 9 && chips.last?.factor == nil, "rhythm chips")
}

/// Earth words that must never reach a pure-mode text.
func leaks(_ s: String) -> [String] {
    var found: [String] = []
    let rules: [(String, String)] = [
        ("Hz", #"\bk?Hz\b"#), ("seconds", #"\d\s?(s|ms|sec|min|h|d|y)\b"#), ("percent", "%"), ("BPM", "BPM"), ("dB", #"\bdB\b"#),
        ("note", #"\b[A-G][♯#]?\d\b"#), ("clock time", #"\d:\d"#), ("year", #"(?<![/\d])\b(1[6-9]\d\d|2[0-8]\d\d)\b(?![/\d])"#),
        ("Saros", "Saros"), ("Earth units", #"\b(second|minute|hour|day|week|month|year)s?\b"#),
    ]
    for (name, pattern) in rules where s.range(of: pattern, options: .regularExpression) != nil { found.append(name) }
    return found
}

func pureWordChecks() {
    let w = SoundWords(Wording(pure: true, timeZone: TimeZone(identifier: "UTC")!))
    let nn = "\u{202F}"
    check(w.ratio(table[2]) == "65/64", "a ratio with a slash")
    check(SoundWords.octaveOffset(0) == "octave +0" && SoundWords.octaveOffset(-1) == "octave −1", "octave offsets")
    check(w.octaveShift(0) == "no shift" && w.octaveShift(1) == "+1 octave" && w.octaveShift(-2) == "−2 octaves", "octave shifts")
    check(SoundWords.cents(799.5) == "800¢" && SoundWords.cents(1119.6) == "1120¢", "cents")
    check(w.ground(0) == ("ground ×1", "34.2 pB") && w.ground(12).head == "+1 octave ×2" && w.ground(-12).head == "−1 octave ×½"
        && w.ground(7).head == "+700¢ ×1.5" && w.ground(-5).head == "−500¢ ×0.749", "the ground: \(w.ground(-5))")
    check(w.ground(-12).sub == "17.1 pB" && w.ground(12).sub == "68.4 pB", "the ground in pB")
    let at = table.map { w.pitch(SoundTuning.frequency($0, baseHz: 110)) }
    check(at[0] == "34.2 pB" && at[4] == "108.5 pB" && at[12] == "932.6 pB", "voices in pB: \(at[0]) \(at[4]) \(at[12])")
    check([13, 14, 15, 16].map { w.pitch(1 / clock.levelInfo($0).meanSeconds) } == ["7 pB", "77 pB", "693 pB", "2\(nn)772 pB"], "the deepest true rates are whole pB")
    check(w.pitch(1 / clock.levelInfo(6).meanSeconds) == "1 per 58\(nn)500 Blinks", "η's rate as a count of Blinks")
    check(SoundWords.blinks(1) == "1 Blink" && SoundWords.blinks(0.5) == "0.5 Blinks" && SoundWords.blinks(0.0004) == "<0.001 Blinks"
        && SoundWords.blinks(12.34) == "12.3 Blinks" && SoundWords.blinks(1234.5) == "1\(nn)235 Blinks" && SoundWords.blinks(2.63e6) == "2.63 M Blinks", "Blinks")
    check(w.span(4) == "12.9 Blinks", "4 s in Blinks: \(w.span(4))")
    check(w.floorOption(0.05, name: "dense") == "0.161 Blinks · dense" && w.floorOption(0.5, name: "default") == "1.61 Blinks · default", "floors in Blinks: \(w.floorOption(0.05, name: "dense"))")
    check(w.tempoValue(4) == 12 && w.tempoText(12) == "12 Blinks", "the untouched default is 12 Blinks")
    near(w.tempoValue(w.tempoSeconds(36)), 36, 1e-9, "Blinks round trip")
    check(w.tempoLimits == 0.8...1930, "Blinks that can be typed: \(w.tempoLimits)")
    check(w.parseTempo("36 Blinks") == 36 && w.parseTempo("0.2") == 0.8 && w.parseTempo("5000") == 1930, "typed Blinks are held to 0.8 … 1930")
    var longest = SoundPreferences()
    longest.tempoSeconds = w.tempoSeconds(1930)
    check(longest.sanitized().tempoSeconds <= 600 && longest.sanitized().tempoSeconds > 599, "the longest typed length stays within 600 s")
    check(w.tempoPrompt(depth: 7) == "How many Blinks one η cycle lasts, 0.8 to 1\(nn)930.", "pure tempo prompt: \(w.tempoPrompt(depth: 7))")
    check(w.voiceLine(table[4], baseHz: 110) == "108.5 pB · octave +1 · 799¢ · 1ε", "a pure mixer line: \(w.voiceLine(table[4], baseHz: 110))")
    check(table.map { w.cycleLength($0.level) } == ["1α", "1β", "1γ", "1δ", "1ε", "11η", "1η", "4ι", "1ι", "13λ", "1λ", "5ν", "1ν", "0.14ν"], "cycle lengths on the ladder")
    check((1..<14).map { w.depthOption($0) } == ["β 2 · Beta", "γ 3 · Gamma", "δ 4 · Delta", "ε 5 · Nuclide", "ζ 6 · 11η", "η 7 · Helion", "θ 8 · 4ι", "ι 9 · Preon", "κ 10 · 13λ", "λ 11 · Flavon", "μ 12 · 5ν", "ν 13 · Blink", "ξ 14 · 0.14ν"], "the tempo lock's depth list: \((1..<14).map { w.depthOption($0) })")
    check([3, 6, 5, 13].map { w.depthKind($0) } == ["Delta, a major period", "Helion, a minor unit", "between two units", "finer than a Blink"], "depth kinds")
    let eta = Notation.standard.rates.first { $0.id == "eta" }!.rate
    let iota4 = Notation.standard.rates.first { $0.id == "iota4" }!.rate
    check(w.rateTip(eta) == "One Helion passes every Blink" && w.rateTip(iota4) == "Four Preons pass every Blink", "speeds in prose: \(w.rateTip(iota4))")
    let lockRate = SoundSchedule.tempoRate(depth: 7, seconds: w.tempoSeconds(12))
    check(w.speed(lockRate) == "3ι per Blink", "one η in 12 Blinks is 3ι per Blink: \(w.speed(lockRate))")
    check(w.tempoReadout(depth: 7, rate: lockRate) == "3ι per Blink: one η cycle lasts 12 Blinks; a quarter lasts 3 Blinks.", "pure tempo readout: \(w.tempoReadout(depth: 7, rate: lockRate))")
    check(w.speedChips.map(\.label) == ["Live", "real time", "λ", "ι", "η", "ε", "δ", "Pause", "Reverse"], "pure speed chips: \(w.speedChips.map(\.label))")
    // nothing the pure screen says leaks an Earth unit
    var texts: [String] = []
    texts += table.map { w.voiceLine($0, baseHz: 110) } + table.map { w.ratio($0) }
    texts += (-12...12).flatMap { [w.ground($0).head, w.ground($0).sub] }
    texts += SoundPreferences.floors.map { w.floorOption($0.seconds, name: $0.name) }
    texts += (-3...3).map { w.octaveShift($0) } + (-3...3).map { w.physicalList($0) }
    texts += w.tempoLadder.map { w.tempoText($0) } + (1..<14).map { w.depthOption($0) }
    texts += [w.tempoPrompt(depth: 6), w.tempoPrompt(depth: 14)]
    for rate in [1.0, 60, 3600, 86400, 2_629_800, -4000, lockRate] {
        texts += [w.tempoReadout(depth: 7, rate: rate), w.clockChip(live: false, rate: rate)]
        texts += w.rhythm(depth: 6, rate: rate, prefs: SoundPreferences()).flatMap { [$0.length, $0.help] }
    }
    texts += w.speedChips.flatMap { [$0.label, $0.unit, $0.help] }
    texts += w.how.flatMap { [$0.head, $0.body] } + [w.mixerHint, w.floorHelp, w.physicalHelp, w.deepRates]
    texts += [w.status(on: true, inRange: true, sampleRate: 48000, voices: 12, interrupted: false), w.status(on: false, inRange: false, sampleRate: 0, voices: 0, interrupted: false)]
    texts += [w.lockChip(depth: 7, seconds: 4), w.lockToast(depth: 7, seconds: 4, rate: lockRate), w.unlockToast(rate: lockRate), w.moment(vectorA)]
    for text in texts {
        let found = leaks(text)
        check(found.isEmpty, "pure text leaks \(found): \(text)")
    }
    check(!leaks("349.1 Hz").isEmpty && !leaks("4.00 s").isEmpty && !leaks("22 %").isEmpty && !leaks("F4 −1¢").isEmpty, "the leak scan catches Earth words")
}

// MARK: - The renderer, listened to offline

/// Renders the synthesiser into arrays with synthetic host times.
final class Offline {
    let renderer: SoundRenderer
    let sampleRate: Double
    let host0: UInt64 = 1_000_000_000
    var left: [Float] = []
    var right: [Float] = []
    var bellsAfterBlock: [(frame: Int, bells: Int)] = []
    var seconds = 0.0

    init(sampleRate: Double = 48000) {
        self.sampleRate = sampleRate
        renderer = SoundRenderer(sampleRate: sampleRate)
    }

    var frame: Int { left.count }
    func host(atFrame f: Int) -> UInt64 { renderer.host(host0, plus: Double(f) / sampleRate) }

    func send(_ c: SoundCommand) { renderer.commands.push(c) }

    func setUp(prefs: SoundPreferences, t0: Double, rate: Double, chord: Bool = true, chimes: Bool = true, volume: Float = 0.5, reverb: Float = 0) {
        for v in SoundPlanner.voices(prefs) { send(.voice(v)) }
        send(.mix(SoundMixConfig(volume: volume, reverb: reverb, chord: chord, chimes: chimes)))
        send(.anchor(t0: t0, rate: rate, host: host(atFrame: frame), epoch: 1, blend: false))
        send(.fader(target: 1, seconds: 0))
    }

    func render(_ duration: Double, block: Int = 256) {
        let total = Int(duration * sampleRate)
        var l = [Float](repeating: 0, count: block)
        var r = [Float](repeating: 0, count: block)
        var done = 0
        let start = Date()
        while done < total {
            let n = min(block, total - done)
            let h = host(atFrame: frame)
            l.withUnsafeMutableBufferPointer { lp in
                r.withUnsafeMutableBufferPointer { rp in
                    renderer.render(frameCount: n, left: lp.baseAddress!, right: rp.baseAddress!, hostTime: h)
                }
            }
            left += l[0..<n]
            right += r[0..<n]
            bellsAfterBlock.append((frame, renderer.soundingBells.load(ordering: .relaxed)))
            done += n
        }
        seconds += Date().timeIntervalSince(start)
    }
}

/// Power of `signal` at `hz` (Goertzel), normalised by length.
func goertzel(_ signal: ArraySlice<Float>, hz: Double, sampleRate: Double) -> Double {
    let w = 2 * Double.pi * hz / sampleRate
    let c = 2 * cos(w)
    var s1 = 0.0
    var s2 = 0.0
    for x in signal {
        let s = Double(x) + c * s1 - s2
        s2 = s1
        s1 = s
    }
    let power = s1 * s1 + s2 * s2 - c * s1 * s2
    return power / Double(signal.count * signal.count)
}

func rms(_ s: ArraySlice<Float>) -> Double {
    guard !s.isEmpty else { return 0 }
    return sqrt(s.reduce(0.0) { $0 + Double($1) * Double($1) } / Double(s.count))
}

@MainActor
func renderChecks() {
    let prefs = SoundPreferences()
    let sr = 48000.0

    // 1. the steady chord at vector A
    let chord = Offline()
    chord.setUp(prefs: prefs, t0: vectorA, rate: 1, chimes: false, volume: Float(prefs.volumeGain))
    chord.render(3)
    let all = chord.left[...] + chord.right[...]
    check(all.allSatisfy(\.isFinite), "no NaN or ∞ in the chord")
    let peak = all.map { abs($0) }.max()!
    check(peak > 0.005 && peak < 0.98, "the chord sounds and never clips: peak \(peak)")
    let level = 20 * log10(rms(chord.left[...]))
    check(level > -50 && level < -15, "a quiet default chord: \(level) dBFS RMS")
    print("   chord at vector A: peak \(String(format: "%.3f", peak)), \(String(format: "%.1f", level)) dBFS RMS")
    let window = chord.left[Int(0.5 * sr)..<Int(3 * sr)]
    let pos = clock.position(at: vectorA + 1.75)!
    var heard = 0
    for row in table where prefs.levels[row.level] {
        let f = SoundTuning.frequency(row, baseHz: prefs.baseHz)
        let phase = SoundSchedule.phase(position: pos, prefix: clock.levelInfo(row.level).prefixDouble)
        let loud = row.level >= 11 ? SoundSchedule.meanLoudness() : SoundSchedule.loudness(SoundSchedule.triangle(phase))
        guard loud > 0.15 else { continue }
        let on = goertzel(window, hz: f, sampleRate: sr)
        let off = goertzel(window, hz: f * pow(2, 50 / 1200), sampleRate: sr)
        check(on > 30 * off, "a spectral peak at depth \(row.depth)'s \(String(format: "%.1f", f)) Hz: \(on / max(off, 1e-30))×")
        heard += 1
    }
    check(heard >= 6, "most voices are heard at vector A (\(heard))")
    let perSecond = chord.seconds / 3
    print("   render cost (unoptimised checks build): \(String(format: "%.1f", perSecond * 1000)) ms per second of audio")
    // wall-clock time on a shared machine: only a gross regression fails (the app's release build is ~10× faster)
    check(perSecond < 1, "renders faster than real time even unoptimised: \(perSecond)")

    // 2. ξ modulates at its true 22.5 Hz
    var xiOnly = prefs
    xiOnly.levels = (0..<14).map { $0 == 13 }
    let xi = Offline()
    xi.setUp(prefs: xiOnly, t0: vectorA, rate: 1, chimes: false)
    xi.render(2.1)
    var envelope: [Float] = []
    for k in stride(from: Int(0.1 * sr), to: xi.left.count - 48, by: 48) {
        envelope.append(xi.left[k..<k + 48].reduce(0) { $0 + abs($1) } / 48)
    }
    let mean = envelope.reduce(0, +) / Float(envelope.count)
    let am = envelope.map { $0 - mean }[...]
    let at = goertzel(am, hz: 22.51, sampleRate: 1000)
    let beside = max(goertzel(am, hz: 15, sampleRate: 1000), goertzel(am, hz: 31, sampleRate: 1000))
    check(at > 20 * beside, "ξ's loudness swings at 22.5 Hz, the clock's heartbeat: \(at / beside)×")

    // 3. the depth-7 end after vector A: one strummed chord starting on its sample
    let bell = Offline()
    let t0 = etaEnd - 0.5
    bell.setUp(prefs: prefs, t0: t0, rate: 1, chord: false, volume: 0.5)
    let events = SoundSchedule.events(from: t0, to: t0 + 1, levels: prefs.soundingLevels, rate: 1)
    check(events.count == 1 && events[0].levels == [6, 7, 8, 9, 10, 11], "one event in the second around the η end")
    for e in events { for b in SoundPlanner.bells(for: e, prefs: prefs, rate: 1, epoch: 1) { bell.send(.bell(b)) } }
    bell.render(1.2, block: 32)
    let onset = bell.left.firstIndex { abs($0) > 1e-7 } ?? -1
    let expected = Int(((events[0].time - t0) * sr).rounded(.down))
    check(abs(onset - expected) <= 2, "the chord starts on its sample: \(onset) vs \(expected)")
    var steps: [Int] = []
    var last = 0
    for (frame, n) in bell.bellsAfterBlock {
        if n > last { steps.append(frame) }
        last = n
    }
    check(steps.count == 6, "six bells, one per level that turns over: \(steps.count)")
    for (i, frame) in steps.enumerated() {
        let want = expected + Int(Double(i) * 0.015 * sr)
        check(abs(frame - want) <= 32, "bell \(i) 15 ms after the one before: block at \(frame), bell at \(want)")
    }
    check(bell.left.allSatisfy { abs($0) < 0.98 }, "the chord never clips")

    // 4. the polyphony cap
    let crowd = Offline()
    crowd.setUp(prefs: prefs, t0: vectorA, rate: 1, chord: false)
    for i in 0..<100 {
        let b = SoundBell(t: 0, host: crowd.host(atFrame: Int(0.1 * sr) + i), hz: 220 + Float(i), amp: 0.01 + Float(i % 7) * 0.001,
                          decay: 2, pan: 0, kind: SoundSchedule.Kind.end.rawValue, level: Int8(i % 14), epoch: 0, moment: true)
        crowd.send(.bell(b))
    }
    crowd.render(0.4)
    let most = crowd.bellsAfterBlock.map(\.bells).max() ?? 0
    check(most == SoundRenderer.maxBells, "never more than \(SoundRenderer.maxBells) bells at once: \(most)")

    // 5. paused: the drone holds, the bells wait
    let paused = Offline()
    paused.setUp(prefs: prefs, t0: etaEnd - 0.2, rate: 0)
    for e in SoundSchedule.events(from: etaEnd - 0.5, to: etaEnd + 0.5, levels: prefs.soundingLevels, rate: 1) {
        for b in SoundPlanner.bells(for: e, prefs: prefs, rate: 1, epoch: 1) { paused.send(.bell(b)) }
    }
    // the chorus partners beat at 0.15 Hz: compare windows one beat (6.67 s) apart
    let beat = 1 / SoundRenderer.chorusHz
    paused.render(1.2 + beat)
    check(paused.bellsAfterBlock.allSatisfy { $0.bells == 0 }, "no bell rings while paused")
    let a = rms(paused.left[Int(0.3 * sr)..<Int(1.1 * sr)])
    let b = rms(paused.left[Int((0.3 + beat) * sr)..<Int((1.1 + beat) * sr)])
    check(a > 1e-4 && abs(a / b - 1) < 0.01, "the drone holds steady while paused: \(a) vs \(b)")

    // 6. a jump glides into the new phases: no click
    let jump = Offline()
    jump.setUp(prefs: prefs, t0: vectorA, rate: 1, chimes: false, volume: 1)
    jump.render(1)
    let steady = zip(jump.left.dropFirst(Int(0.5 * sr)), jump.left.dropFirst(Int(0.5 * sr) + 1)).map { abs($0 - $1) }.max()!
    jump.send(.anchor(t0: vectorA + 12345.678, rate: 1, host: jump.host(atFrame: jump.frame), epoch: 2, blend: true))
    let cut = jump.frame
    jump.render(0.5)
    let around = zip(jump.left[(cut - 100)...], jump.left[(cut - 99)...]).map { abs($0 - $1) }.max()!
    check(around < 1.6 * steady, "a jump never clicks: largest step \(around) vs \(steady) in steady sound")

    // 7. outside the catalogue: silence
    let outside = Offline()
    outside.setUp(prefs: prefs, t0: clock.tMax + 1000, rate: 1)
    outside.render(0.5)
    check(rms(outside.left[...]) == 0, "silent outside the catalogue")
    let edge = Offline()
    edge.setUp(prefs: prefs, t0: clock.tMax - 0.25, rate: 1, chimes: false)
    edge.render(1)
    check(rms(edge.left[Int(0.05 * sr)..<Int(0.2 * sr)]) > 1e-4 && rms(edge.left[Int(0.3 * sr)...]) < 1e-9, "the chord stops at the catalogue's end")

    // 8. the room: a bell rings on in the reverb
    func tail(reverb: Float) -> Double {
        let r = Offline()
        r.setUp(prefs: prefs, t0: vectorA, rate: 1, chord: false, reverb: reverb)
        r.send(.bell(SoundBell(t: 0, host: r.host(atFrame: Int(0.05 * sr)), hz: 440, amp: 0.3, decay: 0.3, pan: 0,
                               kind: SoundSchedule.Kind.node.rawValue, level: 6, epoch: 0, moment: true)))
        r.render(1.6)
        return rms(r.left[Int(0.6 * sr)..<Int(1.2 * sr)])
    }
    let dry = tail(reverb: 0)
    let wet = tail(reverb: 0.22)
    check(wet > 30 * max(dry, 1e-9), "the default room keeps a bell ringing: \(wet) vs \(dry)")

    // 9. fade out and flush: true silence that never comes back
    let stop = Offline()
    stop.setUp(prefs: prefs, t0: vectorA, rate: 1, reverb: 0.5)
    stop.render(0.5)
    let before = stop.left[Int(0.3 * sr)..<Int(0.5 * sr)]
    let steadySteps = zip(before, before.dropFirst()).map { abs($0 - $1) }.max()!
    stop.send(.fader(target: 0, seconds: 0.1))
    stop.render(0.18)
    stop.send(.flush)
    let flushed = stop.frame
    stop.render(0.5)
    check(stop.left[flushed...].allSatisfy { $0 == 0 }, "after the fade-out and the flush the output is silent")
    let fade = stop.left[(flushed - Int(0.18 * sr))..<flushed]
    let fadeSteps = zip(fade, fade.dropFirst()).map { abs($0 - $1) }.max()!
    check(fadeSteps <= 1.05 * steadySteps, "the fade-out is smooth: \(fadeSteps) vs \(steadySteps)")

    // 10. the moment rings in real time, on the host clock
    let moment = Offline()
    moment.setUp(prefs: prefs, t0: vectorA, rate: 0, chord: false)
    let notes = SoundPlanner.moment(at: vectorA, prefs: prefs) { clock.position(at: $0) }!
    let start = moment.host(atFrame: Int(0.1 * sr))
    for b in SoundPlanner.momentBells(notes, prefs: prefs, host: { moment.renderer.host(start, plus: $0) }) { moment.send(.bell(b)) }
    moment.render(0.2, block: 32)
    let first = moment.left.firstIndex { abs($0) > 1e-7 } ?? -1
    check(abs(first - Int(0.1 * sr)) <= 2, "the moment's first note on its host time: \(first)")

    // 11. silent output keeps the analysis running (screenshot sessions)
    let quiet = Offline()
    quiet.setUp(prefs: prefs, t0: vectorA, rate: 1)
    quiet.send(.silentOutput(true))
    quiet.render(0.3)
    var latest = [Float](repeating: 0, count: 4096)
    let copied = latest.withUnsafeMutableBufferPointer { quiet.renderer.scope.copyLatest(into: $0.baseAddress!, count: 4096) }
    check(quiet.left.allSatisfy { $0 == 0 } && copied && rms(latest[...]) > 1e-4, "silent output still feeds the scope")
}
