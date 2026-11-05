import FractonicaKit
import SwiftUI

/// A solar sync's Helions on a clock dial (`HelionDial`): an hour ring in local time, and inside it a spiral from the
/// sync's start (inner end) to its end (outer end), one turn a day (two on a 12-hour dial). Each Helion is a stretch of
/// the spiral, alternately shaded, gone ones dimmed; its ascending node (start) a filled dot, its descending node
/// (middle) a ring; a gold bar where a Pentad begins; the red hand points at now. Pure mode keeps Earth's hours off the
/// ring: the Sun marks noon and the Moon midnight.
struct HelionDialView: View {
    let dial: HelionDial
    let now: Double
    var hours: Int = 24
    var pure = false
    /// Helion names on the track and Pentad numerals beside its bars (when there is room).
    var detailed = true

    var body: some View {
        Canvas { context, size in
            draw(in: &context, size: size)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement()
        .accessibilityLabel(accessibilityText)
    }

    private var accessibilityText: String {
        guard let current = dial.helions.first(where: { $0.start <= now && now < $0.end }) else {
            return "The Helions of a solar sync on a \(hours)-hour dial"
        }
        return "The Helions of the solar sync on a \(hours)-hour dial; now in \(current.label), Pentad \(current.pentad + 1)"
    }

    // MARK: - Drawing

    private func draw(in context: inout GraphicsContext, size: CGSize) {
        let side = min(size.width, size.height)
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        let R = side / 2 - 1
        face(&context, c: c, R: R)

        let r0 = R * 0.22, r1 = R * 0.72
        let turns = max(1, (dial.end - dial.start) / (Double(hours) * 3600))
        let spacing = (r1 - r0) / turns
        let width = min(14, max(2.5, spacing * 0.62))
        let radius = { (t: Double) in r0 + (r1 - r0) * dial.progress(t) }
        let point = { (t: Double, r: Double) -> CGPoint in
            let a = dial.angle(t, hours: hours)
            return CGPoint(x: c.x + r * sin(a), y: c.y - r * cos(a))
        }

        // the faint spiral the sync runs along, beyond its Helions too (clipped syncs at the catalogue's ends)
        for (i, helion) in dial.helions.enumerated() {
            let steps = 64
            var path = Path()
            path.addLines((0...steps).map { k in
                let t = helion.start + (helion.end - helion.start) * Double(k) / Double(steps)
                return point(t, radius(t))
            })
            let gone = helion.end <= now
            let current = helion.start <= now && now < helion.end
            let tone = Theme.levelColor(HelionDial.helionLevel, opacity: i % 2 == 0 ? 1 : 0.62)
            context.stroke(path, with: .color(gone ? tone.opacity(0.32) : tone),
                           style: StrokeStyle(lineWidth: current ? width * 1.12 : width, lineCap: .butt, lineJoin: .round))
        }

        // Pentads begin
        for helion in dial.helions where helion.place == 1 {
            let r = radius(helion.start)
            let a = dial.angle(helion.start, hours: hours)
            let inner = CGPoint(x: c.x + (r - width * 0.95) * sin(a), y: c.y - (r - width * 0.95) * cos(a))
            let outer = CGPoint(x: c.x + (r + width * 0.95) * sin(a), y: c.y - (r + width * 0.95) * cos(a))
            context.stroke(Path { $0.move(to: inner); $0.addLine(to: outer) }, with: .color(Theme.gold), lineWidth: max(1.5, width * 0.22))
        }

        // nodes: ascending filled, descending a ring
        let dot = max(1.6, width * 0.36)
        for helion in dial.helions {
            for (t, ascending) in [(helion.start, true), (helion.node, false)] {
                let p = point(t, radius(t))
                let circle = Path(ellipseIn: CGRect(x: p.x - dot, y: p.y - dot, width: 2 * dot, height: 2 * dot))
                let ink = t <= now ? Theme.ink.opacity(0.45) : Theme.ink
                if ascending {
                    context.fill(circle, with: .color(ink))
                } else {
                    context.fill(circle, with: .color(Theme.background))
                    context.stroke(circle, with: .color(ink), lineWidth: max(1, dot * 0.45))
                }
            }
        }

        // names on the track, numerals beside the Pentad bars
        if detailed, width >= 9 {
            for helion in dial.helions {
                let t = helion.start + (helion.end - helion.start) * 0.72
                let text = Text(helion.label).font(.system(size: width * 0.72, weight: .semibold, design: .rounded))
                    .foregroundStyle(Theme.background)
                context.draw(text, at: point(t, radius(t)))
            }
        }
        // each Pentad's mark on a ring just outside the spiral, on its bar's hour
        if detailed {
            let ring = r1 + width * 0.5 + (R - 21 - r1 - width * 0.5) * 0.42
            for helion in dial.helions where helion.place == 1 {
                let a = dial.angle(helion.start, hours: hours)
                let mark = Text.pentadMark(helion.pentad).font(.system(size: max(8, min(12, R * 0.062)), weight: .bold))
                    .foregroundStyle(helion.start <= now ? Theme.gold.opacity(0.55) : Theme.gold)
                context.draw(mark, at: CGPoint(x: c.x + ring * sin(a), y: c.y - ring * cos(a)))
            }
        }

        // now: a hand from the centre to the hour ring, a dot where the sync is
        if now >= dial.start && now <= dial.end {
            let a = dial.angle(now, hours: hours)
            let tip = CGPoint(x: c.x + (R * 0.84) * sin(a), y: c.y - (R * 0.84) * cos(a))
            context.stroke(Path { $0.move(to: c); $0.addLine(to: tip) }, with: .color(Theme.now), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
            let p = point(now, radius(now))
            let d = max(3, width * 0.5)
            let marker = Path(ellipseIn: CGRect(x: p.x - d, y: p.y - d, width: 2 * d, height: 2 * d))
            context.fill(marker, with: .color(Theme.now))
            context.stroke(marker, with: .color(Theme.background), lineWidth: 1.2)
        }
        let hub = Path(ellipseIn: CGRect(x: c.x - 3, y: c.y - 3, width: 6, height: 6))
        context.fill(hub, with: .color(Theme.now))
    }

    /// The dial: its disc, a tick each hour (and quarter hour on a 24-hour dial, five minutes on a 12-hour one), the
    /// numerals, or in pure mode the Sun at noon and the Moon at midnight.
    private func face(_ context: inout GraphicsContext, c: CGPoint, R: Double) {
        let disc = Path(ellipseIn: CGRect(x: c.x - R, y: c.y - R, width: 2 * R, height: 2 * R))
        context.fill(disc, with: .color(Theme.panel))
        context.stroke(disc, with: .color(Theme.line2), lineWidth: 1)
        let minor = hours == 24 ? 96 : 144
        for k in 0..<minor {
            let a = Double(k) / Double(minor) * 2 * .pi
            let major = k % (minor / hours) == 0
            let r0 = R - (major ? 9 : 4.5), r1 = R - 2
            context.stroke(Path {
                $0.move(to: CGPoint(x: c.x + r0 * sin(a), y: c.y - r0 * cos(a)))
                $0.addLine(to: CGPoint(x: c.x + r1 * sin(a), y: c.y - r1 * cos(a)))
            }, with: .color(major ? Theme.ink2 : Theme.line2), lineWidth: major ? 1.4 : 0.8)
        }
        let numeralRadius = R - 21
        let size = max(9, min(15, R * 0.075))
        if pure {
            let marks: [(Double, String)] = hours == 24 ? [(0, "☾"), (0.5, "☀︎")] : [(0, "☀︎ ☾")]
            for (fraction, symbol) in marks {
                let a = fraction * 2 * .pi
                context.draw(Text(symbol).font(.system(size: size * 1.2)).foregroundStyle(Theme.gold),
                             at: CGPoint(x: c.x + numeralRadius * sin(a), y: c.y - numeralRadius * cos(a)))
            }
            return
        }
        let step = hours == 24 && R < 150 ? 2 : 1
        for h in stride(from: 0, to: hours, by: step) {
            let a = Double(h) / Double(hours) * 2 * .pi
            let label = hours == 12 && h == 0 ? "12" : "\(h)"
            context.draw(Text(label).font(.system(size: size, weight: .medium, design: .rounded)).foregroundStyle(Theme.ink2),
                         at: CGPoint(x: c.x + numeralRadius * sin(a), y: c.y - numeralRadius * cos(a)))
        }
    }
}

