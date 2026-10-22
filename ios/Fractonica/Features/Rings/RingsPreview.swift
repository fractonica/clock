import FractonicaKit
import SwiftUI

/// The words of a ring or sector preview (the dial tooltip of src/ui/rings.js), in Earth or pure terms.
struct RingsPreviewWords {
    let pure: Bool
    let earth: EarthFormatter
    private let words = RingsPureText()

    struct Ring {
        /// "η 7 · 1/11" · pure "ε#5 34η".
        var title: String
        /// "η 7 · 1/11" in pure mode (the depth chip), "" in Earth mode.
        var subtitle: String
        /// "81.4 % through this cycle" · pure "phase 13 and 0 of 256" / "quarter End".
        var detail: String
        /// "ends in 56 min 12 s" · pure "ends in 6ι 43λ".
        var ends: String
    }

    struct Child {
        /// "θ 8 · 3/9" · pure "ε#5 34η 8ι".
        var title: String
        var subtitle: String
        /// "Thu 8 Oct 2026, 08:26:37 → 08:50:48" · pure "ends → 12ι begins".
        var span: String
        /// "lasts 22 min 27 s · started 1 h 2 min ago".
        var lasts: String
    }

    func ring(_ r: LevelReading, now: Double) -> Ring {
        let ends = "\(r.clipped ? "the catalogue ends" : "ends") in "
        if pure {
            let detail = RingsPureText.isMajor(r.level) ? "quarter \(RingsPureText.quarterWord(r.phase))" : RingsPureText.pairLabel(r.phase)
            return Ring(title: words.cycleName(level: r.level, cycle: r.cycle), subtitle: RingsText.cycleTag(r), detail: detail, ends: ends + words.between(now, r.end))
        }
        return Ring(title: RingsText.cycleTag(r), subtitle: "", detail: "\(RingsText.percent(r.phase)) through this cycle", ends: ends + RingsText.countdownBody(r.remaining))
    }

    func child(_ c: ChildCycle, parent r: LevelReading, now: Double) -> Child {
        let tag = "\(RingsText.levelTag(c.level)) · \(c.local + 1)/\(r.factor)"
        if pure {
            return Child(
                title: words.cycleName(level: c.level, cycle: c.index),
                subtitle: "child · \(tag)",
                span: words.endsSentence(level: c.level, cycle: c.index, end: c.end, clipped: c.clipped),
                lasts: "lasts \(words.lengthWithName(level: c.level, start: c.start, end: c.end, clipped: c.clipped)) · \(words.startPhrase(start: c.start, end: c.end, now: now))"
            )
        }
        let start = RingsText.whenText(earth, c.start, span: c.duration)
        let a = RingsText.whenParts(earth, c.start, span: c.duration)
        let b = RingsText.whenParts(earth, c.end, span: c.duration)
        // within one day the end needs only its time
        let end = a.date == b.date && !b.time.isEmpty ? b.time : RingsText.whenText(earth, c.end, span: c.duration)
        return Child(
            title: tag,
            subtitle: "child cycle",
            span: "\(start) → \(end)\(c.clipped ? " (catalogue end)" : "")",
            lasts: "lasts \(EarthTime.duration(c.duration)) · \(RingsText.startPhrase(start: c.start, end: c.end, now: now))"
        )
    }

    /// One turn of a ring too fast to draw, in real time.
    func turn(_ level: Int) -> String {
        pure ? words.aboutTurn(level) : EarthTime.duration(FractonicaClock.shared.levelInfo(level).meanSeconds)
    }
}

/// What a touch-and-hold on the dial shows: the ring's cycle and, on a sector, the child cycle it stands for, with
/// the actions a tap would take.
struct RingsPreviewCard: View {
    let target: RingsPreviewTarget
    let model: RingsScreenModel

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss

    private let clock = FractonicaClock.shared
    private let cycles = RingsCycles()

    var body: some View {
        ClockTimeline(.periodic(RingsCentre.cadence(level: target.level, speed: RingsScreenModel.speed(of: store)))) { t in
            content(t)
        }
        .padding(16)
        .frame(width: 300, alignment: .leading)
        .presentationBackground(.regularMaterial)
    }

    @ViewBuilder
    private func content(_ t: Double) -> some View {
        let words = RingsPreviewWords(pure: settings.pure, earth: settings.wording.earth)
        let color = Theme.levelColor(target.level, lightness: 0.74)
        let blurred = RingsMath.isBlur(meanSeconds: clock.levelInfo(target.level).meanSeconds, speed: RingsScreenModel.speed(of: store))
        VStack(alignment: .leading, spacing: 12) {
            if let r = clock.level(at: min(t, clock.tMax - 0.001), target.level) {
                let ring = words.ring(r, now: t)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(ring.title)
                            .font(.system(.headline, design: .monospaced))
                            .foregroundStyle(color)
                        Spacer(minLength: 8)
                        Text(ring.subtitle)
                            .font(.caption.monospaced())
                            .foregroundStyle(Theme.ink3)
                    }
                    if blurred {
                        Text("Too fast to follow at this speed: drawn as a glow")
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink2)
                        Text("about \(words.turn(target.level)) per cycle")
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                    } else {
                        phaseRow(r, ring: ring, color: color)
                        Text(ring.ends)
                            .font(.subheadline.monospacedDigit())
                            .foregroundStyle(Theme.ink2)
                    }
                }
                if let sector = target.sector, !blurred {
                    Divider()
                    childSection(r, sector: sector, words: words, t: t)
                }
                if target.level != model.selected(settings) {
                    Button {
                        model.select(target.level, settings: settings, reduceMotion: reduceMotion)
                        Haptics.play(.selection)
                        close()
                    } label: {
                        Label("Select \(RingsText.levelTag(target.level))", systemImage: "scope")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .tint(color)
                }
            } else {
                Text("Outside the catalogue")
                    .font(.headline)
                    .foregroundStyle(Theme.ink2)
            }
        }
    }

    @ViewBuilder
    private func phaseRow(_ r: LevelReading, ring: RingsPreviewWords.Ring, color: Color) -> some View {
        if settings.pure && !RingsPureText.isMajor(r.level) {
            HStack(spacing: 8) {
                Text("phase").font(.subheadline).foregroundStyle(Theme.ink3)
                PairView(fraction: r.phase, color: color, height: 16)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(ring.detail))
        } else {
            Text(ring.detail)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(Theme.ink)
        }
    }

    @ViewBuilder
    private func childSection(_ r: LevelReading, sector: Int, words: RingsPreviewWords, t: Double) -> some View {
        if let child = cycles.child(level: target.level, cycle: r.cycle, sector: sector) {
            let c = words.child(child, parent: r, now: t)
            let childColor = Theme.levelColor(child.level, lightness: 0.74)
            let running = t >= child.start && t < child.end
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(c.title)
                        .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                        .foregroundStyle(childColor)
                    Spacer(minLength: 8)
                    Text(c.subtitle)
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                }
                Text(c.span)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.ink)
                Text(c.lasts)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.ink2)
            }
            Button {
                store.travel(to: child.start + 0.001)
                Haptics.play(.step)
                close()
            } label: {
                Label(running ? "Back to Its Start" : "Go to Its Start", systemImage: "arrow.right.to.line")
                    .frame(maxWidth: .infinity)
                    // dark on the bright level colour: white on a light green or cyan would barely read
                    .foregroundStyle(Theme.background)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.levelColor(child.level, lightness: 0.66))
        } else {
            Text(target.level >= Fractonica.maxLevel ? "Finer than the dial shows" : "Beyond the end of the catalogue")
                .font(.subheadline)
                .foregroundStyle(Theme.ink3)
        }
    }

    private func close() {
        model.preview = nil
        dismiss()
    }
}
