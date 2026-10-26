import Foundation

/// The block structure of an entry's Markdown, enough for a journal: ATX and setext headings, paragraphs (line breaks
/// kept, as a notes app does), bullet, numbered and task lists (nested by indentation), quotes (parsed again inside),
/// fenced and indented code, and thematic breaks. Inline syntax (emphasis, code spans, links) stays in the text for
/// `AttributedString(markdown:options: .inlineOnlyPreservingWhitespace)` to read. Pure logic, checked by
/// Journal/Checks.
enum MarkdownBlock: Hashable, Sendable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case list(ordered: Bool, start: Int, items: [MarkdownListItem])
    case quote([MarkdownBlock])
    case code(language: String?, text: String)
    case rule

    static func parse(_ source: String) -> [MarkdownBlock] {
        MarkdownParser(lines: source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")).parseAll()
    }

    /// The text of the blocks without Markdown syntax, for excerpts: headings and paragraphs, list items with a bullet,
    /// quotes; code as is.
    static func plainText(_ source: String, limit: Int = 600) -> String {
        var out: [String] = []
        func add(_ blocks: [MarkdownBlock]) {
            for block in blocks {
                switch block {
                case .heading(_, let text), .paragraph(let text): out.append(MarkdownInline.strip(text))
                case .list(let ordered, let start, let items):
                    for (i, item) in items.enumerated() {
                        let mark = item.task.map { $0 ? "☑︎" : "☐" } ?? (ordered ? "\(start + i)." : "•")
                        out.append("\(mark) \(MarkdownInline.strip(item.text))")
                    }
                case .quote(let inner): add(inner)
                case .code(_, let text): out.append(text)
                case .rule: continue
                }
                if out.joined().count > limit { return }
            }
        }
        add(parse(source))
        return out.joined(separator: "\n")
    }
}

/// One item of a list: its text (inline Markdown, continuation lines joined with a line break), whether it is a task
/// and checked (nil when it is not a task), and its nesting depth (0 at the list's margin).
struct MarkdownListItem: Hashable, Sendable {
    var text: String
    var task: Bool?
    var depth: Int
}

/// Inline helpers that need no attributed strings.
enum MarkdownInline {
    /// The text without inline syntax: emphasis markers, code ticks, link targets ("[moon](https://…)" → "moon").
    static func strip(_ text: String) -> String {
        var s = text
        // links and images: keep the label
        while let open = s.range(of: "]("), let close = s.range(of: ")", range: open.upperBound..<s.endIndex),
              let start = s.range(of: "[", options: .backwards, range: s.startIndex..<open.lowerBound) {
            var lower = start.lowerBound
            if lower > s.startIndex, s[s.index(before: lower)] == "!" { lower = s.index(before: lower) }
            let label = String(s[start.upperBound..<open.lowerBound])
            s.replaceSubrange(lower..<close.upperBound, with: label)
        }
        for marker in ["**", "__", "~~", "`"] { s = s.replacingOccurrences(of: marker, with: "") }
        // single * and _ around words
        s = s.replacingOccurrences(of: #"(?<![\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])"#, with: "$1", options: .regularExpression)
        return s
    }
}

private struct MarkdownParser {
    let lines: [String]
    var i = 0

    init(lines: [String]) { self.lines = lines }

    mutating func parse() -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []

        func flush() {
            if !paragraph.isEmpty {
                blocks.append(.paragraph(paragraph.joined(separator: "\n")))
                paragraph = []
            }
        }

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            let indent = Self.indent(line)

            if trimmed.isEmpty {
                flush()
                i += 1
                continue
            }
            // fenced code
            if indent < 4, let fence = Self.fence(trimmed) {
                flush()
                let language = String(trimmed.dropFirst(fence.count)).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                i += 1
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.hasPrefix(fence), t.allSatisfy({ $0 == fence.first }) { i += 1; break }
                    code.append(Self.dropIndent(lines[i], upTo: indent))
                    i += 1
                }
                blocks.append(.code(language: language.isEmpty ? nil : language, text: code.joined(separator: "\n")))
                continue
            }
            // indented code (not inside a paragraph)
            if indent >= 4, paragraph.isEmpty {
                var code: [String] = []
                while i < lines.count, Self.indent(lines[i]) >= 4 || lines[i].trimmingCharacters(in: .whitespaces).isEmpty {
                    code.append(Self.dropIndent(lines[i], upTo: 4))
                    i += 1
                }
                while code.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { code.removeLast() }
                blocks.append(.code(language: nil, text: code.joined(separator: "\n")))
                continue
            }
            // setext headings under a paragraph
            if !paragraph.isEmpty, indent < 4, !trimmed.isEmpty, trimmed.allSatisfy({ $0 == "=" }) || (trimmed.allSatisfy({ $0 == "-" }) && trimmed.count >= 2) {
                let text = paragraph.joined(separator: " ")
                paragraph = []
                blocks.append(.heading(level: trimmed.first == "=" ? 1 : 2, text: text))
                i += 1
                continue
            }
            // thematic break
            if indent < 4, Self.isRule(trimmed) {
                flush()
                blocks.append(.rule)
                i += 1
                continue
            }
            // ATX heading
            if indent < 4, let heading = Self.heading(trimmed) {
                flush()
                blocks.append(heading)
                i += 1
                continue
            }
            // quote
            if indent < 4, trimmed.hasPrefix(">") {
                flush()
                var inner: [String] = []
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    guard t.hasPrefix(">") else { break }
                    var rest = t.dropFirst()
                    if rest.first == " " { rest = rest.dropFirst() }
                    inner.append(String(rest))
                    i += 1
                }
                blocks.append(.quote(MarkdownParser(lines: inner).parseAll()))
                continue
            }
            // list
            if indent < 4, let first = Self.listMarker(line) {
                flush()
                blocks.append(parseList(first))
                continue
            }
            paragraph.append(trimmed)
            i += 1
        }
        flush()
        return blocks
    }

    /// `parse()` for a nested source.
    func parseAll() -> [MarkdownBlock] {
        var copy = self
        return copy.parse()
    }

    /// A list from line `i`: items while the markers keep their kind (bullets, or numbers); nesting from indentation.
    private mutating func parseList(_ first: ListMarker) -> MarkdownBlock {
        var items: [MarkdownListItem] = []
        let baseIndent = first.indent
        while i < lines.count {
            let line = lines[i]
            if line.trimmingCharacters(in: .whitespaces).isEmpty {
                // a blank line ends the list unless an item of the same list follows
                if i + 1 < lines.count, let next = Self.listMarker(lines[i + 1]), next.ordered == first.ordered {
                    i += 1
                    continue
                }
                break
            }
            if let marker = Self.listMarker(line) {
                if marker.indent <= baseIndent, marker.ordered != first.ordered { break }
                let depth = max(0, (marker.indent - baseIndent) / 2)
                items.append(MarkdownListItem(text: marker.text, task: marker.task, depth: min(depth, 6)))
                i += 1
                continue
            }
            // a continuation line: indented text belongs to the item above; anything else ends the list
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if Self.indent(line) > baseIndent, !items.isEmpty, !Self.isRule(trimmed), Self.heading(trimmed) == nil {
                items[items.count - 1].text += "\n" + trimmed
                i += 1
                continue
            }
            break
        }
        return .list(ordered: first.ordered, start: first.number, items: items)
    }

    // MARK: Line kinds

    struct ListMarker {
        var indent: Int
        var ordered: Bool
        var number: Int
        var text: String
        var task: Bool?
    }

    static func listMarker(_ line: String) -> ListMarker? {
        let indent = indent(line)
        var rest = Substring(line.drop { $0 == " " || $0 == "\t" })
        var ordered = false
        var number = 1
        if let c = rest.first, "-*+".contains(c), rest.dropFirst().first == " " {
            rest = rest.dropFirst(2)
        } else {
            let digits = rest.prefix { $0.isASCII && $0.isNumber }
            guard !digits.isEmpty, digits.count <= 9 else { return nil }
            let after = rest.dropFirst(digits.count)
            guard let d = after.first, d == "." || d == ")", after.dropFirst().first == " " || after.count == 1 else { return nil }
            ordered = true
            number = Int(digits) ?? 1
            rest = after.dropFirst(2)
        }
        var task: Bool?
        if rest.hasPrefix("[ ] ") || rest == "[ ]" {
            task = false
            rest = rest.dropFirst(min(4, rest.count))
        } else if rest.hasPrefix("[x] ") || rest.hasPrefix("[X] ") || rest == "[x]" || rest == "[X]" {
            task = true
            rest = rest.dropFirst(min(4, rest.count))
        }
        return ListMarker(indent: indent, ordered: ordered, number: number, text: String(rest).trimmingCharacters(in: .whitespaces), task: task)
    }

    static func heading(_ trimmed: String) -> MarkdownBlock? {
        let hashes = trimmed.prefix { $0 == "#" }
        guard (1...6).contains(hashes.count) else { return nil }
        let rest = trimmed.dropFirst(hashes.count)
        guard rest.isEmpty || rest.first == " " else { return nil }
        var text = rest.trimmingCharacters(in: .whitespaces)
        // closing hashes
        while text.hasSuffix("#") { text.removeLast() }
        return .heading(level: hashes.count, text: text.trimmingCharacters(in: .whitespaces))
    }

    static func isRule(_ trimmed: String) -> Bool {
        let chars = trimmed.filter { $0 != " " }
        guard chars.count >= 3, let c = chars.first, "-*_".contains(c) else { return false }
        return chars.allSatisfy { $0 == c }
    }

    static func fence(_ trimmed: String) -> String? {
        for f in ["```", "~~~"] where trimmed.hasPrefix(f) {
            let run = trimmed.prefix { $0 == f.first }
            return String(run)
        }
        return nil
    }

    static func indent(_ line: String) -> Int {
        var n = 0
        for c in line {
            if c == " " { n += 1 } else if c == "\t" { n += 4 } else { break }
        }
        return n
    }

    static func dropIndent(_ line: String, upTo n: Int) -> String {
        var dropped = 0
        var index = line.startIndex
        while index < line.endIndex, dropped < n, line[index] == " " {
            dropped += 1
            index = line.index(after: index)
        }
        return String(line[index...])
    }
}
