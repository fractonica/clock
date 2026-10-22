import SwiftUI

/// The countdown dial: an outer teal ring draining with the whole timer, and inside it one segmented phase ring per
/// unit of the readout, coarse outside to fine inside. A ring has a segment per unit in the next one up (77η in an ε,
/// 36ι in an η, 65λ in an ι, 25ν in a λ), with a wider gap at each depth between (ζ = 11η, θ = 4ι, κ = 13λ, μ = 5ν);
/// the lit segments are the count left, so "02ι 13λ 07ν" lights 2, 13 and 7, and the segment being used up shrinks
/// as it goes. The finest ring turns once per its parent (a Blink ring empties every Flavon), the coarse ones crawl.
///
/// Drawn in three layers so that each redraws only as often as it changes: the dim track (once), the steady lit
/// segments (once per Blink) and the moving parts, the outer ring and the shrinking segments (every frame; once per
/// Blink, whole segments only, under Reduce Motion).
struct TimerDial: View {
    let run: TimerRun
    let clock: RealClock
    /// The readout's units, coarse to fine.
    let units: [LadderUnit]
    var reduceMotion = false

    /// The radius inside the innermost ring, as a fraction of half the dial, for laying out the readout.
    static func innerRadius(rings: Int) -> CGFloat {
        TimerDialGeometry.innerRadius(rings: rings)
    }

    var body: some View {
        let paused = !run.isRunning
        let blink = clock.blinkSeconds(at: .now) ?? clock.clock.levelInfo(LadderUnit.nu.level).meanSeconds
        let perBlink = TickSchedule(anchor: run.end ?? .now, steps: [blink], paused: paused)
        ZStack {
            TimerDialTrack(units: units)
            TimelineView(perBlink) { context in
                TimerDialSegments(
                    units: units,
                    lit: units.map { lit($0, blinks: run.remainingBlinks(at: context.date, clock: clock)) }
                )
            }
            if reduceMotion {
                TimelineView(perBlink) { motion($0.date, partials: false) }
            } else {
                TimelineView(.animation(minimumInterval: 1.0 / 60, paused: paused)) { motion($0.date, partials: true) }
            }
        }
        .opacity(paused ? 0.6 : 1)
        .accessibilityHidden(true)
    }

    /// Segments lit for the whole of the Blink now running (Reduce Motion: exactly the readout's counts).
    private func lit(_ unit: LadderUnit, blinks: Double?) -> Int {
        reduceMotion
            ? Int(TimerDialGeometry.ringValue(blinks: blinks, unit: unit, whole: true))
            : TimerDialGeometry.steadySegments(blinks: blinks, unit: unit)
    }

    private func motion(_ now: Date, partials: Bool) -> TimerDialMotion {
        let blinks = run.remainingBlinks(at: now, clock: clock)
        return TimerDialMotion(
            fraction: run.fraction(at: now, clock: clock),
            units: units,
            values: partials ? units.map { TimerDialGeometry.movingValue(blinks: blinks, unit: $0) } : [],
            paused: !run.isRunning
        )
    }
}

/// The dial's still parts: the outer ring's track and every segment, dim.
private struct TimerDialTrack: View {
    let units: [LadderUnit]

    var body: some View {
        Canvas { context, size in
            let s = min(size.width, size.height)
            guard s > 20 else { return }
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let g = TimerDialGeometry(rings: units.count, side: s)
            context.stroke(TimerDialPaths.circle(c, g.outerRadius), with: .color(Theme.line), lineWidth: g.outerWidth)
            var track = Path()
            for (i, u) in units.enumerated() {
                let r = g.ringRadius(i)
                for a in TimerDialGeometry.segments(u, radius: r, width: g.ringWidth) {
                    TimerDialPaths.sector(&track, c, r, g.ringWidth, a.lowerBound, a.upperBound)
                }
            }
            context.fill(track, with: .color(Theme.line.opacity(0.8)))
        }
    }
}

/// The segments that stay lit through the current Blink.
private struct TimerDialSegments: View, Equatable {
    let units: [LadderUnit]
    let lit: [Int]

    var body: some View {
        Canvas { context, size in
            let s = min(size.width, size.height)
            guard s > 20 else { return }
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let g = TimerDialGeometry(rings: units.count, side: s)
            for (i, u) in units.enumerated() where lit[i] > 0 {
                let r = g.ringRadius(i)
                var path = Path()
                for a in TimerDialGeometry.segments(u, radius: r, width: g.ringWidth).prefix(lit[i]) {
                    TimerDialPaths.sector(&path, c, r, g.ringWidth, a.lowerBound, a.upperBound)
                }
                context.fill(path, with: .color(Theme.levelColor(u.level).opacity(0.9)))
            }
        }
    }
}

/// The parts that move every frame: the outer ring draining with the whole timer and the segment of each ring being
/// used up.
private struct TimerDialMotion: View {
    /// What is left of the whole timer, 1 … 0.
    let fraction: Double
    let units: [LadderUnit]
    /// Each ring's value (whole segments and the fraction of the one being used up); empty for whole segments only.
    let values: [Double]
    let paused: Bool

    var body: some View {
        Canvas { context, size in
            let s = min(size.width, size.height)
            guard s > 20 else { return }
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let unit = s / 320
            let g = TimerDialGeometry(rings: units.count, side: s)

            let f = min(1, max(0, fraction))
            if f > 0 {
                let r = g.outerRadius, w = g.outerWidth
                let end = Angle.degrees(-90 + 360 * f)
                var arc = Path()
                arc.addArc(center: c, radius: r, startAngle: .degrees(-90), endAngle: end, clockwise: false)
                // a soft glow as wider faint strokes (a shadow filter would render offscreen every frame)
                let glow = paused ? 0.5 : 1.0
                context.stroke(arc, with: .color(Theme.teal.opacity(0.06 * glow)), style: StrokeStyle(lineWidth: w + 13 * unit, lineCap: .round))
                context.stroke(arc, with: .color(Theme.teal.opacity(0.1 * glow)), style: StrokeStyle(lineWidth: w + 7 * unit, lineCap: .round))
                context.stroke(arc, with: .color(Theme.teal.opacity(0.18 * glow)), style: StrokeStyle(lineWidth: w + 3 * unit, lineCap: .round))
                context.stroke(arc, with: .color(Theme.teal), style: StrokeStyle(lineWidth: w, lineCap: .round))
                context.fill(TimerDialPaths.circle(TimerDialPaths.point(c, r, end.radians), w * 0.62), with: .color(Theme.ink))
            }

            for (i, u) in units.enumerated() where i < values.count {
                let value = values[i]
                let whole = Int(value.rounded(.down))
                let part = value - Double(whole)
                guard whole < u.perParent, part > 0.002 else { continue }
                let r = g.ringRadius(i)
                let a = TimerDialGeometry.segment(u, whole, radius: r, width: g.ringWidth)
                var path = Path()
                TimerDialPaths.sector(&path, c, r, g.ringWidth, a.lowerBound, a.lowerBound + (a.upperBound - a.lowerBound) * part)
                context.fill(path, with: .color(Theme.levelColor(u.level).opacity(0.7)))
            }
        }
    }
}

/// Path helpers of the dial.
private enum TimerDialPaths {
    /// The band `width` wide around radius `r` from angle `a0` to `a1` (radians, clockwise on screen), as its own
    /// closed subpath (stroked arcs in one path would join up).
    static func sector(_ path: inout Path, _ c: CGPoint, _ r: CGFloat, _ width: CGFloat, _ a0: Double, _ a1: Double) {
        guard a1 > a0 else { return }
        let ro = r + width / 2, ri = r - width / 2
        path.move(to: point(c, ro, a0))
        path.addArc(center: c, radius: ro, startAngle: .radians(a0), endAngle: .radians(a1), clockwise: false)
        path.addLine(to: point(c, ri, a1))
        path.addArc(center: c, radius: ri, startAngle: .radians(a1), endAngle: .radians(a0), clockwise: true)
        path.closeSubpath()
    }

    static func circle(_ c: CGPoint, _ r: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
    }

    static func point(_ c: CGPoint, _ r: CGFloat, _ a: Double) -> CGPoint {
        CGPoint(x: c.x + r * CGFloat(cos(a)), y: c.y + r * CGFloat(sin(a)))
    }
}
