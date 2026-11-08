#if os(iOS)
import CallKit
import Foundation
import PushKit
import UIKit
import os

/// Calls by dispatch, rung: each VoIP push (the dispatch sends one at a call's first ring) is reported to CallKit at
/// once as an incoming video call — the moment's name for the caller, the chosen ringtone — so the phone rings it as a
/// call, locked or not, through Focus as calls do. Answer opens the moment's call picked up (`MomentStore.pickUp`): the
/// cameras film once the app is in front (a video call's button opens it), and the system's call ends then so the
/// camera and microphone are the app's. Decline declines it (photos only if the app opens within a Flavon, as for an
/// alarm's Stop). Unanswered, it ends when its eleven Flavons are up and is a missed call. Every push is reported, as
/// PushKit requires — a stale one (alert mode chosen meanwhile, or rung out) ends at once.
///
/// PushKit is started at launch (a push that launches the app is delivered to the registry made then) while moments
/// ring by dispatch; its token goes into the schedule (`MomentDispatch.pushToken`).
///
/// For the Simulator, which gets no VoIP pushes: `-FXDispatchToken <hex>` stands in for the token, and
/// `-FXDispatchRing 1` rings the next call of the schedule a few seconds after launch, as its push would.
@MainActor
final class MomentCallKit: NSObject {
    static let shared = MomentCallKit()

    private struct Ringing {
        var call: DispatchCall
        var answered = false
        /// Ended by the app (rung out, or handed to the app's own call screen): not a decline.
        var endedByApp = false
    }

    private var registry: PKPushRegistry?
    private var provider: CXProvider?
    private let controller = CXCallController()
    private var calls: [UUID: Ringing] = [:]
    private var ringtone: String?
    private let log = Logger(subsystem: "app.fractonica.clock", category: "calls")

    /// At launch, and whenever the settings change: VoIP pushes while calls are chosen, none otherwise.
    func update() {
        let wanted = MomentStore.shared.settings.calls == .dispatch
        guard wanted || registry != nil else { return }
        if registry == nil {
            let r = PKPushRegistry(queue: .main)
            r.delegate = self
            registry = r
        }
        if wanted { configureProvider() }
        registry?.desiredPushTypes = wanted ? [.voIP] : []
        if !wanted { MomentDispatch.shared.pushToken = nil }
        if wanted, let token = JournalLaunch.string("FXDispatchToken") { MomentDispatch.shared.pushToken = token.lowercased() }
        if wanted, JournalLaunch.flag("FXDispatchRing"), !rangByLaunch {
            rangByLaunch = true
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(6))
                let now = Date.now.timeIntervalSince1970
                let next = MomentDispatch.shared.published?.calls.first { $0.until > now + 5 }
                    ?? DispatchCall(id: "launch", kind: "test", at: now, until: now + 30, title: "Fractonica Dispatch")
                self?.report(next) {}
            }
        }
    }

    private var rangByLaunch = false

    /// The app came to the front: an answered call hands over to the app's own call screen (the cameras film there).
    func becameActive() {
        for (uuid, r) in calls where r.answered && !r.endedByApp { end(uuid) }
    }

    private func configureProvider() {
        let tone = MomentStore.shared.settings.ringtone.fileName
        guard provider == nil || ringtone != tone else { return }
        let c = CXProviderConfiguration()
        c.supportsVideo = true
        c.maximumCallGroups = 1
        c.maximumCallsPerCallGroup = 1
        c.supportedHandleTypes = [.generic]
        c.includesCallsInRecents = false
        if Bundle.main.url(forResource: tone, withExtension: nil) != nil { c.ringtoneSound = tone }
        ringtone = tone
        if let provider {
            provider.configuration = c
        } else {
            let p = CXProvider(configuration: c)
            p.setDelegate(self, queue: nil)
            provider = p
        }
    }

    // MARK: Ringing

    /// Reports a pushed call to CallKit (always: PushKit's rule), then rings it out at its end, or ends it at once
    /// when it is stale.
    fileprivate func report(_ pushed: DispatchCall?, completion: @escaping () -> Void) {
        configureProvider()
        let now = Date.now.timeIntervalSince1970
        let call = pushed ?? DispatchCall(id: "unknown", kind: "test", at: now, until: now + 1, title: "Fractonica")
        let uuid = call.isMoment ? MomentAlarms.id(index: call.index, test: call.test) : UUID()
        let stale = call.until <= now + 1 || (call.isMoment && MomentStore.shared.settings.calls != .dispatch) || calls[uuid] != nil
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: call.title)
        update.localizedCallerName = call.title
        update.hasVideo = true
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsDTMF = false
        if calls[uuid] == nil { calls[uuid] = Ringing(call: call) }
        log.info("push: \(call.id) \(call.title) (\(stale ? "stale" : "ringing"))")
        provider?.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            Task { @MainActor in self?.reported(uuid, call: call, stale: stale, error: error) }
        }
        // reported: PushKit may let the app go back to sleep (CallKit keeps it while the call rings)
        completion()
    }

    private func reported(_ uuid: UUID, call: DispatchCall, stale: Bool, error: Error?) {
        if let error {
            log.error("not rung: \(error.localizedDescription)")
            calls[uuid] = nil
            return
        }
        if stale { return ringOut(uuid, reason: .failed) }
        // the push woke the app: the schedule moves on from here
        MomentStore.shared.refillSoon()
        let until = call.until
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(max(0, until - Date.now.timeIntervalSince1970)))
            guard let self, let r = self.calls[uuid], !r.answered else { return }
            self.ringOut(uuid, reason: .unanswered)
            // the missed call's entry (the iPhone writes them)
            try? await Task.sleep(for: .seconds(2))
            MomentStore.shared.sweepMissed()
        }
    }

    /// Ends a call that rang out (or a stale one) without a decline.
    private func ringOut(_ uuid: UUID, reason: CXCallEndedReason) {
        calls[uuid] = nil
        provider?.reportCall(with: uuid, endedAt: nil, reason: reason)
    }

    /// Ends a call from the app (handing an answered one to the app's call screen).
    private func end(_ uuid: UUID) {
        calls[uuid]?.endedByApp = true
        controller.request(CXTransaction(action: CXEndCallAction(call: uuid))) { [weak self] error in
            guard error != nil else { return }
            Task { @MainActor in self?.ringOut(uuid, reason: .remoteEnded) }
        }
    }

    fileprivate func answered(_ action: CXAnswerCallAction) {
        guard var r = calls[action.callUUID] else { return action.fail() }
        r.answered = true
        calls[action.callUUID] = r
        action.fulfill()
        if r.call.isMoment {
            MomentStore.shared.pickedUpByCall(index: r.call.index, test: r.call.test, answer: true)
        }
        // in front already (or the dispatch's own test, which is only a ring): straight to the app
        if UIApplication.shared.applicationState == .active || !r.call.isMoment {
            let uuid = action.callUUID
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(600))
                self?.end(uuid)
            }
        }
    }

    fileprivate func ended(_ action: CXEndCallAction) {
        action.fulfill()
        guard let r = calls.removeValue(forKey: action.callUUID), !r.endedByApp, !r.answered, r.call.isMoment else { return }
        MomentStore.shared.pickedUpByCall(index: r.call.index, test: r.call.test, answer: false)
    }

    fileprivate func reset() {
        calls.removeAll()
    }
}

extension MomentCallKit: PKPushRegistryDelegate {
    nonisolated func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = DispatchSetup.hex(pushCredentials.token)
        MainActor.assumeIsolated { MomentDispatch.shared.pushToken = token }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        MainActor.assumeIsolated { MomentDispatch.shared.pushToken = nil }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType,
                                  completion: @escaping () -> Void) {
        let call = DispatchCall(payload: payload.dictionaryPayload)
        // PushKit calls on the main queue (the registry's): the completion stays there
        nonisolated(unsafe) let completion = completion
        MainActor.assumeIsolated { MomentCallKit.shared.report(call, completion: completion) }
    }
}

extension MomentCallKit: CXProviderDelegate {
    nonisolated func providerDidReset(_ provider: CXProvider) {
        MainActor.assumeIsolated { MomentCallKit.shared.reset() }
    }

    // the provider's delegate queue is the main queue (`setDelegate(_:queue: nil)`): its actions stay there
    nonisolated func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        nonisolated(unsafe) let action = action
        MainActor.assumeIsolated { MomentCallKit.shared.answered(action) }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        nonisolated(unsafe) let action = action
        MainActor.assumeIsolated { MomentCallKit.shared.ended(action) }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        action.fulfill()
    }
}
#endif
