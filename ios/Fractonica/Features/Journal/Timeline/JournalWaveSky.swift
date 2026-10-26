import FractonicaKit
import SwiftUI

// The sky on the journal's wave: the diary's events at their exact moments on the curve (their symbols in their
// families' colours, eclipses larger and ringed), fewer as the wave zooms out (`JournalSkyPlacer`), tap one for its
// name and moments; and the solar sync's quarter thresholds (SPEC §7, as the Wave screen's ripple marks them) as gold
// ticks across the curve, named when there is room. Both are laid out once per cache rebuild, in the cache's
// coordinates, and only moved while the wave scrolls.

/// A sky event tapped on the wave: the popover's subject and where its mark is.
struct JournalWaveSkyChoice: Identifiable, Equatable {
    let event: SkyEvent
    let x: Double
    let y: Double
    let radius: Double
    var id: String { event.id }
}

/// A sky mark as drawn, for taps (view coordinates).
struct JournalWaveSkyHit: Equatable {
    let event: SkyEvent
    let x: Double
    let y: Double
    let radius: Double
}

/// The sky's marks and ticks for the cache's window, rebuilt with it (or when the families shown change).
@MainActor
final class JournalWaveSkyLayer {
    private struct Key: Equatable {
        let generation: Int
        let hidden: Set<SkyFamily>
        let solar: Bool
    }

    private(set) var marks: [JournalSkyMark] = []
    private(set) var ticks: [JournalSolarTick] = []
    private var key: Key?

    func update(_ cache: JournalWaveCache, k: Double, hidden: Set<SkyFamily>, solar: Bool) {
        let key = Key(generation: cache.generation, hidden: hidden, solar: solar)
        guard key != self.key else { return }
        self.key = key
        let signpost = JournalWaveSignposts.signposter.beginInterval("wave sky")
        defer { JournalWaveSignposts.signposter.endInterval("wave sky", signpost) }
        let (lo, hi) = cache.window
        // on the finest line that clearly shows (the emoji sit on the deepest, which may be loops too small to see)
        let zoom = cache.zoom
        let level = zoom.levels.last { zoom.weight($0) >= JournalSkyPlacer.lineWeight } ?? zoom.spine
        marks = JournalSkyPlacer.place(SkyEvents.shared, from: lo, to: hi, k: k, hidden: hidden) { t in
            cache.trace(t, through: level).map { ($0.point.x, $0.point.y) }
        }
        ticks = solar ? JournalSkyPlacer.solarTicks(from: lo, to: hi, k: k, clock: cache.clock) { t in
            cache.trace(t, through: level).map { ($0.point.x, $0.point.y, Double($0.normal.x), Double($0.normal.y)) }
        } : []
    }
}

extension JournalWavePainter {
    /// The solar ticks, then the events, under the entries' emoji.
    func drawSky(_ context: inout GraphicsContext, _ zoom: JournalArcZoom, dy: Double, w: Double, h: Double, margin: Double) {
        let sky = cache.sky
        sky.update(cache, k: frame.k, hidden: skyHidden, solar: solarTicks)
        let scale = context.environment.displayScale
        let left = margin + 2, right = w - 6

        // solar ticks across the curve: gold, the syncs' ends longer
        if !sky.ticks.isEmpty {
            var quarters = Path(), ends = Path()
            var named: [(Image, CGRect)] = []
            var budget = 40
            for tick in sky.ticks {
                let y = tick.y + dy
                guard y > -20, y < h + 20 else { continue }
                let len = tick.isEnd ? 10.0 : 7.0
                var line = Path()
                line.move(to: CGPoint(x: tick.x - tick.nx * len, y: y - tick.ny * len))
                line.addLine(to: CGPoint(x: tick.x + tick.nx * len, y: y + tick.ny * len))
                if tick.isEnd { ends.addPath(line) } else { quarters.addPath(line) }
                guard tick.labelled, budget > 0, y > 0, y < h - 30 else { continue }
                budget -= 1
                let text = tick.isEnd ? "☉ end #\(tick.sync)" : "☉ \(tick.name)"
                let label = cache.labels.label("sun|\(text)", scale: scale) {
                    Text(verbatim: text)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(Theme.gold.opacity(0.9))
                        .padding(.horizontal, 3)
                        .background(Theme.background.opacity(0.72), in: .capsule)
                }
                // on the inner side of the curve, clear of the tick
                let c = CGPoint(x: tick.x - tick.nx * (len + 4 + label.size.width / 2), y: y - tick.ny * (len + 4 + label.size.height / 2))
                let x = min(right - label.size.width, max(left, c.x - label.size.width / 2))
                named.append((label.image, CGRect(x: x, y: c.y - label.size.height / 2, width: label.size.width, height: label.size.height)))
            }
            context.stroke(quarters, with: .color(Theme.gold.opacity(0.75)), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
            context.stroke(ends, with: .color(Theme.gold), style: StrokeStyle(lineWidth: 2.6, lineCap: .round))
            for (image, rect) in named { context.draw(image, in: rect) }
        }

        // the events: a dark disc on the curve, the symbol in its family's colour; eclipses bigger, ringed, glowing
        var hits: [JournalWaveSkyHit] = []
        for mark in sky.marks {
            let y = mark.y + dy
            guard y > -mark.radius - 6, y < h + mark.radius + 6 else { continue }
            let event = mark.event
            let r = mark.radius
            var faded = context
            faded.opacity = mark.alpha
            let colour = event.family.color
            let eclipse = event.tier == .eclipse
            if eclipse {
                faded.fill(Path(ellipseIn: CGRect(x: mark.x - r - 6, y: y - r - 6, width: 2 * r + 12, height: 2 * r + 12)),
                           with: .radialGradient(Gradient(colors: [colour.opacity(0.45), colour.opacity(0)]), center: CGPoint(x: mark.x, y: y),
                                                 startRadius: r - 2, endRadius: r + 6))
            }
            let disc = Path(ellipseIn: CGRect(x: mark.x - r, y: y - r, width: 2 * r, height: 2 * r))
            faded.fill(disc, with: .color(Theme.background.opacity(0.92)))
            faded.stroke(disc, with: .color(colour.opacity(eclipse ? 0.95 : 0.55)), lineWidth: eclipse ? 1.6 : 1)
            let symbol = cache.labels.label("sky|\(event.kind)|\(eclipse)", scale: scale) {
                Text(verbatim: SkyStyle.text(event.symbol))
                    .font(.system(size: eclipse ? 14 : 10.5, weight: .semibold))
                    .foregroundStyle(colour)
            }
            faded.draw(symbol.image, in: CGRect(x: mark.x - symbol.size.width / 2, y: y - symbol.size.height / 2,
                                                width: symbol.size.width, height: symbol.size.height))
            if mark.alpha > 0.4, y > -r, y < h + r { hits.append(JournalWaveSkyHit(event: event, x: mark.x, y: y, radius: r)) }
        }
        model.hits.sky = hits
    }
}
