import SwiftUI

/// The confirmation a pairing link asks for (`fractonica://pair?hub=…&code=…`, from the QR code the hub's web page
/// shows, scanned with the Camera): "Pair with Fractonica Hub at 192.168.1.20?", then pairing on Pair.
struct HubPairSheet: View {
    @State private var model: HubPairingModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    init(pairing: AppLink.Pairing, engine: SyncEngine = .shared) {
        _model = State(initialValue: HubPairingModel(engine: engine, address: pairing.hub, code: pairing.code))
    }

    private var engine: SyncEngine { model.engine }
    private var host: String { model.url.map(HubAddress.host) ?? model.address }

    var body: some View {
        VStack(spacing: 22) {
            ZStack {
                Circle().fill(Theme.teal.opacity(0.18))
                Image(systemName: isPaired ? "checkmark" : "server.rack")
                    .font(.system(size: 34, weight: .medium))
                    .foregroundStyle(Theme.teal)
                    .contentTransition(.symbolEffect(.replace))
            }
            .frame(width: 84, height: 84)
            .glassSurface(.regular.tint(Theme.teal.opacity(0.12)), in: Circle())
            .padding(.top, 8)

            VStack(spacing: 8) {
                Text(isPaired ? "Paired" : "Pair with Fractonica Hub at \(host)?")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                details
            }

            if !isPaired {
                VStack(alignment: .leading, spacing: 6) {
                    Text("This device’s name").font(.caption).foregroundStyle(.secondary)
                    TextField("Device name", text: $model.name)
                        .textFieldStyle(.plain)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .glassSurface(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                if let other = otherHub {
                    Label("This replaces the pairing with \(other).", systemImage: "arrow.left.arrow.right")
                        .font(.footnote).foregroundStyle(.orange)
                }
            }

            Spacer(minLength: 0)

            GlassContainer(spacing: 12) {
                if isPaired {
                    Button {
                        dismiss()
                    } label: {
                        Text("Done").frame(maxWidth: .infinity).frame(minHeight: 34)
                    }
                    .glassProminentButtonStyle()
                } else {
                    HStack(spacing: 12) {
                        Button {
                            dismiss()
                        } label: {
                            Text("Cancel").frame(maxWidth: .infinity).frame(minHeight: 34)
                        }
                        .glassButtonStyle()
                        Button {
                            Task { await model.pair() }
                        } label: {
                            HStack {
                                if case .pairing = model.pairing { ProgressView().controlSize(.small) }
                                Text(isPairing ? "Pairing…" : "Pair")
                            }
                            .frame(maxWidth: .infinity).frame(minHeight: 34)
                        }
                        .glassProminentButtonStyle()
                        .disabled(!model.canPair)
                        .keyboardShortcut(.defaultAction)
                    }
                }
            }
            .controlSize(.large)
        }
        .padding(24)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { if colorScheme == .dark { Backdrop() } }
        .animation(.smooth, value: isPaired)
        .task { await model.checkAddress() }
        #if os(macOS)
        .frame(width: 440, height: 460)
        #endif
    }

    @ViewBuilder
    private var details: some View {
        switch model.pairing {
        case .paired(let message):
            Text(message).font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
        case .failed(let message):
            Label(message, systemImage: "xmark.octagon").font(.callout).foregroundStyle(Theme.danger)
        default:
            switch model.check {
            case .checking, .empty:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Checking the hub…").foregroundStyle(.secondary)
                }
            case .found(_, let info):
                Text(verbatim: [info.hub.name, info.hub.version, info.workerConnected ? "semantic search ready" : nil]
                    .compactMap(\.self).joined(separator: " · "))
                    .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
            case .unreachable(let message):
                Label(message, systemImage: "wifi.exclamationmark").font(.callout).foregroundStyle(.orange)
            case .invalid:
                Label("The link has no valid hub address", systemImage: "questionmark.circle").foregroundStyle(.orange)
            }
            Text(verbatim: "Code \(model.code)").font(.footnote.monospaced()).foregroundStyle(.tertiary)
        }
    }

    private var isPaired: Bool { if case .paired = model.pairing { true } else { false } }
    private var isPairing: Bool { if case .pairing = model.pairing { true } else { false } }

    /// The hub this device is paired with now, when the link names another.
    private var otherHub: String? {
        guard let credentials = engine.credentials, let url = model.url,
              HubAddress.normalize(credentials.hubURL.absoluteString) != url else { return nil }
        return credentials.hubName
    }
}

/// The hub's sheets over the app: the pairing link's confirmation, and the hub page (`-FXHubSettings 1`, until the
/// journal's settings link to it). Applied by the root view on iOS and macOS.
struct HubPresentations: ViewModifier {
    @Environment(AppRouter.self) private var router

    /// `-FXHubScheme light|dark`: the sheets in that appearance, for screenshots.
    private static let scheme: ColorScheme? = {
        switch UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)["FXHubScheme"] as? String {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }()

    func body(content: Content) -> some View {
        @Bindable var router = router
        content
            .sheet(item: $router.hubPairing) { pairing in
                HubPairSheet(pairing: pairing)
                    .preferredColorScheme(Self.scheme ?? .dark)
                    .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $router.isHubSettingsPresented) {
                NavigationStack {
                    HubSettingsView()
                        .toolbar {
                            ToolbarItem(placement: .confirmationAction) {
                                Button("Done") { router.isHubSettingsPresented = false }
                            }
                        }
                }
                .preferredColorScheme(Self.scheme ?? .dark)
                #if os(macOS)
                .frame(width: 520, height: 680)
                #endif
            }
    }
}
