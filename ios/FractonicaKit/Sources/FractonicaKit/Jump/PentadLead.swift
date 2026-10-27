import Foundation

/// A leading Pentad (SPEC §7.5; parse.js `stripPentad`). A date on screen leads with its Pentad as a civil date leads
/// with its weekday (§15.3), and the rest of the date implies it, so both jump boxes read past it: "Pentad II · …",
/// "Pentad 2, 3rd Helion …", "Hypopentad …", the short forms "⬠II …", "⬠II·3 …", "◻ …" and the plain "P2 …",
/// "P2.3 …", "H.2 …", "H · …" (a bare "H" only before a separator). It must be followed by a space, a separator or the
/// end; "P2" or "H" with nothing after it stays as it is ("p2" is a Saros position).
enum PentadLead {
    private static let lead = JSRegex(
        "^(?:(?:pentad\\s*(?:iii|ii|i|[1-3]|[\u{2160}-\u{2162}])|hypopentad)(?:\\s*,?\\s*[1-5](?:st|nd|rd|th)\\s+helion)?"
            + "|\u{2B20}\\s*(?:iii|ii|i|[1-3]|[\u{2160}-\u{2162}])(?:\\s*\u{00B7}\\s*[1-5])?"
            + "|[\u{25FB}\u{25A1}\u{2B1C}\u{25FD}\u{25A2}](?:\\s*\u{00B7}\\s*[1-4])?"
            + "|p[1-3](?:\\.[1-5])?"
            + "|h\\.[1-4]|h(?=\\s*[\u{00B7},:|]))"
            + "(?=\\s|[\u{00B7},:|]|$)\\s*(?:[\u{00B7},:|]\\s*)?",
        ignoreCase: true
    )
    private static let ascii = JSRegex("^(?:p[1-3]|h)(?![a-z])", ignoreCase: true)
    private static let trailing = JSRegex("[\\s\u{00B7},:|]+$")

    /// The Pentad as typed ("" when there is none) and the text after it.
    static func strip(_ text: String) -> (pentad: String, rest: String) {
        guard let m = lead.exec(text) else { return ("", text) }
        let ns = text as NSString
        let rest = ns.substring(from: m.length).jsTrim
        let typed = ns.substring(to: m.length)
        if rest.isEmpty && ascii.test(typed) { return ("", text) }
        return (trailing.replaceAll(typed, ""), rest)
    }

    /// The answer to a Pentad with nothing after it, with an example of what to type after it.
    static func alone(_ pentad: String, example: String) -> JumpCandidate {
        .error("A Pentad names a day of the solar sync, not a moment",
               "It leads a date the way a weekday does: type the date after it: \(pentad) · \(example)")
    }
}
