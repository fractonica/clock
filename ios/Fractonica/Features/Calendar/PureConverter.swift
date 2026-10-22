import FractonicaKit
import SwiftUI

/// The converter in pure mode (src/ui/calendar/pure-converter.js): between Fractonica forms only — the date in words
/// and letters, the entries edited in place, a typed stamp, the position, the address, the phase at every depth and the
/// solar sync. Nothing here says a Gregorian date, a zone, an Earth unit or a percentage (SPEC §15).
struct PureConverterContent: View {
    let model: ConverterModel

    @Environment(ClockStore.self) private var store
    @State private var wide = false

    var body: some View {
        let snap = ConverterSnapshot(clock: store.clock, t: model.t, depth: model.depth, editedPath: model.editedPath)
        let earth = EarthFormatter(zone: "UTC") // (unused in pure mode; the shared cards take one)
        VStack(spacing: 16) {
            if snap.inRange {
                PureHero(model: model, snap: snap)
                // lazy stacks: a tick re-lays out only the cards on screen (see EarthConverterContent)
                if wide {
                    HStack(alignment: .top, spacing: 16) {
                        LazyVStack(spacing: 16) { momentCards(snap) }
                        LazyVStack(spacing: 16) { cycleCards(snap, earth) }
                    }
                } else {
                    LazyVStack(spacing: 16) {
                        momentCards(snap)
                        cycleCards(snap, earth)
                    }
                }
            } else {
                PureOutOfRange(model: model)
            }
        }
        .onGeometryChange(for: Bool.self) { $0.size.width >= 760 } action: { wide = $0 }
    }

    @ViewBuilder
    private func momentCards(_ snap: ConverterSnapshot) -> some View {
        PureDateCard(model: model, t: snap.t)
        PureStampCard(model: model, t: snap.t)
        PureSarosCard(model: model, t: snap.t)
    }

    @ViewBuilder
    private func cycleCards(_ snap: ConverterSnapshot, _ earth: EarthFormatter) -> some View {
        PositionCard(model: model, snap: snap).id("cycles")
        AddressCard(model: model, snap: snap, earth: earth, pure: true).id("address")
        PhaseCard(model: model, snap: snap).id("glyphs")
        SolarCard(model: model, snap: snap, earth: earth, pure: true).id("solar")
    }
}

/// The Helion reading, large: its number, its phase pair and the counts below it; the date in words and the stamp.
private struct PureHero: View {
    let model: ConverterModel
    let snap: ConverterSnapshot

    var body: some View {
        let t = snap.t
        let n = Notation.standard
        let c = n.clock(at: t)
        CalCard {
            HStack {
                ConverterStatus(model: model, pure: true)
                Spacer()
            }
            VStack(alignment: .leading, spacing: 6) {
                if let c, snap.levels.count > 6 {
                    HStack(alignment: .center, spacing: 12) {
                        Text("\(c.eta)η")
                            .font(.reading(46, weight: .light))
                            .foregroundStyle(Theme.ink)
                        PairView(fraction: snap.levels[6].phase, color: Theme.teal, height: 34)
                        Text("\(c.iota)ι \(c.lambda)λ \(c.nu)ν")
                            .font(.reading(22, weight: .light))
                            .foregroundStyle(Theme.ink2)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                }
                Text(n.dateText(at: t, upTo: "epsilon"))
                    .font(.title3)
                    .foregroundStyle(Theme.ink)
                Text(n.dateText(at: t, form: "full", upTo: "delta"))
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                Text(n.stamp(at: t, upTo: "nu"))
                    .font(.code(13))
                    .foregroundStyle(Theme.teal)
                    .textSelection(.enabled)
            }
            .accessibilityElement(children: .combine)
            ConverterActions(model: model, canTravel: true)
        }
    }
}

/// The nine entries of the date: the four major periods by fracton name (with the quarter they are in), the Nuclide,
/// the Helion and the counts, each edited in place the odometer way.
private struct PureDateCard: View {
    let model: ConverterModel
    let t: Double

    @Environment(ClockStore.self) private var store

    var body: some View {
        let clock = store.clock
        if let c = PureCounters(Notation.standard, at: t) {
            CalCard("Date", systemImage: "calendar") {
                VStack(spacing: 8) {
                    ForEach(PureEntry.allCases.filter(\.isMajor)) { entry in
                        StepRow {
                            LevelChip(text: entry.sym, level: entry.level, compact: true).frame(width: 28)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(entry.name).font(.subheadline).foregroundStyle(Theme.ink)
                                Text("\(Notation.quarterWords[c.quarters[entry.rawValue]]) quarter")
                                    .font(.caption)
                                    .foregroundStyle(Theme.ink3)
                            }
                        } control: {
                            NudgeStepper(value: c[entry], range: entry.range(clock), label: entry.name, display: { Notation.ordinalName($0) },
                                         tint: Theme.levelColor(entry.level)) { set(entry, $0) }
                        }
                    }
                    Divider().overlay(Theme.line)
                    ForEach(PureEntry.allCases.filter { !$0.isMajor }) { entry in
                        let r = entry.range(clock)
                        StepRow {
                            LevelChip(text: entry.sym, level: entry.level, compact: true).frame(width: 28)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(entry.unit.name).font(.subheadline).foregroundStyle(Theme.ink)
                                Text("\(entry == .epsilon ? "ε#" : "")\(r.lowerBound)–\(r.upperBound) \(entry.isNumbered ? "numbered" : "completed") in \(entry.parentWords)")
                                    .font(.caption)
                                    .foregroundStyle(Theme.ink3)
                            }
                        } control: {
                            NudgeStepper(value: c[entry], range: r, label: entry.unit.name, display: { entry.text($0) },
                                         tint: Theme.levelColor(entry.level)) { set(entry, $0) }
                        }
                    }
                }
                Text("An entry moves the moment by whole units of it: what is finer keeps its place.")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .id("date")
        }
    }

    private func set(_ entry: PureEntry, _ n: Int) {
        switch PureMath.set(store.clock, t, entry, to: n) {
        case .success(let moved): model.set(moved, from: .pure)
        case .failure(let e): ToastCenter.shared.show(e.message)
        }
    }
}

/// A date typed in any of its forms, read back to its first Blink: the web's pure jump grammar (pure-parse.js, ported
/// and fixture-tested as FractonicaKit's `PureJumpParser`) — dates in words or letters and any tail of them, counts,
/// offsets from the converter's moment (`+2ε 5η`, `3η ago`, `+4 Blinks`), boundaries (`next Helion`), positions,
/// syncs and glyph states — as pure-converter.js reads its stamp field.
private struct PureStampCard: View {
    let model: ConverterModel
    let t: Double

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings

    var body: some View {
        CalCard("Read a date", systemImage: "text.cursor") {
            CommitField(label: "Stamp, words, counts or an offset", value: Notation.standard.stamp(at: t, upTo: "nu"),
                        prompt: "δ#3 ε#5 34η 29ι") { text in
                let context = PureJumpContext(now: t, real: Date.now.timeIntervalSince1970, level: settings.selectedLevel)
                let candidates = PureJumpParser.parse(text, context, notation: .standard)
                if let time = candidates.first(where: \.isSelectable)?.time {
                    return model.set(time, from: .pure) ? nil : CalendarError("Outside the catalogue")
                }
                // the converter's own reader as a fallback, then the parser's own words for what is wrong
                if case .success(let moved) = PureInput.read(text, clock: store.clock, ref: t) {
                    model.set(moved, from: .pure)
                    return nil
                }
                guard let why = candidates.first else { return CalendarError("Type a date, e.g. δ#3 ε#5 34η 29ι") }
                return CalendarError(why.detail.isEmpty ? why.label : "\(why.label) · \(why.detail)")
            }
            Text("Delta Trifracton Node ε#2 5η · α#6 β#4 γ#9 · 34η 17ι · +2ε 5η · 3η ago · next Helion · pos 22.9 · sync 4820. Numbered entries and Helions start at 1, counts at 0.")
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The eclipses around the moment, as exact position spans.
private struct PureSarosCard: View {
    let model: ConverterModel
    let t: Double

    @Environment(ClockStore.self) private var store

    var body: some View {
        let spans = PureMath.eclipseSpans(store.clock, at: t)
        CalCard("Saros 141 around it", systemImage: "circle.lefthalf.filled") {
            ForEach([spans.previous.map { ($0.k, $0.text, true) }, spans.next.map { ($0.k, $0.text, false) }].compactMap { $0 }, id: \.0) { k, text, before in
                Button {
                    model.set(store.clock.catalogue[k], from: .eclipse)
                    Haptics.play(.selection)
                } label: {
                    HStack(spacing: 12) {
                        EclipseMark(size: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Eclipse \(Notation.eclipseName(k))").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            Text(before ? "\(text) ago" : "in \(text)").font(.footnote.monospacedDigit()).foregroundStyle(Theme.ink3)
                        }
                        Spacer()
                        Image(systemName: "pin.circle").foregroundStyle(Theme.ink3)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// The phase at every depth: the major periods say their quarter word (never a pair), every finer depth its glyph pair
/// (256 states); tap a pair for when its depth shows another.
private struct PhaseCard: View {
    let model: ConverterModel
    let snap: ConverterSnapshot

    var body: some View {
        let n = Notation.standard
        CalCard("Phase at every depth", systemImage: "circle.dotted.circle") {
            VStack(spacing: 6) {
                ForEach(snap.levels.prefix(4), id: \.level) { r in
                    HStack(spacing: 10) {
                        LevelChip(text: "\(r.name) \(r.depth)", level: r.level, compact: true).frame(width: 46, alignment: .leading)
                        Text(Notation.periodName(level: r.level, ordinal: n.ordinalOf(level: r.level, cycle: r.cycle)))
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink)
                        Spacer()
                        Text(Notation.quarterWords[r.quarter])
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.levelColor(r.level))
                    }
                }
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], spacing: 8) {
                ForEach(snap.levels.dropFirst(4), id: \.level) { r in
                    let pair = Notation.pair(r.phase)
                    Button {
                        model.pickLevel = r.level
                    } label: {
                        VStack(spacing: 6) {
                            HStack(spacing: 4) {
                                Text(r.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.levelColor(r.level))
                                Text("\(r.depth)").font(.caption).foregroundStyle(Theme.ink3)
                                Spacer(minLength: 0)
                                Text(Notation.unit(level: r.level)?.name ?? n.cycleLength(level: r.level))
                                    .font(.caption2)
                                    .foregroundStyle(Theme.ink3)
                                    .lineLimit(1)
                            }
                            PairView(fraction: r.phase, color: Theme.teal, height: 24)
                            Text("\(pair.hi)·\(pair.lo)")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(Theme.ink2)
                        }
                        .padding(10)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.panel2.opacity(0.9)))
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("\(r.name) depth \(r.depth), phase \(pair.hi) and \(pair.lo) of 256"))
                    .accessibilityHint(Text("Shows when this depth shows another pair"))
                    .popover(isPresented: Binding(get: { model.pickLevel == r.level }, set: { if !$0, model.pickLevel == r.level { model.pickLevel = nil } })) {
                        StatePicker(model: model, level: r.level, current: [pair.hi, pair.lo], pure: true, earth: EarthFormatter(zone: "UTC"))
                            .presentationCompactAdaptation(.sheet)
                            .presentationDetents([.medium, .large])
                    }
                }
            }
            Text("Alpha, Beta, Gamma and Delta say the quarter they are in. Every finer depth shows its phase as two glyphs, 16 × 16 = 256 states: tap one to see when its depth shows another.")
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// A pinned moment outside the catalogue, seen in pure mode.
private struct PureOutOfRange: View {
    let model: ConverterModel

    @Environment(ClockStore.self) private var store

    var body: some View {
        let before = model.t < store.clock.tMin
        CalCard {
            ConverterStatus(model: model, pure: true)
            Label(before ? "Before the catalogue begins" : "After the catalogue ends", systemImage: "moon.zzz")
                .font(.headline)
                .foregroundStyle(Theme.ink)
            Text("The clock runs on the eclipses of Saros 141, \(Notation.standard.catalogueText()), and says nothing outside them.")
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                CalActionButton(title: before ? "Go to #0" : "Go to #\(store.clock.extent)", systemImage: "arrow.uturn.backward") {
                    model.set(before ? store.clock.tMin : store.clock.tMax, from: .eclipse)
                }
                CalActionButton(title: "Follow", systemImage: "scope") { model.unpin() }
            }
        }
    }
}
