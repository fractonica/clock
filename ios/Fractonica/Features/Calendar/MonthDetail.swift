import FractonicaKit
import SwiftUI

// The month's companions: the detail of a day (every boundary on it at its time of day, with travel actions) and the
// year ribbon (12 months with the δ and ε boundaries of the year, the displayed instant, a summary).

/// A day in detail: an inspector column on iPad and Mac, a sheet on iPhone.
struct DayDetailView: View {
    let model: MonthModel
    let zone: TimeZone

    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        ScrollView {
            if let ref = model.selectedDay {
                content(ref)
                    .padding(16)
            } else {
                ContentUnavailableView("No day chosen", systemImage: "calendar", description: Text("Tap a day to see the cycles that begin on it."))
                    .padding(.top, 40)
            }
        }
        .background { Backdrop() }
    }

    @ViewBuilder
    private func content(_ ref: MonthModel.DayRef) -> some View {
        let clock = store.clock
        let earth = EarthFormatter.calendar(zone)
        let start = CalMath.dayStart(zone, ref.year, ref.month, ref.day)
        let next = CalMath.addDays(ref.year, ref.month, ref.day, 1)
        let end = CalMath.dayStart(zone, next.year, next.month, next.day)
        let inRange = end > start && end > clock.tMin && start <= clock.tMax
        let doy = EarthTime.daysFromCivil(ref.year, ref.month, ref.day) - EarthTime.daysFromCivil(ref.year, 1, 1) + 1
        let hours = (end - start) / 3600
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(EarthNames.weekdays[CalMath.weekday(ref.year, ref.month, ref.day)])
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text("\(ref.day) \(EarthTime.monthsLong[ref.month - 1]) \(String(ref.year))")
                        .font(.title3)
                        .foregroundStyle(Theme.ink2)
                    Text(verbatim: "day \(doy) · \(hours == hours.rounded() ? String(Int(hours)) : String(format: "%.1f", hours)) h · \(earth.tag(start))")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                }
                .accessibilityElement(children: .combine)
                Spacer()
                Button("Close", systemImage: "xmark") { model.showsDetail = false }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .keyboardShortcut(.cancelAction)
            }
            if inRange {
                HStack(spacing: 10) {
                    CalActionButton(title: "Go to this day", systemImage: "location.fill", prominent: true) {
                        // the same time of day as the displayed moment
                        let t = store.time()
                        let p = EarthTime.zonedParts(t, zone: zone)
                        let shown = CalMath.dayStart(zone, p.year, p.month, p.day)
                        travel(min(end - 0.001, max(start, start + (t - shown))))
                    }
                    CalActionButton(title: "Noon", systemImage: "sun.max") {
                        travel(EarthTime.zonedToUnix(.init(year: ref.year, month: ref.month, day: ref.day, hour: 12), zone: zone))
                    }
                }
                if let k = CalMath.eclipse(clock, in: start, end) {
                    eclipseRow(k, earth)
                }
                boundaries(start, end, earth)
                running(ref, earth)
            } else {
                Label("This day lies outside the catalogue (19 May 1613 … 13 June 2857 UTC): no cycles are counted there.", systemImage: "moon.zzz")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
        }
    }

    private func eclipseRow(_ k: Int, _ earth: EarthFormatter) -> some View {
        let e = store.clock.catalogue[k]
        return Button {
            travel(e)
        } label: {
            HStack(spacing: 12) {
                EclipseMark(size: 22)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: "Eclipse #\(k)").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.gold)
                    Text(verbatim: "greatest at \(earth.time(e)) · position \(k)").font(.footnote.monospacedDigit()).foregroundStyle(Theme.ink3)
                }
                Spacer()
                Image(systemName: "location").foregroundStyle(Theme.ink3)
            }
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.goldDim.opacity(0.25)))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Travels there"))
    }

    /// One line of the day: a cycle boundary or a sync quarter, in time order.
    private enum Row: Identifiable {
        case boundary(DayEvents.Boundary)
        case sync(SyncQuarter)

        var time: Double {
            switch self {
            case .boundary(let b): b.time
            case .sync(let q): q.start
            }
        }

        var id: String {
            switch self {
            case .boundary(let b): b.id
            case .sync(let q): "S\(q.sync):\(q.quarter)"
            }
        }
    }

    @ViewBuilder
    private func boundaries(_ start: Double, _ end: Double, _ earth: EarthFormatter) -> some View {
        let events = DayEvents(clock: store.clock, from: start, to: end, syncRange: model.syncRange)
        let rows = (events.boundaries.map(Row.boundary) + events.syncs.map(Row.sync)).sorted { $0.time < $1.time }
        VStack(alignment: .leading, spacing: 8) {
            Text("Begins on this day").font(.footnote.weight(.semibold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.ink3)
            ForEach(rows) { row in
                switch row {
                case .boundary(let b):
                    rowButton(time: earth.time(b.time), tint: b.level < 6 ? Theme.levelColor(b.level, opacity: 0.1) : Theme.panel2.opacity(0.6),
                              label: "\(CalMath.cycleLabel(level: b.level, ordinal: b.ordinal)) begins at \(earth.time(b.time))") {
                        travel(CalMath.landOn(store.clock, b.time, level: b.level))
                    } content: {
                        LevelChip(text: CalMath.cycleLabel(level: b.level, ordinal: b.ordinal), level: b.level, filled: b.level < 6, compact: true)
                        if b.finest > b.level {
                            Text(verbatim: "with \((b.level + 1...b.finest).map(CalMath.letter).joined(separator: " "))")
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                                .lineLimit(1)
                        }
                    }
                case .sync(let q):
                    rowButton(time: earth.time(q.start), tint: Theme.goldDim.opacity(0.18), label: syncText(q) + " at " + earth.time(q.start)) {
                        travel((q.start * 1000).rounded(.up) / 1000)
                    } content: {
                        TintChip(text: "S\(q.sync)", color: Theme.gold, filled: q.quarter == 0, compact: true)
                        Text(verbatim: q.quarter == 0 ? "solar sync begins" : CalMath.syncQuarterNames[q.quarter])
                            .font(.caption)
                            .foregroundStyle(Theme.gold.opacity(0.85))
                    }
                }
            }
        }
    }

    private func syncText(_ q: SyncQuarter) -> String {
        q.quarter == 0 ? "Solar sync \(q.sync) begins" : "Solar sync \(q.sync), \(CalMath.syncQuarterNames[q.quarter])"
    }

    private func rowButton<Content: View>(time: String, tint: Color, label: String, action: @escaping () -> Void,
                                          @ViewBuilder content: () -> Content) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Text(time)
                    .font(.reading(15))
                    .foregroundStyle(Theme.ink)
                    .frame(minWidth: 70, alignment: .leading)
                content()
                Spacer(minLength: 4)
                Image(systemName: "location").font(.footnote).foregroundStyle(Theme.ink3)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 10)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(tint))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(label))
        .accessibilityHint(Text("Travels there"))
        .accessibilityAddTraits(.isButton)
    }

    /// The cycles of the chosen bands that run through the day, end to end.
    @ViewBuilder
    private func running(_ ref: MonthModel.DayRef, _ earth: EarthFormatter) -> some View {
        let grid = model.grid(model.month, zone: zone)
        if let day = grid.days.first(where: { $0.year == ref.year && $0.month == ref.month && $0.day == ref.day }) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Running through it").font(.footnote.weight(.semibold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.ink3)
                ForEach(day.tracks, id: \.band) { track in
                    ForEach(track.segments.filter { !(track.band == .level(6) && $0.startsHere) }, id: \.start) { s in
                        HStack(spacing: 10) {
                            Group {
                                if case .level(let l) = track.band {
                                    LevelChip(text: CalMath.cycleLabel(level: l, ordinal: s.ordinal), level: l, compact: true)
                                } else {
                                    TintChip(text: "S\(s.index) \(CalMath.syncQuarterNames[s.ordinal])", color: Theme.gold, compact: true)
                                }
                            }
                            .frame(minWidth: 52, alignment: .leading)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(verbatim: span(s.start, s.end, earth))
                                    .font(.footnote.monospacedDigit())
                                    .foregroundStyle(Theme.ink2)
                                Text(EarthTime.duration(s.end - s.start, parts: 2)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            Spacer(minLength: 0)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private func span(_ a: Double, _ b: Double, _ earth: EarthFormatter) -> String {
        let long = b - a > 300 * 86_400
        let f = { (t: Double) in long ? earth.dateTime(t, seconds: false) : earth.short(t, refYear: earth.parts(a).year) }
        return "\(f(a)) → \(f(b))"
    }

    private func travel(_ t: Double) {
        let clock = store.clock
        store.travel(to: clock.clamp(t))
        Haptics.play(.step)
        toasts.show("Showing \(EarthFormatter.calendar(zone).long(clock.clamp(t)))")
    }
}

// MARK: - Year ribbon

/// The year of the shown month: twelve months with the δ and ε boundaries as ticks, the displayed instant, and how
/// many cycles the year covers. Tap a month to show it; ◀ ▶ step by year.
struct YearRibbonCard: View {
    let model: MonthModel
    let zone: TimeZone

    @Environment(ClockStore.self) private var store

    var body: some View {
        let (year, month) = CalMath.yearMonth(model.month)
        let ribbon = model.ribbon(year, zone: zone)
        CalCard("Year \(String(year))", systemImage: "calendar.day.timeline.left") {
            StepPair(previous: "Previous year", next: "Next year") { model.show(month: model.month + 12 * $0) }
                .scaleEffect(0.85)
        } content: {
            ZStack(alignment: .topLeading) {
                ClockTimeline(.periodic(store.isPlaying ? max(3600, abs(store.rate) / 30) : 3600)) { t in
                    RibbonCanvas(ribbon: ribbon, month: month, t: t)
                }
                GeometryReader { geo in
                    ForEach(ribbon.months, id: \.month) { m in
                        Button {
                            model.show(month: CalMath.monthIndex(year: year, month: m.month))
                            Haptics.play(.selection)
                        } label: {
                            Color.clear.contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .frame(width: geo.size.width * (m.x1 - m.x0), height: geo.size.height)
                        .offset(x: geo.size.width * m.x0)
                        .accessibilityLabel(Text("\(EarthTime.monthsLong[m.month - 1]) \(String(year))"))
                    }
                }
            }
            .frame(height: 56)
            HStack(spacing: 14) {
                legend(3, "δ boundaries")
                legend(4, "ε boundaries")
                Spacer()
            }
            Text(ribbon.summary)
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func legend(_ level: Int, _ text: String) -> some View {
        HStack(spacing: 5) {
            Capsule().fill(Theme.levelColor(level)).frame(width: 3, height: level == 3 ? 12 : 8)
            Text(text).font(.caption).foregroundStyle(Theme.ink3)
        }
    }
}

private struct RibbonCanvas: View {
    let ribbon: YearRibbon
    let month: Int
    let t: Double

    var body: some View {
        Canvas { context, size in
            let barTop: CGFloat = 4
            let barH = size.height - 20
            for m in ribbon.months {
                let rect = CGRect(x: m.x0 * size.width + 1, y: barTop, width: (m.x1 - m.x0) * size.width - 2, height: barH)
                let shown = m.month == month
                context.fill(RoundedRectangle(cornerRadius: 6, style: .continuous).path(in: rect),
                             with: .color(shown ? Theme.panel3 : m.inRange ? Theme.panel2 : Theme.panel.opacity(0.4)))
                if shown {
                    context.stroke(RoundedRectangle(cornerRadius: 6, style: .continuous).path(in: rect.insetBy(dx: 0.5, dy: 0.5)), with: .color(Theme.line2), lineWidth: 1)
                }
                let letter = context.resolve(Text(String(EarthTime.monthsShort[m.month - 1].prefix(size.width < 420 ? 1 : 3)))
                    .font(.system(size: 10, weight: shown ? .bold : .regular))
                    .foregroundStyle(shown ? Theme.ink : Theme.ink3))
                context.draw(letter, at: CGPoint(x: (m.x0 + m.x1) / 2 * size.width, y: size.height - 7))
            }
            for tick in ribbon.ticks {
                let x = tick.x * size.width
                var p = Path()
                let h = tick.level == 3 ? barH : barH * 0.45
                p.move(to: CGPoint(x: x, y: barTop + barH - h))
                p.addLine(to: CGPoint(x: x, y: barTop + barH))
                context.stroke(p, with: .color(Theme.levelColor(tick.level, opacity: tick.level == 3 ? 1 : 0.75)), lineWidth: tick.level == 3 ? 2 : 1)
            }
            if t >= ribbon.start, t < ribbon.end {
                let x = (t - ribbon.start) / (ribbon.end - ribbon.start) * size.width
                var p = Path()
                p.move(to: CGPoint(x: x, y: barTop - 3))
                p.addLine(to: CGPoint(x: x, y: barTop + barH + 3))
                context.stroke(p, with: .color(Theme.cursor), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                context.fill(Path(ellipseIn: CGRect(x: x - 3, y: barTop - 6, width: 6, height: 6)), with: .color(Theme.cursor))
            }
        }
        .accessibilityHidden(true)
    }
}
