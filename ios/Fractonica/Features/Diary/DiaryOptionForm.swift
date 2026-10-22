import FractonicaKit
import SwiftUI

/// One group of the diary options as a form, bound to the model's options.
struct DiaryOptionForm: View {
    @Bindable var model: DiaryModel
    let group: DiaryOptionGroup
    /// In the inspector, which has no navigation stack of its own: the zone list comes up as a sheet.
    var inspector = false

    @State private var choosingZone = false

    @Environment(AppSettings.self) private var settings

    var body: some View {
        Form {
            switch group {
            case .paper: paper
            case .print: print
            case .gregorian: gregorian
            case .front: front
            case .lock: lock
            case .lined: lined
            case .canvases: canvases
            case .semi: semi
            case .retro: retro
            case .inserts: inserts
            case .events: events
            case .sky: sky
            case .nav: nav
            case .style: style
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .sheet(isPresented: $choosingZone) {
            NavigationStack {
                DiaryZoneList(zone: $model.options.gregorian.zone, appZone: model.appZone)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { choosingZone = false }
                        }
                    }
            }
            #if os(macOS)
            .frame(minWidth: 380, minHeight: 480)
            #endif
        }
    }

    private var pure: Bool { settings.pure }
    private var o: DiaryOptions { model.effective }

    // MARK: Paper

    @ViewBuilder
    private var paper: some View {
        Section {
            Picker("Paper size", selection: Binding(get: { model.options.page.size }, set: setSize)) {
                ForEach(PaperSize.allCases) { size in
                    Text(DiaryPrint.paperLabel(size.rawValue, page: model.options.page, pure: pure)).tag(size.rawValue)
                }
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } header: {
            Text("Paper size")
        }
        if model.options.page.size == PaperSize.custom.rawValue {
            Section("Custom size") {
                DiaryNumberRow("Width", value: $model.options.page.width, range: 80...420, step: 1, unit: "mm")
                DiaryNumberRow("Height", value: $model.options.page.height, range: 100...600, step: 1, unit: "mm")
            }
        }
        Section {
            DiaryNumberRow("Top", value: $model.options.page.margins.top, range: 3...40, step: 0.5, unit: "mm")
            DiaryNumberRow("Bottom", value: $model.options.page.margins.bottom, range: 3...40, step: 0.5, unit: "mm")
            DiaryNumberRow("Inner", value: $model.options.page.margins.inner, range: 3...50, step: 0.5, unit: "mm")
            DiaryNumberRow("Outer", value: $model.options.page.margins.outer, range: 3...50, step: 0.5, unit: "mm")
        } header: {
            Text("Margins")
        } footer: {
            Text("The inner margin is at the binding; the outer margin carries the time ticks.")
        }
    }

    private func setSize(_ raw: String) {
        var page = model.options.page
        page.size = raw
        if let dims = PaperSize(rawValue: raw)?.dimensions {
            page.width = dims.width
            page.height = dims.height
        }
        model.options.page = page
        Haptics.play(.selection)
    }

    // MARK: Print

    @ViewBuilder
    private var print: some View {
        Section {
            Toggle(isOn: $model.options.print.twoUp.animation()) {
                DiaryRowLabel("Two pages per sheet of paper", hint: DiaryPrint.twoUpLabel(o, pure: pure))
            }
        } footer: {
            if !o.print.twoUp { Text("Every page of the diary is a page of the PDF.") }
        }
        if o.print.twoUp {
            Section {
                Picker("Pairing", selection: $model.options.print.pairing.animation()) {
                    DiaryRowLabel("Facing pages", hint: "As the open book: –|1, 2|3 …").tag("spreads")
                    DiaryRowLabel("In order", hint: "1|2, 3|4 …").tag("sequential")
                    DiaryRowLabel("Double-sided", hint: "Cut and stack: the halves fall in order").tag("duplex")
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("Pairing")
            } footer: {
                if o.print.pairing != "duplex" { Text("Each sheet carries two pages side by side; cut or fold the sheets to bind them.") }
            }
            if o.print.pairing == "duplex" {
                Section {
                    Picker("Backs", selection: $model.options.print.turn) {
                        DiaryRowLabel("Flip on the short edge", hint: "The sheet turns over sideways").tag("side")
                        DiaryRowLabel("Flip on the long edge", hint: "The sheet turns top over bottom").tag("top")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("Backs")
                } footer: {
                    Text("Print the odd pages, put the printed stack back in, print the even pages on the other side. Cut every sheet in half along the marks and lay the left halves on the right halves: the pages are in order.")
                }
            }
        }
        if let plan = model.plan {
            Section("The PDF") {
                Text(DiaryPrint.printLine(o, pages: plan.pages.count, pure: pure))
                    .font(.callout)
                    .foregroundStyle(Theme.ink2)
            }
        }
    }

    // MARK: Gregorian

    @ViewBuilder
    private var gregorian: some View {
        Section {
            Toggle(isOn: $model.options.gregorian.on) {
                DiaryRowLabel("Gregorian dates and times", hint: "Index, timestamps, the date range of every page")
            }
            Group {
                if inspector {
                    Button { choosingZone = true } label: {
                        HStack {
                            zoneRow
                            Image(systemName: "chevron.forward")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(Theme.ink3)
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                } else {
                    NavigationLink {
                        DiaryZoneList(zone: $model.options.gregorian.zone, appZone: model.appZone)
                    } label: {
                        zoneRow
                    }
                }
            }
            .disabled(!model.options.gregorian.on)
            Toggle("Weekday names", isOn: $model.options.gregorian.weekdays)
                .disabled(!model.options.gregorian.on)
        }
    }

    private var zoneRow: some View {
        LabeledContent("Zone", value: (model.options.gregorian.zone ?? "App zone · \(model.appZone)").replacingOccurrences(of: "_", with: " "))
    }

    // MARK: Front matter

    @ViewBuilder
    private var front: some View {
        Section {
            Toggle("Cover page", isOn: $model.options.front.cover)
            Toggle(isOn: $model.options.front.index) {
                DiaryRowLabel("Index", hint: "Major thresholds, Nuclides, locks, sections with their pages")
            }
            if !pure {
                Toggle(isOn: $model.options.front.gregorianIndex) {
                    DiaryRowLabel("Gregorian index", hint: "Month grids with the page of every day")
                }
                .disabled(!model.options.gregorian.on)
            }
            Toggle(isOn: $model.options.front.ephemeris) {
                DiaryRowLabel("Ephemeris", hint: "Every lunar and solar event of the Delta with its page")
            }
            Toggle(isOn: $model.options.front.reference) {
                DiaryRowLabel("Reference sheet", hint: "The period ladder of 63 levels; the milestones of Alpha, Beta and Gamma with their eclipses")
            }
        }
        Section("Writing pages") {
            DiaryCountRow("Planning pages", value: $model.options.front.planning, range: 0...12)
            DiaryCountRow("Prediction pages", value: $model.options.front.predictions, range: 0...12)
        }
    }

    // MARK: Lock pattern

    @ViewBuilder
    private var lock: some View {
        let shape = DiaryPrint.lockShape(o)
        Section {
            ForEach(Array(model.options.lock.sheets.enumerated()), id: \.offset) { i, sheet in
                DiaryLockSheetRow(index: i, sheet: sheet) { next in
                    var sheets = model.options.lock.sheets
                    sheets[i] = next
                    model.options.lock.sheets = DiaryOptions.lockSheets(sheets)
                }
                .deleteDisabled(model.options.lock.sheets.count <= 1)
            }
            .onDelete { offsets in
                var sheets = model.options.lock.sheets
                sheets.remove(atOffsets: offsets)
                if !sheets.isEmpty { model.options.lock.sheets = sheets }
            }
            Button("Add sheet", systemImage: "plus") {
                model.options.lock.sheets = DiaryOptions.lockSheets(model.options.lock.sheets + [[3, 2]])
            }
            .disabled(model.options.lock.sheets.count >= DiaryOptions.maxSheets || shape.perLock + 1 > 77)
            Button("Default pattern", systemImage: "arrow.uturn.backward") {
                model.options.lock.sheets = DiaryOptions.defaultSheets
            }
            .disabled(model.options.lock.sheets == DiaryOptions.defaultSheets)
        } header: {
            Text("Sheets of one lock")
        } footer: {
            VStack(alignment: .leading, spacing: 8) {
                Text("\(DiaryPrint.lockReadout(shape)) in each Nuclide of 77 Helions\(shape.retro > 0 ? "" : ": every Helion is in a lock").")
                    .foregroundStyle(Theme.ink2)
                Text("A sheet is one leaf: lined Helions on the front, canvas Helions on the back. A sheet of 5 Helions is a Pentad, of 4 a Semi-pentad. A solar lock is these sheets (3 Pentads and a Semi-pentad: 19 Helions); the Helions of a Nuclide (77) that no whole lock takes are its retrospection.")
            }
        }
    }

    // MARK: Lined pages

    @ViewBuilder
    private var lined: some View {
        Section {
            DiaryCountRow("Lines per Helion", value: $model.options.lined.linesPerHelion, range: 1...72, hint: perLine(o.lined.linesPerHelion))
            Picker("Line labels", selection: Binding(get: { pure && model.options.lined.labels == "both" ? "preon" : model.options.lined.labels },
                                                     set: { model.options.lined.labels = $0 })) {
                Text("Preon counts (0ι 3ι 6ι …)").tag("preon")
                if !pure { Text("Preon counts and Gregorian time").tag("both") }
                Text("None").tag("none")
            }
        }
        Section("Outer margin") {
            Toggle(isOn: $model.options.lined.marginGlyphs) {
                DiaryRowLabel("Quarter glyphs", hint: "Peak, node, valley and end of each Helion")
            }
            Toggle(isOn: $model.options.lined.marginCurve) {
                DiaryRowLabel("Wave curve", hint: "The direction of the Helion’s cycle")
            }
        }
    }

    /// "one line per 3ι" (the Helion divided by the lines, on the ladder).
    private func perLine(_ lines: Int) -> String {
        let n = Notation.standard
        return "one line per \(n.durationPos(n.cyclePos(6) / Double(max(1, lines))))"
    }

    // MARK: Canvases

    @ViewBuilder
    private var canvases: some View {
        Section {
            DiaryCanvasList(list: $model.options.canvases, defaults: DiaryOptions.defaultCanvases, name: { "Canvas \($0 + 1)" }, editable: true)
        } footer: {
            Text("Used in turn for the canvas Helions of every lock.")
        }
    }

    @ViewBuilder
    private var semi: some View {
        Section {
            Toggle(isOn: $model.options.semi.allCanvas) {
                DiaryRowLabel("All canvases", hint: "Its 4 Helions as canvases, 2 on each side, instead of lined front and canvas back")
            }
        }
        Section("Canvases") {
            DiaryCanvasList(list: $model.options.semi.canvases, defaults: DiaryOptions.Semi().canvases, name: { "Helion \($0 + 1)" }, editable: false)
                .disabled(!model.options.semi.allCanvas)
        }
    }

    @ViewBuilder
    private var retro: some View {
        Section {
            DiaryCountRow("Lines on its page", value: $model.options.retro.lines, range: 1...144, hint: perLine(o.retro.lines))
        } footer: {
            Text("The Helions left over after the locks: one finely lined page each, then one page per canvas.")
        }
        Section("Canvas pages") {
            DiaryCanvasList(list: $model.options.retro.canvases, defaults: DiaryOptions.Retro().canvases, name: { "Page \($0 + 1)" }, editable: true)
        }
    }

    // MARK: Inserts, events, sky, edge, style

    @ViewBuilder
    private var inserts: some View {
        Section {
            Toggle(isOn: $model.options.inserts.deltaQuarters) {
                DiaryRowLabel("Delta sheets", hint: "A sheet before the lock that holds each Delta quarter threshold (Peak, Node, Valley)")
            }
            Toggle(isOn: $model.options.inserts.eclipses) {
                DiaryRowLabel("Eclipse sheets", hint: "Two sheets before the Helion of each eclipse: the path map or shadow diagram with its Saros series, then the Helion in detail and a canvas")
            }
            .disabled(!model.options.events.eclipses)
        }
        Section("Closing") {
            DiaryCountRow("Retrospection and summary pages", value: $model.options.closing.summaryPages, range: 0...16)
        }
    }

    @ViewBuilder
    private var events: some View {
        Section {
            ForEach(DiaryEventFlag.allCases) { flag in
                Toggle(isOn: Binding(get: { model.options.events[keyPath: flag.keyPath] },
                                     set: { model.options.events[keyPath: flag.keyPath] = $0 })) {
                    Label {
                        DiaryRowLabel(flag.title(pure: pure), hint: flag.hint)
                    } icon: {
                        Image(systemName: flag.systemImage).foregroundStyle(Theme.ink2)
                    }
                }
            }
        } footer: {
            Text("Each event is ticked in the outer margin at its exact moment, and listed in the ephemeris with its page.")
        }
    }

    @ViewBuilder
    private var sky: some View {
        Section {
            Toggle(isOn: $model.options.sky.on) {
                DiaryRowLabel("Solar and lunar altitude", hint: "Lined pages: a solar dot on odd lines, a lunar ring on even ones, left below the horizon, right above; rises and sets on the horizon, culminations as squares. Canvases: their paths in the inner margin.")
            }
        }
        Section {
            TextField("Name (optional)", text: Binding(get: { model.options.sky.place ?? "" },
                                                       set: { model.options.sky.place = $0.isEmpty ? nil : String($0.prefix(60)) }))
            DiaryOptionalNumberRow("Latitude", value: $model.options.sky.lat, range: -90...90, unit: "°N")
            DiaryOptionalNumberRow("Longitude", value: $model.options.sky.lon, range: -180...180, unit: "°E")
            Button("Use the zone’s city", systemImage: "building.2") {
                model.options.sky.lat = nil
                model.options.sky.lon = nil
                model.options.sky.place = nil
            }
            .disabled(model.options.sky.lat == nil && model.options.sky.lon == nil && model.options.sky.place == nil)
        } header: {
            Text("Place")
        } footer: {
            Text(whereText)
        }
        .disabled(!model.options.sky.on)
        Section {
            DiaryNumberRow("Mark size", value: $model.options.sky.dot, range: 0.4...3, step: 0.1, unit: "mm")
        } footer: {
            Text("The diameter of the solar dot and the lunar ring.")
        }
        .disabled(!model.options.sky.on)
    }

    private var whereText: String {
        let s = o.sky
        if let lat = s.lat, let lon = s.lon {
            return "\(s.place.map { $0 + " · " } ?? "")\(Self.degrees(lat, "N", "S")), \(Self.degrees(lon, "E", "W"))"
        }
        if let z = model.plan?.zoneCity {
            return "\(z.place ?? "The zone’s city") (the zone’s city) · \(Self.degrees(z.lat, "N", "S")), \(Self.degrees(z.lon, "E", "W"))"
        }
        return "No place: enter coordinates to draw the sky."
    }

    /// 55.7558 → "55.7558° N".
    static func degrees(_ v: Double, _ pos: String, _ neg: String) -> String {
        "\(DiaryNumberFormat.plain(abs(v)))° \(v < 0 ? neg : pos)"
    }

    @ViewBuilder
    private var nav: some View {
        Section {
            Toggle(isOn: $model.options.nav.on) {
                DiaryRowLabel("Thumb index on the outer edge", hint: "Each page points to the previous and next page of its kind: the same Helion one Nuclide away, Semi-pentads, solar locks, Nuclides, the 77th Helion, Delta sheets")
            }
        }
    }

    @ViewBuilder
    private var style: some View {
        Section("Ink") {
            Picker("Ink", selection: $model.options.style.ink) {
                Text("Colour").tag("color")
                Text("Black").tag("mono")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
        Section("Typeface") {
            Picker("Typeface", selection: $model.options.style.font) {
                Text("Sans").tag("sans")
                Text("Serif").tag("serif")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }
}

