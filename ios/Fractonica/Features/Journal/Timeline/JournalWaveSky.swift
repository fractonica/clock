import FractonicaKit
import SwiftUI

// The sky on the journal's wave: the diary's events at their exact moments on the curve (their symbols in their
// families' colours, eclipses larger and ringed), fewer as the wave zooms out (`JournalSkyPlacer`), tap one for its
// name and moments; and the solar sync's quarter thresholds (SPEC §7, as the Wave screen's ripple marks them) as gold
// ticks across the curve, named when there is room. Both are laid out once per cache rebuild, in the cache's
// coordinates; each frame draws the ticks as two paths moved into place and each mark in sight as a picture.

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

/// The sky's marks and ticks for the cache's window, rebuilt with it (or when the families shown change), with the
/// ticks' paths and the marks' pictures.
@MainActor
final class JournalWaveSkyLayer {
    private struct Key: Equatable {
        let generation: Int
        let hidden: Set<SkyFamily>
        let solar: Bool
    }

    private(set) var marks: [JournalSkyMark] = []
    private(set) var ticks: [JournalSolarTick] = []
    private(set) var quarterTicks = Path()
    private(set) var endTicks = Path()
    private var key: Key?
    /// The marks as pictures, by kind (×2, +1 for an eclipse's larger one), for one display scale.
    private var images: [Int: JournalWaveLabels.Label] = [:]
    private var imageScale: CGFloat = 0

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

        var quarters = Path(), ends = Path()
        for tick in ticks {
            let len = tick.isEnd ? 10.0 : 7.0
            if tick.isEnd {
                ends.move(to: CGPoint(x: tick.x - tick.nx * len, y: tick.y - tick.ny * len))
                ends.addLine(to: CGPoint(x: tick.x + tick.nx * len, y: tick.y + tick.ny * len))
            } else {
                quarters.move(to: CGPoint(x: tick.x - tick.nx * len, y: tick.y - tick.ny * len))
                quarters.addLine(to: CGPoint(x: tick.x + tick.nx * len, y: tick.y + tick.ny * len))
            }
        }
        quarterTicks = quarters
        endTicks = ends
    }

    /// A kind's mark as a picture, made once per kind, size and display scale: a dark disc ringed in the family's colour
    /// with the symbol on it; an eclipse's larger, with a glow.
    func image(_ event: SkyEvent, eclipse: Bool, labels: JournalWaveLabels, scale: CGFloat) -> JournalWaveLabels.Label {
        if scale != imageScale {
            images.removeAll()
            imageScale = scale
        }
        let id = event.kind * 2 + (eclipse ? 1 : 0)
        if let hit = images[id] { return hit }
        let r = eclipse ? JournalSkyPlacer.eclipseRadius : JournalSkyPlacer.radius
        let colour = event.family.color
        let label = labels.label("sky|\(id)", scale: scale) {
            ZStack {
                if eclipse {
                    Circle().stroke(colour.opacity(0.28), lineWidth: 7).frame(width: 2 * r, height: 2 * r)
                }
                Circle().fill(Theme.background.opacity(0.92)).frame(width: 2 * r, height: 2 * r)
                Circle().stroke(colour.opacity(eclipse ? 0.95 : 0.55), lineWidth: eclipse ? 1.6 : 1).frame(width: 2 * r, height: 2 * r)
                Text(verbatim: SkyStyle.text(event.symbol))
                    .font(.system(size: eclipse ? 14 : 10.5, weight: .semibold))
                    .foregroundStyle(colour)
            }
            .frame(width: 2 * r + 8, height: 2 * r + 8)
        }
        images[id] = label
        return label
    }
}

extension JournalWavePainter {
    /// The solar ticks, then the events, under the entries' emoji.
    func drawSky(_ context: inout GraphicsContext, _ zoom: JournalArcZoom, dy: Double, w: Double, h: Double, margin: Double) {
        let sky = cache.sky
        sky.update(cache, k: frame.k, hidden: skyHidden, solar: solarTicks)
        var moved = context
        moved.translateBy(x: 0, y: dy)

        // solar ticks across the curve: gold, the syncs' ends longer; their names where there is room
        if !sky.ticks.isEmpty {
            moved.stroke(sky.quarterTicks, with: .color(Theme.gold.opacity(0.75)), style: StrokeStyle(lineWidth: 1.8, lineCap: .round))
            moved.stroke(sky.endTicks, with: .color(Theme.gold), style: StrokeStyle(lineWidth: 2.6, lineCap: .round))
            let left = margin + 2, right = w - 6
            let scale = context.environment.displayScale
            var budget = 40
            for tick in sky.ticks where tick.labelled {
                let y = tick.y + dy
                guard y > 0, y < h - 30, budget > 0 else { continue }
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
                let len = (tick.isEnd ? 10.0 : 7.0) + 4
                let c = CGPoint(x: tick.x - tick.nx * (len + label.size.width / 2), y: y - tick.ny * (len + label.size.height / 2))
                let x = min(right - label.size.width, max(left, c.x - label.size.width / 2))
                context.draw(label.image, in: CGRect(x: x, y: c.y - label.size.height / 2, width: label.size.width, height: label.size.height))
            }
        }

        // the events: a dark disc on the curve ringed in the family's colour (eclipses glowing), the symbol on it
        guard !sky.marks.isEmpty else {
            model.hits.sky = []
            return
        }
        // the marks in sight, each a picture made once per kind (the disc, its ring, the symbol; an eclipse's glow)
        let scale = context.environment.displayScale
        var hits: [JournalWaveSkyHit] = []
        for mark in sky.marks {
            let y = mark.y + dy
            let r = mark.radius
            guard y > -r - 6, y < h + r + 6 else { continue }
            let image = sky.image(mark.event, eclipse: mark.event.tier == .eclipse, labels: cache.labels, scale: scale)
            let rect = CGRect(x: mark.x - image.size.width / 2, y: y - image.size.height / 2, width: image.size.width, height: image.size.height)
            if mark.alpha >= 0.99 {
                context.draw(image.image, in: rect)
            } else {
                var faded = context
                faded.opacity = mark.alpha
                faded.draw(image.image, in: rect)
            }
            if mark.alpha > 0.4 { hits.append(JournalWaveSkyHit(event: mark.event, x: mark.x, y: y, radius: r)) }
        }
        model.hits.sky = hits
    }
}

