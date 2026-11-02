import Foundation
import SwiftUI
#if os(iOS)
import AlarmKit
import AppIntents
#endif

// A moment's call while the app is not in front: an alarm (AlarmKit, iOS 26), so it rings like one — through the
// silent switch and Focus, on the Lock Screen — with the moment's name for the caller, the chosen ringtone, Answer
// (the app opens on the call, picked up: the back camera filming) and the system's Stop for Decline (the app opens and
// each camera takes its photo). One alarm per call, from its first ring, for the next few calls (a rolling window like
// the notifications', `MomentStore.syncAlarms`); while the app is in front its own call screen rings instead, so they
// are cleared then. Each alarm's id comes from its moment's number, so the window is kept by comparing ids (and a
// fingerprint of what each says, in `moments.alarms.v1`). Without AlarmKit (iOS 18, or not allowed) a time-sensitive
// notification rings the ringtone once instead (`MomentScheduling`).

/// Whether moments may ring as alarms.
enum MomentAlarmAuthorization: Sendable {
    /// No AlarmKit here (iOS 18, the Mac).
    case unsupported
    case unknown, notDetermined, denied, authorized
}

/// One call to ring as an alarm.
struct MomentAlarmCall: Sendable, Hashable {
    var index: Int64
    /// A test call's made-up moment (`MomentStore.testCall`).
    var test = false
    /// Its first ring (Unix seconds).
    var fire: Double
    /// The caller: the moment's name.
    var title: String
    var ringtone: MomentRingtone

    var fingerprint: String { [title, ringtone.rawValue, String(Int(fire * 10)), test ? "test" : ""].joined(separator: "|") }

    /// The alarm's id: fixed by the moment's number (a test call has its own).
    var id: UUID { MomentAlarms.id(index: index, test: test) }
}

@MainActor
enum MomentAlarms {
    /// At most this many calls ahead.
    static let window = 8
    private static let defaultsKey = "moments.alarms.v1"

    /// The alarm id of moment `index`: "F0C0A11A-…" with the number in its last 64 bits.
    nonisolated static func id(index: Int64, test: Bool) -> UUID {
        let u = UInt64(bitPattern: index)
        let text = String(format: "F0C0A11A-%04lX-4%03lX-8%03lX-%012llX", test ? 0x7E57 : 0 as Int, Int((u >> 52) & 0xFFF), Int((u >> 48) & 0xF),
                          u & 0xFFFF_FFFF_FFFF)
        return UUID(uuidString: text) ?? UUID()
    }

    static func authorization() -> MomentAlarmAuthorization {
        #if os(iOS)
        guard #available(iOS 26.0, *) else { return .unsupported }
        switch AlarmManager.shared.authorizationState {
        case .notDetermined: return .notDetermined
        case .denied: return .denied
        case .authorized: return .authorized
        @unknown default: return .unknown
        }
        #else
        return .unsupported
        #endif
    }

    static func requestAuthorization() async -> MomentAlarmAuthorization {
        #if os(iOS)
        guard #available(iOS 26.0, *) else { return .unsupported }
        if AlarmManager.shared.authorizationState == .notDetermined {
            _ = try? await AlarmManager.shared.requestAuthorization()
        }
        #endif
        return authorization()
    }

    /// Makes the scheduled alarms exactly `calls`: the others cancelled (a ringing one stopped), the missing or changed
    /// ones scheduled.
    static func sync(_ calls: [MomentAlarmCall]) async {
        #if os(iOS)
        guard #available(iOS 26.0, *), AlarmManager.shared.authorizationState == .authorized else { return }
        let manager = AlarmManager.shared
        var kept = UserDefaults.standard.dictionary(forKey: defaultsKey) as? [String: String] ?? [:]
        let wanted = Dictionary(calls.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let existing = (try? manager.alarms) ?? []
        // one ringing now rings on (its call is no longer ahead)
        for alarm in existing where alarm.state != .alerting && (wanted[alarm.id].map { kept[alarm.id.uuidString] != $0.fingerprint } ?? true) {
            try? manager.cancel(id: alarm.id)
            kept[alarm.id.uuidString] = nil
        }
        let ringing = Set(existing.filter { $0.state == .alerting }.map(\.id))
        let left = Set(existing.map(\.id)).filter { kept[$0.uuidString] != nil || ringing.contains($0) }
        for call in calls where !left.contains(call.id) {
            do {
                try await schedule(call)
                kept[call.id.uuidString] = call.fingerprint
            } catch {
                momentsLog.error("could not set the alarm for \(call.index): \(error.localizedDescription)")
            }
        }
        kept = kept.filter { wanted[UUID(uuidString: $0.key) ?? UUID()] != nil }
        UserDefaults.standard.set(kept, forKey: defaultsKey)
        momentsLog.info("alarms: \(calls.count) calls ahead")
        #endif
    }

    /// Cancels every moment's alarm, stopping one that rings (the app's own call screen takes over).
    static func clear() {
        #if os(iOS)
        guard #available(iOS 26.0, *), AlarmManager.shared.authorizationState == .authorized else { return }
        for alarm in (try? AlarmManager.shared.alarms) ?? [] {
            if alarm.state == .alerting { try? AlarmManager.shared.stop(id: alarm.id) }
            try? AlarmManager.shared.cancel(id: alarm.id)
        }
        UserDefaults.standard.removeObject(forKey: defaultsKey)
        #endif
    }

    #if os(iOS)
    /// Off the main actor: an alarm's configuration is not sendable.
    @available(iOS 26.0, *)
    nonisolated private static func schedule(_ call: MomentAlarmCall) async throws {
        _ = try await AlarmManager.shared.schedule(id: call.id, configuration: configuration(call))
    }

    @available(iOS 26.0, *)
    nonisolated private static func configuration(_ call: MomentAlarmCall) -> AlarmManager.AlarmConfiguration<MomentCallAlarm> {
        let answer = AlarmButton(text: "Answer", textColor: .white, systemImageName: "phone.fill")
        let title = LocalizedStringResource(stringLiteral: call.title)
        let alert: AlarmPresentation.Alert
        if #available(iOS 26.1, *) {
            alert = AlarmPresentation.Alert(title: title, secondaryButton: answer, secondaryButtonBehavior: .custom)
        } else {
            alert = AlarmPresentation.Alert(title: title, stopButton: AlarmButton(text: "Decline", textColor: .white, systemImageName: "phone.down.fill"),
                                            secondaryButton: answer, secondaryButtonBehavior: .custom)
        }
        let attributes = AlarmAttributes(presentation: AlarmPresentation(alert: alert),
                                         metadata: MomentCallAlarm(index: call.index, test: call.test),
                                         tintColor: Color(red: 0.2, green: 0.78, blue: 0.35))
        return AlarmManager.AlarmConfiguration(
            schedule: .fixed(Date(timeIntervalSince1970: call.fire)),
            attributes: attributes,
            stopIntent: DeclineMomentCallIntent(index: call.index, test: call.test),
            secondaryIntent: AnswerMomentCallIntent(index: call.index, test: call.test),
            sound: .named(call.ringtone.fileName)
        )
    }
    #endif
}

#if os(iOS)
/// What a moment's alarm carries: its moment.
@available(iOS 26.0, *)
struct MomentCallAlarm: AlarmMetadata {
    var index: Int64
    var test: Bool
}

/// The alarm's Answer: the app opens on the call, picked up.
@available(iOS 26.0, *)
struct AnswerMomentCallIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Answer the Moment"
    static let isDiscoverable = false
    static let supportedModes: IntentModes = .foreground(.immediate)

    @Parameter(title: "Moment")
    var index: Int
    @Parameter(title: "Test")
    var test: Bool

    init() {}

    init(index: Int64, test: Bool) {
        self.index = Int(index)
        self.test = test
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        MomentStore.shared.pickUp(index: Int64(index), test: test, answer: true)
        return .result()
    }
}

/// The alarm's Stop: the call declined — the app opens for each camera's photo.
@available(iOS 26.0, *)
struct DeclineMomentCallIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Decline the Moment"
    static let isDiscoverable = false
    static let supportedModes: IntentModes = .foreground(.immediate)

    @Parameter(title: "Moment")
    var index: Int
    @Parameter(title: "Test")
    var test: Bool

    init() {}

    init(index: Int64, test: Bool) {
        self.index = Int(index)
        self.test = test
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        MomentStore.shared.pickUp(index: Int64(index), test: test, answer: false)
        return .result()
    }
}
#endif
