import FractonicaKit
import SwiftUI

// The sky on the journal's wave: the diary's events at their exact moments on the curve (their symbols in their
// families' colours, eclipses larger and ringed), fewer as the wave zooms out (`JournalSkyPlacer`), tap one for its
// name and moments; and the Pentads' starts (SPEC §7.5) as gold ticks across the curve with the Pentad's shape beside
// them when there is room, the Hypopentad's longer, bolder and filled. Both are laid out once per cache rebuild, in the
// cache's coordinates; each frame draws the ticks as two paths moved into place and each mark in sight as a picture.

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
        let pentads: Bool
    }

    private(set) var marks: [JournalSkyMark] = []
    private(set) var ticks: [JournalPentadTick] = []
    private(set) var pentadTicks = Path()
    private(set) var hypopentadTicks = Path()
    private var key: Key?
    /// The marks as pictures, by kind (×2, +1 for an eclipse's larger one), for one display scale.
    private var images: [Int: JournalWaveLabels.Label] = [:]
    private var imageScale: CGFloat = 0

    func update(_ cache: JournalWaveCache, k: Double, hidden: Set<SkyFamily>, pentads: Bool) {
        let key = Key(generation: cache.generation, hidden: hidden, pentads: pentads)
        guard key != self.key else { return }
        self.key = key
        let signpost = JournalWaveSignposts.signposter.beginInterval("wave sky")
        defer { JournalWaveSignposts.signposter.endInterval("wave sky", signpost) }
        let (lo, hi) = cache.window
        // on the line that reads as the wave (the strongest; the emoji sit on the deepest, often loops riding it), so
        // ticks cross it and marks sit on it
        let zoom = cache.zoom
        let level = zoom.levels.max { zoom.weight($0) < zoom.weight($1) } ?? zoom.spine
        marks = JournalSkyPlacer.place(SkyEvents.shared, from: lo, to: hi, k: k, hidden: hidden) { t in
            cache.trace(t, through: level).map { ($0.point.x, $0.point.y) }
        }
        ticks = pentads ? JournalSkyPlacer.pentadTicks(from: lo, to: hi, k: k, clock: cache.clock) { t in
            cache.trace(t, through: level).map { ($0.point.x, $0.point.y, Double($0.normal.x), Double($0.normal.y)) }
        } : []

        var fives = Path(), fours = Path()
        for tick in ticks {
            let len = Self.tickLength(tick)
            let a = CGPoint(x: tick.x - tick.nx * len, y: tick.y - tick.ny * len)
            let b = CGPoint(x: tick.x + tick.nx * len, y: tick.y + tick.ny * len)
            if tick.isHypopentad {
                fours.move(to: a)
                fours.addLine(to: b)
            } else {
                fives.move(to: a)
                fives.addLine(to: b)
            }
        }
        pentadTicks = fives
        hypopentadTicks = fours
    }

    /// Half a tick's length across the curve: the Hypopentad's longer.
    static func tickLength(_ tick: JournalPentadTick) -> Double { tick.isHypopentad ? 11 : 7 }

    /// A Pentad's shape as a picture, made once per Pentad and display scale: the pentagon with its numeral on a dark
    /// disc; the Hypopentad's square filled, inside a fine square ring.
    func shape(_ index: Int, labels: JournalWaveLabels, scale: CGFloat) -> JournalWaveLabels.Label {
        labels.label("pentad|\(index)", scale: scale) {
            ZStack {
                if index == 3 {
                    PentadPolygon(index: 3).fill(Theme.background.opacity(0.9)).frame(width: 17, height: 17)
                    PentadPolygon(index: 3).strokeBorder(Theme.gold.opacity(0.85), lineWidth: 1.2).frame(width: 17, height: 17)
                    PentadPolygon(index: 3).fill(Theme.gold).frame(width: 9, height: 9)
                } else {
                    PentadPolygon(index: index).fill(Theme.background.opacity(0.9)).frame(width: 15, height: 15)
                    PentadBadge(index: index, size: 15, color: Theme.gold.opacity(0.9))
                }
            }
            .frame(width: 21, height: 21)
        }
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
    /// The Pentads' ticks, then the events, over the entries' emoji.
    func drawSky(_ context: inout GraphicsContext, _ zoom: JournalArcZoom, dy: Double, w: Double, h: Double, margin: Double) {
        let sky = cache.sky
        sky.update(cache, k: frame.k, hidden: skyHidden, pentads: pentadTicks)
        var moved = context
        moved.translateBy(x: 0, y: dy)

        // where each Pentad begins, a gold tick across the curve (the Hypopentad's longer and bolder) and its shape on
        // the curve's inner side where there is room
        if !sky.ticks.isEmpty {
            moved.stroke(sky.pentadTicks, with: .color(Theme.gold.opacity(0.7)), style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
            moved.stroke(sky.hypopentadTicks, with: .color(Theme.gold), style: StrokeStyle(lineWidth: 3, lineCap: .round))
            let left = margin + 2, right = w - 6
            let scale = context.environment.displayScale
            var budget = 60
            for tick in sky.ticks where tick.labelled {
                let y = tick.y + dy
                guard y > -20, y < h + 20, budget > 0 else { continue }
                budget -= 1
                let shape = sky.shape(tick.index, labels: cache.labels, scale: scale)
                let len = JournalWaveSkyLayer.tickLength(tick) + 1
                let r = shape.size.width / 2
                let c = CGPoint(x: tick.x - tick.nx * (len + r), y: y - tick.ny * (len + r))
                let x = min(right - shape.size.width, max(left, c.x - r))
                context.draw(shape.image, in: CGRect(x: x, y: c.y - shape.size.height / 2, width: shape.size.width, height: shape.size.height))
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

