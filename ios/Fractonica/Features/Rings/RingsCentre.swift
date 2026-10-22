import FractonicaKit
import SwiftUI

/// The read-out in the hole of the dial: the selected cycle's glyph, its name, the countdown to its end, what ends it
/// and what the glyph is doing. Sized by the hole, like a watch face; a small hole keeps the essentials.
struct RingsCentre: View {
    let radius: CGFloat
    let selected: Int
    let outOfRange: Bool
    let model: RingsScreenModel

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings

    private let clock = FractonicaClock.shared

    var body: some View {
        let speed = RingsScreenModel.speed(of: store)
        ClockTimeline(.periodic(Self.cadence(level: selected, speed: speed))) { t in
            if outOfRange || !clock.inRange(t) {
                outside
            } else if let r = clock.level(at: min(t, clock.tMax - 0.001), selected) {
                reading(r, t: t, blurred: RingsMath.isBlur(meanSeconds: clock.levelInfo(selected).meanSeconds, speed: speed))
            }
        }
        .frame(width: radius * 1.62, height: radius * 1.62)
        .allowsHitTesting(outOfRange || !clock.inRange(store.time()))
    }

    /// How often the read-out changes: tenths for cycles under six hours (their countdowns show seconds or Blinks),
    /// seconds above; a cycle too fast to follow refreshes four times per real second.
    static func cadence(level: Int, speed: Double) -> Double {
        let mean = FractonicaClock.shared.levelInfo(level).meanSeconds
        if RingsMath.isBlur(meanSeconds: mean, speed: speed) { return 0.25 * speed }
        return mean < 6 * 3600 ? 0.1 : 1
    }

    /// How much the hole holds: everything from a radius of 118 points, the essentials in a phone's hole, only the glyph
    /// and the countdown in a very small one (iPhone in landscape). Text never shrinks below legibility: what does not
    /// fit is left to the cycle card.
    private enum Tier { case full, compact, minimal }

    private var tier: Tier { radius >= 118 ? .full : radius >= 66 ? .compact : .minimal }
    private var compact: Bool { tier != .full }
    private var color: Color { Theme.levelColor(selected, lightness: 0.74) }

    @ViewBuilder
    private func reading(_ r: LevelReading, t: Double, blurred: Bool) -> some View {
        let pure = settings.pure
        let words = RingsPureText()
        let word = RingsText.phaseWord(index: r.index, derivative: r.derivative)
        let name = pure ? words.displayName(r) : RingsText.cycleTag(r)
        let countdown = pure ? words.centreSpan(from: t, to: r.end, compact: compact) : RingsText.countdownBody(r.remaining)
        let toNext = r.next.time != nil ? " · to \(r.next.name)" : ""
        let tier = self.tier
        VStack(spacing: tier == .full ? radius * 0.035 : 3) {
            GlyphView(index: r.index, strokes: 2, color: color)
                .frame(height: tier == .full ? radius * 0.27 : radius * 0.3)
                .padding(.bottom, tier == .full ? radius * 0.03 : 2)
            if tier != .minimal {
                Text(name)
                    .font(.code(tier == .full ? radius * 0.085 : max(11, radius * 0.12), weight: .medium))
                    .foregroundStyle(color)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.75)
                Text(r.clipped ? "catalogue ends in" : "ends in")
                    .font(.system(size: tier == .full ? radius * 0.06 : max(8.5, radius * 0.08), weight: .semibold))
                    .textCase(.uppercase)
                    .tracking(tier == .full ? 1.2 : 0.8)
                    .foregroundStyle(Theme.ink3)
            }
            Text(countdown)
                .font(.reading(tier == .full ? radius * 0.17 : max(12, radius * 0.22), weight: .light))
                .foregroundStyle(Theme.ink)
                .opacity(blurred ? 0.5 : 1)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            if tier == .full {
                Text(endLine(r, pure: pure))
                    .font(.system(size: radius * 0.065).monospacedDigit())
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .minimumScaleFactor(0.7)
            }
            if tier != .minimal {
                HStack(spacing: tier == .full ? radius * 0.03 : 3) {
                    Image(systemName: RingsText.phaseSymbol(word))
                        .imageScale(.small)
                    Text("\(word)\(tier == .full ? toNext : "")")
                }
                .font(.system(size: tier == .full ? radius * 0.062 : max(9.5, radius * 0.09), weight: .medium))
                .foregroundStyle(color)
                .padding(.horizontal, tier == .full ? radius * 0.07 : 7)
                .padding(.vertical, tier == .full ? radius * 0.025 : 2)
                .background(Theme.levelColor(selected, opacity: 0.14), in: .capsule)
                .padding(.top, tier == .full ? radius * 0.02 : 1)
            }
        }
        .frame(maxWidth: radius * 1.5)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(name), \(word.lowercased()), \(r.clipped ? "the catalogue ends" : "ends") in \(countdown)"))
    }

    private func endLine(_ r: LevelReading, pure: Bool) -> String {
        if pure { return RingsPureText().endLine(r) }
        let earth = settings.wording.earth
        let when = RingsText.whenText(earth, r.end, span: r.duration)
        return r.duration < RingsText.year * 0.9 ? "\(when) · \(earth.tag(r.end))" : when
    }

    /// Nothing exists here: say what the catalogue covers and offer its two ends.
    private var outside: some View {
        let pure = settings.pure
        let earth = settings.wording.earth
        return VStack(spacing: radius * 0.05) {
            Image(systemName: "circle.dashed")
                .font(.system(size: radius * 0.2, weight: .light))
                .foregroundStyle(Theme.ink3)
            Text("Outside the catalogue")
                .font(.system(size: max(11, radius * 0.095), weight: .semibold))
                .foregroundStyle(Theme.ink2)
            Text(pure ? RingsPureText().notation.catalogueText() : "\(earth.parts(clock.tMin).year)–\(earth.parts(clock.tMax).year)")
                .font(.reading(max(13, radius * 0.13), weight: .light))
                .foregroundStyle(Theme.ink)
            Text(pure ? "pos 0 → \(clock.extent)" : "\(earth.date(clock.tMin)) → \(earth.date(clock.tMax))")
                .font(.system(size: max(9, radius * 0.065)).monospacedDigit())
                .foregroundStyle(Theme.ink3)
            HStack(spacing: radius * 0.06) {
                Button("Start", systemImage: "backward.end") { go(to: clock.tMin + 0.001) }
                Button("End", systemImage: "forward.end") { go(to: clock.tMax - 0.001) }
            }
            .font(.system(size: max(12, radius * 0.085), weight: .medium))
            .buttonStyle(.bordered)
            .padding(.top, radius * 0.04)
        }
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }

    private func go(to t: Double) {
        model.outOfRange = false
        store.travel(to: t)
        Haptics.play(.step)
    }
}
