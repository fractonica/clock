import FractonicaKit
import Synchronization
import SwiftUI

/// An eclipse's outline on the sphere, read once: the central path as areas, a partial eclipse's limits as lines, the
/// point of greatest eclipse, and where a map of it centres and how far it reaches.
struct EclipseShape: Sendable {
    let eclipse: SarosEclipse
    let path: EclipsePath?
    /// The central path's rings, counterclockwise (`SphereRing.counterclockwise`); empty for a partial eclipse.
    let areas: [SphereRing]
    /// A partial eclipse's limits.
    let lines: [SphereRing]
    let greatest: Vec3
    /// The middle of the outline (the greatest point when there is none) and the angle (radians) that holds it all.
    let center: Vec3
    let extent: Double

    init(_ eclipse: SarosEclipse, path: EclipsePath?) {
        self.eclipse = eclipse
        self.path = path
        let rings = (path?.rings ?? []).filter { $0.count > 2 }.map { SphereRing($0.map(\.vector)) }
        if path?.isPartial ?? true {
            areas = []
            lines = rings
        } else {
            areas = rings.map { $0.counterclockwise() }
            lines = []
        }
        greatest = GeoPoint(lon: eclipse.longitude, lat: eclipse.latitude).vector
        let all = rings.flatMap(\.points)
        let center = all.isEmpty ? greatest : normalized(all.reduce(Vec3.zero, +))
        self.center = center
        extent = all.isEmpty ? 0 : acos(max(-1, min(1, all.map { dot($0, center) }.min() ?? 1)))
    }

    /// Read once and kept, by eclipse.
    static func of(_ eclipse: SarosEclipse) -> EclipseShape {
        if let hit = cache.withLock({ $0[eclipse.id] }) { return hit }
        let shape = EclipseShape(eclipse, path: SarosPaths.path(of: eclipse))
        cache.withLock { $0[eclipse.id] = shape }
        return shape
    }

    private static let cache = Mutex<[Int: EclipseShape]>([:])

    /// A gnomonic view centred on the outline that holds it with a margin: from 4° across for the narrowest to 60°
    /// (a longer path runs off the edges; gnomonic stretches anything farther out), 30° round a point with no path.
    func fit(in size: CGSize, r: Double = 0, margin: Double = 0.86) -> MapProjection {
        let angle = extent > 0 ? min(60, max(4, extent * 180 / .pi * 1.08)) * .pi / 180 : 30 * .pi / 180
        var p = MapProjection(center: GeoPoint(center), r: r, scale: 1, size: size)
        p.scale = p.scale(showing: angle, at: Double(min(size.width, size.height)) / 2 * margin)
        return p
    }
}

/// How much of the world a map draws.
enum MapDetail: Sendable {
    /// Thumbnails, and the map while a finger moves it: the 1:110m land only.
    case coarse
    /// The 1:50m land, its lakes and the countries' borders.
    case full
}

/// A map of an eclipse, clipped and projected for one projection: what a `Canvas` fills and strokes.
struct EclipseArt: Sendable {
    let projection: MapProjection
    let rim: Path
    let land: Path
    let lakes: Path
    let borders: Path
    let graticule: Path
    let pathArea: Path
    let pathLines: Path
    let greatest: CGPoint?
    let kind: SarosEclipseType.Kind

    init(_ shape: EclipseShape, projection: MapProjection, detail: MapDetail, graticule step: Double? = 15, borders: Bool = true) {
        self.projection = projection
        let clipper = MapClipper(projection)
        rim = clipper.rimPath
        switch detail {
        case .coarse:
            land = clipper.areas(WorldMap.layer(.coarseLand).rings)
            lakes = Path()
            self.borders = Path()
        case .full:
            land = clipper.areas(WorldMap.layer(.land).rings)
            lakes = clipper.areas(WorldMap.layer(.lakes).rings)
            self.borders = borders ? clipper.lines(WorldMap.layer(.borders).rings, closed: true) : Path()
        }
        graticule = step.map { clipper.lines(EclipseArt.graticule(step: $0)) } ?? Path()
        pathArea = clipper.areas(shape.areas)
        pathLines = clipper.lines(shape.lines, closed: true)
        let g = projection.view(shape.greatest, clipper.axes)
        greatest = g.z >= clipper.z0 ? projection.screen(g) : nil
        kind = shape.eclipse.type.kind
    }

    /// The graticule's lines, made once a spacing.
    static func graticule(step: Double) -> [SphereRing] {
        if let hit = graticules.withLock({ $0[step] }) { return hit }
        let lines = WorldMap.graticule(step: step)
        graticules.withLock { $0[step] = lines }
        return lines
    }

    private static let graticules = Mutex<[Double: [SphereRing]]>([:])

    /// The colour of an eclipse of each kind: total gold, annular teal, hybrid blue, partial grey.
    static func color(_ kind: SarosEclipseType.Kind) -> Color {
        switch kind {
        case .total: Theme.gold
        case .annular: Theme.teal
        case .hybrid: Theme.cursor
        case .partial: Theme.ink3
        }
    }

    /// Draws the map: the sea inside the rim, land, lakes, borders, the graticule, the path and its greatest point.
    func draw(in context: inout GraphicsContext, lineScale: CGFloat = 1) {
        context.fill(rim, with: .color(Theme.background2))
        context.fill(land, with: .color(Theme.line2), style: FillStyle(eoFill: true))
        context.fill(lakes, with: .color(Theme.background2), style: FillStyle(eoFill: true))
        context.stroke(borders, with: .color(Theme.ink3.opacity(0.45)), lineWidth: 0.5 * lineScale)
        context.stroke(graticule, with: .color(Theme.ink3.opacity(0.22)), lineWidth: 0.5 * lineScale)
        let tint = Self.color(kind)
        context.fill(pathArea, with: .color(tint.opacity(0.42)), style: FillStyle(eoFill: true))
        context.stroke(pathArea, with: .color(tint), lineWidth: 1 * lineScale)
        context.stroke(pathLines, with: .color(tint), style: StrokeStyle(lineWidth: 1.2 * lineScale, dash: [3 * lineScale, 2 * lineScale]))
        if let g = greatest {
            let r = 3.2 * lineScale
            let dot = Path(ellipseIn: CGRect(x: g.x - r, y: g.y - r, width: 2 * r, height: 2 * r))
            context.fill(dot, with: .color(tint))
            context.stroke(dot, with: .color(Theme.background), lineWidth: 1 * lineScale)
        }
        context.stroke(rim, with: .color(Theme.line2), lineWidth: 1 * lineScale)
    }
}

/// A small gnomonic map of an eclipse, its path in the middle: clipped and projected away from the main thread the
/// first time it is shown, then kept.
struct EclipseThumbnail: View {
    let eclipse: SarosEclipse
    var side: CGFloat = 56
    @State private var art: EclipseArt?

    init(eclipse: SarosEclipse, side: CGFloat = 56) {
        self.eclipse = eclipse
        self.side = side
        _art = State(initialValue: Self.cached(eclipse, side: side))
    }

    var body: some View {
        Canvas { context, _ in
            guard let art else { return }
            var context = context
            art.draw(in: &context, lineScale: 0.7)
        }
        .frame(width: side, height: side)
        .background(Theme.background2)
        .clipShape(RoundedRectangle(cornerRadius: side * 0.18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: side * 0.18, style: .continuous).strokeBorder(Theme.line2, lineWidth: 0.5)
        }
        .task(id: eclipse.id) {
            if let hit = Self.cached(eclipse, side: side) {
                art = hit
                return
            }
            let (eclipse, side) = (eclipse, side)
            art = await Task.detached(priority: .userInitiated) { Self.make(eclipse, side: side) }.value
        }
        .accessibilityHidden(true)
    }

    nonisolated private struct Key: Hashable, Sendable {
        let id: Int
        let side: Double
    }

    nonisolated private static let cache = Mutex<[Key: EclipseArt]>([:])

    nonisolated static func cached(_ eclipse: SarosEclipse, side: CGFloat) -> EclipseArt? {
        cache.withLock { $0[Key(id: eclipse.id, side: side)] }
    }

    /// The thumbnail's map: the 1:110m land, a 10° graticule, the path.
    nonisolated static func make(_ eclipse: SarosEclipse, side: CGFloat) -> EclipseArt {
        if let hit = cached(eclipse, side: side) { return hit }
        let shape = EclipseShape.of(eclipse)
        let size = CGSize(width: side, height: side)
        let art = EclipseArt(shape, projection: shape.fit(in: size), detail: .coarse, graticule: 10, borders: false)
        cache.withLock {
            if $0.count > 800 { $0.removeAll() }
            $0[Key(id: eclipse.id, side: side)] = art
        }
        return art
    }
}
