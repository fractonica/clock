import Foundation

/// A parsed JSON value: just enough to walk the golden fixtures written by ios/scripts/make-fixtures.mjs.
///
/// Numbers decode as `Double` (every integer in the fixtures is below 2^53; larger ones are strings). Accessors trap
/// on a type mismatch: that is a fixture-format bug, not a reading to compare.
enum JSON: Decodable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSON])
    case object([String: JSON])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            self = .null
        } else if let b = try? c.decode(Bool.self) {
            self = .bool(b)
        } else if let n = try? c.decode(Double.self) {
            self = .number(n)
        } else if let s = try? c.decode(String.self) {
            self = .string(s)
        } else if let a = try? c.decode([JSON].self) {
            self = .array(a)
        } else {
            self = .object(try c.decode([String: JSON].self))
        }
    }

    subscript(key: String) -> JSON {
        guard case .object(let o) = self else { preconditionFailure("not an object, looking up \(key)") }
        return o[key] ?? .null
    }

    subscript(index: Int) -> JSON { array[index] }

    var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    var array: [JSON] {
        guard case .array(let a) = self else { preconditionFailure("not an array: \(self)") }
        return a
    }

    var double: Double {
        guard case .number(let n) = self else { preconditionFailure("not a number: \(self)") }
        return n
    }

    var int: Int {
        let n = double
        precondition(n == n.rounded(), "not an integer: \(n)")
        return Int(n)
    }

    var string: String {
        guard case .string(let s) = self else { preconditionFailure("not a string: \(self)") }
        return s
    }

    var bool: Bool {
        guard case .bool(let b) = self else { preconditionFailure("not a bool: \(self)") }
        return b
    }

    /// `nil` for JSON null, else the number.
    var optionalDouble: Double? { isNull ? nil : double }
    var optionalInt: Int? { isNull ? nil : int }
    var optionalString: String? { isNull ? nil : string }

    var ints: [Int] { array.map(\.int) }
    var strings: [String] { array.map(\.string) }
    var doubles: [Double] { array.map(\.double) }
}

/// The fixture files, each decoded once per test process.
enum Fixtures {
    static let clock = load("clock")
    static let samples = load("samples")
    static let cycles = load("cycles")
    static let glyphs = load("glyphs")
    static let pure = load("pure")
    static let journal = load("journal")
    static let format = load("format")
    /// The independent fuzz fixture of ios/scripts/make-fuzz-fixtures.mjs.
    static let fuzz = load("fuzz")

    private static func load(_ name: String) -> JSON {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures") else {
            preconditionFailure("missing fixture \(name).json: run `node ios/scripts/make-fixtures.mjs`")
        }
        do {
            return try JSONDecoder().decode(JSON.self, from: Data(contentsOf: url))
        } catch {
            preconditionFailure("unreadable fixture \(name).json: \(error)")
        }
    }
}
