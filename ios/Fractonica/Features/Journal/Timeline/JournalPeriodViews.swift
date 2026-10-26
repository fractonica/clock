import FractonicaKit
import SwiftUI

/// The zoomed-out stack: the journal's periods as blocks (Deltas, Gammas or Betas), under their parent period's
/// header (pinned while its blocks scroll by), several abreast on a wide screen. Tap a block to zoom into it.
struct JournalBlockList: View {
    let zoom: JournalZoom
    let sections: [JournalPeriodSection]
    let words: Wording
    let visibility: JournalVisibility
    /// Zoom into a period; the point is where it was tapped, in the stack's coordinate space.
    let open: (JournalPeriod, CGPoint?) -> Void
    let showInWave: (JournalPeriod) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 4) {
                summary.id("blocks.top")
                grid
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
            .frame(maxWidth: 1180)
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
    }

    private var grid: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 300, maximum: 560), spacing: 14, alignment: .top)],
                  alignment: .leading, spacing: 14, pinnedViews: [.sectionHeaders]) {
                ForEach(sections) { section in
                    Section {
                        ForEach(section.periods) { period in
                            JournalPeriodBlock(period: period, words: words)
                                .id(period.id)
                                .onTapGesture(coordinateSpace: .named(JournalStackSpace.name)) { open(period, $0) }
                                .accessibilityAddTraits(.isButton)
                                .accessibilityHint("Shows its \(zoom.finer?.title.lowercased() ?? "entries")")
                                .accessibilityAction { open(period, nil) }
                                .contextMenu {
                                    Button("Show \(zoom.finer?.title ?? "Entries")", systemImage: "plus.magnifyingglass") { open(period, nil) }
                                    Button("Show on the Wave", systemImage: JournalBrowsing.Mode.wave.systemImage) { showInWave(period) }
                                }
                                .onAppear { visibility.appear(period.id, time: (period.start + period.end) / 2) }
                                .onDisappear { visibility.disappear(period.id) }
                        }
                    } header: {
                        JournalSectionHeader(section: section, zoom: zoom, words: words)
                            .id(section.id)
                    }
                }
        }
    }

    /// "14 Deltas · 263 entries" over the blocks.
    private var summary: some View {
        let entries = sections.reduce(0) { $0 + $1.count }
        let blocks = sections.reduce(0) { $0 + $1.periods.count }
        return HStack(spacing: 6) {
            Text(verbatim: zoom.symbol)
                .font(.reading(13, weight: .semibold))
                .foregroundStyle(Theme.levelColor(zoom.level))
            Text(verbatim: "\(blocks) \(blocks == 1 ? JournalStackWords.singular(zoom) : zoom.title) · \(JournalPeriods.entries(entries))")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.ink3)
            Spacer(minLength: 0)
        }
        .padding(.top, 2)
        .padding(.bottom, 2)
    }
}

/// The coordinate space the stack reports taps and pinches in (its container, not the leaning content).
enum JournalStackSpace {
    static let name = "journal.stack"
}

enum JournalStackWords {
    /// "Delta" for "Deltas".
    static func singular(_ zoom: JournalZoom) -> String { String(zoom.title.dropLast()) }
}

/// A parent period over its blocks: "Gamma Difracton", its span, "3 Deltas · 41 entries". Pinned while its blocks
/// scroll under it.
struct JournalSectionHeader: View {
    let section: JournalPeriodSection
    let zoom: JournalZoom
    let words: Wording

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: JournalPeriods.name(level: section.level, cycle: section.cycle, notation: words.notation))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.levelColor(section.level, lightness: 0.72))
                if let secondary {
                    Text(verbatim: secondary)
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.85)
            Spacer(minLength: 8)
            Text(verbatim: "\(section.periods.count) \(section.periods.count == 1 ? JournalStackWords.singular(zoom) : zoom.title) · \(JournalPeriods.entries(section.count))")
                .font(.caption.weight(.medium))
                .foregroundStyle(Theme.ink3)
                .lineLimit(1)
        }
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            // pinned over the blocks: the page's own ground, fading out below
            LinearGradient(colors: [Theme.background, Theme.background.opacity(0.92), Theme.background.opacity(0)],
                           startPoint: .top, endPoint: .bottom)
                .padding(.horizontal, -16)
                .padding(.bottom, -10)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var secondary: String? {
        guard section.cycle != nil else { return nil }
        if words.pure {
            let address = JournalPeriods.address(level: section.level, at: (section.start + section.end) / 2, notation: words.notation)
            return address.isEmpty ? nil : address
        }
        return JournalPeriods.earthSpan(start: section.start, end: section.end, level: section.level, earth: words.earth)
    }
}

/// A period as a block: its name ("Delta Trifracton"), where it lies (the Earth span; pure mode: its parents' address),
/// how many entries it holds, its most used emoji, a few of its pictures and a strip of when its entries were written.
struct JournalPeriodBlock: View {
    let period: JournalPeriod
    let words: Wording

    @State private var sky = SkyDisplay.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: JournalPeriods.name(level: period.level, cycle: period.cycle, notation: words.notation))
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                    if let secondary {
                        Text(verbatim: secondary)
                            .font(.caption)
                            .foregroundStyle(Theme.ink3)
                    }
                }
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 0) {
                    Text(verbatim: "\(period.count)")
                        .font(.reading(22, weight: .semibold))
                        .foregroundStyle(Theme.levelColor(period.level, lightness: 0.72))
                    Text(period.count == 1 ? "entry" : "entries")
                        .font(.caption2)
                        .foregroundStyle(Theme.ink3)
                }
            }
            if !period.emojis.isEmpty {
                JournalEmojiRow(emojis: period.emojis, more: period.emojiCount - period.emojis.count)
            }
            let notable = SkyEvents.shared.notable(from: period.start, to: period.end, limit: JournalPeriods.skyLimit, hiding: sky.hidden)
            if !notable.shown.isEmpty {
                SkyBlockRow(shown: notable.shown, more: notable.more, words: words)
            }
            if !period.media.isEmpty {
                JournalCollage(media: period.media, more: period.mediaCount - period.media.count)
            }
            JournalDensityStrip(period: period)
                .frame(height: 16)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .journalBlockSurface(level: period.level)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityText)
    }

    private var secondary: String? {
        guard period.cycle != nil else { return nil }
        if words.pure {
            let address = JournalPeriods.address(level: period.level, at: (period.start + period.end) / 2, notation: words.notation)
            return address.isEmpty ? nil : address
        }
        return JournalPeriods.earthSpan(start: period.start, end: period.end, level: period.level, earth: words.earth)
    }

    private var accessibilityText: String {
        var parts = [JournalPeriods.name(level: period.level, cycle: period.cycle, notation: words.notation)]
        if let secondary { parts.append(secondary) }
        parts.append(JournalPeriods.entries(period.count))
        if period.mediaCount > 0 { parts.append(period.mediaCount == 1 ? "1 picture" : "\(period.mediaCount) pictures") }
        let notable = SkyEvents.shared.notable(from: period.start, to: period.end, limit: 3, hiding: sky.hidden)
        if !notable.shown.isEmpty { parts.append("sky: " + SkyStyle.spoken(notable.shown, pure: words.pure)) }
        return parts.joined(separator: ", ")
    }
}

extension View {
    /// A block's outer shape: the card's panel and hairline, the hairline washed with the level's colour. The one place
    /// it is built, so a frame or a highlight can be applied here.
    func journalBlockSurface(level: Int) -> some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        return background(Theme.panel, in: shape)
            .overlay(shape.stroke(Theme.levelColor(level, opacity: 0.28, lightness: 0.5), lineWidth: 1))
            .contentShape(shape)
    }
}

/// A period's emoji, overlapping discs, most used first, "+3" when there are more.
struct JournalEmojiRow: View {
    let emojis: [String]
    var more = 0

    var body: some View {
        HStack(spacing: -7) {
            ForEach(Array(emojis.enumerated()), id: \.offset) { i, emoji in
                EmojiBadge(emoji: emoji, size: 32)
                    .zIndex(Double(emojis.count - i))
            }
            if more > 0 {
                Text(verbatim: "+\(more)")
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .background(Theme.panel3, in: .capsule)
                    .overlay(Capsule().stroke(Theme.line2.opacity(0.6), lineWidth: 1))
                    .padding(.leading, 12)
            }
        }
        .accessibilityHidden(true)
    }
}

/// A small collage of a period's pictures: one wide, two halves, or a row of three or four, "+N" on the last.
struct JournalCollage: View {
    let media: [BlobRef]
    var more = 0

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(media.enumerated()), id: \.element.hash) { i, blob in
                Color.clear
                    .frame(maxWidth: .infinity)
                    .frame(height: height)
                    .overlay { JournalCollageTile(blob: blob) }
                    .overlay {
                        if i == media.count - 1, more > 0 {
                            ZStack {
                                Color.black.opacity(0.45)
                                Text(verbatim: "+\(more)").font(.headline).foregroundStyle(.white)
                            }
                        }
                    }
                    .clipShape(.rect(cornerRadius: 11, style: .continuous))
            }
        }
        .accessibilityHidden(true)
    }

    private var height: CGFloat {
        switch media.count {
        case 1: 120
        case 2: 92
        default: 68
        }
    }
}

/// One picture of a collage. Blocks show many pictures at once, often the same few files: they are decoded one at a
/// time, in the order the tiles ask (a zoomed-out page asks for dozens together), then come from the shared cache.
struct JournalCollageTile: View {
    let blob: BlobRef

    @Environment(\.displayScale) private var displayScale
    @State private var image: CGImage?

    /// The long side to load, in points: the cards' size, so one cached thumbnail serves both.
    static let points: CGFloat = 260

    var body: some View {
        let pixels = Int(Self.points * displayScale)
        ZStack {
            if let image = image ?? Self.cached(blob, pixels) {
                Image(decorative: image, scale: displayScale)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Rectangle().fill(Theme.panel3)
                    .overlay {
                        Image(systemName: blob.role == "video" ? "video" : "photo")
                            .font(.callout)
                            .foregroundStyle(Theme.ink3.opacity(0.6))
                    }
            }
        }
        .task(id: "\(blob.hash)@\(pixels)") {
            guard image == nil, Self.cached(blob, pixels) == nil else { return }
            image = await JournalCollageLoader.shared.load(blob, pixels: pixels)
        }
    }

    private static func source(_ blob: BlobRef) -> (url: URL, key: String, video: Bool)? {
        let store = JournalStore.shared
        if blob.role == "video" {
            if let poster = blob.poster, let url = store.blobFile(poster) { return (url, poster, false) }
            return store.blobFile(blob.hash).map { ($0, blob.hash, true) }
        }
        return store.blobFile(blob.hash).map { ($0, blob.hash, false) }
    }

    static func cached(_ blob: BlobRef, _ pixels: Int) -> CGImage? {
        source(blob).flatMap { Thumbnails.shared.cached($0.key, pixels: pixels) }
    }

    /// Decodes the tile's picture (the hub's thumbnail when the device lacks the file).
    static func decode(_ blob: BlobRef, pixels: Int) async -> CGImage? {
        if let s = source(blob) {
            return await Thumbnails.shared.image(s.url, key: s.key, pixels: pixels, video: s.video)
        }
        let key = blob.role == "video" ? (blob.poster ?? blob.hash) : blob.hash
        guard let remote = JournalHooks.remoteThumbnail, let data = await remote(key, min(2048, max(64, pixels))) else { return nil }
        return await Thumbnails.shared.image(data, key: "remote:\(key)", pixels: pixels)
    }
}

/// Decodes collage pictures one after another.
@MainActor
final class JournalCollageLoader {
    static let shared = JournalCollageLoader()
    private var tail: Task<Void, Never>?

    func load(_ blob: BlobRef, pixels: Int) async -> CGImage? {
        let previous = tail
        let job = Task { @MainActor () -> CGImage? in
            await previous?.value
            if let hit = JournalCollageTile.cached(blob, pixels) { return hit }
            return await JournalCollageTile.decode(blob, pixels: pixels)
        }
        tail = Task { _ = await job.value }
        return await job.value
    }
}

/// When a period's entries were written: a tick for each along the period (start on the left), its quarter marks
/// (Peak, Node, Valley) faint, and today's place when the period is running.
struct JournalDensityStrip: View {
    let period: JournalPeriod

    var body: some View {
        Canvas { context, size in
            let w = size.width, h = size.height, mid = h / 2
            let span = max(1, period.end - period.start)
            var base = Path()
            base.move(to: CGPoint(x: 0, y: mid))
            base.addLine(to: CGPoint(x: w, y: mid))
            context.stroke(base, with: .color(Theme.line2), lineWidth: 1)
            var quarters = Path()
            for q in [0.25, 0.5, 0.75] {
                quarters.move(to: CGPoint(x: w * q, y: mid - 3))
                quarters.addLine(to: CGPoint(x: w * q, y: mid + 3))
            }
            context.stroke(quarters, with: .color(Theme.ink3.opacity(0.5)), lineWidth: 1)
            guard period.cycle != nil else { return }
            var ticks = Path()
            for t in period.times {
                let x = min(w - 1, max(1, w * (t - period.start) / span))
                ticks.move(to: CGPoint(x: x, y: 2))
                ticks.addLine(to: CGPoint(x: x, y: h - 2))
            }
            context.stroke(ticks, with: .color(Theme.levelColor(period.level, opacity: 0.85, lightness: 0.7)), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
            let now = Date.now.timeIntervalSince1970
            if period.contains(now) {
                let x = w * (now - period.start) / span
                context.fill(Path(ellipseIn: CGRect(x: x - 3, y: mid - 3, width: 6, height: 6)), with: .color(Theme.now))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Where the stack is zoomed: Helions · Deltas · Gammas · Betas, the current one lit. Shown while pinching and briefly
/// after a change.
struct JournalZoomIndicator: View {
    let zoom: JournalZoom

    var body: some View {
        HStack(spacing: 4) {
            ForEach(JournalZoom.allCases) { z in
                if z != .helion {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(Theme.ink3.opacity(0.6))
                }
                HStack(spacing: 3) {
                    Text(verbatim: z.symbol).font(.reading(12, weight: .semibold))
                    Text(z.title).font(.caption.weight(z == zoom ? .semibold : .regular))
                }
                .foregroundStyle(z == zoom ? Theme.levelColor(z.level, lightness: 0.74) : Theme.ink3)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background {
                    if z == zoom { Capsule().fill(Theme.levelColor(z.level, opacity: 0.18, lightness: 0.5)) }
                }
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 5)
        .glassSurface(.regular, in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Zoomed to \(zoom.title)")
    }
}

/// The rows in sight, for keeping the reader's place when the zoom changes: what appears and disappears, with the
/// moment it stands for. Not observed (it changes as the list scrolls).
@MainActor
final class JournalVisibility {
    private var times: [String: Double] = [:]

    func appear(_ id: String, time: Double) { times[id] = time }
    func disappear(_ id: String) { times[id] = nil }
    func clear() { times.removeAll() }

    /// The middle of what is in sight (its median moment), nil when nothing is known.
    var anchorTime: Double? {
        let sorted = times.values.sorted()
        guard !sorted.isEmpty else { return nil }
        return sorted[sorted.count / 2]
    }
}
