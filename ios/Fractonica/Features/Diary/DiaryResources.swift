import Foundation
import os

/// The Diary's log (`log stream --predicate 'subsystem == "app.fractonica.clock" AND category == "diary"'`).
let diaryLog = Logger(subsystem: "app.fractonica.clock", category: "diary")

/// Where the diary host's files come from: `fxdiary://app/diary-host.html` and `diary-host.js` are this feature's
/// Resources/DiaryWeb files (flattened into the bundle root by the build), `fxdiary://app/web/…` is the copy of the web
/// app (fractonica.js, src/…) that ios/scripts/copy-web.sh puts into the bundle's web/ folder. Anything else, and any
/// path that tries to leave web/, is not found.
enum DiaryResources {
    static let scheme = "fxdiary"
    static let host = "app"
    static let entry = URL(string: "fxdiary://app/diary-host.html")!
    static let hostFiles: Set<String> = ["diary-host.html", "diary-host.js"]

    /// The file in `resources` (the bundle's resource folder) that serves `url`, or nil.
    static func file(for url: URL, resources: URL) -> URL? {
        guard url.scheme == scheme, url.host == host else { return nil }
        let parts = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard let first = parts.first, !parts.contains(where: { $0 == ".." || $0 == "." || $0.hasPrefix(".") }) else { return nil }
        if parts.count == 1, hostFiles.contains(first) { return resources.appending(path: first) }
        guard first == "web", parts.count > 1 else { return nil }
        return parts.dropFirst().reduce(resources.appending(path: "web", directoryHint: .isDirectory)) { $0.appending(path: $1) }
    }

    /// The Content-Type of a file: JavaScript modules only run when served as JavaScript.
    static func mimeType(for path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html", "htm": "text/html; charset=utf-8"
        case "js", "mjs": "text/javascript; charset=utf-8"
        case "json": "application/json; charset=utf-8"
        case "css": "text/css; charset=utf-8"
        case "svg": "image/svg+xml"
        case "png": "image/png"
        case "md", "txt": "text/plain; charset=utf-8"
        default: "application/octet-stream"
        }
    }
}
