import Foundation
import Network
import Observation
import Synchronization

/// Hubs on the local network: Bonjour services of type `_fractonica-hub._tcp` (the hub advertises itself), each
/// resolved to an IPv4 address and port the app can reach over plain HTTP.
///
///     @State private var discovery = HubDiscovery()
///     … .onAppear { discovery.start() } .onDisappear { discovery.stop() }
///     ForEach(discovery.hubs) { hub in Button(hub.name) { address = hub.address ?? "" } }
@MainActor @Observable
final class HubDiscovery {
    static let serviceType = "_fractonica-hub._tcp"

    struct Hub: Identifiable, Hashable, Sendable {
        /// The Bonjour service name ("Fractonica Hub").
        var name: String
        /// "192.168.1.20:8787" once resolved.
        var address: String?
        /// From the TXT record, when the hub puts them there.
        var hubId: String?
        var version: String?

        var id: String { name }
    }

    private(set) var hubs: [Hub] = []
    private(set) var isBrowsing = false
    /// Why browsing stopped (Local Network access denied …), for a footnote.
    private(set) var failure: String?

    @ObservationIgnored private var browser: NWBrowser?
    @ObservationIgnored private var resolving: Set<String> = []

    func start() {
        guard browser == nil else { return }
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = false
        let browser = NWBrowser(for: .bonjourWithTXTRecord(type: Self.serviceType, domain: nil), using: parameters)
        browser.stateUpdateHandler = { [weak self] state in
            let failure: String? = switch state {
            case .failed(let error), .waiting(let error): error.localizedDescription
            default: nil
            }
            let running = if case .ready = state { true } else { false }
            Task { @MainActor in
                self?.failure = failure
                self?.isBrowsing = running
            }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            let found = results.compactMap { result -> (String, NWEndpoint, [String: String])? in
                guard case .service(let name, _, _, _) = result.endpoint else { return nil }
                var txt: [String: String] = [:]
                if case .bonjour(let record) = result.metadata { txt = record.dictionary }
                return (name, result.endpoint, txt)
            }
            Task { @MainActor in self?.update(found) }
        }
        browser.start(queue: .main)
        self.browser = browser
    }

    func stop() {
        browser?.cancel()
        browser = nil
        isBrowsing = false
    }

    private func update(_ found: [(String, NWEndpoint, [String: String])]) {
        let names = Set(found.map(\.0))
        hubs.removeAll { !names.contains($0.name) }
        for (name, endpoint, txt) in found {
            if let index = hubs.firstIndex(where: { $0.name == name }) {
                hubs[index].hubId = txt["id"] ?? hubs[index].hubId
                hubs[index].version = txt["version"] ?? hubs[index].version
            } else {
                hubs.append(Hub(name: name, address: nil, hubId: txt["id"], version: txt["version"]))
            }
            if hubs.first(where: { $0.name == name })?.address == nil, !resolving.contains(name) {
                resolving.insert(name)
                Task {
                    let address = await Self.resolve(endpoint)
                    resolving.remove(name)
                    if let index = hubs.firstIndex(where: { $0.name == name }) { hubs[index].address = address }
                }
            }
        }
        hubs.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /// The service's IPv4 address and port, by connecting to it and reading the path's remote end (Network has no
    /// resolve call of its own); nil after 5 s without an answer.
    nonisolated static func resolve(_ endpoint: NWEndpoint) async -> String? {
        let parameters = NWParameters.tcp
        if let ip = parameters.defaultProtocolStack.internetProtocol as? NWProtocolIP.Options { ip.version = .v4 }
        let connection = NWConnection(to: endpoint, using: parameters)
        let finished = Mutex(false)
        return await withCheckedContinuation { (continuation: CheckedContinuation<String?, Never>) in
            @Sendable func finish(_ address: String?) {
                let first = finished.withLock { done in
                    defer { done = true }
                    return !done
                }
                guard first else { return }
                connection.cancel()
                continuation.resume(returning: address)
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    if case .hostPort(let host, let port) = connection.currentPath?.remoteEndpoint {
                        finish("\(hostString(host)):\(port.rawValue)")
                    } else {
                        finish(nil)
                    }
                case .failed, .cancelled:
                    finish(nil)
                default:
                    break
                }
            }
            connection.start(queue: .global(qos: .userInitiated))
            DispatchQueue.global().asyncAfter(deadline: .now() + 5) { finish(nil) }
        }
    }

    private nonisolated static func hostString(_ host: NWEndpoint.Host) -> String {
        switch host {
        // The dotted quad without the interface scope ("%en0") the description adds.
        case .ipv4(let address): address.rawValue.map { String($0) }.joined(separator: ".")
        case .ipv6(let address): "[\(address)]"
        case .name(let name, _): name
        @unknown default: "\(host)"
        }
    }
}
