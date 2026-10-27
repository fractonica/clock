import AppIntents
import FractonicaKit
import SwiftUI

/// "What's the Fractonica time?": Siri says the minor clock and the date, and shows them with the Helion's pair and the
/// stamp; Shortcuts gets the stamp as the result. Runs in the background (the app does not open) at the real now, in
/// the app's wording (pure mode, zone).
struct FractonicaTimeIntent: AppIntent {
    static let title: LocalizedStringResource = "What's the Fractonica Time"
    static let description = IntentDescription(
        "Tells the time on the Fractonica clock: the Helion, Preon and Flavon, the Nuclide and the Delta, and the stamp.",
        categoryName: "Clock"
    )

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog & ShowsSnippetView {
        let settings = AppSettings.shared
        let now = Date.now.timeIntervalSince1970
        guard let reply = FractonicaTimeReply(at: now, pure: settings.pure, zone: settings.timeZone) else {
            return .result(value: "", dialog: "The clock is outside its catalogue.",
                           view: FractonicaTimeSnippet(reply: nil))
        }
        return .result(
            value: reply.stamp,
            dialog: IntentDialog(full: LocalizedStringResource(stringLiteral: reply.spoken),
                                 supporting: LocalizedStringResource(stringLiteral: reply.supporting)),
            view: FractonicaTimeSnippet(reply: reply)
        )
    }
}

/// The snippet under Siri's answer: the Helion's pair beside the minor clock, the date, the stamp and (Earth words)
/// the Earth moment.
struct FractonicaTimeSnippet: View {
    let reply: FractonicaTimeReply?

    var body: some View {
        Group {
            if let reply {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .center, spacing: 16) {
                        OdometerView(digits: reply.helionPair, strokes: 2, color: Theme.teal, spacing: PairView.gap)
                            .frame(height: 46)
                        VStack(alignment: .leading, spacing: 2) {
                            clockText(reply)
                            // the date led by its Pentad, as a civil date by its weekday
                            Text("\(Text.pentadMark(reply.pentad).foregroundStyle(Theme.gold)) \(Text(verbatim: reply.date))")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Theme.ink2)
                        }
                    }
                    Text(reply.stamp)
                        .font(.code(12))
                        .foregroundStyle(Theme.ink3)
                        .textSelection(.enabled)
                    if let earth = reply.earth {
                        Text(earth)
                            .font(.footnote)
                            .foregroundStyle(Theme.ink3)
                    }
                }
                .accessibilityElement(children: .combine)
            } else {
                Text("outside the catalogue")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background { Backdrop() }
        .environment(\.colorScheme, .dark)
    }

    /// "34η 29ι 21λ": numbers in ink, letters in their levels' colours.
    private func clockText(_ reply: FractonicaTimeReply) -> some View {
        reply.clock.enumerated().reduce(Text(verbatim: "")) { text, item in
            let (i, part) = item
            let number = Text(verbatim: "\(part.number)").foregroundStyle(Theme.ink)
            let letter = Text(verbatim: part.letter).foregroundStyle(Theme.levelColor(part.level))
            return Text("\(text)\(i == 0 ? "" : " ")\(number)\(letter)")
        }
        .font(.reading(30, weight: .semibold))
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}
