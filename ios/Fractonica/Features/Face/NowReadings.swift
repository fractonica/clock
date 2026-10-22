import FractonicaKit
import SwiftUI

// The words around the face: the date line above it, the turnover line below it, and on wide layouts a column of
// readings beside it. Each redraws exactly when its own text changes (`FaceCadence`), so the λ of the stamp, the λ of
// the face and the countdown all turn together.

/// The date line (compact layouts): Earth "Thu 8 Oct 2026 · 12:00:00 UTC" over the short pure date; pure mode the
/// short pure date over the stamp.
struct NowDateLine: View {
    var fixed: Double?

    @Environment(AppSettings.self) private var settings

    var body: some View {
        let words = settings.wording
        let pure = words.pure
        NowTimeline(fixed: fixed, next: { FaceCadence.dateLine(after: $0, pure: pure) }) { t in
            let inside = words.notation.model.inRange(t)
            VStack(spacing: 3) {
                if pure && !inside {
                    Text(verbatim: "outside the catalogue")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink2)
                    Text(verbatim: words.notation.catalogueText())
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                } else if pure {
                    Text(verbatim: words.notation.dateText(at: t))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                    Text(verbatim: words.notation.stamp(at: t, upTo: "lambda"))
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                } else {
                    Text("\(Text(verbatim: "\(words.day(t)) · \(words.time(t))").foregroundStyle(Theme.ink)) \(Text(verbatim: words.tag(t)).font(.caption.weight(.medium)).foregroundStyle(Theme.ink3))")
                        .font(.subheadline.weight(.semibold))
                    Text(verbatim: inside ? words.notation.dateText(at: t) : "outside the catalogue")
                        .font(.caption)
                        .foregroundStyle(inside ? Theme.ink2 : Theme.ink3)
                }
            }
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .multilineTextAlignment(.center)
            .accessibilityElement(children: .combine)
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }
}

/// What begins when the lead unit's cycle ends, and when: "35η begins in 56 min 12 s" · pure "35η begins in 6ι 43λ".
struct TurnoverLine: View {
    let level: Int
    var fixed: Double?
    var alignment: TextAlignment = .center
    var font: Font = .subheadline

    @Environment(AppSettings.self) private var settings

    var body: some View {
        let words = settings.wording
        let pure = words.pure
        let level = level
        NowTimeline(fixed: fixed, next: { FaceCadence.countdown(after: $0, level: level, pure: pure) }) { t in
            if let reading = words.notation.model.level(at: t, level) {
                line(FaceWords.turnover(level: level, reading: reading, at: t, words: words))
            } else {
                Text(verbatim: " ")
            }
        }
        .font(font)
        .monospacedDigit()
        .foregroundStyle(Theme.ink2)
        .lineLimit(1)
        .minimumScaleFactor(0.75)
        .multilineTextAlignment(alignment)
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
    }

    private func line(_ x: FaceWords.Turnover) -> some View {
        let name = Text(verbatim: x.name).fontWeight(.semibold).foregroundStyle(Theme.levelColor(x.level))
        let countdown = Text(verbatim: x.countdown).foregroundStyle(Theme.ink)
        let text: Text =
            if x.last { Text("The catalogue ends with this \(name)") }
            else if x.named { Text("\(name) begins \(countdown)") }
            else { Text("Next \(name) \(countdown)") }
        return text
            .accessibilityLabel(Text(verbatim: FaceWords.sentence(x)))
    }
}

/// The column beside the face on wide layouts: the moment in large type, the four major periods in words with the
/// minor reading, the stamp, and the turnover line.
struct ReadingsPanel: View {
    let leadLevel: Int
    var fixed: Double?
    /// The four major periods and the stamp under the moment (when there is the height for them).
    var showsPeriods = true
    /// Beside a tall face (a big iPad): everything a size larger.
    var roomy = false

    @Environment(AppSettings.self) private var settings
    @ScaledMetric(relativeTo: .largeTitle) private var bigSize: CGFloat = 50

    var body: some View {
        let words = settings.wording
        let pure = words.pure
        VStack(alignment: .leading, spacing: 22) {
            NowTimeline(fixed: fixed, next: { FaceCadence.readings(after: $0, pure: pure) }) { t in
                primary(t, words)
            }
            // the periods and the stamp turn with the Flavon: their own, slower timeline (a Mac redrew the grid and
            // its selectable stamp every second otherwise)
            if showsPeriods {
                NowTimeline(fixed: fixed, next: { FaceCadence.readings(after: $0, pure: true) }) { t in
                    majors(t, words)
                }
            }
            TurnoverLine(level: leadLevel, fixed: fixed, alignment: .leading, font: roomy ? .title3 : .subheadline)
        }
    }

    @ViewBuilder
    private func primary(_ t: Double, _ words: Wording) -> some View {
        let n = words.notation
        VStack(alignment: .leading, spacing: 4) {
            if words.pure && !n.model.inRange(t) {
                Text(verbatim: "outside the catalogue")
                    .font(.title2)
                    .foregroundStyle(Theme.ink2)
                Text(verbatim: n.catalogueText())
                    .font(.title3)
                    .foregroundStyle(Theme.ink3)
            } else if words.pure {
                Text(verbatim: n.clockText(at: t))
                    .font(.system(size: bigSize * (roomy ? 1.4 : 1), weight: .light))
                    .foregroundStyle(Theme.ink)
                Text(verbatim: n.dateText(at: t, upTo: "epsilon"))
                    .font(roomy ? .title2 : .title3)
                    .foregroundStyle(Theme.ink2)
            } else {
                Text(verbatim: words.time(t))
                    .font(.system(size: bigSize * (roomy ? 1.4 : 1), weight: .light))
                    .foregroundStyle(Theme.ink)
                Text(verbatim: "\(words.day(t)) · \(words.tag(t))")
                    .font(roomy ? .title2 : .title3)
                    .foregroundStyle(Theme.ink2)
            }
        }
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .accessibilityElement(children: .combine)
    }

    /// α Alpha Hexafracton · Valley … δ Delta Trifracton · End, then ε#5 34η 29ι 21λ, then the stamp.
    @ViewBuilder
    private func majors(_ t: Double, _ words: Wording) -> some View {
        let n = words.notation
        if let date = n.date(at: t), let clock = n.clock(at: t) {
            let ordinals = [date.alpha, date.beta, date.gamma, date.delta]
            let quarters = [date.quarter.alpha, date.quarter.beta, date.quarter.gamma, date.quarter.delta]
            VStack(alignment: .leading, spacing: 10) {
                Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 7) {
                    ForEach(0..<4, id: \.self) { level in
                        GridRow {
                            letter(level)
                            // one line each: a long fracton name ("Gamma Didecafracton") shrinks a little, never wraps
                            Text(verbatim: Notation.periodName(level: level, ordinal: ordinals[level]))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .layoutPriority(1)
                            Text(verbatim: quarters[level])
                                .foregroundStyle(Theme.ink3)
                                .lineLimit(1)
                        }
                    }
                    GridRow {
                        letter(4)
                        Text("\(Text(verbatim: "ε#\(clock.epsilon)").foregroundStyle(Theme.levelColor(4))) \(Text(verbatim: "\(clock.eta)η").foregroundStyle(Theme.ink)) \(Text(verbatim: "\(clock.iota)ι \(clock.lambda)λ").foregroundStyle(Theme.ink2))")
                            .gridCellColumns(2)
                    }
                }
                .font(roomy ? .title3 : .callout)
                .monospacedDigit()
                Text(verbatim: n.stamp(at: t, upTo: "lambda"))
                    .font(roomy ? .callout : .caption)
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .textSelection(.enabled)
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func letter(_ level: Int) -> some View {
        Text(verbatim: Fractonica.periodName(level).letter)
            .font((roomy ? Font.title3 : .callout).weight(.semibold))
            .foregroundStyle(Theme.levelColor(level))
            .frame(minWidth: 14, alignment: .center)
            .accessibilityHidden(true)
    }
}
