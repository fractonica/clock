import FractonicaKit
import SwiftUI

/// The card that follows the pointer (iPad, Mac) or the finger held down (iPhone) — the web timeline's tooltips:
///
/// - over the plot: the moment under it, its position, how far it is from now and from the cursor, the cycle of the
///   lane under it (start → end and length; pure: its name, place and when it ends) and every lane's cycle there —
///   Earth: place in the parent and percent; pure: a major period's place and quarter word, a minor depth's placing
///   count and its phase pair;
/// - over an eclipse marker: that eclipse; over the catalogue map: the moment there;
/// - over a lane head, the ruler key, the map's or the Saros lane's head: what that row is.
struct TimelineInspector: View {
    let frame: TimelineFrame
    let hover: TimelineHover
    let data: TimelineData

    @State private var size = CGSize(width: 230, height: 200)

    /// Whole percent through a cycle, floored so a running cycle never reads 100 (helpers.js `percentThrough`).
    static func percent(_ fraction: Double) -> Int {
        guard fraction > 0 else { return 0 }
        return min(999, Int((fraction * 1000 + 1e-7).rounded(.down))) / 10
    }

    private var clock: FractonicaClock { data.clock }
    private var words: TimelineWords { frame.words }

    var body: some View {
        content
            .padding(12)
            .frame(width: cardWidth, alignment: .leading)
            .glassSurface(.regular, in: .rect(cornerRadius: 16))
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .offset(offset)
            .allowsHitTesting(false)
            .transition(.opacity)
            .accessibilityHidden(true)
    }

    private var cardWidth: CGFloat {
        let base: CGFloat = frame.layout.compact ? 214 : 240
        let gutter = hover.x < frame.layout.px0
        return min(frame.layout.width - 12, (gutter ? base + 40 : base) * frame.textScale)
    }

    // The card's type follows the canvas's text scale (1 … 1.28 with Dynamic Type), not the full Dynamic Type range: it
    // is a transient tooltip of fixed width beside the drawing it describes, and its rows must stay aligned.
    private func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size * frame.textScale, weight: weight) }
    private func num(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .reading(size * frame.textScale, weight: weight) }
    private func code(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .code(size * frame.textScale, weight: weight) }

    private var offset: CGSize {
        let L = frame.layout
        var x: Double, y: Double
        if hover.touch {
            x = hover.x - size.width / 2
            y = hover.y - size.height - 36
            if y < 4 { y = hover.y + 44 }
        } else {
            x = hover.x + 16
            y = hover.y + 18
            if x + size.width > L.width - 6 { x = hover.x - size.width - 16 }
            if y + size.height > L.height - 6 { y = hover.y - size.height - 14 }
        }
        x = min(L.width - size.width - 6, max(6, x))
        y = min(max(4, L.height - size.height - 4), max(4, y))
        return CGSize(width: x, height: y)
    }

    // MARK: What the card says

    @ViewBuilder
    private var content: some View {
        let L = frame.layout
        let (region, gutter) = L.region(x: hover.x, y: hover.y)
        if gutter {
            switch region {
            case .lane(let i) where i < frame.levels.count:
                let level = frame.levels[i]
                let info = clock.levelInfo(level)
                let letter = Text(info.letter).foregroundStyle(Theme.levelColor(level, lightness: 0.74))
                let depth = Text("depth \(info.depth)").foregroundStyle(Theme.ink2)
                explanation(title: Text("\(letter)  \(depth)"),
                            body: words.laneTip(level, alphaCycles: data.alpha.count),
                            hint: level == frame.selected ? "Selected in every view." : "Tap to select this depth in every view.")
            case .axis:
                if case .ruler(let step) = frame.axis {
                    explanation(title: Text("Ruler"), body: words.rulerTip(step, ruler: data.ruler), hint: nil)
                } else {
                    explanation(title: Text("Calendar"), body: words.zoneTip(at: frame.window.c), hint: nil)
                }
            case .eclipse:
                explanation(title: Text("Saros 141").foregroundStyle(Theme.teal), body: words.sarosTip, hint: nil)
            case .overview:
                explanation(title: Text("Catalogue map"), body: words.mapTip, hint: nil)
            default:
                EmptyView()
            }
        } else {
            switch region {
            case .overview: mapCard
            case .eclipse:
                if let k = eclipseUnder { eclipseCard(k) } else { plotCard(frame.scale.t(hover.x), lane: nil) }
            case .lane(let i): plotCard(frame.scale.t(hover.x), lane: i)
            default: plotCard(frame.scale.t(hover.x), lane: nil)
            }
        }
    }

    private func explanation(title: Text, body: String, hint: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            title.font(ui(15, .semibold)).foregroundStyle(Theme.ink)
            Text(body)
                .font(ui(12))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if let hint {
                Text(hint)
                    .font(ui(11))
                    .foregroundStyle(Theme.ink3)
            }
        }
    }

    /// The eclipse marker under the pointer (9 points; a finger 16), if any.
    private var eclipseUnder: Int? {
        let tolerance = (hover.touch ? 16 : 9) / frame.scale.k
        return TimelineSearch.nearest(clock.catalogue, frame.scale.t(hover.x), within: tolerance)
    }

    private var mapCard: some View {
        let lim = data.limits
        let L = frame.layout
        let t = lim.d0 + (hover.x - L.px0) / L.plotWidth * (lim.d1 - lim.d0)
        let inside = clock.inRange(t)
        let head: String
        if words.pure {
            head = inside ? words.notation.dateText(at: t, form: "full", upTo: "delta") : "Outside the Saros 141 catalogue"
        } else {
            head = words.earth.date(t)
        }
        return VStack(alignment: .leading, spacing: 4) {
            Text(head)
                .font(words.pure ? ui(15, .semibold) : num(13, .semibold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if inside, let pos = clock.position(at: t) {
                Text(String(format: "pos %.3f", pos)).font(num(11)).foregroundStyle(Theme.ink2)
            }
            Text("Tap to centre the timeline here · drag the frame to scroll")
                .font(ui(11))
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func eclipseCard(_ k: Int) -> some View {
        let e = clock.catalogue[k]
        let alpha = k % 4 == 0
        return VStack(alignment: .leading, spacing: 4) {
            let name = Text("Eclipse \(Notation.eclipseName(k))").foregroundStyle(Theme.teal)
            let of = Text("one of \(clock.catalogue.count)").foregroundStyle(Theme.ink2)
            Text("\(name)  \(of)")
                .font(ui(15, .semibold))
            if words.pure {
                Text("pos \(k) · in \(data.ruler.chain(at: e, from: 0, to: 1))")
                    .font(num(11))
                    .foregroundStyle(Theme.ink)
            } else {
                Text.ledByPentad(at: e, "\(words.earth.long(e)) \(words.earth.tag(e))")
                    .font(num(11))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let starts = words.pure ? " · starts \(Notation.periodName(level: 0, ordinal: k / 4 + 1))" : " · starts α cycle \(k / 4 + 1)"
            Text("Greatest eclipse of Saros 141" + (words.pure ? "" : " · position \(k)") + (alpha ? starts : ""))
                .font(ui(12))
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            Text("now · \(relative(e, frame.now))")
                .font(num(11))
                .foregroundStyle(Theme.ink2)
            Text("Tap for details")
                .font(ui(11))
                .foregroundStyle(Theme.ink3)
        }
    }

    // MARK: The plot

    private func plotCard(_ t: Double, lane: Int?) -> some View {
        let inRange = clock.inRange(t)
        return VStack(alignment: .leading, spacing: 6) {
            (inRange ? Text.ledByPentad(at: t, head(t)) : Text(head(t)))
                .font(num(13, .semibold))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            if !inRange {
                Text(words.pure ? "The catalogue spans \(words.catalogueRange); the clock is not extrapolated."
                                : "Outside the Saros 141 catalogue (\(words.catalogueRange)). The clock is not extrapolated.")
                    .font(ui(12))
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(alignment: .leading, spacing: 1) {
                    if let pos = clock.position(at: t) { Text(positionLine(pos)) }
                    Text("now · \(relative(t, frame.now))")
                    if !frame.live, frame.cursorIn { Text("cursor · \(relative(t, frame.cursor))") }
                }
                .font(num(11))
                .foregroundStyle(Theme.ink2)
                if let lane, lane < frame.levels.count, let r = clock.level(at: t, frame.levels[lane]) {
                    focus(level: frame.levels[lane], reading: r, at: t)
                }
                Divider().overlay(Theme.line2)
                Grid(alignment: .leading, horizontalSpacing: 10, verticalSpacing: 3) {
                    ForEach(Array(frame.levels.enumerated()), id: \.element) { i, level in
                        if let r = clock.level(at: t, level) {
                            row(level: level, reading: r, on: i == lane)
                        }
                    }
                }
            }
        }
    }

    /// "pos 22.123456 · Saros interval 23 of 70" · pure "pos 22.123456 · between #22 and #23".
    private func positionLine(_ pos: Double) -> String {
        let k = min(clock.extent - 1, Int(pos.rounded(.down)))
        let tail = words.pure ? "between \(Notation.eclipseName(k)) and \(Notation.eclipseName(k + 1))" : "Saros interval \(k + 1) of \(clock.extent)"
        return String(format: "pos %.6f · ", pos) + tail
    }

    /// Earth: the date and time (milliseconds when zoomed in deep) and the zone; pure: the date in words, two units
    /// finer than the ticks (over major ticks every major period with its quarter).
    private func head(_ t: Double) -> String {
        if words.pure {
            guard clock.inRange(t) else { return "Outside the Saros 141 catalogue" }
            let tick = frame.rulerUnit
            let units = data.ruler.units
            let upTo = units[min(units.count - 1, max(TimelineRuler.delta, tick + 2))].id
            return words.notation.dateText(at: t, form: tick <= TimelineRuler.delta ? "full" : "short", upTo: upTo)
        }
        let ms = TimelineSearch.ms(t)
        let precise = frame.window.span < 60
        return words.earth.long(ms, seconds: true) + (precise ? String(format: ".%03d", words.earth.parts(ms).ms) : "")
            + " " + words.earth.tag(ms)
    }

    private func relative(_ t: Double, _ ref: Double) -> String {
        words.pure ? data.ruler.relText(t, to: ref) : EarthTime.countdown(t - ref)
    }

    /// The cycle of the lane under the pointer: Earth "ε 5 · 3/5 · Oct 1 03:12 → Oct 17 08:44 · 16.2 d"; pure its name
    /// (a major period with its quarter), place and end ("ends in 3ε 12η → Delta Tetrafracton begins").
    private func focus(level: Int, reading r: LevelReading, at t: Double) -> some View {
        let info = clock.levelInfo(level)
        let color = Theme.levelColor(level, lightness: 0.78)
        let title: String, facts: String
        if words.pure {
            let names = data.names(level, r.cycle)
            let last = r.end >= clock.tMax - 1e-3
            let into = words.endsInto(level: level, idx: r.cycle, names: { data.names($0, $1) })
            let ends = last ? "ends with the catalogue" : "ends \(data.ruler.relText(r.end, to: t)) → \(into) begins"
            if Notation.isMajor(level) {
                title = words.notation.majorText(at: t, level: level)
                facts = [names.short, "\(r.local + 1)/\(r.siblings)", ends].joined(separator: " · ")
            } else {
                title = names.name
                let kind = Notation.levelKind(level)
                let lasts = kind == "between" || kind == "sub" ? "lasts \(words.notation.cycleLength(level: level)) · " : ""
                facts = lasts + ends
            }
        } else {
            let refYear = words.earth.parts(t).year
            title = "\(r.local + 1)/\(r.siblings)"
            facts = "\(words.earth.short(r.start, refYear: refYear)) → \(words.earth.short(r.end, refYear: refYear)) · \(TimelineWords.cycleLength(r.end - r.start))"
        }
        return VStack(alignment: .leading, spacing: 2) {
            let head = Text("\(info.letter) \(info.depth)").foregroundStyle(color)
            Text("\(head)  \(Text(title).foregroundStyle(Theme.ink))")
                .font(num(12, .semibold))
            Text(facts)
                .font(ui(12))
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func row(level: Int, reading r: LevelReading, on: Bool) -> some View {
        let info = clock.levelInfo(level)
        let color = Theme.levelColor(level, lightness: on ? 0.8 : 0.72)
        GridRow {
            Text("\(info.letter) \(info.depth)")
                .font(code(11, on ? .bold : .medium))
                .foregroundStyle(color)
            if words.pure {
                if Notation.isMajor(level) {
                    Text("\(r.local + 1)/\(r.siblings) \(Notation.quarterWords[r.quarter])")
                        .font(num(11, on ? .semibold : .regular))
                        .foregroundStyle(Theme.ink)
                        .gridCellColumns(2)
                } else {
                    Text(data.names(level, r.cycle).short)
                        .font(num(11, on ? .semibold : .regular))
                        .foregroundStyle(Theme.ink)
                    PairView(fraction: r.phase, color: color, height: 10)
                        .gridColumnAlignment(.trailing)
                }
            } else {
                Text("\(r.local + 1)/\(r.siblings)")
                    .font(num(11, on ? .semibold : .regular))
                    .foregroundStyle(Theme.ink)
                Text("\(Self.percent(r.progress))%")
                    .font(num(11))
                    .foregroundStyle(Theme.ink2)
                    .gridColumnAlignment(.trailing)
            }
        }
    }
}
