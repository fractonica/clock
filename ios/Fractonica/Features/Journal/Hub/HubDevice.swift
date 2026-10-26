import Foundation
#if os(iOS)
import UIKit
#endif

/// How this device introduces itself when pairing: a name people recognise in the hub's device list ("iPhone 17 Pro",
/// "Dimas’s MacBook Pro"; editable before pairing) and its platform ("iOS 26.1").
@MainActor
enum HubDevice {
    static var defaultName: String {
        #if os(iOS)
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_DEVICE_NAME"], !simulated.isEmpty {
            return simulated
        }
        let name = UIDevice.current.name
        // Without the user-assigned-name entitlement iOS answers just "iPhone": the model's name says more.
        if name == UIDevice.current.model, let model = modelNames[modelIdentifier] { return model }
        return name
        #else
        return Host.current().localizedName ?? "Mac"
        #endif
    }

    static var platform: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        let version = v.patchVersion > 0 ? "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)" : "\(v.majorVersion).\(v.minorVersion)"
        #if os(iOS)
        return "\(UIDevice.current.userInterfaceIdiom == .pad ? "iPadOS" : "iOS") \(version)"
        #else
        return "macOS \(version)"
        #endif
    }

    /// "iPhone18,1".
    static var modelIdentifier: String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }

    /// Recent iPhones by model identifier (anything else keeps the system's name).
    private static let modelNames: [String: String] = [
        "iPhone15,4": "iPhone 15", "iPhone15,5": "iPhone 15 Plus",
        "iPhone16,1": "iPhone 15 Pro", "iPhone16,2": "iPhone 15 Pro Max",
        "iPhone17,1": "iPhone 16 Pro", "iPhone17,2": "iPhone 16 Pro Max",
        "iPhone17,3": "iPhone 16", "iPhone17,4": "iPhone 16 Plus", "iPhone17,5": "iPhone 16e",
        "iPhone18,1": "iPhone 17 Pro", "iPhone18,2": "iPhone 17 Pro Max",
        "iPhone18,3": "iPhone 17", "iPhone18,4": "iPhone Air",
    ]
}
