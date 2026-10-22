import Foundation
import Observation
import WebKit

/// The Diary's state: the chosen Delta, the options, the page on show, the plan the web host made and the export.
/// One instance for the app (`shared`), so leaving the screen keeps the planned book and its web view.
///
/// Planning happens only when the Delta, the options, the mode or the zone change (debounced), never per frame.
/// Options persist under `diary.options.v1` (the web app's options JSON), the screen's own state under `diary.ui.v1`.
@MainActor @Observable
final class DiaryModel {
    static let shared = DiaryModel()

    enum Layout: String, Codable, Sendable { case page, spread }

    enum Phase: Equatable, Sendable {
        /// The web host is loading its modules.
        case loading
        case planning
        case ready
        case failed(String)
    }

    enum Export: Equatable, Sendable {
        case idle
        /// Drawing pages, 0…1 (nil before the first page).
        case working(Double?)
        case done(URL)
        case failed(String)
    }

    // MARK: Persisted

    /// The options as the reader set them (Gregorian settings kept in pure mode; `effective` applies the mode).
    var options: DiaryOptions {
        didSet {
            if options != oldValue { saveOptions(); schedule() }
        }
    }

    /// Follow the displayed time: the diary is the Delta that holds it.
    private(set) var follow: Bool
    private(set) var delta: Int
    private(set) var layout: Layout

    // MARK: From the web host

    private(set) var plan: DiaryPlan?
    private(set) var phase: Phase = .loading
    /// The page on show (in a spread, the page asked for or the recto) and the pages of the spread.
    private(set) var page: Int
    private(set) var pair: [Int?] = [1]
    private(set) var spread = false
    /// Wide enough for spreads.
    private(set) var wide = false
    /// The page that holds the displayed moment, when it lies in this Delta.
    private(set) var shownPage: Int?
    private(set) var export: Export = .idle
    /// How the last PDF was made (`DiaryPDFMaker.Method`), for the export report.
    @ObservationIgnored private(set) var lastMethod: String?
    /// The last page tapped in the preview (the screen opens it large).
    var tapped: Int?

    let range = DiaryDelta.range()

    // MARK: Environment

    private(set) var pure = false
    private(set) var appZone = TimeZone.current.identifier

    @ObservationIgnored private var started = false
    /// The displayed time of the last update, for marking its page once a new plan is in.
    @ObservationIgnored private var lastTime: Double?
    @ObservationIgnored private lazy var engine: DiaryWebEngine = makeEngine()
    @ObservationIgnored private var pending: Task<Void, Never>?
    @ObservationIgnored private var token = 0
    @ObservationIgnored private var exportTask: Task<Void, Never>?
    @ObservationIgnored private var lastExport: (key: String, url: URL)?
    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private var thumbnails: [String: Data] = [:]

    private static let optionsKey = "diary.options.v1"
    private static let uiKey = "diary.ui.v1"

    private struct UIState: Codable {
        var follow = true
        var delta: Int?
        var page = 1
        var layout = Layout.spread
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        options = defaults.data(forKey: Self.optionsKey).flatMap { try? JSONDecoder().decode(DiaryOptions.self, from: $0) }?.sanitized() ?? DiaryOptions()
        let ui = defaults.data(forKey: Self.uiKey).flatMap { try? JSONDecoder().decode(UIState.self, from: $0) } ?? UIState()
        follow = ui.follow
        delta = min(range.upperBound, max(range.lowerBound, ui.delta ?? range.lowerBound))
        page = max(1, ui.page)
        layout = ui.layout
    }

    /// The web view that shows the pages.
    var webView: WKWebView { engine.webView }

    /// The options as the renderer reads them in the current mode.
    var effective: DiaryOptions { options.sanitized(pure: pure) }

    var lockShape: DiaryPrint.LockShape { DiaryPrint.lockShape(effective) }

    var path: [Int] { DiaryDelta.path(of: delta) }

    var span: (t0: Double, t1: Double)? { DiaryDelta.span(delta) }

    /// The plan matches what is asked (not a plan of a previous Delta or of other options).
    var isCurrent: Bool { plan?.token == token && phase == .ready }

    // MARK: Inputs from the screen

    /// The screen appeared, or the mode, the zone or the displayed time changed.
    func update(pure: Bool, zone: String, time t: Double) {
        var changed = !started
        if pure != self.pure || zone != appZone {
            self.pure = pure
            appZone = zone
            changed = true
        }
        if follow {
            let d = DiaryDelta.index(at: t, range: range)
            if d != delta {
                delta = d
                saveUI()
                changed = true
            }
        }
        if !started {
            started = true
            if let override = DiaryLaunch.int("FXDiaryPage") { page = override }
            if let override = DiaryLaunch.string("FXDiaryLayout"), let l = Layout(rawValue: override) { layout = l }
        }
        if changed { schedule(immediately: plan == nil) }
        lastTime = t
        refreshShown()
    }

    func setFollow(_ on: Bool, time t: Double) {
        follow = on
        if on { delta = DiaryDelta.index(at: t, range: range) }
        saveUI()
        schedule()
    }

    /// Choose a Delta (stops following the displayed time).
    func choose(delta index: Int) {
        let d = min(range.upperBound, max(range.lowerBound, index))
        follow = false
        guard d != delta else { saveUI(); return }
        delta = d
        saveUI()
        schedule()
    }

    func choose(path: [Int]) {
        choose(delta: DiaryDelta.clamp(path, range: range))
    }

    func setLayout(_ l: Layout) {
        layout = l
        engine.setLayout(l.rawValue)
        saveUI()
    }

    func go(to no: Int, smooth: Bool = true) {
        let n = plan?.pages.count ?? no
        engine.go(to: min(max(1, no), max(1, n)), smooth: smooth)
    }

    func step(_ direction: Int) { engine.step(direction) }

    func setInsets(top: Double, bottom: Double, horizontal: Double) {
        engine.setInsets(top: top, bottom: bottom, horizontal: horizontal)
    }

    func resetOptions() { options = DiaryOptions() }

    /// The options as JSON, for `node tools/diary-pdf.mjs --options`.
    var optionsJSON: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(options)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    // MARK: Planning

    private func makeEngine() -> DiaryWebEngine {
        let e = DiaryWebEngine()
        e.onMessage = { [weak self] message in self?.receive(message) }
        e.onReload = { [weak self] in
            self?.phase = .loading
            self?.schedule(immediately: true)
        }
        return e
    }

    private func schedule(immediately: Bool = false) {
        token += 1
        let request = DiaryWebEngine.Request(token: token, delta: delta, options: options, appZone: appZone, pureMode: pure,
                                             page: page, layout: layout.rawValue)
        if phase != .loading { phase = .planning }
        pending?.cancel()
        pending = Task { [engine] in
            if !immediately { try? await Task.sleep(for: .milliseconds(220)) }
            guard !Task.isCancelled else { return }
            await engine.configure(request)
        }
    }

    private func receive(_ message: DiaryHostMessage) {
        switch message {
        case .ready:
            if phase == .loading { phase = .planning }
        case .progress(let t):
            if t == token { phase = .planning }
        case .plan(let p):
            guard p.token == token else { return }
            diaryLog.notice("plan \(p.token): \(p.pages.count) pages, final \(p.final)")
            if plan?.delta.idx != p.delta.idx || plan?.pages.count != p.pages.count { thumbnails.removeAll() }
            plan = p
            phase = .ready
            refreshShown()
        case .page(let no, let pair, let spread, let wide):
            page = no
            self.pair = pair
            self.spread = spread
            self.wide = wide
            saveUI()
        case .tap(let no):
            tapped = no
        case .error(let t, let message):
            diaryLog.error("host error (\(t ?? -1)): \(message, privacy: .public)")
            if t == nil || t == token { phase = .failed(message) }
        }
    }

    /// Marks the page that holds the displayed time (none when it lies outside the planned Delta).
    private func refreshShown() {
        let t = lastTime
        Task { [engine] in
            let no = await engine.setShown(t)
            if no != shownPage { shownPage = no }
        }
    }

    // MARK: Pages

    /// One page as SVG markup, once a plan is in (waits for the first one).
    func svg(page no: Int) async -> String? {
        await waitForPlan()
        return await engine.svg(page: no)
    }

    private func waitForPlan() async {
        let deadline = Date.now.addingTimeInterval(60)
        while plan == nil, Date.now < deadline, !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    /// A page as PNG, `pixels` wide; remembered per plan.
    func thumbnail(page no: Int, pixels: Int) async -> Data? {
        let key = "\(token)|\(no)|\(pixels)"
        if let hit = thumbnails[key] { return hit }
        guard isCurrent, let data = await engine.thumbnail(page: no, pixels: pixels) else { return nil }
        if thumbnails.count > 400 { thumbnails.removeAll() }
        thumbnails[key] = data
        return data
    }

    // MARK: Export

    /// Makes the PDF of the planned diary (or returns the one made for the same plan) in the temporary folder.
    func makePDF(method: DiaryPDFMaker.Method = .automatic) async -> URL? {
        exportTask?.cancel()
        export = .working(nil)
        let key = "\(delta)|\(pure)|\(appZone)|\(optionsJSON)"
        if let last = lastExport, last.key == key, FileManager.default.fileExists(atPath: last.url.path), plan?.final == true {
            export = .done(last.url)
            return last.url
        }
        do {
            // the exported book has its maps: wait for the final plan
            let deadline = Date.now.addingTimeInterval(90)
            while !(isCurrent && plan?.final == true) {
                if case .failed(let why) = phase { throw DiaryError.pdf(why) }
                if Date.now > deadline { throw DiaryError.pdf("The diary could not be planned.") }
                try await Task.sleep(for: .milliseconds(100))
            }
            let doc = try await engine.printDocument()
            let maker = DiaryPDFMaker()
            let result = try await maker.make(doc, method: method) { [weak self] p in self?.export = .working(p) }
            lastMethod = result.method.rawValue
            let folder = FileManager.default.temporaryDirectory.appending(path: "Diary", directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appending(path: Self.fileName(doc.title))
            try result.data.write(to: url, options: .atomic)
            lastExport = (key, url)
            diaryLog.notice("PDF \(result.pages) pages, \(result.method.rawValue, privacy: .public): \(url.path, privacy: .public)")
            export = .done(url)
            return url
        } catch {
            diaryLog.error("PDF failed: \(error.localizedDescription, privacy: .public)")
            export = .failed(error.localizedDescription)
            return nil
        }
    }

    func clearExport() {
        if case .working = export { return }
        export = .idle
    }

    /// "Diary · Delta Trifracton (α#6 β#4 γ#9 δ#3).pdf", safe for every file system.
    static func fileName(_ title: String) -> String {
        let cleaned = title.map { "/\\:?*\"<>|".contains($0) ? "-" : $0 }
        return String(cleaned).trimmingCharacters(in: .whitespaces) + ".pdf"
    }

    // MARK: Persistence

    private func saveOptions() {
        if let data = try? JSONEncoder().encode(options) { defaults.set(data, forKey: Self.optionsKey) }
    }

    private func saveUI() {
        let ui = UIState(follow: follow, delta: delta, page: page, layout: layout)
        if let data = try? JSONEncoder().encode(ui) { defaults.set(data, forKey: Self.uiKey) }
    }
}

/// The Diary's own launch arguments (`-FXDiary… value`, read from the argument domain, never saved).
enum DiaryLaunch {
    static func string(_ name: String) -> String? {
        UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)[name].map { "\($0)" }
    }

    static func int(_ name: String) -> Int? {
        string(name).flatMap { Int($0) }
    }

    static func flag(_ name: String) -> Bool {
        string(name).map { ["1", "true", "yes"].contains($0.lowercased()) } ?? false
    }
}
