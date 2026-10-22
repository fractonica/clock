import FractonicaKit
import Foundation

/// "How to read" the dial, in Earth or pure words (the help list of src/ui/rings.js and pure-text.js `helpHTML`),
/// rewritten for touch and pointer.
enum RingsHelp {
    struct Item: Identifiable, Sendable {
        let title: String
        let body: String
        var id: String { title }
    }

    /// The innermost ring the dial opens with (the default depth range) and the finest there is.
    static let openingLevel = 9
    static let finestLevel = Fractonica.maxLevel

    static func items(pure: Bool) -> [Item] {
        let clock = FractonicaClock.shared
        if pure {
            let words = RingsPureText()
            let range = "The dial opens with \(RingsText.levelTag(openingLevel)) as its innermost ring (one turn takes about \(words.aboutTurn(openingLevel))); "
                + "the depth range goes on down to \(RingsText.levelTag(finestLevel)), whose turn lasts about \(words.aboutTurn(finestLevel))."
            return [
                Item(title: "Rings", body: "Every ring is one cycle. The outermost, α, spans four Saros intervals (\(words.notation.catalogueText()) cover the whole catalogue); each ring inside it is the next harmonic, 4 to 13 times shorter. \(range)"),
                Item(title: "Names", body: "The four outer rings are the major periods, said in words: Delta Trifracton End is the 3rd Delta of its Gamma, in the quarter that ends at its end; Peak, Node, Valley and End are the four quarters. Every finer ring is named by where its cycle starts in its Nuclide: ε#5 34η 29ι is the 34th Helion of the 5th Nuclide, 29 Preons into it. η 7 · 1/11 is the depth chip with the place in the parent depth."),
                Item(title: "Arc and dot", body: "The arc grows clockwise from the top as the cycle runs; the dot is the hand, exactly where we are in that cycle. Rings too fast to follow dissolve into a glow."),
                Item(title: "Sectors and funnels", body: "A ring is cut into the child cycles it contains. The tinted sector is the one running now, and the funnel shows it opening up into the whole next ring."),
                Item(title: "Quarters", body: "Beads at the right, the bottom and the left mark peak, node and valley; they fill in as they are passed. The selected ring is labelled."),
                Item(title: "Centre", body: "The countdown to the end of the selected cycle on the ladder (6ι 43λ) and what begins there. A minor cycle shows how far through it you are as two glyphs, 256 states; a major one shows its quarter instead."),
                Item(title: "Counting", body: "Ordinals (Delta Trifracton, δ#3, ε#5) and the Helion of a date are numbered from 1; Preons, Flavons and Blinks (ι λ ν) count completed units from 0. A Nuclide is 77 Helions, a Helion 36 Preons, a Preon 65 Flavons, a Flavon 25 Blinks; the depths between (ζ θ κ μ) are 11η, 4ι, 13λ and 5ν long. Real time is counted in Blinks."),
                Item(title: "Touch", body: "Tap a ring to select it, then tap one of its sectors to go to the start of that child cycle. Drag around a ring to wind its hand through the cycle and on into the next. Touch and hold for what a ring or sector is. Drag along the wave to move inside the selected cycle; the thresholds below it jump to that moment."),
            ]
        }
        let opening = clock.levelInfo(openingLevel).meanSeconds
        let finest = clock.levelInfo(finestLevel).meanSeconds
        let range = "The dial opens with \(RingsText.levelTag(openingLevel)) as its innermost ring (one turn takes about \(EarthTime.duration(opening))); "
            + "the depth range goes on down to \(RingsText.levelTag(finestLevel)), whose turn lasts about \(EarthTime.duration(finest))."
        return [
            Item(title: "Rings", body: "Every ring is one cycle. The outermost, α, lasts about 72 years; each ring inside it is the next harmonic, 4 to 13 times shorter. \(range)"),
            Item(title: "Labels", body: "η 7 · 1/11 reads: cycle η, depth 7, the 1st of the 11 η cycles inside its parent cycle."),
            Item(title: "Arc and dot", body: "The arc grows clockwise from 12 o’clock as the cycle runs; the dot is the hand, exactly where we are in that cycle. Rings too fast to follow dissolve into a glow."),
            Item(title: "Sectors and funnels", body: "A ring is cut into the child cycles it contains. The tinted sector is the one running now, and the funnel shows it opening up into the whole next ring."),
            Item(title: "Quarters", body: "Beads at 3, 6 and 9 o’clock mark peak, node and valley; they fill in as they are passed. The selected ring is labelled."),
            Item(title: "Centre", body: "The countdown to the end of the selected cycle and its end time in your zone. The wave below shows what the glyph does over the same cycle."),
            Item(title: "Touch", body: "Tap a ring to select it, then tap one of its sectors to go to the start of that child cycle. Drag around a ring to wind its hand through the cycle and on into the next. Touch and hold for what a ring or sector is. Drag along the wave to move inside the selected cycle; the thresholds below it jump to that moment."),
        ]
    }
}
