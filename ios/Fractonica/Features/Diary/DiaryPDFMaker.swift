import Foundation
import PDFKit
import WebKit
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Turns the diary's print document (src/diary/render.js `printDocument`: one SVG per sheet, `@page` at the paper size)
/// into a vector PDF whose pages have exactly that paper size.
///
/// The document loads into a web view of its own, sized to the paper. Two ways to make the PDF:
/// - `.printer`, the system's printing path: on iOS `UIPrintPageRenderer` with the web view's print formatter, on macOS
///   `NSPrintOperation` saving to a file; WebKit paginates at the CSS page breaks.
/// - `.pages`: one `WKWebView.pdf(configuration:)` capture per sheet (the sheets stacked at exactly the paper's height),
///   each drawn at 72/96 scale onto a page of the exact paper size (still vector).
/// `.automatic` takes the first and falls back to the second when the result does not have the expected page count and
/// size. Every result is checked with PDFKit before it is returned.
@MainActor
final class DiaryPDFMaker: NSObject {
    enum Method: String, Sendable {
        case automatic, printer, pages
    }

    struct Result: Sendable {
        var data: Data
        var pages: Int
        /// Page size in points.
        var size: CGSize
        var method: Method
    }

    private var webView: WKWebView?
    private var loading: CheckedContinuation<Void, any Error>?
    #if os(macOS)
    private var window: NSWindow?
    private var printing: CheckedContinuation<Bool, Never>?
    #endif

    /// - Parameter progress: 0…1 while pages are drawn.
    func make(_ doc: DiaryPrintDocument, method: Method = .automatic, progress: @escaping @MainActor (Double) -> Void) async throws -> Result {
        defer { tearDown() }
        let paper = CGSize(width: DiaryPrint.points(doc.paper.width), height: DiaryPrint.points(doc.paper.height))
        try await load(doc, paper: paper)
        if method != .pages {
            if let result = try? await printed(doc, paper: paper, progress: progress), Self.matches(result, doc: doc, paper: paper) {
                return result
            }
            if method == .printer { throw DiaryError.pdf("The printing system did not lay the diary out at its paper size.") }
        }
        let result = try await captured(doc, paper: paper, progress: progress)
        guard Self.matches(result, doc: doc, paper: paper) else {
            throw DiaryError.pdf("The PDF has \(result.pages) pages of \(Int(result.size.width)) × \(Int(result.size.height)) pt, expected \(doc.sheets) of \(Int(paper.width)) × \(Int(paper.height)).")
        }
        return result
    }

    /// The expected number of pages, each of the paper's size (within half a point).
    static func matches(_ r: Result, doc: DiaryPrintDocument, paper: CGSize) -> Bool {
        r.pages == doc.sheets && abs(r.size.width - paper.width) < 0.5 && abs(r.size.height - paper.height) < 0.5
    }

    static func inspect(_ data: Data, method: Method) -> Result? {
        guard let pdf = PDFDocument(data: data), pdf.pageCount > 0, let first = pdf.page(at: 0) else { return nil }
        let box = first.bounds(for: .mediaBox)
        // every page must have the same size
        for i in 0..<pdf.pageCount {
            guard let p = pdf.page(at: i) else { return nil }
            let b = p.bounds(for: .mediaBox)
            if abs(b.width - box.width) > 0.5 || abs(b.height - box.height) > 0.5 { return nil }
        }
        return Result(data: data, pages: pdf.pageCount, size: box.size, method: method)
    }

    // MARK: Loading

    /// CSS pixels per millimetre.
    private static let pxPerMM = 96 / 25.4

    private func load(_ doc: DiaryPrintDocument, paper: CGSize) async throws {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let width = (doc.paper.width * Self.pxPerMM).rounded(.up)
        let height = (doc.paper.height * Self.pxPerMM).rounded(.up)
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: width, height: height), configuration: config)
        view.navigationDelegate = self
        #if os(macOS)
        // printing a WKWebView on macOS needs it in a window; this one is never shown
        let window = NSWindow(contentRect: CGRect(x: -20_000, y: -20_000, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = view
        self.window = window
        #endif
        webView = view
        try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, any Error>) in
            loading = c
            view.loadHTMLString(doc.html, baseURL: nil)
        }
        _ = try? await view.callAsyncJavaScript("await document.fonts.ready; return 1;", contentWorld: .page)
    }

    private func tearDown() {
        webView?.navigationDelegate = nil
        webView = nil
        #if os(macOS)
        window?.contentView = nil
        window = nil
        #endif
    }

    // MARK: The printing system

    private func printed(_ doc: DiaryPrintDocument, paper: CGSize, progress: @escaping @MainActor (Double) -> Void) async throws -> Result? {
        guard let webView else { return nil }
        #if os(iOS)
        let rect = CGRect(origin: .zero, size: paper)
        let renderer = UIPrintPageRenderer()
        renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)
        renderer.setValue(NSValue(cgRect: rect), forKey: "paperRect")
        renderer.setValue(NSValue(cgRect: rect), forKey: "printableRect")
        let count = renderer.numberOfPages
        guard count > 0 else { return nil }
        let data = NSMutableData()
        var box = rect
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &box, Self.info(doc) as CFDictionary) else { return nil }
        renderer.prepare(forDrawingPages: NSRange(location: 0, length: count))
        for i in 0..<count {
            context.beginPDFPage(nil)
            // UIKit draws into the current context, flipped (origin top left)
            context.translateBy(x: 0, y: rect.height)
            context.scaleBy(x: 1, y: -1)
            UIGraphicsPushContext(context)
            renderer.drawPage(at: i, in: rect)
            UIGraphicsPopContext()
            context.endPDFPage()
            progress(Double(i + 1) / Double(count))
            if i % 8 == 7 { await Task.yield() }
        }
        context.closePDF()
        return Self.inspect(data as Data, method: .printer)
        #else
        guard let window else { return nil }
        let url = FileManager.default.temporaryDirectory.appending(path: "diary-print-\(UUID().uuidString).pdf")
        defer { try? FileManager.default.removeItem(at: url) }
        let info = NSPrintInfo()
        info.paperSize = paper
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        info.horizontalPagination = .automatic
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        info.orientation = paper.width > paper.height ? .landscape : .portrait
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url
        let operation = webView.printOperation(with: info)
        operation.showsPrintPanel = false
        operation.showsProgressPanel = false
        operation.jobTitle = doc.title
        operation.view?.frame = webView.bounds
        progress(0.1)
        let ok = await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            printing = c
            operation.runModal(for: window, delegate: self, didRun: #selector(printOperationDidRun(_:success:contextInfo:)), contextInfo: nil)
        }
        progress(1)
        guard ok, let data = try? Data(contentsOf: url) else { return nil }
        return Self.inspect(data, method: .printer)
        #endif
    }

    #if os(macOS)
    /// AppKit may call this on the print operation's own thread.
    @objc nonisolated private func printOperationDidRun(_ operation: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        Task { @MainActor in self.finishPrinting(success) }
    }

    private func finishPrinting(_ success: Bool) {
        printing?.resume(returning: success)
        printing = nil
    }
    #endif

    // MARK: One capture per sheet

    private func captured(_ doc: DiaryPrintDocument, paper: CGSize, progress: @escaping @MainActor (Double) -> Void) async throws -> Result {
        guard let webView else { throw DiaryError.pdf("The print document did not load.") }
        // the sheets stacked at exactly the paper's height, on white
        let css = ".sheet{height:\(doc.paper.height)mm!important;margin:0!important;box-shadow:none!important}html,body{background:#fff!important;padding:0!important}"
        _ = try await webView.callAsyncJavaScript(
            "const s = document.createElement('style'); s.textContent = css; document.head.append(s); await new Promise(r => setTimeout(r, 30)); return document.querySelectorAll('body > .sheet').length;",
            arguments: ["css": css], contentWorld: .page)
        webView.mediaType = "print"
        let sheetPx = CGSize(width: doc.paper.width * Self.pxPerMM, height: doc.paper.height * Self.pxPerMM)
        let data = NSMutableData()
        var box = CGRect(origin: .zero, size: paper)
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let context = CGContext(consumer: consumer, mediaBox: &box, Self.info(doc) as CFDictionary) else {
            throw DiaryError.pdf("Could not start the PDF.")
        }
        for i in 0..<doc.sheets {
            let configuration = WKPDFConfiguration()
            configuration.rect = CGRect(x: 0, y: Double(i) * sheetPx.height, width: sheetPx.width, height: sheetPx.height)
            let pageData = try await webView.pdf(configuration: configuration)
            guard let provider = CGDataProvider(data: pageData as CFData), let source = CGPDFDocument(provider), let page = source.page(at: 1) else {
                throw DiaryError.pdf("Page \(i + 1) could not be captured.")
            }
            let from = page.getBoxRect(.mediaBox)
            context.beginPDFPage(nil)
            context.scaleBy(x: paper.width / from.width, y: paper.height / from.height)
            context.translateBy(x: -from.minX, y: -from.minY)
            context.drawPDFPage(page)
            context.endPDFPage()
            progress(Double(i + 1) / Double(doc.sheets))
        }
        context.closePDF()
        guard let result = Self.inspect(data as Data, method: .pages) else { throw DiaryError.pdf("The PDF could not be read back.") }
        return result
    }

    private static func info(_ doc: DiaryPrintDocument) -> [CFString: Any] {
        [kCGPDFContextTitle: doc.title, kCGPDFContextCreator: "Fractonica"]
    }
}

extension DiaryPDFMaker: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading?.resume()
        loading = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        loading?.resume(throwing: error)
        loading = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        loading?.resume(throwing: error)
        loading = nil
    }
}
