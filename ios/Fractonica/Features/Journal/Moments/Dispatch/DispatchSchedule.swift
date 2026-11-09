import Foundation

// Calls by dispatch: moments rung as real calls (CallKit) by VoIP pushes that fractonica-dispatch (dispatch/) sends
// at each call's first ring. The phone keeps its schedule of calls on the hub as one record, `dispatch.calls.<install>`
// (hub/API.md); the dispatch, paired with the hub by a code the phone makes, follows those records and writes its own
// status, `dispatch.status.<client id>`. Pure logic here, checked by Moments/Checks: the schedule's record, a push's
// call, the dispatch's status, the provisioning profile's push environment, the pairing command.

/// One call the dispatch rings: a moment's (or a test call's), from its first ring to when it rings out.
struct DispatchCall: Codable, Hashable, Sendable {
    /// "m<moment number>", "t<number>" for a test call.
    var id: String
    /// "moment", or "test" for the dispatch's own test calls (`dispatch test`, `--call`), which are no moments: one
    /// opens as the Moments screen's Test a Call (`MomentStore.pickedUpDispatchTest`).
    var kind: String = "moment"
    /// First ring and ring-out (Unix seconds).
    var at: Double
    var until: Double
    /// The moment it calls for, and its number on the calendar.
    var moment: Double = 0
    var index: Int64 = 0
    /// The Moments screen's Test a Call: a made-up moment.
    var test: Bool = false
    /// The caller: the moment's name.
    var title: String
    var rarity: String = "rare"
    var level: String = "helion"
    var boundary: String = "start"

    /// A push's `fx`, read leniently (nil when it is no call).
    init?(payload: [AnyHashable: Any]) {
        guard let fx = payload["fx"] as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: fx),
              let call = try? JSONDecoder().decode(DispatchCall.self, from: data) else { return nil }
        self = call
    }

    init(id: String, kind: String = "moment", at: Double, until: Double, moment: Double = 0, index: Int64 = 0, test: Bool = false,
         title: String, rarity: String = "rare", level: String = "helion", boundary: String = "start") {
        self.id = id
        self.kind = kind
        self.at = at
        self.until = until
        self.moment = moment
        self.index = index
        self.test = test
        self.title = title
        self.rarity = rarity
        self.level = level
        self.boundary = boundary
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        at = try c.decode(Double.self, forKey: .at)
        until = try c.decode(Double.self, forKey: .until)
        kind = (try? c.decodeIfPresent(String.self, forKey: .kind)) ?? "moment"
        moment = (try? c.decodeIfPresent(Double.self, forKey: .moment)) ?? at
        index = (try? c.decodeIfPresent(Int64.self, forKey: .index)) ?? 0
        test = (try? c.decodeIfPresent(Bool.self, forKey: .test)) ?? false
        title = (try? c.decodeIfPresent(String.self, forKey: .title)) ?? "Fractonica"
        rarity = (try? c.decodeIfPresent(String.self, forKey: .rarity)) ?? "rare"
        level = (try? c.decodeIfPresent(String.self, forKey: .level)) ?? "helion"
        boundary = (try? c.decodeIfPresent(String.self, forKey: .boundary)) ?? "start"
    }

    /// A moment of the calendar (not the dispatch's own test).
    var isMoment: Bool { kind == "moment" }
}

/// The phone's schedule record (`dispatch.calls.<install>`): whether it rings by dispatch now, where to push, and the
/// next calls.
struct DispatchSchedule: Codable, Hashable, Sendable {
    static let kind = "dispatch.calls"
    /// How far ahead the schedule runs: every call each VoIP push wakes the phone and it lists them anew, so this only
    /// needs to carry the calls through days the phone cannot reach the hub.
    static let horizon = 4 * 86_400.0
    static let maxCalls = 60

    struct Push: Codable, Hashable, Sendable {
        /// The VoIP push token, hex.
        var token: String?
        /// "development" (a build from Xcode) or "production".
        var environment: String
        /// The bundle id with ".voip".
        var topic: String
    }

    /// Calls ring by dispatch (false: the app's alert mode — the dispatch sends nothing, the pairing stays).
    var enabled: Bool
    var name: String
    /// The developer team, for the dispatch's provider token.
    var team: String?
    var push: Push
    var calls: [DispatchCall]

    static func recordID(install: String) -> String { "\(kind).\(install)" }

    /// The record's data (as `JSONValue`).
    var data: JSONValue {
        guard let encoded = try? JSONEncoder().encode(self), let value = try? JSONDecoder().decode(JSONValue.self, from: encoded) else {
            return .object([:])
        }
        return value
    }

    init(enabled: Bool, name: String, team: String?, push: Push, calls: [DispatchCall]) {
        self.enabled = enabled
        self.name = name
        self.team = team
        self.push = push
        self.calls = calls
    }

    init?(data: JSONValue) {
        guard let encoded = try? JSONEncoder().encode(data), let s = try? JSONDecoder().decode(DispatchSchedule.self, from: encoded) else { return nil }
        self = s
    }
}

/// A dispatch's status record (`dispatch.status.<client id>`), as the app reads it.
struct DispatchStatus: Hashable, Sendable, Identifiable {
    static let kind = "dispatch.status"

    struct Last: Hashable, Sendable {
        var at: Double
        var title: String?
        var status: Int
        var reason: String?
        var ok: Bool { status == 200 }
    }

    let id: String
    let name: String
    let version: String
    /// When it last wrote (a heartbeat every `heartbeat` seconds).
    let seen: Double
    let heartbeat: Double
    /// "ready", or what keeps it from pushing ("no APNs key", "APNs key: …").
    let apns: String
    let last: Last?
    /// Pushes sent since it started.
    let sent: Int

    init?(record: HubRecord) {
        guard record.kind == Self.kind, !record.isDeleted else { return nil }
        let d = record.data
        id = record.id
        name = d["name"]?.string ?? "Dispatch"
        version = d["version"]?.string ?? ""
        seen = d["seen"]?.number ?? record.updated
        heartbeat = d["heartbeat"]?.number ?? 600
        apns = d["apns"]?.string ?? "unknown"
        sent = Int(d["sent"]?.number ?? 0)
        if let l = d["last"]?.object, let at = l["at"]?.number {
            last = Last(at: at, title: l["title"]?.string, status: Int(l["status"]?.number ?? 0), reason: l["reason"]?.string)
        } else {
            last = nil
        }
    }

    /// Ready to push.
    var canPush: Bool { apns == "ready" }

    /// Seen within three heartbeats.
    func isOnline(at now: Double) -> Bool { now - seen <= 3 * heartbeat + 60 }
}

enum DispatchSetup {
    /// The push environment of the app's provisioning profile (`aps-environment` in embedded.mobileprovision, read as
    /// text: the profile is a signed plist); an App Store build has none and pushes in production.
    static func apsEnvironment(profile text: String?) -> String {
        guard let text, let key = text.range(of: "<key>aps-environment</key>") else { return "production" }
        let rest = text[key.upperBound...]
        guard let open = rest.range(of: "<string>"), let close = rest.range(of: "</string>", range: open.upperBound..<rest.endIndex) else {
            return "production"
        }
        return rest[open.upperBound..<close.lowerBound].trimmingCharacters(in: .whitespacesAndNewlines) == "development" ? "development" : "production"
    }

    /// The command that pairs a dispatch, run from the repository: `node dispatch/bin/dispatch.mjs 7KQ2-M9XD --hub …`.
    static func command(code: String, hub: URL?) -> String {
        let address = hub.map { $0.absoluteString.hasSuffix("/") ? String($0.absoluteString.dropLast()) : $0.absoluteString }
        return "node dispatch/bin/dispatch.mjs \(code)" + (address.map { " --hub \($0)" } ?? "")
    }

    /// A push token as hex.
    static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
}
