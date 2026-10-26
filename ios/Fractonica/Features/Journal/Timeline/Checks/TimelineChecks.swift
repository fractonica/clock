import FractonicaKit
import Foundation

// The journal timeline's zoom and wave: periods (grouping, emoji and pictures, sections, words), the pinch's steps, the
// wave's frame and limits, its arc geometry (the spine and its band at every zoom, regular arcs of one radius joining
// smoothly, children perpendicular to their parent, emoji exactly on the curve, no jump anywhere across the zoom), the
// cycle starts, and the emoji placement (fanning, clusters, hits, the zoom that opens a cluster).
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
        arcZoomChecks()
        spineChecks()
        perpendicularChecks()
        onCurveChecks()
        continuityChecks()
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
    check(pinch.step(0.9) == 0 && pinch.step(1.1) == 0 && pinch.step(0.7) == 0, "a wobble steps nowhere")
    check(pinch.step(0.62) == 1, "closing the fingers steps out")
    check(pinch.step(0.5) == 0 && pinch.step(0.62 * 0.62) == 1, "a long pinch steps out again from where it last stepped")
    check(pinch.step(0.3844 * 1.4) == 0 && pinch.step(0.3844 * 1.55) == -1, "opening the fingers steps back in")
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

// MARK: - The arc geometry

private let radius = 105.0
private let axis = 210.0

/// Every zoom of the wave, from the widest to the closest, in small steps.
private func zooms(height h: Double = 700, step: Double = 0.02) -> [Double] {
    let lim = JournalWaveLimits(height: h, newest: vectorA, oldest: vectorA)
    return stride(from: log(lim.kMin), through: log(lim.kMax), by: step).map(exp) + [lim.kMax]
}

private func layout(_ k: Double, top: Double = vectorA + 300_000_000) -> (JournalArcLayout, JournalWaveFrame) {
    let f = JournalWaveFrame(top: min(top, vectorA + 350 / k), k: k)
    return (JournalArcLayout(zoom: JournalArcs.zoom(k: k, radius: radius), x0: axis, y: f.y), f)
}

private func near(_ a: WavePoint, _ b: WavePoint, _ eps: Double) -> Bool { hypot(a.x - b.x, a.y - b.y) < eps }

private func arcChecks(_ a: WaveArc, _ name: String) -> Bool {
    // every point of a WaveArc is on its circle by construction; what can go wrong is a degenerate one
    a.radius.isFinite && a.radius > 0 && abs(a.sweep) > 0 && abs(a.sweep) < 2 * .pi
}

private func arcZoomChecks() {
    let lim = JournalWaveLimits(height: 700, newest: vectorA, oldest: vectorA)
    let c0 = 2 * radius
    var spines = Set<Int>()
    var ok = true, okWeights = true
    for k in zooms() {
        let z = JournalArcs.zoom(k: k, radius: radius)
        spines.insert(z.spine)
        let m = Double(clock.levelInfo(z.spine).factor)
        // the band: the spine's chord between one and `factor` diameters, its children's under one
        ok = ok && z.lambda >= 0 && z.lambda < 1 && z.sweep > 0 && z.sweep <= .pi + 1e-12
            && z.chord(z.spine + 1) < c0 && (z.spine == 0 || z.chord(z.spine) >= c0 - 1e-9) && z.chord(z.spine) < m * c0
            && abs(z.chord(z.spine) / z.chord(z.spine + 1) - m) < 1e-6
        okWeights = okWeights && abs(z.weight(z.spine + 1) - JournalArcs.depthOpacity(1 - z.lambda) * JournalArcs.smoothstep(1.5, 7, z.chord(z.spine + 1))) < 1e-12
            && z.drawn.first.map { $0 >= z.spine } ?? false && !z.drawn.isEmpty && z.drawn.count <= 4
    }
    check(ok, "every zoom: the spine's chord lies within its band, its children's below one diameter")
    check(okWeights, "every zoom draws one to four levels from the spine down")
    check(spines.contains(8) == false && spines.contains(7) && spines.contains(0), "the spines run from α (widest) to θ (closest): \(spines.sorted())")
    // sweep: a semicircle at the start of a band, opening towards a straight line at its end, monotonically
    for m in [4, 5, 7, 9, 11, 13] {
        let s = stride(from: 0.0, through: 1, by: 0.05).map { JournalArcs.sweep(lambda: $0, factor: m) }
        check(abs(s[0] - .pi) < 1e-12 && s.last! <= JournalArcs.minSweep * 1.0001 && zip(s, s.dropFirst()).allSatisfy { $0 > $1 - 1e-15 },
              "m \(m): sweep π → 0 through the band")
        // the bulge plus the children's loops stay within the radius (plus one child loop at the start of the band)
        let worst = stride(from: 0.0, through: 1, by: 0.01).map { l -> Double in
            let c = c0 * pow(Double(m), l)
            let bulge = c / 2 * tan(JournalArcs.sweep(lambda: l, factor: m) / 4)
            return (bulge + c / Double(m) / 2) / radius
        }.max()!
        check(worst <= 1 + 1 / Double(m) + 1e-9, "m \(m): the spine and its loops stay within the radius (\(worst))")
    }
    // the depth curve and widths are continuous
    let ds = stride(from: -1.5, through: 3.5, by: 0.001)
    check(zip(ds, ds.dropFirst()).allSatisfy { abs(JournalArcs.depthOpacity($0) - JournalArcs.depthOpacity($1)) < 0.003 && abs(JournalArcs.depthWidth($0) - JournalArcs.depthWidth($1)) < 0.003 },
          "a level's opacity and width change continuously with its depth")
    check(JournalArcs.depthOpacity(0) == 1 && JournalArcs.depthOpacity(-1) == 0 && JournalArcs.depthOpacity(3) == 0, "the spine full, gone when straight and at depth 3")
    _ = lim
}

private func spineChecks() {
    var regular = true, smooth = true, sides = true, chords = true
    for k in zooms(step: 0.15) {
        let (lay, f) = layout(k)
        let z = lay.zoom
        guard let s = lay.spineHalf(at: f.t(350)) else { return check(false, "spine at k \(k)") }
        let pp = clock.levelInfo(z.spine).prefixDouble
        var prev: WaveArc?
        for h in (s.idx - 2)...(s.idx + 2) {
            guard let a = lay.spine(h) else { continue }
            let t0 = clock.time(atPosition: 2 * Double(h) / pp), t1 = clock.time(atPosition: 2 * Double(h + 1) / pp)
            // its chord is its stretch of time on the axis, its sweep the zoom's: a regular arc of the radius that chord asks
            chords = chords && near(a.point(0), WavePoint(x: axis, y: f.y(t0)), 1e-6 * max(1, a.radius)) && near(a.point(1), WavePoint(x: axis, y: f.y(t1)), 1e-6 * max(1, a.radius))
            let c = (t1 - t0) * k
            regular = regular && abs(abs(a.sweep) - z.sweep) < 1e-12 && abs(a.radius - c / (2 * sin(z.sweep / 2))) < 1e-9 * a.radius
            // samples all at that radius from the centre
            for u in stride(from: 0.0, through: 1, by: 0.125) {
                let p = a.point(u)
                regular = regular && abs(hypot(p.x - a.cx, p.y - a.cy) - a.radius) < 1e-9 * a.radius
            }
            // crests (moving up the screen, later is higher) bulge left, troughs right
            let mid = a.point(0.5)
            sides = sides && (h % 2 == 0 ? mid.x < axis : mid.x > axis) && a.point(0.25).y > a.point(0.75).y
            // the arcs join smoothly at the nodes
            if let prev {
                let t = prev.tangent(1), u = a.tangent(0)
                smooth = smooth && abs(t.x * u.y - t.y * u.x) < 1e-6 && t.x * u.x + t.y * u.y > 0
            }
            prev = a
        }
    }
    check(chords, "spine arcs span their time on the axis")
    check(regular, "spine arcs are regular: every one the zoom's sweep, its radius from its chord (no squashing)")
    check(sides, "crests bulge left, troughs right, later moments higher")
    check(smooth, "consecutive spine arcs join with one tangent")
    // the aspect is the zoom's alone: a taller screen shows more arcs, each the same shape
    let a = JournalArcs.spineArc(from: 300, to: 0, x0: 0, sweep: 1.2, crest: true)
    let b = JournalArcs.spineArc(from: 700, to: 100, x0: 0, sweep: 1.2, crest: true)
    check(abs((a.point(0.5).x) / 300 - (b.point(0.5).x) / 600) < 1e-12, "an arc's bulge is a fixed share of its chord at a zoom")
}

private func perpendicularChecks() {
    var perpendicular = true, onParent = true, smooth = true, alternate = true, count = 0
    for k in zooms(step: 0.2) {
        let (lay, f) = layout(k)
        let z = lay.zoom
        let arcs = lay.arcs(from: f.t(700), to: f.t(0), through: z.spine + 2, yRange: -50...750)
        guard arcs.count == 3 else { return check(false, "three levels of arcs at k \(k)") }
        for depth in 1...2 {
            let level = z.spine + depth
            let m = clock.levelInfo(level - 1).factor
            let parents = Dictionary(arcs[depth - 1].map { ($0.idx, $0.arc) }, uniquingKeysWith: { a, _ in a })
            var prev: JournalArc?
            for c in arcs[depth].prefix(200) {
                guard let p = parents[c.idx / Int64(m)] else { continue }
                count += 1
                let j = Double(c.idx % Int64(m))
                // it starts and ends on its parent, at its stretch of it
                onParent = onParent && near(c.arc.point(0), p.point(j / Double(m)), 1e-6 * max(1, p.radius))
                    && near(c.arc.point(1), p.point((j + 1) / Double(m)), 1e-6 * max(1, p.radius))
                // and leaves and rejoins it at right angles
                for (u, v) in [(0.0, j / Double(m)), (1.0, (j + 1) / Double(m))] {
                    let a = c.arc.tangent(u), b = p.tangent(v)
                    perpendicular = perpendicular && abs(a.x * b.x + a.y * b.y) < 1e-6
                }
                // the loops alternate sides of their parent (on a crest the crests loop out past it and the troughs
                // dip back in, the other way round on a trough); across a node the parent itself turns the other way,
                // so its last loop and the next one's first lie on one side
                let apex = c.arc.point(0.5)
                let out = hypot(apex.x - p.cx, apex.y - p.cy) > p.radius
                alternate = alternate && out == ((c.idx % 2 == 0) == (p.sweep > 0))
                if let prev, prev.idx + 1 == c.idx {
                    let pa = prev.arc.point(0.5)
                    if prev.idx / Int64(m) == c.idx / Int64(m) {
                        alternate = alternate && (hypot(pa.x - p.cx, pa.y - p.cy) > p.radius) != out
                    }
                    let t = prev.arc.tangent(1), u = c.arc.tangent(0)
                    smooth = smooth && t.x * u.x + t.y * u.y > 1 - 1e-6
                }
                prev = c
            }
        }
    }
    check(count > 500, "children checked: \(count)")
    check(onParent, "each loop starts and ends on its parent arc, at its share of it")
    check(perpendicular, "each loop leaves and rejoins its parent perpendicularly")
    check(alternate, "loops alternate sides of the curve they ride (crest out, trough in)")
    check(smooth, "a level's loops join with one tangent")
}

private func onCurveChecks() {
    var onArc = true, drawnToo = true, ordered = true, nodes = true
    for k in zooms(step: 0.3) {
        let (lay, f) = layout(k)
        let z = lay.zoom
        let arcs = lay.arcs(from: f.t(760), to: f.t(-60), through: z.deepest, yRange: -60...760)
        let deepest = Dictionary((arcs.last ?? []).map { ($0.idx, $0.arc) }, uniquingKeysWith: { a, _ in a })
        for i in 0..<40 {
            let t = f.t(Double(i) * 17 + 3)
            let chain = lay.trace(t)
            guard let last = chain.last, let p = lay.point(t) else { onArc = false; continue }
            // the emoji's point is on the deepest level's arc, at the moment's progress through it
            onArc = onArc && chain.count == 4 && last.arc.level == z.deepest && last.local >= 0 && last.local <= 1
                && abs(hypot(p.x - last.arc.arc.cx, p.y - last.arc.arc.cy) - last.arc.arc.radius) < 1e-6 * max(1, last.arc.arc.radius)
            // …which is the very arc the canvas draws
            if let drawn = deepest[last.arc.idx] { drawnToo = drawnToo && drawn == last.arc.arc } else { drawnToo = false }
            // a little later is a little further along
            if let q = lay.trace(t + 1e-3 / k).last, q.arc.idx == last.arc.idx { ordered = ordered && q.local > last.local }
        }
        // a spine half-arc's start is a node on the axis, for any of its moments' chains
        if let s = lay.spineHalf(at: f.t(350)) {
            let t0 = clock.time(atPosition: 2 * Double(s.idx + 1) / clock.levelInfo(z.spine).prefixDouble)
            if let p = lay.point(t0 + 1e-6, through: z.spine) { nodes = nodes && abs(p.x - axis) < 1e-3 }
        }
    }
    check(onArc, "an emoji's point lies exactly on the deepest level's arc")
    check(drawnToo, "and on the arc drawn")
    check(ordered, "moments advance along the arc")
    check(nodes, "half-arc starts are nodes on the axis")
}

private func continuityChecks() {
    // zooming by a hair moves every moment's point by a hair, across every band boundary
    let ts = (0..<60).map { vectorA - Double($0) * 7919.3 }
    var worst = 0.0, worstK = 0.0
    var spineChanges = 0
    var last: Int?
    for k in zooms(step: 0.004) {
        let k2 = k * 1.0001
        let a = JournalArcs.zoom(k: k, radius: radius), b = JournalArcs.zoom(k: k2, radius: radius)
        if let l = last, l != a.spine { spineChanges += 1 }
        last = a.spine
        // the frames share the moment at the top, so the zoom alone moves points
        let fa = JournalWaveFrame(top: vectorA + 20, k: k), fb = JournalWaveFrame(top: vectorA + 20, k: k2)
        let la = JournalArcLayout(zoom: a, x0: axis, y: fa.y), lb = JournalArcLayout(zoom: b, x0: axis, y: fb.y)
        for t in ts where fa.y(t) < 900 {
            guard let p = la.point(t), let q = lb.point(t) else { continue }
            let d = hypot(p.x - q.x, p.y - q.y)
            if d > worst { worst = d; worstK = k }
        }
        for level in max(0, a.spine - 1)...(a.spine + 4) {
            let wa = a.levels.contains(level) ? a.weight(level) : 0, wb = b.levels.contains(level) ? b.weight(level) : 0
            if abs(wa - wb) > 0.01 { worst = max(worst, 99); worstK = k }
        }
    }
    check(spineChanges >= 6, "the spine passes level to level across the zoom (\(spineChanges) changes)")
    check(worst < 1.5, "no jump: a 0.01 % zoom moves any emoji's point under 1.5 points and any level's weight under 0.01 (worst \(worst) at k \(worstK))")
}

private func tickChecks() {
    let k = 0.002
    let frame = JournalWaveFrame(top: vectorA, k: k)
    guard let p0 = clock.position(at: frame.t(700)), let p1 = clock.position(at: frame.t(0)) else { return check(false, "positions") }
    let ticks = JournalArcs.ticks(level: 6, from: p0, to: p1)
    let starts = clock.boundaries(level: 6, from: frame.t(700), to: frame.t(0)).filter { $0.time >= frame.t(700) && $0.time <= frame.t(0) }
    check(ticks.count == starts.count && !ticks.isEmpty, "every Helion start in view: \(ticks.count) of \(starts.count)")
    let exact = zip(ticks.reversed(), starts).allSatisfy { abs($0.time - $1.time) < 1e-3 && $0.cycle == $1.idx }
    check(exact, "ticks are the engine's cycle starts")
    check(zip(ticks, ticks.dropFirst()).allSatisfy { $0.time > $1.time }, "latest first")
    for k in zooms(step: 0.3) {
        let z = JournalArcs.zoom(k: k, radius: radius)
        if let l = JournalArcs.frameLevel(z, height: 700) {
            check(l <= z.spine && clock.levelInfo(l).meanSeconds * k <= 1.6 * 700, "k \(k): the framing level lies on the axis and fits the screen")
        }
    }
    let utc = EarthFormatter(zone: "UTC")
    check(JournalArcs.earthTick(vectorA, level: 2, earth: utc) == "Oct 2026" && JournalArcs.earthTick(vectorA, level: 3, earth: utc) == "8 Oct 2026"
          && JournalArcs.earthTick(vectorA, level: 6, earth: utc) == "Thu 8 Oct 12:00" && JournalArcs.earthTick(vectorA, level: 8, earth: utc) == "12:00",
          "Earth labels by level: \(JournalArcs.earthTick(vectorA, level: 6, earth: utc))")
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
    let layout = JournalArcLayout(zoom: JournalArcs.zoom(k: k, radius: 105), x0: 210, y: wave.y)
    let point: (Double) -> JournalWavePoint = { layout.point($0)! }
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
    let placed = JournalWavePlacer.place(pins, size: size, gap: gap, xRange: 50...370, slack: 105, point: point)
    var overlap = false
    for i in placed.indices {
        for j in placed.indices where j > i && abs(placed[j].y - placed[i].y) < d {
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
    let clustered1 = JournalWavePlacer.place(Array(pins.prefix(30)), size: size, gap: gap, xRange: 50...370, slack: 105, point: point).filter(\.isCluster).count
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
