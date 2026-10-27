import CoreGraphics
import FractonicaKit
import Foundation

// The star face (Features/Face/Star): the {19/4} geometry of the sync's Helions in the solar day (boundary positions,
// chord ↔ Helion, the Pentads' windings, closure after 19), the rose's 9 θ × 4 ι, the reading against the engine and
// SPEC §7.5's vector A, the cadences (nothing drawn changes between two redraws) and the words in both modes.
// Run: ios/scripts/check.sh ios/Fractonica/Features/Face/Star/Checks

@main
struct StarChecks {
    static func main() {
        starChecks()
        roseChecks()
        readingChecks()
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

/// Turns between two angles in turns, folded into −½ ..< ½.
func delta(_ a: Double, _ b: Double) -> Double {
    let d = (b - a) - (b - a).rounded()
    return d
}

// MARK: - The star

func starChecks() {
    typealias G = StarGeometry
    check(G.points == 19 && G.step == 4 && G.helions == 19, "19 points, 4 a Helion, 19 Helions a sync")
    check(G.ticks == 171, "171 Preon ticks: a solar day is 171ι (4¾η · 36)")
    check(near(4.75 * 36, Double(G.ticks)), "4¾η = 171ι")
    check(near(Pentads.solarDay, Double(G.points) / Double(G.step)), "the solar day is 19/4 Helions (Pentads.solarDay)")

    // boundary k lies (4k mod 19)/19 of a turn from the sync's start: its time of day, in solar days, from the start
    for k in 0...19 {
        let tod = Double(k) / Pentads.solarDay
        let expected = tod - tod.rounded(.down)
        check(near(G.turns(ofVertex: G.vertex(ofBoundary: k)), expected, 1e-12), "boundary \(k) at its time of day")
        check(G.vertex(ofBoundary: k) == (4 * k) % 19, "boundary \(k) at point 4k mod 19")
    }
    // the 19 Helions visit every point once (4 and 19 are coprime) and close: {19/4}
    let starts = (0..<19).map(G.vertex(ofBoundary:))
    check(Set(starts).count == 19, "the sync's Helions begin at 19 distinct points")
    check(G.vertex(ofBoundary: 19) == G.vertex(ofBoundary: 0), "after 19 Helions the figure closes")
    for n in 1..<19 { check(G.vertex(ofBoundary: n) != 0, "it does not close before 19 (\(n))") }
    var walked = 0
    for k in 0..<19 {
        let (a, b) = G.chord(k)
        check(a == G.vertex(ofBoundary: k) && b == G.vertex(ofBoundary: k + 1), "chord \(k) joins its Helion's ends")
        check((b - a + 19) % 19 == 4, "chord \(k) skips 4 points")
        walked += 4
        // the inverse: the Helion starting at a point
        check(G.helion(startingAt: a) == k, "point \(a) starts Helion \(k)")
    }
    check(walked == 4 * 19, "the star winds 4 turns: 19 Helions are 4 solar days")

    // each chord subtends the Sun's arc in its Helion: the Sun's turns at its start and end are the chord's points
    for k in 0..<19 {
        let (a, b) = G.chord(k)
        check(near(delta(G.turns(ofVertex: a), G.sunTurns(helion: k, phase: 0)), 0, 1e-12), "the Sun at chord \(k)'s start")
        check(near(delta(G.turns(ofVertex: b), G.sunTurns(helion: k, phase: 1 - 1e-12)), 0, 1e-9), "the Sun at chord \(k)'s end")
        let mid = G.sunTurns(helion: k, phase: 0.5)
        check(near(delta(G.turns(ofVertex: a), mid), G.chordTurns / 2, 1e-12), "the Sun halfway along chord \(k)'s arc")
        // the pen meets the Sun at the boundaries, and lies on the chord in between
        check(near(G.pen(helion: k, phase: 0), G.vertexPoint(a)), "the pen starts at the chord's start (\(k))")
        check(near(G.pen(helion: k, phase: 1), G.vertexPoint(b)), "the pen ends at the chord's end (\(k))")
        let p = G.pen(helion: k, phase: 0.5)
        check(near(Double(hypot(p.x, p.y)), G.chordDistance, 1e-12), "the chord's middle touches the clear circle (\(k))")
    }
    check(near(G.chordDistance, cos(.pi * 4 / 19)), "every chord is tangent to the circle of radius cos(4π/19)")

    // the Pentads: chords 0–4, 5–9, 10–14, 15–18; 5 chords wind 20/19 (one point past the start), the Hypopentad 16/19
    check(G.helions(ofPentad: 0) == 0..<5 && G.helions(ofPentad: 1) == 5..<10 && G.helions(ofPentad: 2) == 10..<15
          && G.helions(ofPentad: 3) == 15..<19, "Pentads I, II, III and the Hypopentad own chords 0–4, 5–9, 10–14, 15–18")
    for i in 0..<4 {
        let range = G.helions(ofPentad: i)
        let first = G.vertex(ofBoundary: range.lowerBound), last = G.vertex(ofBoundary: range.upperBound)
        check(first == i, "Pentad \(i) begins at point \(i): ¼η later in the day than the one before")
        check(last == (i + 1) % 4, "Pentad \(i) ends where the next begins (point \((i + 1) % 4))")
        check(near(G.winding(ofPentad: i), i == 3 ? 16.0 / 19 : 20.0 / 19), "Pentad \(i) winds \(i == 3 ? "16" : "20")/19")
        check(near(G.winding(ofPentad: i).truncatingRemainder(dividingBy: 1), i == 3 ? 16.0 / 19 : 1.0 / 19),
              "Pentad \(i) slips \(i == 3 ? "back to the start" : "one point, ¼η")")
        check(G.figure(ofPentad: i).count == G.pentadHelions[i] + 1, "Pentad \(i)'s figure: its Helions' starts and the next")
        for k in range {
            check(G.pentad(ofHelion: k) == i, "Helion \(k) is in Pentad \(i)")
            check(G.pentad(ofVertex: G.vertex(ofBoundary: k)) == i, "Helion \(k)'s point carries Pentad \(i)'s shape")
            check(G.place(ofHelion: k) == k - range.lowerBound + 1, "Helion \(k)'s place in its Pentad")
        }
    }
    check(near(G.winding(ofPentad: 0) * 3 + G.winding(ofPentad: 3), 4), "the four Pentads wind 4 turns: 4 solar days")
    // around the day the points run I II III ◻ … I II III: 5 of each Pentad, 4 squares
    let around = (0..<19).map(G.pentad(ofVertex:))
    check(around == [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2], "the rim reads I II III ◻ …: \(around)")
    check((0..<4).map { i in around.filter { $0 == i }.count } == [5, 5, 5, 4], "5, 5, 5 and 4 points")

    // points
    check(near(G.point(turns: 0), CGPoint(x: 0, y: -1)), "the top is turn 0")
    check(near(G.point(turns: 0.25), CGPoint(x: 1, y: 0), 1e-12), "a quarter turn is the right (clockwise)")
    check(near(G.point(turns: 0.5), CGPoint(x: 0, y: 1), 1e-12), "half a turn is the bottom")

    // the dial's proportions: the rose fits inside the star's clear disc, the hub inside the rose's open middle
    check(StarRose.outerRadius < StarDial.clearRadius - 0.03, "the rose (\(StarRose.outerRadius)) clears the chords (\(StarDial.clearRadius))")
    check(StarDial.hub < StarRose.innerRadius, "the hub fits the rose's middle")
    check(StarRose.outerRadius < StarDial.scaleMajor && StarDial.scaleMajor < StarDial.scaleMinor
          && StarDial.scaleOuter < StarDial.clearRadius - 0.02, "the Helion's scale lies between the rose and the chords")
    check(StarDial.starRadius < StarDial.tickMajor && StarDial.tickOuter < StarDial.hours && StarDial.hours < StarDial.bezel
          && StarDial.bezel < StarDial.plate && StarDial.plate <= 1, "the rings nest")
}

// MARK: - The rose

func roseChecks() {
    typealias R = StarRose
    // relative turns: θ 9 a Helion against η, ι 4 a θ against θ; absolute 1, −8, 28
    check(R.relative == [1, -9, 36], "η once, θ 9 times against it, ι 36 (4 a θ) against θ")
    check(R.frequencies == [1, 1 - 9, 1 - 9 + 36], "absolute turns are the relative ones summed")
    check(R.frequencies.allSatisfy { Int($0).quotientAndRemainder(dividingBy: 9).remainder == 1 || Int($0) % 9 == -8 },
          "every arm turns 1 mod 9 a Helion: each θ draws the same cell")
    // all arms up at the start; aligned at every θ (the figure's 9 tips, at its outer radius)
    let start = R.joints(0)
    check(near(start[1], CGPoint(x: 0, y: -R.radii[0])) && near(start[3], CGPoint(x: 0, y: -R.outerRadius)), "all arms up at the Helion's start")
    for m in 0..<9 {
        let tip = R.pen(Double(m) / 9)
        check(near(Double(hypot(tip.x, tip.y)), R.outerRadius, 1e-12), "θ \(m) begins at a tip")
        check(near(tip, StarGeometry.point(turns: Double(m) / 9, radius: R.outerRadius), 1e-12), "tip \(m) a ninth of a turn on")
        // the figure repeats a ninth of a turn on
        let s = 0.013
        let a = R.pen(s), b = R.pen(s + Double(m) / 9)
        let turn = 2 * Double.pi * Double(m) / 9
        let rotated = CGPoint(x: a.x * cos(turn) - a.y * sin(turn), y: a.x * sin(turn) + a.y * cos(turn))
        check(near(rotated, b, 1e-12), "θ \(m)'s cell is θ 0's turned \(m)/9")
    }
    // at each ι boundary the ι arm lines up with the θ arm again (a cusp of the cell)
    for q in 0..<36 {
        let j = R.joints(Double(q) / 36)
        let theta = CGPoint(x: j[2].x - j[1].x, y: j[2].y - j[1].y), iota = CGPoint(x: j[3].x - j[2].x, y: j[3].y - j[2].y)
        let cross = theta.x * iota.y - theta.y * iota.x, dot = theta.x * iota.x + theta.y * iota.y
        check(abs(cross) < 1e-12 && dot > 0, "ι \(q) begins with the ι arm along the θ arm")
    }
    check(near(R.pen(1), R.pen(0), 1e-12), "the rose closes after a Helion")
    check(R.samples.count == R.sampleCount + 1 && near(R.samples.first!, R.samples.last!, 1e-12), "the samples close")
    check(R.tips.count == 9, "9 tips")
    // the pen's distance from the centre stays within the figure's ring
    let radii = R.samples.map { Double(hypot($0.x, $0.y)) }
    check((radii.min() ?? 0) >= R.innerRadius - 1e-9 && (radii.max() ?? 1) <= R.outerRadius + 1e-9, "the rose stays in its ring")
}

// MARK: - The reading

func readingChecks() {
    guard let r = StarReading.at(vectorA) else { return check(false, "a reading at vector A") }
    check(r.sync == 4820 && r.pentad == 1 && r.place == 2 && r.helions == 5, "vector A: sync 4820, Pentad II, 2nd Helion of 5")
    check(r.helion == 6, "vector A: the sync's Helion 6 (chord 6)")
    check(r.nextPentad == 2, "Pentad III comes next")
    if let minor = Notation.standard.clock(at: vectorA) {
        check(r.preon == minor.iota, "the rose's Preon (\(r.preon)) is the reading's ι (\(minor.iota))")
        check(r.theta == minor.iota / 4 && r.iotaInTheta == minor.iota % 4, "θ and ι in θ from the Preons")
        check(Int((r.flavonPhase + Double(r.preon) * 65 + 0).rounded(.down)) >= 0, "the Flavon's phase")
    }
    if let lambda = clock.level(at: vectorA, 10) {
        check(near(r.flavonPhase, lambda.phase, 1e-6), "the Flavon's phase from the Helion's (\(r.flavonPhase) vs \(lambda.phase))")
    }
    // the sync's start: the Sun at the top
    if let solar = clock.solar(at: vectorA) {
        let elapsed = (vectorA - solar.start) / (solar.end - solar.start) * 4 // solar days since the sync began
        check(near(delta(r.sunTurns, elapsed - elapsed.rounded(.down)), 0, 1e-4), "the Sun at the time of day since the sync began")
    }

    // a whole sync: Helion by Helion, the reading follows the Pentads and the chords
    guard let solar = clock.solar(at: vectorA), let first = StarReading.at(solar.start + 1) else { return check(false, "the sync") }
    check(first.helion == 0 && first.pentad == 0 && first.place == 1, "the sync begins with Pentad I's first Helion")
    check(near(first.sunTurns, 0, 1e-3), "the Sun at the top as the sync begins")
    var t = solar.start + 1
    var seen: [Int] = []
    while t < solar.end, let h = clock.level(at: t, 6), let x = StarReading.at(t) {
        seen.append(x.helion)
        check(x.sync == solar.sync, "Helion \(x.helion) is in the sync")
        check(x.pentad == StarGeometry.pentad(ofHelion: x.helion) && x.place == StarGeometry.place(ofHelion: x.helion),
              "Helion \(x.helion)'s Pentad and place")
        t = h.end + 1
    }
    check(seen == Array(0..<19), "19 Helions, in order: \(seen)")
    check(StarReading.at(clock.tMax + 10) == nil && StarReading.at(clock.tMin - 10) == nil, "nothing outside the catalogue")

    // the hours (Earth): the Sun stands at the clock's time of day
    let utc = EarthFormatter(zone: "UTC")
    let midnight = StarHours.midnightTurns(at: vectorA, sunTurns: r.sunTurns, earth: utc)
    // 12:00 UTC: the Sun at midnight + ½
    check(near(delta(midnight + 0.5, r.sunTurns), 0, 1e-9), "at 12:00 the Sun stands at hour 12")
    let later = vectorA + 3 * 3_600
    if let r2 = StarReading.at(later) {
        let m2 = StarHours.midnightTurns(at: later, sunTurns: r2.sunTurns, earth: utc)
        check(abs(delta(midnight, m2)) < 1e-4, "the hours stand still within a sync (\(delta(midnight, m2)) turns)")
    }
}

// MARK: - Cadences

func cadenceChecks() {
    guard let r = StarReading.at(vectorA) else { return }
    check(StarCadence.helion(after: vectorA) == r.end, "the chords change at the Helion's end")
    // the moving parts step once a μ (5 a Flavon), the spark once a Blink; evenly in time, never past the Helion's end
    let steps = StarCadence.motionSteps(reduceMotion: false)
    check(steps == 2_340 * 5, "the pen, the Sun and the rose: 5 steps a Flavon (once a μ)")
    check(StarCadence.motionSteps(reduceMotion: true) == 2_340, "Reduce Motion: once a Flavon")
    check(StarCadence.sparkSteps == 58_500, "the spark: once a Blink (58,500 a Helion)")
    var t = r.start + 0.5
    var count = 0
    var worst = 0.0
    let step = (r.end - r.start) / Double(steps)
    while count < 2_000, let next = StarCadence.motion(after: t, steps: steps) {
        check(next > t, "the next step is ahead")
        worst = max(worst, next - t)
        t = next
        count += 1
    }
    check(worst <= step * 1.0001, "a step is at most a μ (\(worst) s)")
    // the spark: what it shows (its Blink, the pen's step) holds between two of its redraws, and changes at each
    // (the engine reads time to the millisecond, so a change can come half a millisecond early: the redraw comes 2 ms
    // after it, ChangeSchedule.lag)
    var s = r.start + 0.5
    var missed = 0, idle = 0
    for _ in 0..<600 {
        guard let next = StarCadence.motion(after: s, steps: StarCadence.sparkSteps),
              let a = StarReading.at(s), let b = StarReading.at(next - 1.5e-3), let c = StarReading.at(next + 2e-3) else { break }
        if a.blink != b.blink || a.steppedPhase(steps) != b.steppedPhase(steps) { missed += 1 }
        if c.blink == a.blink { idle += 1 }
        s = next + 0.002
    }
    check(missed == 0, "the spark misses no Blink between redraws (\(missed))")
    check(idle == 0, "and redraws only when its Blink changes (\(idle))")
    if let minor = Notation.standard.clock(at: vectorA) {
        check(r.blink == minor.nu, "the spark's Blink (\(r.blink)) is the reading's ν (\(minor.nu))")
    }
    // the rose is drawn at its step's start: within a μ of the moment
    check(r.phase - r.steppedPhase(steps) >= 0 && r.phase - r.steppedPhase(steps) < 1.0 / Double(steps), "the rose's stepped phase")
    // across a Helion's end the motion lands on it (the chords change there too)
    let before = r.end - step * 0.5
    check(StarCadence.motion(after: before, steps: steps).map { abs($0 - r.end) < 1e-3 } ?? false, "a step lands on the Helion's end")
    check(StarCadence.motion(after: clock.tMax + 1, steps: steps) == nil, "no steps past the catalogue")
    // the chords' redraws: one a Helion, nothing they show changes in between
    var h = r.start + 1
    for _ in 0..<40 {
        guard let next = StarCadence.helion(after: h), let a = StarReading.at(h), let b = StarReading.at(next - 0.01) else { break }
        check(a.helionKey == b.helionKey, "the chords hold until the Helion ends")
        guard let c = StarReading.at(next + 0.01) else { break }
        check(c.helionKey != a.helionKey, "and change there")
        h = next + 0.002
    }
    // daylight saving: the hours turn at the zone's transitions
    let paris = EarthFormatter(zone: "Europe/Paris")
    if let change = StarHours.transition(after: vectorA, earth: paris) {
        check(change > vectorA && change - vectorA < 60 * 86_400, "Paris changes its clocks within two months of vector A")
        if let a = StarReading.at(change - 60), let b = StarReading.at(change + 60) {
            let ma = StarHours.midnightTurns(at: change - 60, sunTurns: a.sunTurns, earth: paris)
            let mb = StarHours.midnightTurns(at: change + 60, sunTurns: b.sunTurns, earth: paris)
            check(near(abs(delta(ma, mb)), 1.0 / 24, 1e-3), "the hours turn by one at the change (\(delta(ma, mb)))")
        }
    }
}

// MARK: - Words

func wordChecks() {
    guard let r = StarReading.at(vectorA) else { return }
    check(StarWords.place(r) == "2nd Helion of 5", "the place in the Pentad")
    let pure = StarWords.spoken(r, at: vectorA, pure: true)
    check(pure.hasPrefix("Pentad II, 2nd Helion of 5 · 34η 29ι."), "VoiceOver leads with the Pentad, down to the Preon: \(pure)")
    check(pure.contains("Pentad III in "), "and says when the next begins: \(pure)")
    var earthly = ["hour", "second", "minute", " h ", " min", "%", "UTC"].filter { pure.contains($0) }
    if pure.range(of: #"\d{1,2}:\d{2}"#, options: .regularExpression) != nil { earthly.append("clock time") }
    check(earthly.isEmpty, "pure words have no Earth units (\(earthly)): \(pure)")
    let earth = StarWords.spoken(r, at: vectorA, pure: false)
    check(earth.hasPrefix("Pentad II, 2nd Helion of 5 · 34η 29ι.") && earth.contains("Pentad III in ") && earth.contains("h"),
          "Earth words count down in hours: \(earth)")
    // the Hypopentad
    if let solar = clock.solar(at: vectorA), let p = clock.pentad(sync: solar.sync, index: 3), let h = StarReading.at(p.start + 60) {
        check(h.pentad == 3 && h.helions == 4 && h.helion == 15, "the Hypopentad: the sync's Helion 15, 4 Helions")
        let spoken = StarWords.spoken(h, at: p.start + 60, pure: true)
        check(spoken.hasPrefix("Hypopentad, 1st Helion of 4"), "the Hypopentad spoken: \(spoken)")
        check(spoken.contains("Pentad I in "), "Pentad I follows it: \(spoken)")
    }
}
