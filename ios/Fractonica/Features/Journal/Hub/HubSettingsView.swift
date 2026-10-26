import SwiftUI

/// The hub page: pair this device with a Fractonica Hub (an address typed or found on the network, and a code from
/// the hub's web page), then see how sync is going and choose what media moves. The journal works without a hub;
/// pairing uploads everything already written here, and a new device pairing loads everything from the hub.
///
/// Standalone: push it from the journal's settings (`NavigationLink { HubSettingsView() }`) or present it in a
/// navigation stack. `HubSettingsView(engine:)` takes another engine for previews.
struct HubSettingsView: View {
    @State private var model: HubPairingModel
    @State private var discovery = HubDiscovery()
    @State private var confirmUnpair = false
    @State private var repairing = false
    @Environment(\.colorScheme) private var colorScheme

    private var engine: SyncEngine { model.engine }

    init(engine: SyncEngine = .shared) {
        _model = State(initialValue: HubPairingModel(engine: engine))
    }

    var body: some View {
        Form {
            HubHero(engine: engine, pairing: model.pairing)
            if engine.isPaired && !(engine.status == .revoked && repairing) {
                pairedSections
            } else {
                pairingSections
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(colorScheme == .dark ? .hidden : .automatic)
        .background { if colorScheme == .dark { Backdrop() } }
        .navigationTitle("Hub")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .animation(.smooth, value: engine.isPaired)
        .onAppear {
            if !engine.isPaired { discovery.start() }
        }
        .onDisappear { discovery.stop() }
        .onChange(of: engine.isPaired) { _, paired in
            if paired { discovery.stop() } else { discovery.start() }
        }
        .confirmationDialog("Unpair from \(engine.credentials?.hubName ?? "the hub")?", isPresented: $confirmUnpair,
                            titleVisibility: .visible) {
            Button("Unpair", role: .destructive) {
                let address = engine.credentials.map { HubAddress.display($0.hubURL) } ?? ""
                engine.unpair()
                repairing = false
                model = HubPairingModel(engine: engine, address: address)
            }
        } message: {
            Text("Your entries stay on this device. Pair again with a new code from the hub to sync.")
        }
    }

    // MARK: Paired

    @ViewBuilder
    private var pairedSections: some View {
        Section {
            LabeledContent("Waiting to upload") {
                Text(verbatim: "\(engine.pendingCount)").monospacedDigit()
            }
            if let count = engine.hubEntryCount {
                LabeledContent("Entries on the hub") { Text(verbatim: "\(count)").monospacedDigit() }
            }
            if let total = engine.hubRecordCount, let entries = engine.hubEntryCount, total > entries {
                LabeledContent("Other records") { Text(verbatim: "\(total - entries)").monospacedDigit() }
            }
            LabeledContent("Semantic search") {
                Text(searchState).foregroundStyle(.secondary)
            }
            if engine.mediaRemaining > 0 {
                LabeledContent("Media to download") { Text(verbatim: "\(engine.mediaRemaining)").monospacedDigit() }
            }
        } header: {
            Text("Sync")
        } footer: {
            if let problem = engine.problem {
                Label(problem, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
            }
        }

        Section {
            Button {
                Task { await engine.syncNow() }
            } label: {
                HStack {
                    Spacer()
                    if engine.isSyncing {
                        ProgressView().controlSize(.small)
                        Text("Syncing…")
                    } else {
                        Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                    }
                    Spacer()
                }
                .frame(minHeight: 30)
            }
            .glassProminentButtonStyle()
            .disabled(engine.isSyncing)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        }

        Section {
            Toggle(isOn: Bindable(engine).downloadAllMedia) {
                HubRowLabel("Download all media", detail: "Videos too, in the background", systemImage: "square.and.arrow.down.on.square")
            }
            #if os(iOS)
            Toggle(isOn: Bindable(engine).uploadMediaOnCellular) {
                HubRowLabel("Upload media on cellular", detail: "Off: photos and videos wait for Wi-Fi", systemImage: "antenna.radiowaves.left.and.right")
            }
            #endif
        } header: {
            Text("Media")
        } footer: {
            Text("Photos, voice notes and video posters from other devices download by themselves; videos when you open them.")
        }

        Section {
            if let credentials = engine.credentials {
                LabeledContent("This device", value: credentials.clientName)
                LabeledContent("Hub") {
                    Text(verbatim: HubAddress.display(credentials.hubURL)).textSelection(.enabled)
                }
                if let version = engine.hubInfo?.hub.version {
                    LabeledContent("Version") { Text(verbatim: version) }
                }
                LabeledContent("Paired") {
                    Text(Date(timeIntervalSince1970: credentials.paired), format: .dateTime.day().month().year())
                }
            }
            if engine.status == .revoked {
                Button("Pair again…") {
                    model = HubPairingModel(engine: engine, address: engine.credentials.map { HubAddress.display($0.hubURL) } ?? "")
                    repairing = true
                    Task { await model.checkAddress() }
                }
            }
            Button("Unpair", role: .destructive) { confirmUnpair = true }
        } header: {
            Text("Pairing")
        } footer: {
            Text("Unpairing keeps every entry on this device.")
        }
    }

    private var searchState: String {
        if engine.hubInfo?.workerConnected == false { return "Hub’s search worker is offline" }
        if engine.vectorRecordCount == 0 { return "No vectors yet" }
        return "Ready · \(engine.vectorRecordCount) \(engine.vectorRecordCount == 1 ? "record" : "records")"
    }

    // MARK: Pairing

    @ViewBuilder
    private var pairingSections: some View {
        Section {
            TextField("Address", text: $model.address, prompt: Text(verbatim: "192.168.1.20:8787"))
                .font(.body.monospaced())
                .autocorrectionDisabled()
                #if os(iOS)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .textContentType(.URL)
                #endif
                .submitLabel(.next)
            AddressCheckRow(check: model.check)
        } header: {
            Text("Hub address")
        } footer: {
            Text("Where the hub runs: its address on your network, or localhost on this Mac.")
        }
        .task(id: model.address) {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled else { return }
            await model.checkAddress()
        }

        if !discovery.hubs.isEmpty || discovery.isBrowsing {
            Section {
                if discovery.hubs.isEmpty {
                    HStack(spacing: 10) {
                        ProgressView().controlSize(.small)
                        Text("Looking for hubs…").foregroundStyle(.secondary)
                    }
                }
                ForEach(discovery.hubs) { hub in
                    Button {
                        if let address = hub.address { model.address = address }
                    } label: {
                        HStack {
                            Image(systemName: "server.rack").foregroundStyle(Theme.teal)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hub.name).foregroundStyle(.primary)
                                Text(verbatim: hub.address ?? "Resolving…").font(.caption.monospaced()).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let address = hub.address, model.address == address {
                                Image(systemName: "checkmark").foregroundStyle(Theme.teal)
                            }
                        }
                    }
                    .disabled(hub.address == nil)
                }
            } header: {
                Text("On this network")
            }
        }

        Section {
            TextField("Code", text: Binding(get: { model.code }, set: { model.setCode($0) }), prompt: Text(verbatim: "XXXX-XXXX"))
                .font(.title2.monospaced().weight(.medium))
                .multilineTextAlignment(.center)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.characters)
                #endif
                .accessibilityLabel("Pairing code")
            TextField("Device name", text: $model.name)
                #if os(iOS)
                .textContentType(.name)
                #endif
        } header: {
            Text("Pairing code")
        } footer: {
            Text("Make a code in the hub’s web page under Devices, or scan its QR code with the Camera.")
        }

        Section {
            Button {
                Task { await model.pair() }
            } label: {
                HStack {
                    Spacer()
                    if case .pairing = model.pairing {
                        ProgressView().controlSize(.small)
                        Text("Pairing…")
                    } else {
                        Label("Pair", systemImage: "link")
                    }
                    Spacer()
                }
                .frame(minHeight: 30)
            }
            .glassProminentButtonStyle()
            .disabled(!model.canPair)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
            if case .failed(let message) = model.pairing {
                Label(message, systemImage: "xmark.octagon").foregroundStyle(Theme.danger)
                    .listRowBackground(Color.clear)
            }
        }
    }
}

// MARK: - Parts

/// The page's head: what a hub is (unpaired), or which hub and how sync is going.
private struct HubHero: View {
    let engine: SyncEngine
    let pairing: HubPairingModel.Pairing

    var body: some View {
        Section {
            VStack(spacing: 14) {
                ZStack {
                    Circle().fill(tint.opacity(0.18))
                    Image(systemName: symbol)
                        .font(.system(size: 30, weight: .medium))
                        .foregroundStyle(tint)
                        .contentTransition(.symbolEffect(.replace))
                }
                .frame(width: 72, height: 72)
                .glassSurface(.regular.tint(tint.opacity(0.12)), in: Circle())

                VStack(spacing: 4) {
                    Text(title).font(.title2.weight(.semibold)).multilineTextAlignment(.center)
                    if let credentials = engine.credentials {
                        Text(verbatim: HubAddress.display(credentials.hubURL))
                            .font(.subheadline.monospaced()).foregroundStyle(.secondary)
                    } else {
                        Text("Sync your journal across your devices through a hub you run. Everything also stays on this device; the journal works without one.")
                            .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    }
                }

                if engine.isPaired {
                    StatusPill(engine: engine, tint: tint, symbol: statusSymbol)
                }
                if case .paired(let message) = pairing {
                    Label(message, systemImage: "checkmark.circle.fill")
                        .font(.callout.weight(.medium))
                        .foregroundStyle(Theme.teal)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
        }
    }

    private var title: String {
        engine.credentials?.hubName ?? "Fractonica Hub"
    }

    private var symbol: String {
        switch engine.status {
        case .unpaired: "server.rack"
        case .revoked: "xmark.shield"
        case .offline: "wifi.slash"
        case .error: "exclamationmark.triangle"
        default: "server.rack"
        }
    }

    private var statusSymbol: String {
        switch engine.status {
        case .unpaired: "circle.dashed"
        case .idle: engine.pendingCount > 0 ? "arrow.up.circle" : "checkmark.circle.fill"
        case .syncing: "arrow.triangle.2.circlepath"
        case .offline: "wifi.slash"
        case .revoked: "xmark.octagon.fill"
        case .error: "exclamationmark.triangle.fill"
        }
    }

    private var tint: Color {
        switch engine.status {
        case .revoked: Theme.danger
        case .error, .offline: .orange
        default: Theme.teal
        }
    }
}

/// "Up to date · synced 2 minutes ago", the progress of a pass under way.
private struct StatusPill: View {
    let engine: SyncEngine
    let tint: Color
    let symbol: String

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: symbol)
                    .foregroundStyle(tint)
                    .symbolEffect(.rotate, isActive: engine.isSyncing)
                Text(engine.statusText).font(.callout.weight(.medium)).lineLimit(2)
            }
            if case .syncing(let progress) = engine.status, let fraction = progress.fraction {
                ProgressView(value: fraction).tint(tint).frame(maxWidth: 220)
            }
            if let lastSync = engine.lastSync {
                TimelineView(.periodic(from: .now, by: 30)) { _ in
                    Text("Synced \(lastSync, format: .relative(presentation: .named))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
        .glassSurface(.regular.tint(tint.opacity(0.08)), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .animation(.smooth, value: engine.statusText)
    }
}

/// What `GET /v1` found at the typed address.
private struct AddressCheckRow: View {
    let check: HubPairingModel.AddressCheck

    var body: some View {
        switch check {
        case .empty:
            EmptyView()
        case .invalid:
            Label("Not an address", systemImage: "questionmark.circle").foregroundStyle(.secondary)
        case .checking:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("Checking…").foregroundStyle(.secondary)
            }
        case .found(_, let info):
            VStack(alignment: .leading, spacing: 2) {
                Label {
                    Text(verbatim: [info.hub.name, info.hub.version].compactMap(\.self).joined(separator: " · "))
                } icon: {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.teal)
                }
                Text(info.workerConnected ? "Semantic search ready" : "Search worker offline: keyword search until it connects")
                    .font(.caption).foregroundStyle(.secondary)
                    .padding(.leading, 30)
            }
        case .unreachable(let message):
            Label(message, systemImage: "xmark.circle").foregroundStyle(.orange)
        }
    }
}

/// A row's title with a detail line and an icon.
private struct HubRowLabel: View {
    let title: String
    let detail: String
    let systemImage: String

    init(_ title: String, detail: String, systemImage: String) {
        self.title = title
        self.detail = detail
        self.systemImage = systemImage
    }

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: systemImage).foregroundStyle(Theme.teal)
        }
    }
}

#Preview("Unpaired") {
    NavigationStack {
        HubSettingsView(engine: SyncEngine(secrets: MemorySecretStore(), defaults: UserDefaults(suiteName: "preview.hub")!, directory: nil))
    }
    .preferredColorScheme(.dark)
}
