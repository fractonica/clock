import Testing
@testable import FractonicaKit

/// Views read every level each frame, so a full 14-level reading must stay far below a frame's budget. Serialized so
/// the measurements do not compete with each other; run them optimised for real numbers:
///
///     swift test -c release -Xswiftc -enable-testing --package-path ios/FractonicaKit --filter Performance
@Suite("Performance", .serialized)
struct PerformanceTests {
    let clock = FractonicaClock.shared

    @Test("14 level readings + odometers per frame")
    func frame() {
        let frames = 600 // ten seconds at 60 fps
        var t = 1_791_460_800.0
        var sink = 0
        let elapsed = ContinuousClock().measure {
            for _ in 0..<frames {
                for level in 0...Fractonica.maxLevel {
                    sink &+= clock.level(at: t, level)?.index ?? 0
                    sink &+= clock.odometer(at: t, level)?.digits[1] ?? 0
                }
                t += 1.0 / 60
            }
        }
        let perFrame = elapsed / frames
        // Release builds take about 30 µs (consecutive frames mostly hit the cycle-facts cache); debug about 200 µs.
        #expect(perFrame < .milliseconds(1), "a 14-level frame took \(perFrame)")
        #expect(sink != 0)
        print("FractonicaKit: 14 levels + odometers per frame: \(perFrame)")
    }

    @Test("Random instants: 14 levels, their odometers and the solar sync per frame")
    func randomFrames() {
        // Uniform over the whole catalogue, so nearly every reading misses the cycle-facts cache: the worst case
        // (a scrubbed timeline, widget timelines far apart), where consecutive frames mostly hit it.
        #if DEBUG
        let count = 2_000 // unoptimised builds are about seven times slower
        let budget = Duration.milliseconds(3)
        #else
        let count = 10_000
        let budget = Duration.microseconds(300)
        #endif
        var state: UInt64 = 0x9E37_79B9_7F4A_7C15
        let times = (0..<count).map { _ -> Double in
            state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
            return clock.tMin + Double(state >> 11) / Double(1 << 53) * (clock.tMax - clock.tMin)
        }
        var sink = 0.0
        let elapsed = ContinuousClock().measure {
            for t in times {
                for level in 0...Fractonica.maxLevel {
                    sink += clock.level(at: t, level)?.progress ?? 0
                    sink += Double(clock.odometer(at: t, level)?.digits[1] ?? 0)
                }
                sink += clock.solar(at: t)?.phase ?? 0
            }
        }
        let perFrame = elapsed / times.count
        #expect(perFrame < budget, "a random 14-level frame took \(perFrame)")
        #expect(sink > 0)
        print("FractonicaKit: random instant, 14 levels + odometers + solar per frame: \(perFrame)")
    }

    @Test("Notation date and clock per frame")
    func notation() {
        let notation = Notation()
        let frames = 600
        var t = 1_791_460_800.0
        var length = 0
        let elapsed = ContinuousClock().measure {
            for _ in 0..<frames {
                length += notation.dateText(at: t, upTo: "nu").count
                length += Journal.reading(at: t, unit: 5, notation: notation)?.tokens?.count ?? 0
                t += 1.0 / 60
            }
        }
        let perFrame = elapsed / frames
        #expect(perFrame < .milliseconds(1), "a date + journal reading took \(perFrame)")
        #expect(length > 0)
        print("FractonicaKit: date text + journal reading per frame: \(perFrame)")
    }
}
