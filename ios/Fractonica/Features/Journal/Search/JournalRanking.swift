import Foundation

/// Local search over records: a case- and accent-insensitive keyword match of every query word against the searchable
/// text (hub/API.md), ranked by how many words match and how often, then by recency; and the merge with semantic
/// scores when the sync layer provides them (`JournalSearch.semantic`). Pure logic, checked by Journal/Checks.
enum JournalRanking {
    /// The query's words, folded ("Café  Moon" → ["cafe", "moon"]).
    static func terms(_ query: String) -> [String] {
        fold(query).split { $0.isWhitespace || $0.isPunctuation && $0 != "#" }.map(String.init).filter { !$0.isEmpty }
    }

    static func fold(_ s: String) -> String {
        s.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: nil)
    }

    /// Keyword hits: every record whose text holds every term (an emoji query matches the entry's emoji), with a score
    /// in 0 … 1 (more occurrences and a title hit rank higher), best first, ties newest first.
    static func keyword(_ records: [HubRecord], query: String) -> [(id: String, score: Double)] {
        let terms = terms(query)
        guard !terms.isEmpty else { return [] }
        var hits: [(id: String, score: Double, time: Double)] = []
        for record in records {
            let text = fold(record.searchableText)
            let title = fold(record.entry?.title ?? record.data["title"]?.string ?? "")
            var score = 0.0
            var all = true
            for term in terms {
                let count = occurrences(of: term, in: text)
                if count == 0 { all = false; break }
                score += min(3, Double(count)) + (title.contains(term) ? 2 : 0)
            }
            guard all else { continue }
            hits.append((record.id, score / Double(terms.count * 5), record.time))
        }
        return hits.sorted { $0.score != $1.score ? $0.score > $1.score : $0.time > $1.time }.map { ($0.id, min(1, $0.score)) }
    }

    /// Semantic scores (record id → similarity) ranked first, keyword hits the semantic search missed after them.
    /// Without semantic scores, the keyword ranking.
    static func merge(keyword: [(id: String, score: Double)], semantic: [String: Double]?, known: Set<String>) -> [String] {
        guard let semantic, !semantic.isEmpty else { return keyword.map(\.id) }
        let keywordScore = Dictionary(keyword.map { ($0.id, $0.score) }, uniquingKeysWith: max)
        let ranked = semantic.filter { known.contains($0.key) }
            .map { (id: $0.key, score: $0.value + 0.05 * (keywordScore[$0.key] ?? 0)) }
            .sorted { $0.score != $1.score ? $0.score > $1.score : $0.id < $1.id }
            .map(\.id)
        let seen = Set(ranked)
        return ranked + keyword.map(\.id).filter { !seen.contains($0) }
    }

    private static func occurrences(of term: String, in text: String) -> Int {
        var count = 0
        var range = text.startIndex..<text.endIndex
        while let found = text.range(of: term, range: range) {
            count += 1
            range = found.upperBound..<text.endIndex
            if count >= 10 { break }
        }
        return count
    }
}
