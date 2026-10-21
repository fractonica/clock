import FractonicaKit
import SwiftUI

/// Alerts: notifications for the clock's moments the user chooses — turnovers and quarters of any level, the solar
/// sync, the catalogue's eclipses. The rule list with its switches, the next alert with the rhythm it waits on, what
/// is queued with the system, what arrived, and quiet hours. Wide layouts put the rules beside the queue.
///
/// Alerts live on the device's real clock: travelling in time changes nothing here.
struct AlertsScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(ClockStore.self) private var clockStore
    @State private var alerts = AlertStore.shared
    @State private var editor: AlertEditorTarget?
    @State private var width: CGFloat = 0

    var body: some View {
        let text = AlertText(words: settings.wording)
        Group {
            if width >= 760 {
                HStack(alignment: .top, spacing: 0) {
                    Form { primarySections(text, compact: false) }
                        .alertsForm()
                        .frame(maxWidth: 560)
                    Form { queueSections(text, compact: false) }
                        .alertsForm()
                }
            } else {
                ScrollViewReader { proxy in
                    Form {
                        primarySections(text, compact: true)
                        queueSections(text, compact: true)
                    }
                    .alertsForm()
                    .task { await scrollOnLaunch(proxy) }
                }
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .navigationTitle(Screen.alerts.title)
        .toolbar { addMenu }
        .sheet(item: $editor) { target in
            NavigationStack { AlertEditor(target: target) }
                #if os(macOS)
                .frame(minWidth: 480, idealWidth: 520, minHeight: 620, idealHeight: 720)
                #endif
        }
        .task { openLaunchEditor() }
    }

    // MARK: - Sections

    @ViewBuilder
    private func primarySections(_ text: AlertText, compact: Bool) -> some View {
        if alerts.plan.outOfRange {
            outOfRangeSection(text)
        } else if alerts.authorization != .authorized && alerts.authorization != .unknown && !alerts.rules.isEmpty
            || alerts.authorization == .denied {
            Section { AuthorizationCard(state: alerts.authorization) { request() } }
                .alertRow()
        }
        if compact { heroSection(text) }
        rulesSection(text)
        if alerts.rules.isEmpty || alerts.rules.count < 3 { presetsSection(text) }
        QuietHoursSection(quiet: Bindable(alerts).quiet, words: text.words, zone: settings.timeZone, now: alerts.now)
            .alertRow()
            .id("quiet")
    }

    @ViewBuilder
    private func queueSections(_ text: AlertText, compact: Bool) -> some View {
        if !compact { heroSection(text) }
        upcomingSection(text, limit: compact ? 6 : nil)
        recentSection(text)
        statusSection(text)
    }

    @ViewBuilder
    private func heroSection(_ text: AlertText) -> some View {
        if let first = alerts.scheduled.first ?? (alerts.authorization.canPost ? nil : alerts.plan.alerts.first),
           let rule = alerts.rule(first.ruleID) {
            Section {
                NextAlertHero(alert: first, rule: rule, message: alerts.messages[first.id], text: text,
                              held: alerts.pending.contains(first.id), now: { alerts.now })
            }
            .id("hero")
            .alertRow()
        }
    }

    private func rulesSection(_ text: AlertText) -> some View {
        Section {
            if alerts.rules.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("No alerts yet")
                        .font(.headline)
                        .foregroundStyle(Theme.ink)
                    Text("Choose the moments you want to hear about: start from a preset below, or make your own with +.")
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink2)
                }
                .padding(.vertical, 4)
            }
            ForEach(alerts.rules) { rule in
                RuleRow(rule: rule, next: alerts.plan.next[rule.id], text: text, now: { alerts.now },
                        isEnabled: enabledBinding(rule.id))
                    .onTapGesture { editor = AlertEditorTarget(rule: rule, isNew: false) }
                    .accessibilityAction(named: "Edit") { editor = AlertEditorTarget(rule: rule, isNew: false) }
                    .contextMenu {
                        Button("Edit", systemImage: "pencil") { editor = AlertEditorTarget(rule: rule, isNew: false) }
                        Button("Duplicate", systemImage: "plus.square.on.square") { alerts.duplicate(rule.id) }
                            .disabled(!alerts.canAddRule)
                        Divider()
                        Button("Delete", systemImage: "trash", role: .destructive) { alerts.remove([rule.id]) }
                    }
                    .swipeActions(edge: .trailing) {
                        Button("Delete", systemImage: "trash", role: .destructive) { alerts.remove([rule.id]) }
                    }
                    .swipeActions(edge: .leading) {
                        Button("Duplicate", systemImage: "plus.square.on.square") { alerts.duplicate(rule.id) }
                            .tint(Theme.cursor)
                    }
            }
            .onMove { alerts.move(from: $0, to: $1) }
        } header: {
            Text("Your alerts")
        }
        .id("rules")
        .alertRow()
        .sensoryFeedback(.selection, trigger: alerts.rules.map(\.enabled)) { _, _ in settings.haptics }
    }

    private func presetsSection(_ text: AlertText) -> some View {
        Section {
            ForEach(AlertPreset.allCases.filter { p in !alerts.rules.contains { $0.name == p.title } }) { preset in
                Button { add(preset) } label: {
                    HStack(spacing: 12) {
                        SubjectBadge(subject: preset.subject, size: 30)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(preset.title)
                                .foregroundStyle(Theme.ink)
                            Text(preset.detail(pure: settings.pure))
                                .font(.footnote)
                                .foregroundStyle(Theme.ink2)
                        }
                        Spacer(minLength: 4)
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                            .foregroundStyle(Theme.teal)
                            .symbolRenderingMode(.hierarchical)
                    }
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .disabled(!alerts.canAddRule)
                .accessibilityLabel("Add \(preset.title)")
            }
        } header: {
            Text("Start from a preset")
        }
        .id("presets")
        .alertRow()
    }

    @ViewBuilder
    private func upcomingSection(_ text: AlertText, limit: Int?) -> some View {
        let held = alerts.authorization.canPost
        let list = held ? alerts.scheduled : alerts.plan.alerts
        if !list.isEmpty {
            if let limit {
                Section {
                    upcomingRows(Array(list.prefix(limit)), text, held: held, relative: true)
                    if list.count > limit {
                        NavigationLink {
                            UpcomingList(text: text).navigationTitle("Upcoming")
                        } label: {
                            Text("All \(list.count) \(held ? "queued" : "planned")")
                                .foregroundStyle(Theme.teal)
                        }
                    }
                } header: {
                    upcomingHeader(list.count, held: held)
                } footer: {
                    if !held { Text("Nothing is queued until notifications are allowed.") }
                }
                .alertRow()
                .id("upcoming")
            } else {
                UpcomingSections(list: list, text: text, held: held)
            }
        }
    }

    private func upcomingHeader(_ count: Int, held: Bool) -> some View {
        HStack {
            Text(held ? "Upcoming" : "Would notify")
            Spacer()
            Text("\(count) of \(AlertPlanner.budget)")
                .monospacedDigit()
        }
    }

    private func upcomingRows(_ list: [PlannedAlert], _ text: AlertText, held: Bool, relative: Bool) -> some View {
        ForEach(list) { alert in
            UpcomingRow(alert: alert, message: alerts.messages[alert.id], ruleName: alerts.rule(alert.ruleID)?.name,
                        text: text, now: { alerts.now }, held: held)
        }
    }

    @ViewBuilder
    private func recentSection(_ text: AlertText) -> some View {
        if !alerts.delivered.isEmpty {
            Section {
                ForEach(alerts.delivered.prefix(5)) { item in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "bell.fill")
                            .font(.caption)
                            .foregroundStyle(item.ruleID.flatMap { alerts.rule($0)?.subject.color } ?? Theme.ink3)
                            .frame(width: 16)
                            .padding(.top, 3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.title)
                                .font(.subheadline)
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                            Text(text.words.relative(item.date.timeIntervalSince1970, to: alerts.now))
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(Theme.ink3)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            } header: {
                HStack {
                    Text("Recent")
                    Spacer()
                    Button("Clear") { alerts.clearDelivered() }
                        .font(.caption)
                        .buttonStyle(.borderless)
                }
            }
            .alertRow()
            .id("recent")
        }
    }

    private func statusSection(_ text: AlertText) -> some View {
        Section {
        } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if !clockStore.isLive {
                    Label("Alerts follow the real clock, not the moment you are viewing.", systemImage: "clock.arrow.circlepath")
                }
                Text(statusLine(text))
            }
        }
    }

    private func statusLine(_ text: AlertText) -> String {
        let held = alerts.pending.count
        var line = alerts.authorization.canPost
            ? "\(held) of \(AlertPlanner.budget) alerts queued with the system, shared fairly between your alerts."
            : "Alerts are planned but not queued."
        if let refill = alerts.lastRefill, !alerts.launch.isPreview {
            line += " Refilled \(text.words.relative(refill.timeIntervalSince1970, to: Date.now.timeIntervalSince1970))."
        }
        return line
    }

    private func outOfRangeSection(_ text: AlertText) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Label("Outside the catalogue", systemImage: "circle.dashed")
                    .font(.headline)
                    .foregroundStyle(Theme.ink)
                Text("The device's clock reads a moment outside Saros 141's catalogue (\(settings.pure ? text.notation.catalogueText() : "1613 – 2857, " + text.notation.catalogueText())). There are no cycles to alert about, so nothing is queued.")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink2)
            }
            .padding(.vertical, 4)
        }
        .alertRow()
    }

    // MARK: - Toolbar and actions

    private var addMenu: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Menu {
                Button("New Alert…", systemImage: "square.and.pencil") {
                    editor = AlertEditorTarget.new(pure: settings.pure)
                }
                Section("Presets") {
                    ForEach(AlertPreset.allCases) { preset in
                        Button(preset.title) { add(preset) }
                    }
                }
            } label: {
                Label("Add Alert", systemImage: "plus")
            }
            .disabled(!alerts.canAddRule)
        }
    }

    private func enabledBinding(_ id: UUID) -> Binding<Bool> {
        Binding(
            get: { alerts.rule(id)?.enabled ?? false },
            set: { alerts.setEnabled(id, $0) }
        )
    }

    private func add(_ preset: AlertPreset) {
        withAnimation(.snappy) { alerts.add(preset.rule(pure: settings.pure)) }
        Haptics.play(.success)
        if alerts.authorization == .notDetermined { request() }
    }

    private func request() {
        Task { await alerts.requestAuthorization() }
    }

    /// `-FXAlertsScroll`: a section to show on launch (screenshots).
    private func scrollOnLaunch(_ proxy: ScrollViewProxy) async {
        guard let target = alerts.launch.scroll else { return }
        try? await Task.sleep(for: .seconds(1))
        proxy.scrollTo(target, anchor: .top)
    }

    /// `-FXAlertsEdit`: a preset's id, "new", or "rule" (the first rule).
    private func openLaunchEditor() {
        guard let what = alerts.launchEditor else { return }
        alerts.launchEditor = nil
        if what == "new" {
            editor = .new(pure: settings.pure)
        } else if let preset = AlertPreset(rawValue: what) {
            editor = AlertEditorTarget(rule: preset.rule(pure: settings.pure), isNew: true)
        } else if let rule = alerts.rules.first {
            editor = AlertEditorTarget(rule: rule, isNew: false)
        }
    }
}

// MARK: - The next alert

/// The next alert, large: the rhythm it waits on (the running cycle of its level, or the sync, at the real now), what
/// it will say and a live countdown.
private struct NextAlertHero: View {
    let alert: PlannedAlert
    let rule: AlertRule
    let message: AlertMessage?
    let text: AlertText
    let held: Bool
    let now: () -> Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let t = now()
            HStack(alignment: .center, spacing: 16) {
                ZStack {
                    RhythmRing(progress: progress(at: t), color: alert.occurrence.subject.color,
                               events: rule.subject.hasEvents ? rule.events : [], lineWidth: 4)
                    SubjectBadge(subject: alert.occurrence.subject, size: 38)
                }
                .frame(width: 74, height: 74)
                VStack(alignment: .leading, spacing: 4) {
                    Text(held ? "NEXT ALERT" : "NEXT, ONCE ALLOWED")
                        .font(.caption2.weight(.semibold))
                        .tracking(1.2)
                        .foregroundStyle(Theme.ink3)
                    Text(message?.title ?? rule.name)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                    Text(text.words.countdown(alert.fire - t, at: t))
                        .font(.reading(24, weight: .medium))
                        .foregroundStyle(alert.occurrence.subject.color)
                        .contentTransition(reduceMotion ? .identity : .numericText(countsDown: true))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text("\(text.words.label(alert.fire + 0.002, relativeTo: t)) · \(rule.name)")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 8)
            .accessibilityElement(children: .combine)
        }
    }

    /// Where the running cycle of the alert's level (the sync for the sync) stands at the real now.
    private func progress(at t: Double) -> Double? {
        switch alert.occurrence.subject {
        case .level(let level): text.clock.level(at: t, level)?.progress
        case .solar: text.clock.solar(at: t)?.phase
        case .eclipse:
            text.clock.position(at: t).map { $0 - $0.rounded(.down) }
        }
    }
}

// MARK: - The whole queue

/// Every planned alert, grouped by the day it falls on (pure: by its Nuclide).
private struct UpcomingSections: View {
    let list: [PlannedAlert]
    let text: AlertText
    let held: Bool

    @State private var alerts = AlertStore.shared

    var body: some View {
        let groups = Dictionary(grouping: list) { text.words.day($0.fire + 0.002) }
        let order = list.reduce(into: [String]()) { keys, a in
            let key = text.words.day(a.fire + 0.002)
            if keys.last != key { keys.append(key) }
        }
        ForEach(Array(order.enumerated()), id: \.element) { index, day in
            Section {
                ForEach(groups[day] ?? []) { alert in
                    UpcomingRow(alert: alert, message: alerts.messages[alert.id], ruleName: alerts.rule(alert.ruleID)?.name,
                                text: text, now: { alerts.now }, held: held)
                }
            } header: {
                if index == 0 {
                    HStack {
                        Text(day)
                        Spacer()
                        Text("\(list.count) of \(AlertPlanner.budget) \(held ? "queued" : "planned")")
                            .monospacedDigit()
                    }
                } else {
                    Text(day)
                }
            }
            .alertRow()
        }
    }
}

/// The queue on its own page (iPhone).
private struct UpcomingList: View {
    let text: AlertText

    @State private var alerts = AlertStore.shared

    var body: some View {
        let held = alerts.authorization.canPost
        Form {
            UpcomingSections(list: held ? alerts.scheduled : alerts.plan.alerts, text: text, held: held)
        }
        .alertsForm()
    }
}

// MARK: - Styling

extension View {
    /// The Alerts forms: grouped, on the app's backdrop.
    fileprivate func alertsForm() -> some View {
        formStyle(.grouped)
            .scrollContentBackground(.hidden)
    }

    /// Rows on the app's panel colour.
    fileprivate func alertRow() -> some View {
        listRowBackground(Theme.panel)
    }
}
