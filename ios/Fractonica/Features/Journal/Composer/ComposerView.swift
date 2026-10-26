import FractonicaKit
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// The composer in its sheet (iPhone, iPad, Mac): sized like a page on the larger screens.
struct ComposerSheet: View {
    let request: ComposerRequest

    var body: some View {
        NavigationStack {
            ComposerView(request: request)
        }
        #if os(macOS)
        .frame(minWidth: 620, idealWidth: 700, minHeight: 640, idealHeight: 760)
        #else
        .presentationDetents([.large])
        .presentationBackground(Theme.background)
        #endif
    }
}

/// A new entry or an edit: the emoji header (tap to choose), the moment (defaults to now, any moment can be chosen),
/// an optional title, the Markdown body with a formatting bar and a Write / Preview switch, and the media — photos and
/// videos from the library, the camera, voice notes recorded inline, files and drag and drop on the Mac. Everything
/// autosaves as a draft; Save writes the record.
struct ComposerView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    @State private var model: ComposerModel
    @State private var preview = JournalLaunch.flag("FXJournalPreview")
    @State private var selection: TextSelection?
    @State private var showEmoji = JournalLaunch.flag("FXJournalEmoji")
    @State private var showMoment = JournalLaunch.flag("FXJournalMoment")
    @State private var showCamera = false
    @State private var showFiles = false
    @State private var showFormatting = false
    @State private var confirmCancel = false
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var dropTargeted = false
    @FocusState private var focus: Field?

    private enum Field: Hashable { case title, body }

    init(request: ComposerRequest) {
        _model = State(initialValue: ComposerModel(request: request))
    }

    var body: some View {
        let words = settings.wording
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header(words)
                TextField("Title", text: $model.draft.title, axis: .vertical)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(Theme.ink)
                    .focused($focus, equals: .title)
                    .submitLabel(.next)
                    .onSubmit { focus = .body }
                    .textFieldStyle(.plain)
                bodyEditor
                if model.recorder.isActive || model.recorder.state != .idle {
                    RecorderCard(recorder: model.recorder, onStop: model.finishRecording, onCancel: model.recorder.cancel)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
                if !model.media.isEmpty || model.processing > 0 {
                    ComposerAttachments(model: model, words: words)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .animation(.snappy, value: model.recorder.isActive)
        }
        .scrollDismissesKeyboard(.interactively)
        .background { Backdrop() }
        .overlay {
            if dropTargeted {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(Theme.teal, style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
                    .background(Theme.teal.opacity(0.06), in: .rect(cornerRadius: 24, style: .continuous))
                    .padding(10)
                    .overlay { Label("Drop to attach", systemImage: "plus.circle.fill").font(.headline).foregroundStyle(Theme.teal) }
                    .allowsHitTesting(false)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ComposerBar(
                model: model,
                pickerItems: $pickerItems,
                showFormatting: showFormatting || focus == .body,
                preview: preview,
                onFormat: apply,
                onCamera: { showCamera = true },
                onFiles: { showFiles = true },
                onToggleFormatting: { showFormatting.toggle() }
            )
        }
        .navigationTitle(model.isNew ? "New Entry" : "Edit Entry")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar { toolbar }
        .onChange(of: pickerItems) { _, items in importPicked(items) }
        .onDrop(of: [.movie, .audio, .image, .fileURL], isTargeted: $dropTargeted) { providers in
            importDropped(providers)
            return true
        }
        .fileImporter(isPresented: $showFiles, allowedContentTypes: [.image, .movie, .audio], allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { importFiles(urls) }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker(disk: JournalStore.shared.disk) { shot in
                showCamera = false
                if let shot { model.add(shot) }
            }
            .ignoresSafeArea()
        }
        #else
        .sheet(isPresented: $showCamera) {
            MacCameraView(disk: JournalStore.shared.disk) { shot in
                showCamera = false
                if let shot { model.add(shot) }
            }
        }
        #endif
        .confirmationDialog(model.isNew ? "Keep this draft?" : "Discard your changes?", isPresented: $confirmCancel, titleVisibility: .visible) {
            if model.isNew {
                Button("Keep Draft") { model.keepDraft(); dismiss() }
            } else {
                Button("Keep Editing Later") { model.keepDraft(); dismiss() }
            }
            Button(model.isNew ? "Discard Entry" : "Discard Changes", role: .destructive) {
                model.discard()
                dismiss()
            }
        } message: {
            Text(model.isNew ? "A kept draft opens again the next time you write." : "The entry stays as it was saved.")
        }
        .alert("Couldn’t add that", isPresented: errorBinding) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.error ?? "")
        }
        .onChange(of: scenePhase) { _, phase in if phase != .active { model.flush() } }
        // the recorder shows in the page: the keyboard steps aside for it
        .onChange(of: model.recorder.isActive) { _, active in if active { focus = nil } }
        .onDisappear { model.flush() }
        .task {
            if JournalLaunch.flag("FXJournalRecord") { model.startRecording() }
        }
    }

    // MARK: Header

    private func header(_ words: Wording) -> some View {
        HStack(alignment: .center, spacing: 16) {
            Button { showEmoji = true } label: {
                ZStack {
                    Circle().fill(Theme.panel2)
                    Circle().stroke(model.draft.emoji == nil ? Theme.teal.opacity(0.5) : Theme.line2, style: StrokeStyle(lineWidth: 1.5, dash: model.draft.emoji == nil ? [5, 4] : []))
                    if let emoji = model.draft.emoji {
                        Text(verbatim: emoji).font(.system(size: 46))
                    } else {
                        Image(systemName: "face.smiling")
                            .font(.system(size: 30, weight: .light))
                            .foregroundStyle(Theme.teal)
                    }
                }
                .frame(width: 80, height: 80)
                .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.draft.emoji == nil ? "Choose an emoji" : "Emoji \(model.draft.emoji ?? ""), change")
            .popover(isPresented: $showEmoji) {
                EmojiPicker(selection: $model.draft.emoji) { showEmoji = false }
                    .frame(minWidth: 340, idealWidth: 380, minHeight: 440, idealHeight: 520)
                    .presentationDetents([.medium, .large])
            }

            Button { showMoment = true } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(momentTitle(words))
                        .font(.caption.weight(.semibold))
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.ink3)
                    Text(verbatim: words.notation.dateText(at: model.draft.time, letters: true, upTo: "iota"))
                        .font(.code(14, weight: .medium))
                        .foregroundStyle(Theme.teal)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                    if !words.pure {
                        Text(verbatim: earthMoment(model.draft.time, words: words))
                            .font(.footnote)
                            .foregroundStyle(Theme.ink2)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Choose the moment of the entry")
            .popover(isPresented: $showMoment) {
                MomentEditor(time: model.draft.time) { model.setTime($0) }
                    .frame(minWidth: 340, idealWidth: 360, minHeight: 420)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private func momentTitle(_ words: Wording) -> String {
        model.draft.timeChosen == true ? "Moment" : "Now"
    }

    // MARK: Body

    @ViewBuilder
    private var bodyEditor: some View {
        if preview {
            Group {
                if model.draft.markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("Nothing to preview yet.").foregroundStyle(Theme.ink3)
                } else {
                    MarkdownView(model.draft.markdown)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
        } else {
            TextEditor(text: $model.draft.markdown, selection: $selection)
                .font(.body)
                .foregroundStyle(Theme.ink)
                .scrollContentBackground(.hidden)
                .scrollDisabled(true)
                .focused($focus, equals: .body)
                .frame(minHeight: 220)
                .overlay(alignment: .topLeading) {
                    if model.draft.markdown.isEmpty {
                        Text("What’s happening? Markdown works: **bold**, *italic*, - lists, > quotes…")
                            .font(.body)
                            .foregroundStyle(Theme.ink3)
                            .padding(.top, 8)
                            .padding(.leading, 5)
                            .allowsHitTesting(false)
                    }
                }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button("Cancel", systemImage: "xmark") {
                if model.draft.isEmpty {
                    model.discard()
                    dismiss()
                } else if model.hasChanges {
                    confirmCancel = true
                } else {
                    // unchanged: a kept draft stays kept, an untouched edit leaves nothing behind
                    dismiss()
                }
            }
        }
        ToolbarItem(placement: .principal) {
            Picker("Mode", selection: $preview) {
                Text("Write").tag(false)
                Text("Preview").tag(true)
            }
            .pickerStyle(.segmented)
            .fixedSize()
        }
        ToolbarItem(placement: .confirmationAction) {
            Button("Save", systemImage: "checkmark", role: .confirmIfAvailable) {
                if model.save() != nil {
                    toasts.show(model.isNew ? "Entry saved" : "Changes saved")
                    dismiss()
                }
            }
            .disabled(!model.canSave)
            .keyboardShortcut("s", modifiers: .command)
        }
    }

    // MARK: Formatting

    private func apply(_ action: MarkdownAction) {
        if preview { preview = false }
        let text = model.draft.markdown
        let range = Self.offsets(selection, in: text)
        let result = action.apply(to: text, selection: range)
        model.draft.markdown = result.text
        let new = result.text
        let lower = new.index(new.startIndex, offsetBy: min(result.selection.lowerBound, new.count))
        let upper = new.index(new.startIndex, offsetBy: min(result.selection.upperBound, new.count))
        selection = TextSelection(range: lower..<upper)
        focus = .body
        Haptics.play(.selection)
    }

    /// The selection as character offsets (the end of the text when there is none).
    private static func offsets(_ selection: TextSelection?, in text: String) -> Range<Int> {
        guard let selection else { return text.count..<text.count }
        switch selection.indices {
        case .selection(let range):
            guard range.lowerBound >= text.startIndex, range.upperBound <= text.endIndex else { return text.count..<text.count }
            return text.distance(from: text.startIndex, to: range.lowerBound)..<text.distance(from: text.startIndex, to: range.upperBound)
        case .multiSelection(let set):
            guard let range = set.ranges.first, range.upperBound <= text.endIndex else { return text.count..<text.count }
            return text.distance(from: text.startIndex, to: range.lowerBound)..<text.distance(from: text.startIndex, to: range.upperBound)
        @unknown default:
            return text.count..<text.count
        }
    }

    // MARK: Importing

    private func importPicked(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        pickerItems = []
        for item in items {
            Task {
                let isMovie = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
                if isMovie, let movie = try? await item.loadTransferable(type: PickedMovie.self) {
                    model.add(files: [(movie.url, nil)])
                } else if let image = try? await item.loadTransferable(type: PickedImage.self) {
                    model.add(files: [(image.url, nil)])
                } else {
                    model.error = "That item could not be read from the library."
                }
            }
        }
    }

    private func importFiles(_ urls: [URL]) {
        let disk = JournalStore.shared.disk
        var files: [(url: URL, name: String?)] = []
        for url in urls {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let target = disk.temporaryFile(ext: url.pathExtension.lowercased())
            if (try? FileManager.default.copyItem(at: url, to: target)) != nil {
                files.append((target, url.lastPathComponent))
            }
        }
        model.add(files: files)
    }

    private func importDropped(_ providers: [NSItemProvider]) {
        let disk = JournalStore.shared.disk
        for provider in providers {
            guard let type = [UTType.movie, .audio, .image, .fileURL].first(where: { provider.hasItemConformingToTypeIdentifier($0.identifier) }) else { continue }
            if type == .fileURL {
                _ = provider.loadObject(ofClass: URL.self) { url, _ in
                    guard let url else { return }
                    let target = disk.temporaryFile(ext: url.pathExtension.lowercased())
                    let scoped = url.startAccessingSecurityScopedResource()
                    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                    let kind = UTType(filenameExtension: url.pathExtension)
                    guard let kind, kind.conforms(to: .image) || kind.conforms(to: .movie) || kind.conforms(to: .audio),
                          (try? FileManager.default.copyItem(at: url, to: target)) != nil else { return }
                    let name = url.lastPathComponent
                    Task { @MainActor in model.add(files: [(target, name)]) }
                }
                continue
            }
            provider.loadFileRepresentation(forTypeIdentifier: type.identifier) { url, _ in
                guard let url else { return }
                let ext = url.pathExtension.isEmpty ? (type.preferredFilenameExtension ?? "dat") : url.pathExtension.lowercased()
                let target = disk.temporaryFile(ext: ext)
                guard (try? FileManager.default.copyItem(at: url, to: target)) != nil else { return }
                let name = url.lastPathComponent
                Task { @MainActor in model.add(files: [(target, name)]) }
            }
        }
    }

    private var errorBinding: Binding<Bool> {
        Binding(get: { model.error != nil }, set: { if !$0 { model.error = nil } })
    }
}

/// A movie from the Photos library, copied into the journal's tmp/.
struct PickedMovie: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            let target = JournalDisk.standard.temporaryFile(ext: received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension.lowercased())
            try FileManager.default.copyItem(at: received.file, to: target)
            return PickedMovie(url: target)
        }
    }
}

/// An image from the Photos library, copied into the journal's tmp/ as the library's file (HEIC, JPEG …).
struct PickedImage: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .image) { received in
            let target = JournalDisk.standard.temporaryFile(ext: received.file.pathExtension.isEmpty ? "jpg" : received.file.pathExtension.lowercased())
            try FileManager.default.copyItem(at: received.file, to: target)
            return PickedImage(url: target)
        }
    }
}
