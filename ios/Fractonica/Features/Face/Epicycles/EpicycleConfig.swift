import FractonicaKit
import Foundation

// What the epicycle face draws (Features/Face/Epicycles): a ladder of arms from a base period down to a top period, one
// arm a level, each turning with its own period's phase on the tip of the one before. The person sets the ladder (the
// base and the top), each arm's length, which arms are on and which way they turn; the periods set the speeds. No
// SwiftUI here: checked by Checks/EpicycleChecks.swift.

/// How an arm's angle is measured.
enum EpicycleFrame: String, Codable, CaseIterable, Sendable {
    /// From the top of the dial: every arm is a hand of its own period, up as its cycle begins, right at the peak,
    /// down at the node, left at the valley (the base's children draw |N − 1| lobes).
    case dial
    /// From the arm that carries it: an arm continues its carrier as its cycle begins (the base's children draw one lobe
    /// each, as the star face's rose does).
    case carrier
}

/// The face's configuration, as stored. Every write is validated like `AppSettings` (an invalid field takes its
/// fallback's value, never saved); a level's arm length is kept per level, so changing the ladder keeps the lengths
/// already set.
struct EpicycleConfig: Codable, Equatable, Sendable {
    /// The base period: its arm turns about the hub once a cycle, and the figure closes once a cycle (0 α … 12 ν).
    var base = 6
    /// The finest period with an arm (deeper than the base, at most `maxArms` levels from it, at most ξ).
    var top = 9
    /// Arm lengths set by hand, by level (`radiusRange`); the others take `defaultRadius`. Lengths are proportions:
    /// the figure is scaled so its arms together reach the dial's edge.
    var radii: [Int: Double] = [:]
    /// Levels whose arm is switched off (its length 0: in the carrier frame it still carries the frame round).
    var off: Set<Int> = []
    /// Levels whose arm turns anticlockwise.
    var reversed: Set<Int> = []
    var frame = EpicycleFrame.dial
    /// The paths of the tips between the hub and the pen, faint in their levels' colours.
    var tips = true

    init() {}

    // MARK: Limits

    /// Arms on one face, base and top included.
    static let maxArms = 6
    /// The deepest level with an arm (ξ, the deepest the app shows).
    static let deepest = Fractonica.maxLevel
    /// Bases: every level with a child to show.
    static let bases = 0...(deepest - 1)
    /// An arm's length, relative to the others.
    static let radiusRange = 0.01...1.0
    /// The default lengths by place on the ladder (base first): each arm about a third of the one that carries it,
    /// then smaller, so every period's loops stay apart.
    static let defaultRadii = [1, 0.4, 0.1, 0.03, 0.014, 0.01]

    static let standard = EpicycleConfig()

    /// The tops a base allows: one level deeper, up to `maxArms` arms and ξ.
    static func tops(base: Int) -> ClosedRange<Int> {
        let b = min(max(base, bases.lowerBound), bases.upperBound)
        return (b + 1)...min(b + maxArms - 1, deepest)
    }

    // MARK: Reading it

    /// The levels with an arm, base first.
    var levels: ClosedRange<Int> { base...max(base, top) }

    /// The default length of the arm of `level`, by its place below the base.
    func defaultRadius(_ level: Int) -> Double {
        let i = min(max(level - base, 0), Self.defaultRadii.count - 1)
        return Self.defaultRadii[i]
    }

    /// The arm length of `level` (relative to the others).
    func radius(_ level: Int) -> Double { radii[level] ?? defaultRadius(level) }

    func isOn(_ level: Int) -> Bool { !off.contains(level) }

    /// +1 clockwise, −1 anticlockwise.
    func sign(_ level: Int) -> Double { reversed.contains(level) ? -1 : 1 }

    /// The levels with an arm that is on.
    var onLevels: [Int] { levels.filter(isOn) }

    // MARK: Changing it

    /// A new base: the top stays where it is while that is allowed, else the face keeps its number of arms.
    mutating func setBase(_ b: Int) {
        guard Self.bases.contains(b) else { return }
        let count = top - base
        base = b
        let allowed = Self.tops(base: b)
        if !allowed.contains(top) { top = min(max(b + count, allowed.lowerBound), allowed.upperBound) }
    }

    /// Back to the face as it ships.
    mutating func reset() { self = Self.standard }

    // MARK: Validation

    /// Every invalid field takes its value from `fallback`: a base out of range, a top the base does not allow (the
    /// fallback's top, brought into range), lengths that are not numbers in range or belong to no level (dropped),
    /// levels out of range in `off` and `reversed` (dropped). At least one arm stays on.
    func sanitized(keeping fallback: EpicycleConfig) -> EpicycleConfig {
        var v = self
        if !Self.bases.contains(v.base) { v.base = Self.bases.contains(fallback.base) ? fallback.base : Self.standard.base }
        let tops = Self.tops(base: v.base)
        if !tops.contains(v.top) { v.top = min(max(fallback.top, tops.lowerBound), tops.upperBound) }
        let all = 0...Self.deepest
        v.radii = v.radii.filter { all.contains($0.key) && $0.value.isFinite && Self.radiusRange.contains($0.value) }
        v.off = v.off.filter(all.contains)
        v.reversed = v.reversed.filter(all.contains)
        if v.levels.allSatisfy(v.off.contains) { v.off = fallback.off.filter(all.contains) }
        if v.levels.allSatisfy(v.off.contains) { v.off.subtract(v.levels) }
        return v
    }

    // MARK: Coding

    enum CodingKeys: String, CodingKey { case base, top, radii, off, reversed, frame, tips }

    /// Reads what it can: a missing, mistyped or invalid value keeps its default.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func read<T: Decodable>(_ key: CodingKeys, _ type: T.Type) -> T? { (try? c.decodeIfPresent(type, forKey: key)) ?? nil }
        var v = EpicycleConfig()
        if let x = read(.base, Int.self) { v.base = x }
        if let x = read(.top, Int.self) { v.top = x }
        if let x = read(.radii, [String: Double].self) {
            v.radii = Dictionary(x.compactMap { k, r in Int(k).map { ($0, r) } }, uniquingKeysWith: { a, _ in a })
        }
        if let x = read(.off, [Int].self) { v.off = Set(x) }
        if let x = read(.reversed, [Int].self) { v.reversed = Set(x) }
        if let x = read(.frame, String.self), let f = EpicycleFrame(rawValue: x) { v.frame = f }
        if let x = read(.tips, Bool.self) { v.tips = x }
        self = v.sanitized(keeping: EpicycleConfig())
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(base, forKey: .base)
        try c.encode(top, forKey: .top)
        try c.encode(Dictionary(uniqueKeysWithValues: radii.map { (String($0.key), $0.value) }), forKey: .radii)
        try c.encode(off.sorted(), forKey: .off)
        try c.encode(reversed.sorted(), forKey: .reversed)
        try c.encode(frame.rawValue, forKey: .frame)
        try c.encode(tips, forKey: .tips)
    }
}

/// The face's launch hooks, read from the launch arguments (never saved; EpicycleSettings shows them for the launch):
///
///     -FXEpicycles <base>-<top>       the levels with arms (6-10: η θ ι κ λ, the Helion to the Flavon)
///     -FXEpicycleRadii r,r,…          the arm lengths from the base down (relative: 1,0.4,0.15,0.05,0.02)
///     -FXEpicycleOff l,l,…            levels whose arm is off
///     -FXEpicycleReverse l,l,…        levels whose arm turns anticlockwise
///     -FXEpicycleFrame dial|carrier   how the arms' angles are measured
///     -FXEpicycleTips 0|1             the paths of the tips between the hub and the pen
///     -FXEpicycleEdit 1               open the editor
///
///     ios/scripts/shoot.sh … -FXTab now -FXFace epicycles -FXEpicycles 6-10 -FXEpicycleRadii 1,0.4,0.15,0.05,0.02
struct EpicycleLaunch: Equatable, Sendable {
    var base: Int?
    var top: Int?
    var radii: [Double]?
    var off: Set<Int>?
    var reversed: Set<Int>?
    var frame: EpicycleFrame?
    var tips: Bool?
    var edit = false

    /// Nothing set.
    var isEmpty: Bool { self == EpicycleLaunch() }

    init() {}

    /// The hooks in an argument domain (`UserDefaults.volatileDomain(forName: UserDefaults.argumentDomain)`).
    init(arguments args: [String: Any]) {
        func string(_ key: String) -> String? { (args[key] as? String) ?? (args[key] as? NSNumber)?.stringValue }
        func levels(_ key: String) -> Set<Int>? {
            string(key).map { Set($0.split(separator: ",").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }) }
        }
        if let range = string("FXEpicycles") {
            let parts = range.split(separator: "-").compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
            if parts.count == 2 {
                base = parts[0]
                top = parts[1]
            }
        }
        radii = string("FXEpicycleRadii").map { $0.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) } }
        off = levels("FXEpicycleOff")
        reversed = levels("FXEpicycleReverse")
        frame = string("FXEpicycleFrame").flatMap { EpicycleFrame(rawValue: $0.lowercased()) }
        tips = string("FXEpicycleTips").map { $0 == "1" }
        edit = string("FXEpicycleEdit") == "1"
    }

    /// `config` with the hooks applied (then validated against it).
    func applied(to config: EpicycleConfig) -> EpicycleConfig {
        var v = config
        if let base { v.base = base }
        if let top { v.top = top }
        v = v.sanitized(keeping: config)
        if let radii {
            for (i, r) in radii.enumerated() where i <= v.top - v.base { v.radii[v.base + i] = r }
        }
        if let off { v.off = off }
        if let reversed { v.reversed = reversed }
        if let frame { v.frame = frame }
        if let tips { v.tips = tips }
        return v.sanitized(keeping: config)
    }
}
