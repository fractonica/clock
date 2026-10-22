import FractonicaKit
import SwiftUI
import UniformTypeIdentifiers

/// Diary: the printable diary of one Delta (docs/design/90-diary.md), laid out by the web app's own renderer running
/// in a web view (src/ui/diary/build.js, src/diary/render.js, copied into the bundle's web/ folder) and exported as a
/// vector PDF at the exact paper size.
///
/// The Delta (by α β γ δ, or the one holding the displayed time) heads the screen; the pages fill it as a paged strip
/// (a spread of verso and recto where there is room), tap one to read it large; a glass bar turns the pages and
/// exports. The options are a sheet on iPhone and an inspector on iPad and Mac.
struct DiaryScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store
    @Environment(ToastCenter.self) private var toasts
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    private let model = DiaryModel.shared

    @State private var showOptions = DiaryLaunch.flag("FXDiaryOptions")
    @State private var showPicker = DiaryLaunch.flag("FXDiaryPicker")
    @State private var showPages = DiaryLaunch.flag("FXDiaryPages")
    @State private var reader: DiaryPageRef? = DiaryLaunch.int("FXDiaryReader").map(DiaryPageRef.init)
    @State private var barHeight: CGFloat = 64
    @State private var share: DiaryFileRef?
    @State private var saving: DiaryPDFFile?
    @State private var launchExportDone = false

    var body: some View {
        VStack(spacing: 0) {
            DiaryHeader(model: model, showPicker: $showPicker)
            preview
        }
        // the inspector's column is opaque: the backdrop goes inside it
        .background { Backdrop() }
        .background {
            ClockTimeline(.periodic(600)) { t in
                Color.clear.onChange(of: t, initial: true) { _, t in sync(t) }
            }
        }
        .onChange(of: settings.pure) { sync(store.time()) }
        .onChange(of: settings.zone) { sync(store.time()) }
        .onChange(of: model.tapped) { _, no in
            guard let no else { return }
            model.tapped = nil
            reader = DiaryPageRef(no: no)
        }
        .onChange(of: model.isCurrent && model.plan?.final == true) { _, ready in
            if ready { runLaunchExport() }
        }
        .navigationTitle(Screen.diary.title)
        .toolbar { toolbar }
        .modifier(OptionsPresentation(isPresented: $showOptions, compact: isCompact))
        .sheet(isPresented: $showPicker) {
            DiaryDeltaPicker(model: model)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showPages) {
            DiaryPagesView(model: model)
                .presentationDetents([.large])
        }
        .sheet(item: $reader) { ref in
            DiaryReader(model: model, start: ref.no)
        }
        #if os(iOS)
        .sheet(item: $share) { file in
            DiaryShareSheet(url: file.url)
                .presentationDetents([.medium, .large])
                .ignoresSafeArea()
        }
        #endif
        .fileExporter(isPresented: Binding(get: { saving != nil }, set: { if !$0 { saving = nil } }), document: saving,
                      contentType: .pdf, defaultFilename: saving?.name) { result in
            if case .success = result { toasts.show("Diary saved") }
            saving = nil
        }
        .onChange(of: model.export) { _, state in
            if case .failed(let why) = state { toasts.show("No PDF: \(why)", for: 4) }
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    // MARK: Preview

    private var preview: some View {
        ZStack(alignment: .bottom) {
            DiaryWebPreview(webView: model.webView)
                .opacity(model.plan == nil ? 0 : 1)
                .accessibilityLabel("Diary pages")
                .accessibilityHint("Swipe to turn the pages; tap a page to read it large")
            status
            DiaryPageBar(model: model, showPages: $showPages, export: { exportPDF() })
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { barHeight = $0 }
                .padding(.bottom, 10)
                .padding(.horizontal, 16)
        }
        .onChange(of: barHeight, initial: true) { _, h in
            model.setInsets(top: 8, bottom: Double(h) + 22, horizontal: isCompact ? 18 : 28)
        }
    }

    @ViewBuilder
    private var status: some View {
        switch model.phase {
        case .failed(let why):
            ContentUnavailableView {
                Label("The diary could not be planned", systemImage: "exclamationmark.triangle")
            } description: {
                Text(why)
            } actions: {
                Button("Try again") { sync(store.time()) }
            }
            .frame(maxHeight: .infinity)
        case .loading, .planning:
            if model.plan == nil {
                ProgressView {
                    Text(model.phase == .loading ? "Opening the renderer…" : "Planning the diary…")
                        .font(.callout)
                        .foregroundStyle(Theme.ink2)
                }
                .controlSize(.large)
                .frame(maxHeight: .infinity)
            } else {
                Label("Updating", systemImage: "arrow.triangle.2.circlepath")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .glassEffect(.regular, in: .capsule)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, 12)
                    .transition(.opacity)
            }
        case .ready:
            EmptyView()
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        #if os(iOS)
        if isCompact {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Options", systemImage: "slider.horizontal.3") { showOptions.toggle() }
            }
        } else {
            ToolbarItemGroup(placement: .primaryAction) {
                exportMenu
                Button("Options", systemImage: "sidebar.trailing") { showOptions.toggle() }
            }
        }
        #else
        ToolbarItemGroup(placement: .primaryAction) {
            exportMenu
            Button("Options", systemImage: "sidebar.trailing") { showOptions.toggle() }
                .help("Diary options")
        }
        #endif
    }

    private var exportMenu: some View {
        Menu {
            Button("Export PDF…", systemImage: "square.and.arrow.up") { exportPDF() }
            #if os(iOS)
            Button("Save to Files…", systemImage: "folder") { savePDF() }
            #endif
            Button("Print…", systemImage: "printer") { printPDF() }
        } label: {
            Label("Export", systemImage: "square.and.arrow.up")
        } primaryAction: {
            exportPDF()
        }
        .disabled(model.plan == nil)
        .help("Export the diary as a PDF")
    }

    // MARK: Actions

    private func sync(_ t: Double) {
        model.update(pure: settings.pure, zone: settings.zone ?? settings.timeZone.identifier, time: t)
    }

    private func exportPDF() {
        Task {
            guard let url = await model.makePDF() else { return }
            Haptics.play(.success)
            #if os(iOS)
            share = DiaryFileRef(url: url)
            #else
            saving = DiaryPDFFile(url: url)
            #endif
        }
    }

    private func savePDF() {
        Task {
            guard let url = await model.makePDF() else { return }
            saving = DiaryPDFFile(url: url)
        }
    }

    private func printPDF() {
        Task {
            guard let url = await model.makePDF() else { return }
            DiaryPrinter.print(url: url, title: model.plan?.title ?? "Diary")
        }
    }

    /// `-FXDiaryExport 1`: make the PDF once the plan is in and leave it in the temporary folder, with a report next to
    /// it (diary-export.json) for checking the result outside the app; `-FXDiaryExport share` also offers it as the
    /// export button does.
    private func runLaunchExport() {
        let mode = DiaryLaunch.string("FXDiaryExport")
        guard !launchExportDone, DiaryLaunch.flag("FXDiaryExport") || mode == "share", model.plan?.final == true else { return }
        launchExportDone = true
        Task {
            let method = DiaryLaunch.string("FXDiaryPDFMethod").flatMap(DiaryPDFMaker.Method.init) ?? .automatic
            let started = Date.now
            let url = await model.makePDF(method: method)
            DiaryExportReport.write(url: url, model: model, seconds: Date.now.timeIntervalSince(started))
            if mode == "share", let url {
                #if os(iOS)
                share = DiaryFileRef(url: url)
                #else
                saving = DiaryPDFFile(url: url)
                #endif
            }
        }
    }
}

// MARK: - Header

/// The Delta of the diary: its name (tap to choose another), its α β γ δ stamp and span, following the displayed time,
/// and the previous / next Delta.
private struct DiaryHeader: View {
    let model: DiaryModel
    @Binding var showPicker: Bool

    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var store

    var body: some View {
        let path = model.path
        HStack(alignment: .center, spacing: 10) {
            Button { showPicker = true } label: {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(DiaryDelta.name(level: 3, ordinal: path[3]))
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(Theme.ink3)
                    }
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { stamp(path); span }
                        VStack(alignment: .leading, spacing: 2) { stamp(path); span }
                    }
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .layoutPriority(1)
            .accessibilityLabel("\(DiaryDelta.name(level: 3, ordinal: path[3])), \(DiaryDelta.stamp(path))")
            .accessibilityHint("Choose the Delta of the diary")

            Spacer(minLength: 4)

            if let shown = model.shownPage {
                Button {
                    model.go(to: shown)
                    Haptics.play(.selection)
                } label: {
                    HStack(spacing: 5) {
                        Circle().fill(Theme.cursor).frame(width: 7, height: 7)
                        Text(verbatim: "p. \(shown)").font(.reading(13, weight: .medium))
                    }
                    .lineLimit(1)
                    .fixedSize()
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(Theme.panel2, in: .capsule)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Page \(shown) holds the shown moment")
                .accessibilityHint("Turns to it")
                .help("The page that holds the shown moment")
                .transition(.opacity)
            }

            Button {
                model.setFollow(!model.follow, time: store.time())
                Haptics.play(.selection)
            } label: {
                Image(systemName: "scope")
                    .symbolVariant(model.follow ? .fill : .none)
                    .foregroundStyle(model.follow ? Theme.teal : Theme.ink2)
                    .frame(width: 32, height: 34)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Delta of the shown moment")
            .accessibilityValue(model.follow ? "On" : "Off")
            .help("Follow the displayed time: the diary is the Delta that holds it")

            HStack(spacing: 0) {
                Button { step(-1) } label: {
                    Image(systemName: "chevron.left").frame(width: 30, height: 34)
                }
                .disabled(model.delta <= model.range.lowerBound)
                .accessibilityLabel("Previous Delta")
                Button { step(1) } label: {
                    Image(systemName: "chevron.right").frame(width: 30, height: 34)
                }
                .disabled(model.delta >= model.range.upperBound)
                .accessibilityLabel("Next Delta")
            }
            .buttonStyle(.plain)
            .foregroundStyle(Theme.ink2)
            .font(.body.weight(.semibold))
        }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 4)
    }

    private func stamp(_ path: [Int]) -> some View {
        Text(DiaryDelta.stamp(path))
            .font(.footnote.weight(.medium).monospacedDigit())
            .foregroundStyle(Theme.teal)
            .fixedSize()
    }

    private var span: some View {
        Text(spanText)
            .font(.footnote)
            .foregroundStyle(Theme.ink2)
            .fixedSize()
    }

    private func step(_ d: Int) {
        model.choose(delta: model.delta + d)
        Haptics.play(.step)
    }

    /// "28 Jul → 17 Oct 2026" (the first year too when it differs) · pure "5 Nuclides · 385 Helions".
    private var spanText: String {
        let words = settings.wording
        guard !words.pure, let span = model.span else { return "5 Nuclides · 385 Helions" }
        let a = words.earth.parts(span.t0)
        let b = words.earth.parts(span.t1)
        let months = EarthTime.monthsShort
        let start = a.year == b.year ? "\(a.day) \(months[a.month - 1])" : "\(a.day) \(months[a.month - 1]) \(a.year)"
        return "\(start) → \(b.day) \(months[b.month - 1]) \(b.year)"
    }
}

// MARK: - Page bar

/// The floating glass bar under the pages: all pages, previous / next with the page readout, export.
private struct DiaryPageBar: View {
    let model: DiaryModel
    @Binding var showPages: Bool
    let export: () -> Void

    var body: some View {
        let count = model.plan?.pages.count ?? 0
        let first = model.pair.compactMap { $0 }.min() ?? model.page
        let last = model.pair.compactMap { $0 }.max() ?? model.page
        HStack(spacing: 2) {
            Button { showPages = true } label: {
                Image(systemName: "square.grid.2x2").frame(width: 40, height: 40)
            }
            .accessibilityLabel("All pages")
            .help("All pages")

            Button { model.step(-1) } label: {
                Image(systemName: "chevron.left").frame(width: 40, height: 40)
            }
            .disabled(first <= 1)
            .keyboardShortcut(.leftArrow, modifiers: [])
            .accessibilityLabel("Previous page")

            VStack(spacing: 1) {
                Text(count == 0 ? " " : first == last ? "\(first) of \(count)" : "\(first)–\(last) of \(count)")
                    .font(.reading(15, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .contentTransition(.numericText())
                Text(caption)
                    .font(.caption2)
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .frame(minWidth: 150, maxWidth: model.spread ? 480 : 300)
            .accessibilityElement(children: .combine)

            Button { model.step(1) } label: {
                Image(systemName: "chevron.right").frame(width: 40, height: 40)
            }
            .disabled(count == 0 || last >= count)
            .keyboardShortcut(.rightArrow, modifiers: [])
            .accessibilityLabel("Next page")

            if model.wide {
                Button {
                    model.setLayout(model.layout == .spread ? .page : .spread)
                    Haptics.play(.selection)
                } label: {
                    Image(systemName: model.layout == .spread ? "book.pages" : "doc")
                        .contentTransition(.symbolEffect(.replace))
                        .frame(width: 40, height: 40)
                }
                .accessibilityLabel(model.layout == .spread ? "Showing the open book" : "Showing one page")
                .accessibilityHint("Switches between one page and the open book")
                .help(model.layout == .spread ? "Show one page" : "Show the open book")
            }

            exportButton
        }
        .buttonStyle(.plain)
        .font(.body.weight(.semibold))
        .foregroundStyle(Theme.ink)
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .glassEffect(.regular.interactive(), in: .capsule)
        .disabled(model.plan == nil)
        .animation(.snappy, value: model.page)
    }

    private var caption: String {
        guard let plan = model.plan else { return model.phase == .loading ? "Opening…" : "Planning…" }
        if case .working(let p) = model.export {
            return p.map { _ in "Drawing the PDF…" } ?? "Preparing the PDF…"
        }
        let names = model.pair.compactMap { $0 }.compactMap { plan.page($0)?.name }
        return names.isEmpty ? plan.title : names.joined(separator: "  ·  ")
    }

    @ViewBuilder
    private var exportButton: some View {
        if case .working(let p) = model.export {
            Group {
                if let p {
                    ProgressView(value: p).progressViewStyle(.circular)
                } else {
                    ProgressView()
                }
            }
            .controlSize(.small)
            .frame(width: 40, height: 40)
            .accessibilityLabel("Making the PDF")
        } else {
            Button(action: export) {
                Image(systemName: "square.and.arrow.up").frame(width: 40, height: 40)
            }
            .accessibilityLabel("Export PDF")
            .help("Export PDF")
        }
    }
}

// MARK: - Options presentation

/// The options: a sheet on iPhone (half height, so the pages stay in view and follow every change), an inspector on
/// iPad and Mac.
private struct OptionsPresentation: ViewModifier {
    @Binding var isPresented: Bool
    let compact: Bool

    func body(content: Content) -> some View {
        if compact {
            content.sheet(isPresented: $isPresented) {
                DiaryOptionsView(model: .shared)
                    .presentationDetents([.medium, .large])
                    .presentationBackgroundInteraction(.enabled(upThrough: .medium))
            }
        } else {
            content.inspector(isPresented: $isPresented) {
                DiaryOptionsView(model: .shared)
                    #if os(iOS)
                    // the transport floats over the bottom of the inspector on iPad: the last rows scroll clear of it
                    .contentMargins(.bottom, 72, for: .scrollContent)
                    #endif
                    .inspectorColumnWidth(min: 300, ideal: 340, max: 420)
            }
        }
    }
}

// MARK: - Small types

struct DiaryPageRef: Identifiable, Hashable {
    var no: Int
    var id: Int { no }
}

struct DiaryFileRef: Identifiable, Hashable {
    var url: URL
    var id: URL { url }
}

/// A made PDF for the system's save panel.
struct DiaryPDFFile: FileDocument {
    static let readableContentTypes: [UTType] = [.pdf]
    var data: Data
    var name: String

    init(url: URL) {
        data = (try? Data(contentsOf: url)) ?? Data()
        name = url.deletingPathExtension().lastPathComponent
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
        name = "Diary"
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}
