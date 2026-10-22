import Foundation

/// What the web host says about a planned diary (diary-host.js `summary`): the Delta, every page with its title, the
/// sections, the lock shape and what an export prints on. The plan itself stays in the web view.
struct DiaryPlan: Decodable, Equatable, Sendable {
    struct Delta: Decodable, Equatable, Sendable {
        var idx: Int
        var path: [Int]
        var t0: Double
        var t1: Double
        var name: String
        var stamp: String
    }

    struct Page: Decodable, Equatable, Sendable, Identifiable {
        var no: Int
        var kind: String
        var side: String?
        /// "12 · Nuclide ε#1" (src/diary/render.js `pageTitle`, Fractonica terms only).
        var title: String
        var id: Int { no }

        /// The title without its leading page number: "Nuclide ε#1".
        var name: String {
            guard let dot = title.range(of: " · ") , title[..<dot.lowerBound].allSatisfy(\.isNumber) else { return title }
            return String(title[dot.upperBound...])
        }
    }

    struct Section: Decodable, Equatable, Sendable, Identifiable {
        var title: String
        var key: String
        var page: Int
        var id: String { "\(key)-\(page)" }
    }

    struct Size: Decodable, Equatable, Sendable {
        var width: Double
        var height: Double
    }

    struct Place: Decodable, Equatable, Sendable {
        var place: String?
        var lat: Double
        var lon: Double
    }

    var token: Int
    /// False while the eclipse paths and the world map are still loading (the plan is redone when they arrive).
    var final: Bool
    var title: String
    var zone: String
    var delta: Delta
    var pages: [Page]
    var sections: [Section]
    var shape: DiaryPrint.LockShape
    var inserts: Int
    var eclipses: Int
    /// Ephemeris events (lunar months and solar events) in the Delta.
    var events: Int
    var size: Size
    var paper: DiaryPrint.Paper
    /// Pages of the PDF an export makes.
    var sheets: Int
    var place: Place?
    var zoneCity: Place?

    /// The section a page belongs to: the last one starting at or before it (src/ui/diary/logic.js `sectionAt`).
    func section(at page: Int) -> Section? {
        var hit: Section?
        for s in sections where s.page <= page && s.page >= (hit?.page ?? .min) { hit = s }
        return hit
    }

    func page(_ no: Int) -> Page? {
        pages.indices.contains(no - 1) ? pages[no - 1] : nil
    }
}

/// The messages of the web host, decoded from its JSON strings.
enum DiaryHostMessage: Sendable {
    case ready
    case progress(token: Int?)
    case plan(DiaryPlan)
    /// The visible page (in a spread, the page asked for or its recto) and the pages on show.
    case page(no: Int, pair: [Int?], spread: Bool, wide: Bool)
    case tap(no: Int)
    case error(token: Int?, message: String)

    private struct Header: Decodable {
        var type: String
        var token: Int?
        var no: Int?
        var pair: [Int?]?
        var spread: Bool?
        var wide: Bool?
        var message: String?
    }

    init?(json: String) {
        guard let data = json.data(using: .utf8), let head = try? JSONDecoder().decode(Header.self, from: data) else { return nil }
        switch head.type {
        case "ready": self = .ready
        case "progress": self = .progress(token: head.token)
        case "plan":
            guard let plan = try? JSONDecoder().decode(DiaryPlan.self, from: data) else { return nil }
            self = .plan(plan)
        case "page": self = .page(no: head.no ?? 1, pair: head.pair ?? [head.no ?? 1], spread: head.spread ?? false, wide: head.wide ?? false)
        case "tap": self = .tap(no: head.no ?? 1)
        case "error": self = .error(token: head.token, message: head.message ?? "unknown error")
        default: return nil
        }
    }
}

/// The print document of a diary (src/diary/render.js `printDocument`) with what it prints on.
struct DiaryPrintDocument: Decodable, Sendable {
    var html: String
    var title: String
    /// Diary pages.
    var pages: Int
    /// PDF pages (two diary pages per sheet with two-up printing).
    var sheets: Int
    var paper: DiaryPrint.Paper
    var twoUp: Bool
    var pairing: String
}
