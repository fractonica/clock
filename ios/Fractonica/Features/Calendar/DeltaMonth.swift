import FractonicaKit
import SwiftUI

/// The month screen in pure mode (src/ui/calendar/pure-month.js): one Delta per page — 5 Nuclide rows (ε#1–5) × 7
/// columns of 11 Helions (labelled by their first Helion, 1η 12η … 67η). Every cell shows its Helions at their exact
/// place, the Delta's quarters (tinted, a line where one begins), the solar sync quarters (gold diamonds) and the
/// eclipse it holds. Above it the quarter bar, under it the five Deltas of the Gamma. Nothing here is said in Earth terms.
struct DeltaMonthView: View {
    let model: MonthModel

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @State private var width: CGFloat = 360
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    private var short: Bool { verticalSizeClass == .compact || CalendarLaunch.forcesShort }
    #else
    private let short = CalendarLaunch.forcesShort
    #endif

    var body: some View {
        @Bindable var model = model
        let metrics = CalDeltaMetrics(width: width, short: short)
        let page = model.deltaPage(model.page)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    DeltaHeader(model: model, page: page)
                    CalPureBandChooser(model: model)
                    CalQuarterBar(page: page)
                    CalColumnHeader(metrics: metrics)
                    CalendarPager(index: $model.page, range: 0...(CalDeltaPage.count(store.clock) - 1), onSwipe: {
                        model.pageFollows = false
                        Haptics.play(.selection)
                    }) { index in
                        DeltaPageGrid(model: model, page: model.deltaPage(index), metrics: metrics)
                    }
                    .frame(height: metrics.gridHeight)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(footnote)
                        if let last = page.cells.last(where: \.inRange), last.index < CalDeltaPage.cells - 1 || last.cut < 1 {
                            Label("The catalogue ends with eclipse #\(store.clock.extent), in ε#\(last.epsilon) \(last.firstHelion)η: the rest of this Delta lies after it.", systemImage: "moon.zzz")
                                .foregroundStyle(Theme.ink2)
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                    GammaRibbon(model: model, page: page).id("ribbon")
                }
                .padding(.horizontal, 16)
                .padding(.top, 6)
                .padding(.bottom, 28)
                .frame(maxWidth: 980)
                .frame(maxWidth: .infinity)
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = min($0, 980) - 32 }
            }
            .task {
                model.applyLaunchOptions(zone: settings.timeZone, displayed: store.time())
                if let target = model.scrollTarget {
                    model.scrollTarget = nil
                    try? await Task.sleep(for: .milliseconds(350))
                    proxy.scrollTo(target, anchor: .top)
                }
            }
        }
        .background {
            ClockTimeline(.periodic(store.isPlaying ? max(600, abs(store.rate) / 4) : 600)) { t in
                Color.clear.onChange(of: t, initial: true) { _, t in model.followPage(t) }
            }
        }
        .onChange(of: store.revision) {
            model.pageFollows = true
            withAnimation(.snappy) { model.followPage(store.time()) }
        }
        // selecting δ, ε or η anywhere in the app (ladder, face, converter) puts that level in the band (pure-month.js)
        .onChange(of: settings.selectedLevel) { _, level in
            if MonthModel.pureBands.contains(level), model.pureBand != level {
                withAnimation(.snappy) { model.pureBand = level }
            }
        }
        .inspector(isPresented: Binding(get: { model.selectedCell != nil }, set: { if !$0 { model.selectedCell = nil } })) {
            CellDetailView(model: model)
                .inspectorColumnWidth(min: 300, ideal: 340, max: 420)
                .presentationDetents([.medium, .large])
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Arrows step by", selection: $model.pageStep) {
                        ForEach(MonthModel.PageStep.allCases) { Text("One \($0.name)").tag($0) }
                    }
                    Button("Show the shown moment's Delta", systemImage: "scope") {
                        model.pageFollows = true
                        model.followPage(store.time())
                    }
                    Button("Show the live clock's Delta", systemImage: "dot.radiowaves.left.and.right") {
                        // the page of the device clock, without travelling there
                        if let p = CalDeltaPage.page(store.clock, at: Date.now.timeIntervalSince1970) {
                            model.pageFollows = store.isLive
                            model.page = p
                            Haptics.play(.selection)
                        }
                    }
                } label: {
                    Label("Options", systemImage: "ellipsis")
                }
            }
        }
    }
}

extension DeltaMonthView {
    private var footnote: String {
        let band = switch model.pureBand {
        case 3: "The band is the Delta's quarters; "
        case 4: "The band is the Nuclides, one per row; "
        default: "A cell is 11 Helions, numbered in their Nuclide; "
        }
        let tap = model.pureBand == 6 ? "its Helions" : model.pureBand == 4 ? "its Nuclide" : "its quarters"
        return band + "gold diamonds mark the quarters of a solar sync (19η); a line in the Delta colour marks where a quarter of the Delta begins. Tap a cell for \(tap)."
    }
}

/// What the cells' band shows: the Delta's quarters, the Nuclides or the Helions (the app-wide selected level).
private struct CalPureBandChooser: View {
    let model: MonthModel

    @Environment(AppSettings.self) private var settings

    var body: some View {
        ViewThatFits(in: .horizontal) {
            chips(words: true)
            chips(words: false)
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
    }

    private func chips(words: Bool) -> some View {
        HStack(spacing: 6) {
            ForEach(MonthModel.pureBands, id: \.self) { level in
                let on = model.pureBand == level
                let color = Theme.levelColor(level)
                Button {
                    withAnimation(.snappy) { model.pureBand = level }
                    // the band level is the app-wide selected level (pure-month.js)
                    settings.selectedLevel = level
                    Haptics.play(.selection)
                } label: {
                    HStack(spacing: 5) {
                        Text(CalMath.letter(level)).font(.subheadline.weight(.bold))
                        if words {
                            Text(Self.names[level] ?? "").font(.caption).foregroundStyle(on ? color.opacity(0.85) : Theme.ink3)
                        }
                    }
                    .fixedSize()
                    .foregroundStyle(on ? color : Theme.ink3)
                    .lineLimit(1)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background {
                        Capsule().fill(on ? color.opacity(0.16) : Theme.panel.opacity(0.6))
                            .strokeBorder(on ? color.opacity(0.55) : Theme.line, lineWidth: 1)
                    }
                    .contentShape(.capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Band: \(Self.names[level] ?? "")"))
                .accessibilityAddTraits(on ? .isSelected : [])
                .help(Self.help[level] ?? "")
            }
            Spacer(minLength: 0)
        }
    }

    static let names = [3: "quarters", 4: "Nuclides", 6: "Helions"]
    static let help = [3: "The band shows the Delta's quarters: Peak, Node, Valley, End",
                       4: "The band shows the Nuclides, one per row",
                       6: "The band shows the 11 Helions of each cell"]
}

struct CalDeltaMetrics: Equatable {
    let width: CGFloat
    var short = false
    var gap: CGFloat { width < 500 ? 4 : 6 }
    var rowLabel: CGFloat { width < 500 ? 30 : 40 }
    var cellWidth: CGFloat { max(28, (width - rowLabel - 7 * gap) / 7) }
    var cellHeight: CGFloat { short ? 60 : min(116, max(56, cellWidth * 1.2)) }
    var gridHeight: CGFloat { 5 * cellHeight + 4 * gap }
    /// Roomy cells (iPad, Mac); a short window keeps the compact type so its flat cells hold everything.
    var regular: Bool { cellWidth >= 72 && !short }
}

/// The page in words and letters, with the arrows.
private struct DeltaHeader: View {
    let model: MonthModel
    let page: CalDeltaPage

    @Environment(ClockStore.self) private var store
    @State private var picking = false

    var body: some View {
        let path = page.path
        let shown = model.displayedPage
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Button {
                    picking = true
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(Notation.periodName(level: 3, ordinal: page.delta))
                            .font(.title.weight(.bold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Image(systemName: "chevron.down").font(.footnote.weight(.bold)).foregroundStyle(Theme.ink3)
                    }
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("\(Notation.periodName(level: 3, ordinal: page.delta)), choose a Delta"))
                .popover(isPresented: $picking) {
                    DeltaPagePicker(model: model, page: page)
                        .presentationCompactAdaptation(.popover)
                }
                .task(id: model.launchPick) {
                    guard model.launchPick else { return }
                    model.launchPick = false
                    try? await Task.sleep(for: .milliseconds(350))
                    picking = true
                }
                Text("\(Notation.periodName(level: 2, ordinal: path[2])) · \(Notation.periodName(level: 1, ordinal: path[1])) · \(Notation.periodName(level: 0, ordinal: path[0]))")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(4)
                    .minimumScaleFactor(0.8)
                Text("α#\(path[0]) β#\(path[1]) γ#\(path[2]) δ#\(page.delta)")
                    .font(.code(13))
                    .foregroundStyle(Theme.teal)
            }
            // the page's names head a fixed grid: they stop growing with the title, so it stays the largest
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .accessibilityElement(children: .combine)
            Spacer(minLength: 4)
            if shown != nil, shown != model.page {
                Button {
                    model.pageFollows = true
                    model.followPage(store.time())
                    Haptics.play(.selection)
                } label: {
                    Image(systemName: "scope")
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel(Text("Show the shown moment's Delta"))
            }
            VStack(spacing: 4) {
                CalStepPair(previous: "Previous \(model.pageStep.name)", next: "Next \(model.pageStep.name)", shortcuts: true, step: step)
                Text("by \(model.pageStep.name)")
                    .font(.caption2)
                    .foregroundStyle(Theme.levelColor(model.pageStep.level))
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            }
        }
    }

    private func step(_ direction: Int) {
        let clock = store.clock
        let next = CalDeltaPage.clampPage(clock, model.page + direction * model.pageStep.rawValue)
        guard next != model.page else {
            Haptics.play(.warning)
            return
        }
        Haptics.play(.selection)
        model.pageFollows = false
        model.page = next
    }
}

/// The four quarters of the page's Delta and its five Nuclides; tap a quarter to go where it begins.
private struct CalQuarterBar: View {
    let page: CalDeltaPage

    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        ClockTimeline(.periodic(store.isPlaying ? max(60, abs(store.rate) / 8) : 60)) { t in
            let clock = store.clock
            let onPage = CalDeltaPage.page(clock, at: t) == page.index
            let current = onPage ? Notation.standard.quarter(at: t, level: 3) : nil
            let fraction = onPage ? (clock.level(at: t, 3)?.phase ?? 0) : nil
            VStack(spacing: 3) {
                HStack(spacing: 3) {
                    ForEach(0..<4, id: \.self) { q in
                        Button {
                            if let s = page.quarterStart(clock, q) {
                                store.travel(to: s)
                                Haptics.play(.step)
                                toasts.show("\(Notation.periodName(level: 3, ordinal: page.delta)) \(Notation.quarterWords[q]) begins")
                            }
                        } label: {
                            Text(Notation.quarterWords[q])
                                .font(.caption.weight(q == current ? .bold : .medium))
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .foregroundStyle(q == current ? Theme.background : Theme.levelColor(3))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                                .background {
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(q == current ? Theme.levelColor(3) : Theme.levelColor(3, opacity: q % 2 == 0 ? 0.14 : 0.08))
                                }
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("\(Notation.quarterWords[q]) quarter: go to where it begins"))
                    }
                }
                // the shown moment: a caret under the bar, so the quarter words stay clear
                Canvas { context, size in
                    guard let fraction else { return }
                    let x = size.width * fraction
                    var caret = Path()
                    caret.move(to: CGPoint(x: x, y: 0))
                    caret.addLine(to: CGPoint(x: x + 4.5, y: size.height))
                    caret.addLine(to: CGPoint(x: x - 4.5, y: size.height))
                    caret.closeSubpath()
                    context.fill(caret, with: .color(Theme.cursor))
                }
                .frame(height: 6)
                .accessibilityHidden(true)
                HStack(spacing: 0) {
                    ForEach(1...5, id: \.self) { e in
                        Text("ε#\(e)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(Theme.levelColor(4, opacity: 0.8))
                            .frame(maxWidth: .infinity)
                    }
                }
                .accessibilityHidden(true)
            }
            // four words over a fixed grid: they grow with the text size as far as a quarter of a phone's width allows
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        }
    }
}

private struct CalColumnHeader: View {
    let metrics: CalDeltaMetrics

    var body: some View {
        HStack(spacing: metrics.gap) {
            Color.clear.frame(width: metrics.rowLabel, height: 1)
            ForEach(CalDeltaPage.columnHelion, id: \.self) { h in
                Text("\(h)η")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.levelColor(6, opacity: 0.9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity)
            }
        }
        // labels of a fixed grid: they grow with the text size only as far as their columns allow
        .dynamicTypeSize(...DynamicTypeSize.xLarge)
        .accessibilityHidden(true)
    }
}

/// One Delta: 5 rows of 7 cells.
private struct DeltaPageGrid: View {
    let model: MonthModel
    let page: CalDeltaPage
    let metrics: CalDeltaMetrics

    @Environment(ClockStore.self) private var store

    var body: some View {
        VStack(spacing: metrics.gap) {
            ForEach(0..<CalDeltaPage.rows, id: \.self) { row in
                HStack(spacing: metrics.gap) {
                    Text("ε#\(row + 1)")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.levelColor(4))
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .dynamicTypeSize(...DynamicTypeSize.xLarge)
                        .frame(width: metrics.rowLabel, alignment: .leading)
                        .accessibilityHidden(true)
                    ForEach(0..<CalDeltaPage.columns, id: \.self) { col in
                        let cell = page.cells[row * CalDeltaPage.columns + col]
                        Button {
                            Haptics.play(.selection)
                            withAnimation(.snappy) { model.selectedCell = model.selectedCell == cell.index ? nil : cell.index }
                        } label: {
                            DeltaCell(cell: cell, band: model.pureBand, metrics: metrics, isSelected: model.selectedCell == cell.index)
                        }
                        .buttonStyle(.plain)
                        .disabled(!cell.inRange)
                        .help(label(cell))
                        .accessibilityLabel(Text(label(cell)))
                    }
                }
            }
        }
        .overlay {
            ClockTimeline(.periodic(store.isPlaying ? max(30, abs(store.rate) / 30) : 30)) { t in
                DeltaCursor(page: page, metrics: metrics, t: t, live: store.isLive ? nil : Date.now.timeIntervalSince1970)
            }
            .allowsHitTesting(false)
        }
    }

    private func label(_ cell: CalDeltaPage.Cell) -> String {
        var parts = ["ε#\(cell.epsilon), \(cell.firstHelion)η to \(cell.firstHelion + 10)η"]
        if let q = cell.quarters.first(where: \.startsHere), cell.inRange {
            parts.append("\(Notation.periodName(level: 3, ordinal: page.delta)) \(Notation.quarterWords[q.quarter]) begins")
        }
        if let e = cell.eclipse { parts.append("eclipse \(Notation.eclipseName(e))") }
        if let s = cell.syncs.first(where: { $0.quarter == 0 }) { parts.append("solar sync \(s.sync) begins") }
        if !cell.inRange { parts.append("after the catalogue") }
        return parts.joined(separator: ", ")
    }
}

/// A cell: its corner facts (eclipse, sync) and the band of its 11 Helions.
private struct DeltaCell: View, Equatable {
    let cell: CalDeltaPage.Cell
    /// The band: 3 the Delta's quarters, 4 the Nuclides, 6 the Helions.
    let band: Int
    let metrics: CalDeltaMetrics
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 3) {
                if let e = cell.eclipse {
                    CalendarEclipseMark(size: metrics.regular ? 12 : 9)
                    Text(Notation.eclipseName(e))
                        .font(.system(size: metrics.regular ? 11 : 9, weight: .semibold).monospacedDigit())
                        .foregroundStyle(Theme.gold)
                }
                Spacer(minLength: 0)
            }
            if let s = cell.syncs.first(where: { $0.quarter == 0 }), metrics.cellWidth >= 44 {
                Text(verbatim: "S\(s.sync)")
                    .font(.system(size: metrics.regular ? 10 : 8, weight: .medium).monospacedDigit())
                    .foregroundStyle(Theme.gold.opacity(0.85))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            if cell.inRange, let q = cell.quarters.first(where: \.startsHere) {
                // a quarter of the Delta begins in this cell: its word flies as a flag from the line
                CalQuarterFlag(word: Notation.quarterWords[q.quarter], x: q.x0, cellWidth: metrics.cellWidth,
                            padding: metrics.regular ? 6 : 4, regular: metrics.regular)
            }
            Spacer(minLength: 0)
            if cell.inRange {
                CalHelionBand(cell: cell, band: band, regular: metrics.regular)
                    .frame(height: CalHelionBand.height(band: band, regular: metrics.regular))
            }
        }
        .padding(metrics.regular ? 6 : 4)
        .frame(maxWidth: .infinity, minHeight: metrics.cellHeight, maxHeight: metrics.cellHeight, alignment: .topLeading)
        .background {
            ZStack {
                RoundedRectangle(cornerRadius: metrics.regular ? 12 : 9, style: .continuous)
                    .fill(isSelected ? Theme.panel3 : cell.inRange ? Theme.panel.opacity(0.7) : Theme.panel.opacity(0.2))
                // the Delta's quarters as a faint tint, a line where one begins
                Canvas { context, size in
                    for q in cell.quarters where cell.inRange {
                        let rect = CGRect(x: q.x0 * size.width, y: 0, width: (q.x1 - q.x0) * size.width, height: size.height)
                        context.fill(Path(rect), with: .color(Theme.levelColor(3, opacity: q.quarter % 2 == 0 ? 0.07 : 0.0)))
                        if q.startsHere {
                            var p = Path()
                            p.move(to: CGPoint(x: rect.minX + (q.x0 == 0 ? 1 : 0), y: 0))
                            p.addLine(to: CGPoint(x: rect.minX + (q.x0 == 0 ? 1 : 0), y: size.height))
                            context.stroke(p, with: .color(Theme.levelColor(3)), lineWidth: 1.5)
                        }
                    }
                    if cell.eclipse != nil {
                        let x = cell.eclipseFraction * size.width
                        var p = Path()
                        p.move(to: CGPoint(x: max(0.5, x), y: 0))
                        p.addLine(to: CGPoint(x: max(0.5, x), y: size.height))
                        context.stroke(p, with: .color(Theme.gold.opacity(0.8)), lineWidth: 1)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: metrics.regular ? 12 : 9, style: .continuous))
                if isSelected {
                    RoundedRectangle(cornerRadius: metrics.regular ? 12 : 9, style: .continuous).strokeBorder(Theme.line2, lineWidth: 1)
                }
            }
        }
        .contentShape(.rect)
    }
}

/// The word of a Delta quarter flying from the line where the quarter begins: attached to the line's right when the
/// line is in the cell's left half, to its left otherwise, the pole side square.
private struct CalQuarterFlag: View {
    let word: String
    /// Where the line is, 0 … 1 of the cell.
    let x: Double
    let cellWidth: CGFloat
    /// The cell's inner padding (the flag is laid out inside it; the line is drawn across the whole cell).
    let padding: CGFloat
    let regular: Bool

    var body: some View {
        let line = x == 0 ? 1 : CGFloat(x) * cellWidth // the line's centre, in cell coordinates (see DeltaCell)
        // near the middle neither side has room for a word: the flag then sits across the line, centred on it
        let centred = x > 0.3 && x < 0.7
        let right = x <= 0.5
        let radius: CGFloat = 3
        let chip = Text(verbatim: word)
            .font(.system(size: regular ? 10 : 8, weight: .bold))
            .foregroundStyle(Theme.background)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, regular ? 4 : 3)
            .padding(.vertical, 1)
            .background {
                UnevenRoundedRectangle(topLeadingRadius: right && !centred ? 0 : radius, bottomLeadingRadius: right && !centred ? 0 : radius,
                                       bottomTrailingRadius: right || centred ? radius : 0, topTrailingRadius: right || centred ? radius : 0)
                    .fill(Theme.levelColor(3))
            }
        if centred {
            chip
                .fixedSize()
                .alignmentGuide(.leading) { d in d[HorizontalAlignment.center] - (line - padding) }
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            chip
                .padding(.leading, right ? max(0, line - 0.75 - padding) : 0)
                .padding(.trailing, right ? 0 : max(0, cellWidth - padding - line - 0.75))
                .offset(x: right ? min(0, line - 0.75 - padding) : 0)
                .frame(maxWidth: .infinity, alignment: right ? .leading : .trailing)
        }
    }
}

/// Choose a Delta by the fracton names of its Alpha, Beta, Gamma and its own.
private struct DeltaPagePicker: View {
    let model: MonthModel
    let page: CalDeltaPage

    @Environment(ClockStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var path: [Int] = [1, 1, 1, 1]

    var body: some View {
        let clock = store.clock
        VStack(alignment: .leading, spacing: 12) {
            Text("Show a Delta").font(.headline).foregroundStyle(Theme.ink)
            ForEach(0..<4, id: \.self) { level in
                let maximum = max(1, CalMath.childCount(clock, parent: Array(path.prefix(level))))
                HStack(spacing: 10) {
                    CalendarLevelChip(text: CalMath.letter(level), level: level, compact: true).frame(width: 28)
                    Text(verbatim: Notation.levelNames[level]).foregroundStyle(Theme.ink2).lineLimit(1)
                    Spacer(minLength: 8)
                    Picker(Notation.levelNames[level], selection: Binding(get: { min(path[level], maximum) }, set: { n in
                        var p = path
                        p[level] = n
                        path = CalMath.normalize(clock, path: p)
                    })) {
                        ForEach(1...maximum, id: \.self) { n in
                            Text(verbatim: Notation.ordinalName(n)).tag(n)
                        }
                    }
                    .pickerStyle(.menu)
                    .labelsHidden()
                    .tint(Theme.levelColor(level))
                    .fixedSize()
                }
            }
            Text(verbatim: CalMath.pathText(path))
                .font(.code(13))
                .foregroundStyle(Theme.teal)
            HStack {
                Button("Cancel", role: .cancel) { dismiss() }
                Spacer()
                Button("Show") {
                    model.pageFollows = false
                    model.page = CalDeltaPage.page(clock, alpha: path[0], beta: path[1], gamma: path[2], delta: path[3])
                    Haptics.play(.selection)
                    dismiss()
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.teal)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(16)
        .frame(minWidth: 320)
        .fixedSize(horizontal: false, vertical: true)
        .onAppear { path = CalMath.normalize(clock, path: page.path + [page.delta]) }
    }
}

/// The band of a cell with the solar sync quarters over it as gold diamonds: its 11 Helions (alternating, the node of
/// each), the Nuclide of its row, or the Delta quarter(s) it lies in (pure-month.js `bandHtml`).
private struct CalHelionBand: View {
    let cell: CalDeltaPage.Cell
    /// 3 the Delta's quarters, 4 the Nuclides, 6 the Helions.
    var band = 6
    let regular: Bool

    static func height(band: Int, regular: Bool) -> CGFloat {
        band == 6 ? (regular ? 28 : 13) : (regular ? 26 : 18)
    }

    var body: some View {
        Canvas { context, size in
            if band == 6 {
                helions(&context, size)
            } else {
                wide(&context, size)
            }
        }
        .accessibilityHidden(true)
    }

    /// The Nuclide of the row, or the Delta quarter(s) of the cell: wide labelled segments, a white tick where one begins.
    private func wide(_ context: inout GraphicsContext, _ size: CGSize) {
        let barH: CGFloat = regular ? 14 : 10
        let y = size.height - barH
        let w = size.width * cell.cut
        var pieces: [(x0: Double, x1: Double, odd: Bool, startsHere: Bool, endsHere: Bool, label: String?)] = []
        if band == 4 {
            // a Nuclide is a row
            let nuclide = cell.z / Int64(CalDeltaPage.columns)
            let first = cell.column == 0, last = cell.column == CalDeltaPage.columns - 1
            pieces = [(0, 1, nuclide % 2 == 1, first, last, first ? "ε#\(cell.epsilon)" : nil)]
        } else {
            // a quarter that begins here is named by its flag above; a row that opens inside one says which it is
            pieces = cell.quarters.map { q in
                (q.x0, q.x1, q.quarter % 2 == 1, q.startsHere, q.x1 < 1 || cell.index == CalDeltaPage.cells - 1,
                 !q.startsHere && cell.column == 0 && q.x0 == 0 ? Notation.quarterWords[q.quarter] : nil)
            }
        }
        let color = Theme.levelColor(band)
        for p in pieces {
            let x0 = CGFloat(p.x0) * size.width, x1 = min(CGFloat(p.x1) * size.width, w)
            guard x1 > x0 else { continue }
            let gap: CGFloat = p.startsHere && p.x0 > 0 ? 0.75 : 0
            let rect = CGRect(x: x0 + gap, y: y, width: max(0.5, x1 - x0 - gap), height: barH)
            let radius: CGFloat = 3
            let ends = p.endsHere || x1 >= w && cell.cut < 1
            let shape = UnevenRoundedRectangle(topLeadingRadius: p.startsHere ? radius : 0, bottomLeadingRadius: p.startsHere ? radius : 0,
                                               bottomTrailingRadius: ends ? radius : 0, topTrailingRadius: ends ? radius : 0, style: .continuous)
            context.fill(shape.path(in: rect), with: .color(color.opacity(p.odd ? 0.42 : 0.82)))
            if p.startsHere, p.x0 > 0 {
                var tick = Path()
                tick.move(to: CGPoint(x: x0, y: y - 1))
                tick.addLine(to: CGPoint(x: x0, y: y + barH + 1))
                context.stroke(tick, with: .color(Theme.ink.opacity(0.9)), lineWidth: 1.25)
            }
            if let label = p.label {
                let text = context.resolve(Text(verbatim: label).font(.system(size: regular ? 10 : 8, weight: .bold).monospacedDigit())
                    .foregroundStyle(Theme.background.opacity(0.9)))
                let m = text.measure(in: CGSize(width: 200, height: barH))
                if m.width + 4 <= x1 - x0 {
                    context.draw(text, at: CGPoint(x: x0 + 2.5 + m.width / 2, y: y + barH / 2))
                }
            }
        }
        syncs(&context, size, barTop: y)
    }

    /// The solar sync quarters over the band.
    private func syncs(_ context: inout GraphicsContext, _ size: CGSize, barTop y: CGFloat) {
        for s in cell.syncs {
            let x = s.x * size.width
            let d: CGFloat = s.quarter == 0 ? (regular ? 5 : 4) : (regular ? 3.5 : 2.8)
            let cy = y - (regular ? 7 : 5)
            var p = Path()
            p.move(to: CGPoint(x: x, y: cy - d))
            p.addLine(to: CGPoint(x: x + d, y: cy))
            p.addLine(to: CGPoint(x: x, y: cy + d))
            p.addLine(to: CGPoint(x: x - d, y: cy))
            p.closeSubpath()
            context.fill(p, with: .color(Theme.gold.opacity(s.quarter == 0 ? 1 : 0.7)))
        }
    }

    private func helions(_ context: inout GraphicsContext, _ size: CGSize) {
        let barH: CGFloat = regular ? 7 : 5
        let y = size.height - barH
        let w = size.width * cell.cut
        let step = size.width / CGFloat(CalDeltaPage.helionsPerCell)
        for j in 0..<CalDeltaPage.helionsPerCell {
            let x0 = CGFloat(j) * step
            guard x0 < w else { break }
            let rect = CGRect(x: x0 + (j > 0 ? 0.5 : 0), y: y, width: min(step, w - x0) - (j > 0 ? 0.5 : 0), height: barH)
            let even = (Int(cell.z) * CalDeltaPage.helionsPerCell + j) % 2 == 0
            context.fill(Path(roundedRect: rect, cornerRadius: 1.2), with: .color(Theme.levelColor(6, opacity: even ? 0.85 : 0.45)))
            if regular {
                let nx = x0 + step / 2
                context.fill(Path(ellipseIn: CGRect(x: nx - 1, y: y - 3.5, width: 2, height: 2)), with: .color(Theme.levelColor(6, opacity: 0.6)))
                // the Helion's number in its Nuclide: all eleven where they fit, every fifth otherwise (pure-month.js)
                let n = cell.firstHelion + j
                if step >= 12 || n % 5 == 0 {
                    context.draw(Text(verbatim: "\(n)").font(.system(size: 8, weight: .medium).monospacedDigit())
                                    .foregroundStyle(Theme.levelColor(6, opacity: n % 5 == 0 ? 0.9 : 0.55)),
                                 at: CGPoint(x: nx, y: 4), anchor: .center)
                }
            }
        }
        syncs(&context, size, barTop: y)
    }
}

/// The shown moment's cell ringed, and where in it the moment is; the live clock's cell marked in red while travelling.
private struct DeltaCursor: View {
    let page: CalDeltaPage
    let metrics: CalDeltaMetrics
    let t: Double
    let live: Double?

    var body: some View {
        Canvas { context, size in
            let clock = FractonicaClock.shared
            let w = (size.width - metrics.rowLabel - 7 * metrics.gap) / 7
            let h = (size.height - 4 * metrics.gap) / 5
            let frame = { (i: Int) -> CGRect in
                CGRect(x: metrics.rowLabel + metrics.gap + CGFloat(i % 7) * (w + metrics.gap), y: CGFloat(i / 7) * (h + metrics.gap), width: w, height: h)
            }
            if let live, let i = page.cellIndex(clock, at: live) {
                let r = frame(i)
                context.fill(Path(ellipseIn: CGRect(x: r.maxX - 9, y: r.minY + 4, width: 5, height: 5)), with: .color(Theme.now))
            }
            guard let i = page.cellIndex(clock, at: t) else { return }
            let cell = page.cells[i]
            let r = frame(i)
            let radius: CGFloat = metrics.regular ? 12 : 9
            context.stroke(RoundedRectangle(cornerRadius: radius, style: .continuous).path(in: r.insetBy(dx: 0.75, dy: 0.75)), with: .color(Theme.cursor), lineWidth: 1.5)
            let pad: CGFloat = metrics.regular ? 6 : 4
            let x = r.minX + pad + CGFloat(CalDeltaPage.fraction(clock, cell: cell, at: t)) * (r.width - 2 * pad)
            let bottom = r.maxY - pad
            let top = bottom - (metrics.regular ? 22 : 17)
            var line = Path()
            line.move(to: CGPoint(x: x, y: top))
            line.addLine(to: CGPoint(x: x, y: bottom + 1))
            context.stroke(line, with: .color(Theme.cursor), style: StrokeStyle(lineWidth: 2, lineCap: .round))
            context.fill(Path(ellipseIn: CGRect(x: x - 3, y: top - 3, width: 6, height: 6)), with: .color(Theme.cursor))
        }
        .accessibilityHidden(true)
    }
}

/// The five Deltas of the page's Gamma, with their Nuclides; tap one to show it.
private struct GammaRibbon: View {
    let model: MonthModel
    let page: CalDeltaPage

    @Environment(ClockStore.self) private var store

    var body: some View {
        let clock = store.clock
        let first = Int(page.gamma) * CalDeltaPage.pagesPerGamma
        CalCard(Notation.periodName(level: 2, ordinal: page.path[2]), systemImage: "rectangle.split.3x1") {
            ClockTimeline(.periodic(store.isPlaying ? max(600, abs(store.rate) / 8) : 600)) { t in
                let shownPage = CalDeltaPage.page(clock, at: t)
                let phase = clock.level(at: t, 3)?.phase ?? 0
                HStack(spacing: 4) {
                    ForEach(0..<CalDeltaPage.pagesPerGamma, id: \.self) { i in
                        let index = first + i
                        let exists = index < CalDeltaPage.count(clock)
                        Button {
                            model.pageFollows = false
                            model.page = index
                            Haptics.play(.selection)
                        } label: {
                            VStack(spacing: 4) {
                                Canvas { context, size in
                                    let rect = CGRect(origin: .zero, size: size)
                                    context.fill(RoundedRectangle(cornerRadius: 6, style: .continuous).path(in: rect),
                                                 with: .color(index == page.index ? Theme.levelColor(3, opacity: 0.35) : Theme.levelColor(3, opacity: 0.12)))
                                    for k in 1..<5 {
                                        let x = size.width * CGFloat(k) / 5
                                        var p = Path()
                                        p.move(to: CGPoint(x: x, y: size.height * 0.45))
                                        p.addLine(to: CGPoint(x: x, y: size.height))
                                        context.stroke(p, with: .color(Theme.levelColor(4, opacity: 0.6)), lineWidth: 1)
                                    }
                                    if shownPage == index {
                                        let x = size.width * phase
                                        var p = Path()
                                        p.move(to: CGPoint(x: x, y: 0))
                                        p.addLine(to: CGPoint(x: x, y: size.height))
                                        context.stroke(p, with: .color(Theme.cursor), lineWidth: 2)
                                    }
                                }
                                .frame(height: 26)
                                ViewThatFits(in: .horizontal) {
                                    Text(verbatim: "\(Notation.ordinalName(i + 1)) · δ#\(i + 1)")
                                    Text(verbatim: "δ#\(i + 1)")
                                }
                                .font(.caption2.weight(index == page.index ? .bold : .regular))
                                .foregroundStyle(index == page.index ? Theme.ink : Theme.ink3)
                                .lineLimit(1)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .disabled(!exists)
                        .opacity(exists ? 1 : 0.35)
                        .accessibilityLabel(Text("Delta \(Notation.ordinalName(i + 1))"))
                        .accessibilityAddTraits(index == page.index ? .isSelected : [])
                    }
                }
            }
        }
    }

}

/// A cell in detail: its Helions with go buttons, the quarter(s) of the Delta it lies in, its eclipse and syncs.
private struct CellDetailView: View {
    let model: MonthModel

    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        ScrollView {
            if let i = model.selectedCell {
                content(model.deltaPage(model.page).cells[i])
                    .padding(16)
            }
        }
        .background { Backdrop() }
    }

    @ViewBuilder
    private func content(_ cell: CalDeltaPage.Cell) -> some View {
        let clock = store.clock
        let n = Notation.standard
        let page = model.deltaPage(model.page)
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                Text(verbatim: "ε#\(cell.epsilon) · \(cell.firstHelion)η–\(cell.firstHelion + 10)η")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                Spacer()
                Button("Close", systemImage: "xmark") { model.selectedCell = nil }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .keyboardShortcut(.cancelAction)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: "\(Notation.periodName(level: 3, ordinal: page.delta)) \(cell.quarters.map { Notation.quarterWords[$0.quarter] }.joined(separator: " · "))")
                    .font(.title3)
                    .foregroundStyle(Theme.ink2)
                Text(n.stamp(at: cell.start, upTo: "eta"))
                    .font(.code(13))
                    .foregroundStyle(Theme.teal)
                    .textSelection(.enabled)
                HStack(spacing: 8) {
                    // the Nuclide's phase where the cell begins: a cell is a seventh of its Nuclide
                    PairView(fraction: Double(cell.column) / Double(CalDeltaPage.columns), color: Theme.teal, height: 16)
                    Text(verbatim: "Nuclide phase at \(cell.firstHelion)η · \(Notation.pairText(Double(cell.column) / Double(CalDeltaPage.columns)))")
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(Theme.ink2)
                }
                .accessibilityElement(children: .combine)
                ClockTimeline(.periodic(store.isPlaying ? max(60, abs(store.rate) / 8) : 60)) { t in
                    Text(verbatim: relative(cell, at: t))
                        .font(.footnote.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                }
                Text(cell.cut < 1 ? "The catalogue ends inside this cell" : "11 Helions, one ζ cycle")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
            }
            CalActionButton(title: "Go to \(cell.firstHelion)η", systemImage: "location.fill", prominent: true) { travel(cell.start, "ε#\(cell.epsilon) \(cell.firstHelion)η") }
            if let e = cell.eclipse {
                Button {
                    travel(clock.catalogue[e], "eclipse \(Notation.eclipseName(e))")
                } label: {
                    HStack(spacing: 10) {
                        CalendarEclipseMark(size: 20)
                        Text("Eclipse \(Notation.eclipseName(e)) · position \(e)").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.gold)
                        Spacer()
                        Image(systemName: "location").foregroundStyle(Theme.ink3)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.goldDim.opacity(0.25)))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            if model.pureBand == 4 {
                Text("Nuclide").font(.footnote.weight(.semibold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.ink3)
                let nuclide = cell.z / Int64(CalDeltaPage.columns)
                bandRow(label: "ε#\(cell.epsilon)", level: 4, start: CalMath.landPoint(clock, level: 4, index: nuclide),
                        detail: "Nuclide \(cell.epsilon) of 5 in \(Notation.periodName(level: 3, ordinal: page.delta))"
                            + (cell.column > 0 ? " · began before this cell" : ""))
            } else if model.pureBand == 3 {
                Text("Delta quarters").font(.footnote.weight(.semibold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.ink3)
                ForEach(cell.quarters, id: \.quarter) { q in
                    bandRow(label: Notation.quarterWords[q.quarter], level: 3, start: page.quarterStart(clock, q.quarter),
                            detail: "\(Notation.periodName(level: 3, ordinal: page.delta)) \(Notation.quarterWords[q.quarter])"
                                + (q.startsHere ? "" : " · began before this cell"))
                }
            } else {
                helions(cell)
            }
            if !cell.syncs.isEmpty {
                Text("Solar sync").font(.footnote.weight(.semibold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.ink3)
                ForEach(cell.syncs, id: \.time) { s in
                    Button {
                        travel((s.time * 1000).rounded(.up) / 1000, "S\(s.sync)")
                    } label: {
                        HStack {
                            Image(systemName: "diamond.fill").font(.caption).foregroundStyle(Theme.gold)
                            Text(verbatim: s.quarter == 0 ? "S\(s.sync) begins" : "S\(s.sync) · \(CalMath.syncQuarterNames[s.quarter])")
                                .font(.subheadline)
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Text(n.clockText(at: s.time, upTo: "iota")).font(.code(12)).foregroundStyle(Theme.ink3)
                            Image(systemName: "location").font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// The 11 Helions of the cell, each with a go button.
    @ViewBuilder
    private func helions(_ cell: CalDeltaPage.Cell) -> some View {
        let clock = store.clock
        Text("Helions").font(.footnote.weight(.semibold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.ink3)
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            ForEach(0..<CalDeltaPage.helionsPerCell, id: \.self) { j in
                let start = CalDeltaPage.helionStart(clock, cell: cell, j)
                Button {
                    if let start { travel(start, "\(cell.firstHelion + j)η") }
                } label: {
                    HStack {
                        Text("\(cell.firstHelion + j)η").font(.reading(15, weight: .semibold)).foregroundStyle(Theme.levelColor(6))
                        Spacer(minLength: 0)
                        Image(systemName: "location").font(.caption).foregroundStyle(Theme.ink3)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.panel2))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(start == nil)
                .accessibilityLabel(Text("Go to \(cell.firstHelion + j)η"))
            }
        }
    }

    /// One row of the band's cycle: its name, where it begins (a go button).
    private func bandRow(label: String, level: Int, start: Double?, detail: String) -> some View {
        Button {
            if let start { travel(start, label) }
        } label: {
            HStack(spacing: 10) {
                CalendarLevelChip(text: label, level: level, compact: true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: detail).font(.subheadline).foregroundStyle(Theme.ink)
                    if let start {
                        Text(Notation.standard.stamp(at: start, upTo: "iota")).font(.code(12)).foregroundStyle(Theme.ink3)
                    } else {
                        Text("after the catalogue ends").font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                Spacer(minLength: 4)
                Image(systemName: "location").font(.caption).foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.levelColor(level, opacity: 0.1)))
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(start == nil)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(detail): go to where it begins"))
        .accessibilityAddTraits(.isButton)
    }

    private func travel(_ t: Double, _ what: String) {
        store.travel(to: t)
        Haptics.play(.step)
        toasts.show("Showing \(what)")
    }

    /// Where the cell lies from the shown moment: "Begins 2ε 5η after the shown moment", "The shown moment is in this
    /// cell; it ends in 4η 2ι", "Began 3η before the shown moment".
    private func relative(_ cell: CalDeltaPage.Cell, at t: Double) -> String {
        let n = Notation.standard
        let end = cell.cut < 1 ? store.clock.tMax : cell.end
        guard store.clock.inRange(t) else { return "" }
        if t >= cell.start, t < end { return "The shown moment is in this cell; it ends in \(n.between(t, end))" }
        if cell.start > t { return "Begins \(n.between(t, cell.start)) after the shown moment" }
        return "Began \(n.between(cell.start, t)) before the shown moment"
    }
}
