import FractonicaKit
import SwiftUI

/// What the editor sheet edits: an existing rule, or a new one (from a preset or from scratch).
struct AlertEditorTarget: Identifiable {
    let id = UUID()
    var rule: AlertRule
    var isNew: Bool

    static func new(pure: Bool) -> AlertEditorTarget {
        AlertEditorTarget(rule: AlertRule(name: "", subject: .level(6), events: [.begin]), isNew: true)
    }
}

/// The editor sheet: a live preview of the next notification on top, then what to listen to, which moments, filters,
/// how early, the message and how it is delivered, and the next few moments it will fire.
struct AlertEditor: View {
    let target: AlertEditorTarget

    @State private var draft: AlertRule
    /// The draft as it opened (after pure mode restates its lead): a changed draft is not swiped away by accident.
    @State private var baseline: AlertRule
    @State private var alerts = AlertStore.shared
    @State private var confirmDelete = false
    @FocusState private var focus: Field?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(AppSettings.self) private var settings

    private enum Field { case name, title, body }

    init(target: AlertEditorTarget) {
        self.target = target
        _draft = State(initialValue: target.rule)
        _baseline = State(initialValue: target.rule)
    }

    var body: some View {
        let text = AlertText(words: settings.wording)
        let now = alerts.now
        let upcoming = AlertPlanner().occurrences(of: draft.sanitized(), after: now, limit: 4)
        ScrollViewReader { proxy in
            Form {
                Group {
                    previewSection(text, upcoming.first, now: now)
                    nameSection(text)
                    subjectSection(text)
                    if draft.subject.hasEvents { eventsSection }
                    if case .level(let level) = draft.subject { filterSection(level, text) }
                    leadSection(text, now: now)
                    messageSection
                    deliverySection
                    comingSection(text, upcoming, now: now)
                    if !target.isNew {
                        Section {
                            Button("Delete Alert", systemImage: "trash", role: .destructive) { confirmDelete = true }
                        }
                    }
                }
                .listRowBackground(Theme.panel)
            }
            .task {
                // -FXAlertsScroll with -FXAlertsEdit: show a lower section (screenshots).
                guard let section = alerts.launch.scroll, alerts.launch.edit != nil else { return }
                try? await Task.sleep(for: .seconds(1))
                proxy.scrollTo(section, anchor: .top)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle(target.isNew ? "New Alert" : "Edit Alert")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", systemImage: "xmark", role: .cancel) { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(target.isNew ? "Add" : "Save", systemImage: "checkmark", role: .confirmIfAvailable) { save(text) }
                    .disabled(!draft.filtersCanMeet())
            }
        }
        .confirmationDialog("Delete \(draft.name.isEmpty ? "this alert" : "“\(draft.name)”")?", isPresented: $confirmDelete,
                            titleVisibility: .visible) {
            Button("Delete Alert", role: .destructive) {
                alerts.remove([draft.id])
                dismiss()
            }
        }
        .onAppear {
            if settings.pure { draft.lead = draft.lead.inFractonicaUnits() }
            baseline = draft
        }
        .interactiveDismissDisabled(draft != baseline)
        .onChange(of: draft.subject) { old, new in
            if old.level != new.level {
                draft.ordinal = nil
                draft.coarser = nil
            }
            resanitize()
        }
        .onChange(of: draft.coarser) { resanitize() }
        .sensoryFeedback(.selection, trigger: draft.events) { _, _ in settings.haptics }
    }

    // MARK: Sections

    private func previewSection(_ text: AlertText, _ next: AlertOccurrence?, now: Double) -> some View {
        Section {
            let rule = draft.sanitized()
            if let next {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    NotificationPreview(
                        title: text.title(rule, next),
                        message: text.body(rule, next),
                        corner: text.words.countdown(next.fire - alerts.now, at: alerts.now),
                        silent: !rule.sound)
                }
            } else {
                NotificationPreview(
                    title: rule.filtersCanMeet() ? "Nothing more in the catalogue" : "These filters never meet",
                    message: rule.filtersCanMeet()
                        ? "No moment of this kind is left before the catalogue ends."
                        : "A cycle that begins with a coarser one is always the first of its parent, and one that ends with it the last.",
                    corner: "", silent: true)
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 4, trailing: 0))
    }

    private func nameSection(_ text: AlertText) -> some View {
        Section("Name") {
            TextField("Name", text: $draft.name, prompt: Text(autoName(text)))
                .focused($focus, equals: .name)
                .submitLabel(.done)
        }
    }

    private func subjectSection(_ text: AlertText) -> some View {
        Section("Listen to") {
            NavigationLink {
                SubjectPicker(subject: $draft.subject, text: text)
            } label: {
                HStack(spacing: 12) {
                    SubjectBadge(subject: draft.subject, size: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(text.subjectName(draft.subject))
                            .foregroundStyle(Theme.ink)
                        Text(text.subjectDetail(draft.subject))
                            .font(.footnote)
                            .foregroundStyle(Theme.ink2)
                    }
                }
            }
        }
    }

    private var eventsSection: some View {
        Section {
            // Five in a row; three to a row at accessibility text sizes, where "Valley" no longer fits a fifth.
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6),
                                     count: typeSize.isAccessibilitySize ? 3 : 5), spacing: 6) {
                ForEach(AlertEvent.allCases, id: \.self) { event in
                    EventChip(event: event, isOn: draft.events.contains(event), isEnabled: allows(event)) {
                        toggle(event)
                    }
                }
            }
            .padding(.vertical, 2)
        } header: {
            Text("Moments")
        } footer: {
            Text(eventsFooter)
        }
    }

    private func filterSection(_ level: Int, _ text: AlertText) -> some View {
        Section {
            Picker("Which", selection: $draft.ordinal) {
                Text("Every \(AlertText.unitName(level))").tag(Int?.none)
                ForEach(1...AlertRule.places(level: level), id: \.self) { n in
                    Text(ordinalLabel(level, n)).tag(Int?.some(n))
                }
            }
            if level > 0 {
                Picker("Turning with", selection: $draft.coarser) {
                    Text("Anything").tag(Int?.none)
                    ForEach((0..<level).reversed(), id: \.self) { c in
                        Text("\(AlertText.article(AlertText.unitName(c)).capitalized) \(AlertText.unitName(c)) · \(text.words.levelChip(c))")
                            .tag(Int?.some(c))
                    }
                }
            }
        } header: {
            Text("Only")
                .id("only")
        } footer: {
            if !draft.filtersCanMeet() {
                Label("These never meet: a cycle that begins with a coarser one is the first of its parent, and one that ends with it the last.",
                      systemImage: "exclamationmark.triangle")
                    .foregroundStyle(Theme.danger)
            } else if let summary = text.filterSummary(draft) {
                Text("Notifies \(summary).")
            } else {
                Text("Narrow it to one place in the parent cycle, or to the moments a coarser cycle turns over too.")
            }
        }
    }

    private func leadSection(_ text: AlertText, now: Double) -> some View {
        Section {
            Picker("Notify", selection: aheadBinding) {
                Text("At the moment").tag(false)
                Text("Ahead of it").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if !draft.lead.isAtMoment {
                HStack {
                    TextField("Count", value: $draft.lead.count, format: .number)
                        .font(.reading(17))
                        #if os(iOS)
                        .keyboardType(.numberPad)
                        #endif
                        .frame(maxWidth: 80)
                    Stepper("Count", value: $draft.lead.count, in: 1...AlertLead.counts.upperBound)
                        .labelsHidden()
                    Spacer()
                    Picker("Unit", selection: $draft.lead.unit) {
                        ForEach(units, id: \.self) { unit in
                            Text(unitLabel(unit)).tag(unit)
                        }
                    }
                    .labelsHidden()
                    .fixedSize()
                }
            }
        } header: {
            Text("When")
                .id("when")
        } footer: {
            Text(draft.lead.isAtMoment ? "Notifies at the moment itself." : "Notifies \(text.leadSummary(draft.lead, at: now).lowercasedFirst) each moment.")
        }
    }

    private var messageSection: some View {
        Section {
            TextField("Title", text: $draft.title, prompt: Text(AlertRule.defaultTitle))
                .focused($focus, equals: .title)
            TextField("Message", text: $draft.body, prompt: Text(AlertRule.defaultBody), axis: .vertical)
                .lineLimit(1...4)
                .focused($focus, equals: .body)
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(AlertText.tokens, id: \.self) { token in
                        Button(token) { insert(token) }
                            .font(.code(13))
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                            .controlSize(.small)
                            .accessibilityHint("Adds \(token) to the \(focus == .body ? "message" : "title")")
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        } header: {
            Text("Message")
                .id("message")
        } footer: {
            Text("{name} the cycle · {event} what happens · {ordinal} its place · {unit} its unit · {when} how far ahead · {time} the moment")
        }
    }

    private var deliverySection: some View {
        Section {
            Toggle(isOn: $draft.sound) { Label("Sound", systemImage: "speaker.wave.2") }
            Toggle(isOn: $draft.ignoresQuietHours) {
                Label(settings.pure ? "Ring during quiet time" : "Ring during quiet hours", systemImage: "moon.zzz")
            }
        } header: {
            Text("Delivery")
                .id("delivery")
        }
    }

    private func comingSection(_ text: AlertText, _ upcoming: [AlertOccurrence], now: Double) -> some View {
        Section {
            if upcoming.isEmpty {
                Text("Nothing ahead")
                    .foregroundStyle(Theme.ink3)
            }
            let rule = draft.sanitized()
            ForEach(upcoming, id: \.identifier) { o in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(text.title(rule, o))
                            .font(.subheadline)
                            .foregroundStyle(Theme.ink)
                            .lineLimit(2)
                        if o.fire != o.time {
                            // Ahead of the moment: when the notification itself comes.
                            Label(text.moment(o.fire + 0.002, from: now), systemImage: "bell")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Theme.ink3)
                        }
                    }
                    Spacer(minLength: 8)
                    Text(text.moment(o.time + 0.002, from: now))
                        .font(.reading(13))
                        .foregroundStyle(draft.subject.color)
                        .multilineTextAlignment(.trailing)
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            Text("Coming up")
                .id("coming")
        } footer: {
            if case .level(let level) = draft.subject, level >= 9, draft.ordinal == nil, draft.coarser == nil {
                Text("These come every \(text.words.levelLength(level).replacingOccurrences(of: "≈ ", with: "")): Fractonica keeps at most \(AlertPlanner.budget) alerts queued and refills them whenever it runs.")
            }
        }
    }

    // MARK: Editing

    /// The draft made valid after a structural change, keeping the name as typed: an empty name stays empty and keeps
    /// showing (and saving as) the automatic one, instead of becoming "Alert".
    private func resanitize() {
        var next = draft.sanitized()
        next.name = draft.name
        if next != draft { draft = next }
    }

    private var aheadBinding: Binding<Bool> {
        Binding(
            get: { !draft.lead.isAtMoment },
            set: { ahead in
                withAnimation(.snappy) {
                    draft.lead = ahead
                        ? (settings.pure ? AlertLead(count: 3, unit: .preon) : AlertLead(count: 15, unit: .minute))
                        : .atMoment
                }
            }
        )
    }

    private var units: [LeadUnit] {
        settings.pure ? LeadUnit.fractonica : LeadUnit.earth + LeadUnit.fractonica
    }

    private func unitLabel(_ unit: LeadUnit) -> String {
        switch unit {
        case .minute: "minutes"
        case .hour: "hours"
        case .day: "days"
        default: "\(Notation.unitName(level: unit.level!, count: 2)) (\(unit.symbol!))"
        }
    }

    private func allows(_ event: AlertEvent) -> Bool {
        draft.coarser == nil || event.isTurnover
    }

    private func toggle(_ event: AlertEvent) {
        guard allows(event) else { return }
        if draft.events.contains(event) {
            if draft.events.count > 1 { draft.events.remove(event) }
        } else {
            draft.events.insert(event)
        }
    }

    private var eventsFooter: String {
        if draft.coarser != nil { return "With a coarser turnover only Begin and End can coincide with it." }
        if draft.events.isSuperset(of: [.begin, .end]) {
            return "One cycle ends where the next begins: each turnover is told once."
        }
        if draft.subject == .solar {
            return settings.pure ? "The sync's 19η run in four quarters of 4η 27ι: peak, node, valley, end."
                : "The sync's four quarters fall about a day apart: peak, node, valley, end."
        }
        return "Begin and End are turnovers; Peak, Node and Valley are the quarter thresholds in between."
    }

    private func ordinalLabel(_ level: Int, _ n: Int) -> String {
        switch level {
        case ...3: Notation.periodName(level: level, ordinal: n)
        case 4: "ε#\(n)"
        default: "\(Journal.ordinal(n)) of each \(Fractonica.periodName(level - 1).text)"
        }
    }

    private func autoName(_ text: AlertText) -> String {
        "\(text.subjectName(draft.subject)) · \(text.eventsSummary(draft))"
    }

    private func insert(_ token: String) {
        if focus == .body {
            draft.body += draft.body.isEmpty || draft.body.hasSuffix(" ") ? token : " " + token
        } else {
            if draft.title.isEmpty { draft.title = AlertRule.defaultTitle }
            draft.title += draft.title.hasSuffix(" ") ? token : " " + token
        }
    }

    private func save(_ text: AlertText) {
        var rule = draft
        if rule.name.trimmingCharacters(in: .whitespaces).isEmpty { rule.name = autoName(text) }
        if rule.title.trimmingCharacters(in: .whitespaces).isEmpty { rule.title = AlertRule.defaultTitle }
        if target.isNew {
            alerts.add(rule)
            if alerts.shouldPrime { alerts.primerAfterEditor = rule }
        } else {
            alerts.update(rule)
        }
        Haptics.play(.success)
        dismiss()
    }
}

/// One of the five moments as a capsule toggle.
private struct EventChip: View {
    let event: AlertEvent
    let isOn: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                QuarterMark(event: event)
                    .stroke(isOn ? Theme.teal : Theme.ink3, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .frame(width: 18, height: 18)
                Text(AlertText.eventName(event))
                    .font(.caption.weight(isOn ? .semibold : .regular))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .foregroundStyle(isOn ? Theme.ink : Theme.ink2)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(isOn ? Theme.teal.opacity(0.16) : Theme.panel2, in: .rect(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12).strokeBorder(isOn ? Theme.teal.opacity(0.6) : Theme.line, lineWidth: 1)
            }
            .opacity(isEnabled ? 1 : 0.35)
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityLabel(AlertText.eventName(event))
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

/// Where in a cycle a moment falls: a ring with the moment's quarter marked (begin and end at the top).
private struct QuarterMark: Shape {
    let event: AlertEvent

    func path(in rect: CGRect) -> Path {
        let r = min(rect.width, rect.height) / 2 - 1
        let c = CGPoint(x: rect.midX, y: rect.midY)
        var p = Path()
        p.addEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
        let quarter = event == .end ? 4 : event.index
        let a = Angle.degrees(-90 + Double(quarter) * 90).radians
        p.move(to: c)
        p.addLine(to: CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a)))
        return p
    }
}

/// Every subject an alert can listen to: the named units first, the depths between them, then the Sun's sync and the
/// catalogue's eclipses.
struct SubjectPicker: View {
    @Binding var subject: AlertSubject
    let text: AlertText

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Group {
                Section("Units") {
                    ForEach(Notation.unitLevels, id: \.self) { row(.level($0)) }
                }
                Section("Between the units") {
                    ForEach(AlertRule.levels.filter { !Notation.isUnitLevel($0) }, id: \.self) { row(.level($0)) }
                }
                Section("Sun and eclipses") {
                    row(.solar)
                    row(.eclipse)
                }
            }
            .listRowBackground(Theme.panel)
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Listen to")
    }

    private func row(_ s: AlertSubject) -> some View {
        Button {
            subject = s
            dismiss()
        } label: {
            HStack(spacing: 12) {
                SubjectBadge(subject: s, size: 30)
                VStack(alignment: .leading, spacing: 2) {
                    Text(text.subjectName(s))
                        .foregroundStyle(Theme.ink)
                    Text(text.subjectDetail(s))
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2)
                }
                Spacer()
                if s == subject {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Theme.teal)
                        .accessibilityLabel("Selected")
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
    }
}
