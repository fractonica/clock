import FractonicaKit
import Foundation

/// What the jump screen reads a text as, in the vocabulary of the mode (no SwiftUI, so ios/scripts/check.sh can run it).
///
/// Pure mode reads with the pure grammar only (`PureJumpParser`): nothing Gregorian ever comes back. The Earth box reads
/// with `JumpParser`, as the web app does, and also understands what the pure box reads ("Delta Trifracton Node",
/// "+2ε 5η", a stamp copied from pure mode) when the Earth grammar finds nothing — the native box is one search field
/// for every notation the app prints.
enum JumpInterpreter {
    /// The context of one reading: the displayed time, the device clock, the zone, the slash order, the selected level.
    struct Situation: Sendable, Equatable {
        var now: Double
        var real: Double
        var pure: Bool
        var zone: String
        var dayFirst: Bool?
        var level: Int?
    }

    /// The candidates for `text`, best first; errors only when nothing reads; [] for a blank text.
    static func candidates(_ text: String, _ s: Situation, clock: FractonicaClock = .shared,
                           notation: Notation = .standard) -> [JumpCandidate] {
        let pureContext = PureJumpContext(now: s.now, real: s.real, level: s.level)
        if s.pure { return PureJumpParser.parse(text, pureContext, notation: notation) }
        let earth = JumpParser.parse(text, JumpContext(now: s.now, real: s.real, zone: s.zone, dayFirst: s.dayFirst, level: s.level),
                                     clock: clock)
        if earth.isEmpty || earth.contains(where: \.isSelectable) { return earth }
        let pure = PureJumpParser.parse(text, pureContext, notation: notation)
        if pure.contains(where: \.isSelectable) { return pure.filter(\.isSelectable) }
        // neither reads: the Earth answer, unless it is the generic one and the pure grammar has a precise pointer
        // (a retired unit name, "0η", a quarter that does not meet the date …)
        if let first = earth.first, isGeneric(first), let pointer = pure.first, !isGeneric(pointer), !isEarthAnswer(pointer) {
            return pure
        }
        return earth
    }

    /// The first candidate that can be travelled to.
    static func best(_ candidates: [JumpCandidate]) -> JumpCandidate? {
        candidates.first(where: \.isSelectable)
    }

    /// A recent jump run again: the reading chosen then if the text still yields it (06/01/2031 read month/day stays
    /// month/day), else the best one now; nil when the text no longer reads.
    static func replay(_ entry: JumpHistory.Entry, in candidates: [JumpCandidate]) -> JumpCandidate? {
        candidates.first { $0.isSelectable && $0.kind.rawValue == entry.kind && $0.label == entry.label } ?? best(candidates)
    }

    static func isGeneric(_ c: JumpCandidate) -> Bool { c.kind == .error && c.label.hasPrefix("Cannot read") }
    static func isEarthAnswer(_ c: JumpCandidate) -> Bool { c.kind == .error && c.label == "Dates and clock times are off in pure mode" }

    /// The examples offered while the field is empty: the mode's own and, in the Earth box, a few in Fractonica terms.
    static func examples(pure: Bool, dayFirst: Bool?) -> [JumpExampleGroup] {
        let fractonica = PureJumpParser.examples.map { JumpExample(text: $0.text, meaning: $0.meaning) }
        if pure { return [JumpExampleGroup(title: "Fractonica", items: fractonica)] }
        let picks = ["Delta Trifracton Node", "ε#2 5η", "+2ε 5η", "next Helion", "η [13,0]"]
        return [
            JumpExampleGroup(title: "Earth", items: JumpParser.examples(dayFirst: dayFirst).map { JumpExample(text: $0.text, meaning: $0.meaning) }),
            JumpExampleGroup(title: "Fractonica", items: fractonica.filter { picks.contains($0.text) }),
        ]
    }

    /// The hint after an error, as the native app says it: the web app's "Press ? for the glossary" has no key here,
    /// the zone is changed in Settings, and the list of forms to try is left out where the example chips follow
    /// (`examplesShown`).
    static func hint(_ detail: String, examplesShown: Bool = false) -> String {
        var s = detail.replacingOccurrences(of: " Press ? for the glossary.", with: "")
            .replacingOccurrences(of: "Press ? for the glossary.", with: "")
            .replacingOccurrences(of: ", or change the zone in the header.", with: ", or change the zone in Settings.")
        if examplesShown {
            for help in [JumpParser.help, PureJumpParser.help] {
                s = s.replacingOccurrences(of: "Try \(help). ", with: "").replacingOccurrences(of: "Try \(help).", with: "")
            }
        }
        return s.trimmingCharacters(in: .whitespaces)
    }

    /// How a date reading was taken, when its label says more than the date itself: "day/month", "June 2031", "2031".
    /// `long` is the date as the label writes it ("Sun 1 Jun 2031, 14:30:00 UTC"); nil when the label is just that.
    static func dateReading(label: String, long: String) -> String? {
        if label == long { return nil }
        if label.hasPrefix(long) {
            let rest = label.dropFirst(long.count).trimmingCharacters(in: .whitespaces)
            let inner = rest.hasPrefix("(") && rest.hasSuffix(")") ? String(rest.dropFirst().dropLast()) : rest
            return inner.isEmpty ? nil : inner
        }
        if label.hasSuffix(" · " + long) { return String(label.dropLast(long.count + 3)) }
        return label
    }

    /// Whether a note only repeats what a line already shows ("Delta Trifracton Node" under "Delta Trifracton Node ε#2").
    static func repeats(_ note: String, in lines: [String]) -> Bool {
        !note.isEmpty && lines.contains { $0.contains(note) }
    }
}

/// The jump screen's layout and refresh rules (numbers only, so ios/scripts/check.sh can check them).
enum JumpLayout {
    /// From this width on, recent jumps and examples sit side by side and the best reading shows its Earth and
    /// Fractonica halves side by side (iPad, Mac, iPhone in landscape).
    static let wideWidth: CGFloat = 760
    static func isWide(_ width: CGFloat) -> Bool { width > wideWidth }
    /// Side margins: those of the search field above the content (16 pt on iPhone, 20 pt on iPad).
    static func margin(for width: CGFloat) -> CGFloat { isWide(width) ? 20 : 16 }
    /// The widest the content gets: a phone column, or most of a big window.
    static func contentWidth(for width: CGFloat) -> CGFloat { isWide(width) ? 1200 : 680 }
    /// Displayed seconds between two readings of the field while the clock moves: every second live or at real
    /// speed, a quarter of a real second during a time-lapse (offsets and distances count from the displayed time).
    static func refreshInterval(live: Bool, rate: Double) -> Double {
        guard !live, rate.isFinite, rate != 0 else { return 1 }
        return max(1, abs(rate) / 4)
    }
}

/// An example input and what it means.
struct JumpExample: Hashable, Sendable {
    var text: String
    var meaning: String
}

/// Examples under a heading ("Earth", "Fractonica").
struct JumpExampleGroup: Identifiable, Sendable {
    var title: String
    var items: [JumpExample]
    var id: String { title }
}

/// The recent jumps of one mode: the texts that were travelled to, newest first, each once (src/ui/jump.js history).
/// Earth and pure mode keep separate lists, so a date typed in the Earth box never shows in pure mode.
struct JumpHistory: Equatable, Sendable {
    /// A text, how it was read (its label) and as what (the candidate kind's raw value).
    struct Entry: Codable, Equatable, Hashable, Sendable {
        var text: String
        var label: String
        var kind: String
    }

    static let limit = 8

    private(set) var entries: [Entry] = []

    init(entries: [Entry] = []) {
        self.entries = Self.sanitized(entries)
    }

    /// Stored lists are untrusted (old versions, hand edits): keep the well-formed entries, clipped, at most `limit`.
    static func sanitized(_ stored: [Entry]) -> [Entry] {
        var seen = Set<String>()
        var out: [Entry] = []
        for e in stored {
            let text = String(e.text.prefix(JumpParser.maxInput))
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, seen.insert(text).inserted else { continue }
            out.append(Entry(text: text, label: String(e.label.prefix(300)), kind: e.kind))
            if out.count == limit { break }
        }
        return out
    }

    /// Puts a jump on top, removing an older entry with the same text.
    mutating func remember(_ text: String, label: String, kind: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        entries = Self.sanitized([Entry(text: trimmed, label: label, kind: kind)] + entries.filter { $0.text != trimmed })
    }

    mutating func remove(_ entry: Entry) {
        entries.removeAll { $0 == entry }
    }

    mutating func removeAll() {
        entries = []
    }

    // MARK: Persistence

    /// The UserDefaults key of a mode's list.
    static func key(pure: Bool) -> String { pure ? "jump.recent.pure.v1" : "jump.recent.v1" }

    static func load(pure: Bool, from defaults: UserDefaults = .standard) -> JumpHistory {
        guard let data = defaults.data(forKey: key(pure: pure)),
              let stored = try? JSONDecoder().decode([Entry].self, from: data) else { return JumpHistory() }
        return JumpHistory(entries: stored)
    }

    func save(pure: Bool, to defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(entries) { defaults.set(data, forKey: Self.key(pure: pure)) }
    }
}

extension JumpCandidate.Kind {
    /// The short name of a kind, as the web app's list shows it.
    var title: String {
        switch self {
        case .date: "Date"
        case .unix: "Unix"
        case .relative: "Offset"
        case .position: "Position"
        case .cycle: "Cycle"
        case .sync: "Sync"
        case .boundary: "Boundary"
        case .state: "State"
        case .error: "Check"
        }
    }

    /// SF Symbol for the kind.
    var systemImage: String {
        switch self {
        case .date: "calendar"
        case .unix: "number"
        case .relative: "plusminus"
        case .position: "scope"
        case .cycle: "circle.circle"
        case .sync: "sun.max"
        case .boundary: "arrow.right.to.line"
        case .state: "square.split.2x1"
        case .error: "exclamationmark.triangle"
        }
    }
}
