import FractonicaKit
import Foundation
import Observation

/// What the month screen shows and remembers: the Gregorian month (or, in pure mode, the Delta page), whether it follows
/// the displayed time, the bands of the day cells, the week start and the selected day. Grids are built once per
/// (month, zone, week start, bands) and cached: nothing is recomputed per frame. Shared so a visit to another screen
/// keeps the page; the bands and the week start persist under `calendar.`.
@MainActor @Observable
final class MonthModel {
    static let shared = MonthModel()

    // MARK: Earth: the month

    /// The month shown (`CalMath.monthIndex`).
    var month: Int = CalMath.monthIndex(year: 2026, month: 10)
    /// The page follows the displayed time until the person navigates away.
    var follows = true
    /// The month and the Delta page of the displayed time, kept by the screens' clock timelines.
    private(set) var displayedMonth: Int?
    private(set) var displayedPage: Int?
    /// The day whose detail is open: its date.
    var selectedDay: DayRef?
    var showsDetail = false

    var bands: [CalendarBand] {
        didSet { save() }
    }

    /// 1 Monday, 0 Sunday.
    var weekStart: Int {
        didSet { save() }
    }

    struct DayRef: Hashable, Sendable {
        let year: Int
        let month: Int
        let day: Int
    }

    // MARK: Pure: the Delta page

    var page: Int = 0
    var pageFollows = true
    var selectedCell: Int?
    var pageStep: PageStep {
        didSet { UserDefaults.standard.set(pageStep.rawValue, forKey: Self.stepKey) }
    }

    /// What ◀ ▶ step by on the Delta page.
    enum PageStep: Int, CaseIterable, Identifiable, Sendable {
        case delta = 1, gamma = 5, beta = 65, alpha = 325
        var id: Int { rawValue }
        var name: String {
            switch self {
            case .delta: "Delta"
            case .gamma: "Gamma"
            case .beta: "Beta"
            case .alpha: "Alpha"
            }
        }
        var level: Int {
            switch self {
            case .delta: 3
            case .gamma: 2
            case .beta: 1
            case .alpha: 0
            }
        }
    }

    // MARK: Launch

    var scrollTarget: String?
    /// -FXMonthPick: open the month (or Delta) picker once the screen is up.
    var launchPick = false
    @ObservationIgnored private var launched = false

    // MARK: Caches

    @ObservationIgnored private var grids: [String: MonthGrid] = [:]
    @ObservationIgnored private var ribbons: [String: YearRibbon] = [:]
    @ObservationIgnored private var pages: [Int: DeltaPage] = [:]
    @ObservationIgnored private var syncs: ClosedRange<Int>?

    private static let bandsKey = "calendar.month.bands"
    private static let weekKey = "calendar.month.weekStart"
    private static let stepKey = "calendar.pure.step"

    init() {
        let d = UserDefaults.standard
        let stored = (d.stringArray(forKey: Self.bandsKey) ?? []).compactMap(CalendarBand.init(key:))
        bands = stored.isEmpty ? [.level(4), .level(6)] : Array(stored.prefix(Self.maxBands))
        let week = d.object(forKey: Self.weekKey) as? Int
        weekStart = week == 0 || week == 1 ? week! : (Calendar.current.firstWeekday == 1 ? 0 : 1)
        pageStep = PageStep(rawValue: d.integer(forKey: Self.stepKey)) ?? .delta
    }

    /// At most three bands share a cell.
    static let maxBands = 3

    private func save() {
        UserDefaults.standard.set(bands.map(\.key), forKey: Self.bandsKey)
        UserDefaults.standard.set(weekStart, forKey: Self.weekKey)
    }

    /// Toggle a band; a fourth one replaces the oldest. The order is kept coarse to fine.
    func toggle(_ band: CalendarBand) {
        var next = bands
        if let i = next.firstIndex(of: band) {
            guard next.count > 1 else { return }
            next.remove(at: i)
        } else {
            if next.count >= Self.maxBands { next.removeFirst() }
            next.append(band)
        }
        bands = next.sorted { order($0) < order($1) }
    }

    private func order(_ band: CalendarBand) -> Int {
        switch band {
        case .level(let l): l
        case .sync: 100
        }
    }

    var syncRange: ClosedRange<Int> {
        if let syncs { return syncs }
        let r = CalMath.syncRange(.shared)
        syncs = r
        return r
    }

    /// The grid of a month, built once.
    func grid(_ index: Int, zone: TimeZone) -> MonthGrid {
        let key = "\(index)|\(zone.identifier)|\(weekStart)|\(bands.map(\.key).joined(separator: ","))"
        if let g = grids[key] { return g }
        if grids.count > 48 { grids.removeAll() }
        let (y, m) = CalMath.yearMonth(index)
        let g = MonthGrid(clock: .shared, zone: zone, year: y, month: m, weekStart: weekStart, bands: bands, syncRange: syncRange)
        grids[key] = g
        return g
    }

    func ribbon(_ year: Int, zone: TimeZone) -> YearRibbon {
        let key = "\(year)|\(zone.identifier)"
        if let r = ribbons[key] { return r }
        if ribbons.count > 24 { ribbons.removeAll() }
        let r = YearRibbon(clock: .shared, zone: zone, year: year)
        ribbons[key] = r
        return r
    }

    func deltaPage(_ index: Int) -> DeltaPage {
        if let p = pages[index] { return p }
        if pages.count > 48 { pages.removeAll() }
        let p = DeltaPage(clock: .shared, index: index, syncRange: syncRange)
        pages[index] = p
        return p
    }

    // MARK: Navigation

    /// Show a month the person chose (stops following).
    func show(month index: Int) {
        month = CalMath.clampMonth(index)
        follows = false
    }

    /// The month of a moment in a zone.
    static func monthIndex(of t: Double, zone: TimeZone) -> Int {
        let p = EarthTime.zonedParts(t, zone: zone)
        return CalMath.clampMonth(CalMath.monthIndex(year: p.year, month: p.month))
    }

    /// Follow the displayed time: the page moves with it while `follows`.
    func follow(_ t: Double, zone: TimeZone) {
        let m = Self.monthIndex(of: t, zone: zone)
        if displayedMonth != m { displayedMonth = m }
        guard follows else { return }
        if m != month { month = m }
    }

    func followPage(_ t: Double) {
        let p = DeltaPage.page(.shared, at: t)
        if displayedPage != p { displayedPage = p }
        guard pageFollows, let p else { return }
        if p != page { page = p }
    }

    /// The launch arguments, once (-FXMonth, -FXMonthBands, -FXMonthDay, -FXCalendarScroll).
    func applyLaunchOptions(zone: TimeZone, displayed t: Double) {
        guard !launched else { return }
        launched = true
        if let keys = CalendarLaunch.string("FXMonthBands") {
            let b = keys.split(separator: ",").compactMap { CalendarBand(key: String($0)) }
            if !b.isEmpty { bands = Array(b.prefix(Self.maxBands)) }
        }
        if let ym = CalendarLaunch.string("FXMonth"), let m = ym.wholeMatch(of: /(\d{4})-(\d{1,2})/), let y = Int(m.1), let mo = Int(m.2), (1...12).contains(mo) {
            show(month: CalMath.monthIndex(year: y, month: mo))
        } else {
            month = Self.monthIndex(of: t, zone: zone)
        }
        if let d = CalendarLaunch.int("FXMonthDay") {
            let (y, m) = CalMath.yearMonth(month)
            if (1...EarthTime.daysInMonth(y, m)).contains(d) {
                selectedDay = DayRef(year: y, month: m, day: d)
                showsDetail = true
            }
            if (0..<DeltaPage.cells).contains(d) {
                selectedCell = d
            }
        }
        if let p = DeltaPage.page(.shared, at: t) { page = p }
        scrollTarget = CalendarLaunch.string("FXCalendarScroll")
        launchPick = CalendarLaunch.int("FXMonthPick") == 1
    }
}
