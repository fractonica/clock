import FractonicaKit
import Foundation

// The timeline's logic against the web app: the pure ruler (src/ui/timeline/ruler.js) and the Gregorian axis
// (src/ui/timeline/helpers.js) compared with fixture.json (make-fixture.mjs runs the JavaScript), plus the window maths,
// the layout, the viewport's motion and follow rules, the block cache against exact readings, and a pure-mode leak scan
// of the canvas wording. Run: ios/scripts/check.sh ios/Fractonica/Features/Timeline/Checks

@main @MainActor
struct TimelineChecks {
    static func main() async {
        let fixture = loadFixture()
        rulerChecks(fixture)
        gregorianChecks(fixture)
        geometryChecks()
        layoutChecks()
        viewportChecks()
        dataChecks()
        wordingChecks()
        webWordingChecks(fixture)
        Checks.finish()
    }
}

private typealias JSON = [String: Any]

private func loadFixture() -> JSON {
    let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("fixture.json")
    guard let data = try? Data(contentsOf: url), let json = try? JSONSerialization.jsonObject(with: data) as? JSON else {
        check(false, "fixture.json is missing: run node ios/Fractonica/Features/Timeline/Checks/make-fixture.mjs")
        Checks.finish()
    }
    return json
}

private func d(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? .nan }
private func close(_ a: Double, _ b: Double, _ tol: Double = 1e-6) -> Bool {
    a == b || abs(a - b) <= tol * max(1, abs(b) * 1e-9)
}

private func compareTicks(_ got: [TimelineTick], _ want: [JSON], _ count: Int, _ what: String) -> Bool {
    guard got.count == count else {
        check(false, "\(what): \(got.count) ticks, the web has \(count)")
        return false
    }
    for (i, w) in want.enumerated() {
        let g = got[i]
        let labels = w["labels"] as? [String] ?? []
        guard close(g.t, d(w["t"])), g.labels == labels, g.major == (w["major"] as? Bool ?? false) else {
            check(false, "\(what) tick \(i): \(g.t) \(g.labels) \(g.major), the web has \(d(w["t"])) \(labels) \(w["major"] ?? "-")")
            return false
        }
    }
    return true
}

private func compareSpans(_ got: [TimelineSpan], _ want: [JSON], _ count: Int, _ what: String, ord: Bool = true) -> Bool {
    guard got.count == count else {
        check(false, "\(what): \(got.count) spans, the web has \(count)")
        return false
    }
    for (i, w) in want.enumerated() {
        let g = got[i]
        let labels = w["labels"] as? [String] ?? []
        guard close(g.t0, d(w["t0"])), close(g.t1, d(w["t1"])), g.labels == labels, !ord || Double(g.ord) == d(w["ord"]) else {
            check(false, "\(what) span \(i): \(g.t0)…\(g.t1) \(g.labels) \(g.ord), the web has \(d(w["t0"]))…\(d(w["t1"])) \(labels) \(w["ord"] ?? "-")")
            return false
        }
    }
    return true
}

// MARK: - Pure ruler

@MainActor
private func rulerChecks(_ fx: JSON) {
    let ruler = TimelineRuler()
    check(ruler.steps.map(\.id) == (fx["steps"] as? [String] ?? []), "the ruler's steps are the web's: \(ruler.steps.map(\.id))")

    var bad = 0
    for p in fx["pick"] as? [JSON] ?? [] {
        let got = ruler.pick(pxPerSec: d(p["k"]), plotWidth: d(p["w"])).id
        if got != p["id"] as? String {
            bad += 1
            if bad < 4 { check(false, "pickStep(\(d(p["k"])), \(d(p["w"]))) = \(got), the web picks \(p["id"] ?? "-")") }
        }
    }
    check(bad == 0, "every step pick matches the web (\(bad) differ)")

    var ok = 0, sets = 0
    for set in fx["ticks"] as? [JSON] ?? [] {
        sets += 1
        guard let id = set["step"] as? String, let step = ruler.step(id: id) else {
            check(false, "unknown step \(set["step"] ?? "-")")
            continue
        }
        let got = ruler.ticks(step, from: d(set["t0"]), to: d(set["t1"]))
        if compareTicks(got, set["ticks"] as? [JSON] ?? [], Int(d(set["count"])), "ticks \(id) \(d(set["t0"]))") { ok += 1 }
    }
    check(ok == sets && sets > 100, "ruler ticks match the web in \(ok) of \(sets) windows")
    print("ruler: \(sets) tick sets compared")

    ok = 0
    sets = 0
    for set in fx["context"] as? [JSON] ?? [] {
        sets += 1
        guard let id = set["step"] as? String, let step = ruler.step(id: id) else { continue }
        let got = ruler.context(step, from: d(set["t0"]), to: d(set["t1"]))
        if compareSpans(got, set["spans"] as? [JSON] ?? [], Int(d(set["count"])), "context \(id) \(d(set["t0"]))") { ok += 1 }
    }
    check(ok == sets && sets > 50, "ruler context rows match the web in \(ok) of \(sets) windows")
    print("ruler: \(sets) context rows, \((fx["flags"] as? [JSON])?.count ?? 0) flags, \((fx["presets"] as? [JSON])?.count ?? 0) presets, \((fx["pick"] as? [JSON])?.count ?? 0) step picks compared")

    bad = 0
    for f in fx["flags"] as? [JSON] ?? [] {
        let t = d(f["t"])
        if let rel = f["rel"] as? String {
            let got = ruler.relText(t, to: 1791460800)
            if got != rel { bad += 1; check(false, "relText(\(t)) = \(got), the web says \(rel)") }
        } else {
            let got = ruler.flagText(t, u: Int(d(f["u"])))
            if got != f["text"] as? String { bad += 1; check(false, "flagText(\(t), \(d(f["u"]))) = \(got), the web says \(f["text"] ?? "-")") }
        }
    }
    check(bad == 0, "flags and relative texts match the web")

    bad = 0
    for r in fx["range"] as? [JSON] ?? [] {
        let got = ruler.rangeText(d(r["t0"]), d(r["t1"]), to: Int(d(r["u"])))
        if got != r["text"] as? String { bad += 1; if bad < 4 { check(false, "rangeText = \(got), the web says \(r["text"] ?? "-")") } }
    }
    for s in fx["span"] as? [JSON] ?? [] {
        let got = ruler.spanText(d(s["t0"]), d(s["t1"]), parts: 2, slack: 0.5 / 342)
        let plain = ruler.spanText(d(s["t0"]), d(s["t1"]), parts: 1)
        if got != s["text"] as? String || plain != s["plain"] as? String {
            bad += 1
            if bad < 4 { check(false, "spanText = \(got) / \(plain), the web says \(s["text"] ?? "-") / \(s["plain"] ?? "-")") }
        }
    }
    check(bad == 0, "window ranges and spans read as on the web")

    let lim = TimelineLimits(tMin: FractonicaClock.shared.tMin, tMax: FractonicaClock.shared.tMax)
    bad = 0
    for p in fx["presets"] as? [JSON] ?? [] {
        guard let id = p["id"] as? String else { continue }
        let w = ruler.presetWindow(id, limits: lim, anchor: d(p["t"]), frac: 0.3)
        let active = ruler.activePreset(span: w.span, limits: lim, at: w.c)
        if !close(w.c, d(p["c"]), 1e-3) || !close(w.span, d(p["span"]), 1e-3) || active != p["active"] as? String {
            bad += 1
            if bad < 4 { check(false, "preset \(id) at \(d(p["t"])): \(w) \(active ?? "-"), the web has c \(d(p["c"])) span \(d(p["span"])) \(p["active"] ?? "-")") }
        }
    }
    check(bad == 0, "preset windows match the web")
}

// MARK: - Gregorian axis

@MainActor
private func gregorianChecks(_ fx: JSON) {
    check(GregorianStep.all.map(\.id) == (fx["gregSteps"] as? [String] ?? []), "the Gregorian steps are the web's")
    var bad = 0
    for p in fx["gregPick"] as? [JSON] ?? [] {
        if GregorianStep.pick(pxPerSec: d(p["k"])).id != p["id"] as? String { bad += 1 }
    }
    check(bad == 0, "Gregorian step picks match the web (\(bad) differ)")
    var ok = 0, sets = 0
    for set in fx["greg"] as? [JSON] ?? [] {
        sets += 1
        guard let zone = set["zone"] as? String, let id = set["step"] as? String,
              let step = GregorianStep.all.first(where: { $0.id == id }) else { continue }
        let fmt = EarthFormatter(zone: zone)
        let t0 = d(set["t0"]), t1 = d(set["t1"])
        let what = "\(zone) \(id) \(t0)"
        let ticks = GregorianAxis.ticks(step, from: t0, to: t1, fmt)
        let wantTicks = set["ticks"] as? [JSON] ?? []
        guard compareTicks(Array(ticks.prefix(wantTicks.count)), wantTicks, wantTicks.count, what) else { continue }
        let ctx = GregorianAxis.context(step, from: t0, to: t1, fmt)
        let wantCtx = set["context"] as? [JSON] ?? []
        guard compareSpans(Array(ctx.prefix(wantCtx.count)), wantCtx, wantCtx.count, "context " + what) else { continue }
        let wantDays = set["days"] as? [JSON] ?? []
        if !wantDays.isEmpty {
            let days = GregorianAxis.spans(.day, from: t0, to: t1, fmt)
            guard compareSpans(Array(days.prefix(wantDays.count)), wantDays, wantDays.count, "days " + what, ord: false) else { continue }
        }
        ok += 1
    }
    check(ok == sets && sets > 200, "Gregorian ticks, context rows and days match the web in \(ok) of \(sets) windows (4 zones, DST days)")
    print("gregorian: \(sets) windows in 4 zones compared")

    // DST: an hour step across Berlin's 2026-10-25 change shows 02:00 twice, and the day is 25 h long
    let berlin = EarthFormatter(zone: "Europe/Berlin")
    let fallBack = 1_792_886_400.0 // 2026-10-25 00:00 UTC
    let hours = GregorianAxis.ticks(GregorianStep(unit: .h, n: 1), from: fallBack - 2 * 3600, to: fallBack + 4 * 3600, berlin)
    check(hours.filter { $0.labels.first == "02:00" }.count == 2, "the repeated hour reads 02:00 twice: \(hours.map { $0.labels[0] })")
    let day = GregorianAxis.spans(.day, from: fallBack, to: fallBack + 3600, berlin).first
    check(day?.labels.first?.hasSuffix("· 25 h") == true, "a fall-back day says it lasts 25 h: \(day?.labels.first ?? "-")")
}

// MARK: - Window maths

private func geometryChecks() {
    let clock = FractonicaClock.shared
    let lim = TimelineLimits(tMin: clock.tMin, tMax: clock.tMax)
    let w = TimelineWindow(c: 1_791_460_800, span: 86_400)
    let z = lim.zoom(w, by: 0.5, at: 0.3)
    check(close(z.t0 + 0.3 * z.span, w.t0 + 0.3 * w.span, 1e-6) && close(z.span, 43_200), "a zoom keeps the anchored instant in place")
    check(lim.clamp(TimelineWindow(c: 0, span: 1e-3)).span == lim.minSpan, "the narrowest window is about two seconds")
    check(lim.clamp(TimelineWindow(c: 0, span: 1e12)).span == lim.maxSpan, "the widest window is the catalogue with its margins")
    let far = lim.clamp(TimelineWindow(c: -1e12, span: 3600))
    check(close(far.t0, lim.d0), "a window cannot leave the catalogue's margins: \(far)")
    let fit = lim.fit(100, 200, margin: 0.1)
    check(close(fit.c, 150) && close(fit.span, 120), "fit shows a range with its margins")

    let a = TimelineWindow(c: 1e9, span: 1e6), b = TimelineWindow(c: 1e9 + 2e5, span: 1e3)
    let i0 = TimelineTween.interpolate(a, b, 0), i1 = TimelineTween.interpolate(a, b, 1)
    check(close(i0.c, a.c) && close(i0.span, a.span) && close(i1.c, b.c, 1e-3) && close(i1.span, b.span, 1e-6), "a transition starts and ends at its windows")
    let p = (b.c * a.span - a.c * b.span) / (a.span - b.span)
    let mid = TimelineTween.interpolate(a, b, 0.5)
    check(close((p - a.t0) / a.span, (p - mid.t0) / mid.span, 1e-9), "a transition keeps the shared point still on screen")
    check(TimelineTween.coastDuration(v: 100, pxPerSecond: 0.01) == 0, "a slow flick does not coast")
    let v = 1000.0
    check(abs(TimelineTween.coast(v: v, elapsed: 100) - v / TimelineTween.inertiaDecay) < 1e-6, "a coast travels v / decay in all")

    let deep = TimelineScale(window: TimelineWindow(c: 1_791_460_800.25, span: 2), x0: 54, width: 342)
    let t = 1_791_460_800.731
    check(abs(deep.t(deep.x(t)) - t) < 1e-6, "time ↔ x is exact to the microsecond in a two-second window")
    check(TimelineSearch.nearest([1, 5, 9], 6, within: 1.5) == 1 && TimelineSearch.nearest([1, 5, 9], 7, within: 1) == nil, "nearest within a tolerance")
    check(TimelineSearch.lastAtOrBefore([1.0, 5, 9], 5) { $0 } == 1 && TimelineSearch.lastAtOrBefore([1.0, 5, 9], 0) { $0 } == -1, "last at or before")
}

private func layoutChecks() {
    let phone = TimelineLayout(width: 402, height: 1050, lanes: 10)
    check(phone.compact && phone.showsOverview && phone.laneH >= 30 && phone.laneH <= TimelineLayout.maxLane(compact: true), "an iPhone in portrait shows the map and roomy lanes: \(phone.laneH)")
    check(phone.bottom <= phone.height + 0.5, "everything fits in portrait: \(phone.bottom) of \(phone.height)")
    let land = TimelineLayout(width: 800, height: 260, lanes: 10)
    check(!land.showsOverview && land.laneH >= 14, "a short landscape canvas gives up the map before the lanes: \(land.laneH)")
    let pad = TimelineLayout(width: 1100, height: 900, lanes: 14)
    check(!pad.compact && pad.gutter > phone.gutter, "an iPad gets the wide gutter")
    check(phone.region(x: 10, y: phone.laneY(3) + 2) == (.lane(3), true), "a lane head is the gutter of its lane")
    check(phone.region(x: 200, y: phone.eclipseY + 5).region == .eclipse, "the eclipse lane is below the lanes")
    check(phone.region(x: 200, y: phone.overviewY + 5).region == .overview, "the map is on top")
}

// MARK: - Viewport

@MainActor
private func viewportChecks() {
    let clock = FractonicaClock.shared
    let vp = TimelineViewport()
    vp.plotX0 = 54
    vp.plotWidth = 342
    let t = 1_791_460_800.0
    vp.placeIfNeeded(cursor: t, selectedLevel: 6, follow: true)
    check(vp.follow && close(vp.base.c, t) && close(vp.base.span, clock.levelInfo(6).meanSeconds * 8), "the first window holds about eight cycles of the selected depth, following")
    // follow keeps the cursor in the middle whatever the base window says
    let later = t + 5000
    check(close(vp.window(at: .now, cursor: later, cursorIn: true).c, later), "Follow centres the cursor")
    vp.beginGesture(cursor: later, cursorIn: true, pinch: false)
    check(!vp.follow, "a drag turns Follow off")
    let before = vp.base
    vp.drag(dx: -171)
    check(close(vp.base.c, before.c + before.span / 2, 1e-3), "dragging half the plot to the left shows half a window later")
    vp.endGesture()
    vp.beginGesture(cursor: later, cursorIn: true, pinch: true)
    let start = vp.base
    vp.pinch(scale: 2, x: 54 + 342 * 0.25, startX: 54 + 342 * 0.25, cursor: later, cursorIn: true)
    let anchor = TimelineScale(window: start, x0: 54, width: 342).t(54 + 342 * 0.25)
    check(close(vp.base.span, start.span / 2) && close(TimelineScale(window: vp.base, x0: 54, width: 342).t(54 + 342 * 0.25), anchor, 1e-3),
          "a pinch zooms about the fingers")
    vp.endGesture()
    // a jump outside the window brings the cursor back into view; a pause does not move anything
    vp.set(TimelineWindow(c: t + 1e7, span: 3600))
    vp.clockChanged(.pause, cursor: t, cursorIn: true, playing: false, reduceMotion: true)
    check(close(vp.base.c, t + 1e7), "pausing leaves the window alone")
    vp.clockChanged(.jump, cursor: t, cursorIn: true, playing: false, reduceMotion: true)
    check(close(vp.base.c, t), "a jump off screen centres the cursor")
    vp.clockChanged(.live, cursor: t, cursorIn: true, playing: false, reduceMotion: true)
    check(vp.follow, "going live follows the cursor")
    vp.toggleFollow(cursor: t, cursorIn: true, reduceMotion: true)
    vp.clockChanged(.rate, cursor: t, cursorIn: true, playing: true, reduceMotion: true)
    check(!vp.follow, "a time-lapse does not override Follow switched off by hand")
    // transitions are a pure function of time
    vp.set(TimelineWindow(c: t, span: 3600))
    vp.animate(to: TimelineWindow(c: t, span: 60), cursor: t, cursorIn: true, duration: 1, reduceMotion: false)
    let s0 = Date.now
    let mid = vp.window(at: s0.addingTimeInterval(0.5), cursor: t, cursorIn: true)
    let end = vp.window(at: s0.addingTimeInterval(2), cursor: t, cursorIn: true)
    check(vp.isMoving && mid.span < 3600 && mid.span > 60 && close(end.span, 60), "a transition runs from window to window in time")
}

// MARK: - Data

@MainActor
private func dataChecks() {
    let clock = FractonicaClock.shared
    let data = TimelineData()
    var seed: UInt64 = 42
    func random() -> Double {
        seed = seed &* 6364136223846793005 &+ 1442695040888963407
        return Double(seed >> 11) / Double(1 << 53)
    }
    var bad = 0
    for _ in 0..<300 {
        let t = clock.tMin + 1 + random() * (clock.tMax - clock.tMin - 2)
        for level in [0, 3, 6, 9, 12] {
            guard let exact = clock.level(at: t, level), let c = data.cycle(level, at: t) else { bad += 1; continue }
            // the float boundaries may sit a hair off the exact start: only instants clear of a boundary must agree
            if t - exact.start > 1e-3, exact.end - t > 1e-3, c.idx != exact.cycle { bad += 1 }
        }
    }
    check(bad == 0, "the block cache's cycle at an instant is the exact reading's (\(bad) differ)")
    let t = 1_791_460_800.0
    for level in [1, 4, 7, 10] {
        let mean = clock.levelInfo(level).meanSeconds
        let blocks = data.blocks(level, t - 20 * mean, t + 20 * mean)
        let contiguous = zip(blocks, blocks.dropFirst()).allSatisfy { $0.end == $1.start && $1.idx == $0.idx + 1 }
        check(contiguous && blocks.count >= 40, "level \(level): blocks tile time without gaps (\(blocks.count))")
    }
    check(data.blocks(13, clock.tMax - 1, clock.tMax + 100).allSatisfy { $0.start < clock.tMax }, "no zero-length cycle at the catalogue's closing instant")
    check(data.alpha.count == 18 && data.alpha.last?.end == clock.tMax, "the map shows 18 α cycles, the last one clipped")
    check(data.cycle(6, at: clock.tMin - 10) == nil && data.cycle(6, at: clock.tMax + 10) == nil, "nothing outside the catalogue")
}

// MARK: - Wording

@MainActor private let earthWords = #/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun|UTC)\b|\d\s?(ms|s|min|h|d|y)\b|%|\d{4}-\d{2}/#

@MainActor
private func wordingChecks() {
    let clock = FractonicaClock.shared
    let data = TimelineData()
    let words = TimelineWords(pure: true, earth: EarthFormatter(zone: "UTC"))
    let ruler = data.ruler
    var texts: [String] = [words.catalogueRange, words.catalogueYears, words.edgeLabel(start: true), words.edgeLabel(start: false)]
    let t = 1_791_460_800.0
    for level in 0...13 {
        texts += [words.laneLength(level, compact: true), words.levelLength(level), words.denseMessage(level)]
        if let c = data.cycle(level, at: t) {
            texts += words.blockLabels(level: level, idx: c.idx, local: c.local, siblings: clock.levelInfo(level).siblings ?? 18,
                                       width: 900, wide: true, end: c.end, endsWithCatalogue: false, refYear: 2026,
                                       quarter: Notation.isMajor(level) ? "Node" : nil, names: { data.names($0, $1) })
        }
    }
    for span in [2.0, 60, 3600, 86_400, 1e7, 1e9, 4e10] {
        let w = TimelineWindow(c: t, span: span)
        let step = ruler.pick(pxPerSec: 342 / span, plotWidth: 342)
        texts += [words.flagLabel(t, span: span, refYear: 2026, ruler: ruler, rulerUnit: step.u),
                  words.windowText(w, refYear: 2026, ruler: ruler, rulerUnit: step.u, plotWidth: 342),
                  words.spanText(w, ruler: ruler, plotWidth: 342)]
    }
    for k in [0, 22, 69] { texts.append(words.eclipseLabel(k)) }
    let leaks = texts.filter { $0.contains(earthWords) }
    check(leaks.isEmpty, "pure wording says nothing Gregorian, Earth-unit or percentage: \(leaks)")
    check(words.laneLength(6, compact: true) == "= 36ι" && words.laneLength(4, compact: true) == "= 77η" && words.laneLength(5, compact: true) == "= 11η",
          "lane heads count one cycle in the next unit")
    let earth = TimelineWords(pure: false, earth: EarthFormatter(zone: "UTC"))
    check(TimelineWords.cycleLength(clock.levelInfo(6).meanSeconds) == "5.05 h" && earth.laneLength(4, compact: false) == "≈ 16.2 d",
          "Earth lane heads give the mean length")
}

// MARK: - Wording against the web

/// The canvas wording against src/ui/timeline/words.js and paint.js (fixture.json "words", "lanes", "rulerTips"): the
/// cursor's cycle at every depth for 17 instants, its pure block labels at three widths and its Earth end label; the lane
/// heads, dense-lane notes and lane-head explanations; the ruler key's explanation of every step.
@MainActor
private func webWordingChecks(_ fixture: JSON) {
    let clock = FractonicaClock.shared
    let data = TimelineData()
    let pure = TimelineWords(pure: true, earth: EarthFormatter(zone: "UTC"))
    let earth = TimelineWords(pure: false, earth: EarthFormatter(zone: "UTC"))
    var cycles = 0, bad = 0
    func fail(_ message: String) {
        bad += 1
        if bad <= 5 { check(false, message) }
    }
    for w in fixture["words"] as? [JSON] ?? [] {
        let t = d(w["t"]), level = (w["L"] as? NSNumber)?.intValue ?? -1
        cycles += 1
        guard let c = data.cycle(level, at: t) else {
            fail("no cycle of level \(level) at \(t)")
            continue
        }
        guard c.idx == (w["idx"] as? NSNumber)?.int64Value, c.local == (w["local"] as? NSNumber)?.intValue else {
            fail("level \(level) at \(t): cycle \(c.idx) local \(c.local), the web has \(w["idx"] ?? "-") local \(w["local"] ?? "-")")
            continue
        }
        let siblings = clock.levelInfo(level).siblings ?? data.alpha.count
        let wants = w["labels"] as? [[String]] ?? []
        for (j, width) in [900.0, 100, 35].enumerated() where j < wants.count {
            let got = pure.blockLabels(level: level, idx: c.idx, local: c.local, siblings: siblings, width: width, wide: j == 0,
                                       end: c.end, endsWithCatalogue: c.end >= clock.tMax - 1e-3, refYear: 2026,
                                       quarter: w["quarter"] as? String, names: { data.names($0, $1) })
            if got != wants[j] { fail("level \(level) at \(t), \(width) pt: \(got), the web has \(wants[j])") }
        }
        let end = earth.endLabel(level: level, end: c.end, refYear: 2026)
        if end != w["endLabel"] as? String { fail("level \(level) at \(t): ends \(end), the web has \(w["endLabel"] ?? "-")") }
    }
    check(bad == 0 && cycles > 200, "block labels and end labels match the web for \(cycles) cycles")

    bad = 0
    for lane in fixture["lanes"] as? [JSON] ?? [] {
        let level = (lane["L"] as? NSNumber)?.intValue ?? -1
        let got = [pure.laneLength(level, compact: true), pure.denseMessage(level), pure.laneTip(level, alphaCycles: data.alpha.count),
                   TimelineWords.cycleLength(clock.levelInfo(level).meanSeconds)]
        let want = ["laneLength", "dense", "tip", "length"].map { lane[$0] as? String ?? "" }
        for (g, w) in zip(got, want) where g != w { fail("lane \(level): \(g)  ≠  \(w)") }
    }
    check(bad == 0, "lane heads, dense-lane notes and lane-head explanations match the web")

    bad = 0
    let hint = " Press ? for the glossary."
    for tip in fixture["rulerTips"] as? [JSON] ?? [] {
        let id = tip["id"] as? String ?? ""
        guard let step = data.ruler.step(id: id) else {
            fail("ruler step \(id) is missing")
            continue
        }
        let want = (tip["tip"] as? String ?? "").replacingOccurrences(of: hint, with: "")
        let got = pure.rulerTip(step, ruler: data.ruler)
        if got != want { fail("ruler tip \(id): \(got)  ≠  \(want)") }
    }
    check(bad == 0, "the ruler key's explanations match the web")
    let leaks = (0...13).map { pure.laneTip($0, alphaCycles: 18) }.filter { $0.contains(earthWords) }
    check(leaks.isEmpty, "pure lane-head explanations say nothing Gregorian: \(leaks)")
}
