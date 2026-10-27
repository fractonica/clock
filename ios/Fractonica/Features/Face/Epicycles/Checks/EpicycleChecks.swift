import CoreGraphics
import FractonicaKit
import Foundation

// The epicycle face (Features/Face/Epicycles): the configuration's validation and storage, the launch hooks, the arms'
// turns and angles, every arm's angle against the engine's own reading of its level (SPEC §12 vector A and random
// instants), the figure closing after one base cycle, the catalogue's clipped end, what the display can resolve, the
// Pentads in a base cycle against the engine, the cadences and the words in both modes.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Face/Epicycles/Checks

@main
struct EpicycleChecks {
    static func main() {
        configChecks()
        launchChecks()
        MainActor.assumeIsolated { storeChecks() }
        figureChecks()
        engineChecks()
        readingChecks()
        detailChecks()
        pentadChecks()
        cadenceChecks()
        wordChecks()
        Checks.finish()
    }
}

/// SPEC §12 vector A: 2026-10-08 12:00 UTC (Pentad II, its 2nd Helion, sync 4820).
let vectorA = 1791460800.0
let clock = FractonicaClock.shared

func near(_ a: Double, _ b: Double, _ eps: Double = 1e-9) -> Bool { abs(a - b) <= eps }
func near(_ a: CGPoint, _ b: CGPoint, _ eps: Double = 1e-9) -> Bool { abs(a.x - b.x) <= eps && abs(a.y - b.y) <= eps }

/// The distance between two angles in turns, folded into 0 … ½.
func apart(_ a: Double, _ b: Double) -> Double {
    let d = (a - b) - (a - b).rounded()
    return abs(d)
}

/// A reproducible generator (SplitMix64).
struct Seeded: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}

// MARK: - The configuration

func configChecks() {
    let d = EpicycleConfig()
    check(d.base == 6 && d.top == 9, "the default ladder is η θ ι κ (the Helion to κ)")
    check(d.frame == .dial && d.tips && d.off.isEmpty && d.reversed.isEmpty, "every arm on, clockwise, read from the top")
    check(d.levels == 6...9 && d.onLevels == [6, 7, 8, 9], "four arms")
    check(d.radius(6) == 1 && d.radius(7) == 0.4 && d.radius(9) == 0.03, "default lengths by place on the ladder")
    check(d.sanitized(keeping: d) == d, "the default is valid")

    check(EpicycleConfig.tops(base: 6) == 7...11, "η allows tops θ … λ (6 arms at most)")
    check(EpicycleConfig.tops(base: 10) == 11...13, "λ allows tops μ … ξ")
    check(EpicycleConfig.tops(base: 12) == 13...13, "ν allows ξ only")
    check(EpicycleConfig.bases == 0...12, "bases α … ν")

    var v = d
    v.base = 13
    check(v.sanitized(keeping: d).base == 6, "a base without a child falls back")
    v = d
    v.top = 6
    check(v.sanitized(keeping: d).top == 9, "a top no deeper than the base falls back")
    v = d
    v.top = 12
    check(v.sanitized(keeping: d).top == 9, "more than 6 arms falls back")
    v = d
    v.base = 11
    check(v.sanitized(keeping: d).top == 12, "the fallback's top is brought into the base's range (\(v.sanitized(keeping: d).top))")
    v = d
    v.radii = [6: 0.5, 7: -1, 8: .nan, 9: 2, 30: 0.5]
    check(v.sanitized(keeping: d).radii == [6: 0.5], "lengths out of range or of no level are dropped")
    v = d
    v.off = [6, 7, 8, 9]
    check(v.sanitized(keeping: d).off.isEmpty, "at least one arm stays on")
    v = d
    v.off = [6, 7, 8, 9, 40]
    var withOff = d
    withOff.off = [7]
    check(v.sanitized(keeping: withOff).off == [7], "switching every arm off keeps the arms that were off")
    v = d
    v.reversed = [7, -1, 99]
    check(v.sanitized(keeping: d).reversed == [7], "reversals of no level are dropped")

    // setBase keeps the top while it may, else the number of arms
    v = d
    v.setBase(7)
    check(v.base == 7 && v.top == 9, "θ under κ keeps κ")
    v.setBase(9)
    check(v.base == 9 && v.top == 11, "a base past the top keeps the arms' count (\(v.base)–\(v.top))")
    v.setBase(12)
    check(v.base == 12 && v.top == 13, "ν: only ξ below")
    v = d
    v.setBase(2)
    check(v.base == 2 && v.top == 5, "a base far above the top keeps the arms' count (\(v.top))")
    v.setBase(99)
    check(v.base == 2, "an impossible base is ignored")

    // coding: a round trip, and garbage falls back field by field
    var custom = d
    custom.base = 4
    custom.top = 7
    custom.radii = [4: 1, 5: 0.3, 7: 0.02]
    custom.off = [6]
    custom.reversed = [5]
    custom.frame = .carrier
    custom.tips = false
    if let data = try? JSONEncoder().encode(custom), let back = try? JSONDecoder().decode(EpicycleConfig.self, from: data) {
        check(back == custom, "a configuration survives the round trip")
    } else {
        check(false, "a configuration encodes and decodes")
    }
    let garbage = #"{"base": "η", "top": 99, "radii": {"6": 0.5, "x": 1, "7": 5}, "off": "none", "reversed": [7, 100], "frame": "spiral", "tips": 3}"#
    if let g = try? JSONDecoder().decode(EpicycleConfig.self, from: Data(garbage.utf8)) {
        check(g.base == 6 && g.top == 9, "a mistyped base and an impossible top fall back: \(g.base)–\(g.top)")
        check(g.radii == [6: 0.5], "only valid lengths are read: \(g.radii)")
        check(g.off.isEmpty && g.reversed == [7] && g.frame == .dial && g.tips, "the rest falls back")
    } else {
        check(false, "garbage still decodes")
    }
    if let empty = try? JSONDecoder().decode(EpicycleConfig.self, from: Data("{}".utf8)) {
        check(empty == d, "an empty value is the default")
    }
}

// MARK: - The launch hooks

func launchChecks() {
    let hooks = EpicycleLaunch(arguments: ["FXEpicycles": "6-10", "FXEpicycleRadii": "1, 0.4,0.15,0.05,0.02",
                                           "FXEpicycleReverse": "7", "FXEpicycleOff": "8", "FXEpicycleFrame": "Carrier",
                                           "FXEpicycleTips": "0", "FXEpicycleEdit": "1"])
    check(hooks.base == 6 && hooks.top == 10, "-FXEpicycles 6-10")
    check(hooks.radii == [1, 0.4, 0.15, 0.05, 0.02], "-FXEpicycleRadii")
    check(hooks.reversed == [7] && hooks.off == [8] && hooks.frame == .carrier && hooks.tips == false && hooks.edit, "the other hooks")
    let c = hooks.applied(to: EpicycleConfig())
    check(c.base == 6 && c.top == 10 && c.radius(10) == 0.02 && c.radius(7) == 0.4, "applied: η … λ with their lengths")
    check(c.frame == .carrier && !c.tips && c.off == [8] && c.reversed == [7], "applied: the rest")
    let none = EpicycleLaunch(arguments: [:])
    check(none.isEmpty && none.applied(to: EpicycleConfig()) == EpicycleConfig(), "no hooks, no change")
    let bad = EpicycleLaunch(arguments: ["FXEpicycles": "9-3", "FXEpicycleRadii": "x,5"])
    check(bad.applied(to: EpicycleConfig()).top == 9 && bad.applied(to: EpicycleConfig()).base == 9 || bad.applied(to: EpicycleConfig()).top > bad.applied(to: EpicycleConfig()).base,
          "an upside-down range is made valid")
    check(bad.applied(to: EpicycleConfig()).radii.isEmpty, "lengths out of range are ignored")
    let number = EpicycleLaunch(arguments: ["FXEpicycleTips": NSNumber(value: 1)])
    check(number.tips == true, "a number argument reads too")
}

// MARK: - The store

@MainActor
func storeChecks() {
    let suite = "epicycle-checks-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }

    let store = EpicycleSettings(defaults: defaults, launch: EpicycleLaunch())
    check(store.config == EpicycleConfig() && store.isStandard && !store.editing, "a fresh store shows the default")
    store.setRadius(0.5, level: 7)
    store.setReversed(true, level: 8)
    store.setBase(5)
    let reread = EpicycleSettings(defaults: defaults, launch: EpicycleLaunch())
    check(reread.config.radius(7) == 0.5 && reread.config.reversed == [8] && reread.config.base == 5, "changes are saved")
    store.setRadius(7, level: 7)
    check(store.config.radius(7) == 1, "a length is kept in range")
    store.setOn(false, level: 5)
    store.setOn(false, level: 6)
    store.setOn(false, level: 7)
    store.setOn(false, level: 8)
    store.setOn(false, level: 9)
    check(store.config.onLevels.count == 1, "the last arm stays on (\(store.config.onLevels))")
    store.reset()
    check(store.config == EpicycleConfig() && defaults.data(forKey: EpicycleSettings.key) == nil, "reset shows and stores the default")

    // garbage in storage
    defaults.set(Data("not json".utf8), forKey: EpicycleSettings.key)
    check(EpicycleSettings(defaults: defaults, launch: EpicycleLaunch()).config == EpicycleConfig(), "garbage falls back")
    defaults.removeObject(forKey: EpicycleSettings.key)

    // the launch hooks are shown, never saved; a change is saved on top of what was stored
    let hooked = EpicycleSettings(defaults: defaults, launch: EpicycleLaunch(arguments: ["FXEpicycles": "6-10", "FXEpicycleEdit": "1"]))
    check(hooked.config.top == 10 && hooked.editing, "the hooks show")
    check(defaults.data(forKey: EpicycleSettings.key) == nil, "and are not saved")
    hooked.setTips(false)
    let after = EpicycleSettings(defaults: defaults, launch: EpicycleLaunch())
    check(after.config.top == 9 && !after.config.tips, "a change is saved without the hooks")
}

// MARK: - The figure

func figureChecks() {
    // η … λ: 9θ, 4ι a θ, 5κ an ι, 13λ a κ
    var c = EpicycleConfig()
    c.top = 10
    let f = EpicycleFigure(c)
    check(f.arms.map(\.level) == [6, 7, 8, 9, 10], "the arms are η θ ι κ λ")
    check(f.arms.map(\.cycles) == [1, 9, 36, 180, 2_340], "their cycles a Helion: 1, 9, 36 (Preons), 180, 2,340 (Flavons)")
    check(f.arms.map(\.turns) == [1, 9, 36, 180, 2_340], "in the dial frame each turns with its own cycles")
    check(near(f.arms.map(\.length).reduce(0, +), 1, 1e-12), "the lengths share the reach")
    check(f.penLevel == 10 && f.top == 10, "the pen rides λ")

    // the Nuclide holds 77 Helions, a Preon 65 Flavons, a Flavon 25 Blinks
    var n = EpicycleConfig()
    n.base = 4
    n.top = 6
    check(EpicycleFigure(n).arms.map(\.cycles) == [1, 7, 77], "ε ζ η: 7 ζ, 77 Helions a Nuclide")
    var p = EpicycleConfig()
    p.base = 8
    p.top = 12
    check(EpicycleFigure(p).arms.map(\.cycles) == [1, 5, 65, 325, 1_625], "ι … ν: 65 Flavons a Preon, 1,625 Blinks")

    // reversed and carried
    var r = c
    r.reversed = [7]
    check(EpicycleFigure(r).arms.map(\.turns) == [1, -9, 36, 180, 2_340], "a reversed arm turns back")
    r.frame = .carrier
    check(EpicycleFigure(r).arms.map(\.turns) == [1, -8, 28, 208, 2_548], "carried: each on top of its carrier")

    // switched off: no length, still carries the frame
    var o = c
    o.off = [8]
    let fo = EpicycleFigure(o)
    check(fo.arms[2].length == 0 && !fo.arms[2].on && fo.onArms.count == 4, "an arm off has no length")
    check(near(fo.arms.map(\.length).reduce(0, +), 1, 1e-12), "the others share the reach")
    check(near(fo.joints(0.3)[2], fo.joints(0.3)[3]), "an arm off adds nothing to the path")

    // the angle convention: up at the start, right at the peak, down at the node, left at the valley
    let base = EpicycleFigure(c)
    for (phase, point) in [(0.0, CGPoint(x: 0, y: -1)), (0.25, CGPoint(x: 1, y: 0)), (0.5, CGPoint(x: 0, y: 1)), (0.75, CGPoint(x: -1, y: 0))] {
        let j = base.joints(phase)
        let r0 = base.arms[0].length
        check(near(j[1], CGPoint(x: point.x * r0, y: point.y * r0), 1e-12), "the base arm at \(phase) of its cycle")
    }
    let start = base.joints(0)
    check(near(start.last!, CGPoint(x: 0, y: -1), 1e-12), "every arm up at the base cycle's start: the pen at the top of the reach")
    // each arm is a hand of its own period: at a θ's peak the θ arm points right
    let peak = (2 + 0.25) / 9.0 // the third θ's peak
    let j = base.joints(peak)
    let theta = CGPoint(x: j[2].x - j[1].x, y: j[2].y - j[1].y)
    check(theta.x > 0 && abs(theta.y) < 1e-9, "the θ arm right at its peak")
    // reversed: left at its peak
    var rv = c
    rv.reversed = [7]
    let jr = EpicycleFigure(rv).joints(peak)
    check(jr[2].x - jr[1].x < 0 && abs(jr[2].y - jr[1].y) < 1e-9, "a reversed θ arm left at its peak")
    // carrier frame: at a θ's start the θ arm continues the η arm
    var cf = c
    cf.frame = .carrier
    let fc = EpicycleFigure(cf)
    for m in 0..<9 {
        let jc = fc.joints(Double(m) / 9)
        let a = CGPoint(x: jc[1].x, y: jc[1].y), b = CGPoint(x: jc[2].x - jc[1].x, y: jc[2].y - jc[1].y)
        check(abs(a.x * b.y - a.y * b.x) < 1e-12 && a.x * b.x + a.y * b.y > 0, "carried: θ \(m) begins along the η arm")
    }

    // closure: the figure closes after one base cycle, not before
    for figure in [base, EpicycleFigure(r), fc, fo] {
        check(near(figure.pen(1), figure.pen(0), 1e-9), "the figure closes after a base cycle")
        check(near(figure.pen(1 - 1e-9), figure.pen(0), 1e-5), "and runs smoothly into its start")
    }
    // the reach: never past 1
    let far = (0...5_000).map { Double(hypot(base.pen(Double($0) / 5_000).x, base.pen(Double($0) / 5_000).y)) }.max() ?? 2
    check(far <= 1 + 1e-12, "the pen stays within the reach (\(far))")

    // the cached curve: samples on the figure, closing
    let curve = base.curve(detail: 3)
    check(curve.count == 180 * EpicycleFigure.samplesPerTurn, "κ sampled \(EpicycleFigure.samplesPerTurn) times a turn (\(curve.count))")
    check(curve.tips.count == 4 && curve.tips.allSatisfy { $0.count == curve.count + 1 }, "every tip sampled")
    let i = curve.count / 7
    check(near(curve.tips[3][i], base.tip(3, Double(i) / Double(curve.count)), 1e-12), "the curve's samples are the tips")
    check(near(curve.tips[1][i], base.tip(1, Double(i) / Double(curve.count)), 1e-12), "every tip's")
    check(near(curve.tips[3][0], curve.tips[3][curve.count], 1e-9), "the curve closes")
    check(base.curve(detail: 3) === curve, "a figure's curve is cached")
    check(curve.prefix(3, upTo: 0.5).count == curve.count / 2, "the prefix to half the cycle")
    check(curve.prefix(3, upTo: 0).isEmpty && curve.prefix(3, upTo: 1).count == curve.count, "the prefix's ends")
}

// MARK: - Against the engine

/// Every arm's angle is its level's own phase (dial frame, clockwise), read from the base's phase alone.
func engineChecks() {
    var rng = Seeded(state: 141)
    var instants = [vectorA, 946_684_800, 2_886_085_800, clock.tMin + 3_600, clock.tMax - 86_400 * 400]
    for _ in 0..<60 { instants.append(Double.random(in: clock.tMin...clock.tMax, using: &rng)) }
    var worst = 0.0
    var compared = 0
    for t in instants {
        for base in [0, 2, 4, 6, 8, 10] {
            var c = EpicycleConfig()
            c.base = base
            c.top = min(base + 5, EpicycleConfig.deepest)
            let f = EpicycleFigure(c)
            guard let b = clock.level(at: t, base) else { continue }
            for (i, arm) in f.arms.enumerated() {
                guard let k = clock.level(at: t, arm.level) else { continue }
                let d = apart(f.angle(i, b.phase), k.phase)
                // a level's phase from the base's, a double: off by the base's rounding times its cycles
                worst = max(worst, d / Double(max(arm.cycles, 1)))
                compared += 1
                if d > 1e-15 * Double(arm.cycles) + 1e-12 {
                    check(false, "\(arm.level)'s arm at \(t) (base \(base)): \(f.angle(i, b.phase)) vs the engine's \(k.phase)")
                }
            }
        }
    }
    check(compared > 1_500, "every arm compared with the engine (\(compared))")
    check(worst < 1e-15, "the arms are the engine's phases, to the base's rounding (\(worst) a cycle)")

    // vector A: the Helion's 34η 29ι is ι's 29th Preon done: the ι arm's cycle count
    var c = EpicycleConfig()
    c.top = 10
    let f = EpicycleFigure(c)
    if let h = clock.level(at: vectorA, 6), let minor = Notation.standard.clock(at: vectorA) {
        check(Int((h.phase * 36).rounded(.down)) == minor.iota, "vector A: \(minor.iota) Preons done in the Helion")
        let lambda = Int((h.phase * 2_340).rounded(.down)) - 65 * minor.iota
        check(lambda == minor.lambda, "vector A: \(minor.lambda) Flavons done in the Preon")
        if let l = clock.level(at: vectorA, 10) {
            check(apart(f.angle(4, h.phase), l.phase) < 1e-9, "vector A: the λ arm is the Flavon's phase")
        }
    }
}

// MARK: - The reading

func readingChecks() {
    guard let r = EpicycleReading.at(vectorA, base: 6), let h = clock.level(at: vectorA, 6) else {
        return check(false, "a reading at vector A")
    }
    check(r.cycle == h.cycle && r.phase == h.phase && r.start == h.start && r.end == h.end, "the base's reading")
    check(r.endPhase == 1 && near(r.seconds, h.duration, 1e-3), "a whole cycle (\(r.seconds) s, \(h.duration) s)")
    check(r.cut(steps: 720) == Int((h.phase * 720).rounded(.down)), "the trace's step")
    check(EpicycleReading.at(clock.tMax + 10, base: 6) == nil && EpicycleReading.at(clock.tMin - 10, base: 6) == nil,
          "nothing outside the catalogue")

    // the catalogue's last cycles are clipped: the figure stops where the catalogue does
    var clippedSeen = 0
    for base in 0...12 {
        guard let last = EpicycleReading.at(clock.tMax - 1, base: base), let facts = clock.level(at: clock.tMax - 1, base) else { continue }
        if facts.clipped {
            clippedSeen += 1
            check(last.endPhase < 1 && last.endPhase >= last.phase, "level \(base): the figure ends at the catalogue (\(last.endPhase))")
            check(last.seconds > last.end - last.start, "level \(base): the clipped cycle's speed as if it ran on")
        } else {
            check(last.endPhase == 1, "level \(base): the last cycle is whole")
        }
    }
    check(clippedSeen >= 1, "the catalogue clips some last cycles (\(clippedSeen))")
    if let first = EpicycleReading.at(clock.tMin + 1, base: 0) {
        check(first.cycle == 0 && first.phase < 1e-6 && first.endPhase == 1, "the catalogue begins with a whole α")
    }
}

// MARK: - What the display shows

func detailChecks() {
    let scale = 0.8 * 187.0 // an iPhone's face: the reach in points
    let standard = EpicycleFigure(EpicycleConfig())
    check(standard.detail(scale: scale) == 3, "η θ ι κ: every arm a curve on an iPhone")
    check(standard.band(after: 3) == 0 && standard.bandLevel(after: 3) == nil, "no band")
    var c = EpicycleConfig()
    c.top = 10
    let flavons = EpicycleFigure(c)
    let d = flavons.detail(scale: scale)
    check(d == 3, "η … λ: the Flavon's 2,340 loops run into a band (curves up to \(flavons.arms[d].level))")
    check(near(flavons.band(after: d), flavons.arms[4].length) && flavons.bandLevel(after: d) == 10, "the band is λ's reach")
    check(flavons.detail(scale: scale * 40) == 4 || flavons.arms[4].turns > EpicycleFigure.maxTurns, "a far larger face could draw them, sampling allowing")
    check(flavons.detail(scale: 2) == 0, "a tiny face draws the base's circle only")
    check(flavons.sampleCount(detail: d) == 180 * EpicycleFigure.samplesPerTurn, "sampled for κ")
    // the sampling cap
    var deep = EpicycleConfig()
    deep.base = 0
    deep.top = 5
    let alpha = EpicycleFigure(deep)
    let ad = alpha.detail(scale: 1_000)
    check(alpha.sampleCount(detail: ad) <= EpicycleFigure.maxSamples, "α … ζ stays within the samples (\(alpha.sampleCount(detail: ad)))")
    check(alpha.arms.prefix(ad + 1).allSatisfy { abs($0.turns) <= EpicycleFigure.maxTurns }, "no sampled arm outruns its samples")

    // blur: a time-lapse of an hour a second turns θ faster than the eye follows, not η
    let seconds = clock.levelInfo(6).meanSeconds
    check(standard.firstBlurred(speed: 1, seconds: seconds) == nil, "at real speed nothing blurs (κ turns once in ~100 s)")
    check(standard.firstBlurred(speed: 3_600, seconds: seconds) == 1, "×3,600: θ blurs, and what it carries")
    check(flavons.firstBlurred(speed: 1, seconds: seconds) == nil, "λ, once in ~7.8 s, is followed at real speed")
    check(flavons.firstBlurred(speed: 10, seconds: seconds) == 4, "×10: λ blurs")
    check(standard.penSpeed(seconds: seconds, blurred: 1) < standard.penSpeed(seconds: seconds), "a blur's arms are left out of the pen's speed")
}

// MARK: - The Pentads in a base cycle

func pentadChecks() {
    check(EpicyclePentads.at(vectorA, base: 6) == nil && EpicyclePentads.at(vectorA, base: 8) == nil,
          "a Helion's figure (or shorter) lies in one Pentad")
    var rng = Seeded(state: 77)
    var instants = [vectorA]
    for _ in 0..<6 { instants.append(Double.random(in: (clock.tMin + 86_400 * 400)...(clock.tMax - 86_400 * 400), using: &rng)) }
    for t in instants {
        for base in [4, 5] {
            guard let p = EpicyclePentads.at(t, base: base), let b = clock.level(at: t, base), let now = Pentads.at(t) else {
                check(false, "the Pentads of a base \(base) cycle at \(t)")
                continue
            }
            check(p.helions == (base == 4 ? 77 : 11), "\(p.helions) Helions a \(base == 4 ? "Nuclide" : "ζ")")
            check(p.pentad == now.index, "the running Pentad")
            check(p.from <= b.phase && b.phase < p.to + 1e-12, "the running Pentad's stretch holds the moment")
            // every start is where the engine's Pentad begins
            let first = b.cycle * Int64(p.helions)
            for s in p.starts {
                guard let facts = clock.cycle(level: 6, index: first + Int64(s.helion)), let at = Pentads.at(facts.start + 1) else { continue }
                check(at.index == s.pentad && at.helion == 1, "Helion \(s.helion) of the cycle begins Pentad \(s.pentad) (engine: \(at.index), \(at.helion))")
                check(near(p.phase(ofHelion: s.helion), clock.level(at: facts.start + 1, base).map { $0.phase } ?? -1, 1e-4),
                      "and lies on the scale where the base arm stands then")
            }
            // and every Helion not listed begins no Pentad
            if base == 5 {
                for j in 0..<p.helions where !p.starts.contains(where: { $0.helion == j }) {
                    if let facts = clock.cycle(level: 6, index: first + Int64(j)), let at = Pentads.at(facts.start + 1) {
                        check(at.helion != 1, "ζ's Helion \(j) begins no Pentad")
                    }
                }
            }
            // the stretch's ends are the running Pentad's ends
            if let start = clock.level(at: now.start + 1, base), start.cycle == b.cycle {
                check(near(p.from, Double(Int((start.phase * Double(p.helions)).rounded(.down))) / Double(p.helions), 1e-9),
                      "the stretch begins with the Pentad")
            }
        }
    }
    // a Nuclide's Pentads: 77 Helions hold about 16 starts, in order I II III ◻
    if let p = EpicyclePentads.at(vectorA, base: 4) {
        check((15...17).contains(p.starts.count), "a Nuclide holds about 16 Pentad starts (\(p.starts.count))")
        let order = p.starts.map(\.pentad)
        check(zip(order, order.dropFirst()).allSatisfy { ($0 + 1) % 4 == $1 }, "they follow I II III ◻: \(order)")
    }
    check(EpicyclePentads.at(vectorA, base: 3)?.starts.isEmpty == true, "a Delta's 385 Helions are too many to mark")
}

// MARK: - Cadences

func cadenceChecks() {
    let seconds = clock.levelInfo(6).meanSeconds
    check(EpicycleCadence.traceSteps(seconds: seconds, speed: 1) == 720, "live: the trace steps 720 times a Helion")
    check(EpicycleCadence.traceSteps(seconds: seconds, speed: 0) == 720, "paused: the same")
    let lapse = EpicycleCadence.traceSteps(seconds: seconds, speed: 3_600)
    check(lapse < 720 && Double(lapse) * 3_600 * 0.1 <= seconds * 1.01, "×3,600: at most ten trace redraws a real second (\(lapse))")
    check(EpicycleCadence.traceSteps(seconds: seconds, speed: 1e7) == 24, "never fewer than 24 steps")

    let f = EpicycleFigure(EpicycleConfig())
    let scale = 150.0
    let step = EpicycleCadence.motionStep(penSpeed: f.penSpeed(seconds: seconds), scale: scale, seconds: seconds, steps: 720,
                                          speed: 1, reduceMotion: false)
    check(step > 0.05 && step <= seconds / 720, "live: the arms redraw while the pen moves a third of a point (\(step) s)")
    check(f.penSpeed(seconds: seconds) * scale * step <= 0.35 + 1e-9, "the pen moves at most a third of a point a redraw")
    let reduced = EpicycleCadence.motionStep(penSpeed: f.penSpeed(seconds: seconds) * 100, scale: scale, seconds: seconds, steps: 720,
                                             speed: 1, reduceMotion: true)
    check(reduced >= 1, "Reduce Motion: at most once a second (\(reduced))")
    check(EpicycleCadence.motionStep(penSpeed: 0, scale: scale, seconds: seconds, steps: 720, speed: 1, reduceMotion: false)
          == seconds / 720, "a still pen redraws with the trace")
    // a fast pen (η … λ on a large face) still redraws at most once a Blink
    var c = EpicycleConfig()
    c.top = 10
    let fast = EpicycleFigure(c)
    let blink = Notation.standard.blinkSeconds
    check(near(blink, seconds / 58_500, seconds * 1e-6), "a Blink is a 58,500th of a Helion (\(blink) s)")
    let fastStep = EpicycleCadence.motionStep(penSpeed: fast.penSpeed(seconds: seconds), scale: 400, seconds: seconds, steps: 720,
                                              speed: 1, reduceMotion: false)
    check(fastStep >= blink && fastStep < 0.35, "η … λ: once a Blink (\(fastStep) s)")
    check(EpicycleCadence.lapseStep == 1.0 / 30, "a time-lapse: 30 redraws a real second at most")

    // the hub's Helion: at the Helion's end; nothing the hub shows changes before
    guard let h = clock.level(at: vectorA, 6) else { return }
    check(EpicycleCadence.helion(after: vectorA) == h.end, "the hub changes with the Helion")
    check(EpicycleCadence.helion(after: clock.tMax + 1) == nil, "never past the catalogue")
    // the rim's Pentads: at the earlier of the Pentad's end and the base cycle's
    if let p = Pentads.at(vectorA), let e = clock.level(at: vectorA, 4) {
        check(EpicycleCadence.pentads(after: vectorA, base: 4) == min(p.end, e.end), "the rim's Pentads change with the Pentad or the Nuclide")
        var t = vectorA
        for _ in 0..<12 {
            guard let next = EpicycleCadence.pentads(after: t, base: 4), let a = EpicyclePentads.at(t, base: 4),
                  let b = EpicyclePentads.at(next - 0.01, base: 4), let c = EpicyclePentads.at(next + 0.01, base: 4) else { break }
            check(a == b, "the rim's Pentads hold until the next change")
            check(c != a, "and change there")
            t = next + 0.002
        }
    }
    // the trace's steps change exactly at multiples of the cycle over the steps (phase linear in time in a Helion)
    if let r = EpicycleReading.at(vectorA, base: 6) {
        let k = r.cut(steps: 720)
        let boundary = r.start + Double(k + 1) / 720 * (r.end - r.start)
        if let before = EpicycleReading.at(boundary - 0.01, base: 6), let after = EpicycleReading.at(boundary + 0.01, base: 6) {
            check(before.cut(steps: 720) == k && after.cut(steps: 720) == k + 1, "the trace's step turns at its boundary")
        }
    }
}

// MARK: - Words

func wordChecks() {
    check(EpicycleWords.name(6) == "Helion" && EpicycleWords.name(4) == "Nuclide" && EpicycleWords.name(7) == "θ"
          && EpicycleWords.name(3) == "Delta", "levels by name, the levels between by letter")
    let f = EpicycleFigure(EpicycleConfig())
    check(EpicycleWords.letters(f) == ["η", "θ", "ι", "κ"], "the arms' letters")
    check(EpicycleWords.turns(level: 6, cycles: 1, base: 6) == "once a Helion", "the base turns once")
    check(EpicycleWords.turns(level: 10, cycles: 2_340, base: 6) == "2,340 times a Helion", "λ 2,340 times a Helion")
    check(EpicycleWords.turns(level: 9, cycles: 5, base: 8) == "5 times a Preon", "κ 5 times a Preon")

    let pure = EpicycleWords.spoken(f, at: vectorA, pure: true)
    check(pure.hasPrefix("Epicycles of η, θ, ι and κ, closing once a Helion. Pentad II, 2nd Helion of 5 · 34η 29ι."),
          "VoiceOver: the arms, then the reading led by its Pentad: \(pure)")
    check(pure.contains("Pentad III in "), "and when the next Pentad begins: \(pure)")
    var earthly = ["hour", "second", "minute", " h ", " min", "%", "UTC"].filter { pure.contains($0) }
    if pure.range(of: #"\d{1,2}:\d{2}"#, options: .regularExpression) != nil { earthly.append("clock time") }
    check(earthly.isEmpty, "pure words have no Earth units (\(earthly)): \(pure)")
    let earth = EpicycleWords.spoken(f, at: vectorA, pure: false)
    check(earth.contains("Pentad III in ") && earth.contains(" h"), "Earth words count down in hours: \(earth)")
    // the editor's words in both modes say no Earth unit for a period
    for level in 0...13 {
        let text = EpicycleWords.turns(level: level, cycles: 7, base: max(0, level - 1)) + EpicycleWords.name(level)
        check(!["hour", "minute", "second", " h", " min", " s "].contains(where: text.contains), "no Earth unit for level \(level): \(text)")
    }
}
