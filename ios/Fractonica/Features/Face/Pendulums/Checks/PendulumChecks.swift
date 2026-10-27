import CoreGraphics
import FractonicaKit
import Foundation

// The pendulum face's logic: the cascade's layout (order, lengths on a log scale of period, nothing collides or leaves
// the plate, the Pentad dial clear of every swing), the swing law (two swings a period, right first), how motion shows
// (trails, real blur, fans in a time-lapse and with Reduce Motion), the readings against the engine, the Pentad dial
// and what VoiceOver hears. Run: ios/scripts/check.sh ios/Fractonica/Features/Face/Pendulums/Checks

@main
struct PendulumChecks {
    static func main() {
        layoutChecks()
        swingChecks()
        motionChecks()
        readingChecks()
        dialChecks()
        wordChecks()
        Checks.finish()
    }
}

/// SPEC §12 vector A: 2026-10-08 12:00 UTC, Pentad II (its 2nd Helion) of sync 4820.
let vectorA = 1791460800.0
let clock = FractonicaClock.shared

func near(_ a: Double, _ b: Double, _ eps: Double = 1e-9) -> Bool { abs(a - b) <= eps }

func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }

// MARK: - Layout

func layoutChecks() {
    let all = PendulumLayout.all
    check(all.map(\.level) == [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0], "depth 12 (μ) on the left up to depth 1 (α): \(all.map(\.level))")
    check(all.map(\.column) == Array(0..<12), "columns in order")
    check(zip(all, all.dropFirst()).allSatisfy { $0.length < $1.length && $0.meanPeriod < $1.meanPeriod },
          "longer pendulums for slower levels")
    check(near(Double(all.first!.length), Double(PendulumSpace.shortest), 1e-9) && near(Double(all.last!.length), Double(PendulumSpace.longest), 1e-9),
          "μ is the shortest, α the longest")

    // lengths on a log scale of period: each step is proportional to the log of its factor (×5, ×13, ×5, ×4, ×9, …)
    let factors = [5.0, 13, 5, 4, 9, 11, 7, 5, 5, 13, 5]
    let perDecade = Double(PendulumSpace.longest - PendulumSpace.shortest) / log10(all.last!.meanPeriod / all.first!.meanPeriod)
    for (i, pair) in zip(all, all.dropFirst()).enumerated() {
        let ratio = pair.1.meanPeriod / pair.0.meanPeriod
        check(abs(ratio / factors[i] - 1) < 1e-6, "\(pair.0.level)→\(pair.1.level): periods ×\(factors[i]) (\(ratio))")
        check(near(Double(pair.1.length - pair.0.length), perDecade * log10(factors[i]), 1e-6), "step \(i) on the log scale")
    }

    // every bob sweeps the same width (μ capped at 30°), and none collides with its neighbours at any angle
    for spec in all {
        let reach = Double(spec.length) * sin(spec.amplitude)
        check(spec.amplitude <= PendulumSpace.maxAmplitude + 1e-12, "\(spec.level): at most 30°")
        check(reach <= Double(PendulumSpace.excursion) + 1e-9 && reach > 20, "\(spec.level): reaches \(reach) to each side")
        check(PendulumSpace.plate.insetBy(dx: 2, dy: 2).contains(spec.sweptBounds), "\(spec.level) stays on the plate: \(spec.sweptBounds)")
        check(spec.pivot.y > PendulumSpace.beam.maxY, "\(spec.level) hangs under the beam")
    }
    var tightest = CGFloat.infinity
    for (a, b) in zip(all, all.dropFirst()) {
        for i in 0...20 {
            for j in 0...20 {
                let pa = a.bob(angle: -a.amplitude + 2 * a.amplitude * Double(i) / 20)
                let pb = b.bob(angle: -b.amplitude + 2 * b.amplitude * Double(j) / 20)
                tightest = min(tightest, distance(pa, pb) - a.bobRadius - b.bobRadius)
            }
        }
    }
    check(tightest > 2, "neighbouring bobs never touch (closest gap \(tightest))")

    // the fast corner holds κ λ μ wherever they swing
    for spec in all where PendulumSpace.fastLevels.contains(spec.level) {
        check(PendulumLayout.fastRegion.contains(spec.sweptBounds), "the fast canvas holds \(spec.level)")
    }

    // the Pentad dial sits in the triangle the cascade leaves: clear of every bob and rod at every angle
    let d = PentadDial.self
    var clearance = CGFloat.infinity
    for spec in all {
        for i in 0...24 {
            let a = -spec.amplitude + 2 * spec.amplitude * Double(i) / 24
            clearance = min(clearance, distance(spec.bob(angle: a), d.center) - spec.bobRadius * 1.5 - d.discRadius)
            for k in 0...20 {
                clearance = min(clearance, distance(spec.point(angle: a, radius: spec.length * CGFloat(k) / 20), d.center) - d.discRadius)
            }
        }
    }
    check(clearance > 4, "the Pentad dial is clear of every swing (closest \(clearance))")
    let disc = CGRect(x: d.center.x - d.discRadius, y: d.center.y - d.discRadius, width: 2 * d.discRadius, height: 2 * d.discRadius)
    check(PendulumSpace.plate.insetBy(dx: 3, dy: 3).contains(disc), "the dial is on the plate: \(disc)")
    check(d.badgeRadius + d.badgeSize * 0.6 < d.discRadius, "the group badges are inside the disc")

    // fit: as large as fits, centred
    let fit = PendulumFit(size: CGSize(width: 720, height: 1100))
    check(abs(fit.scale - 2) < 1e-9 && abs(fit.origin.y - 50) < 1e-9 && abs(fit.origin.x) < 1e-9, "fits by width and centres: \(fit)")
    let wide = PendulumFit(size: CGSize(width: 1000, height: 500))
    check(abs(wide.scale - 1) < 1e-9 && abs(wide.origin.x - 320) < 1e-9, "fits by height and centres: \(wide)")
}

// MARK: - The swing law

func swingChecks() {
    let a = 0.3
    check(near(Swing.angle(phase: 0, amplitude: a), 0) && near(Swing.angle(phase: 0.25, amplitude: a), a)
          && near(Swing.angle(phase: 0.5, amplitude: a), 0, 1e-12) && near(Swing.angle(phase: 0.75, amplitude: a), -a),
          "centre at the start, right at the peak, centre at the node, left at the valley")
    check(Swing.heading(phase: 0.1) == 1 && Swing.heading(phase: 0.3) == -1 && Swing.heading(phase: 0.6) == -1 && Swing.heading(phase: 0.9) == 1,
          "right to the peak, left through the node to the valley, right home")
    check(near(Swing.speed(phase: 0), 1) && Swing.speed(phase: 0.25) < 1e-12 && near(Swing.speed(phase: 0.5), 1) && Swing.speed(phase: 0.75) < 1e-12,
          "fastest through the centre, still at the turning points")
    check((0..<4).allSatisfy { Swing.quarter(phase: (Double($0) + 0.5) / 4) == $0 } && Swing.quarter(phase: 1) == 3, "quarters")

    // two full swings a period: the bob turns exactly twice
    var turns = 0
    var last = Swing.heading(phase: 0.0005)
    for i in 1..<4000 {
        let h = Swing.heading(phase: (Double(i) + 0.5) / 4000)
        if h != last { turns += 1 }
        last = h
    }
    check(turns == 2, "turns twice a period (\(turns))")
}

// MARK: - Motion

func motionChecks() {
    let m = PendulumMotion.self
    func motion(_ level: Int, phase: Double, rate: Double, calm: Bool = false) -> PendulumMotion {
        let spec = PendulumLayout.spec(level)!
        return m.make(phase: phase, duration: spec.meanPeriod, amplitude: spec.amplitude, rate: rate, reduceMotion: calm)
    }
    for spec in PendulumLayout.all {
        let centre = motion(spec.level, phase: 0, rate: 1)
        let peak = motion(spec.level, phase: 0.25, rate: 1)
        check(centre.fan == 0, "\(spec.level): no fan at real speed")
        check(centre.trail >= m.trailGain * spec.amplitude - 1e-12 && centre.trail <= 2 * spec.amplitude, "\(spec.level): full trail through the centre")
        check(peak.trail < 1e-9 && peak.rodBlur < 1e-9, "\(spec.level): no trail at the turning point")
        // paused: the trail still says where it is heading, nothing blurs
        let still = motion(spec.level, phase: 0.6, rate: 0)
        check(still.fan == 0 && still.rodBlur == 0 && still.heading == -1 && still.trail > 0, "\(spec.level): a still instant keeps its trail")
    }
    // the trail's arc length is about the same for every pendulum: a slow one is as legible as a quick one
    let lengths = PendulumLayout.all.map { Double($0.length) * motion($0.level, phase: 0, rate: 1).trail }
    check((lengths.max()! - lengths.min()!) < 6, "trails of similar length: \(lengths.map { Int($0) })")
    // the quick pendulums blur for real
    check(motion(11, phase: 0, rate: 1).rodBlur > 0.05, "μ's rod blurs at real speed")
    check(motion(4, phase: 0, rate: 1).rodBlur < 1e-6, "ε's does not")
    // a time-lapse of an hour a second fans out what swings faster than the display
    let lapse = PendulumLayout.all.map { motion($0.level, phase: 0.1, rate: 3600).fan }
    check(lapse[0] == 1 && lapse[1] == 1 && lapse[2] == 1 && lapse[3] == 1, "κ λ μ and ι fan out at ×3600: \(lapse)")
    check(lapse[5...].allSatisfy { $0 == 0 }, "η and slower swing at ×3600: \(lapse)")
    check(motion(7, phase: 0, rate: 3600).rodBlur > 10 * motion(7, phase: 0, rate: 1).rodBlur, "θ blurs for real in the time-lapse")
    // Reduce Motion: the quick ones as fans, nothing blurs
    check(motion(11, phase: 0, rate: 1, calm: true).fan == 1 && motion(10, phase: 0, rate: 1, calm: true).fan == 1
          && motion(9, phase: 0, rate: 1, calm: true).fan == 0, "Reduce Motion fans μ and λ, κ swings")
    check(motion(9, phase: 0, rate: 1, calm: true).rodBlur == 0, "Reduce Motion: no real blur")
    // backwards, the bob moves the other way on screen
    check(motion(8, phase: 0.1, rate: -1).heading == -1 && motion(8, phase: 0.1, rate: 1).heading == 1, "reversed time flips the heading")
    // once κ fans out, so have λ and μ, even in cycles a little longer than the mean: their corner can stand still
    for rate in [600.0, 1000, 3600, -3600, 86_400] {
        guard let kappa = PendulumLayout.spec(9), PendulumMotion.fansOut(meanPeriod: kappa.meanPeriod, rate: rate) else { continue }
        for level in [9, 10, 11] {
            let spec = PendulumLayout.spec(level)!
            let f = m.make(phase: 0.3, duration: spec.meanPeriod * 1.05, amplitude: spec.amplitude, rate: rate, reduceMotion: false).fan
            check(f == 1, "\(level) is all fan at ×\(rate)")
        }
    }
    check(PendulumMotion.fansOut(meanPeriod: PendulumLayout.spec(9)!.meanPeriod, rate: 3600), "×3600 fans out the quick corner")
    check(!PendulumMotion.fansOut(meanPeriod: PendulumLayout.spec(9)!.meanPeriod, rate: 60) && !PendulumMotion.fansOut(meanPeriod: 1, rate: 0),
          "×60 and a still clock do not")
    // the fan blends in smoothly
    var previous = 0.0
    var monotonic = true
    for i in 0...100 {
        let rate = pow(10, Double(i) / 25)
        let f = motion(11, phase: 0, rate: rate).fan
        if f < previous - 1e-12 { monotonic = false }
        previous = f
    }
    check(monotonic && previous == 1, "μ fans out smoothly as the rate rises")
}

// MARK: - Readings

func readingChecks() {
    let levels = PendulumSpace.levels
    guard let swings = PendulumReading.swings(at: vectorA, levels: levels) else { return check(false, "swings at vector A") }
    check(swings.map(\.level) == levels, "one swing per level, in order")
    for s in swings {
        guard let r = clock.level(at: vectorA, s.level) else { continue }
        check(near(s.phase, (vectorA - r.start) / r.duration) && near(s.duration, r.duration), "\(s.level): the running cycle's place")
        check(Swing.quarter(phase: s.phase) == r.quarter || abs(s.phase * 4 - (s.phase * 4).rounded()) < 1e-6, "\(s.level): its quarter is the engine's")
    }
    check(PendulumReading.swings(at: clock.tMax + 10, levels: levels) == nil, "nothing outside the catalogue")
    check(PendulumReading.swings(at: clock.tMin - 10, levels: levels) == nil, "nothing before it")

    // continuous through a cycle's end: the pendulum passes the centre, it does not jump
    if let mu = clock.level(at: vectorA, 11), let spec = PendulumLayout.spec(11) {
        let before = PendulumReading.swings(at: mu.end - 1e-4, levels: [11])![0]
        let after = PendulumReading.swings(at: mu.end + 1e-4, levels: [11])![0]
        check(abs(before.angle(amplitude: spec.amplitude) - after.angle(amplitude: spec.amplitude)) < 0.01, "μ is continuous across its cycle's end")
    }

    // the slow layer's step: ι, its quickest, moves its bob about a tenth of a unit
    if let iota = PendulumLayout.spec(8) {
        let move = 2 * Double.pi * Double(PendulumSpace.excursion) / iota.meanPeriod * PendulumReading.slowStep
        check(move < 0.15, "ι moves \(move) units a step")
    }
}

// MARK: - The Pentad dial

func dialChecks() {
    let d = PentadDial.self
    check(near(d.angle(helions: 0), -Double.pi / 2 + d.groupGap / 2), "Pentad I starts at the top")
    check(near(d.angle(helions: 19), 3 * Double.pi / 2 - d.groupGap / 2, 1e-12), "the Hypopentad ends just before the top")
    var a = -Double.infinity
    var increasing = true
    for i in 0...1900 {
        let x = d.angle(helions: Double(i) / 100)
        if x <= a { increasing = false }
        a = x
    }
    check(increasing, "clockwise all the way round")
    // a gap between groups, a hairline between Helions
    for k in 0..<18 {
        let gap = d.segment(k + 1).start - d.segment(k).end
        let expected = d.group(ofHelion: k) != d.group(ofHelion: k + 1) ? d.groupGap + d.hairline : d.hairline
        check(near(gap, expected, 1e-12), "the gap after Helion \(k)")
    }
    check((0..<19).map { d.group(ofHelion: $0) } == [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3], "groups of 5, 5, 5 and 4")
    // each Pentad begins ¼η later in its solar day than the one before
    for k in 0..<4 { check(near(Double(5 * k) - d.dayTurns[k], Double(k) / 4), "Pentad \(k) starts \(k)/4 η after its day turns") }
    check(d.dayTurns.allSatisfy { near($0.truncatingRemainder(dividingBy: Pentads.solarDay), 0) }, "a solar day is 4¾η")

    guard let s = PentadDialState.make(at: vectorA) else { return check(false, "the dial at vector A") }
    check(s.sync == 4820 && s.index == 1 && s.helion == 2 && s.helions == 5 && s.within == 6, "vector A: Pentad II, 2nd Helion, the sync's 7th")
    if let eta = clock.level(at: vectorA, 6) {
        check(near(s.progress, (vectorA - eta.start) / eta.duration), "the running Helion fills with the Helion pendulum's phase")
    }
    check(PentadDialState.make(at: clock.tMax + 10) == nil, "no dial outside the catalogue")
    // the Hypopentad
    var t = vectorA
    var hypo: PentadDialState?
    for _ in 0..<40 {
        if let x = PentadDialState.make(at: t), x.isHypopentad { hypo = x; break }
        t += 3600 * 3
    }
    check(hypo.map { $0.helions == 4 && (15...18).contains($0.within) } == true, "the Hypopentad's Helions are the sync's last four")
}

// MARK: - Words

func wordChecks() {
    let n = Notation.standard
    let label = PendulumWords.label(at: vectorA, notation: n, outOfRange: ["outside"])
    check(label.hasPrefix("Pendulums. Pentad II, 2nd Helion of 5 · ε#"), "led by the Pentad: \(label)")
    check(label.hasSuffix(n.clockText(at: vectorA, upTo: "lambda")), "the minor reading down to the Flavon: \(label)")
    for earthy in ["%", " h ", "min", "UTC", "2026", ":"] { check(!label.contains(earthy), "no Earth units (\(earthy)) in \(label)") }
    check(PendulumWords.label(at: clock.tMax + 10, notation: n, outOfRange: ["outside the", "catalogue"]) == "Pendulums: outside the catalogue",
          "out of range")
    let swings = PendulumReading.swings(at: vectorA, levels: [4, 6, 8, 10])!
    let value = PendulumWords.value(swings)
    check(value.hasPrefix("Nuclide swinging") && value.contains("; Helion swinging") && value.contains("; Flavon swinging"), "the units' swings: \(value)")
    check(PendulumWords.swing(phase: 0.1) == "swinging right to its peak" && PendulumWords.swing(phase: 0.8) == "swinging back to its end", "swing words")
}
