import Foundation

/// The composer's formatting bar as text edits: each action takes the text and the selection (in characters) and
/// returns the new text and selection. Wrapping actions toggle (bold on bold text removes it); line actions (heading,
/// list, checklist, quote) apply to every line the selection touches. Pure logic, checked by Journal/Checks.
enum MarkdownAction: String, CaseIterable, Identifiable, Sendable {
    case bold, italic, heading, list, checklist, quote, code, link

    var id: String { rawValue }

    var title: String {
        switch self {
        case .bold: "Bold"
        case .italic: "Italic"
        case .heading: "Heading"
        case .list: "List"
        case .checklist: "Checklist"
        case .quote: "Quote"
        case .code: "Code"
        case .link: "Link"
        }
    }

    var systemImage: String {
        switch self {
        case .bold: "bold"
        case .italic: "italic"
        case .heading: "textformat.size"
        case .list: "list.bullet"
        case .checklist: "checklist"
        case .quote: "text.quote"
        case .code: "chevron.left.forwardslash.chevron.right"
        case .link: "link"
        }
    }

    /// Applies the action. `selection` is a range of character offsets into `text`.
    func apply(to text: String, selection: Range<Int>) -> (text: String, selection: Range<Int>) {
        let chars = Array(text)
        let lower = min(max(0, selection.lowerBound), chars.count)
        let upper = min(max(lower, selection.upperBound), chars.count)
        let range = lower..<upper
        switch self {
        case .bold: return Self.wrap(chars, range, "**")
        case .italic: return Self.wrap(chars, range, "*")
        case .code:
            if chars[range].contains("\n") { return Self.fence(chars, range) }
            return Self.wrap(chars, range, "`")
        case .link: return Self.link(chars, range)
        case .heading: return Self.cycleHeading(chars, range)
        case .list: return Self.togglePrefix(chars, range, "- ")
        case .checklist: return Self.togglePrefix(chars, range, "- [ ] ")
        case .quote: return Self.togglePrefix(chars, range, "> ")
        }
    }

    // MARK: Wrapping

    private static func wrap(_ chars: [Character], _ range: Range<Int>, _ marker: String) -> (text: String, selection: Range<Int>) {
        let m = Array(marker)
        let n = m.count
        // already wrapped just outside the selection: unwrap
        if range.lowerBound >= n, range.upperBound + n <= chars.count,
           Array(chars[(range.lowerBound - n)..<range.lowerBound]) == m,
           Array(chars[range.upperBound..<(range.upperBound + n)]) == m,
           !(n == 1 && marker == "*" && isDoubled(chars, range)) {
            var out = chars
            out.removeSubrange(range.upperBound..<(range.upperBound + n))
            out.removeSubrange((range.lowerBound - n)..<range.lowerBound)
            return (String(out), (range.lowerBound - n)..<(range.upperBound - n))
        }
        // the selection includes its markers: unwrap
        if range.count >= 2 * n, Array(chars[range.lowerBound..<(range.lowerBound + n)]) == m,
           Array(chars[(range.upperBound - n)..<range.upperBound]) == m {
            var out = chars
            out.removeSubrange((range.upperBound - n)..<range.upperBound)
            out.removeSubrange(range.lowerBound..<(range.lowerBound + n))
            return (String(out), range.lowerBound..<(range.upperBound - 2 * n))
        }
        // trailing spaces stay outside the markers ("word " → "**word** ")
        var end = range.upperBound
        while end > range.lowerBound, chars[end - 1] == " " { end -= 1 }
        var out = chars
        out.insert(contentsOf: m, at: end)
        out.insert(contentsOf: m, at: range.lowerBound)
        return (String(out), (range.lowerBound + n)..<(end + n))
    }

    /// `*` inside `**…**`: the italic toggle must not eat half of a bold marker.
    private static func isDoubled(_ chars: [Character], _ range: Range<Int>) -> Bool {
        range.lowerBound >= 2 && chars[range.lowerBound - 2] == "*" && range.upperBound + 1 < chars.count && chars[range.upperBound + 1] == "*"
    }

    private static func fence(_ chars: [Character], _ range: Range<Int>) -> (text: String, selection: Range<Int>) {
        let head = Array("```\n")
        let tail = Array("\n```")
        var out = chars
        out.insert(contentsOf: tail, at: range.upperBound)
        out.insert(contentsOf: head, at: range.lowerBound)
        return (String(out), (range.lowerBound + head.count)..<(range.upperBound + head.count))
    }

    private static func link(_ chars: [Character], _ range: Range<Int>) -> (text: String, selection: Range<Int>) {
        let label = range.isEmpty ? Array("link") : Array(chars[range])
        let url = Array("https://")
        var out = chars
        out.replaceSubrange(range, with: Array("[") + label + Array("](") + url + Array(")"))
        if range.isEmpty {
            // the placeholder label is selected, ready to type over
            return (String(out), (range.lowerBound + 1)..<(range.lowerBound + 1 + label.count))
        }
        // the cursor goes after "https://", ready for the address
        let start = range.lowerBound + 1 + label.count + 2
        return (String(out), (start + url.count)..<(start + url.count))
    }

    // MARK: Lines

    /// The character offsets of the starts of the lines the selection touches.
    private static func lineStarts(_ chars: [Character], _ range: Range<Int>) -> [Int] {
        var start = range.lowerBound
        while start > 0, chars[start - 1] != "\n" { start -= 1 }
        var starts = [start]
        var i = start
        let end = range.isEmpty ? range.lowerBound : range.upperBound - 1
        while i < end {
            if chars[i] == "\n", i + 1 <= chars.count { starts.append(i + 1) }
            i += 1
        }
        return starts
    }

    private static func hasPrefix(_ chars: [Character], at i: Int, _ prefix: [Character]) -> Bool {
        i + prefix.count <= chars.count && Array(chars[i..<(i + prefix.count)]) == prefix
    }

    /// The other line prefixes a line action replaces ("- " becomes "- [ ] ", not "- [ ] - ").
    private static let linePrefixes: [[Character]] = ["- [ ] ", "- [x] ", "- ", "* ", "> "].map(Array.init)

    private static func togglePrefix(_ chars: [Character], _ range: Range<Int>, _ prefix: String) -> (text: String, selection: Range<Int>) {
        let p = Array(prefix)
        let starts = lineStarts(chars, range)
        let all = starts.allSatisfy { hasPrefix(chars, at: $0, p) || (prefix == "- [ ] " && hasPrefix(chars, at: $0, Array("- [x] "))) }
        var out = chars
        var lower = range.lowerBound
        var upper = range.upperBound
        // from the last line up, so earlier offsets stay valid
        for start in starts.reversed() {
            let removeCount: Int
            let insert: [Character]
            if all {
                removeCount = p.count
                insert = []
            } else {
                removeCount = linePrefixes.first { hasPrefix(out, at: start, $0) }?.count ?? 0
                insert = p
            }
            out.replaceSubrange(start..<(start + removeCount), with: insert)
            let delta = insert.count - removeCount
            if start <= lower { lower = max(start, lower + delta) }
            upper = max(lower, upper + delta)
        }
        return (String(out), lower..<upper)
    }

    /// None → "# " → "## " → "### " → none, on the line of the selection's start.
    private static func cycleHeading(_ chars: [Character], _ range: Range<Int>) -> (text: String, selection: Range<Int>) {
        let start = lineStarts(chars, range)[0]
        var hashes = 0
        while start + hashes < chars.count, chars[start + hashes] == "#" { hashes += 1 }
        let hasSpace = start + hashes < chars.count && chars[start + hashes] == " "
        let current = hashes > 0 && hasSpace ? hashes : 0
        let removed = current > 0 ? current + 1 : 0
        let next = current >= 3 ? 0 : current + 1
        let insert = next == 0 ? [] : Array(String(repeating: "#", count: next) + " ")
        var out = chars
        out.replaceSubrange(start..<(start + removed), with: insert)
        let delta = insert.count - removed
        let lower = max(start, range.lowerBound + delta)
        return (String(out), lower..<max(lower, range.upperBound + delta))
    }
}
