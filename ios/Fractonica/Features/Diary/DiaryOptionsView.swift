import FractonicaKit
import SwiftUI

/// Every knob of the diary (src/ui/diary/form.js over `DIARY_DEFAULTS`), as a list of groups with their current
/// values, each opening its own form. Changes replan the book at once; the pages behind the sheet follow.
struct DiaryOptionsView: View {
    let model: DiaryModel
    /// A sheet has a Done button; the inspector is closed with its toolbar button.
    var showsDone = true

    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss
    @State private var confirmReset = false
    @State private var path: [DiaryOptionGroup] = DiaryLaunch.string("FXDiaryGroup").flatMap(DiaryOptionGroup.init).map { [$0] } ?? []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                summary
                Section {
                    ForEach(DiaryOptionGroup.allCases.filter { $0.isShown(pure: settings.pure) }) { group in
                        NavigationLink(value: group) {
                            groupRow(group)
                        }
                    }
                }
                Section {
                    Button("Copy options", systemImage: "doc.on.doc") {
                        DiaryClipboard.copy(model.optionsJSON)
                        toasts.show("Options copied: save them as a file for node tools/diary-pdf.mjs --options")
                    }
                    Button("Reset to defaults", systemImage: "arrow.counterclockwise", role: .destructive) {
                        confirmReset = true
                    }
                    .disabled(model.options == DiaryOptions())
                } footer: {
                    Text("The options are the web app’s: the same JSON drives the Diary tab and the command line.")
                }
            }
            .scrollContentBackground(.hidden)
            .background { Backdrop() }
            .navigationTitle("Options")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationDestination(for: DiaryOptionGroup.self) { group in
                DiaryOptionForm(model: model, group: group)
            }
            .confirmationDialog("Reset every diary option to its default?", isPresented: $confirmReset, titleVisibility: .visible) {
                Button("Reset", role: .destructive) {
                    model.resetOptions()
                    Haptics.play(.warning)
                }
            }
            #if os(iOS)
            .toolbar {
                if showsDone {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
            }
            #endif
        }
    }

    // MARK: Summary

    @ViewBuilder
    private var summary: some View {
        let o = model.effective
        let pure = settings.pure
        Section {
            if let plan = model.plan {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(verbatim: "\(plan.pages.count)")
                            .font(.reading(28, weight: .semibold))
                            .foregroundStyle(Theme.ink)
                            .contentTransition(.numericText())
                        Text(verbatim: "pages · \((plan.pages.count + 1) / 2) sheets")
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink2)
                        Spacer()
                        if !model.isCurrent {
                            ProgressView().controlSize(.small)
                        }
                    }
                    Text(DiaryPrint.printLine(o, pages: plan.pages.count, pure: pure))
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2)
                    Text(facts(plan))
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                }
                .padding(.vertical, 4)
                .animation(.snappy, value: plan.pages.count)
            } else {
                HStack {
                    ProgressView().controlSize(.small)
                    Text("Planning the diary…").foregroundStyle(Theme.ink2)
                }
            }
        } header: {
            Text(model.plan?.delta.name ?? "This diary")
        }
    }

    private func facts(_ plan: DiaryPlan) -> String {
        var parts = [DiaryPrint.lockReadout(plan.shape)]
        if plan.inserts > 0 { parts.append("\(plan.inserts) Delta \(plan.inserts == 1 ? "sheet" : "sheets")") }
        if plan.eclipses > 0 { parts.append("\(plan.eclipses) \(plan.eclipses == 1 ? "eclipse" : "eclipses")") }
        parts.append("\(plan.events) ephemeris \(plan.events == 1 ? "event" : "events")")
        return parts.joined(separator: " · ")
    }

    private func groupRow(_ group: DiaryOptionGroup) -> some View {
        HStack(spacing: 12) {
            Image(systemName: group.systemImage)
                .font(.body)
                .foregroundStyle(Theme.teal)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(group.title).foregroundStyle(Theme.ink)
                Text(group.summary(model.effective, model: model, pure: settings.pure, appZone: model.appZone))
                    .font(.caption)
                    .foregroundStyle(Theme.ink3)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}

/// The groups of the options form, in the web form's order.
enum DiaryOptionGroup: String, CaseIterable, Identifiable, Hashable {
    case paper, print, gregorian, front, lock, lined, canvases, semi, retro, inserts, events, sky, nav, style

    var id: String { rawValue }

    var title: String {
        switch self {
        case .paper: "Paper"
        case .print: "Print"
        case .gregorian: "Gregorian"
        case .front: "Front matter"
        case .lock: "Lock pattern"
        case .lined: "Lined pages"
        case .canvases: "Canvases"
        case .semi: "Semi-pentad"
        case .retro: "Retrospection Helion"
        case .inserts: "Inserts and closing"
        case .events: "Events"
        case .sky: "Sky over the place"
        case .nav: "Edge references"
        case .style: "Ink and type"
        }
    }

    var systemImage: String {
        switch self {
        case .paper: "doc"
        case .print: "printer"
        case .gregorian: "calendar"
        case .front: "book.closed"
        case .lock: "square.stack.3d.up"
        case .lined: "line.3.horizontal"
        case .canvases: "squareshape.split.3x3"
        case .semi: "rectangle.split.2x2"
        case .retro: "arrow.counterclockwise.circle"
        case .inserts: "rectangle.portrait.on.rectangle.portrait"
        case .events: "moon.stars"
        case .sky: "sun.horizon"
        case .nav: "bookmark"
        case .style: "paintpalette"
        }
    }

    /// Pure mode has no Gregorian references at all.
    func isShown(pure: Bool) -> Bool { !(pure && self == .gregorian) }

    /// The group's current values in a few words (form.js `summaries`).
    @MainActor
    func summary(_ o: DiaryOptions, model: DiaryModel, pure: Bool, appZone: String) -> String {
        switch self {
        case .paper:
            return DiaryPrint.paperLabel(o.page.size, page: o.page, pure: pure)
        case .print:
            return o.print.twoUp ? "2 per sheet · \(DiaryPrint.pairingWords(o.print))" : "one page per sheet"
        case .gregorian:
            return o.gregorian.on ? "On · \((o.gregorian.zone ?? appZone).replacingOccurrences(of: "_", with: " "))" : "Off"
        case .front:
            let f = o.front
            var on: [String] = []
            if f.cover { on.append("cover") }
            if f.index { on.append("index") }
            if !pure, o.gregorian.on, f.gregorianIndex { on.append("Gregorian") }
            if f.ephemeris { on.append("ephemeris") }
            if f.reference { on.append("reference") }
            let n = f.planning + f.predictions
            let parts = [on.joined(separator: ", "), n > 0 ? "\(n) writing \(n == 1 ? "page" : "pages")" : ""].filter { !$0.isEmpty }
            return parts.isEmpty ? "none" : parts.joined(separator: " · ")
        case .lock:
            return o.lock.sheets.map { "\($0[0])+\($0[1])" }.joined(separator: " · ")
        case .lined:
            return "\(o.lined.linesPerHelion) lines per Helion"
        case .canvases:
            return o.canvases.map(DiaryOptionGroup.canvasText).joined(separator: " · ")
        case .semi:
            return o.semi.allCanvas ? "4 canvases: \(o.semi.canvases.map(DiaryOptionGroup.canvasText).joined(separator: " · "))" : "like the other sheets"
        case .retro:
            return "\(o.retro.lines) lines · \(o.retro.canvases.count) canvas \(o.retro.canvases.count == 1 ? "page" : "pages")"
        case .inserts:
            let s = o.closing.summaryPages
            return "\(o.inserts.deltaQuarters ? "Delta sheets" : "no Delta sheets") · \(o.inserts.eclipses ? "eclipse sheets" : "no eclipse sheets") · \(s) summary \(s == 1 ? "page" : "pages")"
        case .events:
            let n = DiaryEventFlag.allCases.filter { o.events[keyPath: $0.keyPath] }.count
            let all = DiaryEventFlag.allCases.count
            return n == all ? "all" : n > 0 ? "\(n) of \(all)" : "none"
        case .sky:
            guard o.sky.on else { return "off" }
            if o.sky.lat != nil, o.sky.lon != nil { return o.sky.place ?? "custom place" }
            return model.plan?.zoneCity?.place ?? "the zone’s city"
        case .nav:
            return o.nav.on ? "on" : "off"
        case .style:
            return "\(o.style.ink == "color" ? "colour" : "black") · \(o.style.font)"
        }
    }

    static func canvasText(_ c: DiaryOptions.Canvas) -> String {
        switch c.kind {
        case .grid: "grid \(c.cols ?? 19) × \(c.rows ?? 13)"
        case .dotGrid: "dot grid \(c.cols ?? 19) × \(c.rows ?? 13)"
        case .dots: "\(c.count ?? 240) dots"
        case .lined: "\(c.lines ?? 18) lines"
        case .nuclideGrid: "Nuclide grid"
        case .blank: "blank"
        }
    }
}

/// The event families of the ephemeris and the clock's own ticks (form.js "Events"), in its order.
enum DiaryEventFlag: CaseIterable, Identifiable {
    case synodic, anomalistic, draconic, sidereal, quarters, solar, lunistices, crossQuarters, eclipses, planets, solarSync, majors

    var id: Self { self }

    var keyPath: WritableKeyPath<DiaryOptions.Events, Bool> {
        switch self {
        case .synodic: \.synodic
        case .anomalistic: \.anomalistic
        case .draconic: \.draconic
        case .sidereal: \.sidereal
        case .quarters: \.quarters
        case .solar: \.solar
        case .lunistices: \.lunistices
        case .crossQuarters: \.crossQuarters
        case .eclipses: \.eclipses
        case .planets: \.planets
        case .solarSync: \.solarSync
        case .majors: \.majors
        }
    }

    /// The label; pure mode drops "month" and "days".
    func title(pure: Bool) -> String {
        let month = pure ? "" : " month"
        switch self {
        case .synodic: return "Lunar phases (synodic\(month))"
        case .anomalistic: return "Perigee and apogee (anomalistic\(month))"
        case .draconic: return "Lunar nodes (draconic\(month))"
        case .sidereal: return "Galactic centre (sidereal\(month))"
        case .quarters: return "Quarter events"
        case .solar: return "Equinoxes, solstices, perihelion, aphelion"
        case .lunistices: return "Lunistices"
        case .crossQuarters: return pure ? "Cross-quarter points" : "Cross-quarter days"
        case .eclipses: return "Eclipses"
        case .planets: return "Planets"
        case .solarSync: return "Solar syncs"
        case .majors: return "Major thresholds"
        }
    }

    var hint: String? {
        switch self {
        case .synodic: "New moon, first quarter, full moon, last quarter"
        case .anomalistic: nil
        case .draconic: "The Moon crosses the ecliptic northward or southward"
        case .sidereal: "The Moon passes the galactic centre, then its opposite, the anticentre"
        case .quarters: "Halfway points: post-perigee, post-apogee, post-node, post-centre, post-anticentre"
        case .solar: nil
        case .lunistices: "The Moon farthest north and farthest south"
        case .crossQuarters: "Halfway between equinoxes and solstices: 45°, 135°, 225°, 315°"
        case .eclipses: "Solar and lunar, with their type"
        case .planets: "Mercury and Venus elongations and conjunctions; Mars, Jupiter, Saturn oppositions and conjunctions"
        case .solarSync: "The start of each sync (19 Helions) as a tick"
        case .majors: "Quarter thresholds of Alpha … Delta as ticks"
        }
    }

    var systemImage: String {
        switch self {
        case .synodic: "moonphase.first.quarter"
        case .anomalistic: "arrow.left.and.right.circle"
        case .draconic: "arrow.up.and.down.circle"
        case .sidereal: "sparkles"
        case .quarters: "circle.lefthalf.filled"
        case .solar: "sun.max"
        case .lunistices: "arrow.up.arrow.down"
        case .crossQuarters: "plus.circle"
        case .eclipses: "circle.circle"
        case .planets: "globe.europe.africa"
        case .solarSync: "sun.horizon"
        case .majors: "flag"
        }
    }
}
