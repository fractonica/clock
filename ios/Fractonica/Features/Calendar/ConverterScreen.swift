import FractonicaKit
import SwiftUI

/// Converter: Gregorian date and time ⇄ Saros position, cycle address, glyph states and solar sync; in pure mode the
/// Fractonica date forms (src/ui/calendar/converter.js, pure-converter.js, docs/design/60-calendar.md §2).
///
/// One moment is the single source of truth (`ConverterModel`): it follows the displayed time until something is
/// edited, then stays pinned on the result. Every side is computed from it once per change; "Go there" travels the
/// app to it, Share sends it.
struct ConverterScreen: View {
    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    private let model = ConverterModel.shared

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Group {
                    if settings.pure {
                        PureConverterContent(model: model)
                    } else {
                        EarthConverterContent(model: model)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
                .frame(maxWidth: 1180)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .task {
                model.applyLaunchOptions()
                if let target = model.scrollTarget {
                    model.scrollTarget = nil
                    try? await Task.sleep(for: .milliseconds(350))
                    proxy.scrollTo(target, anchor: .top)
                }
            }
        }
        .background {
            // The displayed time, at the slowest cadence that keeps the readout honest: once a second live, at most
            // about eight times a real second during a time-lapse.
            ClockTimeline(.periodic(store.isPlaying ? max(1, abs(store.rate) / 8) : 1)) { t in
                Color.clear.onChange(of: t, initial: true) { _, t in model.follow(t) }
            }
        }
        .navigationTitle(Screen.converter.title)
        .navigationDestination(for: CalendarRoute.self) { route in
            switch route {
            case .zone: ConverterZonePicker(model: model)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                ShareLink(item: shareText, subject: Text("A Fractonica moment")) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
            }
        }
    }

    /// The moment in both vocabularies (pure: Fractonica only) and its link.
    private var shareText: String {
        let t = model.t
        let n = Notation.standard
        let link = AppLink(screen: .converter, time: t).url.absoluteString
        var lines: [String] = []
        if settings.pure {
            lines.append(n.stamp(at: t, upTo: "nu"))
            lines.append(n.dateText(at: t, form: "full", upTo: "iota"))
        } else {
            let zone = model.timeZone(app: settings.timeZone)
            let earth = EarthFormatter.calendar(zone)
            lines.append("\(earth.long(t)) \(earth.tag(t))")
            if store.clock.inRange(t) { lines.append(n.stamp(at: t, upTo: "nu")) }
        }
        if let p = CalMath.position(store.clock, at: t) { lines.append("pos \(p.ordinal).\(p.fraction)") }
        lines.append(link)
        return lines.joined(separator: "\n")
    }
}

/// Pushed from the converter.
enum CalendarRoute: Hashable {
    case zone
}

// MARK: - Earth mode

/// Everything about the converter's moment, read once per change (14 levels, the position, the sync, the address).
struct ConverterSnapshot {
    let t: Double
    let inRange: Bool
    let levels: [LevelReading]
    let position: (ordinal: Int, fraction: String)?
    let solar: SolarReading?
    /// The cycle address shown: as edited, or read at t.
    let path: [Int]

    init(clock: FractonicaClock, t: Double, depth: Int, editedPath: [Int]?) {
        self.t = t
        inRange = clock.inRange(t)
        levels = inRange ? (0...13).compactMap { clock.level(at: t, $0) } : []
        position = CalMath.position(clock, at: t)
        solar = clock.solar(at: t)
        let read = inRange ? levels.prefix(depth).map { $0.local + 1 } : []
        if let editedPath, editedPath.count >= 1 {
            path = editedPath.count >= depth ? Array(editedPath.prefix(depth)) : CalMath.normalize(clock, path: editedPath + read.dropFirst(editedPath.count))
        } else {
            path = Array(read)
        }
    }
}

private struct EarthConverterContent: View {
    let model: ConverterModel

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @State private var wide = false

    var body: some View {
        let zone = model.timeZone(app: settings.timeZone)
        let snap = ConverterSnapshot(clock: store.clock, t: model.t, depth: model.depth, editedPath: model.editedPath)
        let earth = EarthFormatter.calendar(zone)
        VStack(spacing: 16) {
            EarthHero(model: model, snap: snap, earth: earth, wide: wide)
            if wide {
                HStack(alignment: .top, spacing: 16) {
                    VStack(spacing: 16) {
                        earthCards(snap, earth, zone)
                        if snap.inRange { SolarCard(model: model, snap: snap, earth: earth, pure: false).id("solar") }
                    }
                    VStack(spacing: 16) { fractonicaCards(snap, earth) }
                }
            } else {
                VStack(spacing: 16) {
                    earthCards(snap, earth, zone)
                    fractonicaCards(snap, earth)
                    if snap.inRange { SolarCard(model: model, snap: snap, earth: earth, pure: false).id("solar") }
                }
            }
        }
        .onGeometryChange(for: Bool.self) { $0.size.width >= 760 } action: { wide = $0 }
    }

    @ViewBuilder
    private func earthCards(_ snap: ConverterSnapshot, _ earth: EarthFormatter, _ zone: TimeZone) -> some View {
        EarthCard(model: model, t: snap.t, earth: earth, zone: zone).id("earth")
        SarosCard(model: model, t: snap.t, earth: earth)
    }

    @ViewBuilder
    private func fractonicaCards(_ snap: ConverterSnapshot, _ earth: EarthFormatter) -> some View {
        if snap.inRange {
            PositionCard(model: model, snap: snap).id("position")
            AddressCard(model: model, snap: snap, earth: earth, pure: false).id("address")
            GlyphStatesCard(model: model, snap: snap, earth: earth).id("glyphs")
        } else {
            OutOfRangeCard(model: model, t: snap.t)
        }
    }
}

/// The moment, large, with what the converter is doing and its actions.
private struct EarthHero: View {
    let model: ConverterModel
    let snap: ConverterSnapshot
    let earth: EarthFormatter
    var wide = false

    var body: some View {
        let t = snap.t
        let p = earth.parts(t)
        CalCard {
            HStack(alignment: .center) {
                ConverterStatus(model: model)
                Spacer()
                Text(earth.tag(t))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.ink2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(Theme.panel3))
            }
            HStack(alignment: .bottom, spacing: 24) {
                moment(t, p)
                if wide, snap.inRange {
                    Spacer(minLength: 0)
                    hierarchy(height: 40)
                }
            }
            if !wide, snap.inRange {
                hierarchy(height: 24)
            }
            ConverterActions(model: model, canTravel: snap.inRange)
        }
    }

    /// The glyph of every depth, α → ξ: the whole hierarchy at a glance.
    private func hierarchy(height: CGFloat) -> some View {
        VStack(alignment: wide ? .trailing : .leading, spacing: 6) {
            OdometerView(digits: snap.levels.map(\.index), strokes: 2, color: Theme.teal, spacing: 1.5)
                .frame(height: height)
            if let p = snap.position {
                Text(verbatim: "pos \(p.ordinal).\(p.fraction.prefix(10)) · α → ξ")
                    .font(.code(12))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("The glyph of every depth"))
    }

    private func moment(_ t: Double, _ p: EarthTime.Parts) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(earth.time(t, seconds: true, ms: true))
                .font(.reading(46, weight: .light))
                .foregroundStyle(Theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .contentTransition(.numericText(value: t))
            Text("\(EarthNames.weekdays[p.weekday]) \(p.day) \(EarthTime.monthsLong[p.month - 1]) \(String(p.year))")
                .font(.title3)
                .foregroundStyle(Theme.ink)
            if snap.inRange {
                Text(Notation.standard.stamp(at: t, upTo: "iota"))
                    .font(.code(13))
                    .foregroundStyle(Theme.teal)
                    .textSelection(.enabled)
            } else {
                Label("Outside the catalogue", systemImage: "exclamationmark.circle")
                    .font(.subheadline)
                    .foregroundStyle(Theme.danger)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// Following / pinned, as a small status line.
struct ConverterStatus: View {
    let model: ConverterModel
    @Environment(ClockStore.self) private var store

    var body: some View {
        let (text, color, symbol): (String, Color, String) =
            model.isPinned ? ("Pinned", Theme.cursor, "pin.fill")
            : store.isLive ? ("Following · live", Theme.live, "dot.radiowaves.left.and.right")
            : store.isPlaying ? ("Following · time-lapse", Theme.cursor, "forward.fill")
            : ("Following · paused", Theme.cursor, "pause.fill")
        Label(text, systemImage: symbol)
            .font(.caption.weight(.semibold))
            .textCase(.uppercase)
            .tracking(0.8)
            .foregroundStyle(color)
            .labelStyle(.titleAndIcon)
            .contentTransition(.symbolEffect(.replace))
    }
}

/// Go there, pin and follow.
struct ConverterActions: View {
    let model: ConverterModel
    let canTravel: Bool

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        HStack(spacing: 10) {
            if model.isPinned {
                CalActionButton(title: "Go there", systemImage: "location.fill", prominent: true) { travel() }
                    .disabled(!canTravel)
                CalActionButton(title: "Follow", systemImage: "scope") {
                    withAnimation(.snappy) { model.unpin() }
                    Haptics.play(.selection)
                }
                .help("Follow the displayed time again")
            } else {
                CalActionButton(title: "Pin", systemImage: "pin") {
                    withAnimation(.snappy) { model.pin() }
                    Haptics.play(.selection)
                }
                .help("Freeze this moment to study it")
            }
            Spacer(minLength: 0)
            Menu {
                ForEach(copyItems, id: \.0) { title, text in
                    Button(title) { Pasteboard.copy(text) }
                }
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
                    .labelStyle(.iconOnly)
                    .font(.subheadline.weight(.semibold))
                    .frame(width: 22, height: 22)
            }
            .menuStyle(.button)
            .buttonStyle(.glass)
            .buttonBorderShape(.circle)
            .help("Copy the moment")
        }
    }

    /// What can be copied, in the mode's vocabulary.
    private var copyItems: [(String, String)] {
        let t = model.t
        let clock = store.clock
        let n = Notation.standard
        let position = CalMath.position(clock, at: t).map { "\($0.ordinal).\($0.fraction)" }
        let link = AppLink(screen: .converter, time: t).url.absoluteString
        if settings.pure {
            return [("Stamp", n.stamp(at: t, upTo: "nu")), ("Date in words", n.dateText(at: t, form: "full", upTo: "iota"))]
                + (position.map { [("Saros position", $0)] } ?? []) + [("Link", link)]
        }
        let earth = EarthFormatter.calendar(model.timeZone(app: settings.timeZone))
        let p = earth.parts(t)
        var items = [("Date and time", "\(earth.long(t)) \(earth.tag(t))"),
                     ("ISO 8601", "\(earth.date(t))T\(earth.time(t, seconds: true, ms: true))\(EarthTime.offsetLabel(Double(p.offset)))"),
                     ("Unix seconds", String(format: "%.3f", t))]
        if clock.inRange(t) { items.append(("Stamp", n.stamp(at: t, upTo: "nu"))) }
        if let position { items.append(("Saros position", position)) }
        items.append(("Link", link))
        return items
    }

    private func travel() {
        let t = model.t
        guard store.clock.inRange(t) else { return }
        store.travel(to: t)
        Haptics.play(.step)
        toasts.show(settings.pure ? "Showing \(Notation.standard.stamp(at: t, upTo: "eta"))" : "Showing \(settings.wording.long(t))")
    }
}

/// Gregorian names the formatter does not carry.
enum EarthNames {
    static let weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
}

/// The Gregorian side: date and time in a zone, the zone, Unix seconds, ISO 8601, weekday and day of year.
private struct EarthCard: View {
    let model: ConverterModel
    let t: Double
    let earth: EarthFormatter
    let zone: TimeZone

    @Environment(AppSettings.self) private var settings

    var body: some View {
        let p = earth.parts(t)
        let doy = EarthTime.daysFromCivil(p.year, p.month, p.day) - EarthTime.daysFromCivil(p.year, 1, 1) + 1
        let daysInYear = EarthTime.daysFromCivil(p.year + 1, 1, 1) - EarthTime.daysFromCivil(p.year, 1, 1)
        let dayLength = CalMath.dayStart(zone, CalMath.addDays(p.year, p.month, p.day, 1).year, CalMath.addDays(p.year, p.month, p.day, 1).month, CalMath.addDays(p.year, p.month, p.day, 1).day) - CalMath.dayStart(zone, p.year, p.month, p.day)
        CalCard("Earth", systemImage: "globe.europe.africa") {
            DatePicker(selection: dateBinding, in: dateRange, displayedComponents: [.date, .hourAndMinute]) {
                Text("Date and time").font(.subheadline).foregroundStyle(Theme.ink3)
            }
            .environment(\.timeZone, zone)
            NavigationLink(value: CalendarRoute.zone) {
                HStack {
                    Text("Zone").font(.subheadline).foregroundStyle(Theme.ink3)
                    Spacer()
                    Text(zoneTitle).foregroundStyle(Theme.ink)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3)
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            CommitField(label: "Unix seconds", value: String(format: "%.3f", t), prompt: "1791460800.000", numeric: true) { text in
                let v = Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
                guard let v, v.isFinite else { return CalendarError("Type Unix seconds, e.g. 1791460800.000") }
                return model.set(v, from: .unix) ? nil : CalendarError("Years 1000 to 9999 only")
            }
            Divider().overlay(Theme.line)
            CalValueRow(label: "ISO 8601", value: iso(p), mono: true)
            CalValueRow(label: "Day", value: "\(EarthNames.weekdays[p.weekday]) · day \(doy) of \(daysInYear)")
            CalValueRow(label: "Offset", value: (earth.zone == "UTC" ? "UTC" : "UTC" + EarthTime.offsetLabel(Double(p.offset)))
                + (abs(dayLength - 86_400) > 1 ? " · a \(EarthTime.duration(dayLength, parts: 2)) day" : ""))
        }
    }

    private var zoneTitle: String {
        switch model.zoneMode {
        case .app: "App · \(TimeZoneWords.city(EarthFormatter.calendar(settings.timeZone).zone))"
        case .utc: "UTC"
        case .zone(let id): TimeZoneWords.city(id)
        }
    }

    private func iso(_ p: EarthTime.Parts) -> String {
        "\(earth.date(t))T\(earth.time(t, seconds: true, ms: true))\(EarthTime.offsetLabel(Double(p.offset)))"
    }

    private var dateRange: ClosedRange<Date> {
        Date(timeIntervalSince1970: ConverterModel.earthRange.lowerBound)...Date(timeIntervalSince1970: ConverterModel.earthRange.upperBound)
    }

    /// The picker sets the date and the minute; the seconds and milliseconds of the moment are kept.
    private var dateBinding: Binding<Date> {
        Binding(
            get: { Date(timeIntervalSince1970: t.rounded(.down)) },
            set: { date in
                let picked = EarthTime.zonedParts(date.timeIntervalSince1970, zone: zone)
                let old = earth.parts(t)
                let fields = EarthTime.CivilTime(year: picked.year, month: picked.month, day: picked.day, hour: picked.hour,
                                                 minute: picked.minute, second: old.second, ms: old.ms)
                model.set(EarthTime.zonedToUnix(fields, zone: zone), from: .earth)
                Haptics.play(.selection)
            }
        )
    }
}

/// "Europe/Moscow" → "Moscow".
enum TimeZoneWords {
    static func city(_ identifier: String) -> String {
        (identifier.split(separator: "/").last.map(String.init) ?? identifier).replacingOccurrences(of: "_", with: " ")
    }
}

/// The eclipses around the moment.
private struct SarosCard: View {
    let model: ConverterModel
    let t: Double
    let earth: EarthFormatter

    @Environment(ClockStore.self) private var store

    var body: some View {
        let around = CalMath.eclipses(store.clock, around: t)
        CalCard("Saros 141 around it", systemImage: "circle.lefthalf.filled") {
            ForEach([around.previous, around.next].compactMap { $0 }, id: \.self) { k in
                let e = store.clock.catalogue[k]
                Button {
                    model.set(e, from: .eclipse)
                    Haptics.play(.selection)
                } label: {
                    HStack(spacing: 12) {
                        EclipseMark(size: 18)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Eclipse #\(k)").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                            Text("\(earth.dateTime(e, seconds: false)) · \(EarthTime.countdown(e - t))")
                                .font(.footnote.monospacedDigit())
                                .foregroundStyle(Theme.ink3)
                        }
                        Spacer()
                        Image(systemName: "pin.circle").foregroundStyle(Theme.ink3)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityHint(Text("Pins the converter on this eclipse"))
            }
        }
    }
}

/// The Fractonica side of a moment outside the catalogue: a tidy statement and the way back in.
private struct OutOfRangeCard: View {
    let model: ConverterModel
    let t: Double

    @Environment(ClockStore.self) private var store

    var body: some View {
        let before = t < store.clock.tMin
        let utc = EarthFormatter(zone: "UTC")
        CalCard("Fractonica", systemImage: "circle.circle") {
            VStack(alignment: .leading, spacing: 10) {
                Label(before ? "Before the catalogue starts" : "After the catalogue ends", systemImage: "moon.zzz")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Text("The clock runs on the 70 eclipses of Saros 141, \(utc.date(store.clock.tMin)) … \(utc.date(store.clock.tMax)) UTC, and is never extrapolated. This moment lies \(EarthTime.duration(abs(before ? store.clock.tMin - t : t - store.clock.tMax))) \(before ? "before its first" : "after its last") eclipse.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                CalActionButton(title: before ? "Go to the first eclipse" : "Go to the last eclipse", systemImage: "arrow.uturn.backward") {
                    model.set(before ? store.clock.tMin : store.clock.tMax, from: .eclipse)
                }
            }
        }
    }
}

/// A text field that commits on Return (or when it loses focus) and shows why it could not, without clearing the
/// other side. While not editing it shows the model's value.
struct CommitField: View {
    let label: String
    let value: String
    var prompt: String = ""
    var numeric = false
    let commit: (String) -> CalendarError?

    @State private var text = ""
    @State private var error: CalendarError?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.subheadline).foregroundStyle(Theme.ink3)
            TextField(label, text: $text, prompt: Text(prompt).foregroundStyle(Theme.ink3.opacity(0.6)))
                .font(.code(15))
                .foregroundStyle(Theme.ink)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(numeric ? .numbersAndPunctuation : .default)
                #endif
                .submitLabel(.go)
                .focused($focused)
                .onSubmit(submit)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Theme.panel2)
                        .strokeBorder(error != nil ? Theme.danger.opacity(0.8) : focused ? Theme.cursor.opacity(0.7) : Theme.line, lineWidth: 1)
                }
                .accessibilityLabel(Text(label))
            if let error {
                Text(error.message)
                    .font(.footnote)
                    .foregroundStyle(Theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }
        }
        .onChange(of: value, initial: true) { _, v in
            if !focused { text = v }
        }
        .onChange(of: focused) { _, isFocused in
            guard !isFocused else { return }
            if text != value, !text.trimmingCharacters(in: .whitespaces).isEmpty {
                submit()
            } else {
                text = value
                error = nil
            }
        }
    }

    private func submit() {
        if let e = commit(text) {
            withAnimation(.snappy) { error = e }
            Haptics.play(.warning)
        } else {
            withAnimation(.snappy) { error = nil }
            if !focused { text = value }
        }
    }
}

/// The converter's zone: the app's, UTC, or any zone the device knows.
private struct ConverterZonePicker: View {
    let model: ConverterModel

    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private static let zones = TimeZone.knownTimeZoneIdentifiers.filter { $0 != "UTC" && $0 != "GMT" }.sorted {
        (TimeZoneWords.city($0), $0) < (TimeZoneWords.city($1), $1)
    }

    var body: some View {
        List {
            if query.isEmpty {
                Section {
                    row(.app, title: "App zone", detail: EarthFormatter.calendar(settings.timeZone).zone.replacingOccurrences(of: "_", with: " "))
                    row(.utc, title: "UTC", detail: "Coordinated Universal Time")
                }
            }
            Section {
                ForEach(matches, id: \.self) { id in
                    row(.zone(id), title: TimeZoneWords.city(id), detail: id.replacingOccurrences(of: "_", with: " "))
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .searchable(text: $query, prompt: "City or region")
        .navigationTitle("Converter zone")
    }

    private var matches: [String] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? Self.zones : Self.zones.filter { $0.replacingOccurrences(of: "_", with: " ").localizedStandardContains(q) }
    }

    private func row(_ mode: ConverterModel.ZoneMode, title: String, detail: String) -> some View {
        let selected = model.zoneMode == mode
        let zone = ConverterModel.zone(mode, app: settings.timeZone)
        return Button {
            model.zoneMode = mode
            Haptics.play(.selection)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Theme.ink)
                    Text(detail).font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer()
                Text(EarthFormatter.calendar(zone).tag(model.t)).font(.reading(13)).foregroundStyle(Theme.ink2)
                Image(systemName: "checkmark").foregroundStyle(Theme.teal).opacity(selected ? 1 : 0)
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}
