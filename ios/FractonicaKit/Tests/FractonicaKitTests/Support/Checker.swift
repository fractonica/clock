import Testing

/// Collects comparisons against a fixture and reports the mismatches as one issue, so a systematic error shows up as
/// "212 of 5348 checks failed" with the first examples rather than thousands of separate issues.
///
/// Tolerances, as agreed with the web app: integers and strings exactly, times within 0.5 ms, phases and progress
/// within 1e-9.
struct Checker {
    static let timeTolerance = 5e-4
    static let fractionTolerance = 1e-9

    let label: String
    private(set) var checks = 0
    private(set) var failures: [String] = []
    /// Tolerance comparisons that passed without being bit-identical, and the largest such deviation: a port that
    /// repeats the web app's arithmetic should keep both at zero, so a non-zero count points at a different path.
    private(set) var inexact = 0
    private(set) var largestDeviation = 0.0

    init(_ label: String) { self.label = label }

    mutating func equal<T: Equatable>(_ actual: T, _ expected: T, _ what: @autoclosure () -> String) {
        checks += 1
        if actual != expected { failures.append("\(what()): got \(actual), expected \(expected)") }
    }

    /// Both nil, or both present and within `tolerance`.
    mutating func near(_ actual: Double?, _ expected: Double?, _ tolerance: Double, _ what: @autoclosure () -> String) {
        checks += 1
        switch (actual, expected) {
        case (nil, nil):
            return
        case let (a?, e?) where abs(a - e) <= tolerance:
            if a != e {
                inexact += 1
                largestDeviation = max(largestDeviation, abs(a - e))
            }
        default:
            failures.append("\(what()): got \(String(describing: actual)), expected \(String(describing: expected)) (±\(tolerance))")
        }
    }

    mutating func time(_ actual: Double?, _ expected: Double?, _ what: @autoclosure () -> String) {
        near(actual, expected, Self.timeTolerance, what())
    }

    mutating func fraction(_ actual: Double?, _ expected: Double?, _ what: @autoclosure () -> String) {
        near(actual, expected, Self.fractionTolerance, what())
    }

    /// Records whether a reading exists exactly where the fixture has one; returns true when both exist.
    mutating func presence(_ actual: Bool, _ expected: Bool, _ what: @autoclosure () -> String) -> Bool {
        equal(actual, expected, "\(what()) present")
        return actual && expected
    }

    /// "1234 checks, 0 failed, 3 within tolerance but not bit-identical (largest 2.4e-07)".
    var summary: String {
        "\(label): \(checks) checks, \(failures.count) failed, \(inexact) within tolerance but not bit-identical"
            + (inexact > 0 ? " (largest \(largestDeviation))" : "")
    }

    func report(sourceLocation: SourceLocation = #_sourceLocation) {
        #expect(checks > 0, "\(label): nothing was compared", sourceLocation: sourceLocation)
        #expect(
            failures.isEmpty,
            "\(label): \(failures.count) of \(checks) checks failed\n\(failures.prefix(25).joined(separator: "\n"))",
            sourceLocation: sourceLocation
        )
    }
}
