import FractonicaKit
import SwiftUI

/// What a tapped block or eclipse is: a popover on iPad and Mac, a sheet on iPhone. A cycle shows its name, where it
/// sits in the hierarchy, its wave with the five thresholds and their times, its length and where the cursor is in it,
/// with "Travel here", "Fit this cycle" and "Select depth"; the chevrons step to the neighbouring cycles. Pure mode
/// says all of it in Fractonica terms.
struct TimelineReadout: View {
    let item: TimelineReadoutItem
    let controller: TimelineController

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss

    private var data: TimelineData { controller.data }
    private var clock: FractonicaClock { data.clock }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch item.selection {
                case .cycle(let level, let idx): cycle(level: level, idx: idx)
                case .eclipse(let k): eclipse(k)
                }
            }
            .padding(20)
        }
        .scrollBounceBehavior(.basedOnSize)
        #if os(macOS)
        .frame(width: 360)
        .frame(minHeight: 300, idealHeight: 470)
        #else
        .frame(idealWidth: 420, idealHeight: 600)
        #endif
    }

    // MARK: Cycle

    @ViewBuilder
    private func cycle(level: Int, idx: Int64) -> some View {
        let words = settings.wording
        let pure = words.pure
        if let facts = clock.cycle(level: level, index: idx) {
            let info = clock.levelInfo(level)
            let color = Theme.levelColor(level, lightness: 0.72)
            let siblings = info.siblings ?? data.alpha.count
            let local = Int(info.siblings.map { idx % Int64($0) } ?? idx)
            let names = data.names(level, idx)
            ClockTimeline(.periodic(1)) { t in
                VStack(alignment: .leading, spacing: 16) {
                    header(level: level, idx: idx, color: color,
                           title: pure ? names.name : "\(info.letter) \(info.depth) · \(local + 1) of \(siblings)",
                           subtitle: pure ? "\(words.levelName(level)) · \(local + 1) of \(siblings) · lasts \(words.levelLength(level))"
                                          : "depth \(info.depth) · \(words.levelLength(level))",
                           path: path(level: level, idx: idx, start: facts.start, pure: pure))
                    TimelineCycleWave(facts: facts, cursor: clock.inRange(t) ? t : nil, color: color, pure: pure)
                        .frame(height: 64)
                    actions(level: level, idx: idx, start: facts.start, end: facts.end, color: color)
                    factsTable(facts, level: level, t: t, words: words)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(thresholdsCaption(facts, words: words))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.ink3)
                            .padding(.horizontal, 4)
                        VStack(spacing: 0) {
                            ForEach(Array(facts.events.enumerated()), id: \.offset) { i, event in
                                row(eventName(i, pure: pure),
                                    event.time.map { stamp($0, level: level, facts: facts, words: words) } ?? "after the catalogue",
                                    marked: event.time.map { abs($0 - t) < 0.5 } ?? false)
                                if i < 4 { Divider().overlay(Theme.line) }
                            }
                        }
                        .padding(.horizontal, 12)
                        .background(Theme.panel.opacity(0.7), in: .rect(cornerRadius: 12))
                    }
                }
            }
        } else {
            ContentUnavailableView("Outside the catalogue", systemImage: "circle.dashed",
                                   description: Text("This cycle does not exist in the Saros 141 catalogue."))
        }
    }

    private func header(level: Int, idx: Int64, color: Color, title: String, subtitle: String, path: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text(clock.levelInfo(level).letter)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(color)
                .frame(width: 50, height: 50)
                .background(Theme.levelColor(level, opacity: 0.16, lightness: 0.6), in: .circle)
                .overlay(Circle().strokeBorder(Theme.levelColor(level, opacity: 0.5), lineWidth: 1))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                Text(path)
                    .font(.code(12))
                    .foregroundStyle(Theme.ink3)
                    .textSelection(.enabled)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                stepButton(level: level, idx: idx, by: -1)
                stepButton(level: level, idx: idx, by: 1)
            }
        }
    }

    private func stepButton(level: Int, idx: Int64, by delta: Int64) -> some View {
        let next = idx + delta
        let exists = next >= 0 && Int128(next) < clock.count(level)
        return Button {
            controller.readout = TimelineReadoutItem(selection: .cycle(level: level, idx: next), anchor: item.anchor)
        } label: {
            Image(systemName: delta < 0 ? "chevron.left" : "chevron.right")
                .font(.body.weight(.semibold))
                .frame(width: 34, height: 34)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .disabled(!exists)
        .accessibilityLabel(delta < 0 ? "Previous cycle" : "Next cycle")
    }

    /// Where the cycle sits: "α6 β4 γ9 δ3 ε5 ζ3 η1" · pure the letter address of its start.
    private func path(level: Int, idx: Int64, start: Double, pure: Bool) -> String {
        if pure { return Notation.standard.addressAt(start + 0.001, level: level) }
        return clock.cycleToPath(level: level, cycle: idx).enumerated()
            .map { "\(clock.levelInfo($0.offset).letter)\($0.element)" }
            .joined(separator: " ")
    }

    private func eventName(_ i: Int, pure: Bool) -> String {
        ["Begins", "Peak", "Node", "Valley", "Ends"][i]
    }

    /// Whether a cycle's thresholds are said as times of day under one date.
    private func shortCycle(_ facts: CycleFacts) -> Bool { facts.duration < 2 * 86_400 }

    /// The heading over the thresholds: Earth the day (and zone) when the cycle is short, else the zone.
    private func thresholdsCaption(_ facts: CycleFacts, words: Wording) -> String {
        if words.pure { return "THRESHOLDS" }
        let tag = words.earth.tag(facts.start)
        return shortCycle(facts) ? "THRESHOLDS · \(words.day(facts.start).uppercased()) · \(tag)" : "THRESHOLDS · \(tag)"
    }

    /// A threshold's moment: Earth the time of day for a short cycle (with the day when it moved on), else the date
    /// and time; pure the letter address, fine enough to tell the five apart.
    private func stamp(_ t: Double, level: Int, facts: CycleFacts, words: Wording) -> String {
        guard words.pure else {
            let earth = words.earth
            if shortCycle(facts) {
                let a = earth.parts(facts.start), b = earth.parts(t)
                let time = earth.time(t, seconds: true)
                if a.year == b.year, a.month == b.month, a.day == b.day { return time }
                return "\(EarthTime.weekdaysShort[b.weekday]) \(b.day) · \(time)"
            }
            return earth.long(t, seconds: false)
        }
        let res = Notation.resolutionOf(min(Fractonica.maxLevel, level + 3))
        return words.notation.dateText(at: t, letters: true, upTo: res)
    }

    private func row(_ name: String, _ value: String, marked: Bool) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(name)
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
            Spacer(minLength: 12)
            Text(value)
                .font(.reading(14))
                .foregroundStyle(marked ? Theme.cursor : Theme.ink)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .textSelection(.enabled)
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func factsTable(_ facts: CycleFacts, level: Int, t: Double, words: Wording) -> some View {
        let pure = words.pure
        let length = pure ? words.notation.between(facts.start, facts.end) : EarthTime.duration(facts.duration, parts: 2)
        let inside = t >= facts.start && t < facts.end
        VStack(spacing: 0) {
            row("Length", length + (facts.clipped ? (pure ? " · cut by the catalogue" : " · clipped") : ""), marked: false)
            Divider().overlay(Theme.line)
            if inside {
                row("Ends", pure ? data.ruler.relText(facts.end, to: t) : EarthTime.countdown(facts.end - t), marked: false)
                Divider().overlay(Theme.line)
                if let reading = clock.level(at: t, level) {
                    HStack {
                        Text("Cursor")
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink2)
                        Spacer()
                        if pure {
                            Text(Notation.isMajor(level) ? Notation.quarterWords[reading.quarter] : data.names(level, reading.cycle).short)
                                .font(.reading(14))
                                .foregroundStyle(Theme.ink)
                            if !Notation.isMajor(level) {
                                PairView(fraction: reading.phase, color: Theme.levelColor(level, lightness: 0.72), height: 14)
                            }
                        } else {
                            Text("\(Fractonica.quarterNames[reading.quarter]) quarter · \(TimelineInspector.percent(reading.progress))%")
                                .font(.reading(14))
                                .foregroundStyle(Theme.ink)
                        }
                    }
                    .padding(.vertical, 9)
                    .accessibilityElement(children: .combine)
                }
            } else {
                let before = t < facts.start
                row(before ? "Begins" : "Ended",
                    pure ? data.ruler.relText(before ? facts.start : facts.end, to: t)
                         : EarthTime.countdown((before ? facts.start : facts.end) - t),
                    marked: false)
            }
        }
        .padding(.horizontal, 12)
        .background(Theme.panel.opacity(0.7), in: .rect(cornerRadius: 12))
    }

    private func actions(level: Int, idx: Int64, start: Double, end: Double, color: Color) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    controller.travel(to: start + 0.001, reveal: true)
                    dismiss()
                } label: {
                    Label("Travel here", systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .tint(Theme.cursor.opacity(0.85))
                Button {
                    controller.fit(level: level, idx: idx)
                    dismiss()
                } label: {
                    Label("Fit this cycle", systemImage: "arrow.left.and.line.vertical.and.arrow.right")
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
            }
            .controlSize(.large)
            if settings.selectedLevel != level {
                Button {
                    settings.selectedLevel = level
                    Haptics.play(.selection)
                } label: {
                    Label("Select depth \(level + 1) (\(clock.levelInfo(level).letter)) everywhere", systemImage: "scope")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
                .tint(color)
            }
        }
        .labelStyle(.titleAndIcon)
    }

    // MARK: Eclipse

    @ViewBuilder
    private func eclipse(_ k: Int) -> some View {
        let words = settings.wording
        let pure = words.pure
        let e = clock.catalogue[k]
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: k % 4 == 0 ? "diamond.fill" : "circle.fill")
                .font(.system(size: 22))
                .foregroundStyle(k % 4 == 0 ? Theme.levelColor(0, lightness: 0.72) : Theme.teal)
                .frame(width: 50, height: 50)
                .background(Theme.teal.opacity(0.12), in: .circle)
            VStack(alignment: .leading, spacing: 3) {
                Text("Eclipse \(Notation.eclipseName(k))")
                    .font(.title3.weight(.semibold))
                Text("Greatest eclipse of Saros 141 · one of \(clock.catalogue.count)")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
            Spacer(minLength: 0)
        }
        ClockTimeline(.periodic(1)) { t in
            VStack(spacing: 0) {
                if pure {
                    row("Address", words.notation.stamp(at: e, upTo: "iota"), marked: false)
                } else {
                    row("Moment", "\(words.earth.long(e)) \(words.earth.tag(e))", marked: false)
                }
                Divider().overlay(Theme.line)
                row("Position", "pos \(k)" + (k % 4 == 0 ? (pure ? " · α#\(k / 4 + 1) begins" : " · starts α cycle \(k / 4 + 1)") : ""), marked: false)
                Divider().overlay(Theme.line)
                let now = Date.now.timeIntervalSince1970
                row("From now", pure ? data.ruler.relText(e, to: now) : EarthTime.countdown(e - now), marked: false)
                if !store.isLive {
                    Divider().overlay(Theme.line)
                    row("From the cursor", pure ? data.ruler.relText(e, to: t) : EarthTime.countdown(e - t), marked: false)
                }
            }
            .padding(.horizontal, 12)
            .background(Theme.panel.opacity(0.7), in: .rect(cornerRadius: 12))
        }
        Text("The 70 greatest-eclipse instants are the time base of the clock; every fourth one starts an α cycle.")
            .font(.footnote)
            .foregroundStyle(Theme.ink3)
        HStack(spacing: 10) {
            Button {
                controller.travel(to: e, reveal: true)
                dismiss()
            } label: {
                Label("Travel here", systemImage: "clock.arrow.trianglehead.counterclockwise.rotate.90")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .tint(Theme.cursor.opacity(0.85))
            if k < clock.extent {
                Button {
                    controller.viewport.fit(e, clock.catalogue[k + 1], cursor: store.time(), cursorIn: true, reduceMotion: controller.reduceMotion)
                    dismiss()
                } label: {
                    Label("Fit its Saros", systemImage: "arrow.left.and.line.vertical.and.arrow.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
            }
        }
        .controlSize(.large)
    }
}

/// A cycle's wave (0 → peak → valley → 0, linear in position) with its five thresholds and the cursor on it.
struct TimelineCycleWave: View {
    let facts: CycleFacts
    let cursor: Double?
    let color: Color
    let pure: Bool

    var body: some View {
        let start = facts.start, end = facts.end
        let times = facts.events.map(\.time)
        Canvas { context, size in
            let pad = 10.0
            let w = size.width - 2 * pad
            let mid = size.height * 0.42, a = size.height * 0.3
            func x(_ t: Double) -> Double { pad + (t - start) / max(1e-9, end - start) * w }
            let ys = [mid, mid - a, mid, mid + a, mid]
            let pts: [CGPoint] = times.enumerated().compactMap { i, t in t.map { CGPoint(x: x($0), y: ys[i]) } }
            var wave = Path()
            // between the thresholds the wave is linear in position, which is linear in time within a Saros
            if let first = pts.first {
                wave.move(to: first)
                for p in pts.dropFirst() { wave.addLine(to: p) }
            }
            context.stroke(Path { $0.move(to: CGPoint(x: pad, y: mid)); $0.addLine(to: CGPoint(x: pad + w, y: mid)) },
                           with: .color(Theme.line2), lineWidth: 1)
            context.stroke(wave, with: .color(color.opacity(0.85)), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            for (i, p) in pts.enumerated() {
                let r = i == 2 ? 4.0 : 3.2
                context.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r)), with: .color(color))
            }
            let labels = pure ? ["", "Peak", "Node", "Valley", "End"] : ["begin", "peak", "node", "valley", "end"]
            for (i, t) in times.enumerated() {
                guard let t, !labels[i].isEmpty || i == 0 else { continue }
                let label = pure ? (i == 0 ? "" : labels[i]) : labels[i]
                guard !label.isEmpty else { continue }
                // pure: a quarter is named by the threshold that ends it, so its word sits under that stretch's end
                context.draw(Text(label).font(.caption2).foregroundStyle(Theme.ink3),
                             at: CGPoint(x: min(pad + w - 14, max(pad + 14, x(t))), y: size.height - 7))
            }
            if let cursor, cursor >= start, cursor <= end {
                let cx = x(cursor)
                var cy = mid
                for i in 0..<(pts.count - 1) where cx >= pts[i].x && cx <= pts[i + 1].x && pts[i + 1].x > pts[i].x {
                    cy = pts[i].y + (pts[i + 1].y - pts[i].y) * (cx - pts[i].x) / (pts[i + 1].x - pts[i].x)
                }
                context.stroke(Path { $0.move(to: CGPoint(x: cx, y: 2)); $0.addLine(to: CGPoint(x: cx, y: size.height - 16)) },
                               with: .color(Theme.cursor.opacity(0.6)), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                context.fill(Path(ellipseIn: CGRect(x: cx - 5, y: cy - 5, width: 10, height: 10)), with: .color(Theme.cursor))
                context.stroke(Path(ellipseIn: CGRect(x: cx - 5, y: cy - 5, width: 10, height: 10)), with: .color(Theme.background), lineWidth: 1.5)
            }
        }
        .accessibilityHidden(true)
    }
}
