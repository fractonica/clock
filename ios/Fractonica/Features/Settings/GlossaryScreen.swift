import FractonicaKit
import SwiftUI

/// The units ladder in Fractonica terms (SPEC §15.1, the web app's pure-mode glossary): the four major periods said
/// in words, the minor units said in letters and counts, the depths between them, and how to read what the screens
/// show — with live examples. Earth equivalents appear only outside pure mode.
struct GlossaryScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        let words = settings.wording
        List {
            Section {
                Text("Everything is counted in Fractonica periods. Four **major** periods are said in words; below them the **minor** units take every other depth and are said in letters and counts.")
                    .foregroundStyle(Theme.ink2)
                    .listRowBackground(Color.clear)
            }

            Section {
                ForEach(Notation.units.filter(\.major), id: \.id) { UnitRow(unit: $0, words: words) }
            } header: {
                Text("Major periods")
            } footer: {
                Text("A major period is named by its place in its parent — Monofracton, Difracton, Trifracton … — and by the quarter it is in: Peak, Node, Valley, End, each named by the moment that ends it. “Delta Trifracton Node” is the second quarter of the third Delta.")
            }

            Section {
                ForEach(Notation.units.filter { !$0.major }, id: \.id) { UnitRow(unit: $0, words: words) }
            } header: {
                Text("Minor units")
            } footer: {
                Text(betweenText(words))
            }

            Section("Reading the clock") {
                ClockTimeline(.periodic(1)) { t in
                    ReadingExamples(t: t, words: words)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Glossary")
    }

    /// "The depths between them (ζ θ κ μ) are drawn but are not units: ζ lasts 11η, θ 4ι, κ 13λ, μ 5ν."
    private func betweenText(_ words: Wording) -> String {
        let between = (0...Fractonica.maxLevel).filter { Notation.levelKind($0) == "between" }
        let letters = between.map { Fractonica.periodName($0).text }
        let lengths = between.map { "\(Fractonica.periodName($0).text) lasts \(words.notation.cycleLength(level: $0))" }
        return "The depths between them (\(letters.joined(separator: " "))) are still drawn as rings, rows and lanes, but they are not units: \(lengths.joined(separator: ", "))."
    }
}

/// One unit: its symbol in its level's colour, its name and depth, what it is made of and, in Earth mode, how long
/// it lasts.
private struct UnitRow: View {
    let unit: FUnit
    let words: Wording

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            Text(unit.sym)
                .font(.system(size: 24, weight: .semibold))
                .foregroundStyle(Theme.levelColor(unit.level))
                .frame(width: 44, height: 44)
                .background(Theme.levelColor(unit.level, opacity: 0.12), in: .circle)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(unit.name).font(.headline)
                    Text("depth \(unit.level + 1)").font(.caption).foregroundStyle(Theme.ink3)
                    Spacer()
                    if !words.pure {
                        Text(words.levelLength(unit.level)).font(.reading(13)).foregroundStyle(Theme.ink2)
                    }
                }
                if let madeOf {
                    Text(madeOf).font(.subheadline).foregroundStyle(Theme.ink2)
                }
                if let note {
                    Text(note).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    /// "1η = 36ι · 9θ of 4ι" — how many of the next unit make one, and through which depth when one lies between.
    private var madeOf: String? {
        let units = Notation.units
        guard let i = units.firstIndex(of: unit), i + 1 < units.count else { return nil }
        let next = units[i + 1]
        let count = Int((words.notation.unitPos(unit) / words.notation.unitPos(next)).rounded())
        var text = "1\(unit.sym) = \(count)\(next.sym)"
        if next.level == unit.level + 2 {
            let info = FractonicaClock.shared.levelInfo(unit.level)
            let between = Fractonica.periodName(unit.level + 1).text
            let inner = FractonicaClock.shared.levelInfo(unit.level + 1).factor
            text += " · \(info.factor)\(between) of \(inner)\(next.sym)"
        }
        return text
    }

    private var note: String? {
        switch unit.id {
        case "eta": "The basic unit: its count and its phase are the main reading. 19 Helions make one solar sync."
        case "nu": "The finest unit, and one tick of real time."
        default: nil
        }
    }
}

/// Live examples of the notations, read at `t`.
private struct ReadingExamples: View {
    let t: Double
    let words: Wording

    var body: some View {
        let n = words.notation
        let helion = FractonicaClock.shared.level(at: t, 6)
        Example(n.dateText(at: t, upTo: "epsilon"), "The date: the Delta in words with its quarter, then the Nuclide inside it (ε#).")
        Example(n.clockText(at: t), "The time inside the Nuclide: the Helion (numbered 1–77), then Preons (0–35) and Flavons (0–64) completed.")
        if let helion {
            HStack(alignment: .top, spacing: 14) {
                PairView(fraction: helion.phase, color: Theme.teal, height: 26)
                    .frame(width: 64, alignment: .leading)
                Text("The phase of the running Helion: two glyphs, 16 × 16 = 256 states. The left glyph is the coarse position, the right the fine one; a dot marks the falling half.")
                    .font(.caption)
                    .foregroundStyle(Theme.ink2)
            }
            .padding(.vertical, 2)
            Example(n.duration(helion.remaining, at: t), "A span: what is left of this Helion. “in 6ι 43λ” counts down to a moment, “6ι 43λ ago” back from it.")
        }
        Example(n.stamp(at: t), "The same moment in letters only: # numbers are ordinals and count from 1, plain numbers count from 0.")
        Example(n.rateLabel(n.playRate), "A speed: how much of the ladder passes per Blink of real time.")
    }
}

private struct Example: View {
    let sample: String
    let meaning: String

    init(_ sample: String, _ meaning: String) {
        self.sample = sample
        self.meaning = meaning
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(sample)
                .font(.code(14, weight: .medium))
                .foregroundStyle(Theme.ink)
                .textSelection(.enabled)
            Text(meaning)
                .font(.caption)
                .foregroundStyle(Theme.ink2)
        }
        .padding(.vertical, 2)
    }
}
