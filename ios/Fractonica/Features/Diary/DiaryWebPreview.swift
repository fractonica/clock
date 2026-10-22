import SwiftUI
import WebKit

/// The model's web view (the web host's paged strip of pages) inside SwiftUI. The web view outlives this view: it is
/// re-parented into a fresh container whenever the screen comes back, so the planned book is never lost.
#if os(iOS)
struct DiaryWebPreview: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear
        adopt(in: container)
        return container
    }

    func updateUIView(_ container: UIView, context: Context) {
        adopt(in: container)
    }

    private func adopt(in container: UIView) {
        guard webView.superview !== container else { return }
        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = true
        webView.frame = container.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        container.addSubview(webView)
    }
}
#else
struct DiaryWebPreview: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> NSView {
        let container = NSView()
        adopt(in: container)
        return container
    }

    func updateNSView(_ container: NSView, context: Context) {
        adopt(in: container)
    }

    private func adopt(in container: NSView) {
        guard webView.superview !== container else { return }
        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = true
        webView.frame = container.bounds
        webView.autoresizingMask = [.width, .height]
        container.addSubview(webView)
    }
}
#endif
