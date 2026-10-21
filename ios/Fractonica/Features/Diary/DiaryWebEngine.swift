import Foundation
import WebKit

/// The web diary renderer in a WKWebView: loads diary-host.html through `DiarySchemeHandler` (so the web app's ES
/// modules import from the bundle with their proper MIME types), forwards the host's messages and wraps its
/// `window.fxDiary` API. One engine lives as long as the app; its web view is both the planner and the page preview.
@MainActor
final class DiaryWebEngine: NSObject {
    let webView: WKWebView
    /// Every message of the host, in order.
    var onMessage: ((DiaryHostMessage) -> Void)?
    /// The web content process died (memory pressure): the page reloads and the owner configures it again.
    var onReload: (() -> Void)?

    private(set) var isReady = false
    private var waiting: [CheckedContinuation<Void, Never>] = []
    /// View settings asked for before the host was ready (or before a reload), applied once it is.
    private var insetsScript: String?
    private var layoutScript: String?
    private var terminations: [Date] = []

    override init() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(DiarySchemeHandler(), forURLScheme: DiaryResources.scheme)
        config.websiteDataStore = .nonPersistent()
        #if os(iOS)
        config.dataDetectorTypes = []
        #endif
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 600), configuration: config)
        super.init()
        config.userContentController.add(MessageRelay(self), name: "diary")
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        #if os(iOS)
        webView.accessibilityLabel = "Diary pages"
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #else
        webView.setAccessibilityLabel("Diary pages")
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsMagnification = false
        #endif
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.load(URLRequest(url: DiaryResources.entry))
    }

    /// Returns once the host page has loaded its modules.
    func ready() async {
        if isReady { return }
        await withCheckedContinuation { waiting.append($0) }
    }

    fileprivate func receive(_ body: Any) {
        guard let json = body as? String, let message = DiaryHostMessage(json: json) else { return }
        if case .ready = message {
            isReady = true
            for script in [insetsScript, layoutScript].compactMap({ $0 }) { run(script) }
            let resumed = waiting
            waiting.removeAll()
            resumed.forEach { $0.resume() }
        }
        onMessage?(message)
    }

    // MARK: The host's API

    struct Request: Encodable {
        var token: Int
        var delta: Int
        var options: DiaryOptions
        var appZone: String
        var pureMode: Bool
        var page: Int
        var layout: String
    }

    /// Plan a diary (the newest request wins; the plan arrives as a `.plan` message, twice when maps load later).
    func configure(_ request: Request) async {
        await ready()
        guard let data = try? JSONEncoder().encode(request), let json = String(data: data, encoding: .utf8) else { return }
        _ = try? await webView.callAsyncJavaScript("fxDiary.configure(JSON.parse(json)); return 0;", arguments: ["json": json], contentWorld: .page)
    }

    func go(to page: Int, smooth: Bool = true) {
        run("fxDiary.go(\(page), \(smooth))")
    }

    func step(_ direction: Int) {
        run("fxDiary.step(\(direction))")
    }

    func setLayout(_ layout: String) {
        let script = "fxDiary.setLayout('\(layout == "page" ? "page" : "spread")')"
        layoutScript = script
        run(script)
    }

    func setInsets(top: Double, bottom: Double, horizontal: Double) {
        let script = "fxDiary.setInsets({top: \(Int(top)), bottom: \(Int(bottom)), x: \(Int(horizontal))})"
        insetsScript = script
        run(script)
    }

    /// Marks the page that holds `t` and returns it; nil outside the planned Delta.
    func setShown(_ t: Double?) async -> Int? {
        guard isReady else { return nil }
        let arg = t.map { $0.isFinite ? String($0) : "null" } ?? "null"
        let result = try? await webView.callAsyncJavaScript("return fxDiary.setShown(\(arg));", contentWorld: .page)
        return (result as? NSNumber)?.intValue
    }

    /// The print document of the planned diary.
    func printDocument() async throws -> DiaryPrintDocument {
        await ready()
        let result = try await webView.callAsyncJavaScript("return JSON.stringify(fxDiary.printDocument());", contentWorld: .page)
        guard let json = result as? String, let data = json.data(using: .utf8) else { throw DiaryError.noDocument }
        return try JSONDecoder().decode(DiaryPrintDocument.self, from: data)
    }

    /// One page as SVG markup.
    func svg(page: Int) async -> String? {
        guard isReady else { return nil }
        return try? await webView.callAsyncJavaScript("return fxDiary.svg(\(page));", contentWorld: .page) as? String
    }

    /// One page as PNG data, `pixels` wide.
    func thumbnail(page: Int, pixels: Int) async -> Data? {
        guard isReady else { return nil }
        let result = try? await webView.callAsyncJavaScript("return await fxDiary.thumb(\(page), \(pixels));", contentWorld: .page)
        guard let url = result as? String, let comma = url.firstIndex(of: ",") else { return nil }
        return Data(base64Encoded: String(url[url.index(after: comma)...]))
    }

    private func run(_ script: String) {
        guard isReady else { return }
        webView.evaluateJavaScript(script + ";0", completionHandler: nil)
    }
}

extension DiaryWebEngine: WKNavigationDelegate {
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        isReady = false
        // reload after memory pressure, but never loop when the web process cannot start at all
        let now = Date.now
        terminations = terminations.filter { now.timeIntervalSince($0) < 60 } + [now]
        guard terminations.count <= 3 else {
            onMessage?(.error(token: nil, message: "The page renderer stopped working."))
            return
        }
        webView.load(URLRequest(url: DiaryResources.entry))
        onReload?()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        // the host page only: nothing inside it navigates anywhere else
        navigationAction.request.url?.scheme == DiaryResources.scheme ? .allow : .cancel
    }
}

enum DiaryError: LocalizedError {
    case noDocument
    case pdf(String)

    var errorDescription: String? {
        switch self {
        case .noDocument: "The diary is not planned yet."
        case .pdf(let why): why
        }
    }
}

/// The script message handler, holding the engine weakly (WebKit keeps its handlers alive).
@MainActor
private final class MessageRelay: NSObject, WKScriptMessageHandler {
    weak var engine: DiaryWebEngine?

    init(_ engine: DiaryWebEngine) {
        self.engine = engine
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        engine?.receive(message.body)
    }
}

/// Serves `fxdiary://app/…` from the app bundle (`DiaryResources`).
@MainActor
final class DiarySchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        let resources = Bundle.main.resourceURL ?? Bundle.main.bundleURL
        guard let file = DiaryResources.file(for: url, resources: resources), let data = try? Data(contentsOf: file) else {
            let response = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(response)
            task.didReceive(Data())
            task.didFinish()
            return
        }
        let headers = [
            "Content-Type": DiaryResources.mimeType(for: file.path),
            "Content-Length": String(data.count),
            "Cache-Control": "no-store",
        ]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        // every response is delivered at once in start(): nothing is left to stop
    }
}
