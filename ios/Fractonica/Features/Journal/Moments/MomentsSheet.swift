import FractonicaKit
import SwiftUI

/// The Moments sheet, from the Journal's flame chip: the streak, the next moment with its countdown (and the way in
/// while its 11 Flavons run), the collection by rarity, when each rarer kind comes next, and the settings.
struct MomentsSheet: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var moments = MomentStore.shared
    @State private var path: [MomentsRoute] = []

    var body: some View {
        let words = settings.wording
        NavigationStack(path: $path) {
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
                    NextMomentCard(words: words)
                    section("Collection") { CollectionGrid(stats: moments.stats) }
                    section("Rarer moments ahead") { RareAhead(words: words) }
                    NavigationLink(value: MomentsRoute.settings) {
                        HStack {
                            Label("Moment Settings", systemImage: "gearshape")
                                .foregroundStyle(Theme.ink)
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink3)
                        }
                        .padding(14)
                        .background(Theme.panel, in: .rect(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .scrollContentBackground(.hidden)
            .background { Backdrop() }
            .navigationTitle("Moments")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .navigationDestination(for: MomentsRoute.self) { _ in MomentSettingsView() }
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", systemImage: "checkmark") { dismiss() }
                }
            }
        }
        .sheetDetents([.large])
        #if os(macOS)
        .frame(minWidth: 480, idealWidth: 520, minHeight: 640, idealHeight: 720)
        #endif
        .onAppear {
            if moments.launch.settings, path.isEmpty { path = [.settings] }
            if moments.authorization == .notDetermined, moments.settings.enabled, !moments.launch.isPreview {
                Task { await moments.requestAuthorization() }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Theme.ink3)
                .textCase(.uppercase)
            content()
        }
    }
}

enum MomentsRoute: Hashable { case settings }

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

/// The next announced moment: its name and rarity, the countdown, and while its 11 Flavons run, the way in.
private struct NextMomentCard: View {
    let words: Wording
    @State private var moments = MomentStore.shared

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let t = context.date.timeIntervalSince1970
            if let m = moments.nextMoment(after: t) {
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
                    Text(verbatim: m.title(words.notation))
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Theme.levelColor(m.level.kitLevel, lightness: 0.7))
                    Text(verbatim: words.countdown(m.time - t, at: t))
                        .font(.reading(17, weight: .medium))
                        .foregroundStyle(Theme.ink2)
                    if !words.pure {
                        Text(verbatim: words.label(m.time, relativeTo: t))
                            .font(.footnote)
                            .foregroundStyle(Theme.ink3)
                    }
                    if prompt <= t {
                        Button {
                            moments.isSheetPresented = false
                            Task {
                                try? await Task.sleep(for: .milliseconds(450))
                                moments.openInstant(m)
                            }
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
}

/// How many entries of each rarity the journal holds, each in its frame.
private struct CollectionGrid: View {
    let stats: MomentStats

    private let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: 10) {
            ForEach(MomentRarity.allCases, id: \.self) { rarity in
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
                .rarityFrame(rarity, cornerRadius: 16)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

extension MomentRarity {
    /// What makes an entry this rare.
    var source: String {
        switch self {
        case .common: "any time"
        case .rare: "Helion, Nuclide"
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
    @State private var moments = MomentStore.shared

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let t = context.date.timeIntervalSince1970
            VStack(spacing: 0) {
                ForEach([MomentLevel.delta, .gamma, .beta, .alpha], id: \.self) { level in
                    if let m = moments.calendar.next(atLeast: level, after: t) {
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

/// Moments' settings: on or off, which Helion moments are announced (Delta and longer always are), quiet hours, the
/// spoken announcement and whether the instant view opens by itself.
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
                Text("A moment is every Helion quarter: its start, peak, node and valley (Preon 0, 9, 18 and 27). Every boundary of a Delta, Gamma, Beta or Alpha falls on one, and those are always announced: they are the rare ones.")
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
