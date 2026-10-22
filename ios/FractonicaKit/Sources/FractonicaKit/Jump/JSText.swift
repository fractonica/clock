import Foundation

/// JavaScript string and regular-expression semantics for the jump grammars, which are ports of the web app's regex
/// driven parsers (src/ui/calendar/parse.js, pure-parse.js). Offsets and lengths are UTF-16 code units, as in
/// JavaScript, and patterns are written in JavaScript syntax and translated once for ICU (`NSRegularExpression`):
///
/// - `\b` / `\B` use JavaScript's ASCII word characters (`[A-Za-z0-9_]`): a Greek letter is no word character there,
///   so "εbeat" has a boundary before the b, as in the browser. ICU would treat Greek as part of a word.
/// - `\d` and `\w` are ASCII only, like JavaScript without the `u` flag.
/// - `$` is the end of the input (ICU's `$` would also match before a final line break).
/// - Sticky matching (`y`) is `anchored` matching from an offset with transparent bounds.
final class JSRegex: @unchecked Sendable {
    // NSRegularExpression is immutable and documented as thread-safe.
    private let regex: NSRegularExpression

    /// Compiles a JavaScript pattern; `ignoreCase` is the `i` flag. A pattern that does not compile is a programming
    /// error in this file.
    init(_ pattern: String, ignoreCase: Bool = false) {
        do {
            regex = try NSRegularExpression(pattern: Self.translate(pattern), options: ignoreCase ? [.caseInsensitive] : [])
        } catch {
            preconditionFailure("jump grammar: bad pattern \(pattern): \(error)")
        }
    }

    /// `re.exec(s)`: the first match at or after UTF-16 offset `from`.
    func exec(_ s: String, from: Int = 0) -> JSMatch? {
        let ns = s as NSString
        guard from <= ns.length else { return nil }
        let range = NSRange(location: from, length: ns.length - from)
        guard let m = regex.firstMatch(in: s, options: [.withTransparentBounds, .withoutAnchoringBounds], range: range) else { return nil }
        return JSMatch(m, ns)
    }

    /// A sticky `re.exec(s)` with `lastIndex = at`: a match that starts exactly at `at`, or nil.
    func sticky(_ s: String, at: Int) -> JSMatch? {
        let ns = s as NSString
        guard at <= ns.length else { return nil }
        let range = NSRange(location: at, length: ns.length - at)
        guard let m = regex.firstMatch(in: s, options: [.anchored, .withTransparentBounds, .withoutAnchoringBounds], range: range),
              m.range.location == at else { return nil }
        return JSMatch(m, ns)
    }

    /// `re.test(s)`.
    func test(_ s: String) -> Bool { exec(s) != nil }

    /// `s.replace(/…/g, template)`: `$1` … refer to groups, as in JavaScript.
    func replaceAll(_ s: String, _ template: String) -> String {
        let ns = s as NSString
        return regex.stringByReplacingMatches(in: s, options: [], range: NSRange(location: 0, length: ns.length),
                                              withTemplate: template)
    }

    /// `s.replace(/…/g, fn)`: each match replaced by `transform(match)`.
    func replaceAll(_ s: String, _ transform: (JSMatch) -> String) -> String {
        let ns = s as NSString
        var out = ""
        var last = 0
        for m in regex.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            out += transform(JSMatch(m, ns))
            last = m.range.location + m.range.length
        }
        return out + ns.substring(from: last)
    }

    /// `s.split(/…/)` (a pattern without groups).
    func split(_ s: String) -> [String] {
        let ns = s as NSString
        var out: [String] = []
        var last = 0
        for m in regex.matches(in: s, options: [], range: NSRange(location: 0, length: ns.length)) {
            // JavaScript skips an empty match at the very start and at the position of the previous split
            if m.range.length == 0 && (m.range.location == 0 || m.range.location == last || m.range.location == ns.length) { continue }
            out.append(ns.substring(with: NSRange(location: last, length: m.range.location - last)))
            last = m.range.location + m.range.length
        }
        out.append(ns.substring(from: last))
        return out
    }

    // MARK: - Translation

    private static let word = "A-Za-z0-9_"

    /// JavaScript pattern syntax → ICU, for the constructs the grammars use.
    static func translate(_ pattern: String) -> String {
        var out = ""
        var inClass = false
        var chars = Array(pattern.unicodeScalars)
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "\\", i + 1 < chars.count {
                let n = chars[i + 1]
                switch (n, inClass) {
                case ("b", false):
                    out += "(?:(?<=[\(word)])(?![\(word)])|(?<![\(word)])(?=[\(word)]))"
                case ("B", false):
                    out += "(?:(?<=[\(word)])(?=[\(word)])|(?<![\(word)])(?![\(word)]))"
                case ("d", false): out += "[0-9]"
                case ("d", true): out += "0-9"
                case ("w", false): out += "[\(word)]"
                case ("w", true): out += word
                default:
                    out.unicodeScalars.append(c)
                    out.unicodeScalars.append(n)
                }
                i += 2
                continue
            }
            if inClass {
                if c == "]" { inClass = false }
                // [ : & are literal in a JavaScript class; ICU reads them as a nested set, a [:property:] or an
                // intersection
                if c == "[" || c == ":" || c == "&" { out += "\\" }
                out.unicodeScalars.append(c)
            } else if c == "[" {
                inClass = true
                out.unicodeScalars.append(c)
                // a leading ] or ^] is literal in ICU too; nothing to do
            } else if c == "$" {
                out += "\\z"
            } else {
                out.unicodeScalars.append(c)
            }
            i += 1
        }
        chars.removeAll()
        return out
    }
}

/// One match of a `JSRegex`: groups as JavaScript reports them (nil for a group that did not take part).
struct JSMatch {
    /// UTF-16 offset of the match, and its length.
    let index: Int
    let length: Int
    private let groups: [String?]

    fileprivate init(_ m: NSTextCheckingResult, _ s: NSString) {
        index = m.range.location
        length = m.range.length
        groups = (0..<m.numberOfRanges).map { i in
            let r = m.range(at: i)
            return r.location == NSNotFound ? nil : s.substring(with: r)
        }
    }

    /// Group `i` (0 = the whole match); nil when it did not participate.
    subscript(_ i: Int) -> String? { i < groups.count ? groups[i] : nil }

    /// The whole match.
    var text: String { groups[0] ?? "" }

    /// The offset just past the match (`lastIndex` of a sticky or global pattern).
    var end: Int { index + length }
}

extension String {
    /// `s.length`: UTF-16 code units.
    var jsLength: Int { utf16.count }

    /// `s.slice(a, b)` (negative offsets count from the end).
    func jsSlice(_ a: Int, _ b: Int? = nil) -> String {
        let n = jsLength
        func clampIndex(_ x: Int) -> Int { x < 0 ? Swift.max(0, n + x) : Swift.min(x, n) }
        let lo = clampIndex(a), hi = clampIndex(b ?? n)
        guard hi > lo else { return "" }
        return (self as NSString).substring(with: NSRange(location: lo, length: hi - lo))
    }

    /// `s.trim()`.
    var jsTrim: String { trimmingCharacters(in: .whitespacesAndNewlines) }

    /// `s.trimEnd()`.
    var jsTrimEnd: String {
        var s = Substring(self)
        while let last = s.unicodeScalars.last, CharacterSet.whitespacesAndNewlines.contains(last) { s = s.dropLast() }
        return String(s)
    }

    /// `s.toLowerCase()`.
    var jsLower: String { lowercased() }

    /// `s.padStart(width, pad)`.
    func padStart(_ width: Int, _ pad: Character = "0") -> String {
        jsLength >= width ? self : String(repeating: pad, count: width - jsLength) + self
    }
}

/// JavaScript truthiness of an optional group: present and not empty.
func truthy(_ s: String?) -> Bool { !(s ?? "").isEmpty }

/// `Number(text)` for the digit strings the grammars capture (NaN when it is not a number).
func jsNumber(_ text: String?) -> Double {
    guard let text else { return .nan }
    let t = text.jsTrim
    if t.isEmpty { return 0 }
    return Double(t) ?? .nan
}
