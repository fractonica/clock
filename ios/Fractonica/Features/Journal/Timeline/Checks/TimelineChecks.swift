import FractonicaKit
import Foundation

// The journal timeline's zoom and wave: periods (grouping, emoji and pictures, sections, words), the pinch's steps, the
// wave's frame and limits, its strands (which levels show at a zoom, their sizes), the half-arc profile, the sampled
// lines, the cycle starts, and the emoji placement (fanning, clusters, hits, the zoom that opens a cluster).
// Run: ios/scripts/check.sh ios/Fractonica/Features/Journal/Timeline/Checks

@main
struct TimelineChecks {
    static func main() {
        zoomChecks()
        periodChecks()
        sectionChecks()
        wordChecks()
        pinchChecks()
        limitChecks()
        strandChecks()
        profileChecks()
        lineChecks()
        tickChecks()
        placementChecks()
        Checks.finish()
    }
}

private let clock = FractonicaClock.shared
private let vectorA = 1_791_460_800.0

private func record(_ id: String, _ time: Double, emoji: String? = nil, photos: [String] = [], video: String? = nil) -> HubRecord {
    var blobs = photos.map { BlobRef(hash: $0, type: "image/heic", size: 1, role: "photo") }
    if let video {
        blobs.append(BlobRef(hash: video + "p", type: "image/jpeg", size: 1, role: "poster"))
        blobs.append(BlobRef(hash: video, type: "video/quicktime", size: 1, role: "video", poster: video + "p"))
    }
    blobs.append(BlobRef(hash: id + "a", type: "audio/mp4", size: 1, role: "audio"))
    return HubRecord.journalEntry(id: id, time: time, zone: "UTC", entry: JournalEntry(emoji: emoji, title: id), blobs: blobs, now: time)
}

// MARK: - Zoom levels

private func zoomChecks() {
    check(JournalZoom.allCases.map(\.level) == [6, 3, 2, 1], "Helions, Deltas, Gammas, Betas are levels 6 3 2 1")
    check(JournalZoom.helion.coarser == .delta && JournalZoom.delta.coarser == .gamma && JournalZoom.gamma.coarser == .beta && JournalZoom.beta.coarser == nil,
          "zooming out goes Helion → Delta → Gamma → Beta and stops")
    check(JournalZoom.beta.finer == .gamma && JournalZoom.helion.finer == nil, "zooming in goes back and stops at Helions")
    check(JournalZoom.allCases.map(\.symbol) == ["η", "δ", "γ", "β"], "symbols: \(JournalZoom.allCases.map(\.symbol))")
    check(JournalZoom.delta.sectionLevel == 2 && JournalZoom.beta.sectionLevel == 0 && JournalZoom.helion.sectionLevel == nil,
          "blocks sit under their parent period")
    check(JournalZoom(launch: "delta") == .delta && JournalZoom(launch: "γ") == .gamma && JournalZoom(launch: "Betas") == .beta
          && JournalZoom(launch: "day") == .helion && JournalZoom(launch: "year") == nil, "launch words")
    check(JournalZoom.helion < .beta, "zooms order from fine to coarse")
}

// MARK: - Periods

private func periodChecks() {
    guard let d = clock.level(at: vectorA, 3) else { return check(false, "δ reading at vector A") }
    // newest first: three in this Delta, two in the previous, one outside the catalogue
    let records = [
        record("a", d.end - 10, emoji: "🌙", photos: ["p1"]),
        record("b", d.end - 100_000, emoji: "☕️", video: "v1"),
        record("c", d.start + 5, emoji: "🌙", photos: ["p1", "p2"]),
        record("d", d.start - 5, emoji: "📚"),
        record("e", d.start - 400_000, photos: ["p3", "p4", "p5", "p6", "p7"]),
        record("f", -20_000_000_000, emoji: "🦕"),
    ]
    let periods = JournalPeriods.group(records, level: 3)
    check(periods.map(\.ids) == [["a", "b", "c"], ["d", "e"], ["f"]], "records group by Delta, in order: \(periods.map(\.ids))")
    check(periods[0].id == JournalPeriod.id(level: 3, cycle: d.cycle) && abs(periods[0].start - d.start) < 1e-3 && abs(periods[0].end - d.end) < 1e-3,
          "a block is its Delta: \(periods[0].id)")
    check(periods[0].emojis == ["🌙", "☕️"] && periods[0].emojiCount == 2, "most used emoji first: \(periods[0].emojis)")
    check(periods[0].media.map(\.hash) == ["p1", "v1", "p2"] && periods[0].mediaCount == 4,
          "pictures newest first, each once, videos by their poster, audio left out: \(periods[0].media.map(\.hash)) of \(periods[0].mediaCount)")
    check(periods[1].media.count == JournalPeriods.mediaLimit && periods[1].mediaCount == 5 && periods[1].emojis == ["📚"],
          "at most four pictures: \(periods[1].media.count) of \(periods[1].mediaCount)")
    check(periods[2].cycle == nil && periods[2].start == -20_000_000_000 && periods[2].contains(-20_000_000_000), "outside the catalogue: one block of its own")
    check(periods[0].times.count == 3 && periods[0].times[0] == d.end - 10, "times kept for the density strip")

    // ties: the newest emoji first; at most six
    let many = (0..<9).map { i in record("m\(i)", d.end - 10 - Double(i) * 1000, emoji: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂"][i]) }
    let p = JournalPeriods.group(many + [record("x", d.end - 20_000, emoji: "🙂")], level: 3)
    check(p.count == 1 && p[0].emojis == ["🙂", "😀", "😃", "😄", "😁", "😆"] && p[0].emojiCount == 9, "frequency, then newest; six at most: \(p.first?.emojis ?? [])")

    // every level: each record in the period of its own cycle, periods newest first, none empty
    let spread = (0..<240).map { i in record("s\(i)", vectorA - Double(i) * 3.3 * 86_400, emoji: "🌊") }
    for zoom in JournalZoom.allCases {
        let ps = JournalPeriods.group(spread, level: zoom.level)
        let ids = ps.flatMap(\.ids)
        let ok = ps.allSatisfy { period in
            period.ids.indices.allSatisfy { i in
                let t = period.times[i]
                return period.contains(t) && clock.level(at: t, zoom.level)?.cycle == period.cycle
            }
        }
        check(ids == spread.map(\.id) && ok && Set(ps.map(\.id)).count == ps.count, "\(zoom.title): every record in its own cycle, once, in order (\(ps.count) blocks)")
        check(zip(ps, ps.dropFirst()).allSatisfy { $0.start > $1.start }, "\(zoom.title): blocks newest first")
    }
    // ~2.2 years of entries span several Gammas and many Deltas
    check(JournalPeriods.group(spread, level: 2).count >= 3 && JournalPeriods.group(spread, level: 3).count >= 10,
          "a spread journal fills several Gammas and many Deltas")

    let deltas = JournalPeriods.group(spread, level: 3)
    if let i = JournalPeriods.index(of: deltas[4].start + 1, in: deltas) {
        check(i == 4, "the block holding a moment: \(i)")
    }
    check(JournalPeriods.index(of: vectorA + 1e9, in: deltas) == 0 && JournalPeriods.index(of: 0, in: deltas) == deltas.count - 1,
          "a moment beyond every block finds the nearest")
    check(JournalPeriods.index(of: 0, in: []) == nil, "no blocks, no index")
}

private func sectionChecks() {
    let spread = (0..<300).map { i in record("s\(i)", vectorA - Double(i) * 4.1 * 86_400) }
    for zoom in JournalZoom.allCases where zoom.sectionLevel != nil {
        let periods = JournalPeriods.group(spread, level: zoom.level)
        let sections = JournalPeriods.sections(periods, level: zoom.sectionLevel!)
        check(sections.flatMap(\.periods) == periods, "\(zoom.title): sections keep every block in order")
        let inside = sections.allSatisfy { s in s.periods.allSatisfy { p in p.start >= s.start - 1e-3 && p.end <= s.end + 1e-3 } }
        check(inside, "\(zoom.title): each block lies inside its section's period")
        check(Set(sections.map(\.id)).count == sections.count && sections.allSatisfy { $0.cycle != nil },
              "\(zoom.title): one section per parent period")
        check(sections.reduce(0) { $0 + $1.count } == spread.count, "\(zoom.title): sections count every entry")
    }
}

// MARK: - Words

private func wordChecks() {
    guard let d = clock.level(at: vectorA, 3), let g = clock.level(at: vectorA, 2), let b = clock.level(at: vectorA, 1) else {
        return check(false, "readings at vector A")
    }
    let name = JournalPeriods.name(level: 3, cycle: d.cycle)
    check(name.hasPrefix("Delta ") && name.hasSuffix("fracton"), "a Delta's name: \(name)")
    check(JournalPeriods.name(level: 1, cycle: b.cycle).hasPrefix("Beta "), "a Beta's name")
    check(JournalPeriods.name(level: 3, cycle: nil) == "Outside the catalogue", "no cycle, no name")

    let utc = EarthFormatter(zone: "UTC")
    let delta = JournalPeriods.earthSpan(start: d.start, end: d.end, level: 3, earth: utc)
    check(delta.contains("–") && delta.contains("2026"), "a Delta's Earth span: \(delta)")
    let gamma = JournalPeriods.earthSpan(start: g.start, end: g.end, level: 2, earth: utc)
    check(gamma.split(separator: "–").count == 2, "a Gamma's Earth span: \(gamma)")
    let beta = JournalPeriods.earthSpan(start: b.start, end: b.end, level: 1, earth: utc)
    check(beta.range(of: #"^[A-Z][a-z]{2} \d{4} – [A-Z][a-z]{2} \d{4}$"#, options: .regularExpression) != nil, "a Beta's span in months: \(beta)")
    // a known span: 8 Aug – 24 Oct 2026 style, end exclusive
    let day = 86_400.0
    check(JournalPeriods.earthSpan(start: 1_786_147_200, end: 1_786_147_200 + 10 * day, level: 3, earth: utc) == "8 Aug – 17 Aug 2026",
          "the end is exclusive: \(JournalPeriods.earthSpan(start: 1_786_147_200, end: 1_786_147_200 + 10 * day, level: 3, earth: utc))")
    check(JournalPeriods.earthSpan(start: 1_796_083_200, end: 1_796_083_200 + 90 * day, level: 3, earth: utc) == "1 Dec 2026 – 28 Feb 2027",
          "across a year: \(JournalPeriods.earthSpan(start: 1_796_083_200, end: 1_796_083_200 + 90 * day, level: 3, earth: utc))")

    let address = JournalPeriods.address(level: 3, at: vectorA)
    check(address.range(of: #"^α#\d+ β#\d+ γ#\d+$"#, options: .regularExpression) != nil, "a Delta's pure address: \(address)")
    check(JournalPeriods.address(level: 1, at: vectorA).range(of: #"^α#\d+$"#, options: .regularExpression) != nil, "a Beta's pure address")
    check(!address.contains("20") || !address.contains("Oct"), "no Earth words in pure mode")
    check(JournalPeriods.entries(1) == "1 entry" && JournalPeriods.entries(12) == "12 entries", "entry counts")
}

// MARK: - Pinch

private func pinchChecks() {
    var pinch = JournalPinch()
    check(pinch.step(0.9) == 0 && pinch.step(1.1) == 0, "a wobble steps nowhere")
    check(pinch.step(0.7) == 1, "closing the fingers steps out")
    check(pinch.step(0.6) == 0 && pinch.step(0.7 * 0.7) == 1, "a long pinch steps out again from where it last stepped")
    check(pinch.step(0.49 * 1.45) == -1, "opening the fingers steps back in")
    let lean = JournalPinch().lean(0.5)
    check(lean >= 0.9 && lean < 1 && JournalPinch().lean(3) <= 1.08 && JournalPinch().lean(1) == 1, "the page leans into the pinch, a little: \(lean)")
    check(JournalPinch.apply(1, to: .helion) == .delta && JournalPinch.apply(1, to: .beta) == nil && JournalPinch.apply(-1, to: .gamma) == .delta
          && JournalPinch.apply(0, to: .gamma) == nil, "steps between zooms")
}

// MARK: - Wave frame and limits

private func limitChecks() {
    let h = 700.0
    let lim = JournalWaveLimits(height: h, newest: vectorA, oldest: vectorA - 400 * 86_400)
    let preon = clock.levelInfo(8).meanSeconds, beta = clock.levelInfo(1).meanSeconds
    check(abs(h / lim.kMax - 2 * preon) < 1e-6 && abs(h / lim.kMin - 2.2 * beta) < 1e-3, "zoom from two Preons to 2.2 Betas on screen")
    let f = JournalWaveFrame(top: vectorA, k: 0.01)
    check(abs(f.t(f.y(vectorA - 5000)) - (vectorA - 5000)) < 1e-6 && f.y(vectorA - 100) > 0, "frame round trip; later is higher")
    let z = lim.zoom(JournalWaveFrame(top: vectorA, k: 0.001), by: 3, aboutY: 300, height: h)
    check(abs(z.t(300) - JournalWaveFrame(top: vectorA, k: 0.001).t(300)) < 1e-6 && abs(z.k - 0.003) < 1e-12, "zoom keeps the moment under the fingers")
    check(lim.zoom(f, by: 1e9, aboutY: 0, height: h).k == lim.kMax && lim.zoom(f, by: 1e-12, aboutY: 0, height: h).k == lim.kMin, "zoom stops at its limits")
    let up = lim.pan(JournalWaveFrame(top: vectorA, k: 0.001), by: 1e9, height: h)
    check(up.top <= vectorA + 0.25 * h / 0.001 + 1e-6, "scrolling stops a quarter screen past the newest moment")
    let down = lim.pan(JournalWaveFrame(top: vectorA, k: 0.001), by: -1e12, height: h)
    check(down.t(h) >= vectorA - 400 * 86_400 - 0.25 * h / 0.001 - 1e-3, "and a quarter screen past the oldest")
    let short = JournalWaveLimits(height: h, newest: vectorA, oldest: vectorA - 60)
    let s = short.clamp(JournalWaveFrame(top: vectorA - 1e6, k: 0.001), height: h)
    check(abs(s.top - (vectorA + 0.25 * h / 0.001)) < 1e-6, "a journal shorter than the screen keeps its newest near the top")
    let shown = lim.frame(showing: vectorA - 1e6, atY: 350, k: 0.0005, height: h)
    check(abs(shown.y(vectorA - 1e6) - 350) < 1e-6, "a frame can put a moment at a height")
}

// MARK: - Strands

private func strandChecks() {
    let h = 700.0, half = 160.0
    let lim = JournalWaveLimits(height: h, newest: vectorA, oldest: vectorA)
    let close = JournalWave.strands(k: lim.kMax, height: h, half: half)
    check(close.contains { $0.level == 8 && $0.weight > 0.99 } && !close.contains { $0.level == 10 } && !close.contains { $0.level <= 5 },
          "closest zoom: Preons in full, no Flavons, nothing coarse: \(close.map(\.level))")
    let wide = JournalWave.strands(k: lim.kMin, height: h, half: half)
    check(wide.contains { $0.level == 1 && $0.weight > 0.99 } && !wide.contains { $0.level >= 4 }, "widest zoom: Betas in full, nothing fine: \(wide.map(\.level))")
    for k in stride(from: log(lim.kMin), through: log(lim.kMax), by: 0.25).map(exp) {
        let ss = JournalWave.strands(k: k, height: h, half: half)
        let sum = ss.reduce(0) { $0 + $1.amplitude }
        let full = ss.filter { $0.weight > 0.99 }
        let nested = zip(full, full.dropFirst()).allSatisfy { $0.amplitude >= $1.amplitude - 1e-9 }
        let readable = ss.allSatisfy { $0.cyclePoints >= JournalWave.fadeIn.lowerBound && $0.cyclePoints <= JournalWave.fadeOut * 2.6 * h }
        check(!ss.isEmpty && ss.count <= 5 && sum <= 0.94 * half + 1e-9 && nested && readable,
              "k \(k): 1–5 readable levels, coarser swings wider, inside the column (\(ss.map(\.level)), \(sum))")
        check(zip(ss, ss.dropFirst()).allSatisfy { $0.level < $1.level }, "strands coarsest first")
    }
    // fine strands are true semicircles: radius a quarter of the cycle
    let mid = JournalWave.strands(k: lim.kMax / 3, height: h, half: 400)
    if let finest = mid.last, finest.weight > 0.99 {
        check(abs(finest.amplitude - finest.cyclePoints / 4) < 1e-6 || finest.amplitude < finest.cyclePoints / 4, "fine half-arcs are semicircles (or flatter)")
    }
    // the fade is continuous: a small zoom changes amplitudes a little
    var worst = 0.0
    for k in stride(from: log(lim.kMin), through: log(lim.kMax), by: 0.01).map(exp) {
        let a = JournalWave.strands(k: k, height: h, half: half), b = JournalWave.strands(k: k * 1.01, height: h, half: half)
        for s in a {
            let other = b.first { $0.level == s.level }?.amplitude ?? 0
            worst = max(worst, abs(other - s.amplitude))
        }
    }
    check(worst < 4, "amplitudes change smoothly with the zoom (worst step \(worst) points for 1 %)")
}

private func profileChecks() {
    check(abs(JournalWave.profile(0)) < 1e-12 && abs(JournalWave.profile(0.5)) < 1e-12, "the wave is on its axis at the start and the node")
    check(abs(JournalWave.profile(0.25) - 1) < 1e-12 && abs(JournalWave.profile(0.75) + 1) < 1e-12, "crest at the peak, trough at the valley")
    check(JournalWave.profile(0.1) > 0 && JournalWave.profile(0.6) < 0 && abs(JournalWave.profile(1.25) - 1) < 1e-12, "first half out, second in, periodic")
    // a semicircle: x² + (2u − 1)² = 1 over a half-cycle
    let u = 0.3
    check(abs(pow(JournalWave.profile(u / 2), 2) + pow(2 * u - 1, 2) - 1) < 1e-12, "half-arcs are semicircles")
    // the sum over strands at a cycle start of the finest is the coarser levels' alone
    let ss = JournalWave.strands(k: 0.05, height: 700, half: 160)
    if let p = clock.position(at: vectorA) {
        let x = JournalWave.offset(p, ss, through: ss.count - 1)
        check(abs(x) <= 0.94 * 160 + 1e-9, "the offset stays inside the column")
    }
}

// MARK: - Lines

private func lineChecks() {
    let h = 700.0
    for k in [0.0006, 0.004, 0.05, 0.6] {
        let frame = JournalWaveFrame(top: vectorA, k: k)
        let ss = JournalWave.strands(k: k, height: h, half: 160)
        guard let p0 = clock.position(at: frame.t(h)), let p1 = clock.position(at: frame.t(0)), !ss.isEmpty else {
            check(false, "positions for k \(k)")
            continue
        }
        let line = JournalWave.line(ss, through: ss.count - 1, from: p0, to: p1, x0: 200, y: frame.y)
        guard let first = line.first, let last = line.last else {
            check(false, "a line at k \(k)")
            continue
        }
        let maxStep = zip(line, line.dropFirst()).map { $1.y - $0.y }.max() ?? 0
        let monotonic = zip(line, line.dropFirst()).allSatisfy { $1.y >= $0.y - 1e-6 }
        check(first.y < 4 && abs(last.y - h) < 1e-3 && monotonic, "k \(k): the line runs top to bottom (\(first.y) … \(last.y))")
        check(maxStep < 4, "k \(k): sampled every few points at most (\(maxStep))")
        check(line.allSatisfy { abs($0.x - 200) <= 0.94 * 160 + 1e-6 }, "k \(k): inside the column")
        // the line goes through the wave's own offset at each sample
        let t = frame.t(h / 3)
        if let p = clock.position(at: t) {
            let x = 200 + JournalWave.offset(p, ss, through: ss.count - 1)
            let near = line.min { abs($0.y - h / 3) < abs($1.y - h / 3) }!
            check(abs(near.y - h / 3) < 4 && abs(near.x - x) < max(12, ss.last!.amplitude), "k \(k): the line passes its offset")
        }
    }
    check(JournalWave.line([], through: 0, from: 1, to: 2, x0: 0, y: { $0 }).isEmpty, "no strands, no line")
}

private func tickChecks() {
    let ss = JournalWave.strands(k: 0.002, height: 700, half: 160)
    guard let s = ss.first(where: { $0.level == 6 }) else { return check(false, "η strand at k 0.002: \(ss.map(\.level))") }
    let frame = JournalWaveFrame(top: vectorA, k: 0.002)
    guard let p0 = clock.position(at: frame.t(700)), let p1 = clock.position(at: frame.t(0)) else { return check(false, "positions") }
    let ticks = JournalWave.ticks(s, from: p0, to: p1)
    let starts = clock.boundaries(level: 6, from: frame.t(700), to: frame.t(0)).filter { $0.time >= frame.t(700) && $0.time <= frame.t(0) }
    check(ticks.count == starts.count && !ticks.isEmpty, "every Helion start in view: \(ticks.count) of \(starts.count)")
    let exact = zip(ticks.reversed(), starts).allSatisfy { abs($0.time - $1.time) < 1e-3 && $0.cycle == $1.idx }
    check(exact, "ticks are the engine's cycle starts")
    check(zip(ticks, ticks.dropFirst()).allSatisfy { $0.time > $1.time }, "latest first")
    check(JournalWave.frameLevel(ss, height: 700).map { $0.cyclePoints <= 1.6 * 700 } ?? false, "the framing level's cycles fit the screen")
    let utc = EarthFormatter(zone: "UTC")
    check(JournalWave.earthTick(vectorA, level: 2, earth: utc) == "Oct 2026" && JournalWave.earthTick(vectorA, level: 3, earth: utc) == "8 Oct 2026"
          && JournalWave.earthTick(vectorA, level: 6, earth: utc) == "Thu 8 Oct 12:00" && JournalWave.earthTick(vectorA, level: 8, earth: utc) == "12:00",
          "Earth labels by level: \(JournalWave.earthTick(vectorA, level: 6, earth: utc))")
}

// MARK: - Placement

private func placementChecks() {
    let size = 36.0, gap = 4.0, d = size + gap
    let frame = JournalWaveFrame(top: vectorA, k: 0.01)
    let straight: (Double) -> JournalWavePoint = { JournalWavePoint(x: 200, y: frame.y($0)) }
    let range = 40.0...380.0

    let apart = (0..<5).map { JournalWavePin(id: "a\($0)", time: vectorA - Double($0) * 10_000, symbol: "e:🌙") }
    let singles = JournalWavePlacer.place(apart, size: size, gap: gap, xRange: range, point: straight)
    check(singles.count == 5 && singles.allSatisfy { !$0.isCluster && !$0.isOffset }, "entries far apart sit on the wave")

    let three = (0..<3).map { JournalWavePin(id: "t\($0)", time: vectorA - 1000 - Double($0) * 300, symbol: "e:☕️") }
    let fan = JournalWavePlacer.place(three, size: size, gap: gap, xRange: range, point: straight)
    check(fan.count == 3 && fan.map(\.x) == [200, 200 + d, 200 - d] && fan.allSatisfy { !$0.isCluster }, "three close entries fan out beside the wave: \(fan.map(\.x))")
    check(fan[1].isOffset && fan[1].anchor.x == 200 && abs(fan[1].anchor.y - frame.y(three[1].time)) < 1e-9, "an offset badge keeps its wave point (for its tether)")

    let crowd = (0..<7).map { JournalWavePin(id: "c\($0)", time: vectorA - 2000 - Double($0), symbol: "e:\($0)") }
    let cluster = JournalWavePlacer.place(crowd, size: size, gap: gap, xRange: range, point: straight)
    check(cluster.count == 3 && cluster.reduce(0) { $0 + $1.ids.count } == 7 && cluster.contains { $0.isCluster },
          "a crowd becomes three badges, some of them clusters: \(cluster.map(\.ids.count))")
    check(cluster.first?.symbol == "e:0" && cluster.first?.ids.first == "c0", "a cluster shows its newest entry")

    // near the edge the fan stays inside the column
    let edge: (Double) -> JournalWavePoint = { JournalWavePoint(x: 50, y: frame.y($0)) }
    let atEdge = JournalWavePlacer.place(three, size: size, gap: gap, xRange: range, point: edge)
    check(atEdge.allSatisfy { $0.x >= range.lowerBound + size / 2 && $0.x <= range.upperBound - size / 2 }, "badges stay inside the column")

    // hundreds of entries on a real wave: no two badges overlap, every entry is in exactly one badge
    let k = 0.004
    let wave = JournalWaveFrame(top: vectorA, k: k)
    let ss = JournalWave.strands(k: k, height: 700, half: 160)
    let point: (Double) -> JournalWavePoint = { t in
        JournalWavePoint(x: 210 + JournalWave.offset(clock.position(at: t) ?? 0, ss, through: ss.count - 1), y: wave.y(t))
    }
    var rng: UInt64 = 0x9E37_79B9
    func random() -> Double {
        rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17
        return Double(rng % 1_000_000) / 1_000_000
    }
    var t = vectorA
    var pins: [JournalWavePin] = []
    for i in 0..<400 {
        t -= random() < 0.3 ? random() * 300 : random() * 9000
        pins.append(JournalWavePin(id: "r\(i)", time: t, symbol: "e:x"))
    }
    let placed = JournalWavePlacer.place(pins, size: size, gap: gap, xRange: 50...370, point: point)
    var overlap = false
    for i in placed.indices {
        for j in placed.indices where j > i && placed[j].y - placed[i].y < d {
            if hypot(placed[i].x - placed[j].x, placed[i].y - placed[j].y) < d - 1e-6 { overlap = true }
        }
    }
    let ids = placed.flatMap(\.ids)
    check(!overlap, "no two badges overlap")
    check(ids.count == pins.count && Set(ids) == Set(pins.map(\.id)), "every entry in exactly one badge (\(placed.count) badges for \(pins.count))")
    check(placed.contains { $0.isCluster } && placed.contains { $0.isOffset }, "a busy journal has clusters and fanned badges")
    // zooming in opens clusters
    let close = 0.2
    let wave2 = JournalWaveFrame(top: vectorA, k: close)
    let placed2 = JournalWavePlacer.place(Array(pins.prefix(30)), size: size, gap: gap, xRange: 50...370) { t in
        JournalWavePoint(x: 210, y: wave2.y(t))
    }
    let clustered1 = JournalWavePlacer.place(Array(pins.prefix(30)), size: size, gap: gap, xRange: 50...370, point: point).filter(\.isCluster).count
    check(placed2.filter(\.isCluster).count <= clustered1, "closer, fewer clusters (\(placed2.filter(\.isCluster).count) ≤ \(clustered1))")

    // hits
    let hit = JournalWavePlacer.hit(fan, x: 200 + d + 5, y: fan[1].y + 3, radius: size / 2 + 6)
    check(hit?.ids == ["t1"], "a tap finds the badge under it")
    check(JournalWavePlacer.hit(fan, x: 0, y: 0, radius: 24) == nil, "a tap beside every badge finds none")

    // the zoom that opens a cluster, or none when the entries share a moment
    if let c = cluster.first(where: \.isCluster) {
        let need = JournalWavePlacer.separatingK(c, size: size, gap: gap, kMax: 1e9)
        check(need.map { $0 > frame.k } ?? false, "opening a cluster zooms in: \(String(describing: need))")
        check(JournalWavePlacer.separatingK(c, size: size, gap: gap, kMax: 0.0001) == nil, "beyond the closest zoom: none")
    }
    let same = JournalWaveBadge(x: 0, y: 0, anchor: JournalWavePoint(x: 0, y: 0), ids: ["a", "b"], times: [5, 5], symbol: "")
    check(JournalWavePlacer.separatingK(same, size: size, gap: gap, kMax: 1) == nil, "entries at the same moment cannot be zoomed apart")
}
