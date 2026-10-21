import Testing
@testable import FractonicaKit

/// Inputs the web app never sends but an app might: the deepest supported levels, invalid arguments, non-finite times
/// and many threads at once.
@Suite("Robustness")
struct RobustnessTests {
    let clock = FractonicaClock.shared
    static let a = 1_791_460_800.0

    @Test("Deep levels nest exactly inside their parents")
    func deepLevels() throws {
        for t in [Self.a, clock.tMin, clock.tMax, clock.tMax - 0.001, 125_593_319.816] {
            var parent = try #require(clock.level(at: t, 0))
            for level in 1...Fractonica.supportedLevels.upperBound {
                let r = try #require(clock.level(at: t, level, strokes: 4))
                #expect(r.cycle / Int64(clock.levelInfo(level - 1).factor) == parent.cycle, "L\(level) at \(t)")
                #expect(r.start >= parent.start - 5e-4 && r.end <= parent.end + 5e-4, "L\(level) inside its parent")
                let odometer = try #require(clock.odometer(at: t, level, strokes: 4, digits: 3))
                #expect(odometer.digits[0] == r.index)
                parent = r
            }
        }
        let deepest = Fractonica.supportedLevels.upperBound
        let path = clock.cycleToPath(level: deepest, cycle: 123_456_789_012)
        #expect(clock.pathToCycle(path) == 123_456_789_012)
        #expect(!clock.upcomingEnds(after: Self.a, fromLevel: 0, toLevel: deepest, count: 40).isEmpty)
        #expect(clock.stateOccurrences(level: deepest, digits: [3, 7], around: Self.a, count: 3).count == 3)
        #expect(Notation().cycleName(level: deepest, cycle: 1_000_000_007).hasPrefix("ε#"))
    }

    @Test("Unsupported arguments and non-finite times read as nothing")
    func invalidInputs() {
        for t in [Double.nan, .infinity, -.infinity, 1e300, -1e300] {
            #expect(clock.level(at: t, 6) == nil)
            #expect(clock.odometer(at: t, 6) == nil)
            #expect(clock.solar(at: t) == nil)
            #expect(clock.address(at: t) == nil)
            #expect(clock.position(at: t) == nil)
            #expect(clock.upcomingEnds(after: t).isEmpty)
            #expect(Notation().clock(at: t) == nil)
            #expect(Journal.reading(at: t, unit: 5) == nil)
            _ = EarthFormatter(zone: "UTC").long(t)
            _ = (EarthTime.duration(t), EarthTime.countdown(t), Notation().blinks(t), Notation().rateLabel(t))
        }
        #expect(clock.level(at: Self.a, -1) == nil)
        #expect(clock.level(at: Self.a, Fractonica.supportedLevels.upperBound + 1) == nil)
        #expect(clock.level(at: Self.a, 6, strokes: 0) == nil)
        #expect(clock.odometer(at: Self.a, 6, digits: 0) == nil)
        #expect(clock.cycle(level: 6, index: -1) == nil)
        #expect(clock.upcomingEnds(after: Self.a, fromLevel: 9, toLevel: 3).isEmpty)
        #expect(clock.stateOccurrences(level: 6, digits: [], around: Self.a).isEmpty)
        #expect(clock.boundaries(level: 6, from: .nan, to: Self.a).isEmpty)
        #expect(Notation().durationPos(.nan) == "—")
    }

    @Test("Out-of-range arguments clamp or read nothing instead of trapping")
    func outOfRange() {
        let notation = Notation()
        let supported = Fractonica.supportedLevels
        // levels: clamped where the contract returns a value, nil / empty where it can say "nothing"
        #expect(clock.levelInfo(-1).level == 0)
        #expect(clock.levelInfo(supported.upperBound + 5).level == supported.upperBound)
        #expect(clock.count(99) == clock.count(supported.upperBound))
        #expect(clock.cycleStartTime(level: 25, index: 0) == nil)
        #expect(clock.boundaries(level: 25, from: Self.a, to: Self.a + 100).isEmpty)
        #expect(clock.boundaries(level: -1, from: Self.a, to: Self.a + 100).isEmpty)
        #expect(clock.cycleToPath(level: 25, cycle: 3).count == 26)
        #expect(clock.cycleToPath(level: -2, cycle: 3) == [4])
        #expect(clock.cycleToPath(level: 0, cycle: .max) == [.max])
        #expect(notation.ordinalOf(level: 0, cycle: .max) == .max)
        #expect(Fractonica.periodName(-3).text == "α")
        #expect(notation.quarter(at: Self.a, level: 25) == nil)
        #expect(notation.nameAt(Self.a, level: -1) == nil)
        #expect(notation.cyclePos(30) == notation.cyclePos(supported.upperBound))
        #expect(notation.ordinalOf(level: -2, cycle: 4) == 5)
        _ = notation.cycleName(level: 30, cycle: 5)
        // positions: NaN stays NaN, absurd exact positions read nothing
        #expect(clock.time(atPosition: .nan).isNaN)
        #expect(clock.time(atPositionNumerator: 1, denominator: Int128(1) << 100) == nil)
        #expect(clock.time(atPositionNumerator: .min, denominator: -1) == nil)
        #expect(clock.time(atPositionNumerator: 1, denominator: Int128.max) == nil)
        #expect(clock.odometer(at: clock.tMin, supported.upperBound, strokes: 4, digits: 6) == nil)
        #expect(clock.stateOccurrences(level: supported.upperBound, digits: [1, 2, 3, 4, 5, 6], around: clock.tMin, strokes: 4).isEmpty)
        // count: .max runs to the catalogue's end: every remaining Alpha (cycles 6 … 17 after 2026) shows state 3 once
        let all = clock.stateOccurrences(level: 0, digits: [3], around: Self.a, count: .max)
        #expect(all.map(\.cycle) == Array(6...17))
        // glyphs: stroke counts clamp to 1 … 20
        #expect(GlyphState.of(index: 3, strokes: 0) == GlyphState.of(index: 3, strokes: 1))
        #expect(GlyphState.states(strokes: 25) == GlyphState.states(strokes: 20))
        #expect(GlyphGeometry.commands(index: 1, strokes: -4) == GlyphGeometry.commands(index: 1, strokes: 1))
        // counts beyond Int
        #expect(notation.durationPos(1e300) == "—")
        #expect(notation.duration(1e300, at: Self.a) == "—")
        #expect(notation.driftLambda(start: 1e300, nominalStart: 0, drift: 1e300) == 0)
        #expect(Journal.clampUnit(1e300) == Journal.maxUnit)
        #expect(Journal.clampUnit(-1e300) == 0)
        // Earth time: JavaScript's strings for odd offsets, NaN past the Date range
        #expect(EarthTime.offsetLabel(.nan) == "+NaN:NaN")
        #expect(EarthTime.offsetLabel(-.infinity) == "-Infinity:NaN")
        #expect(EarthTime.zonedToUnix(.init(year: .max, month: 1, day: 1), zone: .gmt).isNaN)
        #expect(EarthTime.zonedToUnix(.init(year: .min, month: .min, day: .min), zone: .gmt).isNaN)
        #expect(EarthTime.zonedToUnix(.init(year: 2000, month: 1, day: 1, hour: .max), zone: .gmt).isNaN)
    }

    @Test("Concurrent readings agree with sequential ones")
    func concurrency() async {
        let times = (0..<64).map { Self.a + Double($0) * 977.31 }
        let expected = times.map { t in (0...13).map { clock.level(at: t, $0) } }
        let results = await withTaskGroup(of: (Int, [LevelReading?]).self) { group in
            for (i, t) in times.enumerated() {
                group.addTask { (i, (0...13).map { FractonicaClock.shared.level(at: t, $0) }) }
            }
            var out = [[LevelReading?]](repeating: [], count: times.count)
            for await (i, readings) in group { out[i] = readings }
            return out
        }
        #expect(results == expected)
    }
}
