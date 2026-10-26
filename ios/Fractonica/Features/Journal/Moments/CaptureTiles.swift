import SwiftUI

/// A moment's captures as BeReal tiles: each capture its back photo with the front one inset, captioned with its
/// offset ("−1λ", "0", "+1λ"). Used by the instant view's saved card, the Moments screen and the entry's detail.
struct CaptureTiles: View {
    let groups: [MomentCaptureGroup<BlobRef>]
    var cornerRadius: CGFloat = 14
    /// A tap on a capture (its index in `groups`); nil: not tappable.
    var open: ((Int) -> Void)?

    /// The tiles of an entry's photos, or nil when they are not several captures of a moment (named `back@-1` …).
    init?(photos: [BlobRef], cornerRadius: CGFloat = 14, open: ((Int) -> Void)? = nil) {
        guard let groups = MomentCaptureGroup<BlobRef>.grouped(photos, name: \.name) else { return nil }
        self.groups = groups
        self.cornerRadius = cornerRadius
        self.open = open
    }

    var body: some View {
        if groups.count <= 3 {
            HStack(spacing: 6) { tiles }
        } else {
            ScrollView(.horizontal) {
                HStack(spacing: 6) { tiles.frame(width: 128) }
            }
            .scrollIndicators(.hidden)
            .scrollClipDisabled()
        }
    }

    private var tiles: some View {
        ForEach(Array(groups.enumerated()), id: \.element.offset) { i, group in
            let tile = CaptureTile(main: group.main, inset: group.inset, caption: MomentCaptures.offsetTag(group.offset),
                                   cornerRadius: cornerRadius)
                .accessibilityLabel("Capture \(MomentCaptures.offsetLabel(group.offset).lowercased())")
            if let open {
                Button { open(i) } label: { tile }
                    .buttonStyle(.plain)
            } else {
                tile
            }
        }
    }
}

/// One capture: the main photo filling a 3 : 4 tile, the inset in its corner, the caption at its foot.
struct CaptureTile: View {
    let main: BlobRef?
    let inset: BlobRef?
    var caption: String?
    var cornerRadius: CGFloat = 14

    var body: some View {
        Color.clear
            .aspectRatio(3 / 4, contentMode: .fit)
            .frame(maxWidth: .infinity)
            .overlay {
                if let main { BlobImage(blob: main, points: 300) } else { Theme.panel2 }
            }
            .overlay(alignment: .topLeading) {
                if let inset {
                    GeometryReader { proxy in
                        BlobImage(blob: inset, points: 120)
                            .frame(width: proxy.size.width * 0.36, height: proxy.size.width * 0.48)
                            .clipShape(.rect(cornerRadius: cornerRadius * 0.55, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: cornerRadius * 0.55, style: .continuous).stroke(.black.opacity(0.6), lineWidth: 1))
                            .padding(6)
                    }
                }
            }
            .overlay(alignment: .bottom) {
                if let caption {
                    Text(verbatim: caption)
                        .font(.reading(11, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 3)
                        .background(.black.opacity(0.55), in: .capsule)
                        .padding(6)
                }
            }
            .clipShape(.rect(cornerRadius: cornerRadius, style: .continuous))
            .contentShape(.rect(cornerRadius: cornerRadius, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isImage)
    }
}

/// A captured entry as a card: its emoji and line, the stamp, the captures as tiles (or the photos as the journal shows
/// them, for a single capture), in its rarity's frame. The instant view's saved state and the Moments screen.
struct CaptureCard: View {
    let record: HubRecord
    let words: Wording

    var body: some View {
        let entry = record.entry ?? JournalEntry()
        let media = record.mediaBlobs
        let photos = media.filter { $0.role == "photo" }
        let text = JournalText(entry: entry, media: media)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                EmojiBadge(emoji: entry.emoji, fallback: text.symbol, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(text.title)
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                    JournalStampText(time: record.time, words: words, full: true)
                }
                Spacer(minLength: 0)
            }
            if !text.excerpt.isEmpty {
                Text(text.excerpt)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(3)
            }
            if let tiles = CaptureTiles(photos: photos) {
                tiles
                let others = media.filter { $0.role != "photo" }
                if !others.isEmpty { MediaStrip(media: others, words: words, time: record.time) }
            } else if !media.isEmpty {
                MediaStrip(media: media, words: words, time: record.time)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: .rect(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .rarityFrame(for: record)
        .contentShape(.rect(cornerRadius: 22, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
