import FractonicaKit
import Foundation

// The journal's sky events: the bundled table against fresh events() output of the diary's astronomy
// (sky-fixture.json, made with the table by scripts/make-sky-events.mjs), the generated kinds, the tiers, range
// queries, and the sky tags of an entry (within one Helion either side, other tags kept, search text).
// Run: ios/scripts/check.sh ios/Fractonica/Features/Journal/Sky/Checks

@main
struct SkyChecks {
    static func main() {
        kindChecks()
        tableChecks()
        fixtureChecks()
        queryChecks()
        tagChecks()
        Checks.finish()
    }
}

private let sky = SkyEvents.shared
private let clock = FractonicaClock.shared
private let vectorA = 1_791_460_800.0

private func kindChecks() {
    check(SkyKinds.all.count == 44, "44 kinds of events: \(SkyKinds.all.count)")
    check(Set(SkyKinds.all.map(\.name)).count == SkyKinds.all.count, "kind names are unique")
    check(SkyKinds.index(of: "full-moon").map { SkyKinds.all[$0].symbol } == "○", "the full moon's symbol is ○")
    check(SkyKinds.index(of: "march-equinox").map { SkyKinds.all[$0].labelPure } == "Northward equinox", "pure labels come from EVENT_INFO")
    check(SkyKinds.index(of: "nonsense") == nil, "an unknown name has no kind")
    check(SkyFamily.allCases.map(\.rawValue) == ["synodic", "anomalistic", "draconic", "sidereal", "lunistice", "solar", "eclipse", "planet"],
          "families in the diary's order")
    let tiers = Dictionary(grouping: SkyKinds.all.indices, by: { SkyTier(kind: $0) }).mapValues { $0.map { SkyKinds.all[$0].name }.sorted() }
    check(tiers[.eclipse] == ["lunar-eclipse", "solar-eclipse"], "eclipses come first: \(tiers[.eclipse] ?? [])")
    check(tiers[.season]?.count == 4 && tiers[.syzygy] == ["full-moon", "new-moon"], "then the seasons, then new and full moons")
    check(tiers[.between]?.allSatisfy { $0.hasPrefix("post-") || $0.hasPrefix("cross-quarter") } == true, "the in-between states come last")
    check(SkyTier.allCases.map(\.spacing) == SkyTier.allCases.map(\.spacing).sorted(by: >), "each tier comes more often than the one before")
}

private func tableChecks() {
    check(sky.count > 80_000, "the table loads: \(sky.count) events")
    check(sky.start == -2_208_988_800 && sky.end == 7_258_118_400, "it covers 1900 … 2200: \(sky.start) \(sky.end)")
    check(sky.covers(vectorA) && !sky.covers(-3e9) && !sky.covers(8e9), "covers")
    var ordered = true
    for i in 1..<sky.count where sky.time(i) < sky.time(i - 1) { ordered = false }
    check(ordered, "events are in time order")
    check(SkyEvents(data: Data("nonsense".utf8)) == nil, "a malformed file is refused")
}

private struct Fixture: Decodable {
    struct Window: Decodable {
        let from: Double
        let to: Double
        let events: [[Fixed]]
    }
    enum Fixed: Decodable {
        case number(Double)
        case text(String)
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            if let n = try? c.decode(Double.self) { self = .number(n) } else { self = .text(try c.decode(String.self)) }
        }
        var number: Double { if case .number(let n) = self { n } else { .nan } }
        var text: String { if case .text(let s) = self { s } else { "" } }
    }
    let range: [Double]
    let windows: [Window]
}

private func fixtureChecks() {
    let url = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "sky-fixture.json")
    guard let data = try? Data(contentsOf: url), let fixture = try? JSONDecoder().decode(Fixture.self, from: data) else {
        check(false, "sky-fixture.json reads")
        return
    }
    check(fixture.range == [sky.start, sky.end], "the fixture and the table cover the same range")
    var compared = 0
    var families = Set<String>()
    for w in fixture.windows {
        // the table rounds to whole seconds: an event within a second of a window's edge may fall either side
        let table = sky.events(from: w.from - 1, to: w.to + 1)
        var used = Set<Int>()
        for e in w.events {
            let t = e[0].number, name = e[1].text
            let i = table.indices.first { !used.contains($0) && table[$0].name == name && abs(table[$0].time - t) <= 0.5 + 1e-6 }
            guard let i else {
                check(false, "\(name) at \(t) is in the table")
                continue
            }
            used.insert(i)
            let ev = table[i]
            check(ev.label == e[2].text && ev.labelPure == e[3].text, "labels of \(name) at \(t): \(ev.label) / \(e[2].text)")
            check(ev.symbol == e[4].text && ev.family.rawValue == e[5].text, "symbol and family of \(name)")
            families.insert(e[5].text)
            compared += 1
        }
        let extra = table.indices.filter { !used.contains($0) && table[$0].time >= w.from + 1 && table[$0].time < w.to - 1 }
        check(extra.isEmpty, "the table has nothing events() lacks in [\(w.from), \(w.to)): \(extra.map { table[$0].name })")
    }
    check(compared > 500, "a good sample compared: \(compared) events")
    check(families.count == 8, "every family in the sample: \(families.sorted())")
}

private func queryChecks() {
    let r = sky.indices(from: vectorA, to: vectorA + 30 * 86_400)
    check(!r.isEmpty && sky.time(r.lowerBound) >= vectorA && sky.time(r.upperBound - 1) < vectorA + 30 * 86_400, "a range query")
    check(r.lowerBound == 0 || sky.time(r.lowerBound - 1) < vectorA, "it starts at the first event of the range")
    let t = sky.time(r.lowerBound)
    check(sky.indices(from: t, to: t) .isEmpty && sky.indices(through: t, from: t).contains(r.lowerBound), "half-open and closed ranges")
    let month = sky.events(from: vectorA, to: vectorA + 30 * 86_400)
    check(Set(month.map(\.name)).isSuperset(of: ["new-moon", "full-moon", "first-quarter", "last-quarter", "perigee", "apogee"]),
          "a month has every phase and both apsides")
    let hidden = sky.events(from: vectorA, to: vectorA + 30 * 86_400, hiding: [.synodic, .planet])
    check(!hidden.isEmpty && hidden.allSatisfy { $0.family != .synodic && $0.family != .planet }, "hidden families stay out")
    // 2026: the total solar eclipse of 12 Aug and the March total lunar eclipse
    let year = sky.events(from: 1_767_225_600, to: 1_798_761_600).filter { $0.family == .eclipse }
    check(year.contains { $0.label == "Total solar eclipse" && abs($0.time - 1_786_556_000) < 86_400 }, "the 2026-08-12 total solar eclipse: \(year.map(\.label))")
    let notable = sky.notable(from: 1_767_225_600, to: 1_798_761_600, limit: 6)
    check(notable.shown.count == 6 && notable.shown.prefix(year.count).allSatisfy { $0.family == .eclipse }, "a year's notable events start with its eclipses")
    check(notable.shown.dropFirst(year.count).first?.tier == .season, "then its seasons")
    check(notable.more == sky.indices(from: 1_767_225_600, to: 1_798_761_600).count - 6, "and counts the others")
}

private func tagChecks() {
    let full = sky.events(from: vectorA, to: vectorA + 30 * 86_400).first { $0.name == "full-moon" }!
    let d = SkyTags.reach(at: full.time)
    check(abs(d - clock.levelInfo(6).meanSeconds) < 0.01 * d, "an entry reaches a Helion: \(d)")
    check(SkyTags.names(near: full.time + 0.5 * d).contains("sky:full-moon"), "half a Helion after a full moon")
    check(SkyTags.names(near: full.time - 0.98 * SkyTags.reach(at: full.time - 0.98 * d)).contains("sky:full-moon"), "just under a Helion before")
    check(!SkyTags.names(near: full.time + 1.5 * d).contains("sky:full-moon"), "not a Helion and a half after")
    let names = SkyTags.names(near: full.time)
    check(Set(names).count == names.count && names.allSatisfy { $0.hasPrefix("sky:") }, "each name once: \(names)")
    let tags = SkyTags.tags(["trip", "sky:new-moon", "sky:bogus"], at: full.time)
    check(tags?.first == "trip" && tags?.contains("sky:full-moon") == true && tags?.contains("sky:new-moon") == false && tags?.contains("sky:bogus") == false,
          "own tags stay first, stale sky tags go: \(tags ?? [])")
    check(SkyTags.tags(nil, at: -3e9) == nil && SkyTags.tags([], at: -3e9) == [] && SkyTags.tags(["a", "sky:full-moon"], at: -3e9) == ["a"],
          "outside the table's range an entry has no sky tags")

    var record = HubRecord(id: "e1", kind: "journal.entry", time: full.time, end: nil, zone: "UTC", data: .object(["markdown": .string("")]),
                           text: nil, tags: ["mine"], blobs: nil, created: 0, updated: 0, deleted: nil)
    let tagged = SkyTags.normalise(record)
    check(tagged.tags?.first == "mine" && tagged.tags?.contains("sky:full-moon") == true, "normalise tags an entry")
    check(SkyTags.normalise(tagged) == tagged, "normalising twice changes nothing")
    check(SkyTags.outdated([record, tagged]).map(\.id) == ["e1"] && SkyTags.outdated([tagged]).isEmpty, "only outdated entries need a backfill")
    record.kind = "sensor.temperature"
    check(SkyTags.normalise(record).tags == ["mine"], "other kinds are left alone")
    record.kind = "journal.entry"
    record.deleted = true
    check(SkyTags.normalise(record).tags == ["mine"], "tombstones are left alone")

    check(SkyTags.kinds(in: ["x", "sky:full-moon", "sky:what"]).map(\.name) == ["full-moon"], "tags name kinds; unknown ones are skipped")
    let text = SkyTags.searchText(tagged.tags)
    check(text.contains("Full Moon") && text.contains("full moon"), "search reads the labels and names: \(text)")
    check(SkyTags.events(of: tagged).contains { $0.name == "full-moon" && $0.time == full.time }, "a record's tagged events with their times")
}
