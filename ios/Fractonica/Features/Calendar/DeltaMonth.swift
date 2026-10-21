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
        let metrics = DeltaMetrics(width: width, short: short)
        let page = model.deltaPage(model.page)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    DeltaHeader(model: model, page: page)
                    QuarterBar(page: page)
                    ColumnHeader(metrics: metrics)
                    CalendarPager(index: $model.page, range: 0...(DeltaPage.count(store.clock) - 1), onSwipe: {
                        model.pageFollows = false
                        Haptics.play(.selection)
                    }) { index in
                        DeltaPageGrid(model: model, page: model.deltaPage(index), metrics: metrics)
                    }
                    .frame(height: metrics.gridHeight)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("A cell is 11 Helions. Gold diamonds mark the quarters of a solar sync (19η); a line in the Delta colour marks where a quarter of the Delta begins. Tap a cell for its Helions.")
                        if let last = page.cells.last(where: \.inRange), last.index < DeltaPage.cells - 1 || last.cut < 1 {
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
                        if let p = DeltaPage.page(store.clock, at: Date.now.timeIntervalSince1970) {
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

struct DeltaMetrics: Equatable {
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
    let page: DeltaPage

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
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                Text("α#\(path[0]) β#\(path[1]) γ#\(path[2]) δ#\(page.delta)")
                    .font(.code(13))
                    .foregroundStyle(Theme.teal)
            }
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
                StepPair(previous: "Previous \(model.pageStep.name)", next: "Next \(model.pageStep.name)", shortcuts: true, step: step)
                Text("by \(model.pageStep.name)")
                    .font(.caption2)
                    .foregroundStyle(Theme.levelColor(model.pageStep.level))
            }
        }
    }

    private func step(_ direction: Int) {
        let clock = store.clock
        let next = DeltaPage.clampPage(clock, model.page + direction * model.pageStep.rawValue)
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
private struct QuarterBar: View {
    let page: DeltaPage

    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        ClockTimeline(.periodic(store.isPlaying ? max(60, abs(store.rate) / 8) : 60)) { t in
            let clock = store.clock
            let onPage = DeltaPage.page(clock, at: t) == page.index
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
        }
    }
}

private struct ColumnHeader: View {
    let metrics: DeltaMetrics

    var body: some View {
        HStack(spacing: metrics.gap) {
            Color.clear.frame(width: metrics.rowLabel, height: 1)
            ForEach(DeltaPage.columnHelion, id: \.self) { h in
                Text("\(h)η")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.levelColor(6, opacity: 0.9))
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}

/// One Delta: 5 rows of 7 cells.
private struct DeltaPageGrid: View {
    let model: MonthModel
    let page: DeltaPage
    let metrics: DeltaMetrics

    @Environment(ClockStore.self) private var store

    var body: some View {
        VStack(spacing: metrics.gap) {
            ForEach(0..<DeltaPage.rows, id: \.self) { row in
                HStack(spacing: metrics.gap) {
                    Text("ε#\(row + 1)")
                        .font(.caption.weight(.semibold).monospacedDigit())
                        .foregroundStyle(Theme.levelColor(4))
                        .frame(width: metrics.rowLabel, alignment: .leading)
                        .accessibilityHidden(true)
                    ForEach(0..<DeltaPage.columns, id: \.self) { col in
                        let cell = page.cells[row * DeltaPage.columns + col]
                        Button {
                            Haptics.play(.selection)
                            withAnimation(.snappy) { model.selectedCell = model.selectedCell == cell.index ? nil : cell.index }
                        } label: {
                            DeltaCell(cell: cell, metrics: metrics, isSelected: model.selectedCell == cell.index)
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

    private func label(_ cell: DeltaPage.Cell) -> String {
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
    let cell: DeltaPage.Cell
    let metrics: DeltaMetrics
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 3) {
                if let e = cell.eclipse {
                    EclipseMark(size: metrics.regular ? 12 : 9)
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
                QuarterFlag(word: Notation.quarterWords[q.quarter], x: q.x0, cellWidth: metrics.cellWidth,
                            padding: metrics.regular ? 6 : 4, regular: metrics.regular)
            }
            Spacer(minLength: 0)
            if cell.inRange {
                HelionBand(cell: cell, regular: metrics.regular)
                    .frame(height: metrics.regular ? 18 : 13)
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
private struct QuarterFlag: View {
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
    let page: DeltaPage

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
                    LevelChip(text: CalMath.letter(level), level: level, compact: true).frame(width: 28)
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
                    model.page = DeltaPage.page(clock, alpha: path[0], beta: path[1], gamma: path[2], delta: path[3])
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

/// The 11 Helions of a cell, alternating, with the node of each and the solar sync quarters as gold diamonds.
private struct HelionBand: View {
    let cell: DeltaPage.Cell
    let regular: Bool

    var body: some View {
        Canvas { context, size in
            let barH: CGFloat = regular ? 7 : 5
            let y = size.height - barH
            let w = size.width * cell.cut
            let step = size.width / CGFloat(DeltaPage.helionsPerCell)
            for j in 0..<DeltaPage.helionsPerCell {
                let x0 = CGFloat(j) * step
                guard x0 < w else { break }
                let rect = CGRect(x: x0 + (j > 0 ? 0.5 : 0), y: y, width: min(step, w - x0) - (j > 0 ? 0.5 : 0), height: barH)
                let even = (Int(cell.z) * DeltaPage.helionsPerCell + j) % 2 == 0
                context.fill(Path(roundedRect: rect, cornerRadius: 1.2), with: .color(Theme.levelColor(6, opacity: even ? 0.85 : 0.45)))
                if regular {
                    let nx = x0 + step / 2
                    context.fill(Path(ellipseIn: CGRect(x: nx - 1, y: y - 3.5, width: 2, height: 2)), with: .color(Theme.levelColor(6, opacity: 0.6)))
                }
            }
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
        .accessibilityHidden(true)
    }
}

/// The shown moment's cell ringed, and where in it the moment is; the live clock's cell marked in red while travelling.
private struct DeltaCursor: View {
    let page: DeltaPage
    let metrics: DeltaMetrics
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
            let x = r.minX + pad + CGFloat(DeltaPage.fraction(clock, cell: cell, at: t)) * (r.width - 2 * pad)
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
    let page: DeltaPage

    @Environment(ClockStore.self) private var store

    var body: some View {
        let clock = store.clock
        let first = Int(page.gamma) * DeltaPage.pagesPerGamma
        CalCard(Notation.periodName(level: 2, ordinal: page.path[2]), systemImage: "rectangle.split.3x1") {
            ClockTimeline(.periodic(store.isPlaying ? max(600, abs(store.rate) / 8) : 600)) { t in
                let shownPage = DeltaPage.page(clock, at: t)
                let phase = clock.level(at: t, 3)?.phase ?? 0
                HStack(spacing: 4) {
                    ForEach(0..<DeltaPage.pagesPerGamma, id: \.self) { i in
                        let index = first + i
                        let exists = index < DeltaPage.count(clock)
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
    private func content(_ cell: DeltaPage.Cell) -> some View {
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
                    PairView(fraction: Double(cell.column) / Double(DeltaPage.columns), color: Theme.teal, height: 16)
                    Text(verbatim: "Nuclide phase at \(cell.firstHelion)η · \(Notation.pairText(Double(cell.column) / Double(DeltaPage.columns)))")
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
                        EclipseMark(size: 20)
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
            Text("Helions").font(.footnote.weight(.semibold)).textCase(.uppercase).tracking(0.8).foregroundStyle(Theme.ink3)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
                ForEach(0..<DeltaPage.helionsPerCell, id: \.self) { j in
                    let start = DeltaPage.helionStart(clock, cell: cell, j)
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

    private func travel(_ t: Double, _ what: String) {
        store.travel(to: t)
        Haptics.play(.step)
        toasts.show("Showing \(what)")
    }

    /// Where the cell lies from the shown moment: "Begins 2ε 5η after the shown moment", "The shown moment is in this
    /// cell; it ends in 4η 2ι", "Began 3η before the shown moment".
    private func relative(_ cell: DeltaPage.Cell, at t: Double) -> String {
        let n = Notation.standard
        let end = cell.cut < 1 ? store.clock.tMax : cell.end
        guard store.clock.inRange(t) else { return "" }
        if t >= cell.start, t < end { return "The shown moment is in this cell; it ends in \(n.between(t, end))" }
        if cell.start > t { return "Begins \(n.between(t, cell.start)) after the shown moment" }
        return "Began \(n.between(cell.start, t)) before the shown moment"
    }
}
