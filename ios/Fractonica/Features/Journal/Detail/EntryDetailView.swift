import AVKit
import FractonicaKit
import SwiftUI

/// A record pushed from the timeline: a journal entry in full, or a record of another kind.
struct JournalRecordView: View {
    let id: String

    @State private var store = JournalStore.shared

    var body: some View {
        if let record = store.record(id) {
            if record.kind == JournalEntry.kind {
                EntryDetailView(record: record)
            } else {
                GenericRecordDetail(record: record)
            }
        } else {
            ContentUnavailableView("Entry deleted", systemImage: "trash", description: Text("This entry is no longer in the journal."))
                .background { Backdrop() }
        }
    }
}

/// An entry in full: its emoji and title, the moment (Fractonica and Earth), the photos and videos (tap for the full
/// screen gallery, with zoom and the video player), the voice notes with a scrubber and speeds, and the Markdown
/// rendered. Edit and delete in the toolbar.
struct EntryDetailView: View {
    let record: HubRecord

    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var ui = JournalUI.shared
    @State private var gallery: GalleryStart?
    @State private var confirmDelete = false
    @State private var launched = false

    var body: some View {
        let words = settings.wording
        let entry = record.entry ?? JournalEntry()
        let media = record.mediaBlobs
        // several captures of a moment (back@-1, front@-1 …) show capture by capture, and the gallery runs in that order
        let captures = MomentCaptureGroup<BlobRef>.grouped(media.filter { $0.role == "photo" }, name: \.name)
        let others = media.filter { $0.role == "video" || ($0.role == "photo" && captures == nil) }
        let visuals = (captures?.flatMap { $0.items.map(\.item) } ?? []) + others
        let audios = media.filter { $0.role == "audio" }
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header(entry, words).momentHeader(for: record)
                SkyTagChips(record: record, words: words)
                if let captures {
                    DetailCaptures(groups: captures, words: words, time: record.time) { index in
                        gallery = GalleryStart(index: index)
                    }
                }
                if !others.isEmpty {
                    DetailGallery(visuals: others, words: words, time: record.time) { index in
                        gallery = GalleryStart(index: visuals.count - others.count + index)
                    }
                }
                ForEach(audios, id: \.hash) { blob in
                    AudioPlayerCard(blob: blob, words: words, time: record.time)
                }
                if !entry.markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    MarkdownView(entry.markdown, bodyFont: .body)
                }
                if let transcript = entry.transcript, !transcript.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Transcript", systemImage: "text.quote")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.ink3)
                        Text(transcript).font(.callout).foregroundStyle(Theme.ink2).textSelection(.enabled)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background { Backdrop() }
        // a plain title: the Pentad by name ("Pentad II · 34η 29ι")
        .navigationTitle(FractonicaClock.shared.inRange(record.time) ? words.led(words.notation.clockText(at: record.time, upTo: "iota"), at: record.time) : "Entry")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit", systemImage: "pencil") { ui.edit(record.id) }
                    .help("Edit this entry")
            }
            ToolbarItem(placement: .secondaryAction) {
                Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
                    .help("Delete this entry")
            }
        }
        .confirmationDialog("Delete this entry?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete Entry", role: .destructive) {
                JournalStore.shared.delete(record.id)
                Haptics.play(.warning)
                dismiss()
            }
        } message: {
            Text("Its photos, videos and voice notes are deleted with it.")
        }
        #if os(iOS)
        .fullScreenCover(item: $gallery) { start in
            MediaGallery(visuals: visuals, start: start.index, words: words, time: record.time)
        }
        #else
        .sheet(item: $gallery) { start in
            MediaGallery(visuals: visuals, start: start.index, words: words, time: record.time)
                .frame(minWidth: 820, minHeight: 620)
        }
        #endif
        .onAppear {
            if !launched, JournalLaunch.flag("FXJournalGallery"), !visuals.isEmpty { gallery = GalleryStart(index: 0) }
            launched = true
        }
    }

    private func header(_ entry: JournalEntry, _ words: Wording) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let emoji = entry.emoji, !emoji.isEmpty {
                Text(verbatim: emoji)
                    .font(.system(size: 64))
                    .accessibilityHidden(true)
            }
            if let title = entry.title, !title.isEmpty {
                Text(title)
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Theme.ink)
                    .textSelection(.enabled)
            }
            VStack(alignment: .leading, spacing: 4) {
                if FractonicaClock.shared.inRange(record.time) {
                    // led by its Pentad, as a date by its weekday: "Pentad II · Delta Trifracton Node ε#2 5η 5ι" (the
                    // stamp under it does not carry it, SPEC §15.3)
                    Text(verbatim: words.led(words.notation.dateText(at: record.time, upTo: "iota"), at: record.time))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink2)
                    Text(verbatim: words.notation.stamp(at: record.time, upTo: "lambda"))
                        .font(.code(13, weight: .medium))
                        .foregroundStyle(Theme.teal)
                }
                if !words.pure {
                    Text(verbatim: earthMoment(record.time, words: words) + zoneSuffix(words))
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                }
            }
        }
    }

    /// " · Kyiv" when the entry was written in another zone than the one the app shows.
    private func zoneSuffix(_ words: Wording) -> String {
        guard let zone = record.zone, zone != (settings.zone ?? TimeZone.current.identifier) else { return "" }
        return " · written in " + (zone.split(separator: "/").last.map { $0.replacingOccurrences(of: "_", with: " ") } ?? zone)
    }
}

private struct GalleryStart: Identifiable {
    let index: Int
    var id: Int { index }
}

/// A moment's several captures, one row each: what it was ("1λ before", "At the moment" …), then its photos side by side
/// (back, front). A tap opens the gallery on that photo (indices run capture by capture).
private struct DetailCaptures: View {
    let groups: [MomentCaptureGroup<BlobRef>]
    let words: Wording
    let time: Double
    let open: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(groups.enumerated()), id: \.element.offset) { g, group in
                let start = groups.prefix(g).reduce(0) { $0 + $1.items.count }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(verbatim: MomentCaptures.offsetTag(group.offset))
                            .font(.reading(12, weight: .bold))
                            .foregroundStyle(group.offset == 0 ? Theme.teal : Theme.ink2)
                        Text(verbatim: MomentCaptures.offsetLabel(group.offset))
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Theme.ink3)
                    }
                    HStack(spacing: 6) {
                        ForEach(Array(group.items.enumerated()), id: \.element.item.hash) { i, item in
                            Button { open(start + i) } label: {
                                MediaTile(blob: item.item, words: words, time: time, cornerRadius: 16)
                                    .aspectRatio(3 / 4, contentMode: .fit)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(item.camera.capitalized) camera, \(MomentCaptures.offsetLabel(group.offset).lowercased())")
                        }
                    }
                }
            }
        }
    }
}

/// The detail's photos and videos: one large, or a grid.
private struct DetailGallery: View {
    let visuals: [BlobRef]
    let words: Wording
    let time: Double
    let open: (Int) -> Void

    var body: some View {
        if visuals.count == 1, let blob = visuals.first {
            Button { open(0) } label: {
                MediaTile(blob: blob, words: words, time: time, cornerRadius: 20)
                    .aspectRatio(aspect(blob), contentMode: .fit)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
        } else {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 6), GridItem(.flexible(), spacing: 6)], spacing: 6) {
                ForEach(Array(visuals.enumerated()), id: \.element.hash) { i, blob in
                    Button { open(i) } label: {
                        MediaTile(blob: blob, words: words, time: time, cornerRadius: 16)
                            .aspectRatio(1, contentMode: .fit)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func aspect(_ blob: BlobRef) -> CGFloat {
        guard let w = blob.width, let h = blob.height, w > 0, h > 0 else { return 4 / 3 }
        return min(2, max(0.75, CGFloat(w) / CGFloat(h)))
    }
}

// MARK: - Audio

/// A voice note in the detail: play / pause, a waveform to scrub, ±15 s and the speed.
struct AudioPlayerCard: View {
    let blob: BlobRef
    let words: Wording
    let time: Double

    @State private var player = JournalAudioPlayer.shared
    @State private var peaks: [Float] = []
    @State private var scrub: Double?

    var body: some View {
        let current = player.isCurrent(blob.hash)
        let playing = current && player.isPlaying
        let duration = current && player.duration > 0 ? player.duration : (blob.duration ?? 0)
        VStack(spacing: 12) {
            HStack(spacing: 14) {
                Button { player.toggle(blob.hash) } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(Theme.background)
                        .frame(width: 52, height: 52)
                        .background(Theme.teal, in: .circle)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(playing ? "Pause" : "Play voice note")
                TimelineView(.animation(minimumInterval: 1 / 45, paused: !playing)) { _ in
                    let position = scrub ?? (current ? player.currentTime : 0)
                    VStack(spacing: 6) {
                        GeometryReader { geo in
                            WaveformBars(peaks: peaks, progress: duration > 0 ? position / duration : 0)
                                .contentShape(.rect)
                                .gesture(DragGesture(minimumDistance: 0)
                                    .onChanged { value in
                                        scrub = max(0, min(1, value.location.x / geo.size.width)) * duration
                                    }
                                    .onEnded { _ in
                                        if let scrub {
                                            if !current { player.play(blob.hash, at: scrub); player.pause() }
                                            player.seek(to: scrub)
                                        }
                                        scrub = nil
                                    })
                        }
                        .frame(height: 40)
                        HStack {
                            Text(verbatim: mediaDuration(position, words: words, at: time))
                            Spacer()
                            Text(verbatim: mediaDuration(duration, words: words, at: time))
                        }
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                    }
                }
            }
            HStack(spacing: 18) {
                Button { player.skip(-15) } label: { Image(systemName: "gobackward.15") }
                    .disabled(!current)
                    .accessibilityLabel("Back 15 seconds")
                Button { player.skip(15) } label: { Image(systemName: "goforward.15") }
                    .disabled(!current)
                    .accessibilityLabel("Forward 15 seconds")
                Spacer()
                Menu {
                    Picker("Speed", selection: $player.rate) {
                        ForEach([0.75, 1, 1.25, 1.5, 2] as [Float], id: \.self) { rate in
                            Text(verbatim: Self.rateText(rate)).tag(rate)
                        }
                    }
                } label: {
                    Text(verbatim: Self.rateText(player.rate))
                        .font(.footnote.weight(.semibold).monospacedDigit())
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Theme.panel3, in: .capsule)
                }
                .menuIndicator(.hidden)
                .fixedSize()
                .accessibilityLabel("Playback speed")
            }
            .font(.system(size: 18))
            .buttonStyle(.plain)
            .foregroundStyle(Theme.ink2)
        }
        .padding(16)
        .background(Theme.panel, in: .rect(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .task(id: "\(blob.hash)#\(peaks.isEmpty ? JournalStore.shared.blobArrivals : 0)") {
            peaks = await AudioWaveform.peaks(blob.hash, count: 64)
        }
    }

    static func rateText(_ rate: Float) -> String {
        rate == rate.rounded() ? "\(Int(rate))×" : "\(rate)×"
    }
}

// MARK: - Other kinds

/// A record from another source in full: what the generic row shows, every value of its data and its attachments.
struct GenericRecordDetail: View {
    let record: HubRecord

    @Environment(AppSettings.self) private var settings

    var body: some View {
        let words = settings.wording
        let g = record.generic
        List {
            Section {
                HStack(spacing: 14) {
                    EmojiBadge(emoji: g.emoji, fallback: "tray", size: 52)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(g.title).font(.title3.weight(.semibold))
                        JournalStampText(time: record.time, words: words, full: true)
                    }
                }
                .listRowBackground(Color.clear)
                if let text = g.text { Text(text).foregroundStyle(Theme.ink2) }
            }
            Section("Data") {
                ForEach((record.data.object ?? [:]).sorted { $0.key < $1.key }, id: \.key) { key, value in
                    LabeledContent(key) { Text(verbatim: Self.describe(value)).font(.code(13)).foregroundStyle(Theme.ink2) }
                }
                LabeledContent("Kind") { Text(verbatim: record.kind).font(.code(13)) }
                if let source = record.source { LabeledContent("Source") { Text(verbatim: source).font(.code(13)) } }
            }
            if let blobs = record.blobs, !blobs.isEmpty {
                Section("Attachments") {
                    ForEach(blobs, id: \.hash) { blob in
                        LabeledContent(blob.name ?? blob.role) {
                            Text(verbatim: "\(blob.type) · \(byteCount(Int64(blob.size)))").font(.footnote).foregroundStyle(Theme.ink3)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle(g.title)
    }

    static func describe(_ value: JSONValue) -> String {
        switch value {
        case .null: "null"
        case .bool(let b): b ? "true" : "false"
        case .number(let n): GenericRecordSummary.number(n)
        case .string(let s): s
        case .array(let a): "[" + a.map(describe).joined(separator: ", ") + "]"
        case .object(let o): "{" + o.sorted { $0.key < $1.key }.map { "\($0.key): \(describe($0.value))" }.joined(separator: ", ") + "}"
        }
    }
}
