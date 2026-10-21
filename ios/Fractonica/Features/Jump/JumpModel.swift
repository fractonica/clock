import FractonicaKit
import Foundation
import Observation

/// The jump screen's state: the text in the field, what it reads as right now, and the recent jumps of the mode.
@MainActor @Observable
final class JumpModel {
    /// The text in the search field.
    var query = ""
    /// The readings of `query`, best first (errors only when nothing reads).
    private(set) var results: [JumpCandidate] = []
    /// The recent jumps of the current mode.
    private(set) var history = JumpHistory()
    /// Bumped when Return finds nothing to go to (the field shakes, a warning plays).
    private(set) var rejections = 0
    /// Bumped on every jump (a haptic plays).
    private(set) var jumps = 0

    /// The mode whose history is loaded.
    @ObservationIgnored private var historyMode: Bool?
    /// Demo history for screenshots: shown, never saved.
    @ObservationIgnored private var historyIsDemo = false
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        query = Self.launchQuery ?? ""
    }

    /// The best reading, if any can be travelled to.
    var best: JumpCandidate? { JumpInterpreter.best(results) }
    /// The other readings that can be travelled to.
    var alternatives: [JumpCandidate] {
        guard let best else { return [] }
        return results.filter { $0.isSelectable && $0 != best }
    }
    /// Why nothing reads (when nothing does).
    var errors: [JumpCandidate] { best == nil ? results.filter(\.isError) : [] }
    var isEmpty: Bool { query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    // MARK: Reading

    /// Reads the field again in `situation` (on every keystroke, and at most four times a second while the clock moves).
    func refresh(_ situation: JumpInterpreter.Situation) {
        loadHistory(pure: situation.pure)
        let next = isEmpty ? [] : JumpInterpreter.candidates(query, situation)
        if next != results { results = next }
    }

    /// Switches to the mode's own history (and forgets what was typed in the other vocabulary).
    func loadHistory(pure: Bool) {
        guard historyMode != pure else { return }
        if historyMode != nil { query = "" }
        historyMode = pure
        if Self.launchDemoHistory {
            historyIsDemo = true
            history = JumpHistory(entries: pure ? Self.pureDemo : Self.earthDemo)
        } else {
            history = JumpHistory.load(pure: pure, from: defaults)
        }
    }

    // MARK: Going

    /// What Return does: the best reading of the field, read afresh at this instant (an offset counts from now, not
    /// from the last refresh). Nil, with a rejection, when nothing reads.
    func submit(_ situation: JumpInterpreter.Situation) -> JumpCandidate? {
        guard !isEmpty else { return nil }
        results = JumpInterpreter.candidates(query, situation)
        guard let best else {
            rejections += 1
            return nil
        }
        return best
    }

    /// A reading chosen from the list, re-read at this instant (the same kind and label, else as it was).
    func fresh(_ candidate: JumpCandidate, _ situation: JumpInterpreter.Situation) -> JumpCandidate {
        let now = JumpInterpreter.candidates(query, situation)
        return now.first { $0.isSelectable && $0.kind == candidate.kind && $0.label == candidate.label } ?? candidate
    }

    /// A recent jump run again; nil (and the text put into the field) when it no longer reads.
    func replay(_ entry: JumpHistory.Entry, _ situation: JumpInterpreter.Situation) -> JumpCandidate? {
        let candidates = JumpInterpreter.candidates(entry.text, situation)
        guard let chosen = JumpInterpreter.replay(entry, in: candidates) else {
            query = entry.text
            results = candidates
            return nil
        }
        return chosen
    }

    /// Records a jump to `candidate` typed as `text`, and clears the field.
    func didJump(to candidate: JumpCandidate, text: String, pure: Bool) {
        loadHistory(pure: pure)
        history.remember(text, label: candidate.label, kind: candidate.kind.rawValue)
        save(pure: pure)
        jumps += 1
        query = ""
        results = []
    }

    func forget(_ entry: JumpHistory.Entry, pure: Bool) {
        history.remove(entry)
        save(pure: pure)
    }

    func forgetAll(pure: Bool) {
        history.removeAll()
        save(pure: pure)
    }

    private func save(pure: Bool) {
        guard !historyIsDemo else { return }
        history.save(pure: pure, to: defaults)
    }

    // MARK: Launch arguments (screenshots)

    /// `-FXJumpQuery <text>`: start with this text in the field.
    static var launchQuery: String? { UserDefaults.standard.string(forKey: "FXJumpQuery") }
    /// `-FXJumpFocus 0`: do not raise the keyboard on appear.
    static var launchFocus: Bool { UserDefaults.standard.string(forKey: "FXJumpFocus") != "0" }
    /// `-FXJumpSubmit 1`: press Return once the screen is up (with `-FXJumpQuery`), to see a jump land on Now.
    static var launchSubmit: Bool { UserDefaults.standard.string(forKey: "FXJumpSubmit") == "1" }
    /// `-FXJumpLandscape 1`: turn the device to landscape when the screen appears (iOS screenshots).
    static var launchLandscape: Bool { UserDefaults.standard.string(forKey: "FXJumpLandscape") == "1" }
    /// `-FXJumpDemo 1`: show a sample history (never saved).
    static var launchDemoHistory: Bool { UserDefaults.standard.string(forKey: "FXJumpDemo") == "1" }

    private static let earthDemo: [JumpHistory.Entry] = [
        .init(text: "2031-06-01 14:30 Tokyo", label: "Sun 1 Jun 2031, 05:30:00 UTC", kind: "date"),
        .init(text: "next ε", label: "Next ε boundary", kind: "boundary"),
        .init(text: "α#6 β#4 γ#9", label: "α#6 › β#4 › γ#9", kind: "cycle"),
        .init(text: "sync 4820", label: "Solar sync 4820 · start", kind: "sync"),
    ]
    private static let pureDemo: [JumpHistory.Entry] = [
        .init(text: "Delta Trifracton Node", label: "Delta Trifracton Node in Gamma Nonafracton", kind: "cycle"),
        .init(text: "+2ε 5η", label: "+2ε 5η from the shown moment", kind: "relative"),
        .init(text: "next Helion", label: "Next η boundary", kind: "boundary"),
    ]
}
