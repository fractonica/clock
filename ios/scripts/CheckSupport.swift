import Foundation
import Synchronization

// What every checks program shares; ios/scripts/check.sh compiles this file into each one.
//
//     check(store.isPaused, "travel pauses when live")
//     check(link.time == 12.5, "the moment survives the round trip: \(String(describing: link.time))")
//     Checks.finish()            // prints the verdict and exits non-zero on any failure

/// Records a failure, with the check's file and line, when `condition` is false.
func check(_ condition: Bool, _ message: @autoclosure () -> String, file: StaticString = #fileID, line: UInt = #line) {
    guard !condition else {
        Checks.count(passed: true)
        return
    }
    Checks.count(passed: false)
    print("FAIL \(file):\(line): \(message())")
}

/// The tally of a checks program.
enum Checks {
    private static let tally = Mutex((passed: 0, failed: 0))

    static func count(passed: Bool) {
        tally.withLock { passed ? ($0.passed += 1) : ($0.failed += 1) }
    }

    /// Prints "N checks passed" or the number that failed, and exits with the matching status.
    static func finish() -> Never {
        let (passed, failed) = tally.withLock { ($0.passed, $0.failed) }
        print(failed == 0 ? "\(passed) checks passed" : "\(failed) of \(passed + failed) checks FAILED")
        exit(failed == 0 ? 0 : 1)
    }
}
