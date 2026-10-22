import FractonicaKit
import SwiftUI

/// The minor clock with the Helion's phase pair, "34η ‹pair› 29ι 21λ", at the displayed time (or Focus's fixed test
/// moment); outside the catalogue, a short note instead.
struct FocusClockReading: View {
    var timeOverride: Double?
    /// Larger on iPad and Mac.
    var regular = false

    @Environment(AppSettings.self) private var settings
    @ScaledMetric(relativeTo: .largeTitle) private var compactSize: CGFloat = 38
    @ScaledMetric(relativeTo: .largeTitle) private var regularSize: CGFloat = 54

    private var size: CGFloat { regular ? regularSize : compactSize }

    var body: some View {
        // The Flavon count changes every ≈ 7.8 s; half a second keeps it honest.
        ClockTimeline(.periodic(0.5)) { displayed in
            reading(at: timeOverride ?? displayed)
        }
    }

    @ViewBuilder
    private func reading(at t: Double) -> some View {
        let clock = FractonicaClock.shared
        if let minor = Notation.standard.clock(at: t), let helion = clock.level(at: t, 6) {
            HStack(alignment: .center, spacing: size * 0.22) {
                Text("\(minor.eta)η")
                PairView(fraction: helion.phase, color: Theme.teal, height: size * 0.62)
                Text("\(minor.iota)ι \(minor.lambda)λ")
            }
            .font(.reading(size, weight: .light))
            .foregroundStyle(Theme.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Clock \(settings.wording.notation.clockText(at: t))"))
        } else {
            VStack(spacing: 6) {
                Text("Outside the catalogue")
                    .font(.title3.weight(.light))
                    .foregroundStyle(Theme.ink)
                Text(settings.pure ? "Readings exist from \(Notation.standard.catalogueText())" : "Readings exist from 1613 to 2857")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2)
            }
            .multilineTextAlignment(.center)
        }
    }
}

/// "Breathe in" while the Flavon rises, "Breathe out" while it falls: the words of the picture's breathing cue.
struct FocusBreathWord: View {
    var timeOverride: Double?

    @Environment(ClockStore.self) private var store

    var body: some View {
        // Real time: the cue keeps breathing when the displayed time is paused (it then follows the live Flavon).
        TimelineView(.periodic(from: .now, by: 0.25)) { context in
            if let inhaling = Self.inhaling(store: store, date: context.date, timeOverride: timeOverride) {
                Label(inhaling ? "Breathe in" : "Breathe out", systemImage: inhaling ? "arrow.up.circle" : "arrow.down.circle")
                    .contentTransition(.symbolEffect(.replace))
                    .animation(.easeInOut(duration: 0.6), value: inhaling)
            }
        }
    }

    /// The Flavon rises (nil when there is no Flavon to follow): the displayed one when it runs at real speed,
    /// else the live one — as `FocusHarmonics` decides for the picture.
    static func inhaling(store: ClockStore, date: Date, timeOverride: Double?) -> Bool? {
        let clock = store.clock
        let real = date.timeIntervalSince1970
        let displayed = timeOverride ?? store.time(at: date)
        guard clock.inRange(displayed) else { return nil }
        let runsAtRealSpeed = timeOverride == nil && (store.isLive || abs(store.rate - 1) < 1e-9)
        let t = runsAtRealSpeed ? displayed : real
        guard let flavon = clock.level(at: t, FocusHarmonics.breathLevel) else { return nil }
        return cos(2 * .pi * flavon.phase) > 0
    }
}

/// The session line: "4ι · 28:13 left" (pure "4ι · 3ι 22λ left"), "Open · 12:04", "4ι complete".
struct FocusSessionLine: View {
    @Environment(AppSettings.self) private var settings
    let model: FocusModel

    var body: some View {
        if let session = model.session {
            TimelineView(.periodic(from: Date(timeIntervalSince1970: session.start), by: 1)) { context in
                line(session, now: context.date.timeIntervalSince1970)
            }
        }
    }

    private func line(_ session: FocusSession, now: Double) -> some View {
        let pure = settings.pure
        let at = FractonicaClock.shared.clamp(now)
        return HStack(spacing: 8) {
            if let completed = model.completed {
                Label("\(completed.length.title) complete", systemImage: "checkmark.circle")
                    .foregroundStyle(Theme.teal)
            } else if let remaining = session.remaining(at: now) {
                Text("\(session.length.title) · \(FocusText.span(remaining, pure: pure, at: at)) left")
                    .monospacedDigit()
            } else {
                Text("Open · \(FocusText.span(session.elapsed(at: now), pure: pure, at: at))")
                    .monospacedDigit()
            }
        }
        .contentTransition(.numericText())
    }
}

/// A thin progress line under the session, for timed sessions.
struct FocusSessionProgress: View {
    let model: FocusModel

    var body: some View {
        if let session = model.session, session.end != nil {
            TimelineView(.periodic(from: Date(timeIntervalSince1970: session.start), by: 1)) { context in
                let progress = session.progress(at: context.date.timeIntervalSince1970)
                Capsule()
                    .fill(Theme.line2.opacity(0.6))
                    .frame(width: 120, height: 2)
                    .overlay(alignment: .leading) {
                        Capsule()
                            .fill(Theme.teal)
                            .frame(width: 120 * progress, height: 2)
                    }
                    .accessibilityHidden(true)
            }
        }
    }
}

/// The style's name and where it sits among the four (swipe sideways to change).
struct FocusStyleIndicator: View {
    let style: FocusStyle

    var body: some View {
        VStack(spacing: 8) {
            Text(style.title.uppercased())
                .font(.caption.weight(.medium))
                .tracking(2)
                .foregroundStyle(Theme.ink2)
                .contentTransition(.opacity)
            HStack(spacing: 6) {
                ForEach(FocusStyle.allCases) { s in
                    Circle()
                        .fill(s == style ? Theme.ink : Theme.ink3.opacity(0.5))
                        .frame(width: 5, height: 5)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("\(style.title), style \(FocusStyle.allCases.firstIndex(of: style).map { $0 + 1 } ?? 1) of \(FocusStyle.allCases.count)"))
    }
}

/// The frame statistics (-FXFocusStats 1).
struct FocusStatsBadge: View {
    let stats: FocusFrameStats

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
            Text(stats.line)
                .font(.code(11))
                .foregroundStyle(Theme.ink2)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.black.opacity(0.4), in: .capsule)
        }
    }
}
