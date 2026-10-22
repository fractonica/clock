import SwiftUI
import WebKit

/// One page large, as vector, to read the small print: pinch (or double-tap) to zoom, turn with the arrows.
struct DiaryReader: View {
    let model: DiaryModel

    @State private var no: Int
    @State private var svg: String?
    @Environment(\.dismiss) private var dismiss

    init(model: DiaryModel, start: Int) {
        self.model = model
        _no = State(initialValue: start)
    }

    var body: some View {
        let count = model.plan?.pages.count ?? no
        NavigationStack {
            ZStack {
                if let svg, let size = model.plan?.size {
                    DiaryReaderPage(svg: svg, aspect: size.width / size.height)
                        .ignoresSafeArea(edges: .bottom)
                        .accessibilityLabel("Page \(title)")
                } else {
                    ProgressView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { Backdrop() }
            .task(id: no) { svg = await model.svg(page: no) }
            .navigationTitle(title)
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        model.go(to: no, smooth: false)
                        dismiss()
                    }
                }
                #if os(iOS)
                ToolbarItemGroup(placement: .bottomBar) {
                    pager(count: count)
                }
                #else
                ToolbarItemGroup(placement: .primaryAction) {
                    pager(count: count)
                }
                #endif
            }
        }
        #if os(macOS)
        .frame(minWidth: 620, idealWidth: 760, minHeight: 760, idealHeight: 980)
        #endif
    }

    private var title: String {
        model.plan?.page(no)?.name ?? "Page \(no)"
    }

    @ViewBuilder
    private func pager(count: Int) -> some View {
        Button("Previous page", systemImage: "chevron.left") { turn(-1, count: count) }
            .disabled(no <= 1)
            .keyboardShortcut(.leftArrow, modifiers: [])
        Text(verbatim: "\(no) of \(count)")
            .font(.reading(14, weight: .medium))
            .foregroundStyle(Theme.ink2)
            .fixedSize()
        Button("Next page", systemImage: "chevron.right") { turn(1, count: count) }
            .disabled(no >= count)
            .keyboardShortcut(.rightArrow, modifiers: [])
    }

    private func turn(_ d: Int, count: Int) {
        no = min(max(1, no + d), max(1, count))
        Haptics.play(.selection)
    }
}

/// The page's SVG in a zoomable web view of its own.
private struct DiaryReaderPage {
    let svg: String
    let aspect: Double

    @MainActor
    final class Coordinator {
        var shown = ""
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    @MainActor
    func makeWebView() -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        #if os(iOS)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.contentInsetAdjustmentBehavior = .never
        #else
        view.setValue(false, forKey: "drawsBackground")
        view.allowsMagnification = true
        #endif
        return view
    }

    @MainActor
    func show(in view: WKWebView, coordinator: Coordinator) {
        guard coordinator.shown != svg else { return }
        coordinator.shown = svg
        let ratio = String(format: "%.5f", aspect)
        let html = """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=10">
        <style>
        html,body{margin:0;background:transparent;-webkit-text-size-adjust:none}
        body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box}
        .p{width:min(calc(100vw - 28px), calc((100vh - 28px) * \(ratio)));aspect-ratio:\(ratio);background:#fff;
           border-radius:3px;box-shadow:0 12px 30px rgba(0,0,0,.5),0 1px 3px rgba(0,0,0,.4);overflow:hidden}
        .p svg{display:block;width:100%;height:100%}
        </style></head><body><div class="p">\(svg)</div></body></html>
        """
        view.loadHTMLString(html, baseURL: nil)
    }
}

#if os(iOS)
extension DiaryReaderPage: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView() }

    func updateUIView(_ view: WKWebView, context: Context) {
        show(in: view, coordinator: context.coordinator)
    }
}
#else
extension DiaryReaderPage: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView() }

    func updateNSView(_ view: WKWebView, context: Context) {
        show(in: view, coordinator: context.coordinator)
    }
}
#endif
