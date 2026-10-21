import Testing
@testable import FractonicaKit

/// SPEC §12 and §15.6 test vectors, written out by hand (they also appear in the generated fixtures).
@Suite("SPEC vectors")
struct SpecVectorTests {
    let clock = FractonicaClock.shared
    let notation = Notation()

    static let a = 1_791_460_800.0 // 2026-10-08T12:00:00Z
    static let b = 946_684_800.0 // 2000-01-01T00:00:00Z
    static let c = 2_886_085_800.0 // 2061-06-15T18:30:00Z
    static let anchorPlusOne = 125_593_320.816

    @Test("A: 2026-10-08T12:00:00Z")
    func vectorA() throws {
        #expect(abs(try #require(clock.position(at: Self.a)) - 22.927850216635) < 1e-9)
        let d7 = try #require(clock.level(at: Self.a, 6))
        #expect([d7.index, d7.value, d7.derivative] == [13, -3, 1])
        #expect(clock.odometer(at: Self.a, 6)?.digits == [13, 0])
        #expect(d7.cycle == 717_211 && d7.local == 0 && d7.siblings == 11)
        #expect(d7.next.name == "end")
        #expect(abs(try #require(d7.next.time) - 1_791_464_172.428) < 5e-4)
        let d7s3 = try #require(clock.level(at: Self.a, 6, strokes: 3))
        #expect([d7s3.index, d7s3.value] == [42, -10])

        let d8 = try #require(clock.level(at: Self.a, 7))
        #expect([d8.index, d8.value, d8.derivative] == [5, 3, -1] && d8.dotted)
        #expect(clock.odometer(at: Self.a, 7)?.digits == [5, 4])
        #expect(d8.cycle == 6_454_906 && d8.local == 7 && d8.siblings == 9)
        #expect(d8.next.name == "node")
        #expect(abs(try #require(d8.next.time) - 1_791_461_140.937) < 5e-4)

        let s = try #require(clock.solar(at: Self.a))
        #expect(s.sync == 4820)
        #expect(abs(s.start - 1_791_336_849.826) < 5e-4)
        #expect(abs(s.end - 1_791_682_439.745) < 1e-3) // 2026-10-11T01:33:59.745Z
        #expect(abs(s.phase - 0.358662585) < 1e-9)
        #expect(abs(s.drift - -48_469.9899) < 5e-4)
        #expect(s.digits3 == [5, 11, 13])
        #expect(s.digits2x3 == [18, 33])
        #expect(s.threshold.name == "node")
        #expect(abs(try #require(s.threshold.time) - 1_791_509_644.786) < 5e-4)
    }

    @Test("B: 2000-01-01T00:00:00Z")
    func vectorB() throws {
        #expect(abs(try #require(clock.position(at: Self.b)) - 21.443111640256) < 1e-9)
        let d7 = try #require(clock.level(at: Self.b, 6))
        #expect(d7.index == 5 && d7.value == 3 && d7.dotted)
        #expect(clock.odometer(at: Self.b, 6)?.digits == [5, 6])
        #expect(d7.local == 9 && d7.siblings == 11)
        #expect(d7.next.name == "node")
        #expect(abs(try #require(d7.next.time) - 946_687_783.046) < 5e-4)
        let d8 = try #require(clock.level(at: Self.b, 7))
        #expect(d8.index == 0)
        #expect(clock.odometer(at: Self.b, 7)?.digits == [0, 6])
        #expect(d8.local == 3 && d8.siblings == 9)
        #expect(d8.next.name == "peak")
        #expect(abs(try #require(d8.next.time) - 946_685_256.803) < 5e-4)
        let s = try #require(clock.solar(at: Self.b))
        #expect(s.sync == 2375)
        #expect(abs(s.start - 946_369_476.520) < 5e-4)
        #expect(abs(s.phase - 0.912420883) < 1e-9)
        #expect(abs(s.drift - -23_843.2957) < 5e-4)
        #expect(s.digits3 == [14, 9, 9])
        #expect(s.threshold.name == "end")
        #expect(abs(try #require(s.threshold.time) - 946_715_066.462) < 5e-4)
    }

    @Test("C: 2061-06-15T18:30:00Z")
    func vectorC() throws {
        #expect(abs(try #require(clock.position(at: Self.c)) - 24.851712757369) < 1e-9)
        let d7 = try #require(clock.level(at: Self.c, 6))
        #expect(d7.index == 10 && d7.value == -2 && d7.dotted)
        #expect(clock.odometer(at: Self.c, 6)?.digits == [10, 3])
        #expect(d7.local == 0 && d7.siblings == 11)
        #expect(d7.next.name == "valley")
        #expect(abs(try #require(d7.next.time) - 2_886_087_806.395) < 5e-4)
        let d8 = try #require(clock.level(at: Self.c, 7))
        #expect(d8.index == 12 && d8.value == -4 && d8.derivative == 0)
        #expect(clock.odometer(at: Self.c, 7)?.digits == [12, 1])
        #expect(d8.local == 5 && d8.siblings == 9)
        #expect(d8.next.name == "end")
        #expect(abs(try #require(d8.next.time) - 2_886_086_290.651) < 5e-4)
        let s = try #require(clock.solar(at: Self.c))
        #expect(s.sync == 7987)
        #expect(abs(s.start - 2_885_819_519.691) < 5e-4) // 2061-06-12T16:31:59.691Z
        #expect(abs(s.phase - 0.770510076) < 1e-9)
        #expect(abs(s.drift - -81_000.1249) < 5e-4)
        #expect(s.digits3 == [12, 5, 4])
        #expect(s.threshold.name == "end")
        #expect(abs(try #require(s.threshold.time) - 2_886_165_109.343) < 5e-4)
    }

    @Test("Anchor + 1 s: sync 0, no drift")
    func anchor() throws {
        let s = try #require(clock.solar(at: Self.anchorPlusOne))
        #expect(s.sync == 0 && s.drift == 0 && s.digits3 == [0, 0, 0])
    }

    @Test("§15.6 pure dates, stamp and span")
    func pureDates() {
        let rows: [(t: Double, full: String, short: String, pair: [Int])] = [
            (Self.a, "Alpha Hexafracton Valley, Beta Tetrafracton Valley, Gamma Nonafracton Valley, Delta Trifracton End, ε#5 34η 29ι 21λ 3ν",
             "Delta Trifracton End ε#5 34η 29ι", [13, 0]),
            (Self.b, "Alpha Hexafracton Node, Beta Difracton End, Gamma Didecafracton Node, Delta Trifracton Node, ε#2 21η 12ι 6λ 5ν",
             "Delta Trifracton Node ε#2 21η 12ι", [5, 6]),
            (Self.c, "Alpha Heptafracton Peak, Beta Difracton Peak, Gamma Monofracton End, Delta Pentafracton Peak, ε#2 1η 23ι 1λ 21ν",
             "Delta Pentafracton Peak ε#2 1η 23ι", [10, 3]),
            (Self.anchorPlusOne, "Alpha Hexafracton Peak, Beta Monofracton Peak, Gamma Monofracton Peak, Delta Monofracton Peak, ε#1 1η 0ι 0λ 3ν",
             "Delta Monofracton Peak ε#1 1η 0ι", [0, 0]),
        ]
        for row in rows {
            #expect(notation.dateText(at: row.t, form: "full", upTo: "nu") == row.full)
            #expect(notation.dateText(at: row.t) == row.short)
            #expect(clock.odometer(at: row.t, 6)?.digits == row.pair)
        }
        #expect(notation.stamp(at: Self.a, upTo: "nu") == "α#6 β#4 γ#9 δ#3 ε#5 34η 29ι 21λ 3ν")
        #expect(notation.duration(3372.428, at: Self.a) == "6ι 43λ")
    }

    @Test("Catalogue ends: nothing is extrapolated")
    func catalogueEnds() {
        #expect(clock.level(at: clock.tMin - 0.001, 0) == nil)
        #expect(clock.level(at: clock.tMax + 0.001, 0) == nil)
        #expect(clock.level(at: clock.tMax, 13) != nil)
        #expect(clock.solar(at: clock.tMax) == nil, "the last partial sync runs past the catalogue")
        #expect(clock.count(0) == 18)
    }
}
