import FractonicaKit
import SwiftUI

/// Settings: the vocabulary (pure mode, time zone), the clock face, the cycles the screens show, feedback, and the
/// glossary. A sheet on iOS, the Settings window on macOS.
struct SettingsScreen: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        @Bindable var settings = settings
        let words = settings.wording
        Form {
            Section {
                Toggle(isOn: $settings.pure) {
                    SettingLabel("Pure mode", detail: "Fractonica terms only: no Gregorian dates, Earth units or percentages", systemImage: "character.book.closed")
                }
                NavigationLink {
                    TimeZonePicker()
                } label: {
                    LabeledContent {
                        Text(zoneName)
                    } label: {
                        SettingLabel("Time zone", detail: settings.pure ? "Used again when pure mode is off" : nil, systemImage: "globe")
                    }
                }
            } header: {
                Text("Reading")
            }

            Section("Clock face") {
                Picker("Face", selection: $settings.faceMode) {
                    Text("Journal").tag(AppSettings.FaceMode.journal)
                    Text("Watch").tag(AppSettings.FaceMode.watch)
                }
                .pickerStyle(.segmented)
                switch settings.faceMode {
                case .journal:
                    Picker("Reads", selection: $settings.journalUnit) {
                        ForEach(AppSettings.journalUnits, id: \.self) { unit in
                            Text(journalUnitLabel(unit)).tag(unit)
                        }
                    }
                case .watch:
                    Stepper(value: $settings.topDepth, in: AppSettings.topDepths) {
                        LabeledContent("Periods", value: "\(words.levelChip(settings.topDepth - 1)) over \(words.levelChip(settings.topDepth))")
                    }
                    Toggle("Period letters", isOn: $settings.showLetters)
                }
            }

            Section {
                Picker("Selected cycle", selection: $settings.selectedLevel) {
                    ForEach(AppSettings.levels, id: \.self) { level in
                        Text(words.levelLabel(level)).tag(level)
                    }
                }
                Stepper(value: $settings.minDepth, in: AppSettings.depths.lowerBound...settings.maxDepth) {
                    LabeledContent("Longest shown", value: words.levelChip(settings.minDepth - 1))
                }
                Stepper(value: $settings.maxDepth, in: settings.minDepth...AppSettings.depths.upperBound) {
                    LabeledContent("Shortest shown", value: words.levelChip(settings.maxDepth - 1))
                }
            } header: {
                Text("Cycles")
            } footer: {
                Text("The selected cycle is highlighted on every screen and stepped by ◀︎ ▶︎. Rings, ladder and timeline show the depths from the longest to the shortest.")
            }

            Section("Feedback") {
                Toggle(isOn: $settings.haptics) {
                    SettingLabel("Haptics", detail: "On steps, turnovers and alerts", systemImage: "hand.tap")
                }
            }

            Section {
                NavigationLink {
                    GlossaryScreen()
                } label: {
                    SettingLabel("Glossary", detail: "The units and how to read them", systemImage: "book")
                }
            }

            Section {
                LabeledContent("Catalogue", value: catalogueText(words))
                LabeledContent("Version", value: version)
            } footer: {
                Text("Times run on the device clock; nothing is shown outside the catalogue.")
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle(Screen.settings.title)
    }

    private var zoneName: String {
        guard let zone = settings.zone else { return "System" }
        return TimeZoneName(identifier: zone).city
    }

    /// "Delta" for a major period, shown alone; "η ι λ · Helion, Preon, Flavon" for the three minor units the journal
    /// face reads from `unit` on.
    private func journalUnitLabel(_ unit: Int) -> String {
        let shown = Journal.units.dropFirst(unit).prefix(Journal.units[unit].level <= 3 ? 1 : 3).compactMap { Notation.unit(level: $0.level) }
        guard shown.count > 1 else { return shown.first?.name ?? "" }
        return "\(shown.map(\.sym).joined(separator: " ")) · \(shown.map(\.name).joined(separator: ", "))"
    }

    private func catalogueText(_ words: Wording) -> String {
        if words.pure { return words.notation.catalogueText() }
        let utc = EarthFormatter(timeZone: .gmt)
        let clock = FractonicaClock.shared
        return "Saros 141 · \(utc.parts(clock.tMin).year)–\(utc.parts(clock.tMax).year)"
    }

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }
}

/// A setting's title with an optional explanation under it and its symbol.
private struct SettingLabel: View {
    let title: String
    let detail: String?
    let systemImage: String

    init(_ title: String, detail: String?, systemImage: String) {
        self.title = title
        self.detail = detail
        self.systemImage = systemImage
    }

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(Theme.ink3)
                }
            }
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(Theme.teal)
        }
    }
}
