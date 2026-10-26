import Foundation
import Observation

/// The pairing form's state, shared by the hub settings page and the pairing link's sheet: the address as typed and
/// what `GET /v1` found there, the code, the device's name, and the pairing under way.
@MainActor @Observable
final class HubPairingModel {
    enum AddressCheck: Equatable {
        case empty
        case invalid
        case checking
        case found(URL, HubInfo)
        case unreachable(String)
    }

    enum Pairing: Equatable {
        case idle
        case pairing
        /// "Paired as iPhone 17 Pro · uploading 42 entries".
        case paired(String)
        case failed(String)
    }

    var address = ""
    /// As typed; `formattedCode` puts it right.
    var code = ""
    var name: String
    private(set) var check: AddressCheck = .empty
    private(set) var pairing: Pairing = .idle

    let engine: SyncEngine

    init(engine: SyncEngine, address: String = "", code: String = "") {
        self.engine = engine
        self.address = address
        self.code = HubPairingCode.formatted(code)
        name = HubDevice.defaultName
    }

    var url: URL? { HubAddress.normalize(address) }

    var canPair: Bool {
        guard url != nil, HubPairingCode.isComplete(code), !name.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        if case .pairing = pairing { return false }
        if case .unreachable = check { return false }
        return true
    }

    /// The code field's setter: uppercase, the dash after four characters, nothing outside the alphabet.
    func setCode(_ text: String) {
        code = HubPairingCode.formatted(text)
        if case .failed = pairing { pairing = .idle }
    }

    /// `GET /v1` at the address (call after the typing settles).
    func checkAddress() async {
        let text = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            check = .empty
            return
        }
        guard HubAddress.normalize(text) != nil else {
            check = .invalid
            return
        }
        check = .checking
        do {
            let (url, info) = try await engine.checkAddress(text)
            guard text == address.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            check = .found(url, info)
        } catch {
            guard !Task.isCancelled, text == address.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            let error = HubError.from(error)
            if case .cancelled = error { return }
            check = .unreachable(Self.message(for: error, url: HubAddress.normalize(text)))
        }
    }

    /// Pairs, and says how it went.
    func pair() async {
        guard let url, canPair else { return }
        pairing = .pairing
        do {
            let response = try await engine.pair(url: url, code: code, name: name.trimmingCharacters(in: .whitespaces))
            let pending = engine.pendingCount
            let what = pending > 0 ? "uploading \(pending) \(pending == 1 ? "entry" : "entries")" : "loading entries"
            pairing = .paired("Paired as \(response.client.name) · \(what)")
            code = ""
        } catch {
            pairing = .failed(Self.message(for: HubError.from(error), url: url))
        }
    }

    static func message(for error: HubError, url: URL?) -> String {
        let place = url.map(HubAddress.display) ?? "the hub"
        switch error {
        case .offline, .transport: return "Can’t reach \(place)"
        case .decoding: return "\(place) doesn’t answer like a Fractonica hub"
        case .api(let api):
            switch api.code {
            case .notFound: return "That code is wrong or has expired"
            case .rateLimited: return "Too many attempts; wait a minute and try again"
            default: return api.message
            }
        default: return error.localizedDescription
        }
    }
}
