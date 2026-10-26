import FractonicaKit
import SwiftUI

/// Settings › Journal: how voice notes, photos and videos are kept (with what a minute of voice costs), what the
/// journal takes on this device, and — once the sync layer exists — the way to the hub.
struct JournalSettingsScreen: View {
    @Environment(AppSettings.self) private var settings
    @State private var prefs = JournalPreferences.shared
    @State private var store = JournalStore.shared
    @State private var sync = SyncEngine.shared
    @State private var usage: (records: Int64, media: Int64)?

    var body: some View {
        Form {
            Section {
                Picker(selection: $prefs.audioQuality) {
                    ForEach(AudioQuality.allCases) { quality in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(quality.title)
                            Text(verbatim: "\(quality.detail) · \(perMinute(quality))")
                                .font(.caption)
                                .foregroundStyle(Theme.ink3)
                        }
                        .tag(quality)
                    }
                } label: {
                    Text("Voice notes")
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("Voice notes")
            } footer: {
                Text("Applies to new recordings. Standard keeps speech clear at about half a megabyte a minute.")
            }

            Section {
                Picker("Photos", selection: $prefs.photoQuality) {
                    ForEach(PhotoQuality.allCases) { quality in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(quality.title)
                            Text(quality.detail).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .tag(quality)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("Photos")
            }

            Section {
                Picker("Videos", selection: $prefs.videoQuality) {
                    ForEach(VideoQuality.allCases) { quality in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(quality.title)
                            Text(quality.detail).font(.caption).foregroundStyle(Theme.ink3)
                        }
                        .tag(quality)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            } header: {
                Text("Videos")
            } footer: {
                Text("Converted videos keep a still for the timeline. Photos and videos you add later follow these choices; what is already in the journal stays as it is.")
            }

            Section("Timeline") {
                Toggle(isOn: $prefs.showsOtherKinds) {
                    Label("Records from other sources", systemImage: "tray.full")
                }
            }

            Section {
                LabeledContent("Entries") { Text(verbatim: "\(store.entries.count)") }
                LabeledContent("Text and records") { Text(verbatim: usage.map { byteCount($0.records) } ?? "…") }
                LabeledContent("Photos, videos and voice") { Text(verbatim: usage.map { byteCount($0.media) } ?? "…") }
            } header: {
                Text("On this device")
            } footer: {
                Text(sync.isPaired ? "Entries also sync with your hub." : "Everything stays on this device.")
            }

            Section {
                NavigationLink {
                    HubSettingsView()
                } label: {
                    LabeledContent {
                        Text(sync.isPaired ? sync.statusText : "Not paired")
                    } label: {
                        Label("Hub", systemImage: "point.3.connected.trianglepath.dotted")
                    }
                }
            } footer: {
                Text("Pair with your Fractonica Hub to back up the journal, share it between devices and search it by meaning.")
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background { Backdrop() }
        .navigationTitle("Journal")
        .task(id: store.revision) { usage = await store.usage() }
    }

    /// "≈ 0.5 MB a minute" · pure "≈ 3.8 MB a Preon" (a Preon is about 8.4 minutes).
    private func perMinute(_ quality: AudioQuality) -> String {
        if settings.pure, let preon = Notation.unit("iota") {
            let seconds = settings.wording.notation.unitSeconds(preon)
            return "≈ \(Self.megabytes(quality.bytesPerMinute * seconds / 60)) a Preon"
        }
        return "≈ \(Self.megabytes(quality.bytesPerMinute)) a minute"
    }

    private static func megabytes(_ bytes: Double) -> String {
        let mb = bytes / 1_000_000
        return mb < 10 ? String(format: "%.2g MB", mb) : String(format: "%.0f MB", mb)
    }
}
