import FractonicaKit
import SwiftUI

/// What the pointer is over on the dial: a ring and, below the finest level, the sector (child cycle) under it.
struct RingsPointerTarget: Equatable, Sendable {
    let ring: Int
    let level: Int
    let sector: Int?
}

/// The pointer's tooltip over the dial (the hover tip of src/ui/rings.js), on the Mac and on an iPad with a pointer:
/// the ring's cycle, the child cycle under the pointer with its span, and what a click would do there.
struct RingsHoverTip: View {
    let target: RingsPointerTarget
    let selected: Bool

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings

    private let clock = FractonicaClock.shared
    private let cycles = RingsCycles()

    var body: some View {
        ClockTimeline(.periodic(RingsCentre.cadence(level: target.level, speed: RingsScreenModel.speed(of: store)))) { t in
            content(t)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(width: 252, alignment: .leading)
        .background(.regularMaterial, in: .rect(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Theme.line, lineWidth: 0.75)
        }
        .shadow(color: .black.opacity(0.35), radius: 12, y: 4)
        .environment(\.colorScheme, .dark)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func content(_ t: Double) -> some View {
        let words = RingsPreviewWords(pure: settings.pure, earth: settings.wording.earth)
        let color = Theme.levelColor(target.level, lightness: 0.74)
        let blurred = RingsMath.isBlur(meanSeconds: clock.levelInfo(target.level).meanSeconds, speed: RingsScreenModel.speed(of: store))
        VStack(alignment: .leading, spacing: 5) {
            if blurred {
                title(RingsText.levelTag(target.level), note: "about \(words.turn(target.level)) per cycle", color: color)
                line("Too fast to follow at this speed: drawn as a glow", dim: true)
                if !selected { hint("Click to select this ring") }
            } else if let r = clock.level(at: min(t, clock.tMax - 0.001), target.level) {
                let ring = words.ring(r, now: t)
                title(ring.title, note: settings.pure ? ring.subtitle : ring.detail, color: color)
                if settings.pure { line(ring.detail, dim: false) }
                line(ring.ends, dim: true)
                if let sector = target.sector {
                    Divider().padding(.vertical, 2)
                    child(r, sector: sector, words: words, t: t)
                } else if !selected {
                    hint("Click to select this ring")
                }
            }
        }
    }

    @ViewBuilder
    private func child(_ r: LevelReading, sector: Int, words: RingsPreviewWords, t: Double) -> some View {
        if let child = cycles.child(level: target.level, cycle: r.cycle, sector: sector) {
            let c = words.child(child, parent: r, now: t)
            let running = t >= child.start && t < child.end
            title(c.title, note: c.subtitle, color: Theme.levelColor(child.level, lightness: 0.74))
            line(c.span, dim: false)
            line(c.lasts, dim: true)
            hint(!selected ? "Click to select this ring" : running ? "Click to jump back to its start" : "Click to jump to its start")
        } else {
            line(target.level >= Fractonica.maxLevel ? "Finer than the dial shows" : "Beyond the end of the catalogue", dim: true)
            if !selected { hint("Click to select this ring") }
        }
    }

    private func title(_ text: String, note: String, color: Color) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(text)
                .font(.system(.subheadline, design: .monospaced).weight(.semibold))
                .foregroundStyle(color)
            Spacer(minLength: 4)
            Text(note)
                .font(.caption.monospacedDigit())
                .foregroundStyle(Theme.ink3)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }

    private func line(_ text: String, dim: Bool) -> some View {
        Text(text)
            .font(.caption.monospacedDigit())
            .foregroundStyle(dim ? Theme.ink2 : Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(Theme.ink3)
            .padding(.top, 2)
    }
}
