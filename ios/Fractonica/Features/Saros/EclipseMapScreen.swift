import FractonicaKit
import SwiftUI

/// An eclipse's path on a map of the world: an azimuthal perspective projection centred on the path (gnomonic by
/// default, where the path's centre line, nearly a great circle, runs straight; stereographic; or the globe seen from
/// outside), drawn over Natural Earth's land, lakes and borders and a graticule. Drag to move it, pinch to zoom,
/// double-tap to fit the path again; the arrows step through the series. The figures of the eclipse sit below.
struct EclipseMapScreen: View {
    let series: SarosSeries
    @State private var ordinal: Int
    @Environment(AppSettings.self) private var settings

    /// Where the person moved and zoomed the map to; nil while it shows the path as fitted.
    @State private var center: GeoPoint?
    @State private var zoom: Double = 1
    @State private var projectionR: Double = 0
    @State private var showsBorders = true
    @State private var showsGraticule = true
    /// The map as the gesture found it, and whether a finger is on it (the map draws the coarse land meanwhile).
    @State private var gestureStart: (center: GeoPoint, zoom: Double)?
    @State private var moving = false

    init(series: SarosSeries, ordinal: Int) {
        self.series = series
        _ordinal = State(initialValue: ordinal)
        // -FXSarosProjection gnomonic | stereographic | globe: open with that projection
        let named = ["gnomonic": 0.0, "stereographic": -1.0, "globe": -3.0]
        _projectionR = State(initialValue: JournalLaunch.string("FXSarosProjection").flatMap { named[$0] } ?? 0)
    }

    private var eclipse: SarosEclipse { series.eclipses[ordinal] }

    var body: some View {
        let words = SarosWords(words: settings.wording)
        let shape = EclipseShape.of(eclipse)
        VStack(spacing: 0) {
            GeometryReader { geometry in
                let projection = self.projection(shape, size: geometry.size)
                Canvas { context, _ in
                    var context = context
                    EclipseArt(shape, projection: projection, detail: moving ? .coarse : .full,
                               graticule: showsGraticule ? graticuleStep(projection) : nil, borders: showsBorders)
                        .draw(in: &context)
                }
                .contentShape(Rectangle())
                .gesture(drag(projection).simultaneously(with: pinch(projection)))
                .onTapGesture(count: 2) { withAnimation(.snappy) { reset() } }
                .accessibilityLabel("Map of the eclipse's path")
                .accessibilityHint("Drag to move, pinch to zoom, double-tap to fit the path")
            }
            .background(Theme.background)
            .clipped()
            EclipseFigures(eclipse: eclipse, path: shape.path, words: words)
        }
        .background { Backdrop() }
        .navigationTitle("Saros \(series.number) · #\(eclipse.ordinal)")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button { step(-1) } label: { Label("Previous eclipse", systemImage: "chevron.left") }
                    .disabled(ordinal == 0)
                Button { step(1) } label: { Label("Next eclipse", systemImage: "chevron.right") }
                    .disabled(ordinal == series.eclipses.count - 1)
                Menu {
                    Picker("Projection", selection: $projectionR) {
                        Text("Gnomonic").tag(0.0)
                        Text("Stereographic").tag(-1.0)
                        Text("Globe").tag(-3.0)
                    }
                    Toggle("Borders", isOn: $showsBorders)
                    Toggle("Graticule", isOn: $showsGraticule)
                    Button("Fit the path") { withAnimation(.snappy) { reset() } }
                } label: {
                    Label("Map", systemImage: "globe")
                }
            }
        }
    }

    /// The map's projection: fitted to the path, then moved and zoomed by the person.
    private func projection(_ shape: EclipseShape, size: CGSize) -> MapProjection {
        var p = shape.fit(in: size, r: projectionR)
        if let center { p.center = center }
        p.scale *= zoom
        return p
    }

    /// Graticule lines every 30°, 15°, 10° or 5°, closer as the map zooms in.
    private func graticuleStep(_ p: MapProjection) -> Double {
        let degrees = p.clipAngle * 180 / .pi
        return degrees > 70 ? 30 : degrees > 35 ? 15 : degrees > 15 ? 10 : 5
    }

    private func drag(_ projection: MapProjection) -> some Gesture {
        DragGesture(minimumDistance: 2)
            .onChanged { value in
                if gestureStart == nil { gestureStart = (projection.center, zoom) }
                moving = true
                guard let start = gestureStart else { return }
                var from = projection
                from.center = start.center
                let middle = CGPoint(x: from.size.width / 2 - value.translation.width, y: from.size.height / 2 - value.translation.height)
                if let moved = from.unproject(middle) {
                    center = GeoPoint(lon: moved.lon, lat: max(-89.9, min(89.9, moved.lat)))
                }
            }
            .onEnded { _ in
                gestureStart = nil
                moving = false
            }
    }

    private func pinch(_ projection: MapProjection) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                if gestureStart == nil { gestureStart = (projection.center, zoom) }
                moving = true
                zoom = max(0.25, min(60, (gestureStart?.zoom ?? 1) * value.magnification))
            }
            .onEnded { _ in
                gestureStart = nil
                moving = false
            }
    }

    private func reset() {
        center = nil
        zoom = 1
    }

    private func step(_ by: Int) {
        let next = ordinal + by
        guard series.eclipses.indices.contains(next) else { return }
        ordinal = next
        reset()
    }
}

/// The figures of an eclipse under its map.
private struct EclipseFigures: View {
    let eclipse: SarosEclipse
    let path: EclipsePath?
    let words: SarosWords

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(SarosWords.type(eclipse))
                    .font(Font.reading(18, weight: .semibold))
                    .foregroundStyle(EclipseArt.color(eclipse.type.kind))
                Text(eclipse.type.label)
                    .font(Font.code(13))
                    .foregroundStyle(Theme.ink3)
                Spacer()
                Text(words.relative(eclipse, now: Date.now.timeIntervalSince1970))
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            }
            Text(words.date(eclipse))
                .font(Font.code(14))
                .foregroundStyle(Theme.ink)
            LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading), GridItem(.flexible(), alignment: .leading)], spacing: 6) {
                if let duration = words.duration(eclipse) { figure("Central duration", duration) }
                if let width = path?.centralWidthKm { figure("Path width", "\(width) km") }
                if let magnitude = path?.magnitude { figure("Magnitude", String(format: "%.4f", magnitude)) }
                if let gamma = path?.gamma { figure("Gamma", String(format: "%+.4f", gamma)) }
                figure("Greatest eclipse", coordinates)
                figure("Sun's altitude", "\(eclipse.sunAltitude)°")
            }
            if path == nil {
                Text("No path drawn: the path data covers 1582 to 2500. The dot marks greatest eclipse.")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel)
    }

    private var coordinates: String {
        let lat = eclipse.latitude, lon = eclipse.longitude
        return String(format: "%.1f° %@, %.1f° %@", abs(lat), lat < 0 ? "S" : "N", abs(lon), lon < 0 ? "W" : "E")
    }

    private func figure(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(Theme.ink3)
            Text(value)
                .font(Font.code(13))
                .foregroundStyle(Theme.ink2)
        }
    }
}
