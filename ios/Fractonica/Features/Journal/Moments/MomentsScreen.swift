import FractonicaKit
import SwiftUI

/// Moments: a tab of its own on iPhone (Now · Cycles · Journal · Moments · Clock), a sidebar screen on iPad and Mac
/// (⌘0). The streak, the next moment with its live countdown (and the way back in while its call rings), the missed
/// calls (looking at them clears the badge), Test a Call, the collection by rarity (a rarity opens its entries), the
/// recent captures as cards (each opens the entry), when each rarer kind comes next, and the settings. The countdowns
/// run on the device clock and only while the screen is in view.
///
/// Launch arguments: `-FXTab moments` (or `-FXMomentsSheet 1`), `-FXMomentsSettings 1` (on its settings).
struct MomentsScreen: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @State private var moments = MomentStore.shared
    @State private var journal = JournalStore.shared
    @State private var ui = JournalUI.shared
    /// In view: the countdowns tick only then.
    @State private var visible = false
    @State private var showSettings = false
    @State private var launched = false

    var body: some View {
        let words = settings.wording
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                StreakHero(stats: moments.stats)
                if !moments.settings.enabled {
                    OffCard { moments.settings.enabled = true }
                } else if !moments.authorization.canPost && moments.authorization != .unknown {
                    PermissionCard(authorization: moments.authorization) {
                        Task { await moments.requestAuthorization() }
                    }
                } else if moments.alarmAuthorization == .denied {
                    AlarmsOffCard()
                }
                NextMomentCard(words: words, live: visible)
                if moments.stats.missedCount > 0 { MissedCalls(words: words) }
                TestMomentRow()
                MomentsSection(title: "Collection") { CollectionGrid(stats: moments.stats) }
                recent(words)
                MomentsSection(title: "Rarer moments ahead") { RareAhead(words: words, live: visible) }
                settingsRow
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
            .padding(.bottom, 28)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
        .navigationTitle(Screen.moments.title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Moment Settings", systemImage: "slider.horizontal.3") { showSettings = true }
                    .help("Moment settings: which moments, quiet hours, the announcement")
            }
        }
        .navigationDestination(for: MomentsRoute.self) { route in
            switch route {
            case .captures(let rarity): MomentsCollectionView(rarity: rarity)
            case .entry(let id): JournalRecordView(id: id)
            }
        }
        .navigationDestination(isPresented: $showSettings) { MomentSettingsView() }
        .onAppear {
            visible = true
            moments.markMissedSeen()
            if !launched, moments.launch.settings { showSettings = true }
            launched = true
            if moments.authorization == .notDetermined, moments.settings.enabled, !moments.launch.isPreview {
                Task { await moments.requestAuthorization() }
            } else if moments.alarmAuthorization == .notDetermined, moments.settings.enabled, !moments.launch.isPreview,
                      moments.launch.autoOpen {
                // notifications were allowed before the calls: the alarms are asked for now
                Task { await moments.requestAlarms() }
            }
        }
        .onDisappear { visible = false }
        .onChange(of: moments.stats.missedCount) { if visible { moments.markMissedSeen() } }
        .onChange(of: ui.composer) { _, request in
            // an entry's Edit (in its detail, pushed here): the composer belongs to the Journal, which presents it
            if request != nil, router.selection == .moments { router.show(.journal) }
        }
    }

    /// The latest captures as cards, with the way to all of them.
    @ViewBuilder
    private func recent(_ words: Wording) -> some View {
        let captured = journal.entries.filter { $0.capture.map { !$0.missed } ?? false }
        MomentsSection(title: "Recent captures") {
            if captured.isEmpty {
                Text("Your captures show here: 2 Flavons before each moment Fractonica calls you. Answer and the back camera films until you hang up; mute and both cameras film through the moment into a reel; decline and each camera takes a photo.")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Theme.panel, in: .rect(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
            } else {
                LazyVStack(spacing: 14) {
                    ForEach(captured.prefix(4), id: \.id) { record in
                        NavigationLink(value: MomentsRoute.entry(record.id)) {
                            CaptureCard(record: record, words: words)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        } accessory: {
            if captured.count > 4 {
                NavigationLink(value: MomentsRoute.captures(nil)) {
                    Text(verbatim: "All \(captured.count)")
                        .font(.subheadline)
                }
                .buttonStyle(.borderless)
                .tint(Theme.teal)
            }
        }
    }

    private var settingsRow: some View {
        Button { showSettings = true } label: {
            HStack(spacing: 12) {
                Label("Moment Settings", systemImage: "slider.horizontal.3")
                    .foregroundStyle(Theme.ink)
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3)
            }
            .padding(14)
            .background(Theme.panel, in: .rect(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .contentShape(.rect(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

/// Where the Moments screen goes: the entries of a rarity (nil: every captured entry), one entry.
enum MomentsRoute: Hashable {
    case captures(MomentRarity?)
    case entry(String)
}

/// A titled part of the Moments screen, with an optional accessory at the title's trailing end.
private struct MomentsSection<Content: View, Accessory: View>: View {
    let title: String
    @ViewBuilder var content: Content
    @ViewBuilder var accessory: Accessory

    init(title: String, @ViewBuilder content: () -> Content, @ViewBuilder accessory: () -> Accessory = { EmptyView() }) {
        self.title = title
        self.content = content()
        self.accessory = accessory()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.ink3)
                    .textCase(.uppercase)
                Spacer()
                accessory
            }
            content
        }
    }
}

/// The entries of one rarity (common: those without a capture), newest first, as cards; each opens the entry.
struct MomentsCollectionView: View {
    /// Nil: every captured entry.
    let rarity: MomentRarity?

    @Environment(AppSettings.self) private var settings
    @State private var journal = JournalStore.shared

    var body: some View {
        let words = settings.wording
        let entries = journal.entries.filter { record in
            guard record.capture?.missed != true else { return false }
            return rarity == nil ? record.capture != nil : record.rarity == rarity
        }
        ScrollView {
            LazyVStack(spacing: 14) {
                if entries.isEmpty {
                    ContentUnavailableView(rarity.map { "No \($0.title.lowercased()) entries yet" } ?? "No captures yet",
                                           systemImage: rarity?.symbol ?? "camera",
                                           description: Text(emptyText))
                }
                ForEach(entries, id: \.id) { record in
                    NavigationLink(value: MomentsRoute.entry(record.id)) {
                        if record.capture != nil {
                            CaptureCard(record: record, words: words)
                        } else {
                            JournalCard(record: record, words: words, fullStamp: true)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background { Backdrop() }
        .navigationTitle(rarity.map { "\($0.title) (\(entries.count))" } ?? "Captures (\(entries.count))")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    private var emptyText: String {
        switch rarity {
        case nil: "Captured moments show here."
        case .common?: "Entries written outside a moment are common."
        case let r?: "\(r.title) entries are captured on \(r.source) moments."
        }
    }
}

/// The big flame: the current streak, the best, how many are captured.
private struct StreakHero: View {
    let stats: MomentStats

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().fill(Theme.gold.opacity(stats.current > 0 ? 0.16 : 0.06))
                Image(systemName: "flame.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(stats.current > 0 ? Theme.gold : Theme.ink3)
            }
            .frame(width: 72, height: 72)
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: "\(stats.current)")
                    .font(.reading(40, weight: .bold))
                    .foregroundStyle(Theme.ink)
                Text(stats.current == 1 ? "moment in a row" : "moments in a row")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Theme.ink2)
                Text(verbatim: "Best \(stats.best) · \(stats.capturedCount) captured")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Theme.panel, in: .rect(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Test a Call: a made-up moment's call, to try the ringing and each choice any time — ringing now (its moment 2 Flavons
/// away), or in 2 Flavons, time to lock the phone and hear it ring as an alarm. Whatever is chosen is saved like a real
/// call; it never counts for the streak.
private struct TestMomentRow: View {
    @State private var moments = MomentStore.shared

    private var flavon: Double { FractonicaClock.shared.levelInfo(10).meanSeconds }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Menu {
                Button("Ring Now", systemImage: "phone.arrow.down.left") { moments.openTest() }
                Button("Ring in 2 Flavons", systemImage: "lock.iphone") { moments.scheduleTest(in: 2 * flavon) }
            } label: {
                Label(moments.testCall != nil ? "Test Call Coming…" : "Test a Call", systemImage: "phone.badge.waveform").frame(maxWidth: .infinity)
            } primaryAction: {
                moments.openTest()
            }
            .menuStyle(.button)
            .glassButtonStyle()
            .controlSize(.large)
            .buttonBorderShape(.capsule)
            .disabled(moments.instant != nil)
            .accessibilityHint("Rings a made-up moment's call now")
            Text("A made-up moment calls now, 2 Flavons ahead (hold for one in 2 Flavons: lock the phone to hear it ring as an alarm). Answer, mute or decline it: it is saved like a real call and never counts for the streak.")
                .font(.footnote)
                .foregroundStyle(Theme.ink3)
        }
    }
}

/// The missed calls: how many, the latest three in red (each opens its entry), as a phone's recent calls show them.
private struct MissedCalls: View {
    let words: Wording
    @State private var moments = MomentStore.shared
    @State private var journal = JournalStore.shared

    var body: some View {
        let missed = journal.entries.filter { $0.capture?.missed == true }
        let count = moments.stats.missedCount
        MomentsSection(title: count == 1 ? "1 missed call" : "\(count) missed calls") {
            VStack(spacing: 0) {
                ForEach(Array(missed.prefix(3).enumerated()), id: \.element.id) { i, record in
                    NavigationLink(value: MomentsRoute.entry(record.id)) {
                        HStack(spacing: 12) {
                            Image(systemName: "phone.down.fill")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.danger)
                                .frame(width: 22)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: name(record))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(Theme.danger)
                                JournalStampText(time: record.time, words: words, full: true)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3)
                        }
                        .padding(.vertical, 10)
                        .padding(.horizontal, 14)
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    if i < min(3, missed.count) - 1 { Divider().overlay(Theme.line).padding(.leading, 48) }
                }
            }
            .background(Theme.panel, in: .rect(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
        }
    }

    /// The moment the missed call was: "Helion 34η Ascending Node".
    private func name(_ record: HubRecord) -> String {
        guard let c = record.capture, let q = moments.calendar.index(near: c.at), let m = moments.calendar.moment(q) else {
            return "Missed Call"
        }
        return m.title(words.notation)
    }
}

/// The next moment that calls: its name and rarity, the countdown, when it calls, and while a call rings unanswered,
/// the way back to it. It ticks once a second on the device clock while `live` (the screen in view), and holds still
/// otherwise.
private struct NextMomentCard: View {
    let words: Wording
    let live: Bool
    @State private var moments = MomentStore.shared

    var body: some View {
        if live {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                card(at: context.date.timeIntervalSince1970)
            }
        } else {
            card(at: Date.now.timeIntervalSince1970)
        }
    }

    @ViewBuilder
    private func card(at t: Double) -> some View {
        if let m = moments.ringingCall(at: t) ?? moments.nextMoment(after: t) {
            let prompt = moments.calendar.promptTime(of: m)
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Next moment")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink3)
                        .textCase(.uppercase)
                    Spacer()
                    RarityBadge(rarity: m.rarity, compact: true)
                }
                Text.ledByPentad(m.pentad, Text(verbatim: m.title(words.notation)), separator: " · ")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.levelColor(m.level.kitLevel, lightness: 0.7))
                Text(verbatim: m.time > t ? words.countdown(m.time - t, at: t) : "Ringing now")
                    .font(.reading(17, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .contentTransition(.identity)
                if !words.pure {
                    Text(verbatim: words.label(m.time, relativeTo: t))
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                }
                Label("Calls \(MomentCalendar.leadFlavons) Flavons before, rings for \(MomentCalendar.ringFlavons)", systemImage: "phone")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2)
                if prompt <= t {
                    Button {
                        moments.openCall(m)
                    } label: {
                        Label("Ringing — Pick Up", systemImage: "phone.fill").frame(maxWidth: .infinity)
                    }
                    .glassProminentButtonStyle()
                    .tint(Color(red: 0.2, green: 0.78, blue: 0.35))
                    .controlSize(.large)
                    .buttonBorderShape(.capsule)
                } else {
                    Text(verbatim: "Calls \(words.countdown(prompt - t, at: t))")
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                        .contentTransition(.identity)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.panel, in: .rect(cornerRadius: 22, style: .continuous))
            .rarityFrame(m.rarity)
            .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(m.rarity == .common ? Theme.line : .clear, lineWidth: 1))
        } else {
            Text(moments.settings.enabled ? "No moment ahead in the catalogue." : "Moments are off.")
                .font(.callout)
                .foregroundStyle(Theme.ink3)
        }
    }
}

/// How many entries of each rarity the journal holds, each in its frame.
private struct CollectionGrid: View {
    let stats: MomentStats

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(MomentRarity.allCases, id: \.self) { rarity in
                NavigationLink(value: MomentsRoute.captures(rarity)) {
                    tile(rarity)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Shows the \(rarity.title.lowercased()) entries")
            }
        }
    }

    private func tile(_ rarity: MomentRarity) -> some View {
        VStack(spacing: 6) {
            Image(systemName: rarity.symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(rarity == .cosmic ? AnyShapeStyle(LinearGradient(colors: MomentRarity.rainbow, startPoint: .leading, endPoint: .trailing)) : AnyShapeStyle(rarity.color))
            Text(verbatim: "\(stats.total(rarity))")
                .font(.reading(22, weight: .semibold))
                .foregroundStyle(Theme.ink)
            Text(rarity.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.ink3)
            Text(rarity.source)
                .font(.caption2)
                .foregroundStyle(Theme.ink3.opacity(0.8))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity)
        .background(Theme.panel, in: .rect(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
        .rarityFrame(rarity, cornerRadius: 16, turns: false)  // the Moments screen stays open: no endless animation
        .contentShape(.rect(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

extension MomentRarity {
    /// What makes an entry this rare.
    var source: String {
        switch self {
        case .common: "any time"
        case .rare: "Helion nodes"
        case .epic: "Delta"
        case .legendary: "Gamma"
        case .mythic: "Beta"
        case .cosmic: "Alpha"
        }
    }
}

/// When the next epic, legendary, mythic and cosmic moments come.
private struct RareAhead: View {
    let words: Wording
    /// In view: updated once a minute; held otherwise.
    let live: Bool
    @State private var moments = MomentStore.shared

    var body: some View {
        if live {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                list(at: context.date.timeIntervalSince1970)
            }
        } else {
            list(at: Date.now.timeIntervalSince1970)
        }
    }

    private func list(at t: Double) -> some View {
        VStack(spacing: 0) {
            ForEach([MomentLevel.delta, .gamma, .beta, .alpha], id: \.self) { level in
                if let m = moments.calendar.next(exactly: level, after: t) {
                    HStack(spacing: 10) {
                        Image(systemName: level.rarity.symbol)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(level.rarity.color)
                            .frame(width: 20)
                        VStack(alignment: .leading, spacing: 2) {
                            Text.ledByPentad(m.pentad, Text(verbatim: m.title(words.notation)), separator: " · ")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                            Text(verbatim: "\(level.rarity.title) · \(words.countdown(m.time - t, at: t))")
                                .font(.footnote)
                                .foregroundStyle(Theme.ink3)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, 9)
                    .padding(.horizontal, 14)
                    if level != .alpha { Divider().overlay(Theme.line).padding(.leading, 44) }
                }
            }
        }
        .background(Theme.panel, in: .rect(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

private struct OffCard: View {
    let turnOn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Moments are off")
                .font(.headline)
                .foregroundStyle(Theme.ink)
            Text("Turn them on to be called 2 Flavons before each moment, and answer, mute or decline to capture it.")
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
            Button("Turn On", action: turnOn)
                .glassProminentButtonStyle()
                .tint(Theme.teal)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

/// Alarms refused: calls ring only while the app is in front.
private struct AlarmsOffCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Alarms are off", systemImage: "alarm.waves.left.and.right")
                .font(.headline)
                .foregroundStyle(Theme.ink)
            Text("Calls ring only while Fractonica is open, and a notification rings the ringtone once otherwise. To be called with the phone locked, allow Alarms for Fractonica in Settings.")
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

private struct PermissionCard: View {
    let authorization: MomentAuthorization
    let ask: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Notifications are off", systemImage: "bell.slash")
                .font(.headline)
                .foregroundStyle(Theme.ink)
            Text(authorization == .denied
                 ? "Moments ring by themselves while the app is in front. To be called when it is not, allow notifications for Fractonica in Settings."
                 : "Allow notifications (and alarms) to be called 2 Flavons before each moment, even with the phone locked.")
                .font(.footnote)
                .foregroundStyle(Theme.ink2)
            if authorization == .notDetermined {
                Button("Allow Notifications", action: ask)
                    .glassProminentButtonStyle()
                    .tint(Theme.teal)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.panel, in: .rect(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line, lineWidth: 1))
    }
}

// MARK: - Settings

/// Moments' settings: on or off, which Helion moments call (Delta and longer always do), quiet hours, the ringtone (on
/// a page of its own, each previewing on a tap), whether the call rings in the app by itself, and the permissions:
/// alarms (to ring with the phone locked) and notifications.
struct MomentSettingsView: View {
    @Environment(AppSettings.self) private var settings
    @State private var moments = MomentStore.shared
    @State private var ringer = MomentRinger.shared

    var body: some View {
        @Bindable var moments = moments
        Form {
            Section {
                Toggle("Moments", isOn: $moments.settings.enabled)
                    .onChange(of: moments.settings.enabled) { _, on in
                        if on, moments.authorization == .notDetermined { Task { await moments.requestAuthorization() } }
                    }
                Picker("Helion moments", selection: $moments.settings.helion) {
                    ForEach(HelionPrompts.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                .disabled(!moments.settings.enabled)
            } footer: {
                Text("A Helion's rare moments are its two nodes: ascending at its start (Preon 0), descending at its mid point (Preon 18). The start, peak, node and valley of a Delta, Gamma, Beta or Alpha always call: they are rarer still.")
            }
            Section {
                Toggle("Quiet hours", isOn: $moments.settings.quiet.enabled)
                if moments.settings.quiet.enabled {
                    if settings.pure {
                        Text("From the Earth evening to the morning. Turn pure mode off to choose the hours.")
                            .font(.footnote)
                            .foregroundStyle(Theme.ink3)
                    } else {
                        DatePicker("From", selection: minutes(\.start), displayedComponents: .hourAndMinute)
                        DatePicker("To", selection: minutes(\.end), displayedComponents: .hourAndMinute)
                    }
                }
            } footer: {
                Text("Moments in quiet hours do not call and do not break your streak.")
            }
            Section {
                NavigationLink {
                    RingtonePicker()
                } label: {
                    LabeledContent("Ringtone", value: moments.settings.ringtone.title)
                }
            } footer: {
                Text("A call rings 2 Flavons before its moment for 11 Flavons, through the silent switch.")
            }
            Section {
                Toggle("Ring in the app", isOn: $moments.settings.autoOpen)
            } footer: {
                Text("While Fractonica is in front its call screen rings; otherwise an alarm rings it, on the Lock Screen too. With Ring in the app off, the alarm rings even then.")
            }
            Section {
                LabeledContent("Alarms", value: alarmPermission)
                if moments.alarmAuthorization == .notDetermined {
                    Button("Allow Alarms") { Task { await moments.requestAlarms() } }
                }
                LabeledContent("Notifications", value: permission)
                LabeledContent("Calls queued", value: "\(moments.pendingCount)")
                if moments.authorization == .notDetermined {
                    Button("Allow Notifications") { Task { await moments.requestAuthorization() } }
                }
            } header: {
                Text("Calling")
            } footer: {
                Text(moments.alarmAuthorization == .unsupported
                     ? "Without alarms (iOS 26) a notification rings the ringtone once; \"Missed Call\" follows when a call rings out."
                     : "Alarms ring a call with the phone locked: Answer opens it picked up, Stop declines it. A notification says \"Missed Call\" when one rings out.")
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Moment Settings")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .environment(\.timeZone, settings.timeZone)
        .onDisappear { ringer.stop() }
    }

    private var alarmPermission: String {
        switch moments.alarmAuthorization {
        case .authorized: "Allowed"
        case .denied: "Off in Settings"
        case .notDetermined: "Not asked yet"
        case .unsupported: "Needs iOS 26"
        case .unknown: "…"
        }
    }

    private var permission: String {
        switch moments.authorization {
        case .authorized: "Allowed"
        case .provisional: "Quiet delivery"
        case .denied: "Off in Settings"
        case .notDetermined: "Not asked yet"
        case .unknown: "…"
        }
    }

    /// A quiet-hours bound (minutes after midnight) as a time of day in the app's zone.
    private func minutes(_ key: WritableKeyPath<MomentQuietHours, Int>) -> Binding<Date> {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = settings.timeZone
        let midnight = cal.startOfDay(for: .now)
        return Binding(
            get: { midnight.addingTimeInterval(Double(moments.settings.quiet[keyPath: key]) * 60) },
            set: { date in
                let c = cal.dateComponents([.hour, .minute], from: date)
                moments.settings.quiet[keyPath: key] = (c.hour ?? 0) * 60 + (c.minute ?? 0)
            }
        )
    }
}

/// Settings › Ringtone: the synthesised ringtones, then the alarms; a tap chooses one and plays its first two rings.
private struct RingtonePicker: View {
    @State private var moments = MomentStore.shared
    @State private var ringer = MomentRinger.shared

    var body: some View {
        Form {
            Section {
                rows(MomentRingtone.synthesised)
            } footer: {
                Text("A tap plays two rings.")
            }
            Section("Alarms") {
                rows(MomentRingtone.alarms)
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Ringtone")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .onDisappear { ringer.stop() }
    }

    private func rows(_ tones: [MomentRingtone]) -> some View {
        ForEach(tones, id: \.self) { tone in
            RingtoneRow(tone: tone, selected: moments.settings.ringtone == tone) {
                moments.settings.ringtone = tone
                ringer.preview(tone)
            }
        }
    }
}

/// A ringtone to choose: its name, a tick when chosen, a speaker while it plays.
private struct RingtoneRow: View {
    let tone: MomentRingtone
    let selected: Bool
    let choose: () -> Void
    @State private var ringer = MomentRinger.shared

    var body: some View {
        Button(action: choose) {
            HStack {
                Text(tone.title).foregroundStyle(Theme.ink)
                Spacer()
                if ringer.previewing == tone {
                    Image(systemName: "speaker.wave.2.fill").foregroundStyle(Theme.teal).symbolEffect(.variableColor.iterative)
                }
                if selected { Image(systemName: "checkmark").foregroundStyle(Theme.teal).fontWeight(.semibold) }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityHint("Plays two rings")
    }
}
