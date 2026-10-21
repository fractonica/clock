import CoreGraphics
import Foundation

// Window maths and layout of the timeline (src/ui/timeline/helpers.js): pure values, no UI, so they are checked in
// Checks/TimelineChecks.swift. Times are Unix seconds; x and y are points of the timeline canvas.

/// What the timeline shows: the instant at its centre and its width in seconds.
struct TimelineWindow: Equatable, Sendable {
    var c: Double
    var span: Double

    var t0: Double { c - span / 2 }
    var t1: Double { c + span / 2 }

    func contains(_ t: Double) -> Bool { t >= t0 && t <= t1 }
}

/// Pan and zoom limits: the catalogue plus a margin on both sides, from `minSpan` (about two seconds across) to the
/// whole catalogue with its margins (helpers.js `limitsFor`).
struct TimelineLimits: Equatable, Sendable {
    let tMin: Double
    let tMax: Double
    /// The outer edges a window may reach.
    let d0: Double
    let d1: Double
    let minSpan: Double
    let maxSpan: Double

    /// The narrowest window: about two seconds across (helpers.js `MIN_SPAN`).
    static let narrowest = 2.0

    init(tMin: Double, tMax: Double, margin: Double = 0.03) {
        self.tMin = tMin
        self.tMax = tMax
        let m = (tMax - tMin) * margin
        d0 = tMin - m
        d1 = tMax + m
        minSpan = Self.narrowest
        maxSpan = tMax - tMin + 2 * m
    }

    /// The span kept within [minSpan, maxSpan] and the window inside [d0, d1].
    func clamp(_ w: TimelineWindow) -> TimelineWindow {
        let span = clampSpan(w.span)
        let c = min(d1 - span / 2, max(d0 + span / 2, w.c.isFinite ? w.c : (d0 + d1) / 2))
        return TimelineWindow(c: c, span: span)
    }

    func clampSpan(_ span: Double) -> Double {
        guard span.isFinite else { return maxSpan }
        return min(maxSpan, max(minSpan, span))
    }

    /// Zoom by `factor` (> 1 zooms out) keeping the time at screen fraction `frac` (0 … 1) where it is.
    func zoom(_ w: TimelineWindow, by factor: Double, at frac: Double) -> TimelineWindow {
        let p = w.t0 + frac * w.span
        let span = clampSpan(w.span * factor)
        return clamp(TimelineWindow(c: p - frac * span + span / 2, span: span))
    }

    /// The window shifted by `dt` seconds.
    func pan(_ w: TimelineWindow, by dt: Double) -> TimelineWindow {
        clamp(TimelineWindow(c: w.c + dt, span: w.span))
    }

    /// A window that shows [start, end] with `margin` (a fraction of the length) on each side.
    func fit(_ start: Double, _ end: Double, margin: Double = 0.08) -> TimelineWindow {
        let length = max(end - start, 1e-3)
        return clamp(TimelineWindow(c: (start + end) / 2, span: length * (1 + 2 * margin)))
    }

    /// The window centred on t, same span.
    func centre(_ w: TimelineWindow, on t: Double) -> TimelineWindow {
        clamp(TimelineWindow(c: t, span: w.span))
    }

    /// A window of `span` that keeps time `anchor` at screen fraction `frac`.
    func window(span: Double, anchor: Double, frac: Double) -> TimelineWindow {
        let s = clampSpan(span)
        return clamp(TimelineWindow(c: anchor - frac * s + s / 2, span: s))
    }
}

/// Window transitions (helpers.js `interpolateWindow`, `easeOutCubic`).
enum TimelineTween {
    static func easeOut(_ u: Double) -> Double {
        1 - pow(1 - min(1, max(0, u)), 3)
    }

    /// The window part-way (u in 0 … 1) from a to b. The span moves geometrically and the point both windows share
    /// stays still on screen, so a zoom feels like a zoom, not like a pan plus a resize.
    static func interpolate(_ a: TimelineWindow, _ b: TimelineWindow, _ u: Double) -> TimelineWindow {
        let la = log(a.span), lb = log(b.span)
        let span = exp(la + (lb - la) * u)
        if abs(lb - la) < 0.02 { return TimelineWindow(c: a.c + (b.c - a.c) * u, span: span) }
        let p = (b.c * a.span - a.c * b.span) / (a.span - b.span) // the screen-stationary time
        return TimelineWindow(c: p + (a.c - p) * (span / a.span), span: span)
    }

    /// How far a coasting pan has carried the centre after `elapsed` seconds: velocity `v` (seconds of time per real
    /// second) decaying as e^(−decay·τ).
    static func coast(v: Double, elapsed: Double, decay: Double = inertiaDecay) -> Double {
        v * (1 - exp(-decay * max(0, elapsed))) / decay
    }

    /// When a coast has slowed below `stopPx` points per second at `pxPerSecond` (the scale).
    static func coastDuration(v: Double, pxPerSecond k: Double, stopPx: Double = 6, decay: Double = inertiaDecay) -> Double {
        let start = abs(v) * k
        return start <= stopPx ? 0 : log(start / stopPx) / decay
    }

    /// The decay of a coasting pan, per second (src/ui/timeline.js: 4.5).
    static let inertiaDecay = 4.5
}

/// Time ↔ x of a window drawn into [x0, x0 + width]. Works from offsets to the window centre (t − c is exact for
/// nearby doubles), so a two-second window at 1.8e9 s loses nothing (helpers.js `makeScale`).
struct TimelineScale: Sendable {
    let window: TimelineWindow
    let x0: Double
    let width: Double
    /// Points per second.
    let k: Double
    let xc: Double

    init(window: TimelineWindow, x0: Double, width: Double) {
        self.window = window
        self.x0 = x0
        self.width = max(1, width)
        k = self.width / window.span
        xc = x0 + self.width / 2
    }

    func x(_ t: Double) -> Double { xc + (t - window.c) * k }
    func t(_ x: Double) -> Double { window.c + (x - xc) / k }
    /// Fraction 0 … 1 of x across the plot, clamped.
    func frac(_ x: Double) -> Double { min(1, max(0, (x - x0) / width)) }
}

/// The rows of the timeline canvas, top to bottom: the catalogue map, the axis (context row, ticks, marker flags), one
/// lane per depth and the eclipse lane; the gutter on the left holds the lane heads (helpers.js `computeLayout`).
struct TimelineLayout: Equatable, Sendable {
    enum Region: Equatable, Sendable {
        case overview, axis, eclipse, none
        case lane(Int)
    }

    let width: Double
    let height: Double
    /// Phone width: narrow gutter, short labels.
    let compact: Bool
    let gutter: Double
    /// The plot's left and right edges.
    let px0: Double
    let px1: Double
    /// The catalogue map (height 0 when there is no room for it).
    let overviewY: Double
    let overviewH: Double
    let axisY: Double
    let ctxH: Double
    let tickH: Double
    let markH: Double
    let lanesY: Double
    let laneH: Double
    let lanes: Int
    let eclipseY: Double
    let eclipseH: Double

    var plotWidth: Double { px1 - px0 }
    var showsOverview: Bool { overviewH > 0 }
    var tickY: Double { axisY + ctxH }
    var markY: Double { axisY + ctxH + tickH }
    var axisBottom: Double { axisY + ctxH + tickH + markH }
    var lanesBottom: Double { lanesY + laneH * Double(lanes) }
    var bottom: Double { eclipseY + eclipseH }

    func laneY(_ i: Int) -> Double { lanesY + Double(i) * laneH }

    /// Width below which the timeline uses its phone layout.
    static let compactWidth = 560.0
    /// The tallest a lane grows.
    static func maxLane(compact: Bool) -> Double { compact ? 46 : 112 }

    /// The layout of a canvas `width` × `height` with `lanes` lanes. Lanes share the height left by the fixed rows,
    /// within limits; when they would get too thin the catalogue map goes first, then the eclipse lane shrinks.
    init(width: Double, height: Double, lanes: Int) {
        let n = max(1, lanes)
        compact = width < Self.compactWidth
        self.width = width
        self.height = height
        self.lanes = lanes
        gutter = compact ? 54 : 96
        px0 = gutter
        px1 = max(gutter + 40, width - (compact ? 6 : 10))
        let pad = 4.0
        var overview = compact ? 30.0 : 38.0
        var eclipse = compact ? 38.0 : 48.0
        var rows = (ctx: 18.0, tick: 20.0, mark: 20.0)
        let minLane = 18.0
        let laneHeight = { (overview: Double, eclipse: Double, rows: (ctx: Double, tick: Double, mark: Double)) -> Double in
            let fixed = pad + (overview > 0 ? overview + 8 : 0) + rows.ctx + rows.tick + rows.mark + eclipse + pad
            return ((height - fixed) / Double(n)).rounded(.down)
        }
        // a short canvas (a phone in landscape) gives up the map first, then shrinks the eclipse lane and the axis
        if laneHeight(overview, eclipse, rows) < minLane { overview = 0 }
        if laneHeight(overview, eclipse, rows) < minLane { eclipse = 28 }
        if laneHeight(overview, eclipse, rows) < minLane { rows = (15, 18, 17) }
        ctxH = rows.ctx
        tickH = rows.tick
        markH = rows.mark
        overviewY = pad
        overviewH = overview
        let axis = overview > 0 ? pad + overview + 8 : pad
        axisY = axis
        let lane = min(Self.maxLane(compact: compact), max(12, laneHeight(overview, eclipse, rows)))
        laneH = lane
        lanesY = axis + rows.ctx + rows.tick + rows.mark
        eclipseY = lanesY + lane * Double(lanes)
        eclipseH = eclipse
    }

    /// Which row is at (x, y), and whether x is in the gutter.
    func region(x: Double, y: Double) -> (region: Region, gutter: Bool) {
        let gutter = x < px0
        if showsOverview, y >= overviewY, y < overviewY + overviewH { return (.overview, gutter) }
        if y >= axisY, y < lanesY { return (.axis, gutter) }
        if y >= lanesY, y < lanesBottom, laneH > 0 {
            return (.lane(min(lanes - 1, Int((y - lanesY) / laneH))), gutter)
        }
        if y >= eclipseY, y < eclipseY + eclipseH { return (.eclipse, gutter) }
        return (.none, gutter)
    }
}

/// Small searches over sorted data (helpers.js `lastStartAtOrBefore`, `nearestWithin`).
enum TimelineSearch {
    /// Index of the last element whose key is ≤ t, or −1.
    static func lastAtOrBefore<T>(_ items: [T], _ t: Double, key: (T) -> Double) -> Int {
        var lo = 0, hi = items.count - 1, answer = -1
        while lo <= hi {
            let m = (lo + hi) >> 1
            if key(items[m]) <= t {
                answer = m
                lo = m + 1
            } else {
                hi = m - 1
            }
        }
        return answer
    }

    /// Index of the element of sorted `values` nearest to t when it is within `tolerance`, else nil.
    static func nearest(_ values: [Double], _ t: Double, within tolerance: Double) -> Int? {
        var lo = 0, hi = values.count
        while lo < hi {
            let m = (lo + hi) >> 1
            if values[m] < t { lo = m + 1 } else { hi = m }
        }
        var best: Int?
        var bestDistance = tolerance
        for i in [lo - 1, lo] where i >= 0 && i < values.count {
            let d = abs(values[i] - t)
            if d <= bestDistance {
                bestDistance = d
                best = i
            }
        }
        return best
    }

    /// t rounded to the millisecond, the clock's resolution (helpers.js `roundMs`).
    static func ms(_ t: Double) -> Double { (t * 1000).rounded() / 1000 }
}
