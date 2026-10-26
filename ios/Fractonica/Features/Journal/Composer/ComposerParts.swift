import FractonicaKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

// MARK: - The bar

/// The composer's glass bar at the foot: Photos, Camera (where there is one), Voice, Files (Mac), and the formatting
/// toggle; the formatting buttons ride above it while the text is being edited.
struct ComposerBar: View {
    let model: ComposerModel
    @Binding var pickerItems: [PhotosPickerItem]
    let showFormatting: Bool
    let preview: Bool
    let onFormat: (MarkdownAction) -> Void
    let onCamera: () -> Void
    let onFiles: () -> Void
    let onToggleFormatting: () -> Void

    @Namespace private var glass

    var body: some View {
        GlassContainer(spacing: 10) {
            VStack(spacing: 10) {
                if showFormatting && !preview {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 2) {
                            ForEach(MarkdownAction.allCases) { action in
                                Button { onFormat(action) } label: {
                                    Image(systemName: action.systemImage)
                                        .font(.system(size: 16, weight: .medium))
                                        .frame(width: 40, height: 40)
                                        .contentShape(.rect)
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(Theme.ink)
                                .accessibilityLabel(action.title)
                                .help(action.title)
                            }
                        }
                        .padding(.horizontal, 6)
                    }
                    .frame(height: 44)
                    .fixedSize(horizontal: false, vertical: true)
                    .glassSurface(.regular.interactive(), in: .capsule)
                    .glassID("format", in: glass)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                HStack(spacing: 4) {
                    // .current: the library's own file, not one Photos converts first for compatibility (slow for
                    // videos); the journal converts it itself, per Settings › Journal
                    PhotosPicker(selection: $pickerItems, matching: .any(of: [.images, .videos]), preferredItemEncoding: .current, photoLibrary: .shared()) {
                        Image(systemName: "photo.on.rectangle.angled")
                            .font(.system(size: 19, weight: .regular))
                            .foregroundStyle(Theme.ink)
                            .frame(width: 46, height: 44)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Photos and videos")
                    .help("Add photos and videos from the library")
                    if CameraCapture.isAvailable {
                        Button(action: onCamera) { barIcon("camera") }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Camera")
                            .help("Take a photo or a video")
                    }
                    Button {
                        if model.recorder.isActive { model.finishRecording() } else { model.startRecording() }
                    } label: {
                        barIcon(model.recorder.isActive ? "stop.fill" : "mic", tint: model.recorder.isActive ? Theme.danger : nil)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(model.recorder.isActive ? "Stop recording" : "Record a voice note")
                    .help("Record a voice note")
                    #if os(macOS)
                    Button(action: onFiles) { barIcon("folder") }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Files")
                        .help("Add images, videos or audio from files")
                    #endif
                    Spacer(minLength: 8)
                    Button(action: onToggleFormatting) {
                        barIcon("textformat", tint: showFormatting ? Theme.teal : nil)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Formatting")
                    .disabled(preview)
                }
                .padding(.horizontal, 8)
                .frame(height: 52)
                .glassSurface(.regular.interactive(), in: .capsule)
                .glassID("bar", in: glass)
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .padding(.top, 4)
            .animation(.snappy, value: showFormatting && !preview)
        }
    }

    private func barIcon(_ name: String, tint: Color? = nil) -> some View {
        Image(systemName: name)
            .font(.system(size: 19, weight: .regular))
            .foregroundStyle(tint ?? Theme.ink)
            .frame(width: 46, height: 44)
            .contentShape(.rect)
    }
}

// MARK: - Attachments

/// The entry's media in the composer: photo and video tiles (drag to reorder, hold for more), voice notes as pills,
/// each with a remove button; media on their way in as tiles (or pills) with a ring and a cancel button.
struct ComposerAttachments: View {
    let model: ComposerModel
    let words: Wording

    var body: some View {
        let media = model.media
        let visuals = media.filter { $0.role == "photo" || $0.role == "video" }
        let audios = media.filter { $0.role == "audio" }
        let pendingVisuals = model.pending.filter { $0.role != "audio" }
        let pendingAudios = model.pending.filter { $0.role == "audio" }
        VStack(alignment: .leading, spacing: 10) {
            if !visuals.isEmpty || !pendingVisuals.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(visuals, id: \.hash) { blob in
                            MediaTile(blob: blob, words: words, time: model.draft.time, cornerRadius: 16)
                                .frame(width: 108, height: 108)
                                .overlay(alignment: .topTrailing) { removeButton(blob) }
                                .draggable(blob.hash) {
                                    MediaTile(blob: blob, words: words, time: model.draft.time).frame(width: 80, height: 80)
                                }
                                .dropDestination(for: String.self) { hashes, _ in
                                    guard let hash = hashes.first else { return false }
                                    model.move(hash, to: blob.hash)
                                    return true
                                }
                                .contextMenu { arrangeMenu(blob, in: visuals) }
                        }
                        ForEach(pendingVisuals) { item in
                            PendingTile(item: item)
                                .frame(width: 108, height: 108)
                                .overlay(alignment: .topTrailing) { cancelButton(item) }
                                .transition(.scale(scale: 0.85).combined(with: .opacity))
                        }
                    }
                    .padding(.vertical, 6)
                    .padding(.trailing, 6)
                }
                .scrollClipDisabled()
            }
            ForEach(audios, id: \.hash) { blob in
                HStack(spacing: 8) {
                    AudioPill(blob: blob, words: words, time: model.draft.time)
                    Button { model.remove(blob) } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(Theme.ink3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove voice note")
                }
                .contextMenu { arrangeMenu(blob, in: audios) }
            }
            ForEach(pendingAudios) { item in
                HStack(spacing: 8) {
                    PendingPill(item: item)
                    Button { model.cancel(item.id) } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title3)
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(Theme.ink3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Cancel adding \(item.kindTitle.lowercased())")
                }
            }
        }
    }

    private func cancelButton(_ item: PendingMedia) -> some View {
        Button { model.cancel(item.id) } label: {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(.black.opacity(0.55), in: .circle)
                .overlay(Circle().stroke(.white.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(5)
        .accessibilityLabel("Cancel adding \(item.kindTitle.lowercased())")
    }

    private func removeButton(_ blob: BlobRef) -> some View {
        Button { model.remove(blob) } label: {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(.black.opacity(0.55), in: .circle)
                .overlay(Circle().stroke(.white.opacity(0.4), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .padding(5)
        .accessibilityLabel(blob.role == "video" ? "Remove video" : "Remove photo")
    }

    @ViewBuilder
    private func arrangeMenu(_ blob: BlobRef, in list: [BlobRef]) -> some View {
        let i = list.firstIndex { $0.hash == blob.hash } ?? 0
        if i > 0 {
            Button("Move Earlier", systemImage: "arrow.left") { model.move(blob, by: -1) }
        }
        if i < list.count - 1 {
            Button("Move Later", systemImage: "arrow.right") { model.move(blob, by: 1) }
        }
        Button("Remove", systemImage: "trash", role: .destructive) { model.remove(blob) }
    }
}

// MARK: - Media on their way in

/// A photo or video on its way in: its picture (dimmed) once there is one, else its kind, and a ring that fills as it
/// arrives, is converted and stored, with what it is doing under it.
struct PendingTile: View {
    let item: PendingMedia

    var body: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(Theme.panel2)
            .overlay {
                if let preview = item.preview {
                    Image(decorative: preview, scale: 1)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .overlay(Color.black.opacity(0.45))
                }
            }
            .overlay {
                VStack(spacing: 7) {
                    ProgressRing(fraction: item.fraction, systemImage: item.systemImage)
                        .frame(width: 40, height: 40)
                    Text(item.stageTitle)
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(item.preview == nil ? Theme.ink3 : .white.opacity(0.85))
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .clipShape(.rect(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(item.kindTitle), \(item.stageTitle.lowercased())")
            .accessibilityValue(Text(verbatim: "\(Int((item.fraction * 100).rounded())) %"))
    }
}

/// A voice note or an audio file on its way in, as a pill like the ones it becomes.
struct PendingPill: View {
    let item: PendingMedia

    var body: some View {
        HStack(spacing: 10) {
            ProgressRing(fraction: item.fraction, systemImage: item.systemImage)
                .frame(width: 30, height: 30)
            Text(item.name ?? item.kindTitle)
                .font(.subheadline)
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
            Spacer(minLength: 8)
            Text(item.stageTitle)
                .font(.caption)
                .foregroundStyle(Theme.ink3)
        }
        .padding(.leading, 6)
        .padding(.trailing, 12)
        .padding(.vertical, 6)
        .background(Theme.panel2, in: .capsule)
        .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(item.kindTitle), \(item.stageTitle.lowercased())")
    }
}

/// A determinate ring around a kind's symbol.
struct ProgressRing: View {
    let fraction: Double
    let systemImage: String

    var body: some View {
        ZStack {
            Circle().fill(Theme.background.opacity(0.55))
            Circle().stroke(Theme.ink3.opacity(0.35), lineWidth: 3.5)
            Circle()
                .trim(from: 0, to: max(0.02, fraction))
                .stroke(Theme.teal, style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.15), value: fraction)
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.ink)
        }
    }
}

/// Save was asked for while media are still coming: it happens when they are in (or stop waiting).
struct SaveWaitBanner: View {
    let count: Int
    let onStop: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            ProgressView().controlSize(.small)
            Text(count == 1 ? "Saving when the attachment is in" : "Saving when \(count) attachments are in")
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.ink)
            Spacer(minLength: 8)
            Button("Don’t Wait", action: onStop)
                .font(.footnote.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(Theme.teal)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .glassSurface(in: .capsule)
        .padding(.horizontal, 16)
        .padding(.top, 4)
    }
}

// MARK: - Recorder

/// The inline voice recorder: level meter, elapsed time, pause / resume, done, throw away.
struct RecorderCard: View {
    let recorder: VoiceRecorder
    let onStop: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 14) {
            switch recorder.state {
            case .denied:
                notice("Fractonica can’t hear you", "Allow the microphone for Fractonica in Settings › Privacy & Security, then try again.")
            case .failed(let message):
                notice("Recording stopped", message)
            default:
                live
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(Theme.panel2, in: .rect(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(recorder.state == .recording ? Theme.danger.opacity(0.45) : Theme.line, lineWidth: 1))
    }

    @ViewBuilder
    private var live: some View {
        let recording = recorder.state == .recording
        HStack {
            HStack(spacing: 8) {
                Circle()
                    .fill(recording ? Theme.danger : Theme.ink3)
                    .frame(width: 9, height: 9)
                    .opacity(recording ? 1 : 0.6)
                Text(recording ? "Recording" : "Paused")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(recording ? Theme.ink : Theme.ink2)
            }
            Spacer()
            TimelineView(.periodic(from: .now, by: 0.1)) { _ in
                Text(verbatim: Self.elapsed(recorder.elapsed))
                    .font(.reading(20, weight: .medium))
                    .foregroundStyle(Theme.ink)
            }
        }
        LevelMeter(levels: recorder.levels, active: recording)
            .frame(height: 54)
        HStack(spacing: 22) {
            Button(action: onCancel) {
                Image(systemName: "trash")
                    .font(.system(size: 18, weight: .medium))
                    .frame(width: 48, height: 48)
            }
            .glassButtonStyle()
            .buttonBorderShape(.circle)
            .accessibilityLabel("Discard recording")
            Button {
                if recording { recorder.pause() } else { recorder.resume() }
            } label: {
                Image(systemName: recording ? "pause.fill" : "record.circle")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(recording ? Theme.ink : Theme.danger)
                    .frame(width: 60, height: 60)
            }
            .glassButtonStyle()
            .buttonBorderShape(.circle)
            .accessibilityLabel(recording ? "Pause" : "Resume")
            Button(action: onStop) {
                Image(systemName: "checkmark")
                    .font(.system(size: 18, weight: .bold))
                    .frame(width: 48, height: 48)
            }
            .glassProminentButtonStyle()
            .buttonBorderShape(.circle)
            .tint(Theme.teal)
            .accessibilityLabel("Done: add the voice note")
        }
    }

    private func notice(_ title: String, _ message: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: "mic.slash").font(.title2).foregroundStyle(Theme.danger)
            Text(title).font(.headline)
            Text(message).font(.footnote).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
            Button("OK", action: onCancel).glassButtonStyle().padding(.top, 4)
        }
    }

    /// "0:07.4", "12:03.0": a recording's length on the device clock.
    static func elapsed(_ s: Double) -> String {
        let tenths = Int((s * 10).rounded(.down))
        return String(format: "%d:%02d.%d", tenths / 600, tenths / 10 % 60, tenths % 10)
    }
}

/// Mirrored bars of the recent input levels, newest on the right.
struct LevelMeter: View {
    let levels: [Float]
    var active = true

    var body: some View {
        Canvas { context, size in
            let n = levels.count
            guard n > 0 else { return }
            let step = size.width / CGFloat(n)
            let bar = max(2, step * 0.5)
            for (i, level) in levels.enumerated() {
                let h = max(3, CGFloat(level) * size.height)
                let rect = CGRect(x: CGFloat(i) * step + (step - bar) / 2, y: (size.height - h) / 2, width: bar, height: h)
                let fade = 0.35 + 0.65 * Double(i) / Double(n)
                context.fill(Path(roundedRect: rect, cornerRadius: bar / 2), with: .color((active ? Theme.danger : Theme.ink3).opacity(fade)))
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Moment

/// The entry's moment: the Fractonica stamp live over an Earth date and time picker (in the chosen zone); in pure
/// mode steps along the ladder instead of a Gregorian calendar. Attachments that know when they were captured are
/// offered as one-tap choices above it ("Photo · taken 14:35").
struct MomentEditor: View {
    let time: Double
    var options: [MediaCapture.Option] = []
    var blobs: [BlobRef] = []
    let onChange: (Double) -> Void

    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var t: Double = 0

    var body: some View {
        let words = settings.wording
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(verbatim: words.notation.dateText(at: t, upTo: "iota"))
                            .font(.headline)
                            .foregroundStyle(Theme.ink)
                        Text(verbatim: words.notation.stamp(at: t, upTo: "lambda"))
                            .font(.code(14, weight: .medium))
                            .foregroundStyle(Theme.teal)
                            .contentTransition(.numericText())
                        if !words.pure {
                            Text(verbatim: earthMoment(t, words: words))
                                .font(.subheadline)
                                .foregroundStyle(Theme.ink2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Theme.panel, in: .rect(cornerRadius: 16, style: .continuous))
                    if !options.isEmpty {
                        mediaChoices(words)
                    }
                    if words.pure {
                        pureSteps(words)
                    } else {
                        DatePicker("Moment", selection: dateBinding, in: range, displayedComponents: [.date, .hourAndMinute])
                            .datePickerStyle(.graphical)
                            .environment(\.timeZone, settings.timeZone)
                            .labelsHidden()
                    }
                }
                .padding(16)
            }
            .background { Backdrop() }
            .navigationTitle("Moment")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Now") { t = Date().timeIntervalSince1970 }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark", role: .confirmIfAvailable) {
                        onChange(t)
                        dismiss()
                    }
                }
            }
        }
        .onAppear { t = time }
    }

    /// "From the attachments": one row per capture moment; the chosen one is ticked.
    private func mediaChoices(_ words: Wording) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("From the attachments")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.ink3)
                .padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                    if index > 0 { Divider().overlay(Theme.line).padding(.leading, 58) }
                    let chosen = abs(option.time - t) < 0.5
                    Button {
                        withAnimation(.snappy) { t = option.time }
                        Haptics.play(.selection)
                    } label: {
                        HStack(spacing: 12) {
                            thumbnail(option)
                                .frame(width: 34, height: 34)
                                .clipShape(.rect(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: "\(option.kind.title) · \(option.kind.verb) \(Self.when(option.time, words: words))")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(Theme.ink)
                                Text(verbatim: words.notation.stamp(at: option.time, upTo: "iota"))
                                    .font(.code(12))
                                    .foregroundStyle(Theme.teal)
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.8)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "checkmark")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Theme.teal)
                                .opacity(chosen ? 1 : 0)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                    .accessibilityHint("Uses this moment for the entry")
                }
            }
            .background(Theme.panel, in: .rect(cornerRadius: 16, style: .continuous))
        }
    }

    @ViewBuilder
    private func thumbnail(_ option: MediaCapture.Option) -> some View {
        if let blob = blobs.first(where: { $0.hash == option.id }), blob.role == "photo" || blob.role == "video" {
            BlobImage(blob: blob, points: 34)
        } else {
            Image(systemName: option.kind.systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.teal)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Theme.panel2, in: .rect(cornerRadius: 8, style: .continuous))
        }
    }

    /// "14:35" today, "Oct 8 14:35" another day (the year when it differs); pure: the clock within the same Nuclide,
    /// else the short letter date.
    static func when(_ t: Double, words: Wording) -> String {
        let now = Date().timeIntervalSince1970
        if words.pure { return words.label(t, relativeTo: now) }
        let earth = words.earth
        let (a, b) = (earth.parts(t), earth.parts(now))
        if a.year == b.year && a.month == b.month && a.day == b.day { return earth.time(t, seconds: false) }
        return words.short(t, refYear: b.year)
    }

    private var range: ClosedRange<Date> {
        let clock = FractonicaClock.shared
        return Date(timeIntervalSince1970: clock.tMin)...Date(timeIntervalSince1970: clock.tMax)
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { Date(timeIntervalSince1970: t) }, set: { t = $0.timeIntervalSince1970 })
    }

    private func pureSteps(_ words: Wording) -> some View {
        VStack(spacing: 10) {
            ForEach(["epsilon", "eta", "iota", "lambda"], id: \.self) { id in
                if let unit = Notation.unit(id) {
                    HStack {
                        Text(verbatim: "\(unit.sym)  \(unit.name)")
                            .font(.body.weight(.medium))
                        Spacer()
                        Button { step(unit, -1) } label: { Image(systemName: "minus").frame(width: 30, height: 24) }
                            .glassButtonStyle()
                            .accessibilityLabel("One \(unit.name) earlier")
                        Button { step(unit, 1) } label: { Image(systemName: "plus").frame(width: 30, height: 24) }
                            .glassButtonStyle()
                            .accessibilityLabel("One \(unit.name) later")
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Theme.panel, in: .rect(cornerRadius: 14, style: .continuous))
                }
            }
        }
    }

    private func step(_ unit: FUnit, _ direction: Double) {
        let next = FractonicaClock.shared.clamp(t + direction * settings.wording.notation.unitSeconds(unit))
        withAnimation(.snappy) { t = next }
        Haptics.play(.selection)
    }
}
