import Foundation
import Security
import Synchronization

/// What pairing leaves on the device: where the hub is, who this device is to it, and the token. Kept in the Keychain,
/// which outlives the app: after a reinstall the app is still paired and pulls every entry back from the hub.
struct HubCredentials: Codable, Sendable, Equatable {
    var hubURL: URL
    var token: String
    var clientId: String
    /// The name this device paired under ("iPhone 17 Pro").
    var clientName: String
    var hubId: String
    var hubName: String
    /// When it paired, Unix seconds.
    var paired: Double
}

/// Where credentials and the device's stable id live: the Keychain in the app, memory in checks and previews.
protocol HubSecretStore: Sendable {
    func load() -> HubCredentials?
    func save(_ credentials: HubCredentials) throws
    func delete()
    /// This install's stable identifier (a UUID made on first use), sent as `device` when pairing, so pairing again
    /// replaces this device's client on the hub instead of adding another. Survives unpairing and reinstalls.
    func deviceId() -> String
}

/// Credentials and the device id as generic passwords in the Keychain: accessible after the first unlock (background
/// sync works while the phone is locked), never synchronised through iCloud (each device pairs on its own).
struct HubKeychain: HubSecretStore {
    static let standard = HubKeychain(service: "app.fractonica.clock.hub")

    var service: String

    private static let credentialsAccount = "credentials"
    private static let deviceAccount = "device"

    func load() -> HubCredentials? {
        guard let data = read(Self.credentialsAccount) else { return nil }
        return try? JSONDecoder().decode(HubCredentials.self, from: data)
    }

    func save(_ credentials: HubCredentials) throws {
        try write(Self.credentialsAccount, try JSONEncoder().encode(credentials))
    }

    func delete() {
        remove(Self.credentialsAccount)
    }

    func deviceId() -> String {
        if let data = read(Self.deviceAccount), let id = String(data: data, encoding: .utf8), !id.isEmpty { return id }
        let id = UUID().uuidString
        try? write(Self.deviceAccount, Data(id.utf8))
        return id
    }

    /// Removes the device id too (checks only: the app keeps it for good).
    func deleteAll() {
        remove(Self.credentialsAccount)
        remove(Self.deviceAccount)
    }

    // MARK: SecItem

    struct KeychainError: Error, LocalizedError {
        var status: OSStatus
        var errorDescription: String? {
            "Keychain error \(status): \(SecCopyErrorMessageString(status, nil) as String? ?? "unknown")"
        }
    }

    private func query(_ account: String, legacy: Bool) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false,
        ]
        #if os(macOS)
        // The data protection keychain needs a signed app with a keychain access group; an ad-hoc signed build (and
        // the checks) fall back to the login keychain.
        if !legacy { query[kSecUseDataProtectionKeychain as String] = true }
        #endif
        return query
    }

    /// Runs `body` against the data protection keychain, again against the login keychain when the process lacks the
    /// entitlement for the first (macOS only; such a process finds nothing there rather than being refused, so "not
    /// found" falls back too).
    private func attempt(_ body: (_ legacy: Bool) -> OSStatus) -> OSStatus {
        let status = body(false)
        #if os(macOS)
        if status == errSecMissingEntitlement || status == errSecItemNotFound { return body(true) }
        #endif
        return status
    }

    private func read(_ account: String) -> Data? {
        var result: CFTypeRef?
        let status = attempt { legacy in
            var q = query(account, legacy: legacy)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            return SecItemCopyMatching(q as CFDictionary, &result)
        }
        // A process without the entitlement may be told "not found" rather than refused: look in the fallback too.
        guard status == errSecSuccess else { return try? Data(contentsOf: fallbackFile(account)) }
        return result as? Data
    }

    private func write(_ account: String, _ data: Data) throws {
        let status = attempt { legacy in
            let q = query(account, legacy: legacy)
            let update: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            ]
            var status = SecItemUpdate(q as CFDictionary, update as CFDictionary)
            if status == errSecItemNotFound {
                var add = q
                add.merge(update) { $1 }
                status = SecItemAdd(add as CFDictionary, nil)
            }
            return status
        }
        if status == errSecMissingEntitlement {
            let file = fallbackFile(account)
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    private func remove(_ account: String) {
        _ = attempt { legacy in SecItemDelete(query(account, legacy: legacy) as CFDictionary) }
        try? FileManager.default.removeItem(at: fallbackFile(account))
    }

    /// Where an unsigned build keeps what the Keychain refuses it (`errSecMissingEntitlement`: the command-line
    /// simulator builds of scripts/build.sh, signed with nothing): a file in Application Support, which does not
    /// outlive the app. Signed builds (Xcode, TestFlight, the App Store) always use the Keychain.
    private func fallbackFile(_ account: String) -> URL {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return support.appendingPathComponent("HubUnsignedKeychain", isDirectory: true)
            .appendingPathComponent("\(service).\(account)")
    }
}

/// Credentials in memory, for checks and previews.
final class MemorySecretStore: HubSecretStore {
    private let state: Mutex<(credentials: HubCredentials?, device: String)>

    init(credentials: HubCredentials? = nil, deviceId: String = UUID().uuidString) {
        state = Mutex((credentials, deviceId))
    }

    func load() -> HubCredentials? { state.withLock { $0.credentials } }
    func save(_ credentials: HubCredentials) throws { state.withLock { $0.credentials = credentials } }
    func delete() { state.withLock { $0.credentials = nil } }
    func deviceId() -> String { state.withLock { $0.device } }
}
