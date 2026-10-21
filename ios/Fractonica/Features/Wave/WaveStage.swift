import FractonicaKit
import SwiftUI

/// What a frame of the stage needs from the screen.
struct WaveFrameInput {
    /// The whole catalogue instead of a focus level.
    var overview: Bool
    /// The shared selection, and the level actually focused (coarser while a time-lapse is too fast to follow).
    var level: Int
    var eff: Int
    var solar: Bool
    var words: WaveWords
    var reduceMotion: Bool
    /// Points kept free around the fitted figure (floating controls included).
    var focusPad: WavePad
    var overviewPad: WavePad
    /// Rectangles of the floating controls: edge badges slide off them.
    var avoid: [WaveRect]
    /// Touch tolerances for picking (iOS) or pointer ones (macOS).
    var touch: Bool
}

/// What a point of the stage is.
struct WavePick: Equatable {
    enum Kind: Equatable { case focus, child, alpha, marker, sun }
    var kind: Kind
    var level: Int
    var idx: Int64
    /// Progress of the point on the arc (arcs), or of the marker on its arc (markers).
    var t: Double
    var dist: Double
    var x: Double
    var y: Double

    /// Same thing under the pointer (for redraws and tooltips).
    func same(_ o: WavePick?) -> Bool { o.map { $0.kind == kind && $0.level == level && $0.idx == idx } ?? false }
}

/// The stage's frame state: the scene on screen, the camera and its transitions, the user's own pinch and pan, the
/// hit targets of the last frame and the label memory. Not observable: the Canvas renderer reads and writes it every
/// frame (src/ui/wave.js `S`).
@MainActor
final class WaveStage {
    let engine = WaveEngine()
    let grid: WaveSolar.Grid

    // the stage
    private(set) var size = CGSize.zero
    private var input: WaveFrameInput?

    // the displayed time
    private(set) var curT = Double.nan
    private(set) var cur: [WaveHalf]?
    private(set) var inRange = true
    private(set) var lastT = Double.nan
    /// The engine's solar reading (nil in the first and last sync of the catalogue) and the sync from the position
    /// grid (always there inside the catalogue).
    private(set) var sun: SolarReading?
    private var sunT = Double.nan
    private(set) var sunSync: (sync: Int, phase: Double, quarter: Int)?

    // scenes and cameras
    private(set) var scene: WaveScene?
    private(set) var cam: WaveCamera?
    private var anim: Move?
    private var ov: WaveOverviewScene?
    private var ovKey = ""
    private var lastSwitch = -Double.infinity
    private var snapNext = true
    /// The camera the next scene change starts from (a pinch that changed depth): already in the shown scene's frame.
    private var pendingFrom: WaveCamera?

    // the user's own pinch and pan
    private(set) var user = WaveUserTransform.identity
    private var userAnim: (from: WaveUserTransform, t0: Double, dur: Double)?

    // drawing
    /// Labels grow a little on a big stage (iPad, Mac).
    private(set) var fontScale = 1.0
    var labels = WaveLabelPlacer()
    /// The labels of a scene still zooming in fade in over the second half of the move.
    var labelFade = 1.0
    var widths: [String: Double] = [:]
    var colors: [Int: Color] = [:]
    var queue: [QueuedLabel] = []
    var hitArcs: [HitArc] = []
    var hitMarkers: [HitMarker] = []
    var hitSun: WavePoint?
    var years: (key: String, marks: [String], end: String) = ("", [], "")
    private var labelKey = ""

    /// Under the pointer (hover, or a finger holding still), set by the screen.
    var hover: WavePick?
    /// A finger or the mouse is scrubbing along the arc (haptic ticks on loop changes).
    var scrubbing = false
    private var scrubLoop: Int64 = -1

    /// Asks the screen for continuous frames for a while (an animation, a gliding label).
    var requestFrames: (Double) -> Void = { _ in }
    /// The focused half-arc changed (for VoiceOver).
    var sceneChanged: (WaveHalfInfo?, Double) -> Void = { _, _ in }
    /// The user's pinch or pan was reset by a scene change.
    var userReset: () -> Void = {}
    /// A haptic tick (scrubbing across loops).
    var tick: () -> Void = {}

    struct Move {
        enum Mode { case zoom, fade, settle }
        var mode: Mode
        var from: WaveScene
        var to: WaveScene
        var map: WaveFrameMap
        var camFrom: WaveCamera
        var camTo: WaveCamera
        var t0: Double
        var dur: Double
        /// A deep zoom passes through the half-arcs between its ends (coarse to fine, the ends included): each is drawn
        /// while the camera is near its own fitted scale, so the move reads like powers of ten.
        var chain: [Stop] = []
    }

    /// A scene on a deep zoom's way: how its frame relates to the target's, and the scale it fits the stage at.
    struct Stop {
        var scene: WaveScene
        var map: WaveFrameMap
        var fit: Double
        var level: Int
    }

    struct HitArc {
        var kind: WavePick.Kind
        var level: Int
        var idx: Int64
        var sa: WaveScreenArc
        var fraction: Double
    }

    struct HitMarker {
        var level: Int
        var idx: Int64
        var local: Double
        var x: Double
        var y: Double
    }

    struct QueuedLabel {
        var text: String
        var at: CGPoint
        var color: Color
        var font: Font
        var opacity: Double
        var anchor: UnitPoint = .center
        var panel: Bool = false
    }

    init() {
        grid = WaveSolar.Grid(p6: engine.prefix(WaveSolar.syncLevel))
    }

    static var now: Double { ProcessInfo.processInfo.systemUptime }

    /// The padding the last frame fitted focus scenes with.
    var focusPad: WavePad { input?.focusPad ?? WavePad(l: 40, r: 40, t: 40, b: 100) }

    /// Starts over (the screen appeared): the next scene snaps into place.
    func reset() {
        scene = nil
        anim = nil
        cam = nil
        pendingFrom = nil
        user = .identity
        userAnim = nil
        snapNext = true
        labels.forget()
    }

    // MARK: The displayed time

    /// Reads the clock at t: the half-arc of every level (when t moved) and the solar sync.
    func read(_ t: Double, solar: Bool) {
        lastT = t
        inRange = engine.clock.inRange(t)
        if t != curT {
            cur = engine.readHalves(t)
            curT = t
        }
        if solar, inRange, let pos = engine.clock.position(at: t) {
            if t != sunT {
                sun = engine.clock.solar(at: t)
                sunT = t
            }
            let s = grid.at(pos)
            sunSync = (s.sync, s.phase, WaveSolar.quarterOf(s.phase))
        } else {
            sun = nil
            sunT = .nan
            sunSync = nil
        }
    }

    // MARK: Cameras

    private func camera(for scene: WaveScene, _ input: WaveFrameInput) -> WaveCamera {
        switch scene {
        case .overview(let o): o.layout.camera(width: size.width, height: size.height, pad: input.overviewPad)
        case .focus(let f): WaveCamera.fit(f.samples, rot: f.rot, width: size.width, height: size.height, pad: input.focusPad)
        }
    }

    private func overviewScene(_ input: WaveFrameInput) -> WaveOverviewScene {
        let key = "\(Int(size.width))x\(Int(size.height))|\(input.overviewPad.l),\(input.overviewPad.r),\(input.overviewPad.t),\(input.overviewPad.b)"
        if let ov, ovKey == key { return ov }
        let layout = WaveRowLayout.best(count: Int(engine.halfCount(0)), width: size.width, height: size.height, pad: input.overviewPad)
            ?? WaveRowLayout(cols: 35, rows: 1, scale: 1, worldW: 70, worldH: 2.8, rowPitch: 3.1)
        let made = engine.buildOverview(layout)
        ov = made
        ovKey = key
        return made
    }

    /// The camera(s) of an animation at `now`: e, the target scene's camera and the old scene's.
    private func animCamera(_ a: Move, _ now: Double) -> (e: Double, to: WaveCamera, from: WaveCamera) {
        let e = WaveGeometry.easeOutCubic((now - a.t0) / a.dur)
        switch a.mode {
        case .zoom, .settle:
            let to = WaveCamera.lerp(a.camFrom, a.camTo, e)
            return (e, to, to.fromFrame(a.map))
        case .fade:
            return (e, a.camTo, a.camFrom)
        }
    }

    /// The user's transform at `now` (easing back to identity after a pinch that did not change depth, or Recenter).
    private func userTransform(_ now: Double) -> WaveUserTransform {
        guard let ua = userAnim else { return user }
        let e = WaveGeometry.easeOutCubic((now - ua.t0) / ua.dur)
        if e >= 1 {
            userAnim = nil
            user = .identity
            return user
        }
        return ua.from.easedToIdentity(e)
    }

    /// The camera the shown scene is seen through right now (animation and the user's transform included), in the
    /// target scene's frame.
    func visibleCamera(_ now: Double = WaveStage.now) -> WaveCamera? {
        guard let cam else { return nil }
        let base = anim.map { animCamera($0, now).to } ?? cam
        return base.adjusted(by: userTransform(now), width: size.width, height: size.height)
    }

    private func setScene(_ next: WaveScene, _ input: WaveFrameInput, now: Double) {
        let prev = scene
        let nextCam = camera(for: next, input)
        let fromScene = anim?.to ?? prev
        let sameLevel = fromScene?.focus != nil && next.focus != nil && fromScene?.focus?.level == next.focus?.level
        // neighbouring half-arcs of one level that follow each other quickly swap without a fade
        let quick = sameLevel && now - lastSwitch < 0.5
        lastSwitch = now
        let fromCam = pendingFrom ?? visibleCamera(now)
        pendingFrom = nil
        if !user.isIdentity || userAnim != nil {
            user = .identity
            userAnim = nil
            userReset()
        }
        guard let fromScene, let fromCam, !snapNext, !input.reduceMotion, !quick else {
            scene = next
            cam = nextCam
            anim = nil
            snapNext = false
            return
        }
        snapNext = false
        if !sameLevel, let map = WaveScene.relate(fromScene, next) {
            let la = fromScene.focus?.level ?? -1
            let lb = next.focus?.level ?? -1
            let gap = abs(la - lb)
            var move = Move(mode: .zoom, from: fromScene, to: next, map: map, camFrom: fromCam.toFrame(map), camTo: nextCam,
                            t0: now, dur: min(1.1, 0.42 + 0.08 * Double(max(0, gap - 1))))
            if gap >= 2 { move.chain = chain(from: fromScene, la, to: next, lb, map: map, input) }
            anim = move
        } else {
            anim = Move(mode: .fade, from: fromScene, to: next, map: .identity, camFrom: fromCam, camTo: nextCam, t0: now, dur: 0.24)
        }
        scene = next
        cam = nextCam
    }

    /// The stops of a deep zoom: the ends and the half-arcs holding the displayed time at every level between them.
    private func chain(from a: WaveScene, _ la: Int, to b: WaveScene, _ lb: Int, map: WaveFrameMap, _ input: WaveFrameInput) -> [Stop] {
        guard let cur else { return [] }
        var stops = [Stop(scene: a, map: map, fit: camera(for: a, input).scale, level: la),
                     Stop(scene: b, map: .identity, fit: camera(for: b, input).scale, level: lb)]
        for l in (min(la, lb) + 1)..<max(la, lb) where l >= 0 && l < cur.count && l <= Fractonica.maxLevel {
            let s = WaveScene.focus(engine.buildFocus(l, cur[l].idx))
            guard let m = WaveScene.relate(s, b) else { continue }
            stops.append(Stop(scene: s, map: m, fit: camera(for: s, input).scale, level: l))
        }
        return stops.sorted { $0.level < $1.level }
    }

    // MARK: The user's pinch and pan

    /// Sets the user's transform while a gesture runs.
    func setUser(_ transform: WaveUserTransform) {
        userAnim = nil
        user = transform
    }

    /// Eases the user's transform back to the fitted camera.
    func releaseUser(duration: Double = 0.3) {
        guard !user.isIdentity else { return }
        if input?.reduceMotion ?? false {
            user = .identity
            userAnim = nil
            requestFrames(0.1)
            return
        }
        userAnim = (user, Self.now, duration)
        requestFrames(duration + 0.05)
    }

    /// A pinch changed depth: the next scene starts from exactly what is on screen now.
    func commitUser() {
        pendingFrom = visibleCamera()
        user = .identity
        userAnim = nil
    }

    // MARK: Frames

    /// Brings the stage up to date for a frame at displayed time t: reads the clock, picks the scene, advances
    /// animations. Returns false while the stage has no size.
    func update(size newSize: CGSize, t: Double, input: WaveFrameInput, now: Double) -> Bool {
        guard newSize.width >= 2, newSize.height >= 2 else { return false }
        if newSize != size || input.focusPad != self.input?.focusPad || input.overviewPad != self.input?.overviewPad {
            size = newSize
            fontScale = min(newSize.width, newSize.height) >= 640 ? 1.15 : 1
            labels.halfHeight = 8 * fontScale
            self.input = input
            anim = nil
            if let s = scene {
                if s.overview != nil { scene = .overview(overviewScene(input)) }
                cam = camera(for: scene!, input)
            }
            labels.forget()
        }
        self.input = input
        read(t, solar: input.solar)
        let key = "\(input.words.pure)|\(input.words.wording.earth.timeZone.identifier)"
        if key != labelKey {
            labelKey = key
            labels.forget()
            years = ("", [], "")
        }
        // which scene should be on screen?
        let wantOverview = input.overview || !inRange || cur == nil
        let level = min(max(input.eff, 0), Fractonica.maxLevel)
        let sceneKey = wantOverview ? "O" : "\(level):\(cur![level].idx)"
        if scene?.key != sceneKey {
            let next: WaveScene = wantOverview ? .overview(overviewScene(input)) : .focus(engine.buildFocus(level, cur![level].idx))
            let hadScene = scene != nil
            setScene(next, input, now: now)
            if hadScene { sceneChanged(next.focus?.info, t) }
        } else if let from = pendingFrom, let s = scene, let c = cam {
            // a pinch that ended at a limit: settle from what is on screen back to the fitted camera
            pendingFrom = nil
            anim = Move(mode: .settle, from: s, to: s, map: .identity, camFrom: from, camTo: c, t0: now, dur: 0.3)
        }
        if let a = anim, now - a.t0 >= a.dur { anim = nil }
        if scrubbing, let cur, let f = scene?.focus, f.level + 1 < cur.count {
            let loop = cur[f.level + 1].idx
            if scrubLoop >= 0, loop != scrubLoop { tick() }
            scrubLoop = loop
        } else {
            scrubLoop = -1
        }
        return true
    }

    /// Draws the frame `update` prepared.
    func draw(_ g: inout GraphicsContext, now: Double) {
        guard let input, let scene, let cam else { return }
        labels.begin(stage: WaveRect(x0: 0, y0: 0, x1: size.width, y1: size.height), now: now)
        for r in input.avoid { labels.occupy(r) }
        queue.removeAll(keepingCapacity: true)
        hitArcs.removeAll(keepingCapacity: true)
        hitMarkers.removeAll(keepingCapacity: true)
        hitSun = nil
        let u = userTransform(now)
        if let a = anim {
            let c = animCamera(a, now)
            let to = c.to.adjusted(by: u, width: size.width, height: size.height)
            switch a.mode {
            case .zoom where !a.chain.isEmpty:
                // coarse to fine; each stop shows while the camera is within about a factor 6 of its own fit
                for stop in a.chain {
                    let target = stop.level == (a.to.focus?.level ?? -1)
                    let cam = target ? to : to.fromFrame(stop.map)
                    let w = WaveGeometry.clamp01(1 - abs(log(cam.scale / stop.fit)) / 1.8)
                    guard w > 0.01 else { continue }
                    if target { labelFade = WaveGeometry.clamp01((c.e - 0.45) / 0.35) }
                    drawScene(&g, stop.scene, cam, alpha: w, interactive: target, quiet: !target || c.e < 0.45, input)
                    labelFade = 1
                }
            case .zoom:
                let from = to.fromFrame(a.map)
                drawScene(&g, a.from, from, alpha: max(0, 1 - c.e * 1.15), interactive: false, quiet: true, input)
                // the target's labels wait until its figure is near its size, then fade in
                labelFade = WaveGeometry.clamp01((c.e - 0.45) / 0.35)
                drawScene(&g, a.to, to, alpha: min(1, 0.3 + c.e), interactive: true, quiet: c.e < 0.45, input)
                labelFade = 1
            case .fade:
                drawScene(&g, a.from, c.from.adjusted(by: u, width: size.width, height: size.height), alpha: 1 - c.e, interactive: false, quiet: true, input)
                drawScene(&g, a.to, to, alpha: c.e, interactive: true, quiet: false, input)
            case .settle:
                drawScene(&g, a.to, to, alpha: 1, interactive: true, quiet: false, input)
            }
        } else {
            drawScene(&g, scene, cam.adjusted(by: u, width: size.width, height: size.height), alpha: 1, interactive: true, quiet: false, input)
        }
        flushLabels(&g)
        if anim != nil || userAnim != nil || labels.settling { requestFrames(0.12) }
    }

    // MARK: Picking

    /// What lies under a stage point (src/ui/wave.js `pick`): the solar pin, a marker, else the nearest arc.
    func pick(_ p: CGPoint, touch: Bool) -> WavePick? {
        guard anim == nil else { return nil }
        let tolM = touch ? 18.0 : 10.0
        let tolA = touch ? 22.0 : 12.0
        if let s = hitSun {
            let d = hypot(p.x - s.x, p.y - s.y)
            if d <= tolM { return WavePick(kind: .sun, level: -1, idx: 0, t: 0, dist: d, x: s.x, y: s.y) }
        }
        var best: WavePick?
        for m in hitMarkers {
            let d = hypot(p.x - m.x, p.y - m.y)
            guard d <= tolM else { continue }
            if let b = best, !(d < b.dist - 0.5 || (abs(d - b.dist) <= 0.5 && m.level > b.level)) { continue }
            best = WavePick(kind: .marker, level: m.level, idx: m.idx, t: m.local, dist: d, x: m.x, y: m.y)
        }
        if best != nil { return best }
        for a in hitArcs {
            let n = a.sa.nearest(p.x, p.y, tMax: a.fraction)
            let bias = a.kind == .child ? 0.75 : 0 // the focused arc wins ties: it is the one you drag along
            if n.dist <= tolA, best == nil || n.dist + bias < best!.dist {
                let q = a.sa.point(n.t)
                best = WavePick(kind: a.kind, level: a.level, idx: a.idx, t: n.t, dist: n.dist + bias, x: q.x, y: q.y)
            }
        }
        return best
    }

    /// The time under a stage point while dragging along the focused arc (or along the catalogue wave).
    func scrubTime(_ p: CGPoint) -> Double? {
        let wanted: WavePick.Kind = scene?.overview != nil || !inRange ? .alpha : .focus
        var best: (t: Double, dist: Double, a: HitArc)?
        for a in hitArcs where a.kind == wanted {
            let n = a.sa.nearest(p.x, p.y, tMax: a.fraction)
            if best == nil || n.dist < best!.dist { best = (n.t, n.dist, a) }
        }
        guard let best else { return nil }
        let t = engine.timeAt(best.a.level, best.a.idx, best.t)
        let span = engine.halfSpan(best.a.level, best.a.idx)
        return min(span.end - 0.001, max(span.start + 0.001, t))
    }

    /// The time under a stage point while dragging the solar pin: the nearest point of the focused arc as a phase of
    /// the sync the drag began in (so it never leaves that sync).
    func pinTime(_ p: CGPoint, sync: Int) -> Double? {
        guard let s = sun, s.sync == sync, let f = scene?.focus, let a = hitArcs.first(where: { $0.kind == .focus }) else { return nil }
        let n = a.sa.nearest(p.x, p.y, tMax: a.fraction)
        let spec = WaveSolar.ArcSpec(idx: f.idx, prefix: engine.prefix(f.level), fraction: f.fraction)
        return WaveSolar.travelTime(start: s.start, end: s.end, phase: WaveSolar.pinPhase(spec, grid, t: n.t, sync: sync))
    }

    /// The depths (levels) whose current half-arc carries a solar ripple on this stage.
    func rippleDepths(pad: WavePad) -> [Int] {
        guard let cur, size.width > 2 else { return [] }
        let w = size.width
        let h = size.height
        return WaveSolar.rippleDepths(
            count: Fractonica.maxLevel + 1,
            syncsOf: { l in WaveSolar.syncsOnArc(prefix: self.engine.prefix(l), fraction: self.engine.fractionOf(l, cur[l].idx), grid: self.grid) },
            pxOf: { l in self.arcPixels(l, cur[l].idx, w, h, pad) },
            maxPx: 2.2 * max(w, h)
        )
    }

    private var pxMemo: [String: Double] = [:]

    private func arcPixels(_ level: Int, _ idx: Int64, _ w: Double, _ h: Double, _ pad: WavePad) -> Double {
        let key = "\(Int(w))x\(Int(h))|\(level)|\(idx)|\(pad.l),\(pad.r),\(pad.t),\(pad.b)"
        if let px = pxMemo[key] { return px }
        let px = engine.focusArcLength(engine.buildFocus(level, idx), width: w, height: h, pad: pad)
        if pxMemo.count > 240 { pxMemo.removeAll() }
        pxMemo[key] = px
        return px
    }

    /// Whether the ripple shows on the scene in view.
    func rippleVisible() -> Bool {
        guard let f = scene?.focus, let cam = visibleCamera() else { return false }
        let sa = WaveProjection(cam, width: size.width, height: size.height).arc(f.focus)
        return WaveSolar.rippleFit(syncs: WaveSolar.syncsOnArc(prefix: engine.prefix(f.level), fraction: f.fraction, grid: grid), arcPx: sa.length(f.fraction)).visible
    }
}
