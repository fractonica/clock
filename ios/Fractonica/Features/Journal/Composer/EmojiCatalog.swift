import Foundation

/// Every emoji the journal offers (`EmojiData`, generated from Unicode's emoji-test.txt by ios/scripts/make-emoji.swift:
/// all fully-qualified RGI emoji up to Emoji 16.0, which iOS 18.4 and later draw, skin-tone variants folded into their
/// base): the picker's sections (Unicode's groups) and search (CLDR names and keywords, subgroups and groups), and the
/// random emoji a new entry starts with, drawn uniformly from the whole set.
enum EmojiCatalog {
    struct Item: Sendable {
        let emoji: String
        /// The CLDR name: "grinning face", "flag: Japan".
        let name: String
        /// What search looks in: the name, the CLDR keywords, the subgroup and group in words, lowercased.
        let terms: String
    }

    struct Category: Identifiable, Sendable {
        let id: String
        let title: String
        let icon: String
        let emoji: [String]
    }

    /// Every emoji in CLDR order.
    static let all: [Item] = parsed.items

    /// Unicode's groups, in order: Smileys & Emotion, People & Body … Flags.
    static let categories: [Category] = parsed.categories

    private static let names: [String: String] = Dictionary(all.map { ($0.emoji, $0.name) }, uniquingKeysWith: { a, _ in a })

    private static let icons: [String: String] = [
        "Smileys & Emotion": "😀", "People & Body": "👋", "Animals & Nature": "🐻", "Food & Drink": "🍔",
        "Travel & Places": "✈️", "Activities": "⚽", "Objects": "💡", "Symbols": "❤️", "Flags": "🏁",
    ]

    private static let parsed: (items: [Item], categories: [Category]) = {
        var items: [Item] = []
        var categories: [Category] = []
        var group = ""
        var subgroup = ""
        var members: [String] = []
        func close() {
            guard !group.isEmpty, !members.isEmpty else { return }
            let id = group.lowercased().replacingOccurrences(of: " & ", with: "-").replacingOccurrences(of: " ", with: "-")
            categories.append(Category(id: id, title: group, icon: icons[group] ?? members[0], emoji: members))
        }
        for line in EmojiData.table.split(separator: "\n") {
            if line.hasPrefix("#") {
                close()
                group = String(line.dropFirst())
                members = []
            } else if line.hasPrefix("@") {
                subgroup = line.dropFirst().replacingOccurrences(of: "-", with: " ")
            } else {
                let fields = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
                guard fields.count >= 2 else { continue }
                let keywords = fields.count > 2 ? fields[2] : ""
                items.append(Item(emoji: fields[0], name: fields[1], terms: "\(fields[1]) | \(keywords) | \(subgroup) | \(group)".lowercased()))
                members.append(fields[0])
            }
        }
        close()
        return (items, categories)
    }()

    /// A new entry's emoji: any one of them, each as likely.
    static func random() -> String {
        var generator = SystemRandomNumberGenerator()
        return random(using: &generator)
    }

    static func random(using generator: inout some RandomNumberGenerator) -> String {
        all.randomElement(using: &generator)?.emoji ?? "🙂"
    }

    /// The emoji's CLDR name; for one outside the set (an older entry's, a skin-tone variant), its Unicode name.
    static func name(_ emoji: String) -> String {
        if let name = names[emoji] { return name }
        guard let raw = emoji.applyingTransform(.toUnicodeName, reverse: false) else { return emoji }
        let names = raw.components(separatedBy: "\\N{").compactMap { part -> String? in
            guard let end = part.firstIndex(of: "}") else { return nil }
            let n = String(part[..<end])
            return n.hasPrefix("VARIATION SELECTOR") || n == "ZERO WIDTH JOINER" ? nil : n
        }
        return names.joined(separator: " ").lowercased()
    }

    /// The emoji whose name, keywords, subgroup or group hold every word of the query (or the emoji itself), those
    /// whose name holds them all first, else in CLDR order: "moon", "red heart", "flag japan", "coffee", "happy".
    static func search(_ query: String) -> [String] {
        let terms = query.lowercased().split(whereSeparator: { $0 == " " || $0 == ":" || $0 == "," }).map(String.init)
        guard !terms.isEmpty else { return [] }
        var inName: [String] = []
        var elsewhere: [String] = []
        for item in all {
            if terms.count == 1 && item.emoji == terms[0] { inName.append(item.emoji); continue }
            guard terms.allSatisfy({ item.terms.contains($0) }) else { continue }
            let name = item.name.lowercased()
            if terms.allSatisfy({ name.contains($0) }) { inName.append(item.emoji) } else { elsewhere.append(item.emoji) }
        }
        return inName + elsewhere
    }
}
