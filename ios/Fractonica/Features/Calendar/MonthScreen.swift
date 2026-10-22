import FractonicaKit
import SwiftUI

/// Month: a Gregorian month whose days show cycle boundaries at their time of day; in pure mode a page of one Delta
/// (src/ui/calendar/month.js, pure-month.js, docs/design/60-calendar.md §3).
struct MonthScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        Group {
            if settings.pure {
                DeltaMonthView(model: MonthModel.shared)
            } else {
                EarthMonthView(model: MonthModel.shared)
            }
        }
        .navigationTitle(Screen.month.title)
    }
}

// MARK: - Earth mode

private struct EarthMonthView: View {
    let model: MonthModel

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @State private var width: CGFloat = 360
    @State private var picking = false
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    private var short: Bool { verticalSizeClass == .compact || CalendarLaunch.forcesShort }
    #else
    private let short = CalendarLaunch.forcesShort
    #endif

    var body: some View {
        @Bindable var model = model
        let zone = settings.timeZone
        let metrics = CalMonthMetrics(width: width, bands: model.bands.count, short: short)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    header(zone)
                    CalBandChooser(model: model)
                    CalWeekdayRow(weekStart: model.weekStart, compact: metrics.cellWidth < 60)
                    CalendarPager(index: $model.month, range: CalMath.firstMonth...CalMath.lastMonth, onSwipe: {
                        model.follows = false
                        Haptics.play(.selection)
                    }) { index in
                        CalMonthPage(model: model, grid: model.grid(index, zone: zone), metrics: metrics, zone: zone)
                    }
                    .frame(height: metrics.gridHeight + 2) // the page's 1 pt above and below keep the rings unclipped
                    CalMonthFootnote(model: model, zone: zone)
                    CalYearRibbonCard(model: model, zone: zone).id("ribbon")
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .padding(.bottom, 28)
                .frame(maxWidth: 980)
                .frame(maxWidth: .infinity)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = min($0, 980) - 32 }
            }
            .task {
                model.applyLaunchOptions(zone: zone, displayed: store.time())
                if model.launchPick {
                    model.launchPick = false
                    try? await Task.sleep(for: .milliseconds(350))
                    picking = true
                }
                if let target = model.scrollTarget {
                    model.scrollTarget = nil
                    try? await Task.sleep(for: .milliseconds(350))
                    proxy.scrollTo(target, anchor: .top)
                }
            }
        }
        .background {
            // the page follows the displayed time (a month changes rarely: once an hour is plenty while live)
            ClockTimeline(.periodic(store.isPlaying ? max(60, abs(store.rate) / 4) : 60)) { t in
                Color.clear.onChange(of: t, initial: true) { _, t in model.follow(t, zone: zone) }
            }
            // today's mark follows the device clock, also while the displayed time is paused or elsewhere (a real-world
            // date, not the clock: a minute's precision is plenty)
            TimelineView(.everyMinute) { context in
                Color.clear.onChange(of: context.date, initial: true) { model.updateToday(zone: zone) }
            }
            .onChange(of: zone) { model.updateToday(zone: zone) }
        }
        .onChange(of: store.revision) {
            // a jump anywhere brings the page back to the displayed time
            model.follows = true
            withAnimation(.snappy) { model.follow(store.time(), zone: zone) }
        }
        // never an empty inspector: it shows a chosen day (a column restored by the system without one stays shut)
        .inspector(isPresented: Binding(get: { model.showsDetail && model.selectedDay != nil }, set: { model.showsDetail = $0 })) {
            CalDayDetailView(model: model, zone: zone)
                .inspectorColumnWidth(min: 300, ideal: 340, max: 420)
                .presentationDetents([.medium, .large])
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Weeks start on", selection: $model.weekStart) {
                        Text("Monday").tag(1)
                        Text("Sunday").tag(0)
                    }
                    Button("Show the displayed day", systemImage: "scope") { showDisplayed(zone) }
                    Button("Show today", systemImage: "calendar.circle") {
                        // the month of the device clock, without travelling there (it keeps following when that is
                        // the displayed month anyway)
                        let today = MonthModel.monthIndex(of: Date.now.timeIntervalSince1970, zone: zone)
                        model.show(month: today)
                        if today == model.displayedMonth { model.follows = true }
                        Haptics.play(.selection)
                    }
                    Toggle("Day details", systemImage: "sidebar.trailing", isOn: Binding(get: { model.showsDetail && model.selectedDay != nil }, set: { on in
                        // with no day chosen yet, the details are the displayed day's
                        if on, model.selectedDay == nil {
                            let p = EarthTime.zonedParts(store.time(), zone: zone)
                            model.selectedDay = MonthModel.DayRef(year: p.year, month: p.month, day: p.day)
                        }
                        model.showsDetail = on
                    }))
                } label: {
                    Label("Options", systemImage: "ellipsis")
                }
            }
        }
    }

    private func header(_ zone: TimeZone) -> some View {
        let (y, m) = CalMath.yearMonth(model.month)
        let displayedMonth = model.displayedMonth ?? model.month
        return HStack(alignment: .center, spacing: 10) {
            Button {
                picking = true
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(EarthTime.monthsLong[m - 1]).font(.title.weight(.bold)).foregroundStyle(Theme.ink)
                    Text(String(y)).font(.title.weight(.light)).foregroundStyle(Theme.ink2)
                    Image(systemName: "chevron.down").font(.footnote.weight(.bold)).foregroundStyle(Theme.ink3)
                }
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                // the month heads a grid of fixed cells: it grows with the text size up to where "September 2026"
                // still fits beside the arrows
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                .contentTransition(.numericText(value: Double(model.month)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("\(EarthTime.monthsLong[m - 1]) \(String(y)), choose a month"))
            .popover(isPresented: $picking) {
                CalMonthPicker(model: model)
                    .presentationCompactAdaptation(.popover)
            }
            Spacer(minLength: 4)
            if model.month != displayedMonth {
                Button {
                    showDisplayed(zone)
                } label: {
                    Image(systemName: "scope")
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .help("Show the month of the displayed time")
                .accessibilityLabel(Text("Show the displayed day"))
                .transition(.scale.combined(with: .opacity))
            }
            CalStepPair(previous: "Previous month", next: "Next month", shortcuts: true, step: step)
        }
        .animation(.snappy, value: model.month != displayedMonth)
    }

    private func step(_ delta: Int) {
        let next = CalMath.clampMonth(model.month + delta)
        guard next != model.month else {
            Haptics.play(.warning)
            return
        }
        Haptics.play(.selection)
        model.show(month: next)
    }

    private func showDisplayed(_ zone: TimeZone) {
        model.follows = true
        model.month = MonthModel.monthIndex(of: store.time(), zone: zone)
        Haptics.play(.selection)
    }
}

/// ◀ ▶ in one glass capsule, repeating while held.
struct CalStepPair: View {
    let previous: String
    let next: String
    /// ⌘← and ⌘→ (one pair per screen).
    var shortcuts = false
    let step: (Int) -> Void

    var body: some View {
        HStack(spacing: 0) {
            button(-1, "chevron.left", previous)
                .keyboardShortcut(shortcuts ? KeyboardShortcut(.leftArrow, modifiers: .command) : nil)
            Divider().frame(height: 18).overlay(Theme.line2)
            button(1, "chevron.right", next)
                .keyboardShortcut(shortcuts ? KeyboardShortcut(.rightArrow, modifiers: .command) : nil)
        }
        .glassEffect(.regular.interactive(), in: .capsule)
    }

    private func button(_ delta: Int, _ symbol: String, _ label: String) -> some View {
        Button { step(delta) } label: {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(Theme.teal)
                .frame(width: 44, height: 38)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .buttonRepeatBehavior(.enabled)
        .accessibilityLabel(Text(label))
    }
}

/// The geometry of a month page for a width: cells about 1.2 times as tall as wide.
struct CalMonthMetrics: Equatable {
    let width: CGFloat
    let bands: Int
    /// A short window (iPhone in landscape): flatter cells so the month fits.
    var short = false
    var gap: CGFloat { width < 500 ? 4 : 6 }
    var cellWidth: CGFloat { max(30, (width - 6 * gap) / 7) }
    var cellHeight: CGFloat {
        let least = 58 + CGFloat(max(0, bands - 2)) * 8
        return short ? least : min(124, max(least, cellWidth * 1.18))
    }
    var gridHeight: CGFloat { 6 * cellHeight + 5 * gap }
    /// Roomy cells (iPad, Mac): larger type and the list of what begins on the day. Never in a short window, whose
    /// flat cells hold only the number and the bands.
    var regular: Bool { cellWidth >= 72 && !short }
}

private struct CalWeekdayRow: View {
    let weekStart: Int
    let compact: Bool

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<7, id: \.self) { i in
                let wd = (weekStart + i) % 7
                Text(compact ? String(EarthTime.weekdaysShort[wd].prefix(2)) : EarthTime.weekdaysShort[wd])
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(wd == 0 || wd == 6 ? Theme.ink3 : Theme.ink2)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Which bands the day cells show: γ δ ε ζ η and the solar sync, up to three at once.
private struct CalBandChooser: View {
    let model: MonthModel

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(CalendarBand.all) { band in
                    let on = model.bands.contains(band)
                    let color = band.color
                    Button {
                        withAnimation(.snappy) { model.toggle(band) }
                        Haptics.play(.selection)
                    } label: {
                        HStack(spacing: 5) {
                            if case .sync = band {
                                Image(systemName: "sun.max.fill").font(.caption)
                            } else {
                                Text(band.letter).font(.subheadline.weight(.bold))
                            }
                            Text(band.lengthText).font(.caption).foregroundStyle(on ? color.opacity(0.85) : Theme.ink3)
                        }
                        .foregroundStyle(on ? color : Theme.ink3)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background {
                            Capsule().fill(on ? color.opacity(0.16) : Theme.panel.opacity(0.6))
                                .strokeBorder(on ? color.opacity(0.55) : Theme.line, lineWidth: 1)
                        }
                        .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(band.accessibilityName))
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
    }
}

extension CalendarBand {
    var color: Color {
        switch self {
        case .level(let l): Theme.levelColor(l)
        case .sync: Theme.gold
        }
    }

    var letter: String {
        switch self {
        case .level(let l): CalMath.letter(l)
        case .sync: "S"
        }
    }

    /// "16 d", "5 h": how long one cycle lasts, roughly.
    var lengthText: String {
        switch self {
        case .level(let l):
            let s = FractonicaClock.shared.levelInfo(l).meanSeconds
            if s > 300 * 86_400 { return String(format: "%.1f y", s / 31_557_600) }
            if s > 10 * 86_400 { return String(format: "%.0f d", s / 86_400) }
            if s > 86_400 { return String(format: "%.1f d", s / 86_400) }
            return String(format: "%.0f h", s / 3600)
        case .sync: return "4 d"
        }
    }

    var accessibilityName: String {
        switch self {
        case .level(let l): "\(Notation.levelNames[l]) cycles, depth \(l + 1)"
        case .sync: "Solar sync quarters"
        }
    }
}

/// One month: 6 weeks of day cells, with the displayed moment's day ringed and its time of day marked.
private struct CalMonthPage: View {
    let model: MonthModel
    let grid: CalMonthGrid
    let metrics: CalMonthMetrics
    let zone: TimeZone

    @Environment(ClockStore.self) private var store

    var body: some View {
        let today = model.today.flatMap { ref in grid.days.firstIndex { $0.year == ref.year && $0.month == ref.month && $0.day == ref.day } }
        let earth = EarthFormatter.calendar(zone)
        VStack(spacing: metrics.gap) {
            ForEach(0..<6, id: \.self) { row in
                HStack(spacing: metrics.gap) {
                    ForEach(0..<7, id: \.self) { col in
                        let day = grid.days[row * 7 + col]
                        let ref = MonthModel.DayRef(year: day.year, month: day.month, day: day.day)
                        Button {
                            select(day, ref)
                        } label: {
                            CalDayCell(day: day, metrics: metrics, isToday: today == day.index, isSelected: model.showsDetail && model.selectedDay == ref,
                                    events: metrics.regular ? events(day, earth) : [])
                        }
                        .buttonStyle(.plain)
                        .help(label(day, today: today == day.index, earth: earth))
                        .accessibilityLabel(Text(label(day, today: today == day.index, earth: earth)))
                        .accessibilityAddTraits(model.selectedDay == ref ? .isSelected : [])
                    }
                }
            }
        }
        .overlay {
            // the displayed moment: its day ringed, its time of day marked across the bands
            ClockTimeline(.periodic(store.isPlaying ? max(120, abs(store.rate) / 30) : 120)) { t in
                CalDisplayedCursor(grid: grid, metrics: metrics, t: t, bands: grid.days.first?.tracks.count ?? 0)
            }
            .allowsHitTesting(false)
        }
        .padding(.vertical, 1)
    }

    /// What begins on a day, for the roomy cells of iPad and Mac: the coarse cycles, the syncs, the eclipse.
    private func events(_ day: CalMonthGrid.Day, _ earth: EarthFormatter) -> [CalCellEvent] {
        var out: [CalCellEvent] = []
        if let e = day.eclipse {
            out.append(CalCellEvent(label: "#\(e)", time: earth.time(store.clock.catalogue[e], seconds: false), level: nil))
        }
        for track in day.tracks {
            for s in track.segments where s.startsHere {
                switch track.band {
                case .level(let l) where l <= 5:
                    out.append(CalCellEvent(label: CalMath.cycleLabel(level: l, ordinal: s.ordinal), time: earth.time(s.start, seconds: false), level: l))
                case .sync where s.ordinal == 0:
                    out.append(CalCellEvent(label: "S\(s.index)", time: earth.time(s.start, seconds: false), level: nil))
                default:
                    break
                }
            }
        }
        return out
    }

    private func select(_ day: CalMonthGrid.Day, _ ref: MonthModel.DayRef) {
        Haptics.play(.selection)
        withAnimation(.snappy) {
            if model.selectedDay == ref, model.showsDetail {
                model.showsDetail = false
            } else {
                model.selectedDay = ref
                model.showsDetail = true
            }
        }
    }

    /// The day for VoiceOver and the pointer's tooltip: "Thursday 8 October, today, ε#5 begins at 09:09, 5 η cycles begin".
    private func label(_ day: CalMonthGrid.Day, today: Bool, earth: EarthFormatter) -> String {
        var parts = ["\(CalEarthNames.weekdays[day.weekday]) \(day.day) \(EarthTime.monthsLong[day.month - 1])"]
        if today { parts.append("today") }
        if !day.inRange { parts.append("outside the catalogue") }
        for track in day.tracks {
            let starts = track.segments.filter(\.startsHere)
            if case .level(let l) = track.band, !starts.isEmpty {
                parts.append(starts.count == 1
                    ? "\(CalMath.cycleLabel(level: l, ordinal: starts[0].ordinal)) begins at \(earth.time(starts[0].start, seconds: false))"
                    : "\(starts.count) \(CalMath.letter(l)) cycles begin")
            }
            if case .sync = track.band, let s = starts.first(where: { $0.ordinal == 0 }) {
                parts.append("solar sync \(s.index) begins at \(earth.time(s.start, seconds: false))")
            }
        }
        if let e = day.eclipse { parts.append("eclipse #\(e)") }
        return parts.joined(separator: ", ")
    }
}

/// A day: its number, the eclipse if one falls on it, and the bands with every boundary at its time of day.
/// A line of a roomy day cell: "ε#5 07:12" (level nil: the gold of an eclipse or a sync).
struct CalCellEvent: Hashable {
    let label: String
    let time: String
    let level: Int?
}

private struct CalDayCell: View, Equatable {
    let day: CalMonthGrid.Day
    let metrics: CalMonthMetrics
    let isToday: Bool
    let isSelected: Bool
    var events: [CalCellEvent] = []

    var body: some View {
        let dim = !day.inMonth
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 2) {
                Text("\(day.day)")
                    .font(.system(size: metrics.regular ? 15 : 13, weight: day.inMonth ? .semibold : .regular).monospacedDigit())
                    .foregroundStyle(isToday ? Theme.background : day.inRange ? (dim ? Theme.ink3 : Theme.ink) : Theme.ink3.opacity(0.55))
                    .frame(minWidth: metrics.regular ? 24 : 20, minHeight: metrics.regular ? 24 : 20)
                    .background { if isToday { Circle().fill(Theme.now) } }
                Spacer(minLength: 0)
                if day.eclipse != nil {
                    CalendarEclipseMark(size: metrics.regular ? 13 : 10).padding(.top, 3)
                }
            }
            if !events.isEmpty {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(events.prefix(3), id: \.self) { e in
                        Text("\(Text(e.label).fontWeight(.semibold).foregroundStyle(e.level.map { Theme.levelColor($0) } ?? Theme.gold)) \(Text(e.time).foregroundStyle(Theme.ink3))")
                            .font(.caption2.monospacedDigit())
                            .lineLimit(1)
                    }
                }
                .padding(.top, 3)
                .opacity(day.inMonth ? 1 : 0.5)
            }
            Spacer(minLength: 2)
            if day.inRange {
                CalBandsCanvas(tracks: day.tracks, rangeFrom: day.rangeFrom, rangeTo: day.rangeTo, regular: metrics.regular, labelsContinuing: day.index % 7 == 0)
                    .frame(height: CalBandsCanvas.height(day.tracks, regular: metrics.regular))
                    .opacity(dim ? 0.45 : 1)
            } else {
                Capsule().fill(Theme.line.opacity(0.5)).frame(height: 2)
            }
        }
        .padding(metrics.regular ? 6 : 4)
        .frame(maxWidth: .infinity, minHeight: metrics.cellHeight, maxHeight: metrics.cellHeight, alignment: .topLeading)
        .background {
            RoundedRectangle(cornerRadius: metrics.regular ? 12 : 9, style: .continuous)
                .fill(isSelected ? Theme.panel3 : day.inMonth ? Theme.panel.opacity(0.7) : Theme.panel.opacity(0.25))
                .strokeBorder(isSelected ? Theme.line2 : .clear, lineWidth: 1)
        }
        .contentShape(.rect)
    }
}

/// The bands of a day, drawn at once: coarse levels (γ δ ε ζ) and the sync as labelled pills, η as a fine rhythm.
struct CalBandsCanvas: View {
    let tracks: [CalMonthGrid.Track]
    var rangeFrom: Double = 0
    var rangeTo: Double = 1
    var regular = false
    /// Label a cycle that began on an earlier day too (the first day of a week row).
    var labelsContinuing = false

    static func barHeight(_ band: CalendarBand, regular: Bool) -> CGFloat {
        if case .level(let l) = band, l >= 6 { return regular ? 6 : 4 }
        return regular ? 14 : 10
    }

    static func height(_ tracks: [CalMonthGrid.Track], regular: Bool) -> CGFloat {
        tracks.reduce(0) { $0 + barHeight($1.band, regular: regular) } + CGFloat(max(0, tracks.count - 1)) * 2
    }

    var body: some View {
        Canvas { context, size in
            var y: CGFloat = 0
            for track in tracks {
                let h = Self.barHeight(track.band, regular: regular)
                draw(track, in: &context, y: y, h: h, width: size.width)
                y += h + 2
            }
        }
        .accessibilityHidden(true)
    }

    private func draw(_ track: CalMonthGrid.Track, in context: inout GraphicsContext, y: CGFloat, h: CGFloat, width: CGFloat) {
        let color = track.band.color
        let fine = h < 8
        for s in track.segments {
            let x0 = CGFloat(max(s.x0, rangeFrom)) * width
            let x1 = CGFloat(min(s.x1, rangeTo)) * width
            guard x1 > x0 else { continue }
            let gapL: CGFloat = s.startsHere && s.x0 > 0.0005 ? 0.75 : 0
            let rect = CGRect(x: x0 + gapL, y: y, width: max(0.5, x1 - x0 - gapL), height: h)
            let radius = min(h / 2, fine ? 1.5 : 3)
            let shape = UnevenRoundedRectangle(
                topLeadingRadius: s.startsHere ? radius : 0, bottomLeadingRadius: s.startsHere ? radius : 0,
                bottomTrailingRadius: s.endsHere ? radius : 0, topTrailingRadius: s.endsHere ? radius : 0, style: .continuous)
            let odd = s.index % 2 == 1
            let opacity: Double = {
                if case .sync = track.band { return [0.9, 0.55, 0.75, 0.4][s.ordinal] }
                return odd ? 0.42 : 0.82
            }()
            context.fill(shape.path(in: rect), with: .color(color.opacity(opacity)))
            if s.startsHere, s.x0 > 0.0005 {
                // the exact time of day the cycle begins
                var tick = Path()
                tick.move(to: CGPoint(x: x0, y: y - 1))
                tick.addLine(to: CGPoint(x: x0, y: y + h + 1))
                context.stroke(tick, with: .color(Theme.ink.opacity(0.9)), lineWidth: fine ? 1 : 1.25)
            }
            if !fine, s.startsHere || labelsContinuing && s.x0 == 0 {
                let label: String = {
                    if case .sync = track.band { return s.ordinal == 0 ? "S\(s.index)" : "" }
                    return "#\(s.ordinal)"
                }()
                guard !label.isEmpty else { continue }
                let text = context.resolve(Text(label).font(.system(size: regular ? 10 : 8, weight: .bold).monospacedDigit())
                    .foregroundStyle(Theme.background.opacity(s.startsHere ? 0.95 : 0.6)))
                let size = text.measure(in: CGSize(width: 200, height: h))
                if size.width + 4 <= x1 - x0 {
                    context.draw(text, at: CGPoint(x: x0 + 2.5 + size.width / 2, y: y + h / 2))
                }
            }
        }
    }
}

/// The ring around the displayed moment's day and the line at its time of day.
private struct CalDisplayedCursor: View {
    let grid: CalMonthGrid
    let metrics: CalMonthMetrics
    let t: Double
    let bands: Int

    var body: some View {
        Canvas { context, size in
            guard let i = grid.dayIndex(of: t) else { return }
            let day = grid.days[i]
            // the overlay covers the grid exactly (it is attached inside the page's vertical padding)
            let w = (size.width - 6 * metrics.gap) / 7
            let h = (size.height - 5 * metrics.gap) / 6
            let x = CGFloat(i % 7) * (w + metrics.gap)
            let y = CGFloat(i / 7) * (h + metrics.gap)
            let cell = CGRect(x: x, y: y, width: w, height: h)
            let r: CGFloat = metrics.regular ? 12 : 9
            context.stroke(RoundedRectangle(cornerRadius: r, style: .continuous).path(in: cell.insetBy(dx: 0.75, dy: 0.75)),
                           with: .color(Theme.cursor), lineWidth: 1.5)
            guard day.inRange else { return }
            let pad: CGFloat = metrics.regular ? 6 : 4
            let tracksHeight = CalBandsCanvas.height(day.tracks, regular: metrics.regular)
            let fx = CGFloat((t - day.start) / day.length)
            let cx = cell.minX + pad + fx * (w - 2 * pad)
            let bottom = cell.maxY - pad
            let top = bottom - max(tracksHeight, 6) - 4
            var line = Path()
            line.move(to: CGPoint(x: cx, y: top))
            line.addLine(to: CGPoint(x: cx, y: bottom + 1))
            context.stroke(line, with: .color(Theme.cursor), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            context.fill(Path(ellipseIn: CGRect(x: cx - 3, y: top - 3, width: 6, height: 6)), with: .color(Theme.cursor))
        }
        .accessibilityHidden(true)
    }
}

/// A month and a year to jump to.
private struct CalMonthPicker: View {
    let model: MonthModel

    @Environment(\.dismiss) private var dismiss
    @State private var month = 1
    @State private var year = 2026

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 0) {
                Picker("Month", selection: $month) {
                    ForEach(1...12, id: \.self) { Text(EarthTime.monthsLong[$0 - 1]).tag($0) }
                }
                #if os(iOS)
                .pickerStyle(.wheel)
                #endif
                .frame(minWidth: 150)
                #if os(iOS)
                Picker("Year", selection: $year) {
                    ForEach(1613...2857, id: \.self) { Text(String($0)).tag($0) }
                }
                .pickerStyle(.wheel)
                .frame(width: 110)
                #else
                Stepper(value: $year, in: 1613...2857) {
                    TextField("Year", value: $year, format: .number.grouping(.never))
                        .frame(width: 64)
                }
                #endif
            }
            HStack {
                Button("Cancel", role: .cancel) { dismiss() }
                Spacer()
                Button("Show") {
                    model.show(month: CalMath.monthIndex(year: min(2857, max(1613, year)), month: month))
                    Haptics.play(.selection)
                    dismiss()
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.teal)
            }
        }
        .padding(16)
        .frame(minWidth: 300)
        .onAppear {
            let (y, m) = CalMath.yearMonth(model.month)
            year = y
            month = m
        }
    }
}

/// Under the grid: what the bands are, and the catalogue's edge when the month reaches it.
private struct CalMonthFootnote: View {
    let model: MonthModel
    let zone: TimeZone

    var body: some View {
        let grid = model.grid(model.month, zone: zone)
        let outside = grid.days.filter { $0.inMonth && !$0.inRange }.count
        VStack(alignment: .leading, spacing: 4) {
            Text("Each band is a cycle; a white tick is where the next one begins, at its exact time of day. Tap a day for its boundaries.")
            if outside > 0 {
                Label("\(outside) day\(outside == 1 ? "" : "s") of this month lie\(outside == 1 ? "s" : "") outside the catalogue (19 May 1613 … 13 June 2857): no cycles there.", systemImage: "moon.zzz")
                    .foregroundStyle(Theme.ink2)
            }
        }
        .font(.footnote)
        .foregroundStyle(Theme.ink3)
        .fixedSize(horizontal: false, vertical: true)
    }
}
