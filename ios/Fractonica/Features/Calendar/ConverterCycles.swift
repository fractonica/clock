import FractonicaKit
import SwiftUI

// The Fractonica side of the converter, shared by both modes: the Saros position (with a ruler to scrub), the cycle
// address (stepped entry by entry), the glyph state of every depth (with "when does it show this state") and the
// solar sync. Pure mode passes `pure: true` and every text is said in Fractonica terms.

// MARK: - Position

struct PositionCard: View {
    let model: ConverterModel
    let snap: ConverterSnapshot

    @Environment(ClockStore.self) private var store

    var body: some View {
        CalCard("Saros position", systemImage: "ruler") {
            if let p = snap.position {
                let value = Double(p.ordinal) + (Double("0." + p.fraction) ?? 0)
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text("\(p.ordinal)")
                        .font(.reading(36, weight: .semibold))
                        .foregroundStyle(Theme.ink)
                    Text(".\(p.fraction.prefix(9))")
                        .font(.reading(24, weight: .light))
                        .foregroundStyle(Theme.ink2)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(Text("position \(p.ordinal).\(p.fraction.prefix(6))"))
                SarosRuler(position: value, extent: store.clock.extent) { pos in
                    model.set(store.clock.time(atPosition: pos), from: .position)
                }
                CommitField(label: "Exact position", value: "\(p.ordinal).\(p.fraction)", prompt: "22.927850216635", numeric: true) { text in
                    switch CalMath.time(store.clock, positionText: text.replacingOccurrences(of: "pos", with: "")) {
                    case .success(let t):
                        model.set(t, from: .position)
                        return nil
                    case .failure(let e):
                        return e
                    }
                }
            }
        }
    }
}

/// The 70 eclipses of the catalogue as ticks and the position on them; drag to scrub (it pins the converter).
private struct SarosRuler: View {
    let position: Double
    let extent: Int
    let scrub: (Double) -> Void

    @State private var lastWhole = -1

    var body: some View {
        Canvas { context, size in
            let inset: CGFloat = 6
            let w = size.width - 2 * inset
            let y = size.height * 0.62
            var axis = Path()
            axis.move(to: CGPoint(x: inset, y: y))
            axis.addLine(to: CGPoint(x: inset + w, y: y))
            context.stroke(axis, with: .color(Theme.line2), lineWidth: 1)
            for k in 0...extent {
                let x = inset + w * CGFloat(k) / CGFloat(extent)
                let tall: CGFloat = k % 10 == 0 ? 7 : 3.5
                var tick = Path()
                tick.move(to: CGPoint(x: x, y: y - tall))
                tick.addLine(to: CGPoint(x: x, y: y + tall))
                context.stroke(tick, with: .color(k % 10 == 0 ? Theme.ink3 : Theme.line2), lineWidth: 1)
            }
            let px = inset + w * CGFloat(position / Double(extent))
            var done = Path()
            done.move(to: CGPoint(x: inset, y: y))
            done.addLine(to: CGPoint(x: px, y: y))
            context.stroke(done, with: .color(Theme.teal.opacity(0.55)), lineWidth: 2)
            context.fill(Path(ellipseIn: CGRect(x: px - 6, y: y - 6, width: 12, height: 12)), with: .color(Theme.teal.opacity(0.25)))
            context.fill(Path(ellipseIn: CGRect(x: px - 3.5, y: y - 3.5, width: 7, height: 7)), with: .color(Theme.teal))
            for k in stride(from: 0, through: extent, by: 10) {
                let x = inset + w * CGFloat(k) / CGFloat(extent)
                context.draw(Text("\(k)").font(.system(size: 9).monospacedDigit()).foregroundStyle(Theme.ink3), at: CGPoint(x: x, y: y - 14))
            }
        }
        .frame(height: 34)
        .contentShape(.rect)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { g in
                    // the canvas is laid out with the same inset as above
                    let w = max(1, rulerWidth - 12)
                    let pos = min(Double(extent) - 1e-9, max(0, Double((g.location.x - 6) / w) * Double(extent)))
                    let whole = Int(pos)
                    if whole != lastWhole {
                        lastWhole = whole
                        Haptics.play(.selection)
                    }
                    scrub(pos)
                }
                .onEnded { _ in lastWhole = -1 }
        )
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { rulerWidth = $0 }
        .accessibilityElement()
        .accessibilityLabel(Text("Saros position"))
        .accessibilityValue(Text(String(format: "%.4f of %d", position, extent)))
        .accessibilityAdjustableAction { direction in
            scrub(min(Double(extent) - 1e-9, max(0, position + (direction == .increment ? 0.25 : -0.25))))
        }
    }

    @State private var rulerWidth: CGFloat = 300
}

// MARK: - Address

struct AddressCard: View {
    let model: ConverterModel
    let snap: ConverterSnapshot
    let earth: EarthFormatter
    let pure: Bool

    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        let clock = store.clock
        let path = pure ? Array(snap.path.prefix(5)) : snap.path
        CalCard("Cycle address", systemImage: "point.3.connected.trianglepath.dotted") {
            if !pure {
                NudgeStepper(value: model.depth, range: 1...14, label: "Depth", display: { "depth \($0)" }) { d in
                    withAnimation(.snappy) { model.depth = d }
                }
            }
        } content: {
            FlowLayout(spacing: 4, lineSpacing: 6) {
                ForEach(Array(path.enumerated()), id: \.offset) { level, n in
                    HStack(spacing: 4) {
                        if level > 0 { Text("›").foregroundStyle(Theme.ink3).accessibilityHidden(true) }
                        Text(CalMath.cycleLabel(level: level, ordinal: n))
                            .font(.code(15, weight: .semibold))
                            .foregroundStyle(Theme.levelColor(level))
                    }
                }
            }
            .textSelection(.enabled)
            .accessibilityElement(children: .combine)
            VStack(spacing: 6) {
                ForEach(Array(path.enumerated()), id: \.offset) { level, n in
                    let maximum = max(1, CalMath.childCount(clock, parent: Array(path.prefix(level))))
                    HStack(spacing: 10) {
                        LevelChip(text: "\(CalMath.letter(level)) \(level + 1)", level: level, compact: true)
                            .frame(width: 46, alignment: .leading)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(name(level, n)).font(.subheadline).foregroundStyle(Theme.ink)
                            Text("of \(maximum)\(level == 0 ? " in the catalogue" : " in its \(CalMath.letter(level - 1))")")
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 4)
                        NudgeStepper(value: n, range: 1...maximum, label: name(level, n), display: { "#\($0)" }, tint: Theme.levelColor(level)) { v in
                            edit(path, level: level, to: v)
                        }
                    }
                }
            }
            HStack {
                Text("Point in the cycle").font(.subheadline).foregroundStyle(Theme.ink3)
                Spacer()
                Picker("Point in the cycle", selection: Binding(get: { model.point }, set: { p in
                    model.point = p
                    edit(path, level: nil, to: 0)
                })) {
                    ForEach(CalMath.Point.allCases) { p in
                        Text(pure && p == .phase ? "Same phase as now" : p.label).tag(p)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .tint(Theme.ink)
            }
            result(path)
        }
    }

    private func name(_ level: Int, _ n: Int) -> String {
        if pure {
            if Notation.isMajor(level) { return Notation.periodName(level: level, ordinal: n) }
            return Notation.unit(level: level)?.name ?? CalMath.letter(level)
        }
        return Notation.levelNames[level]
    }

    @ViewBuilder
    private func result(_ path: [Int]) -> some View {
        let clock = store.clock
        if let index = clock.pathToCycle(path), let facts = clock.cycle(level: path.count - 1, index: index) {
            let level = path.count - 1
            VStack(alignment: .leading, spacing: 4) {
                if pure {
                    Text("→ \(Notation.standard.stamp(at: model.t, upTo: Notation.resolutionOf(level)))")
                        .font(.code(14))
                        .foregroundStyle(Theme.ink)
                    Text("\(Notation.standard.dateText(at: model.t, upTo: Notation.resolutionOf(max(4, level)))) · one cycle is \(Notation.standard.cycleLength(level: level))")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                } else {
                    Text("→ \(earth.long(model.t)).\(CalMath.pad(earth.parts(model.t).ms, 3)) \(earth.tag(model.t))")
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(Theme.ink)
                    Text("\(CalMath.cycleLabel(level: level, ordinal: path[level])) lasts \(EarthTime.duration(facts.duration, parts: 3))\(facts.clipped ? ", clipped by the catalogue's end" : "")")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                }
            }
            .textSelection(.enabled)
            .padding(.top, 2)
        }
    }

    /// Step one entry (or re-place the point when `level` is nil); finer entries keep their numbers where they exist.
    private func edit(_ path: [Int], level: Int?, to v: Int) {
        let clock = store.clock
        var p = path
        if let level { p[level] = v }
        p = CalMath.normalize(clock, path: p)
        let phaseNow = snap.levels.indices.contains(p.count - 1) ? snap.levels[p.count - 1].phase : 0
        guard let t = CalMath.time(clock, path: p, point: model.point, phaseNow: phaseNow) else {
            toasts.show("That point lies beyond the end of the catalogue")
            Haptics.play(.warning)
            return
        }
        model.setAddress(p, t: t)
    }
}

// MARK: - Glyph states

/// The glyph of every depth (Earth mode): the state its cycle shows, tap for when it shows any other.
struct GlyphStatesCard: View {
    let model: ConverterModel
    let snap: ConverterSnapshot
    let earth: EarthFormatter

    var body: some View {
        CalCard("Glyph states", systemImage: "square.grid.3x3.topleft.filled") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], spacing: 8) {
                ForEach(snap.levels, id: \.level) { r in
                    Button {
                        model.pickLevel = r.level
                    } label: {
                        GlyphTile(reading: r)
                    }
                    .buttonStyle(.plain)
                    .popover(isPresented: Binding(get: { model.pickLevel == r.level }, set: { if !$0, model.pickLevel == r.level { model.pickLevel = nil } })) {
                        StatePicker(model: model, level: r.level, current: [r.index], pure: false, earth: earth)
                            .presentationCompactAdaptation(.sheet)
                            .presentationDetents([.medium, .large])
                    }
                }
            }
            Text("Each depth shows one glyph for the phase of its cycle. Tap one to see when its depth shows any other state.")
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct GlyphTile: View {
    let reading: LevelReading

    var body: some View {
        let r = reading
        VStack(spacing: 6) {
            HStack(spacing: 4) {
                Text(r.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.levelColor(r.level))
                Text("\(r.depth)").font(.caption).foregroundStyle(Theme.ink3)
                Spacer(minLength: 0)
                Text("#\(r.local + 1)/\(r.siblings)").font(.caption2.monospacedDigit()).foregroundStyle(Theme.ink3)
            }
            GlyphView(index: r.index, strokes: 2, color: Theme.teal)
                .frame(height: 30)
            Text("\(r.index) · \(GlyphWords.words(value: r.value, derivative: r.derivative))")
                .font(.caption2.monospacedDigit())
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.panel2.opacity(0.9)))
        .contentShape(.rect)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(r.name) depth \(r.depth), state \(r.index) of \(r.states), \(GlyphWords.words(value: r.value, derivative: r.derivative))"))
        .accessibilityHint(Text("Shows when this depth shows another state"))
    }
}

enum GlyphWords {
    /// "rising ↗", "peak ▲" … (convert.js `stateMeaning`).
    static func words(value: Int, derivative: Int) -> String {
        if derivative > 0 { return "rising ↗" }
        if derivative < 0 { return "falling ↘" }
        return value > 0 ? "peak ▲" : value < 0 ? "valley ▼" : "zero"
    }
}

/// Choose a state of a depth (a glyph; in pure mode a glyph pair) and see the next and previous times it shows.
struct StatePicker: View {
    let model: ConverterModel
    let level: Int
    /// The state now: one glyph index, or the pair [coarse, fine] in pure mode.
    let current: [Int]
    let pure: Bool
    let earth: EarthFormatter

    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss
    @State private var coarse: Int?
    @State private var fine: Int?

    var body: some View {
        let chosen = [coarse ?? current[0]] + (pure ? [fine].compactMap { $0 } : [])
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .firstTextBaseline) {
                    LevelChip(text: "\(CalMath.letter(level)) \(level + 1)", level: level)
                    Text(pure ? "When does it show this pair?" : "When does it show this state?")
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    Button("Close", systemImage: "xmark") { dismiss() }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                }
                if pure { Text("Coarse glyph").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3) }
                stateGrid(selected: chosen[0], now: current[0]) { coarse = $0 }
                if pure {
                    HStack {
                        Text("Fine glyph").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3)
                        Spacer()
                        if fine != nil {
                            Button("Any") { fine = nil }.font(.footnote).buttonStyle(.borderless)
                        }
                    }
                    stateGrid(selected: fine ?? -1, now: current.count > 1 && (coarse ?? current[0]) == current[0] ? current[1] : -1) { fine = $0 }
                }
                occurrences(chosen)
            }
            .padding(20)
        }
        .frame(minWidth: 320, idealWidth: 380, minHeight: 420)
        .background { Backdrop() }
    }

    private func stateGrid(selected: Int, now: Int, choose: @escaping (Int) -> Void) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: pure ? 8 : 4), spacing: 8) {
            ForEach(0..<16, id: \.self) { i in
                Button {
                    choose(i)
                    Haptics.play(.selection)
                } label: {
                    VStack(spacing: 4) {
                        GlyphView(index: i, strokes: 2, color: i == selected ? Theme.background : Theme.teal)
                            .frame(height: pure ? 22 : 30)
                        if !pure {
                            Text("\(i)").font(.caption2.monospacedDigit()).foregroundStyle(i == selected ? Theme.background : Theme.ink3)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(i == selected ? Theme.teal : Theme.panel2)
                            .strokeBorder(i == now ? Theme.cursor : .clear, lineWidth: 1.5)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("state \(i)\(i == now ? ", showing now" : "")"))
                .accessibilityAddTraits(i == selected ? .isSelected : [])
            }
        }
    }

    @ViewBuilder
    private func occurrences(_ digits: [Int]) -> some View {
        let clock = store.clock
        let t = model.t
        let next = clock.stateOccurrences(level: level, digits: digits, around: t, strokes: 2, direction: 1, count: 3)
        let previous = clock.stateOccurrences(level: level, digits: digits, around: t, strokes: 2, direction: -1, count: 3)
        VStack(alignment: .leading, spacing: 8) {
            Text("Next").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3)
            if next.isEmpty { Text("Not again inside the catalogue").font(.footnote).foregroundStyle(Theme.ink3) }
            ForEach(next, id: \.start) { occurrenceRow($0, digits) }
            Text("Before").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3).padding(.top, 4)
            if previous.isEmpty { Text("Not before inside the catalogue").font(.footnote).foregroundStyle(Theme.ink3) }
            ForEach(previous, id: \.start) { occurrenceRow($0, digits) }
        }
    }

    private func occurrenceRow(_ o: StateOccurrence, _ digits: [Int]) -> some View {
        let clock = store.clock
        // the first millisecond that shows the state
        let landed = CalMath.firstMs(o.start) { c in
            guard let r = clock.odometer(at: c, level, strokes: 2, digits: digits.count) else { return false }
            return r.digits == digits
        } ?? CalMath.r3(o.start)
        let n = Notation.standard
        return HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(pure ? n.stamp(at: landed, upTo: Notation.resolutionOf(min(13, level + 2))) : "\(earth.long(landed)) \(earth.tag(landed))")
                    .font(pure ? .code(13) : .subheadline.monospacedDigit())
                    .foregroundStyle(Theme.ink)
                Text(pure ? n.countdown(landed - model.t, at: model.t) + " · lasts " + n.between(o.start, o.end) : EarthTime.countdown(landed - model.t) + " · lasts " + EarthTime.duration(o.end - o.start))
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
            }
            Spacer()
            Button("Pin", systemImage: "pin") {
                model.set(landed, from: .glyph)
                dismiss()
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .help("Pin the converter there")
            Button("Go there", systemImage: "location.fill") {
                store.travel(to: landed)
                model.set(landed, from: .glyph)
                Haptics.play(.step)
                dismiss()
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .help("Travel there")
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.panel2.opacity(0.8)))
    }
}

// MARK: - Solar sync

struct SolarCard: View {
    let model: ConverterModel
    let snap: ConverterSnapshot
    let earth: EarthFormatter
    let pure: Bool

    @Environment(ClockStore.self) private var store
    @State private var range: ClosedRange<Int>?

    var body: some View {
        let clock = store.clock
        let n = Notation.standard
        CalCard("Solar sync", systemImage: "sun.max") {
            if let s = snap.solar {
                let syncs = range ?? s.sync...s.sync
                HStack(alignment: .center, spacing: 14) {
                    Group {
                        if pure {
                            PairView(fraction: s.phase, color: Theme.gold, height: 30)
                        } else {
                            OdometerView(digits: s.digits3, color: Theme.gold).frame(height: 28)
                        }
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: "\(pure ? "S" : "Sync ")\(s.sync)")
                            .font(.reading(22, weight: .semibold))
                            .foregroundStyle(Theme.gold)
                        Text("\(Notation.quarterWords[s.quarter]) quarter · 19 Helions\(pure ? "" : " ≈ 4 days")")
                            .font(.footnote)
                            .foregroundStyle(Theme.ink3)
                    }
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                HStack {
                    Text("Number").font(.subheadline).foregroundStyle(Theme.ink3)
                    Spacer()
                    SyncStepper(value: s.sync, range: syncs) { k in
                        if let info = clock.solarSync(number: k) { model.set((info.start * 1000).rounded(.up) / 1000, from: .sync) }
                    }
                }
                if pure {
                    CalValueRow(label: "Begins", value: n.stamp(at: s.start, upTo: "lambda"), mono: true)
                    CalValueRow(label: "Ends", value: n.stamp(at: s.end, upTo: "lambda"), mono: true)
                    CalValueRow(label: "Drift", value: n.driftText(start: s.start, nominalStart: s.nominalStart, drift: s.drift))
                } else {
                    CalValueRow(label: "Begins", value: "\(earth.dateTime(s.start)) \(earth.tag(s.start))")
                    CalValueRow(label: "Ends", value: "\(earth.dateTime(s.end)) \(earth.tag(s.end))")
                    CalValueRow(label: "Civil grid", value: earth.dateTime(s.nominalStart))
                    CalValueRow(label: "Drift", value: "\(s.drift < 0 ? "−" : "+")\(EarthTime.duration(abs(s.drift), parts: 2)) \(s.drift < 0 ? "behind" : "ahead of") the 4-day grid")
                }
                VStack(spacing: 4) {
                    ForEach(0..<4, id: \.self) { q in
                        let time = s.start + Double(q + 1) / 4 * (s.end - s.start)
                        HStack {
                            Circle().fill(q == s.quarter ? Theme.gold : Theme.goldDim).frame(width: 7, height: 7)
                            Text(Notation.quarterWords[q]).font(.subheadline).foregroundStyle(q == s.quarter ? Theme.ink : Theme.ink2)
                            Spacer()
                            Text(pure ? n.stamp(at: time, upTo: "iota") : earth.dateTime(time))
                                .font(pure ? .code(12) : .subheadline.monospacedDigit())
                                .foregroundStyle(Theme.ink2)
                        }
                    }
                }
                .padding(.top, 2)
            } else {
                Text(pure ? "No complete sync here: the first and last syncs of the catalogue are cut in half." : "No complete sync here: the first and last ≈ 2.5 days of the catalogue belong to half-syncs.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink3)
            }
        }
        .task { if range == nil { range = CalMath.syncRange(clock) } }
    }
}

/// − n + for a sync number (its range is too long for a menu); hold to repeat.
private struct SyncStepper: View {
    let value: Int
    let range: ClosedRange<Int>
    let onChange: (Int) -> Void

    var body: some View {
        NudgeStepper(value: value, range: range, label: "Sync number", display: { String($0) }, tint: Theme.gold, menu: false, onChange: onChange)
    }
}
