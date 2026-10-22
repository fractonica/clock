import FractonicaKit
import SwiftUI

// The watch face's rows explain themselves (the web face's tooltips, docs/design/10-face.md): press and hold a row on
// iPhone or iPad for a card above its menu; on a Mac (and an iPad pointer) the row's tooltip says the same, and its
// right-click menu repeats the lines above the actions. The words are `FaceTips`; the menu acts like the web's click
// (select the row's level in every view, step the depth) or, on the solar row, shows the info labels or keeps the
// letters.

/// What the rows' menus and cards need. Everything is passed in, nothing read from the environment: a context menu's
/// preview is hosted apart from the face.
struct WatchRowTips {
    let store: ClockStore
    let words: Wording
    let topDepth: Int
    /// The `-FXFaceTime` hook's instant; nil reads the displayed time.
    var fixed: Double?
    var lettersKept: Bool
    var selectedLevel: Int
    var select: (WatchGeometry.Row) -> Void
    var step: (Int) -> Void
    var canStep: (Int) -> Bool
    var showInfo: () -> Void
    var toggleLetters: () -> Void

    /// The level of a period row; nil for the solar sync.
    func level(_ row: WatchGeometry.Row) -> Int? {
        let levels = WatchGeometry.levels(topDepth: topDepth)
        switch row {
        case .top: return levels.top
        case .bottom: return levels.bottom
        case .solar: return nil
        }
    }

    /// The row's tip at this moment; nil outside the catalogue.
    @MainActor
    func tip(_ row: WatchGeometry.Row) -> RowTip? {
        let t = fixed ?? store.time()
        if let level = level(row) { return FaceTips.period(level: level, at: t, words: words) }
        return FaceTips.solar(at: t, words: words)
    }
}

/// A row's actions, under its card (iOS) or its lines (Mac, from `tip`: the tip taken when the pointer arrived).
struct WatchRowMenu: View {
    let row: WatchGeometry.Row
    let tips: WatchRowTips
    var tip: RowTip?

    var body: some View {
        #if os(macOS)
        if let tip {
            Section(tip.title) {
                ForEach(Array(FaceTips.plainLines(RowTip(title: tip.title, aside: tip.aside, lines: tip.lines)).enumerated()),
                        id: \.offset) { _, line in
                    Text(verbatim: line)
                }
            }
        }
        #endif
        if let level = tips.level(row) {
            let dir = row == .top ? -1 : 1
            Button("Select \(Fractonica.periodName(level).text) in Every View", systemImage: "scope") { tips.select(row) }
                .disabled(level == tips.selectedLevel)
            Button(dir < 0 ? "Show Longer Periods" : "Show Shorter Periods", systemImage: dir < 0 ? "chevron.up" : "chevron.down") {
                tips.step(dir)
            }
            .disabled(!tips.canStep(dir))
        } else {
            Button("Show Info Labels", systemImage: "info.circle") { tips.showInfo() }
            Button(tips.lettersKept ? "Hide Period Letters" : "Keep Period Letters", systemImage: "character") {
                tips.toggleLetters()
            }
        }
    }
}

/// The card of a row, read when it appears.
struct FaceTipPreview: View {
    let row: WatchGeometry.Row
    let tips: WatchRowTips

    var body: some View {
        FaceTipCard(tip: tips.tip(row))
    }
}

/// A row's tip as a card: the title in the row's colour, what one cycle is, the lines, and pure mode's counting note.
struct FaceTipCard: View {
    let tip: RowTip?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let tip {
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: tip.title)
                        .font(.headline)
                        .foregroundStyle(tip.level.map { Theme.levelColor($0) } ?? Theme.gold)
                    if !tip.aside.isEmpty {
                        Text(verbatim: tip.aside)
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink3)
                    }
                }
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(tip.lines.enumerated()), id: \.offset) { i, line in
                        if i == 0, let phase = tip.pairPhase {
                            HStack(spacing: 8) {
                                PairView(fraction: phase, color: Theme.gold, height: 17)
                                    .accessibilityHidden(true)
                                Text(verbatim: line)
                            }
                        } else {
                            Text(verbatim: line)
                        }
                    }
                }
                .font(.subheadline)
                .foregroundStyle(Theme.ink)
                if let note = tip.note {
                    Text(verbatim: note)
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                }
            } else {
                Text(verbatim: "outside the catalogue")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
        }
        .monospacedDigit()
        .fixedSize(horizontal: false, vertical: true)
        .frame(width: 300, alignment: .leading)
        .padding(18)
        .background(Theme.panel)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }
}

extension View {
    /// The row's tooltip and its press-and-hold (right-click) menu, when the face offers them.
    @ViewBuilder
    func watchRowTip(_ row: WatchGeometry.Row, tips: WatchRowTips?, hovered tip: RowTip?, fallback: String) -> some View {
        if let tips {
            self
                .help(Text(verbatim: tip.map { ([$0.title] + FaceTips.plainLines($0)).joined(separator: "\n") } ?? fallback))
                .contextMenu {
                    WatchRowMenu(row: row, tips: tips, tip: tip)
                } preview: {
                    FaceTipPreview(row: row, tips: tips)
                }
        } else {
            self.help(Text(verbatim: fallback))
        }
    }
}
