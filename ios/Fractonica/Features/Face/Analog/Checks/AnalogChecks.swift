import CoreGraphics
import FractonicaKit
import Foundation

// The analog dial's logic (AnalogModel, AnalogGeometry): the reading against the pure clock and the Pentads, the hands'
// angles, the Pentads on the 77-Helion ring, the swing law, the blur rule, the change schedules (no change is missed
// between two redraws) and the layout (no part runs into another).
// Run: ios/scripts/check.sh ios/Fractonica/Features/Face/Analog/Checks

@main
struct AnalogChecks {
    static func main() {
        readingChecks()
        ringChecks()
        swingChecks()
        scheduleChecks()
        layoutChecks()
        Checks.finish()
    }
}

/// SPEC §12 vector A: 2026-10-08 12:00 UTC (ε#5 34η 29ι 21λ, Pentad II, its 2nd Helion, sync 4820).
let vectorA = 1791460800.0
let clock = FractonicaClock.shared
let notation = Notation.standard

func close(_ a: Double, _ b: Double, _ eps: Double = 1e-9) -> Bool { abs(a - b) <= eps }

// MARK: - The reading

func readingChecks() {
    guard let r = AnalogReading.make(at: vectorA) else { return check(false, "a reading at vector A") }
    check(r.epsilon == 5 && r.eta == 34 && r.iota == 29 && r.lambda == 21, "vector A reads ε#5 34η 29ι 21λ: \(r)")
    check(r.pentad == 1 && r.pentadHelion == 2 && r.pentadHelions == 5 && r.sync == 4820, "vector A: Pentad II, 2nd Helion, sync 4820")
    check(r.syncHelion == 6, "the 2nd Helion of Pentad II is the sync's 7th (place 6)")
    check(r.spoken == "Pentad II · ε#5 34η 29ι 21λ", "VoiceOver: \(r.spoken)")
    check(r.spokenPentad == "Pentad II, 2nd Helion of 5", "the register says \(r.spokenPentad)")
    check(!r.spoken.contains("h ") && !r.spoken.contains("min") && !r.spoken.contains("%"), "no Earth units in what it says")
    check(AnalogReading.make(at: clock.tMax + 60) == nil && AnalogReading.make(at: clock.tMin - 60) == nil, "nothing outside the catalogue")

    // the main hand stands on the Preon tick it has passed: 36 ticks, ι completed
    check(Int((r.helionAngle * 36).rounded(.down)) == r.iota, "the main hand is past tick \(r.iota)ι")
    // the Nuclide's rider is in its Helion's slot, the register hand in its Helion's pip
    check(Int((r.nuclideAngle * 77).rounded(.down)) == r.eta - 1, "the rider is in slot \(r.eta - 1)")
    check(Int((r.syncAngle * 19).rounded(.down)) == r.syncHelion, "the Pentad hand is in pip \(r.syncHelion)")
    check(r.blinks == r.lambda * 25 + r.nu && close(r.preonAngle, Double(r.blinks) / 1625), "the Preon hand steps in Blinks")
    check(Int((r.preonAngle * 65).rounded(.down)) == r.lambda, "the Preon hand is past Flavon tick \(r.lambda)")
    check(close(r.flavonAngle, Double(r.nu) / 25) && Int((r.flavonAngle * 25).rounded()) == r.nu, "the Flavon hand stands on Blink \(r.nu)")
    // a watch's gearing: each hand turns once while the one before it moves a tick
    check(close(r.preonAngle, r.helionAngle * 36 - Double(r.iota), 1.0 / 1625 + 1e-9), "the Preon hand turns once a Helion tick")

    // across a Helion, readings agree with the engine at every Preon and the hands only move forward
    guard let helion = clock.level(at: vectorA, 6) else { return check(false, "the Helion at vector A") }
    var last = -1.0
    var forward = true
    var agree = true
    for k in 0..<36 {
        let t = helion.start + (Double(k) + 0.5) / 36 * helion.duration
        guard let a = AnalogReading.make(at: t), let minor = notation.clock(at: t) else { agree = false; continue }
        if a.iota != minor.iota || a.eta != minor.eta || Int((a.helionAngle * 36).rounded(.down)) != a.iota { agree = false }
        if a.helionAngle <= last { forward = false }
        last = a.helionAngle
    }
    check(agree, "every Preon of the Helion: the main hand and the counts agree")
    check(forward, "the main hand only moves forward across the Helion")

    // a Blink apart, the Preon hand moves one step (or wraps at a Preon's turn)
    if let nu = clock.level(at: vectorA, 12), let a = AnalogReading.make(at: nu.start + 0.01),
       let b = AnalogReading.make(at: nu.end + 0.01) {
        check(b.blinks == (a.blinks + 1) % 1625, "one Blink later the Preon hand moved one step: \(a.blinks) → \(b.blinks)")
    }

    // the ring's first Helion: the Pentads are counted in the sync
    check(r.nuclideFirstInSync == ((6 - 33) % 19 + 19) % 19, "34η at place 6: 1η is at place \(r.nuclideFirstInSync)")
}

// MARK: - The Pentads on the 77-Helion ring

func ringChecks() {
    for first in 0..<19 {
        let arcs = AnalogDial.ringArcs(first: first)
        // contiguous, covering 0 ..< 77
        var contiguous = arcs.first?.from == 0 && arcs.last?.to == 77
        for (a, b) in zip(arcs, arcs.dropFirst()) where a.to != b.from { contiguous = false }
        check(contiguous, "first \(first): the arcs cover the ring")
        // every slot's Pentad is the one its arc says
        var right = true
        for arc in arcs {
            for slot in arc.from..<arc.to where AnalogDial.pentad(ofSyncHelion: (first + slot) % 19) != arc.pentad { right = false }
        }
        check(right, "first \(first): each slot is in its own Pentad's arc")
        // whole Pentads have their Helions; the cut ones at the ring's ends fewer
        for (i, arc) in arcs.enumerated() where arc.begins && i < arcs.count - 1 {
            check(arc.helions == AnalogDial.pentadHelions[arc.pentad], "first \(first): Pentad \(arc.pentad) has \(arc.helions) Helions")
        }
        check(arcs.first?.begins == AnalogDial.pentadFirst.contains(first), "first \(first): the first arc begins here only on a Pentad's start")
        check(arcs.dropFirst().allSatisfy(\.begins), "first \(first): the others begin on the ring")
        // a Nuclide holds 4 syncs and a Helion: 16 or 17 Pentads, 4 Hypopentads (or 5 with a carried one)
        let starts = arcs.filter(\.begins).count
        check(starts == 16 || starts == 17, "first \(first): \(starts) Pentads begin on the ring")
        let hypo = arcs.filter { $0.pentad == 3 && $0.begins }.count
        check(hypo == 4 || hypo == 5, "first \(first): \(hypo) Hypopentads begin on the ring")
    }
    // the next Nuclide begins a place later in the sync (77 = 4 · 19 + 1): every start moves a Helion earlier
    let a = AnalogDial.ringArcs(first: 3).filter(\.begins).map(\.from)
    let b = AnalogDial.ringArcs(first: 4).filter(\.begins).map(\.from)
    check(Set(a.map { $0 - 1 }.filter { $0 >= 0 }).isSubset(of: Set(b)), "a Nuclide later the Pentads start a Helion earlier on the ring")

    // at vector A, against the engine: the Pentad of every Helion of the Nuclide
    guard let r = AnalogReading.make(at: vectorA), let helion = clock.level(at: vectorA, 6) else { return }
    let arcs = AnalogDial.ringArcs(first: r.nuclideFirstInSync)
    var agree = true
    for slot in 0..<77 {
        let t = helion.start + (Double(slot - (r.eta - 1)) + 0.5) * helion.duration
        guard let p = Pentads.at(t), let arc = arcs.first(where: { $0.from <= slot && slot < $0.to }) else { continue }
        if p.index != arc.pentad { agree = false }
        if (p.helion == 1) != (arc.from == slot && arc.begins) { agree = false }
    }
    check(agree, "vector A's Nuclide: every Helion's Pentad and every start agree with the engine")
}

// MARK: - The swing law and the blur

func swingChecks() {
    check(close(AnalogDial.balanceAngle(phase: 0), 0, 1e-9), "at rest at the start")
    check(close(AnalogDial.balanceAngle(phase: 0.25, amplitude: 200), 200, 1e-9), "right extreme at the peak (¼)")
    check(abs(AnalogDial.balanceAngle(phase: 0.5)) < 1e-9, "back through the centre at the node (½)")
    check(close(AnalogDial.balanceAngle(phase: 0.75, amplitude: 200), -200, 1e-9), "left extreme at the valley (¾)")

    check(!AnalogDial.blurred(period: 1.555, rate: 1, shortest: 0.14), "live, the balance swings")
    check(!AnalogDial.blurred(period: 1.555, rate: 0, shortest: 0.14), "paused, nothing blurs")
    check(AnalogDial.blurred(period: 1.555, rate: 25, shortest: 0.14), "at 25×, the balance blurs")
    check(AnalogDial.blurred(period: 505, rate: -3600, shortest: 1), "an hour a second (either way) blurs the Preon hand")
    check(!AnalogDial.blurred(period: 18_187, rate: 3600, shortest: 1), "but not the Helion hand")
}

// MARK: - Change schedules

/// Across `span` seconds from `start`, the drawn part never changes between two redraws.
func scheduleCheck(_ name: String, from start: Double, span: Double, next: (Double) -> Double?, value: (Double) -> AnyHashable?,
                   maxRedraws: Int) {
    var t = start
    var redraws = 0
    var missed = 0
    while t < start + span {
        guard let n = next(t) else { break }
        check(n > t, "\(name): the next change is ahead")
        if value(t) != value(n - 0.004) { missed += 1 }
        t = n + 0.002
        redraws += 1
    }
    check(missed == 0, "\(name): nothing changes between redraws (\(missed) missed)")
    check(redraws <= maxRedraws, "\(name): \(redraws) redraws")
}

func scheduleChecks() {
    // the Preon hand: a step a Blink (25 a Flavon, so ≤ 26 redraws over one)
    scheduleCheck("Preon hand", from: vectorA, span: 7.8, next: { AnalogDial.handsChange(after: $0) },
                  value: { AnalogReading.make(at: $0)?.blinks }, maxRedraws: 27)
    // the calendar (ring Pentads, register badges and pips, the window): once a Helion
    scheduleCheck("calendar", from: vectorA, span: 3 * 18_200, next: { AnalogDial.calendarChange(after: $0) },
                  value: { t in AnalogReading.make(at: t).map { [$0.eta, $0.pentad, $0.pentadHelion, $0.nuclideFirstInSync] } },
                  maxRedraws: 4)
    // VoiceOver's reading: once a Flavon
    scheduleCheck("label", from: vectorA, span: 120, next: { AnalogDial.labelChange(after: $0) },
                  value: { AnalogReading.make(at: $0)?.spoken }, maxRedraws: 17)
    check(AnalogDial.handsChange(after: clock.tMax + 1) == nil, "no redraws past the catalogue")
}

// MARK: - Layout

func layoutChecks() {
    let g = AnalogGeometry(size: CGSize(width: 400, height: 400))
    check(abs(g.radius * AnalogGeometry.caseOuter - 200 * AnalogGeometry.caseFraction) < 1e-9 && g.center == CGPoint(x: 200, y: 200),
          "the case fits the frame")
    check(g.polar(0, 1).y < g.center.y && abs(g.polar(0.25, 1).x - (g.center.x + g.radius)) < 1e-9, "turns start at the top, clockwise")

    let parts: [(String, AnalogGeometry.Disc)] = [
        ("Pentad register", AnalogGeometry.pentadRegister),
        ("Flavon register", AnalogGeometry.flavonRegister),
        ("aperture", AnalogGeometry.aperture),
    ]
    // the applied indices (their width included) clear every round part by a margin
    for k in 0..<9 {
        let (inner, outer) = AnalogGeometry.index(k)
        for (name, disc) in parts {
            let clear = (0...20).allSatisfy { i in
                let f = CGFloat(i) / 20
                let p = CGPoint(x: inner.x + (outer.x - inner.x) * f, y: inner.y + (outer.y - inner.y) * f)
                return !disc.contains(p, margin: AnalogGeometry.indexWidth / 2 + 0.012)
            }
            check(clear, "θ index \(k) clears the \(name)")
        }
        check(!AnalogGeometry.window.insetBy(dx: -0.03, dy: -0.03).contains(inner), "θ index \(k) clears the window")
    }
    // the round parts and the window clear each other and stay inside the indices' circle
    for (i, a) in parts.enumerated() {
        for b in parts[(i + 1)...] {
            let d = hypot(a.1.center.x - b.1.center.x, a.1.center.y - b.1.center.y)
            check(d > a.1.radius + b.1.radius + 0.05, "the \(a.0) and the \(b.0) stand apart")
        }
        let far = hypot(a.1.center.x, a.1.center.y) + a.1.radius
        check(far < AnalogGeometry.thetaNumbers - 0.04, "the \(a.0) stays inside the θ numbers")
        let w = AnalogGeometry.window
        let nearest = CGPoint(x: min(max(a.1.center.x, w.minX), w.maxX), y: min(max(a.1.center.y, w.minY), w.maxY))
        check(!a.1.contains(nearest, margin: 0.04), "the \(a.0) clears the window")
    }
    // the quarter marks sit between the θ numbers, clear of the window and the aperture
    for q in AnalogDial.quarters {
        let p = AnalogGeometry.polar(q, AnalogGeometry.quarterMarks)
        let nearestNumber = AnalogDial.thetaNumbers.map { n in
            let c = AnalogGeometry.polar(Double(n) / 36, AnalogGeometry.thetaNumbers)
            return hypot(p.x - c.x, p.y - c.y)
        }.min() ?? 1
        check(nearestNumber > 0.08, "the quarter mark at \(q) clears the θ numbers (\(nearestNumber))")
        check(parts.allSatisfy { !$0.1.contains(p, margin: 0.03) }, "the quarter mark at \(q) clears the round parts")
    }
    // the hands reach their tracks
    check(AnalogGeometry.helionHand > AnalogGeometry.preonDots && AnalogGeometry.helionHand < AnalogGeometry.indexOuter,
          "the Helion hand's tip reaches the Preon dots, within the indices")
    check(AnalogGeometry.preonHand > AnalogGeometry.railInner && AnalogGeometry.preonHand < AnalogGeometry.railOuter,
          "the Preon hand's tip lies on the Flavon railway")
    check(AnalogGeometry.riderTip > AnalogGeometry.ringTickOuter && AnalogGeometry.riderTip - AnalogGeometry.ringTickOuter < 0.01
          && AnalogGeometry.riderBack < 1, "the Nuclide's rider points at the Helion ticks from the bezel")
    // the engraved glyphs: each on the bezel, its stem along the radius at the turn its state begins, the dotted
    // (falling) ones the lower half
    let span = AnalogGeometry.glyphSpan
    let reach = 2 + AnalogGeometry.glyphInk / 2
    for k in 0..<AnalogDial.glyphStates {
        let t = AnalogGeometry.glyph(k)
        let corners = [CGPoint(x: -reach, y: span.top), CGPoint(x: reach, y: span.top),
                       CGPoint(x: -reach, y: span.foot), CGPoint(x: reach, y: span.foot)].map { $0.applying(t) }
        check(corners.allSatisfy { hypot($0.x, $0.y) > 1.012 && hypot($0.x, $0.y) < AnalogGeometry.caseOuter - 0.01 },
              "glyph \(k) lies on the engraved bezel")
        let top = CGPoint.zero.applying(t), foot = CGPoint(x: 0, y: 6).applying(t)
        let turn = Double(k) / Double(AnalogDial.glyphStates)
        let along = AnalogGeometry.polar(turn, 1)
        check(abs(top.x * along.y - top.y * along.x) < 1e-9 && abs(foot.x * along.y - foot.y * along.x) < 1e-9
              && hypot(top.x, top.y) > hypot(foot.x, foot.y), "glyph \(k)'s stem points at its turn, its top outward")
        let dotted = GlyphState.of(index: k, strokes: AnalogDial.glyphStrokes).dotted
        check(dotted == (turn > 0.25 && turn < 0.75), "glyph \(k) is dotted only on the lower half")
    }
    let neighbours = hypot(AnalogGeometry.glyph(0).tx - AnalogGeometry.glyph(1).tx, AnalogGeometry.glyph(0).ty - AnalogGeometry.glyph(1).ty)
    check(neighbours > 4 * reach * AnalogGeometry.glyphHeight / (span.foot - span.top), "the glyphs stand apart")
    check(AnalogGeometry.glyph(0).d > 0 && abs(AnalogGeometry.glyph(0).b) < 1e-12, "the top glyph stands upright")

    // the Preon dots clear the round parts and the window
    for k in 0..<36 where k % 4 != 0 {
        let p = AnalogGeometry.polar(Double(k) / 36, AnalogGeometry.preonDots)
        check(parts.allSatisfy { !$0.1.contains(p, margin: AnalogGeometry.preonDotRadius + 0.02) }
              && !AnalogGeometry.window.insetBy(dx: -0.03, dy: -0.03).contains(p), "Preon dot \(k) clears the dial's parts")
    }
}
