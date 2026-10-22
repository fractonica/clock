import FractonicaKit
import SwiftUI
import WidgetKit

// The Lock Screen accessories (iOS; also StandBy's and the Watch-style faces' small slots). The system draws them in
// one tint over the wallpaper (vibrant), so they are built from primary and secondary ink, never from colour alone.

/// accessoryCircular: the Helion as a gauge, its number in the middle ("34" over "η").
struct HelionGaugeView: View {
    var snapshot: AccessorySnapshot?

    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if let s = snapshot {
                PhaseRing(phase: s.helionPhase)
                    .padding(3.5)
                    .widgetAccentable()
                VStack(spacing: -3) {
                    Text(verbatim: String(s.helion))
                        .font(.system(size: 23, weight: .semibold, design: .rounded).monospacedDigit())
                        .minimumScaleFactor(0.6)
                    Text("η")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                }
            } else {
                Image(systemName: "circle.dashed").font(.title3)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(snapshot.map { "Helion \($0.helion) of its Nuclide" } ?? "outside the catalogue")
    }
}

/// A gauge ring: a faint track, the phase swept clockwise from 12 o'clock with round ends, a gap where it starts.
struct PhaseRing: View {
    var phase: Double

    var body: some View {
        Canvas { context, size in
            let lineWidth = max(3, min(size.width, size.height) * 0.075)
            let r = min(size.width, size.height) / 2 - lineWidth / 2
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            var track = Path()
            track.addArc(center: c, radius: r, startAngle: .zero, endAngle: .degrees(360), clockwise: false)
            context.stroke(track, with: .color(.primary.opacity(0.22)), lineWidth: lineWidth)
            let f = min(1, max(0.004, phase))
            var arc = Path()
            arc.addArc(center: c, radius: r, startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * f), clockwise: false)
            context.stroke(arc, with: .color(.primary), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        }
        .accessibilityHidden(true)
    }
}

/// accessoryRectangular: the minor clock beside the Helion's pair, the Delta in words and the Nuclide below.
struct ClockRectangularView: View {
    var snapshot: AccessorySnapshot?

    var body: some View {
        if let s = snapshot {
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .center, spacing: 7) {
                    PairGlyphs(digits: s.helionPair, color: .primary, lineWidth: 1.6)
                        .frame(height: 19)
                        .widgetAccentable()
                    Text(s.inline)
                        .font(.reading(19, weight: .semibold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                Text(s.major)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(s.nuclide)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(s.inline), \(s.major), \(s.nuclide)")
        } else {
            Text("outside the catalogue").font(.caption)
        }
    }
}

/// accessoryInline: "34η 29ι".
struct ClockInlineView: View {
    var snapshot: AccessorySnapshot?

    var body: some View {
        Text(snapshot.map { "\($0.inline) · \($0.nuclide)" } ?? "outside the catalogue")
    }
}
