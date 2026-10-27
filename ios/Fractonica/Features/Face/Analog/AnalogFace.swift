import FractonicaKit
import SwiftUI

/// A mechanical dial (Features/Face/Analog) geared like a watch: each hand turns once while the one before it moves a
/// tick — the Nuclide's 77 Helions round the outer ring, the Helion's 36 Preons, the Preon's 65 Flavons, the Flavon's
/// 25 Blinks.
///
/// - The **Nuclide's rider** (a pointer in the Nuclide's colour on the bezel) runs round the chapter ring of 77
///   Helions, the 7 ζ numbered by their first Helion; the ring's gold track shows the Pentads across the Nuclide, each
///   start marked by its shape, the Hypopentads broad.
/// - The **Helion hand** (a polished dauphine, its inlay in the Helion's colour) turns once a Helion over 36 Preons:
///   the 9 θ as applied indices numbered in Preons, the Preons between as dots, the Helion's peak, node and valley
///   marked.
/// - The **Preon hand** (long and thin, tipped in the Preon's colour) turns once a Preon over the railway's 65 Flavon
///   ticks (5 κ of 13), a step a Blink.
/// - The **Flavon register** at 6 o'clock turns once a Flavon over 25 Blinks (5 μ of 5), stepping once a Blink.
/// - The **Pentad register** at 12 o'clock turns once a solar sync over its 19 Helions as Pentad I, II, III and the
///   Hypopentad: the running Pentad's badge filled, its Helions' pips lit. A tap opens the Pentad explainer.
/// - The **Helion window** at 3 o'clock shows the Helion's number in its Nuclide.
/// - The **balance** at 9 o'clock swings with the μ cycle (`Swing`).
///
/// Still parts are drawn once per size; the calendar (ring Pentads, register, window) once a Helion; the hands once a
/// Blink; the balance swings in Core Animation, re-synchronised with the clock on every change of its time base, so
/// nothing here redraws per frame. Nothing is Gregorian, so pure mode shows the same dial.
struct AnalogFace: View {
    /// Width over height of the face's frame.
    nonisolated static let aspectRatio: CGFloat = 1
    /// The -FXFaceTime instant, or nil to follow the clock.
    let fixed: Double?

    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @State private var explainerShown = FaceLaunch.current.pentads && FaceLaunch.current.face == .analog

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let rate = fixed == nil ? store.base.rate : 0
            let blurred = Self.blurred(rate: rate)
            let words = settings.wording
            ZStack {
                AnalogDialUnder(size: size).equatable()
                NowTimeline(fixed: fixed, next: { AnalogDial.calendarChange(after: $0) }) { t in
                    if let reading = AnalogReading.make(at: t) {
                        AnalogCalendar(size: size, state: .init(reading)).equatable()
                    }
                }
                AnalogBalance(size: size, fixed: fixed)
                AnalogDialOver(size: size).equatable()
                NowTimeline(fixed: fixed, next: { AnalogDial.handsChange(after: $0) }) { t in
                    if let reading = AnalogReading.make(at: t) {
                        AnalogHands(size: size, reading: reading, blurred: blurred)
                    } else {
                        AnalogOutOfRange(size: size, words: FaceWords.outOfRange(words: words))
                    }
                }
                AnalogGlass(size: size).equatable()
            }
            .frame(width: size.width, height: size.height)
            .accessibilityHidden(true)
            .overlay { speech(size) }
            .overlay { pentadButton(size) }
        }
        .sheet(isPresented: $explainerShown) {
            NavigationStack { PentadExplainer(fixed: fixed) }
                #if os(iOS)
                .sheetDetents([.large])
                #else
                .frame(minWidth: 520, minHeight: 640)
                #endif
        }
    }

    /// The hands a time-lapse turns round faster than once a second blur (the balance has a rule of its own).
    static func blurred(rate: Double) -> Set<AnalogHandKind> {
        let clock = FractonicaClock.shared
        let helion = clock.levelInfo(6).meanSeconds
        let periods: [(AnalogHandKind, Double)] = [
            (.nuclide, helion * Double(AnalogDial.helionsPerNuclide)),
            (.helion, helion),
            (.pentad, helion * Double(AnalogDial.helionsPerSync)),
            (.preon, clock.levelInfo(8).meanSeconds),
            (.flavon, clock.levelInfo(10).meanSeconds),
        ]
        return Set(periods.filter { AnalogDial.blurred(period: $0.1, rate: rate, shortest: 1) }.map(\.0))
    }

    /// What VoiceOver reads for the dial: the minor reading led by its Pentad, once a Flavon.
    private func speech(_ size: CGSize) -> some View {
        let words = settings.wording
        // a Flavon at most twice a second: a time-lapse would otherwise rewrite it 30 times a second
        return NowTimeline(fixed: fixed, minimumStep: 0.5, next: { AnalogDial.labelChange(after: $0) }) { t in
            Color.clear
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: AnalogReading.make(at: t)?.spoken
                        ?? FaceWords.outOfRange(words: words).title.joined(separator: " ")))
                .accessibilityAddTraits(.updatesFrequently)
        }
        .allowsHitTesting(false)
    }

    /// The Pentad register opens the Pentad explainer, as the Pentad card does under the other faces.
    private func pentadButton(_ size: CGSize) -> some View {
        let g = AnalogGeometry(size: size)
        let d = 2 * g.length(AnalogGeometry.pentadRegister.radius)
        return Button {
            explainerShown = true
        } label: {
            NowTimeline(fixed: fixed, next: { AnalogDial.calendarChange(after: $0) }) { t in
                Circle()
                    .fill(.clear)
                    .contentShape(Circle())
                    .accessibilityLabel(Text(verbatim: AnalogReading.make(at: t)?.spokenPentad ?? "Pentads"))
            }
        }
        .buttonStyle(.plain)
        .frame(width: d, height: d)
        .position(g.point(AnalogGeometry.pentadRegister.center))
        .accessibilityHint(Text("Shows how the Pentads follow the Sun"))
        .help("How the Pentads follow the Sun")
    }
}

/// Outside the catalogue: the hands taken off, a plate saying so over the dial's middle.
struct AnalogOutOfRange: View {
    let size: CGSize
    let words: (title: [String], range: [String])

    var body: some View {
        let g = AnalogGeometry(size: size)
        VStack(spacing: g.length(0.012)) {
            ForEach(words.title, id: \.self) { line in
                Text(verbatim: line).font(.system(size: g.length(0.07), weight: .semibold))
                    .foregroundStyle(Theme.ink)
            }
            ForEach(words.range, id: \.self) { line in
                Text(verbatim: line).font(.system(size: g.length(0.05)))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .multilineTextAlignment(.center)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .padding(.horizontal, g.length(0.06))
        .padding(.vertical, g.length(0.04))
        .background(Theme.Analog.register.opacity(0.94), in: .rect(cornerRadius: g.length(0.05), style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: g.length(0.05), style: .continuous).strokeBorder(Theme.line2, lineWidth: 1)
        }
        .frame(maxWidth: g.length(1.1))
        .position(g.center)
    }
}
