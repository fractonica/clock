/// One reading of what a person typed into the jump box: a moment to go to, or why the text cannot be one.
/// The `{label, time, kind, detail}` candidates of src/ui/calendar/parse.js and pure-parse.js.
public struct JumpCandidate: Hashable, Sendable {
    /// What the text was read as.
    public enum Kind: String, Hashable, Sendable, CaseIterable {
        /// A Gregorian date and/or time (Earth box only).
        case date
        /// Unix seconds or milliseconds (Earth box only).
        case unix
        /// An offset from the displayed time, or "now".
        case relative
        /// A Saros position.
        case position
        /// A cycle by its address, global index, name or date.
        case cycle
        /// A solar sync.
        case sync
        /// The next or previous boundary (or quarter threshold) of a level.
        case boundary
        /// When a level's odometer shows a glyph state.
        case state
        /// The text could not be read: `label` says why, `detail` how to write it.
        case error
    }

    public let kind: Kind
    /// What the text was taken to mean ("Next ε boundary", "Delta Trifracton Node in Gamma Nonafracton"), or the error.
    public let label: String
    /// The moment, Unix seconds rounded to the millisecond the clock shows; nil for an error.
    public let time: Double?
    /// Where the result sits and how far it is from the displayed time, or the hint of an error.
    public let detail: String
    /// "now": choosing it returns the app to the live clock instead of freezing on this instant.
    public internal(set) var live: Bool = false
    /// A second guess, ranked after the others (pure "34η 29ι 21λ" read as a span).
    var rank: Int = 0

    public init(kind: Kind, label: String, time: Double?, detail: String, live: Bool = false) {
        self.kind = kind
        self.label = label
        self.time = time
        self.detail = detail
        self.live = live
    }

    /// A failure: `message` says what is wrong, `detail` how to write it instead.
    static func error(_ message: String, _ detail: String = "") -> JumpCandidate {
        JumpCandidate(kind: .error, label: message, time: nil, detail: detail)
    }

    /// The candidate can be travelled to.
    public var isSelectable: Bool { kind != .error && time != nil }
    public var isError: Bool { kind == .error }
}

/// What the Earth jump box needs to read a text (the `opts` of parseJump).
public struct JumpContext: Sendable {
    /// The displayed time: relative inputs and the cycles around an address hang off it.
    public var now: Double
    /// The device clock, for "now".
    public var real: Double
    /// The zone a time without an offset is read in (IANA identifier).
    public var zone: String
    /// Does the locale write the day first in 06/01/2031? nil when unknown (day first is ranked first then).
    public var dayFirst: Bool?
    /// The selected level, which "next peak" means; nil when none.
    public var level: Int?

    public init(now: Double, real: Double, zone: String = "UTC", dayFirst: Bool? = nil, level: Int? = nil) {
        self.now = now
        self.real = real
        self.zone = zone
        self.dayFirst = dayFirst
        self.level = level
    }
}

/// What the pure jump box needs (the `opts` of parsePure): no zone, no Earth calendar.
public struct PureJumpContext: Sendable {
    /// The shown moment: offsets and the periods above a date's first entry come from it.
    public var now: Double
    /// The device clock, for "now".
    public var real: Double
    /// The selected depth, which "next peak" means; nil when none.
    public var level: Int?

    public init(now: Double, real: Double, level: Int? = nil) {
        self.now = now
        self.real = real
        self.level = level
    }
}
