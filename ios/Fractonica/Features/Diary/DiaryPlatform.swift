import Foundation
import PDFKit
import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

/// Printing a made diary PDF with the system's print dialog, at the PDF's own paper size.
@MainActor
enum DiaryPrinter {
    static func print(url: URL, title: String) {
        #if os(iOS)
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo.printInfo()
        info.outputType = .general
        info.jobName = title
        info.duplex = .none
        controller.printInfo = info
        controller.printingItem = url
        controller.present(animated: true)
        #else
        guard let document = PDFDocument(url: url), let first = document.page(at: 0) else { return }
        let info = NSPrintInfo.shared.copy() as! NSPrintInfo
        let size = first.bounds(for: .mediaBox).size
        info.paperSize = size
        info.orientation = size.width > size.height ? .landscape : .portrait
        info.topMargin = 0
        info.bottomMargin = 0
        info.leftMargin = 0
        info.rightMargin = 0
        guard let operation = document.printOperation(for: info, scalingMode: .pageScaleNone, autoRotate: true) else { return }
        operation.jobTitle = title
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            operation.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            operation.run()
        }
        #endif
    }
}

#if os(iOS)
/// The system share sheet for a made PDF: Save to Files, Print, Mail, AirDrop …
struct DiaryShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
#endif

/// A PNG made by the web host as a SwiftUI image.
enum DiaryImage {
    static func image(_ data: Data) -> Image? {
        #if os(iOS)
        UIImage(data: data).map { Image(uiImage: $0) }
        #else
        NSImage(data: data).map { Image(nsImage: $0) }
        #endif
    }
}

/// `-FXDiaryExport 1` writes what the export made next to the app's temporary files (diary-export.json), so the PDF can
/// be checked from outside the app: its path, page count and page size as PDFKit reads them, and what was expected.
@MainActor
enum DiaryExportReport {
    static func write(url: URL?, model: DiaryModel, seconds: Double) {
        var report: [String: Any] = ["seconds": (seconds * 10).rounded() / 10]
        if let url, let pdf = PDFDocument(url: url), let first = pdf.page(at: 0) {
            let box = first.bounds(for: .mediaBox)
            report["path"] = url.path
            report["pdfPages"] = pdf.pageCount
            report["widthPt"] = box.width
            report["heightPt"] = box.height
            report["widthMM"] = (box.width * 25.4 / 72 * 10).rounded() / 10
            report["heightMM"] = (box.height * 25.4 / 72 * 10).rounded() / 10
            report["bytes"] = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        }
        if let plan = model.plan {
            report["diaryPages"] = plan.pages.count
            report["expectedPdfPages"] = plan.sheets
            report["expectedMM"] = [plan.paper.width, plan.paper.height]
            report["title"] = plan.title
        }
        if case .failed(let why) = model.export { report["error"] = why }
        report["method"] = model.lastMethod ?? "-"
        let out = FileManager.default.temporaryDirectory.appending(path: "diary-export.json")
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: out)
        }
    }
}
