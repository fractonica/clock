import Foundation

/// Every knob of the printed diary of one Delta: `DIARY_DEFAULTS` of src/diary/options.js, encoded exactly as the web
/// app stores it, so the JSON goes straight into the web renderer's `sanitizeDiaryOptions` (and is the same file
/// `node tools/diary-pdf.mjs --options` reads). `sanitized(pure:)` repeats that validation natively, so the form only
/// ever shows values the renderer will use (checked against the JavaScript in Checks/).
struct DiaryOptions: Codable, Equatable, Sendable {
    var page = Page()
    var nav = Nav()
    var gregorian = Gregorian()
    var front = Front()
    var lock = Lock()
    var lined = Lined()
    var canvases: [Canvas] = DiaryOptions.defaultCanvases
    var semi = Semi()
    var retro = Retro()
    var inserts = Inserts()
    var events = Events()
    var sky = Sky()
    var closing = Closing()
    var style = Style()
    var print = Print()

    // MARK: Groups

    struct Page: Codable, Equatable, Sendable {
        /// A named size (`PaperSize`) or "custom" with `width` × `height`.
        var size = PaperSize.a5.rawValue
        var width = 148.0
        var height = 210.0
        var margins = Margins()
    }

    struct Margins: Codable, Equatable, Sendable {
        var top = 12.0
        var bottom = 12.0
        /// At the binding.
        var inner = 16.0
        /// Carries the time ticks.
        var outer = 20.0
    }

    /// The thumb index along the outer edge.
    struct Nav: Codable, Equatable, Sendable {
        var on = true
    }

    /// Gregorian references; forced off in pure mode. `zone` nil = the app's zone.
    struct Gregorian: Codable, Equatable, Sendable {
        var on = true
        var zone: String?
        var weekdays = true
    }

    struct Front: Codable, Equatable, Sendable {
        var cover = false
        var index = true
        var gregorianIndex = true
        var ephemeris = true
        /// The reference sheet: the period ladder, the milestones of Alpha, Beta and Gamma.
        var reference = true
        var planning = 1
        var predictions = 1
    }

    /// One solar lock: sheets of [lined Helions on the front, canvas Helions on the back].
    struct Lock: Codable, Equatable, Sendable {
        var sheets: [[Int]] = DiaryOptions.defaultSheets
    }

    struct Lined: Codable, Equatable, Sendable {
        var linesPerHelion = 12
        /// "preon" (0ι 3ι …), "both" (+ Gregorian time) or "none".
        var labels = "both"
        var marginGlyphs = true
        var marginCurve = true
    }

    /// What a canvas page carries; the parameters that do not apply to its type are absent (nil), as in the web app.
    struct Canvas: Codable, Equatable, Sendable, Hashable {
        var type: String
        var cols: Int?
        var rows: Int?
        var count: Int?
        var lines: Int?

        init(_ type: CanvasType, cols: Int? = nil, rows: Int? = nil, count: Int? = nil, lines: Int? = nil) {
            self.type = type.rawValue
            self.cols = cols
            self.rows = rows
            self.count = count
            self.lines = lines
        }

        var kind: CanvasType { CanvasType(rawValue: type) ?? .blank }
    }

    struct Semi: Codable, Equatable, Sendable {
        var allCanvas = true
        var canvases: [Canvas] = Array(repeating: Canvas(.blank), count: 4)
    }

    struct Retro: Codable, Equatable, Sendable {
        var lines = 36
        var canvases: [Canvas] = [Canvas(.blank), Canvas(.nuclideGrid)]
    }

    struct Inserts: Codable, Equatable, Sendable {
        var deltaQuarters = true
        var eclipses = true
    }

    struct Events: Codable, Equatable, Sendable {
        var synodic = true
        var anomalistic = true
        var draconic = true
        var sidereal = true
        var quarters = true
        var solar = true
        var solarSync = true
        var majors = true
        var lunistices = true
        var crossQuarters = true
        var eclipses = true
        var planets = true
    }

    /// The local sky. `lat` / `lon` nil = the main city of the diary's zone; `dot` the mark diameter in mm.
    struct Sky: Codable, Equatable, Sendable {
        var on = true
        var lat: Double?
        var lon: Double?
        var place: String?
        var dot = 1.1
    }

    struct Closing: Codable, Equatable, Sendable {
        var summaryPages = 4
    }

    struct Style: Codable, Equatable, Sendable {
        /// "color" or "mono".
        var ink = "color"
        /// "sans" or "serif".
        var font = "sans"
    }

    struct Print: Codable, Equatable, Sendable {
        var twoUp = false
        /// "spreads", "sequential" or "duplex".
        var pairing = "spreads"
        /// "side" or "top".
        var turn = "side"
    }

    // MARK: Defaults

    static let defaultSheets = [[3, 2], [3, 2], [3, 2], [2, 2]]
    static let defaultCanvases = [Canvas(.grid, cols: 19, rows: 13), Canvas(.blank)]
    static let maxSheets = 8
    static let maxCanvases = 8
}

// MARK: - Choices

/// Paper sizes in millimetres, portrait (`PAGE_SIZES`).
enum PaperSize: String, CaseIterable, Identifiable, Sendable {
    case a6 = "A6", a5 = "A5", b5 = "B5", a4 = "A4", halfLetter = "Half Letter", letter = "Letter", traveler = "Traveler"
    case custom

    var id: String { rawValue }

    /// Width × height in mm; nil for custom.
    var dimensions: (width: Double, height: Double)? {
        switch self {
        case .a6: (105, 148)
        case .a5: (148, 210)
        case .b5: (176, 250)
        case .a4: (210, 297)
        case .halfLetter: (139.7, 215.9)
        case .letter: (215.9, 279.4)
        case .traveler: (110, 210)
        case .custom: nil
        }
    }
}

/// What a canvas page can carry (`CANVAS_TYPES`).
enum CanvasType: String, CaseIterable, Identifiable, Sendable {
    case grid, dots, dotGrid = "dot-grid", lined, blank, nuclideGrid = "nuclide-grid"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .grid: "Square grid"
        case .dots: "Scattered dots"
        case .dotGrid: "Dot grid"
        case .lined: "Lined"
        case .blank: "Blank"
        case .nuclideGrid: "Nuclide grid 7 × 11"
        }
    }

    var systemImage: String {
        switch self {
        case .grid: "squareshape.split.3x3"
        case .dots: "circle.dotted"
        case .dotGrid: "circle.grid.3x3"
        case .lined: "line.3.horizontal"
        case .blank: "rectangle.portrait"
        case .nuclideGrid: "tablecells"
        }
    }
}

// MARK: - Validation (sanitizeDiaryOptions)

extension DiaryOptions {
    /// The options as the web renderer will read them: numbers clamped (and rounded where whole), unknown choices
    /// replaced by the defaults, lists cut to their limits; pure mode turns the Gregorian references off.
    func sanitized(pure: Bool = false) -> DiaryOptions {
        let d = DiaryOptions()
        var o = self

        let size = PaperSize(rawValue: page.size) ?? .a5
        o.page.size = size.rawValue
        if let dims = size.dimensions {
            o.page.width = DiaryMath.clamp(dims.width, 80, 420)
            o.page.height = DiaryMath.clamp(dims.height, 100, 600)
        } else {
            o.page.width = DiaryMath.number(page.width, d.page.width, 80, 420)
            o.page.height = DiaryMath.number(page.height, d.page.height, 100, 600)
        }
        o.page.margins.top = DiaryMath.number(page.margins.top, d.page.margins.top, 3, 40)
        o.page.margins.bottom = DiaryMath.number(page.margins.bottom, d.page.margins.bottom, 3, 40)
        o.page.margins.inner = DiaryMath.number(page.margins.inner, d.page.margins.inner, 3, 50)
        o.page.margins.outer = DiaryMath.number(page.margins.outer, d.page.margins.outer, 3, 50)

        if pure { o.gregorian.on = false }
        if let zone = gregorian.zone, zone.isEmpty { o.gregorian.zone = nil }

        o.front.planning = DiaryMath.integer(front.planning, 0, 12)
        o.front.predictions = DiaryMath.integer(front.predictions, 0, 12)
        if pure { o.front.gregorianIndex = false }

        o.lock.sheets = Self.lockSheets(lock.sheets)

        o.lined.linesPerHelion = DiaryMath.integer(lined.linesPerHelion, 1, 72)
        if !["preon", "both", "none"].contains(lined.labels) { o.lined.labels = d.lined.labels }

        o.canvases = Self.canvases(canvases, defaults: Self.defaultCanvases)
        o.semi.canvases = Self.canvases(semi.canvases, defaults: d.semi.canvases)
        o.retro.lines = DiaryMath.integer(retro.lines, 1, 144)
        o.retro.canvases = Self.canvases(retro.canvases, defaults: d.retro.canvases)

        o.sky.lat = sky.lat.flatMap { $0.isFinite ? DiaryMath.clamp($0, -90, 90) : nil }
        o.sky.lon = sky.lon.flatMap { $0.isFinite ? DiaryMath.clamp($0, -180, 180) : nil }
        let place = sky.place?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        o.sky.place = place.isEmpty ? nil : String(place.utf16Prefix(60))
        o.sky.dot = DiaryMath.number(sky.dot, d.sky.dot, 0.4, 3)

        o.closing.summaryPages = DiaryMath.integer(closing.summaryPages, 0, 16)
        if !["color", "mono"].contains(style.ink) { o.style.ink = d.style.ink }
        if !["sans", "serif"].contains(style.font) { o.style.font = d.style.font }
        if !["spreads", "sequential", "duplex"].contains(print.pairing) { o.print.pairing = d.print.pairing }
        if !["side", "top"].contains(print.turn) { o.print.turn = d.print.turn }
        return o
    }

    /// Lock sheets: 1…8 sheets of [front 1…4, back 0…4] Helions, at most 77 Helions in all (`lockSheets`).
    static func lockSheets(_ list: [[Int]]) -> [[Int]] {
        guard !list.isEmpty else { return defaultSheets }
        var out: [[Int]] = []
        var sum = 0
        for sheet in list.prefix(maxSheets) {
            let front = sheet.count > 0 ? DiaryMath.integer(sheet[0], 1, 4) : 3
            let back = sheet.count > 1 ? DiaryMath.integer(sheet[1], 0, 4) : 2
            if sum + front + back > 77 { break }
            out.append([front, back])
            sum += front + back
        }
        return out.isEmpty ? defaultSheets : out
    }

    /// A canvas list: the first 8, each valid for its type (`canvases` / `canvas`).
    static func canvases(_ list: [Canvas], defaults: [Canvas]) -> [Canvas] {
        let source = list.isEmpty ? defaults : Array(list.prefix(maxCanvases))
        return source.enumerated().map { i, c in canvas(c, default: i < defaults.count ? defaults[i] : defaults[defaults.count - 1]) }
    }

    static func canvas(_ c: Canvas, default d: Canvas) -> Canvas {
        let type = CanvasType(rawValue: c.type) ?? d.kind
        switch type {
        case .grid, .dotGrid:
            return Canvas(type, cols: DiaryMath.integer(c.cols, d.cols ?? 19, 1, 60), rows: DiaryMath.integer(c.rows, d.rows ?? 7, 1, 60))
        case .dots:
            return Canvas(type, count: DiaryMath.integer(c.count, d.count ?? 240, 0, 4000))
        case .lined:
            return Canvas(type, lines: DiaryMath.integer(c.lines, d.lines ?? 18, 1, 80))
        case .blank, .nuclideGrid:
            return Canvas(type)
        }
    }
}

// MARK: - Arithmetic shared with the web app

/// The number handling of src/diary/options.js and src/ui/diary/logic.js, exactly: `Math.round` rounds halves up.
enum DiaryMath {
    static func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }

    /// `Math.round`.
    static func round(_ v: Double) -> Double { (v + 0.5).rounded(.down) }

    /// `num(v, d, lo, hi)`: a finite value clamped, else the default.
    static func number(_ v: Double, _ d: Double, _ lo: Double, _ hi: Double) -> Double {
        clamp(v.isFinite ? v : d, lo, hi)
    }

    static func integer(_ v: Int, _ lo: Int, _ hi: Int) -> Int { min(hi, max(lo, v)) }

    static func integer(_ v: Int?, _ d: Int, _ lo: Int, _ hi: Int) -> Int { integer(v ?? d, lo, hi) }

    /// 148 → "148", 139.7 → "139.7" (`mm`).
    static func mm(_ v: Double) -> String {
        let r = round(v * 10) / 10
        return r == r.rounded() ? String(Int(r)) : String(format: "%.1f", r)
    }
}

private extension String {
    /// The first `n` UTF-16 units, as JavaScript's `slice(0, n)`, never splitting a surrogate pair.
    func utf16Prefix(_ n: Int) -> Substring {
        guard utf16.count > n else { return self[...] }
        var end = utf16.index(utf16.startIndex, offsetBy: n)
        while end > startIndex, String.Index(end, within: self) == nil { end = utf16.index(before: end) }
        return self[..<end]
    }
}
