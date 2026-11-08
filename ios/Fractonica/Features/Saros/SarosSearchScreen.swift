import FractonicaKit
import SwiftUI

/// The Saros search: a day (or a moment) in, the three eclipses nearest it out, of all 180 Saros series, ranked by how
/// close they come, the day's rarity by the nearest (`SarosSearch`), a timeline of the day among them and a close-up
/// of the nearest with the rarity bands round it. Keep the day as a date from here. Cycles › Saros › Search a date;
/// `-FXSarosSearch <yyyy-mm-dd[Thh:mm]>` opens it on that day at launch.
struct SarosSearchScreen: View {
    @Environment(AppSettings.self) private var settings
    @State private var day: Date
    @State private var hasTime: Bool
    @State private var keeping: SavedDate?

    init(start: Double, hasTime: Bool) {
        let t = min(SarosSearch.latest - 86_400, max(SarosSearch.earliest, start))
        _day = State(initialValue: Date(timeIntervalSince1970: t))
        _hasTime = State(initialValue: hasTime)
    }

    var body: some View {
        let zone = settings.timeZone
        let words = settings.wording
        let t = day.timeIntervalSince1970
        let query: SarosQuery = hasTime ? .moment(t) : .day(containing: t, zone: zone)
        let matches = SarosSearch.matches(query)
        List {
            Section {
                DatePicker("Date", selection: $day, in: Self.range, displayedComponents: .date)
                Toggle("Time of day", isOn: $hasTime.animation())
                if hasTime {
                    DatePicker("Time", selection: $day, displayedComponents: .hourAndMinute)
                }
            } footer: {
                Text(hasTime ? "Measured from the moment, in \(zoneName(zone))." : "Measured from the whole day, midnight to midnight in \(zoneName(zone)): an eclipse during the day is at no distance.")
            }
            .environment(\.timeZone, zone)
            .environment(\.calendar, Self.calendar(zone))

            if let nearest = matches.first {
                Section {
                    RarityHero(match: nearest, query: query, words: words)
                        .listRowInsets(EdgeInsets(top: 10, leading: 10, bottom: 10, trailing: 10))
                        .listRowBackground(Color.clear)
                }
                Section {
                    SarosSearchTimeline(query: query, matches: matches, words: words, closeUp: false)
                        .frame(height: 170)
                    SarosSearchTimeline(query: query, matches: [nearest], words: words, closeUp: true)
                        .frame(height: 150)
                } header: {
                    Text("Timeline")
                } footer: {
                    Text("Above, the day among the three eclipses; below, close up to the nearest, with the bands of each rarity round it: within a Delta rare, a Nuclide epic, 11 Helions legendary, a Helion cosmic.")
                }
                Section {
                    ForEach(Array(matches.enumerated()), id: \.element.id) { index, match in
                        NavigationLink {
                            if let series = match.series { EclipseMapScreen(series: series, ordinal: match.eclipse.ordinal) }
                        } label: {
                            SarosMatchRow(rank: index + 1, match: match, query: query, words: words)
                        }
                    }
                } header: {
                    Text("Nearest eclipses")
                }
                Section {
                    Button {
                        keeping = SavedDate(time: hasTime ? t : SavedDate.noon(of: t, zone: zone), zone: zone.identifier,
                                            allDay: !hasTime, emoji: nearest.rarity >= .epic ? "🌑" : nil)
                    } label: {
                        Label("Keep this date", systemImage: "calendar.badge.plus")
                    }
                } footer: {
                    Text("Kept dates sync with your hub; each can send echoes when it comes round again.")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Saros Search")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .sheet(item: $keeping) { date in
            DateEditor(date: date, isNew: true)
        }
    }

    static let range = Date(timeIntervalSince1970: SarosSearch.earliest)...Date(timeIntervalSince1970: SarosSearch.latest - 1)

    static func calendar(_ zone: TimeZone) -> Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = zone
        return c
    }

    private func zoneName(_ zone: TimeZone) -> String {
        settings.zone.map { TimeZoneName(identifier: $0).city } ?? zone.identifier
    }
}

// MARK: - Words

/// How the search says its distances: "2 d 4 h after the day" · pure in Fractonica units, and in Helions in both.
struct SarosSearchWords {
    let words: Wording

    /// "2 d 4 h" · pure "10η 3ι".
    func span(_ match: SarosMatch) -> String {
        words.duration(abs(match.offset), at: match.eclipse.time, parts: 2)
    }

    /// "0.25 Helions", "10.4 Helions", "828 Helions" (two decimals below 1, one below 100, whole above).
    static func helions(_ h: Double) -> String {
        let n = h < 1 ? String(format: "%.2f", h) : h < 100 ? String(format: "%.1f", h) : String(Int(h.rounded()))
        return n == "1.0" ? "1 Helion" : "\(n) Helions"
    }

    /// "2 d 4 h after the day", "during the day", "3 h before the moment".
    func relation(_ match: SarosMatch, query: SarosQuery) -> String {
        let what = query.isDay ? "the day" : "the moment"
        if match.offset == 0 { return query.isDay ? "during the day" : "at the moment" }
        return "\(span(match)) \(match.offset > 0 ? "after" : "before") \(what)"
    }

    /// "Total eclipse of Saros 145 #21".
    static func name(_ e: SarosEclipse) -> String {
        "\(e.type.kind.title) eclipse of Saros \(e.series) #\(e.ordinal)"
    }

    /// "21 Aug 2017" (UTC) · pure its stamp to the Nuclide on the reference clock, else "Saros 145 #21".
    func day(_ e: SarosEclipse) -> String {
        if words.pure {
            return words.notation.model.inRange(e.time) ? words.notation.stamp(at: e.time, upTo: "epsilon") : "Saros \(e.series) #\(e.ordinal)"
        }
        let p = EarthFormatter(timeZone: .gmt).parts(e.time)
        return "\(p.day) \(EarthTime.monthsShort[p.month - 1]) \(p.year)"
    }
}

// MARK: - The rarity

/// The day's rarity, large, in its frame: which eclipse makes it and how close, and the scale of rarities.
private struct RarityHero: View {
    let match: SarosMatch
    let query: SarosQuery
    let words: Wording

    var body: some View {
        let rarity = match.rarity
        let say = SarosSearchWords(words: words)
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                RarityBadge(rarity: rarity)
                Spacer()
                SarosBadge(series: match.eclipse.series)
            }
            Text(rarity.title)
                .font(.reading(34, weight: .bold))
                .foregroundStyle(rarity == .cosmic ? AnyShapeStyle(LinearGradient(colors: MomentRarity.rainbow, startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(rarity == .common ? Theme.ink : rarity.color))
            Text(sentence(say))
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            RarityScale(current: rarity)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel.opacity(0.75), in: .rect(cornerRadius: 22, style: .continuous))
        .rarityFrame(rarity, turns: true)
        .accessibilityElement(children: .combine)
    }

    private func sentence(_ say: SarosSearchWords) -> String {
        let e = match.eclipse
        let name = SarosSearchWords.name(e)
        let distance = SarosSearchWords.helions(match.helions)
        let within = SarosProximity.limitText(of: match.rarity).map { ", within \($0)" } ?? ", farther than a Delta"
        if match.offset == 0 {
            return "The \(name.prefix(1).lowercased() + name.dropFirst()) falls \(query.isDay ? "on this very day" : "at this very moment")."
        }
        return "The \(name.prefix(1).lowercased() + name.dropFirst()) comes \(say.relation(match, query: query)): \(distance) of its series\(within)."
    }
}

/// The five rarities and the Helions within which each holds, the current one lit.
private struct RarityScale: View {
    let current: MomentRarity

    var body: some View {
        let tiers: [(MomentRarity, String)] = [(.cosmic, "≤ 1η"), (.legendary, "≤ 11η"), (.epic, "≤ 77η"), (.rare, "≤ 385η"), (.common, "farther")]
        HStack(spacing: 4) {
            ForEach(tiers, id: \.0) { rarity, limit in
                VStack(spacing: 3) {
                    Image(systemName: rarity.symbol)
                        .font(.system(size: 11, weight: .bold))
                    Text(limit)
                        .font(.code(10, weight: rarity == current ? .bold : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .foregroundStyle(rarity == current ? rarity.color : Theme.ink3)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
                .background(rarity == current ? rarity.color.opacity(0.16) : Theme.panel3.opacity(0.5), in: .rect(cornerRadius: 8))
            }
        }
        .accessibilityHidden(true)
    }
}

/// "Saros 145" in a capsule.
struct SarosBadge: View {
    let series: Int
    var compact = false

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "circle.lefthalf.filled")
                .font(.system(size: compact ? 8 : 10, weight: .bold))
            Text("SAROS \(series)")
                .font(.system(size: compact ? 9 : 11, weight: .heavy))
                .kerning(compact ? 0.6 : 0.9)
        }
        .foregroundStyle(Theme.teal)
        .padding(.horizontal, compact ? 7 : 9)
        .padding(.vertical, compact ? 3 : 4)
        .background(Theme.teal.opacity(0.13), in: .capsule)
        .overlay(Capsule().stroke(Theme.teal.opacity(0.4), lineWidth: 0.5))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Saros \(series)")
    }
}

// MARK: - The eclipses

/// One eclipse found: its rank, map, series and kind, date, how far from the query, and the rarity it gives.
struct SarosMatchRow: View {
    let rank: Int
    let match: SarosMatch
    let query: SarosQuery
    let words: Wording

    var body: some View {
        let e = match.eclipse
        let say = SarosSearchWords(words: words)
        HStack(spacing: 12) {
            EclipseThumbnail(eclipse: e, side: 54)
                .overlay(alignment: .topLeading) {
                    Text("\(rank)")
                        .font(.code(11, weight: .bold))
                        .foregroundStyle(Theme.ink)
                        .frame(width: 18, height: 18)
                        .background(Theme.panel3, in: .circle)
                        .overlay(Circle().stroke(Theme.line2, lineWidth: 0.5))
                        .offset(x: -6, y: -6)
                }
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("Saros \(e.series)")
                        .font(.reading(16, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                    Text("#\(e.ordinal)")
                        .font(.code(12))
                        .foregroundStyle(Theme.ink2)
                    Spacer(minLength: 4)
                    RarityBadge(rarity: match.rarity, compact: true)
                }
                .lineLimit(1)
                HStack(spacing: 6) {
                    Text(SarosWords.type(e))
                        .foregroundStyle(EclipseArt.color(e.type.kind))
                    Text(say.day(e))
                        .font(.code(12))
                        .foregroundStyle(Theme.ink2)
                }
                .font(.caption)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                Text("\(say.relation(match, query: query)) · \(SarosSearchWords.helions(match.helions))")
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The timeline

/// The query among eclipses on a line of time: each eclipse a tick in its kind's colour with its map above and its
/// series and day below, the query a red line (a whole day a red band), faint ticks of the reference clock's periods.
/// Close up (`closeUp`), the stretch round the one eclipse given, with the bands of each rarity round it.
struct SarosSearchTimeline: View {
    let query: SarosQuery
    let matches: [SarosMatch]
    let words: Wording
    let closeUp: Bool

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let span = self.span
            let x = { (t: Double) -> Double in 16 + (size.width - 32) * (t - span.lowerBound) / (span.upperBound - span.lowerBound) }
            let axis = closeUp ? size.height * 0.48 : size.height * 0.56
            ZStack(alignment: .topLeading) {
                Canvas { context, size in
                    draw(&context, size: size, x: x, axis: axis, span: span)
                }
                if !closeUp {
                    ForEach(matches) { match in
                        EclipseThumbnail(eclipse: match.eclipse, side: 40)
                            .position(x: x(match.eclipse.time), y: axis - 46)
                    }
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(closeUp ? "Close up of the nearest eclipse with the rarity bands" : "The day among the three nearest eclipses")
    }

    /// The stretch shown: the query and the eclipses with room either side; close up, the nearest eclipse with the
    /// query, at least the legendary band either side.
    private var span: ClosedRange<Double> {
        if closeUp, let m = matches.first {
            let helion = m.helions > 0 ? abs(m.offset) / m.helions : 18_189
            let reach = max(abs(m.offset) * 1.35, 13 * helion, (query.end - query.start) * 0.8)
            let mid = m.eclipse.time
            return (mid - reach)...(mid + reach)
        }
        let times = matches.map(\.eclipse.time) + [query.start, query.end]
        let lo = times.min() ?? query.start, hi = times.max() ?? query.end
        let pad = max((hi - lo) * 0.12, 5 * 86_400)
        return (lo - pad)...(hi + pad)
    }

    private func draw(_ context: inout GraphicsContext, size: CGSize, x: (Double) -> Double, axis: Double, span: ClosedRange<Double>) {
        // rarity bands round each eclipse, rarest innermost; close up, each named at its right edge, from the inside
        // out, where there is room, up to the first that runs off the strip
        for match in matches {
            let helion = SarosCatalogue.anySeries(match.eclipse.series)?.helion(near: match.eclipse.ordinal, after: match.offset < 0) ?? 18_189
            for (limit, rarity) in SarosProximity.tiers.reversed() {
                let a = x(match.eclipse.time - limit * helion), b = x(match.eclipse.time + limit * helion)
                guard b - a >= 1.5 else { continue }
                let band = CGRect(x: a, y: axis - 14, width: b - a, height: 28)
                context.fill(Path(roundedRect: band, cornerRadius: 5), with: .color(rarity.color.opacity(closeUp ? 0.2 : 0.13)))
            }
            guard closeUp else { continue }
            var lastLabel = -Double.infinity
            for (limit, rarity) in SarosProximity.tiers {
                let b = x(match.eclipse.time + limit * helion)
                let edge = min(size.width - 4, b - 3)
                guard b - x(match.eclipse.time) > 14, edge - lastLabel > 58 else { continue }
                let label = Text(rarity.title).font(.system(size: 9, weight: .semibold)).foregroundStyle(rarity.color)
                context.draw(label, at: CGPoint(x: edge, y: axis - 17), anchor: .bottomTrailing)
                lastLabel = edge
                if b - 3 > size.width - 4 { break }
            }
        }

        // the reference clock's periods, faint
        let clock = FractonicaClock.shared
        let length = span.upperBound - span.lowerBound
        if let level = [2, 3, 4, 5, 6].first(where: { length / clock.levelInfo($0).meanSeconds >= 3 }), clock.inRange(span.lowerBound) || clock.inRange(span.upperBound) {
            let marks = clock.boundaries(level: level, from: span.lowerBound, to: span.upperBound, limit: 60)
            for mark in marks {
                let px = x(mark.time)
                context.stroke(Path { $0.move(to: CGPoint(x: px, y: axis - 5)); $0.addLine(to: CGPoint(x: px, y: axis + 5)) },
                               with: .color(Theme.line2), lineWidth: 1)
            }
            let letter = Text(Fractonica.periodName(level).text).font(.system(size: 10, weight: .medium)).foregroundStyle(Theme.ink3)
            context.draw(letter, at: CGPoint(x: size.width - 6, y: axis + 9), anchor: .topTrailing)
        }

        // the line of time
        context.stroke(Path { $0.move(to: CGPoint(x: 8, y: axis)); $0.addLine(to: CGPoint(x: size.width - 8, y: axis)) },
                       with: .color(Theme.line2), lineWidth: 1.2)

        // the query: a band for the day, a line for the moment
        let qa = x(query.start), qb = x(query.end)
        if query.isDay, qb - qa >= 2 {
            context.fill(Path(CGRect(x: qa, y: axis - 20, width: qb - qa, height: 40)), with: .color(Theme.now.opacity(0.22)))
        }
        let qx = (qa + qb) / 2
        context.stroke(Path { $0.move(to: CGPoint(x: qx, y: axis - 22)); $0.addLine(to: CGPoint(x: qx, y: axis + 22)) },
                       with: .color(Theme.now), style: StrokeStyle(lineWidth: 2, lineCap: .round))
        let tag = Text(query.isDay ? "this day" : "this moment").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.now)
        context.draw(tag, at: CGPoint(x: min(size.width - 34, max(34, qx)), y: axis + 26), anchor: .top)

        // the eclipses
        for match in matches {
            let e = match.eclipse
            let px = x(e.time)
            let color = EclipseArt.color(e.type.kind)
            context.stroke(Path { $0.move(to: CGPoint(x: px, y: axis - 12)); $0.addLine(to: CGPoint(x: px, y: axis + 12)) },
                           with: .color(color), style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
            let dot = Path(ellipseIn: CGRect(x: px - 5, y: axis - 5, width: 10, height: 10))
            context.fill(dot, with: .color(color))
            context.stroke(dot, with: .color(Theme.background), lineWidth: 1.5)
            guard !closeUp else {
                let name = Text("Saros \(e.series) · \(SarosWords.type(e))").font(.system(size: 11, weight: .semibold)).foregroundStyle(color)
                context.draw(name, at: CGPoint(x: min(size.width - 60, max(60, px)), y: size.height - 4), anchor: .bottom)
                continue
            }
            // below the query's tag, alternately, so neighbours do not overwrite each other
            let near = abs(px - qx) < 70
            let y = axis + (near ? 44 : 20)
            let label = Text("S\(e.series)").font(.system(size: 11, weight: .bold)).foregroundStyle(color)
            context.draw(label, at: CGPoint(x: min(size.width - 22, max(22, px)), y: y), anchor: .top)
            let day = Text(SarosSearchWords(words: words).day(e)).font(.system(size: 9, weight: .medium)).foregroundStyle(Theme.ink3)
            context.draw(day, at: CGPoint(x: min(size.width - 40, max(40, px)), y: y + 14), anchor: .top)
        }
    }
}
