import FractonicaKit
import SwiftUI

/// One entry in the timeline, as a post: the emoji, the title (or the first line), the Fractonica stamp with the Earth
/// time, a Markdown excerpt, then its media — photos and video posters (with their length) and voice notes as pills
/// that play in place.
struct JournalCard: View {
    let record: HubRecord
    let words: Wording
    /// Search results stand alone: they show the whole date, not just the time within the day.
    var fullStamp = false

    var body: some View {
        let entry = record.entry ?? JournalEntry()
        let text = JournalText(entry: entry, media: record.mediaBlobs)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                EmojiBadge(emoji: entry.emoji, fallback: text.symbol, size: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(text.title)
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                    JournalStampText(time: record.time, words: words, full: fullStamp)
                }
                Spacer(minLength: 0)
                DeltaAgo(time: record.time, words: words)
            }
            if !text.excerpt.isEmpty {
                Text(text.excerpt)
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(5)
                    .fixedSize(horizontal: false, vertical: true)
            }
            let media = record.mediaBlobs
            if !media.isEmpty {
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

/// The right of a card's header: the Delta's phase at the entry's moment as its 3-stroke glyph (SPEC §5, 52 states),
/// and how long ago the entry was on the ladder ("3η 12ι ago"), measured on the device clock. The label redraws only
/// when its last part changes: once a Preon for entries a Helion or more ago, else once a Flavon.
struct DeltaAgo: View {
    let time: Double
    let words: Wording

    var body: some View {
        let notation = words.notation
        VStack(alignment: .trailing, spacing: 4) {
            if let glyph = notation.model.level(at: time, 3, strokes: 3)?.index {
                GlyphView(index: glyph, strokes: 3, color: Theme.levelColor(3))
                    .frame(height: 30)
                    .accessibilityLabel(Text("Delta phase"))
            }
            let age = Date.now.timeIntervalSince1970 - time
            let step = age >= 5.052 * 3600 ? 8.421 * 60 : 7.773
            TimelineView(.periodic(from: .now, by: step)) { context in
                let now = context.date.timeIntervalSince1970
                Text(verbatim: notation.countdown(time - now, at: now))
                    .font(.reading(11, weight: .medium))
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
    }
}

/// What an entry says about itself in a card: its title (the first line when it has none) and an excerpt of the rest,
/// or for an entry without text a word for its media ("Voice note", "3 photos").
struct JournalText {
    let title: String
    let excerpt: String
    let symbol: String

    init(entry: JournalEntry, media: [BlobRef]) {
        let plain = MarkdownBlock.plainText(entry.markdown, limit: 500)
        let photos = media.filter { $0.role == "photo" }.count
        let videos = media.filter { $0.role == "video" }.count
        let audios = media.filter { $0.role == "audio" }.count
        symbol = audios > 0 && photos + videos == 0 ? "waveform" : photos + videos > 0 ? "photo.on.rectangle.angled" : "text.alignleft"
        if let title = entry.title, !title.isEmpty {
            self.title = title
            excerpt = plain
        } else if let first = plain.split(separator: "\n", maxSplits: 1).first.map(String.init), !first.isEmpty {
            self.title = first
            excerpt = String(plain.dropFirst(first.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            var parts: [String] = []
            if audios > 0 { parts.append(audios == 1 ? "Voice note" : "\(audios) voice notes") }
            if photos > 0 { parts.append(photos == 1 ? "Photo" : "\(photos) photos") }
            if videos > 0 { parts.append(videos == 1 ? "Video" : "\(videos) videos") }
            title = parts.isEmpty ? "Untitled" : parts.joined(separator: ", ")
            excerpt = entry.transcript ?? ""
        }
    }
}

/// "34η 29ι · 14:23": the moment on the ladder, the Earth time beside it (pure mode: the ladder only). Full: "δ#3 ε#2
/// 34η 29ι · Oct 8 14:23".
struct JournalStampText: View {
    let time: Double
    let words: Wording
    var full = false

    var body: some View {
        HStack(spacing: 6) {
            Text(verbatim: fractonica)
                .font(.code(12, weight: .medium))
                .foregroundStyle(Theme.teal)
            if !words.pure {
                Text(verbatim: "·").foregroundStyle(Theme.ink3)
                Text(verbatim: full ? words.earth.short(time) : words.earth.time(time, seconds: false))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Theme.ink3)
            }
        }
        .lineLimit(1)
    }

    private var fractonica: String {
        let n = words.notation
        guard FractonicaClock.shared.inRange(time) else { return "—" }
        return full ? n.dateText(at: time, letters: true, upTo: "iota") : n.clockText(at: time, upTo: "iota")
    }
}

/// An entry's emoji in a soft disc, or a symbol for its content when it has none.
struct EmojiBadge: View {
    let emoji: String?
    var fallback = "text.alignleft"
    var size: CGFloat = 46

    var body: some View {
        ZStack {
            Circle().fill(Theme.panel3)
            Circle().stroke(Theme.line2.opacity(0.6), lineWidth: 1)
            if let emoji, !emoji.isEmpty {
                Text(verbatim: emoji).font(.system(size: size * 0.56))
            } else {
                Image(systemName: fallback)
                    .font(.system(size: size * 0.36, weight: .medium))
                    .foregroundStyle(Theme.teal)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// An entry's media in a card: photos and videos as tiles (one large, two halves, or three with "+N"), voice notes as
/// pills under them.
struct MediaStrip: View {
    let media: [BlobRef]
    let words: Wording
    let time: Double

    var body: some View {
        let visuals = media.filter { $0.role == "photo" || $0.role == "video" }
        let audios = media.filter { $0.role == "audio" }
        VStack(alignment: .leading, spacing: 8) {
            if !visuals.isEmpty {
                HStack(spacing: 6) {
                    ForEach(Array(visuals.prefix(3).enumerated()), id: \.element.hash) { i, blob in
                        MediaTile(blob: blob, words: words, time: time, more: i == 2 ? visuals.count - 3 : 0)
                            .frame(height: tileHeight(visuals.count, first: blob))
                    }
                }
            }
            ForEach(audios, id: \.hash) { blob in
                AudioPill(blob: blob, words: words, time: time)
            }
        }
    }

    private func tileHeight(_ count: Int, first: BlobRef) -> CGFloat {
        switch count {
        case 1: 200
        case 2: 150
        default: 112
        }
    }
}

/// A photo or a video's poster, filling its tile.
struct MediaTile: View {
    let blob: BlobRef
    let words: Wording
    let time: Double
    var more = 0
    var cornerRadius: CGFloat = 14

    var body: some View {
        Color.clear
            .frame(maxWidth: .infinity)
            .overlay { BlobImage(blob: blob, points: 260) }
            .overlay {
                if blob.role == "video" {
                    Image(systemName: "play.fill")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 38, height: 38)
                        .background(.black.opacity(0.35), in: .circle)
                        .overlay(Circle().stroke(.white.opacity(0.5), lineWidth: 1))
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if blob.role == "video", let d = blob.duration {
                    Text(verbatim: mediaDuration(d, words: words, at: time))
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(.black.opacity(0.5), in: .capsule)
                        .padding(6)
                }
            }
            .overlay {
                if more > 0 {
                    ZStack {
                        Color.black.opacity(0.45)
                        Text(verbatim: "+\(more)").font(.title3.weight(.semibold)).foregroundStyle(.white)
                    }
                }
            }
            .clipShape(.rect(cornerRadius: cornerRadius, style: .continuous))
            .accessibilityLabel(blob.role == "video" ? "Video" : "Photo")
    }
}

/// A voice note: play / pause, its waveform filling as it plays, its length.
struct AudioPill: View {
    let blob: BlobRef
    let words: Wording
    let time: Double

    @State private var player = JournalAudioPlayer.shared
    @State private var peaks: [Float] = []

    var body: some View {
        // a waveform already read draws at once; the task reads it only the first time
        let shown = peaks.isEmpty ? AudioWaveform.cached(blob.hash, count: 40) ?? [] : peaks
        let current = player.isCurrent(blob.hash)
        let playing = current && player.isPlaying
        HStack(spacing: 10) {
            Button {
                player.toggle(blob.hash)
            } label: {
                Image(systemName: playing ? "pause.fill" : "play.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Theme.background)
                    .frame(width: 30, height: 30)
                    .background(Theme.teal, in: .circle)
                    .contentShape(.circle)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(playing ? "Pause voice note" : "Play voice note")
            TimelineView(.animation(minimumInterval: 1 / 45, paused: !playing)) { _ in
                WaveformBars(peaks: shown, progress: current && player.duration > 0 ? player.currentTime / player.duration : 0)
            }
            .frame(height: 24)
            Text(verbatim: mediaDuration(blob.duration, words: words, at: time))
                .font(.reading(13, weight: .medium))
                .foregroundStyle(Theme.ink2)
        }
        .padding(.leading, 6)
        .padding(.trailing, 12)
        .padding(.vertical, 6)
        .background(Theme.panel2, in: .capsule)
        .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
        .task(id: blob.hash) {
            guard AudioWaveform.cached(blob.hash, count: 40) == nil else { return }
            peaks = await AudioWaveform.peaks(blob.hash, count: 40)
        }
    }
}

/// A record from another source (a sensor, a computer logger …) as a compact row: its emoji or a tray, its title or
/// kind, its text and its values.
struct GenericRecordRow: View {
    let record: HubRecord
    let words: Wording

    var body: some View {
        let g = record.generic
        HStack(alignment: .top, spacing: 12) {
            EmojiBadge(emoji: g.emoji, fallback: "tray", size: 34)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(g.title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(1)
                    Spacer(minLength: 6)
                    JournalStampText(time: record.time, words: words)
                }
                if let text = g.text {
                    Text(text).font(.footnote).foregroundStyle(Theme.ink2).lineLimit(2)
                }
                if !g.facts.isEmpty {
                    Text(verbatim: g.facts).font(.code(12)).foregroundStyle(Theme.ink3).lineLimit(2)
                }
                if g.title != record.kind {
                    Text(verbatim: record.kind).font(.caption2).foregroundStyle(Theme.ink3)
                }
            }
        }
        .padding(12)
        .background(Theme.panel.opacity(0.55), in: .rect(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line.opacity(0.8), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
