import FractonicaKit
import SwiftUI

/// Moments: a tab of its own on iPhone (Now · Cycles · Journal · Moments · Clock), a sidebar screen on iPad and Mac
/// (⌘0). The streak, the next moment with its live countdown (and the way in while its 11 Flavons run), the collection
/// by rarity (a rarity opens its entries), the recent captures as cards (each opens the entry), when each rarer kind
/// comes next, and the settings. The countdowns run on the device clock and only while the screen is in view.
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
                }
                NextMomentCard(words: words, live: visible)
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
                    .help("Moment settings: captures, which moments, quiet hours")
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
            if !launched, moments.launch.settings { showSettings = true }
            launched = true
            if moments.authorization == .notDetermined, moments.settings.enabled, !moments.launch.isPreview {
                Task { await moments.requestAuthorization() }
            }
        }
        .onDisappear { visible = false }
        .onChange(of: ui.composer) { _, request in
            // an entry's Edit (in its detail, pushed here): the composer belongs to the Journal, which presents it
            if request != nil, router.selection == .moments { router.show(.journal) }
        }
    }

    /// The latest captures as cards, with the way to all of them.
    @ViewBuilder
    private func recent(_ words: Wording) -> some View {
        let captured = journal.entries.filter { $0.capture != nil }
        MomentsSection(title: "Recent captures") {
            if captured.isEmpty {
                Text("Your captures show here: when a moment comes, Fractonica calls you 11 Flavons ahead and both cameras capture it.")
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
                Text(verbatim: moments.capturesPerMoment == 1 ? "1 capture" : "\(moments.capturesPerMoment) captures")
                    .font(.subheadline)
                    .foregroundStyle(Theme.ink3)
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
        let entries = journal.entries.filter { rarity == nil ? $0.capture != nil : $0.rarity == rarity }
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

/// The next announced moment: its name and rarity, the countdown, its captures, and while its 11 Flavons run, the way
/// in. It ticks once a second on the device clock while `live` (the screen in view), and holds still otherwise.
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
        if let m = moments.nextMoment(after: t) {
            let prompt = moments.calendar.promptTime(of: m)
            let count = moments.capturesPerMoment
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text("Next moment")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Theme.ink3)
                        .textCase(.uppercase)
                    Spacer()
                    RarityBadge(rarity: m.rarity, compact: true)
                }
                Text(verbatim: m.title(words.notation))
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Theme.levelColor(m.level.kitLevel, lightness: 0.7))
                Text(verbatim: words.countdown(m.time - t, at: t))
                    .font(.reading(17, weight: .medium))
                    .foregroundStyle(Theme.ink2)
                    .contentTransition(.identity)
                if !words.pure {
                    Text(verbatim: words.label(m.time, relativeTo: t))
                        .font(.footnote)
                        .foregroundStyle(Theme.ink3)
                }
                Label(Self.capturesLine(count), systemImage: count > 1 ? "camera.on.rectangle" : "camera")
                    .font(.footnote)
                    .foregroundStyle(Theme.ink2)
                if prompt <= t {
                    Button {
                        moments.openInstant(m)
                    } label: {
                        Label("Get Ready", systemImage: "camera.fill").frame(maxWidth: .infinity)
                    }
                    .glassProminentButtonStyle()
                    .tint(m.rarity.color)
                    .controlSize(.large)
                    .buttonBorderShape(.capsule)
                } else {
                    Text(verbatim: "Announced \(MomentCalendar.leadFlavons) Flavons before: \(words.countdown(prompt - t, at: t))")
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

    /// "3 captures: 1λ before, at the moment, 1λ after".
    static func capturesLine(_ count: Int) -> String {
        guard count > 1 else { return "1 capture, at the exact moment" }
        let k = count / 2
        return "\(count) captures, a Flavon apart: from \(k)λ before to \(k)λ after"
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
        case .rare: "Helion node"
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
                            Text(verbatim: m.title(words.notation))
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
            Text("Turn them on to be called 11 Flavons before each moment and capture it with both cameras and your voice.")
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

private struct PermissionCard: View {
    let authorization: MomentAuthorization
    let ask: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Notifications are off", systemImage: "bell.slash")
                .font(.headline)
                .foregroundStyle(Theme.ink)
            Text(authorization == .denied
                 ? "Moments open by themselves while the app is in front. To be called when it is not, allow notifications for Fractonica in Settings."
                 : "Allow notifications to be called 11 Flavons before each moment, with a spoken announcement.")
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

/// Moments' settings: on or off, which Helion moments are announced (Delta and longer always are), how many times a
/// moment is captured, quiet hours, the spoken announcement and whether the instant view opens by itself.
struct MomentSettingsView: View {
    @Environment(AppSettings.self) private var settings
    @State private var moments = MomentStore.shared

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
                Text("A rare moment is a Helion's node, its mid point (Preon 18). The start, peak, node and valley of a Delta, Gamma, Beta or Alpha are always announced: they are rarer still.")
            }
            Section {
                Picker("Captures per moment", selection: $moments.settings.captures) {
                    ForEach(MomentCaptures.choices, id: \.self) { n in
                        Text(verbatim: n == 1 ? "1" : "\(n)").tag(n)
                    }
                }
                .disabled(!moments.settings.enabled)
            } footer: {
                Text(capturesFooter)
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
                Text("Moments in quiet hours are not announced and do not break your streak.")
            }
            Section {
                Toggle("Spoken announcement", isOn: $moments.settings.voice)
                Toggle("Open by itself", isOn: $moments.settings.autoOpen)
                if let m = moments.nextMoment() {
                    Button("Play an Announcement", systemImage: "speaker.wave.2") {
                        Task { await MomentVoice.play(m) }
                    }
                }
            } footer: {
                Text("While Fractonica is in front, the instant view opens by itself 11 Flavons before a moment; otherwise a notification calls you. The announcement follows the silent switch.")
            }
            Section("Notifications") {
                LabeledContent("Permission", value: permission)
                LabeledContent("Moments queued", value: "\(moments.pendingCount)")
                if moments.authorization == .notDetermined {
                    Button("Allow Notifications") { Task { await moments.requestAuthorization() } }
                }
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
    }

    private var capturesFooter: String {
        switch moments.settings.captures {
        case 1: "One capture, at the exact moment: the front and back cameras at once."
        case 5: "Five captures a Flavon apart: two before the moment, at it, and two after. Each takes the front and back cameras at once; the call still comes 11 Flavons before the moment."
        default: "Three captures a Flavon apart: one Flavon before the moment, at it, and one Flavon after. Each takes the front and back cameras at once; the call still comes 11 Flavons before the moment."
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
