import FractonicaKit
import Foundation

// The wave's geometry, scenes, solar ripple, navigation and words against the web app's own modules
// (wave-fixtures.json, written by make-wave-fixtures.mjs from src/ui/wave/*.js and fractonica.js), plus the label
// placer's promises (no overlaps where there is room, steadiness, staying on the stage).
//
//     node ios/Fractonica/Features/Wave/Checks/make-wave-fixtures.mjs     (after the JavaScript changes)
//     ios/scripts/check.sh ios/Fractonica/Features/Wave/Checks

@main @MainActor
struct WaveChecks {
    static func main() {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("wave-fixtures.json")
        guard let data = try? Data(contentsOf: url),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            check(false, "wave-fixtures.json is readable at \(url.path)")
            Checks.finish()
        }
        let engine = WaveEngine()
        arcChecks(root, engine)
        halfChecks(root, engine)
        sceneChecks(root, engine)
        describeChecks(root, engine)
        cameraChecks(root)
        solarChecks(root, engine)
        navChecks(root, engine)
        wordChecks(root, engine)
        labelChecks()
        Checks.finish()
    }
}

// MARK: - Helpers

private func arr(_ x: Any?) -> [Any] { x as? [Any] ?? [] }
private func dict(_ x: Any?) -> [String: Any] { x as? [String: Any] ?? [:] }
private func dbl(_ x: Any?) -> Double { (x as? NSNumber)?.doubleValue ?? .nan }
private func int(_ x: Any?) -> Int64 { (x as? NSNumber)?.int64Value ?? Int64.min }
private func str(_ x: Any?) -> String { x as? String ?? "<\(String(describing: x))>" }

/// Equal within `tol` relative to the larger magnitude (absolute below 1).
private func near(_ a: Double, _ b: Double, _ tol: Double = 1e-9) -> Bool {
    if a == b { return true }
    return abs(a - b) <= tol * max(1, abs(a), abs(b))
}

/// Angles equal modulo 2π.
private func nearAngle(_ a: Double, _ b: Double, _ tol: Double = 1e-9) -> Bool {
    abs(WaveGeometry.wrapPi(a - b)) <= tol
}

private func sameArc(_ a: WaveArc, _ v: [Any], from i: Int = 0, tol: Double = 1e-9) -> Bool {
    near(a.cx, dbl(v[i]), tol) && near(a.cy, dbl(v[i + 1]), tol) && near(a.radius, dbl(v[i + 2]), tol)
        && nearAngle(a.start, dbl(v[i + 3])) && near(a.sweep, dbl(v[i + 4]), tol)
}

private func describe(_ a: WaveArc) -> String { "(\(a.cx), \(a.cy)) r \(a.radius) start \(a.start) sweep \(a.sweep)" }

// MARK: - Geometry

@MainActor
private func arcChecks(_ root: [String: Any], _ engine: WaveEngine) {
    let cases = arr(root["arcs"])
    check(cases.count > 100, "arc cases are present: \(cases.count)")
    for c in cases.map(dict) {
        let level = Int(int(c["level"]))
        let idx = int(c["idx"])
        let ref = arr(c["ref"])
        let a = ref.isEmpty ? engine.arc(level, idx) : engine.arc(level, idx, in: (Int(int(ref[0])), int(ref[1])))
        let tol = ref.isEmpty ? 1e-8 : 1e-9
        check(sameArc(a, arr(c["arc"]), tol: tol), "arc \(level):\(idx) ref \(ref) = \(arr(c["arc"])), got \(describe(a))")
    }
}

@MainActor
private func halfChecks(_ root: [String: Any], _ engine: WaveEngine) {
    for c in arr(root["halves"]).map(dict) {
        let t = dbl(c["t"])
        let expected = c["halves"] as? [Any]
        let got = engine.readHalves(t)
        guard let expected else {
            check(got == nil, "no halves outside the catalogue at \(t)")
            continue
        }
        guard let got else {
            check(false, "halves exist at \(t)")
            continue
        }
        check(got.count == expected.count, "16 levels of halves at \(t): \(got.count)")
        for (level, e) in expected.enumerated() where level < got.count {
            let v = arr(e)
            check(got[level].idx == int(v[0]) && near(got[level].local, dbl(v[1]), 1e-9) && got[level].half == Int(int(v[2])),
                  "half of level \(level) at \(t): \(v), got \(got[level].idx) \(got[level].local) \(got[level].half)")
        }
    }
}

@MainActor
private func sceneChecks(_ root: [String: Any], _ engine: WaveEngine) {
    let pad = WavePad(l: 46, r: 46, t: 44, b: 40)
    let cases = arr(root["scenes"]).map(dict)
    check(cases.count > 40, "scene cases are present: \(cases.count)")
    var markerCount = 0
    for c in cases {
        let level = Int(int(c["level"]))
        let idx = int(c["idx"])
        let t = dbl(c["t"])
        let s = engine.buildFocus(level, idx)
        let name = "scene \(level):\(idx)"
        check(s.r0 == int(c["r0"]), "\(name) α ancestor")
        check(sameArc(s.focus, arr(c["focus"])), "\(name) focus arc \(arr(c["focus"])) got \(describe(s.focus))")
        check(near(s.fraction, dbl(c["fraction"])), "\(name) fraction")
        let children = arr(c["children"])
        check(s.children.count == children.count, "\(name) child count \(children.count) got \(s.children.count)")
        for (i, e) in children.enumerated() where i < s.children.count {
            let v = arr(e)
            let ch = s.children[i]
            check(ch.idx == int(v[0]) && ch.j == Int(int(v[1])) && sameArc(ch.arc, v, from: 2) && near(ch.fraction, dbl(v[7])),
                  "\(name) child \(i): \(v) got \(ch.idx) \(describe(ch.arc))")
        }
        check(s.grand.count == Int(int(c["grandCount"])), "\(name) grandchild count")
        for e in arr(c["grand"]) {
            let v = arr(e)
            guard let g = s.grand.first(where: { $0.idx == int(v[0]) }) else {
                check(false, "\(name) has grandchild \(v[0])")
                continue
            }
            check(g.j == Int(int(v[1])) && g.k == Int(int(v[2])) && sameArc(g.arc, v, from: 3) && near(g.fraction, dbl(v[8])),
                  "\(name) grandchild \(v) got \(describe(g.arc))")
        }
        let ancestors = arr(c["ancestors"])
        check(s.ancestors.count == ancestors.count, "\(name) ancestor count")
        for (i, e) in ancestors.enumerated() where i < s.ancestors.count {
            let v = arr(e)
            let a = s.ancestors[i]
            check(a.level == Int(int(v[0])) && a.idx == int(v[1]) && a.slotJ == Int(int(v[2])) && a.slotM == Int(int(v[3]))
                && near(a.fraction, dbl(v[4])) && sameArc(a.arc, v, from: 5, tol: 1e-8),
                  "\(name) ancestor \(i): \(v) got \(a.level):\(a.idx) slot \(a.slotJ)/\(a.slotM) \(describe(a.arc))")
        }
        check(s.samples.count == Int(int(c["samples"])), "\(name) sample count")
        check(near(s.samples.reduce(0, +), dbl(c["sampleSum"]), 1e-8), "\(name) sample sum")
        check(nearAngle(s.rot, dbl(c["rot"])), "\(name) view rotation")
        let ta = arr(c["toAlpha"])
        check(near(s.toAlpha.x, dbl(ta[0])) && near(s.toAlpha.y, dbl(ta[1])) && near(s.toAlpha.k, dbl(ta[2])),
              "\(name) frame map to α: \(ta) got \(s.toAlpha)")
        let cam = WaveCamera.fit(s.samples, rot: s.rot, width: 393, height: 520, pad: pad)
        let cv = arr(c["camera"])
        check(near(cam.cx, dbl(cv[0]), 1e-8) && near(cam.cy, dbl(cv[1]), 1e-8) && near(cam.scale, dbl(cv[2]), 1e-8) && nearAngle(cam.rot, dbl(cv[3])),
              "\(name) fitted camera \(cv) got \(cam)")
        check(near(engine.focusArcLength(s, width: 393, height: 520, pad: pad), dbl(c["arcPx"]), 1e-8), "\(name) arc length in points")
        guard let cur = engine.readHalves(t) else {
            check(false, "\(name): halves at \(t)")
            continue
        }
        let markers = engine.markers(s, cur)
        let expected = arr(c["markers"])
        check(markers.count == expected.count, "\(name) marker count \(expected.count) got \(markers.count)")
        for (i, e) in expected.enumerated() where i < markers.count {
            let v = arr(e)
            let m = markers[i]
            check(m.level == Int(int(v[0])) && m.idx == int(v[1]) && near(m.local, dbl(v[2])) && near(m.x, dbl(v[3]), 1e-8) && near(m.y, dbl(v[4]), 1e-8),
                  "\(name) marker \(i): \(v) got \(m.level):\(m.idx) \(m.local) (\(m.x), \(m.y))")
            // a marker lies on its own arc at the progress of its half-cycle
            let p = m.arc.point(m.local)
            check(abs(p.x - m.x) < 1e-12 && abs(p.y - m.y) < 1e-12, "\(name) marker \(m.level) lies on its arc")
            markerCount += 1
        }
    }
    check(markerCount > 200, "markers were compared: \(markerCount)")
}

@MainActor
private func describeChecks(_ root: [String: Any], _ engine: WaveEngine) {
    for c in arr(root["describes"]).map(dict) {
        let level = Int(int(c["level"]))
        let idx = int(c["idx"])
        let d = engine.describe(level, idx)
        let name = "describe \(level):\(idx)"
        check(d.letter == str(c["letter"]) && d.parent == (c["parent"] as? String), "\(name) letters")
        check(d.n == Int(int(c["n"])) && d.of == Int(int(c["of"])) && d.signed == str(c["signed"]) && d.crest == (c["crest"] as? Bool),
              "\(name) loop numbering \(c["n"]!)/\(c["of"]!) \(c["signed"]!) got \(d.n)/\(d.of) \(d.signed)")
        check(d.cycle == int(c["cycle"]) && d.cycleN == Int(int(c["cycleN"])) && d.cycleOf == Int(int(c["cycleOf"])),
              "\(name) cycle numbering \(c["cycleN"]!)/\(c["cycleOf"]!) got \(d.cycleN)/\(d.cycleOf)")
        check(abs(d.start - dbl(c["start"])) < 5e-4 && abs(d.end - dbl(c["end"])) < 5e-4, "\(name) span \(c["start"]!)…\(c["end"]!) got \(d.start)…\(d.end)")
        check(near(d.fraction, dbl(c["fraction"])) && d.clipped == (c["clipped"] as? Bool), "\(name) clipping")
    }
    for c in arr(root["steps"]).map(dict) {
        let level = Int(int(c["level"]))
        let idx = int(c["idx"])
        let t = dbl(c["t"])
        let dir = Int(int(c["dir"]))
        let out = dict(c["out"])
        let got = engine.stepTarget(level, idx, t: t, dir: dir)
        if let edge = out["edge"] as? String {
            check(got == .edge(edge == "end" ? .end : .start), "step \(level):\(idx) \(dir) from \(t) stops at the \(edge), got \(got)")
        } else if case .time(let x) = got {
            check(abs(x - dbl(out["t"])) < 5e-4, "step \(level):\(idx) \(dir) from \(t) to \(out["t"]!), got \(x)")
        } else {
            check(false, "step \(level):\(idx) \(dir) from \(t) moves, got \(got)")
        }
    }
}

@MainActor
private func cameraChecks(_ root: [String: Any]) {
    func cam(_ v: [Any]) -> WaveCamera { WaveCamera(cx: dbl(v[0]), cy: dbl(v[1]), scale: dbl(v[2]), rot: dbl(v[3])) }
    func same(_ a: WaveCamera, _ v: [Any]) -> Bool {
        near(a.cx, dbl(v[0]), 1e-9) && near(a.cy, dbl(v[1]), 1e-9) && near(a.scale, dbl(v[2]), 1e-9) && near(a.rot, dbl(v[3]), 1e-9)
    }
    for c in arr(root["cameras"]).map(dict) {
        let a = cam(arr(c["a"]))
        let b = cam(arr(c["b"]))
        let e = dbl(c["e"])
        let o = arr(c["o"])
        let m = WaveFrameMap(x: dbl(o[0]), y: dbl(o[1]), k: dbl(o[2]))
        check(same(WaveCamera.lerp(a, b, e), arr(c["lerp"])), "lerped camera \(arr(c["lerp"])) got \(WaveCamera.lerp(a, b, e))")
        check(same(a.toFrame(m), arr(c["to"])), "camera to frame")
        check(same(a.fromFrame(m), arr(c["from"])), "camera from frame")
        let w = arr(c["wrap"])
        check(near(WaveGeometry.wrapPi(dbl(w[0])), dbl(w[1])), "wrapPi(\(w[0]))")
    }
    // the user's pinch keeps the anchor still and its pan moves everything by the translation
    let base = WaveCamera(cx: 0.3, cy: -0.2, scale: 180, rot: 0.7)
    let user = WaveUserTransform(scale: 1.6, anchor: WavePoint(x: 120, y: 300), translation: WavePoint(x: 14, y: -9))
    let before = WaveProjection(base, width: 400, height: 600)
    let after = WaveProjection(base.adjusted(by: user, width: 400, height: 600), width: 400, height: 600)
    for (x, y) in [(0.0, 0.0), (0.5, -0.4), (-1.2, 0.9)] {
        let p = before.point(x, y)
        let q = after.point(x, y)
        let ex = user.anchor.x + user.scale * (p.x - user.anchor.x) + user.translation.x
        let ey = user.anchor.y + user.scale * (p.y - user.anchor.y) + user.translation.y
        check(abs(q.x - ex) < 1e-9 && abs(q.y - ey) < 1e-9, "the user transform maps (\(x), \(y)) to (\(ex), \(ey)), got (\(q.x), \(q.y))")
    }

    for c in arr(root["layouts"]).map(dict) {
        let w = dbl(c["w"])
        let h = dbl(c["h"])
        let pad = WavePad(l: 24, r: 48, t: 30, b: 18)
        guard let l = WaveRowLayout.best(count: 35, width: w, height: h, pad: pad) else {
            check(false, "a row layout for \(w)×\(h)")
            continue
        }
        check(l.cols == Int(int(c["cols"])) && l.rows == Int(int(c["rows"])) && near(l.scale, dbl(c["scale"])), "row layout \(w)×\(h): \(c["cols"]!)×\(c["rows"]!) got \(l.cols)×\(l.rows)")
        check(same(l.camera(width: w, height: h, pad: pad), arr(c["camera"])), "overview camera \(w)×\(h)")
        for (r, e) in zip([0, 5, 17, 34], arr(c["offsets"])) {
            let v = arr(e)
            let o = l.offset(Int64(r))
            check(near(o.x, dbl(v[0])) && near(o.y, dbl(v[1])) && o.row == Int(int(v[2])) && o.col == Int(int(v[3])), "row offset of α \(r) on \(w)×\(h)")
        }
    }
    for c in arr(root["nearest"]).map(dict) {
        let s = arr(c["sa"])
        let p = arr(c["p"])
        let o = arr(c["out"])
        let sa = WaveScreenArc(x: dbl(s[0]), y: dbl(s[1]), r: dbl(s[2]), a0: dbl(s[3]), sweep: dbl(s[4]))
        let n = sa.nearest(dbl(p[0]), dbl(p[1]), tMax: dbl(p[2]))
        check(near(n.t, dbl(o[0])) && near(n.dist, dbl(o[1])), "nearest point on an arc: \(o) got \(n)")
    }
    for e in arr(root["glyphs"]) {
        let v = arr(e)
        check(WaveGeometry.glyphIndexAt(idx: int(v[0]), t: dbl(v[1])) == Int(int(v[2])), "glyph index at \(v)")
    }
}

@MainActor
private func solarChecks(_ root: [String: Any], _ engine: WaveEngine) {
    let s = dict(root["solar"])
    let grid = WaveSolar.Grid(p6: engine.prefix(WaveSolar.syncLevel))
    let gv = arr(s["grid"])
    check(near(grid.p6, dbl(gv[0])) && near(grid.anchor, dbl(gv[1])) && near(grid.length, dbl(gv[2])), "the sync grid")
    for e in arr(s["at"]) {
        let v = arr(e)
        let a = grid.at(dbl(v[0]))
        check(a.sync == Int(int(v[1])) && near(a.phase, dbl(v[2]), 1e-7), "sync at position \(v[0]): \(v) got \(a)")
    }
    for e in arr(s["fits"]) {
        let v = arr(e)
        let f = WaveSolar.rippleFit(syncs: dbl(v[0]), arcPx: dbl(v[1]))
        let why: String = switch f.why { case .ok: "ok"; case .coarse: "coarse"; case .fine: "fine" }
        check(f.visible == (v[2] as? Bool) && near(f.strength, dbl(v[3])) && why == str(v[4]), "ripple fit \(v) got \(f)")
    }
    for c in arr(s["marks"]).map(dict) {
        let level = Int(int(c["level"]))
        let idx = int(c["idx"])
        let spec = WaveSolar.ArcSpec(idx: idx, prefix: engine.prefix(level), fraction: engine.fractionOf(level, idx))
        let marks = WaveSolar.quarterMarks(spec, grid)
        let expected = arr(c["marks"])
        check(marks.count == expected.count, "quarter marks on \(level):\(idx): \(expected.count) got \(marks.count)")
        for (m, e) in zip(marks, expected) {
            let v = arr(e)
            check(m.sync == Int(int(v[0])) && m.k == Int(int(v[1])) && near(m.p, dbl(v[2]), 1e-7), "quarter mark \(v) got \(m)")
        }
    }
    for c in arr(s["pins"]).map(dict) {
        let level = Int(int(c["level"]))
        let idx = int(c["idx"])
        let sync = Int(int(c["sync"]))
        let spec = WaveSolar.ArcSpec(idx: idx, prefix: engine.prefix(level), fraction: engine.fractionOf(level, idx))
        for e in arr(c["phases"]) {
            let v = arr(e)
            check(near(WaveSolar.pinPhase(spec, grid, t: dbl(v[0]), sync: sync), dbl(v[1]), 1e-7), "pin phase on \(level):\(idx) at \(v[0])")
        }
    }
}

@MainActor
private func navChecks(_ root: [String: Any], _ engine: WaveEngine) {
    let nav = dict(root["nav"])
    for e in arr(nav["follow"]) {
        let v = arr(e)
        let got = WaveNav.followableLevel(Int(int(v[0])), rate: dbl(v[1]), reduced: v[2] as? Bool ?? false) { engine.clock.levelInfo($0).meanSeconds }
        check(got == Int(int(v[3])), "followable level \(v) got \(got)")
    }
    for e in arr(nav["zoom"]) {
        let v = arr(e)
        let plan = WaveNav.zoomPlan(inRange: v[0] as? Bool ?? false, overview: v[1] as? Bool ?? false, level: Int(int(v[2])), eff: Int(int(v[3])), dir: Int(int(v[4])))
        let o = dict(v[5])
        let expected: WaveNav.ZoomPlan = switch str(o["kind"]) {
        case "select": .select(Int(int(o["level"])))
        case "focus": .focus(Int(int(o["level"])))
        case "overview": .overview
        default:
            str(o["msg"]).hasPrefix("Outside") ? .limit(.outOfRange) : str(o["msg"]).hasPrefix("Depth") ? .limit(.deepest) : .limit(.catalogueShown)
        }
        check(plan == expected, "zoom plan \(v) got \(plan)")
    }
}

// MARK: - Words

@MainActor
private func wordChecks(_ root: [String: Any], _ engine: WaveEngine) {
    let utc = TimeZone(identifier: "UTC")!
    let earth = WaveWords(wording: Wording(pure: false, timeZone: utc), engine: engine)
    let pure = WaveWords(wording: Wording(pure: true, timeZone: utc), engine: engine)
    let cases = arr(root["words"]).map(dict)
    check(cases.count > 100, "word cases are present: \(cases.count)")
    for c in cases {
        let t = dbl(c["t"])
        let level = Int(int(c["level"]))
        let idx = int(c["idx"])
        let local = dbl(c["local"])
        let d = engine.describe(level, idx)
        let h = WaveHalf(idx: idx, local: local, half: Int(idx % 2))
        for (key, w) in [("earth", earth), ("pure", pure)] {
            let e = dict(c[key])
            let name = "\(key) words of \(level):\(idx) at \(t)"
            func same(_ field: String, _ got: String) {
                check(got == str(e[field]), "\(name) \(field): «\(str(e[field]))» got «\(got)»")
            }
            same("loop", w.loop(d))
            same("loopHint", w.loopHint(d))
            same("cycle", w.cycle(d))
            same("span", w.span(d))
            same("when", w.when(d, now: t))
            same("whenEarly", w.when(d, now: d.start - 1000))
            same("now", w.nowLabel(t, level: level, duration: d.duration))
            same("nowAll", w.nowLabel(t, level: 0, overview: true))
            same("quarter", w.quarter(d, local: local))
            same("halfLength", w.halfLength(level))
            same("chipTitle", w.chipTitle(level))
            same("announce", w.announce(d, t: t))
            same("canvas", w.canvasLabel(d, local: local))
            let next = w.nextLines(d, h, t: t)
            let en = arr(e["next"]).map { arr($0).map(str) }
            check(next.map { [$0.dim, $0.text] } == en, "\(name) next lines \(en) got \(next)")
            if key == "pure" {
                for text in [w.span(d), w.cycle(d), w.when(d, now: t), w.nowLabel(t, level: level, duration: d.duration)] + next.map(\.text) {
                    check(!pureLeaks(text), "\(name): «\(text)» says nothing Earthly")
                }
            }
        }
    }
    let statics = dict(root["staticWords"])
    let a = 1791460800.0
    for (key, w) in [("earth", earth), ("pure", pure)] {
        let e = dict(statics[key])
        let name = "\(key) words"
        let ecl = w.eclipses()
        let ee = dict(e["eclipses"])
        check(ecl.marks == arr(ee["marks"]).map(str) && ecl.end == str(ee["end"]), "\(name): eclipse labels \(ecl)")
        check(w.outOfRange(engine.clock.tMin - 86400 * 400) == str(e["before"]), "\(name): before the catalogue «\(w.outOfRange(engine.clock.tMin - 86400 * 400))»")
        check(w.outOfRange(engine.clock.tMax + 3600 * 5) == str(e["after"]), "\(name): after the catalogue «\(w.outOfRange(engine.clock.tMax + 3600 * 5))»")
        check(w.catalogueSpan() == str(e["catalogueSpan"]), "\(name): catalogue span «\(w.catalogueSpan())»")
        check(w.catalogueTitle() == str(e["catalogueTitle"]), "\(name): catalogue title")
        check(w.alphaSpan(engine.describe(0, 34)) == str(e["alphaSpan"]), "\(name): α span «\(w.alphaSpan(engine.describe(0, 34)))»")
        if let sun = engine.clock.solar(at: a) {
            check(w.sunNext(sun, t: a) == str(e["sunNext"]), "\(name): next quarter of the sync «\(w.sunNext(sun, t: a))»")
            check(w.sunDrift(sun) == str(e["sunDrift"]), "\(name): drift «\(w.sunDrift(sun))»")
            check(w.sunNumber(sun.sync) == str(e["sunNumber"]), "\(name): sync number")
        } else {
            check(false, "a solar reading at vector A")
        }
        let ranges = [[], [3], [3, 4], [2, 4]].map(w.sunRange)
        check(ranges == arr(e["sunRange"]).map(str), "\(name): ripple depths \(ranges)")
    }
    for e in arr(root["percents"]) {
        let v = arr(e)
        check(WaveWords.floorPercent(dbl(v[0])) == str(v[1]) && WaveWords.floorPercent(dbl(v[0]), decimals: 1) == str(v[2]),
              "floored percent of \(v[0]): \(v) got \(WaveWords.floorPercent(dbl(v[0]))) \(WaveWords.floorPercent(dbl(v[0]), decimals: 1))")
    }
    for e in arr(root["countdowns"]) {
        let v = arr(e)
        check(earth.countdownText(dbl(v[0])) == str(v[1]), "countdown \(v) got \(earth.countdownText(dbl(v[0])))")
    }
}

/// Whether a pure-mode text gives away an Earth reading: a percentage, a year-like date, a clock time or an Earth unit.
private func pureLeaks(_ s: String) -> Bool {
    if s.contains("%") { return true }
    let patterns = [#"\d{4}-\d{2}"#, #"\d{1,2}:\d{2}"#, #"\d+ ?(ms|s|min|h|d|y)\b"#, #"\bUTC\b"#]
    return patterns.contains { s.range(of: $0, options: .regularExpression) != nil }
}

// MARK: - Labels

@MainActor
private func labelChecks() {
    let width: (String) -> Double = { Double($0.count) * 6.5 }
    let stage = WaveRect(x0: 0, y0: 0, x1: 400, y1: 300)
    var placer = WaveLabelPlacer()
    // labels around one crowded point never overlap while there is room
    placer.begin(stage: stage, now: 0)
    var rects: [WaveRect] = []
    for i in 0..<8 {
        let spot = placer.place(key: "k\(i)", text: "+1\(i)", width: width("+1\(i)"), at: WavePoint(x: 200, y: 150), normal: WavePoint(x: 0, y: -1), clearance: 10, weight: 1)
        rects.append(spot.rect)
    }
    var overlaps = 0
    for i in rects.indices {
        for j in rects.indices where j > i && rects[i].overlap(rects[j]) > 0.5 { overlaps += 1 }
    }
    check(overlaps == 0, "eight loop numbers around one point find eight free spots (\(overlaps) overlaps)")
    check(rects.allSatisfy { $0.x0 >= 0 && $0.x1 <= 400 && $0.y0 >= 0 && $0.y1 <= 300 }, "labels stay on the stage")
    // a label at the edge slides back inside
    placer.begin(stage: stage, now: 0)
    let edge = placer.place(key: "e", text: "2026-10-08 12:00", width: width("2026-10-08 12:00"), at: WavePoint(x: 396, y: 4), normal: WavePoint(x: 1, y: -1), clearance: 10, weight: 1)
    check(edge.rect.x1 <= 400.01 && edge.rect.y0 >= -0.01, "a label at the corner stays inside: \(edge.rect)")
    // a label keeps its spot from frame to frame while it is free (no hopping between near-tied sides)
    var spots: [Int] = []
    for f in 0..<20 {
        placer.begin(stage: stage, now: Double(f) * 0.016)
        placer.occupy(WaveRect(x0: 190, y0: 140 + Double(f % 2), x1: 210, y1: 160), weight: 1)
        let s = placer.place(key: "steady", text: "12:00:0\(f % 10)", width: width("12:00:00"), at: WavePoint(x: 200, y: 150), normal: WavePoint(x: 0.7, y: 0.7), clearance: 12, weight: 1)
        spots.append(s.slot)
    }
    check(Set(spots).count == 1, "a ticking label keeps its spot: \(spots)")
    // a label gives way once its spot is genuinely taken, and glides there
    placer.begin(stage: stage, now: 1)
    let first = placer.place(key: "g", text: "peak", width: 30, at: WavePoint(x: 100, y: 100), normal: WavePoint(x: 0, y: -1), clearance: 8, weight: 1)
    placer.begin(stage: stage, now: 1.016)
    placer.occupy(first.rect.inset(by: -4), weight: 1)
    let moved = placer.place(key: "g", text: "peak", width: 30, at: WavePoint(x: 100, y: 100), normal: WavePoint(x: 0, y: -1), clearance: 8, weight: 1)
    check(moved.slot != first.slot, "a blocked label moves to another side")
    check(hypot(moved.center.x - first.center.x, moved.center.y - first.center.y) <= WaveLabelPlacer.maxStep + 0.01, "it glides there instead of jumping")
    check(placer.settling, "a gliding label asks for the next frame")
}
