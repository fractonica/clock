import CoreGraphics
import FractonicaKit
import Foundation

// The Now screen's logic against the web app's (src/ui/face/helpers.js, journal.js, pure.js) and the spec's vectors:
// face geometry and hit regions, stepping and taps, the change schedule (nothing that changes is ever missed between
// two redraws), the frames and the wording in both modes (pure mode has no Earth units).
// Run: ios/scripts/check.sh ios/Fractonica/Features/Face/Checks

@main
struct FaceChecks {
    static func main() {
        geometryChecks()
        stepChecks()
        cadenceChecks()
        scheduleChecks()
        frameChecks()
        wordChecks()
        tipChecks()
        Checks.finish()
    }
}

/// SPEC §12 vector A: 2026-10-08 12:00 UTC.
let vectorA = 1791460800.0
let clock = FractonicaClock.shared
let utc = Wording(pure: false, timeZone: TimeZone(identifier: "UTC")!)
let pure = Wording(pure: true, timeZone: TimeZone(identifier: "UTC")!)

func close(_ a: CGFloat, _ b: CGFloat, _ eps: CGFloat = 1e-6) -> Bool { abs(a - b) <= eps }

// MARK: - Geometry

func geometryChecks() {
    let fit = FaceFit(size: CGSize(width: 204, height: 502))
    check(close(fit.scale, 1) && fit.origin == CGPoint(x: 6, y: 6), "the frame size fits at scale 1: \(fit)")
    let wide = FaceFit(size: CGSize(width: 1000, height: 1004))
    check(close(wide.scale, 2) && close(wide.origin.x, (1000 - 408) / 2 + 12) && close(wide.origin.y, 12),
          "a wide view fits the height and centres: \(wide)")
    let p = wide.point(96, 245)
    check(close(wide.logical(p).x, 96) && close(wide.logical(p).y, 245), "points round-trip")
    check(wide.screen == CGRect(x: wide.origin.x, y: 12, width: 384, height: 980), "the screen rectangle: \(wide.screen)")

    check(FaceSpace.contains(CGPoint(x: 96, y: 1)) && !FaceSpace.contains(CGPoint(x: 2, y: 2))
          && FaceSpace.contains(CGPoint(x: 1, y: 245)) && !FaceSpace.contains(CGPoint(x: 191, y: 489)),
          "the pill has round ends")

    check(JournalGeometry.region(at: CGPoint(x: 96, y: 100)) == .top
          && JournalGeometry.region(at: CGPoint(x: 96, y: 245)) == .middle
          && JournalGeometry.region(at: CGPoint(x: 96, y: 400)) == .bottom
          && JournalGeometry.region(at: CGPoint(x: 96, y: -3)) == .top
          && JournalGeometry.region(at: CGPoint(x: 96, y: 600)) == nil, "journal thirds")
    check(WatchGeometry.region(at: CGPoint(x: 96, y: 144)) == .top
          && WatchGeometry.region(at: CGPoint(x: 96, y: 146)) == .middle
          && WatchGeometry.region(at: CGPoint(x: 96, y: 346)) == .bottom
          && WatchGeometry.region(at: CGPoint(x: 1, y: 1)) == nil, "watch regions: ±100 around the centre (helpers.js REGION_HALF)")

    let five = WatchGeometry.counterPositions(count: 5, top: true)
    check(five.count == 5 && close(five[2].x, 96) && close(five[2].y, 10), "the middle counter dot sits on the axis, 86 from the end's centre: \(five[2])")
    check(close(five[0].x + five[4].x, 192) && close(five[0].y, five[4].y) && five[0].x < five[1].x,
          "counter dots are symmetric and read left to right")
    let bottom = WatchGeometry.counterPositions(count: 1, top: false)
    check(close(bottom[0].y, 490 - 10), "the bottom counter arc mirrors the top one: \(bottom)")

    let topRect = WatchGeometry.glyphRect(.top)
    check(close(topRect.minX, 35) && close(topRect.width, 123) && close(topRect.minY, 80 - 20.5 - 22)
          && close(topRect.height, 83.5), "period glyph stems 80 apart at 56.5 and 136.5: \(topRect)")
    let solarRect = WatchGeometry.glyphRect(.solar)
    check(close(solarRect.minX, 11) && close(solarRect.width, 171), "solar stems 64 apart: \(solarRect)")
    check(close(WatchGeometry.designSpacing(.top), 3.7) && close(WatchGeometry.designSpacing(.solar), 2.1),
          "design spacing between glyph bounds")

    let start = JournalGeometry.arcPoint(0).point
    let middle = JournalGeometry.arcPoint(0.5).point
    let deepest = JournalGeometry.arcPoint(0.25)
    let highest = JournalGeometry.arcPoint(0.75).point
    check(close(start.x, 20) && close(start.y, 392) && close(middle.x, 96) && close(middle.y, 392, 1e-9),
          "the arcs run from the left end to the middle: \(start) \(middle)")
    check(close(deepest.point.y, 430) && close(deepest.normal.dy, 1) && close(highest.y, 354),
          "left arc below the axis (descending), right arc above (ascending)")
}

// MARK: - Steps, taps, swipes

func stepChecks() {
    check(FaceStepper.unit(0, step: -1) == nil && FaceStepper.unit(6, step: 1) == nil, "no unit past α or ι λ ν")
    check(FaceStepper.unit(5, step: 1) == 6 && FaceStepper.unit(5, step: -1) == 4, "one unit per step")
    check(FaceStepper.depth(2, step: -1) == nil && FaceStepper.depth(11, step: 1) == nil, "depths clamp to 2…11 (SPEC §10)")
    check(FaceStepper.depth(7, step: -1) == 6 && FaceStepper.depth(7, step: 1) == 8, "one depth per step")
    check(FaceStepper.unit(startingAt: 8) == 6 && FaceStepper.depth(showing: 12) == 11 && FaceStepper.depth(showing: 1) == 2,
          "rail picks clamp to the windows that show them")
    check(WatchGeometry.levels(topDepth: 7) == (6, 7) && WatchGeometry.levels(topDepth: 40) == (10, 11), "depth D over D+1")

    check(WatchGeometry.row(at: CGPoint(x: 96, y: 80)) == .top && WatchGeometry.row(at: CGPoint(x: 96, y: 245)) == .solar
          && WatchGeometry.row(at: CGPoint(x: 160, y: 410)) == .bottom && WatchGeometry.row(at: CGPoint(x: 96, y: 160)) == nil
          && WatchGeometry.row(at: CGPoint(x: 12, y: 245)) == nil, "row hit boxes (helpers.js ROW_BOX)")
    check(WatchGeometry.Row.allCases.allSatisfy { row in
        let b = WatchGeometry.rowBox(row)
        let region = WatchGeometry.region(at: CGPoint(x: b.midX, y: row == .top ? b.maxY - 0.1 : b.minY + 0.1))
        return row == .solar ? region == .middle : region == (row == .top ? .top : .bottom)
    }, "a period row lies wholly in its tap region, the solar row in the middle")

    let first = MiddleTap.resolve(previous: nil, now: 10)
    let second = MiddleTap.resolve(previous: first.remember, now: 10.3)
    let third = MiddleTap.resolve(previous: second.remember, now: 10.5)
    let late = MiddleTap.resolve(previous: 10, now: 10.5)
    check(first.action == .info && second.action == .letters && second.remember == nil && third.action == .info
          && late.action == .info, "tap: info; double tap: letters; a third tap starts again")

    check(FaceSwipe.axis(of: CGSize(width: 4, height: 3)) == nil && FaceSwipe.axis(of: CGSize(width: 30, height: 12)) == .horizontal
          && FaceSwipe.axis(of: CGSize(width: -8, height: -40)) == .vertical, "drags lock to their main axis")
    check(FaceSwipe.step(translation: -60, predicted: -120) == 1 && FaceSwipe.step(translation: 50, predicted: 80) == -1
          && FaceSwipe.step(translation: 8, predicted: 20) == nil, "swipe up: shorter; down: longer; short drags do nothing")
    check(FaceSwipe.page(0, count: 2, translation: -150, predicted: -300, width: 400) == 1
          && FaceSwipe.page(1, count: 2, translation: -150, predicted: -300, width: 400) == 1
          && FaceSwipe.page(1, count: 2, translation: 40, predicted: 60, width: 400) == 1
          && FaceSwipe.page(1, count: 2, translation: 120, predicted: 200, width: 400) == 0, "pages settle by distance and flick")
    let band = FaceSwipe.rubberBand(200, page: 0, count: 2, width: 400)
    check(band > 0 && band < 100 && FaceSwipe.rubberBand(-200, page: 0, count: 2, width: 400) == -200,
          "dragging past the first page is damped: \(band)")
}

// MARK: - The change schedule

/// The discrete content of a journal frame (the tick moves continuously and is left out).
func journalKey(_ t: Double, _ unit: Int) -> String {
    guard let f = JournalFrame.make(at: t, unit: unit) else { return "nil" }
    return "\(f.middleText)|\(f.glyphKey)"
}

func watchKey(_ t: Double, _ depth: Int) -> String {
    guard let f = WatchFrame.make(at: t, topDepth: depth, words: utc) else { return "nil" }
    return "\(f.top.digits)\(f.bottom.digits)\(f.top.local)\(f.bottom.local)\(String(describing: f.solar))"
}

/// Walks `steps` scheduled changes from t: the content right after each change must stay the same until just before
/// the next one (nothing is missed), and each change must be real for the discrete parts at least once in a while.
func walk(_ name: String, from t0: Double, steps: Int, expectChanges: Bool = true, next: (Double) -> Double?,
          key: (Double) -> String) {
    var t = t0
    var changes = 0
    var missed = 0
    for _ in 0..<steps {
        guard let n = next(t) else {
            check(false, "\(name): a change is scheduled after \(t)")
            return
        }
        check(n > t, "\(name): the next change lies ahead (\(n) > \(t))")
        let span = n - t
        let after = key(t + min(ChangeSchedule.lag, span / 4))
        let before = key(n - min(ChangeSchedule.lag, span / 4))
        let mid = key(t + span / 2)
        if after != before || after != mid { missed += 1 }
        if key(n + ChangeSchedule.lag) != before { changes += 1 }
        t = n + ChangeSchedule.lag
    }
    check(missed == 0, "\(name): nothing changes between two redraws (\(missed) missed)")
    if expectChanges { check(changes > 0, "\(name): the scheduled instants are changes (\(changes) of \(steps))") }
}

func cadenceChecks() {
    let a = vectorA
    for unit in 0...6 {
        // a major period's six next steps are ticks of its cycle (its words change rarely)
        walk("journal unit \(unit)", from: a, steps: unit >= 4 ? 120 : 6, expectChanges: unit >= 4, next: { FaceCadence.journal(after: $0, unit: unit) },
             key: { journalKey($0, unit) })
    }
    let eta = FaceCadence.journal(after: a, unit: 5)!
    check(eta - a <= clock.levelInfo(10).meanSeconds * 1.01, "the η triplet wakes at least once per λ: \(eta - a)")
    let iota = FaceCadence.journal(after: a, unit: 6)!
    check(iota - a <= 0.32, "the ι triplet wakes once per ν: \(iota - a)")
    for depth in [2, 7, 9] {
        walk("watch depth \(depth)", from: a, steps: 60, next: { FaceCadence.watch(after: $0, topDepth: depth) },
             key: { watchKey($0, depth) })
    }
    let deep = FaceCadence.watch(after: a, topDepth: 11)!
    check(deep - a < 0.01, "depth 11 over 12 changes every few ms (SPEC §10): \(deep - a)")

    let line = FaceCadence.dateLine(after: a + 0.25, pure: false)!
    check(abs(line - (a + 1 - 0.000_5)) < 1e-6, "the Earth date line ticks on the second: \(line - a)")
    walk("pure date line", from: a, steps: 40, next: { FaceCadence.dateLine(after: $0, pure: true) },
         key: { pure.notation.stamp(at: $0, upTo: "lambda") + pure.date($0) })
    walk("earth date line", from: a, steps: 40, next: { FaceCadence.dateLine(after: $0, pure: false) },
         key: { utc.time($0) + utc.day($0) + utc.notation.dateText(at: $0) })
    walk("readings", from: a, steps: 40, next: { FaceCadence.readings(after: $0, pure: false) },
         key: { utc.time($0) + utc.notation.stamp(at: $0, upTo: "lambda") + utc.notation.dateText(at: $0, form: "full") })

    let end = a + 65.3
    check(abs(FaceCadence.earthCountdownStep(after: a, end: end)! - (a + 0.3)) < 1e-6, "a countdown of 65.3 s turns in 0.3 s")
    check(abs(FaceCadence.earthCountdownStep(after: a, end: a + 5.27)! - (a + 0.07)) < 1e-6, "the last ten seconds tick in tenths")
    check(abs(FaceCadence.earthCountdownStep(after: a, end: a + 7200.5)! - (a + 0.5)) < 1e-6
          && abs(FaceCadence.earthCountdownStep(after: a, end: a + 7230)! - (a + 30)) < 1e-6, "hours away it ticks by the minute")
    walk("earth countdown η", from: a, steps: 50, next: { FaceCadence.countdown(after: $0, level: 6, pure: false) },
         key: { t in clock.level(at: t, 6).map { utc.countdown($0.end - t, at: t) } ?? "nil" })
    walk("pure countdown η, last Preon", from: clock.level(at: a, 6)!.end - 600, steps: 400,
         next: { FaceCadence.countdown(after: $0, level: 6, pure: true) },
         key: { t in clock.level(at: t, 6).map { FaceWords.turnover(level: 6, reading: $0, at: t, words: pure).countdown } ?? "nil" })
    walk("pure countdown η", from: a, steps: 50, next: { FaceCadence.countdown(after: $0, level: 6, pure: true) },
         key: { t in clock.level(at: t, 6).map { FaceWords.turnover(level: 6, reading: $0, at: t, words: pure).countdown } ?? "nil" })
    check(FaceCadence.journal(after: clock.tMax, unit: 5) == nil, "nothing changes after the catalogue's end")
}

func scheduleChecks() {
    let next: @Sendable (Double) -> Double? = { t in (t / 10).rounded(.down) * 10 + 10 }
    let live = ChangeSchedule(base: .live, paused: false, minimumStep: 1.0 / 30, next: next)
    let d = live.tick(after: Date(timeIntervalSince1970: 1003), lowFrequency: false)!
    check(abs(d.timeIntervalSince1970 - (1010 + ChangeSchedule.lag)) < 1e-6, "live: a redraw just after the change: \(d.timeIntervalSince1970)")
    let low = live.tick(after: Date(timeIntervalSince1970: 1009.9), lowFrequency: true)!
    check(abs(low.timeIntervalSince1970 - 1010.9) < 1e-6, "low frequency: at most once a second")
    let paused = ChangeSchedule(base: ClockStore.TimeBase(t0: 5, real0: 0, rate: 0), paused: true, minimumStep: 1.0 / 30, next: next)
    var entries = paused.entries(from: Date(timeIntervalSince1970: 100), mode: .normal)
    check(entries.next() != nil && entries.next() == nil, "paused: one entry")
    let lapse = ChangeSchedule(base: ClockStore.TimeBase(t0: 0, real0: 1000, rate: 3600), paused: false, minimumStep: 1.0 / 30, next: next)
    let fast = lapse.tick(after: Date(timeIntervalSince1970: 1000), lowFrequency: false)!
    check(abs(fast.timeIntervalSince1970 - (1000 + 1.0 / 30)) < 1e-6, "a time-lapse redraws at most 30 times a second")
    let slow = ChangeSchedule(base: ClockStore.TimeBase(t0: 0, real0: 1000, rate: 2), paused: false, minimumStep: 1.0 / 30, next: next)
    let s = slow.tick(after: Date(timeIntervalSince1970: 1000), lowFrequency: false)!
    check(abs(s.timeIntervalSince1970 - (1005 + ChangeSchedule.lag)) < 1e-6, "rate 2: the change 10 displayed seconds ahead comes in 5 real ones")
    let back = ChangeSchedule(base: ClockStore.TimeBase(t0: 0, real0: 1000, rate: -60), paused: false, minimumStep: 1.0 / 30, next: next)
    let b = back.tick(after: Date(timeIntervalSince1970: 1000), lowFrequency: false)!
    check(abs(b.timeIntervalSince1970 - (1000 + 1.0 / 30)) < 1e-6, "backwards, standing on a change: the next frame")
    let rewind = ChangeSchedule(base: ClockStore.TimeBase(t0: 7, real0: 1000, rate: -2), paused: false, minimumStep: 1.0 / 30, next: next)
    let r = rewind.tick(after: Date(timeIntervalSince1970: 1000), lowFrequency: false)!
    check(abs(r.timeIntervalSince1970 - (1003.5 + ChangeSchedule.lag)) < 1e-6,
          "backwards at −2: the change 7 displayed seconds behind comes in 3.5 real ones: \(r.timeIntervalSince1970)")
    let fastBack = ChangeSchedule(base: ClockStore.TimeBase(t0: 7, real0: 1000, rate: -3600), paused: false, minimumStep: 1.0 / 30, next: next)
    check(abs(fastBack.tick(after: Date(timeIntervalSince1970: 1000), lowFrequency: false)!.timeIntervalSince1970 - (1000 + 1.0 / 30)) < 1e-6,
          "a fast rewind redraws at most 30 times a second")
    // the journal running backwards at real speed: each redraw lands just after the content changed, never between
    var tb = vectorA
    var behind = 0
    for _ in 0..<30 {
        guard let c = ChangeSchedule.lastChange(atOrBefore: tb, within: 1.0 / 30, next: { FaceCadence.journal(after: $0, unit: 5) }) else { break }
        // text that counts on the ladder turns a hair after the boundary (pure spans' margin): compare a lag later
        let n = FaceCadence.journal(after: c + 1e-5, unit: 5) ?? .infinity
        if c > tb || n <= tb || journalKey(tb, 5) != journalKey(c + ChangeSchedule.lag, 5) { behind += 1 }
        tb = c - ChangeSchedule.lag
    }
    check(behind == 0, "backwards: the change found is the one that began the shown content (\(behind) wrong)")
    let none = ChangeSchedule(base: .live, paused: false, minimumStep: 1.0 / 30, next: { _ in nil })
    check(abs(none.tick(after: Date(timeIntervalSince1970: 50), lowFrequency: false)!.timeIntervalSince1970 - 51) < 1e-6,
          "no known change: checked once a second")
    let far = ChangeSchedule(base: .live, paused: false, minimumStep: 1.0 / 30, next: { $0 + 86_400 })
    check(abs(far.tick(after: Date(timeIntervalSince1970: 50), lowFrequency: false)!.timeIntervalSince1970 - 110) < 1e-6,
          "never more than a minute between redraws")
}

// MARK: - Frames

func frameChecks() {
    let a = vectorA
    let helion = JournalFrame.make(at: a, unit: 5)!
    check(helion.middleText == "34η 29ι 21λ" && helion.pair == [13, 0] && helion.leadLetter == "η" && helion.leadLevel == 6,
          "unit η at A: 34η 29ι 21λ and the Helion pair [13, 0] (SPEC §15.6): \(helion.middleText) \(String(describing: helion.pair))")
    check(helion.tokens.map(\.parts) == [FaceWords.TokenParts(prefix: "", digits: "34", suffix: "η"),
                                         FaceWords.TokenParts(prefix: "", digits: "29", suffix: "ι"),
                                         FaceWords.TokenParts(prefix: "", digits: "21", suffix: "λ")], "tokens split for colour")
    check(JournalFrame.make(at: a, unit: 4)!.middleText == "ε#05 34η 29ι", "unit ε: ε#05 34η 29ι")
    check(JournalFrame.make(at: a, unit: 4)!.tokens[0].parts == FaceWords.TokenParts(prefix: "ε#", digits: "05", suffix: ""), "ε#05 splits")
    check(JournalFrame.make(at: a, unit: 6)!.middleText == "29ι 21λ 03ν", "unit ι: 29ι 21λ 03ν")
    let delta = JournalFrame.make(at: a, unit: 3)!
    check(delta.lines == ["5th", "Delta", "Trifracton", "End"] && delta.isMajor && delta.pair == nil && delta.tokens.isEmpty,
          "unit δ: 5th / Delta / Trifracton / End: \(delta.lines)")
    check(JournalFrame.make(at: clock.tMax + 10, unit: 5) == nil, "outside the catalogue: no frame")
    check(helion.calmText && helion.calmGlyphs, "η ι λ: λ counts roll, the Helion pair cross-fades")
    let preon = JournalFrame.make(at: a, unit: 6)!
    check(!preon.calmText && preon.calmGlyphs, "ι λ ν: the Blink count just turns; the Preon pair (2 s a state) still fades")
    check(helion.accessibilityLabel.hasPrefix("Journal face: 34η 29ι 21λ"), "the journal's label: \(helion.accessibilityLabel)")

    let w = WatchFrame.make(at: a, topDepth: 7, words: utc, info: true)!
    check(w.top.level == 6 && w.top.digits == [13, 0] && w.bottom.level == 7 && w.solar == [5, 11, 13],
          "watch at A: η [13, 0] over θ, solar [5, 11, 13]: \(w.top.digits) \(String(describing: w.solar))")
    check(w.top.siblings == 11 && w.top.local == 0 && w.bottom.siblings == 9, "sibling counters: \(w.top.local)/\(w.top.siblings)")
    check(w.top.calmCoarse && w.top.calmFine && !(WatchFrame.make(at: a, topDepth: 11, words: utc)!.bottom.calmFine),
          "glyph cues only where changes are calm")
    check(w.top.name.isEmpty && WatchFrame.make(at: a, topDepth: 7, words: pure)!.top.name == "ε#5 34η",
          "pure letters name the running cycle")
    check(WatchFrame.make(at: clock.tMax + 10, topDepth: 7, words: utc) == nil, "watch outside the catalogue: no frame")
    let edge = WatchFrame.make(at: clock.tMax, topDepth: 7, words: utc)
    check(edge != nil && edge?.solar == nil, "at the very end the periods read and the sync is not defined")
}

// MARK: - Wording

/// Earth-ish text that must never appear in pure mode.
func earthLeak(_ s: String) -> String? {
    let patterns = [#"\d\s?(s|ms|min|h|d|wk|mo|y)\b"#, #"%"#, #"\d{1,2}:\d{2}"#, #"UTC"#, #"\b(19|20|21)\d{2}\b"#,
                    #"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b"#, #"percent"#,
                    #"\bdays?\b"#, #"\bseconds?\b"#]
    return patterns.first { s.range(of: $0, options: .regularExpression) != nil }
}

func wordChecks() {
    let a = vectorA
    let eta = clock.level(at: a, 6)!
    let solar = clock.solar(at: a)!

    let earth = FaceWords.infoLabels(at: a, top: eta, solar: solar, words: utc)
    check(earth.topCaption == "NEXT END" && earth.topValue == "12:56:12" && earth.syncCaption == "SYNC TIME",
          "Earth info: the next threshold as a clock time: \(earth)")
    let p = FaceWords.infoLabels(at: a, top: eta, solar: solar, words: pure)
    check(p.topCaption == "NEXT END" && p.topValue == "in 6ι 43λ" && p.syncCaption == "SYNC 4820" && p.syncValue.hasPrefix("drift "),
          "pure info: countdowns, the sync number and drift (SPEC §15.6: 6ι 43λ): \(p)")
    let none = FaceWords.infoLabels(at: a, top: eta, solar: nil, words: pure)
    check(!none.solarAvailable && none.solarValue == FaceWords.dash, "no sync near the ends")

    check(FaceWords.place(level: 6, reading: eta, notation: pure.notation) == "34η of 77 in ε#5", "the Helion's place")
    check(FaceWords.place(level: 7, reading: clock.level(at: a, 7)!, notation: pure.notation) == "28ι to 31ι in 34η",
          "a θ is said by what it spans: \(FaceWords.place(level: 7, reading: clock.level(at: a, 7)!, notation: pure.notation))")
    check(FaceWords.place(level: 3, reading: clock.level(at: a, 3)!, notation: pure.notation) == "Delta Trifracton End · 3 of 5 in its γ",
          "a major period in words")
    check(FaceWords.place(level: 4, reading: clock.level(at: a, 4)!, notation: pure.notation) == "ε#5 of 5 in Delta Trifracton",
          "the Nuclide in its Delta")

    let turnEarth = FaceWords.turnover(level: 6, reading: eta, at: a, words: utc)
    let turnPure = FaceWords.turnover(level: 6, reading: eta, at: a, words: pure)
    check(turnEarth.name == "35η" && turnEarth.countdown == "in 56 min 12 s" && turnPure.countdown == "in 6ι 43λ",
          "turnover: 35η begins in 56 min 12 s · in 6ι 43λ: \(turnEarth) \(turnPure)")
    check(FaceWords.sentence(turnPure) == "35η begins in 6ι 43λ", "the turnover sentence: \(FaceWords.sentence(turnPure))")
    let nuclideEnd = clock.level(at: a, 4)!.end
    let lastEta = FaceWords.turnover(level: 6, reading: clock.level(at: nuclideEnd - 60, 6)!, at: nuclideEnd - 60, words: pure)
    check(lastEta.name == "ε#1 1η", "across a Nuclide the follower names it: \(lastEta.name)")
    let theta = FaceWords.turnover(level: 7, reading: clock.level(at: a, 7)!, at: a, words: pure)
    check(!theta.named && FaceWords.sentence(theta).hasPrefix("Next θ in "), "a depth between units: Next θ …")
    let deltaNext = FaceWords.turnover(level: 3, reading: clock.level(at: a, 3)!, at: a, words: pure)
    check(deltaNext.name == "Delta Tetrafracton", "a major period: what begins in words")
    let last = FaceWords.turnover(level: 6, reading: clock.level(at: clock.tMax, 6)!, at: clock.tMax, words: pure)
    check(last.last && FaceWords.sentence(last).contains("catalogue ends"), "the last cycle: \(FaceWords.sentence(last))")

    let nuclide = FaceWords.turnover(level: 4, reading: clock.level(at: a, 4)!, at: a, words: pure)
    check(nuclide.name == "ε#1 of Delta Tetrafracton", "a Nuclide across a Delta names the Delta: \(nuclide.name)")
    check(FaceWords.turnover(level: 8, reading: clock.level(at: a, 8)!, at: a, words: pure).name == "30ι", "ι turns to 30ι")
    let late = 2886085800.0
    check(FaceWords.follower(level: 11, cycle: clock.level(at: late, 11)!.cycle, notation: pure.notation) == "2λ 0ν"
          && FaceWords.follower(level: 10, cycle: clock.level(at: -11253700000, 10)!.cycle, notation: pure.notation) == "9ι 0λ",
          "followers name only what changes (pure.js followerName)")

    let oorPure = FaceWords.outOfRange(words: pure)
    check(oorPure.range == ["from α#1", "to α#18"], "pure range: \(oorPure.range)")
    check(FaceWords.outOfRange(words: utc).range.first?.hasPrefix("from 1613") == true, "Earth range: \(FaceWords.outOfRange(words: utc).range)")

    check(FaceWords.describe(index: 13) == "value −3, rising" && FaceWords.describe(index: 4) == "peak, value +4"
          && FaceWords.describe(index: 6) == "value +2, falling" && FaceWords.describe(index: 12) == "valley, value −4",
          "glyph states in words")
    check(FaceWords.percent(0.3586) == "35.8" && FaceWords.percent(0.999_99) == "99.9" && FaceWords.percent(1) == "100.0", "percent floors")

    // pure mode must not leak anything Earth-ish, across many instants and every part of the face
    var leaks: [String] = []
    for k in 0..<40 {
        let t = a + Double(k) * 7_919.3
        for depth in [2, 5, 7, 11] {
            guard let w = WatchFrame.make(at: t, topDepth: depth, words: pure, info: true) else { continue }
            var texts = [w.top.name, w.bottom.name, w.top.accessibilityLabel, w.bottom.accessibilityLabel, w.solarLabel,
                         w.accessibilityLabel]
            if let i = w.info {
                texts += [i.topCaption, i.topValue, i.solarCaption, i.solarValue, i.syncCaption, i.syncValue,
                          FaceWords.infoSpeech(i, pure: true)]
            }
            if let lv = clock.level(at: t, depth - 1) {
                texts.append(FaceWords.sentence(FaceWords.turnover(level: depth - 1, reading: lv, at: t, words: pure)))
            }
            leaks += texts.compactMap { s in earthLeak(s).map { "\($0) in “\(s)”" } }
        }
        for unit in 0...6 {
            if let f = JournalFrame.make(at: t, unit: unit) {
                leaks += [f.accessibilityLabel, f.middleText].compactMap { s in earthLeak(s).map { "\($0) in “\(s)”" } }
            }
        }
    }
    leaks += (FaceGuideText.glyphLines(pure: true) + FaceGuideText.journalLines(pure: true) + FaceGuideText.watchLines(pure: true)
        + FaceGuideText.gestureLines).compactMap { s in earthLeak(s).map { "\($0) in “\(s)”" } }
    leaks += (FaceWords.outOfRange(words: pure).title + FaceWords.outOfRange(words: pure).range + FaceWords.solarUnavailable(pure: true))
        .compactMap { s in earthLeak(s).map { "\($0) in “\(s)”" } }
    check(leaks.isEmpty, "pure mode says nothing Earth-ish: \(leaks.prefix(5))")
    check(earthLeak(earth.topValue) != nil, "the leak detector does catch Earth text")
}

// MARK: - Row tips

/// The rows' explanations, line by line as the web's builders print them at vector A (helpers.js `periodTooltip`,
/// `solarTooltip`; pure.js `purePeriodTooltip`, `pureSolarTooltip`; compared at several more instants by script).
func tipChecks() {
    let a = vectorA
    let earthEta = FaceTips.period(level: 6, at: a, words: utc)
    check(earthEta?.title == "η · depth 7" && earthEta?.aside == "≈ 5 h 3 min per cycle"
          && earthEta?.lines == ["State 13 of 16: value −3, rising ↗", "Right (fine) glyph: state 0 of 16, changes at 12:00:33",
                                 "Next change 12:18:18 (in 18 min 18 s)", "Cycle 1 of 11 in its ζ · ends 12:56:12"],
          "Earth η tip: \(String(describing: earthEta))")
    let pureEta = FaceTips.period(level: 6, at: a, words: pure)
    check(pureEta?.aside == "one Helion = 36ι"
          && pureEta?.lines == ["34η of 77 in ε#5", "State 13 of 16: value −3, rising ↗",
                                "Right (fine) glyph: state 0 of 16, changes in 4λ 6ν", "Next change in 2ι 11λ",
                                "Ends in 6ι 43λ → 35η begins"]
          && pureEta?.note == FaceTips.fromOne, "pure η tip: \(String(describing: pureEta))")
    let solar = FaceTips.solar(at: a, words: utc)
    check(solar?.title == "Solar sync #4820" && solar?.lines == ["Phase 35.8 % of this 4-day sync", "Drift against civil days −13 h 27 min",
                                                               "Next node Oct 9 01:34", "Sync time Oct 7 01:34"],
          "Earth solar tip: \(String(describing: solar))")
    let pureSolar = FaceTips.solar(at: a, words: pure)
    check(pureSolar?.pairPhase != nil && pureSolar?.aside == "one sync = 19η (19 Helions)"
          && pureSolar.map { Array($0.lines.dropFirst()) } == ["Drift −6\u{202F}236λ against the solar rhythm", "Next node in 2η 24ι", "Sync began 6η 29ι ago"],
          "pure solar tip: \(String(describing: pureSolar))")
    check(FaceTips.solar(at: -11253700000, words: pure)?.lines.first?.contains("not defined") == true
          && FaceTips.period(level: 6, at: clock.tMax + 10, words: pure) == nil, "near and past the edges")

    var leaks: [String] = []
    for k in 0..<30 {
        let t = a + Double(k) * 104_729.7
        let tips = (1...12).compactMap { FaceTips.period(level: $0, at: t, words: pure) } + [FaceTips.solar(at: t, words: pure)].compactMap { $0 }
        for tip in tips {
            leaks += ([tip.title, tip.aside] + tip.allLines).compactMap { s in earthLeak(s).map { "\($0) in “\(s)”" } }
        }
    }
    check(leaks.isEmpty, "pure tips say nothing Earth-ish: \(leaks.prefix(4))")
}
