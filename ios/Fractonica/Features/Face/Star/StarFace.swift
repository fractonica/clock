import FractonicaKit
import SwiftUI

/// The solar day's star (Features/Face/Star, SPEC §7.5): the Helion's link to the Sun drawn as geometry.
///
/// The dial is the solar day: 19 rim points a quarter Helion apart (171 Preon ticks) and the Sun travelling them at
/// the time of day, a turn a day from the sync's start at the top. The sync's 19 Helions are the chords of the star
/// polygon {19/4}: each chord joins where its Helion begins and ends in the day, so it spans exactly the Sun's arc in
/// that Helion, and a pen draws the running one as the Helion passes; the running Pentad's chords glow, the earlier
/// ones of the sync are dimmer, those to come a ghost. Each Pentad's five chords wind a turn and one point (its ¼η
/// slip), and the Hypopentad's four — double-ruled, its rim points squares — close the figure. The rim points carry
/// the Pentads' shapes (I II III ◻ around the day: each is where a Helion of that Pentad begins), the running Pentad's
/// lit. Inside, the running Helion is a rose drawn by three arms — η, θ turning 9 times against it, ι 4 times a θ
/// against that — 9 cells of 4 cusps, its 36 Preons, with the Flavon a spark circling its pen; the hub carries the
/// Pentad's badge. Under the dial, the Pentad in words and when the next begins. In Earth mode the civil hours ring the
/// rim where the Sun will stand at them. A tap opens the Pentad explainer.
struct StarFace: View {
    /// Width over height of the face's frame: the round dial and its caption.
    nonisolated static let aspectRatio: CGFloat = 0.9
    /// The -FXFaceTime instant, or nil to follow the clock.
    let fixed: Double?

    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var explains = false

    var body: some View {
        let words = settings.wording
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height * Self.aspectRatio)
            VStack(spacing: 0) {
                dial(words: words)
                    .frame(width: side, height: side)
                StarCaption(fixed: fixed, size: side)
                    .frame(width: side, height: max(0, side / Self.aspectRatio - side))
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .accessibilityHidden(true)
            .overlay { spoken(words: words) }
        }
        .contentShape(.rect)
        .onTapGesture { explains = true }
        .sheet(isPresented: $explains) {
            NavigationStack { PentadExplainer(fixed: fixed) }
                #if os(iOS)
                .sheetDetents([.large])
                #else
                .frame(minWidth: 520, minHeight: 640)
                #endif
        }
    }

    // MARK: - The dial

    private func dial(words: Wording) -> some View {
        let pure = words.pure
        let earth = words.earth
        let speed = fixed == nil ? abs(store.base.rate) : 0
        let spark = !reduceMotion
        let steps = StarCadence.motionSteps(reduceMotion: reduceMotion)
        return ZStack {
            Canvas { context, size in StarPainter.plate(&context, StarFrame(size: size)) }
            NowTimeline(fixed: fixed, next: { t in
                let helion = StarCadence.helion(after: t)
                return pure ? helion : FaceCadence.earliest(after: t, [helion, StarHours.transition(after: t, earth: earth)])
            }) { t in
                if let r = StarReading.at(t) {
                    let midnight = pure ? nil : StarHours.midnightTurns(at: t, sunTurns: r.sunTurns, earth: earth)
                    StarHelionLayer(key: r.helionKey, midnight: midnight)
                        .equatable()
                } else {
                    StarOutOfRange(words: words)
                }
            }
            NowTimeline(fixed: fixed, minimumStep: 1.0 / 30, next: { StarCadence.motion(after: $0, steps: steps) }) { t in
                if let r = StarReading.at(t) {
                    StarMotionLayer(motion: StarMotion(r, steps: steps, speed: speed, spark: spark))
                        .equatable()
                }
            }
            // the Flavon's spark steps once a Blink, on a small layer of its own (a time-lapse blurs it into a ring)
            if spark && !StarFace.sparkBlurred(speed: speed) {
                NowTimeline(fixed: fixed, minimumStep: 1.0 / 30, next: { StarCadence.motion(after: $0, steps: StarCadence.sparkSteps) }) { t in
                    if let r = StarReading.at(t) {
                        StarSparkLayer(center: StarRose.pen(r.steppedPhase(steps)), blink: r.blink)
                            .equatable()
                    }
                }
            }
            // the hub caps the arms: the running Pentad, redrawn when it changes
            NowTimeline(fixed: fixed, next: { Pentads.change(after: $0) }) { t in
                if let p = Pentads.index(at: t) {
                    GeometryReader { geo in
                        let f = StarFrame(size: geo.size)
                        StarHub(pentad: p, size: f.radius * StarDial.hub * 2)
                            .position(f.center)
                    }
                }
            }
        }
    }

    /// A time-lapse turns the spark faster than the eye follows (above about 9 displayed seconds a real one).
    nonisolated static func sparkBlurred(speed: Double) -> Bool {
        speed * 2_340 / FractonicaClock.shared.levelInfo(6).meanSeconds > StarMotion.blurSpin
    }

    // MARK: - VoiceOver

    /// One element over the whole face: the reading led by its Pentad, and the explainer as its action.
    private func spoken(words: Wording) -> some View {
        let pure = words.pure
        return NowTimeline(fixed: fixed, next: { PentadCardModel.change(after: $0, pure: pure) }) { t in
            let label = StarReading.at(t).map { StarWords.spoken($0, at: t, pure: pure, notation: words.notation) }
                ?? FaceWords.outOfRange(words: words).title.joined(separator: " ")
            Color.clear
                .contentShape(.rect)
                .accessibilityElement()
                .accessibilityLabel(Text(verbatim: label))
                .accessibilityHint(Text("Shows how the Pentads follow the Sun"))
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { explains = true }
        }
    }
}

/// What changes once a Helion, redrawn only then.
private struct StarHelionLayer: View, Equatable {
    let key: StarReading.HelionKey
    let midnight: Double?

    var body: some View {
        Canvas { context, size in
            StarPainter.helion(&context, StarFrame(size: size), helion: key.helion, pentad: key.pentad, midnight: midnight)
        }
    }
}

/// The moving parts, over the rest.
private struct StarMotionLayer: View, Equatable {
    let motion: StarMotion

    var body: some View {
        Canvas { context, size in StarPainter.motion(&context, StarFrame(size: size), motion) }
    }
}

/// The Flavon's spark around the rose's pen (`center`, in dial radii), `blink` Blinks into the Flavon.
private struct StarSparkLayer: View, Equatable {
    let center: CGPoint
    let blink: Int

    var body: some View {
        GeometryReader { geo in
            let f = StarFrame(size: geo.size)
            let orbit = f.radius * StarDial.sparkOrbit
            let side = 2 * (orbit + 6 * f.unit)
            Canvas { context, size in StarPainter.spark(&context, size: size, orbit: orbit, blink: blink, unit: f.unit) }
                .frame(width: side, height: side)
                .position(f.point(center))
        }
    }
}

/// The hub: the running Pentad's badge, capping the rose's arms; the Hypopentad's square in a ring of its own.
private struct StarHub: View {
    let pentad: Int
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(RadialGradient(colors: [Theme.gold.opacity(pentad == 3 ? 0.18 : 0.07), Theme.gold.opacity(0)],
                                     center: .center, startRadius: size * 0.5, endRadius: size * 1.0))
                .frame(width: size * 2, height: size * 2)
            Circle()
                .fill(Theme.Star.plateEdge)
                .frame(width: size * 1.12, height: size * 1.12)
            Circle()
                .strokeBorder(Theme.gold.opacity(pentad == 3 ? 0.9 : 0.4), lineWidth: pentad == 3 ? 1.4 : 0.8)
                .frame(width: size * 1.12, height: size * 1.12)
            if pentad == 3 {
                Circle()
                    .strokeBorder(Theme.gold.opacity(0.45), lineWidth: 0.7)
                    .frame(width: size * 1.32, height: size * 1.32)
            }
            PentadBadge(index: pentad, size: size * 0.72, filled: true)
        }
        .frame(width: size, height: size)
    }
}

/// Outside the catalogue: the plate stays, with the catalogue's range in its middle.
private struct StarOutOfRange: View {
    let words: Wording

    var body: some View {
        let text = FaceWords.outOfRange(words: words)
        GeometryReader { geo in
            let r = min(geo.size.width, geo.size.height) / 2
            VStack(spacing: r * 0.03) {
                ForEach(text.title, id: \.self) { line in
                    Text(verbatim: line).font(.system(size: max(12, r * 0.085), weight: .semibold))
                }
                .foregroundStyle(Theme.ink2)
                ForEach(text.range, id: \.self) { line in
                    Text(verbatim: line).font(.reading(max(10, r * 0.062)))
                }
                .foregroundStyle(Theme.ink3)
            }
            .multilineTextAlignment(.center)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .frame(width: r * 1.2)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }
}

/// Under the dial: the running Pentad and the Helion's place in it, and when the next Pentad begins.
private struct StarCaption: View {
    let fixed: Double?
    let size: CGFloat

    @Environment(AppSettings.self) private var settings

    var body: some View {
        let pure = settings.pure
        let fontSize = min(18, max(11, size * 0.04))
        NowTimeline(fixed: fixed, next: { PentadCardModel.change(after: $0, pure: pure) }) { t in
            if let r = StarReading.at(t) {
                HStack(spacing: fontSize * 0.45) {
                    PentadBadge(index: r.pentad, size: fontSize * 1.45, filled: true)
                    Text("\(Text(verbatim: PentadWords.name(r.pentad)).foregroundStyle(Theme.gold).fontWeight(.semibold))\(Text(verbatim: "  " + StarWords.place(r)).foregroundStyle(Theme.ink3))")
                    if let next = r.nextPentad,
                       let countdown = PentadCardModel.countdown(at: t, to: r.pentadEnd, pure: pure) {
                        Text("\(Text.pentadMark(next)) \(Text(verbatim: countdown))")
                            .foregroundStyle(Theme.ink2)
                            .padding(.leading, fontSize * 0.5)
                    }
                }
                .font(.reading(fontSize))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}
