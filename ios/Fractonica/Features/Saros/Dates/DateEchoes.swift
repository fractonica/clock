import FractonicaKit
import Foundation
import UserNotifications

/// Keeps the dates' echoes pending as notifications: the soonest `DateEchoPlanner.budget` of them (`echo.` requests;
/// the rest come as these fire and the app refills — on launch, coming to the front, the background refresh, every
/// change to the dates, the hub's too, and a switch of the reference series, whose clock the period echoes follow).
/// Echoes in Alerts' quiet hours come silently.
@MainActor
final class DateEchoes {
    static let shared = DateEchoes()

    private var pending: Task<Void, Never>?
    private var watching = false

    /// A refill shortly (changes come in bursts: a sync, an edit).
    func scheduleRefill() {
        pending?.cancel()
        pending = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await refill()
        }
    }

    /// Plans the echoes and makes the pending `echo.` requests match.
    func refill() async {
        let book = DateBook.shared
        let dates = book.dates.filter { !$0.echoes.isEmpty }
        let settings = AppSettings.shared
        let zone = settings.timeZone
        let now = Date.now.timeIntervalSince1970
        let quiet = AlertStore.shared.quiet
        let text = DateEchoText(pure: settings.pure, notation: .standard)
        let byID = Dictionary(dates.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let requests: [DateEchoRequest] = DateEchoPlanner.plan(dates, after: now, clock: .shared, zone: zone).compactMap { echo in
            guard let date = byID[echo.dateID] else { return nil }
            return DateEchoRequest(id: echo.id, dateID: date.id, fire: echo.time, title: text.title(date, echo),
                                   body: text.body(date, echo), passive: quiet.contains(echo.time, zone: zone))
        }
        _ = await AlertScheduling.within(30) { await DateEchoScheduling.apply(requests) }
    }

    /// Asks for permission to notify (when the person turns an echo on), then refills.
    func requestPermission() {
        Task {
            _ = await AlertScheduling.within(60) { await AlertScheduling.requestAuthorization([.alert, .sound]) }
            await refill()
        }
    }

    /// Refills whenever the store changes (dates edited here or arriving from the hub).
    func watchStore() {
        guard !watching else { return }
        watching = true
        observe()
    }

    private func observe() {
        withObservationTracking {
            _ = DateBook.shared.revision
        } onChange: {
            Task { @MainActor in
                DateEchoes.shared.scheduleRefill()
                DateEchoes.shared.observe()
            }
        }
    }
}

/// One echo notification to keep pending.
struct DateEchoRequest: Sendable {
    let id: String
    let dateID: String
    let fire: Double
    let title: String
    let body: String
    let passive: Bool

    var fingerprint: String { "\(Int64((fire * 1000).rounded()))|\(passive)|\(title)|\(body)" }
}

/// The notification centre's side, off the main actor (ARCHITECTURE § Notifications).
enum DateEchoScheduling {
    static let fingerprintKey = "fx.echo.fingerprint"
    static let dateKey = "fx.echo.date"

    /// Makes the pending `echo.` requests equal to `requests`; returns the identifiers held afterwards.
    static func apply(_ requests: [DateEchoRequest]) async -> Set<String> {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        var held: [String: String] = [:]
        for request in pending where request.identifier.hasPrefix(DateEchoPlanner.prefix) {
            held[request.identifier] = request.content.userInfo[fingerprintKey] as? String ?? ""
        }
        let wanted = Dictionary(requests.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let stale = held.filter { wanted[$0.key]?.fingerprint != $0.value }.map(\.key)
        if !stale.isEmpty { center.removePendingNotificationRequests(withIdentifiers: stale) }
        var kept = Set(held.keys).subtracting(stale)
        for request in requests where !kept.contains(request.id) {
            let interval = request.fire - Date.now.timeIntervalSince1970
            guard interval > 0.5 else { continue }
            let content = UNMutableNotificationContent()
            content.title = request.title
            content.body = request.body
            content.sound = request.passive ? nil : .default
            content.interruptionLevel = request.passive ? .passive : .active
            content.threadIdentifier = DateEchoPlanner.prefix + request.dateID
            var info = AppLink(screen: .saros).userInfo
            info[fingerprintKey] = request.fingerprint
            info[dateKey] = request.dateID
            content.userInfo = info
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            do {
                try await center.add(UNNotificationRequest(identifier: request.id, content: content, trigger: trigger))
                kept.insert(request.id)
            } catch {
                continue
            }
        }
        return kept
    }
}

/// The dates' lifecycle: their echoes refilled on launch, coming to the front and a switch of the reference series;
/// a tapped echo opens its date on the Saros screen. `-FXDatesSeed 1` adds sample dates to a store without any.
enum DatesHooks: FeatureHooks {
    static func launch() {
        Task {
            await JournalStore.shared.load()
            if JournalLaunch.flag("FXDatesSeed") { DateSeed.fillIfEmpty(DateBook.shared) }
            DateEchoes.shared.watchStore()
            await DateEchoes.shared.refill()
        }
    }

    static func becameActive() {
        DateEchoes.shared.scheduleRefill()
    }

    static func referenceChanged(from old: Int) {
        DateEchoes.shared.scheduleRefill()
    }

    /// For the background refresh (Alerts' task refills the echoes too).
    static func refill() async {
        await JournalStore.shared.load()
        await DateEchoes.shared.refill()
    }

    static func presentation(ofNotification identifier: String) -> UNNotificationPresentationOptions? {
        identifier.hasPrefix(DateEchoPlanner.prefix) ? [.banner, .list, .sound] : nil
    }

    static func open(_ notification: NotificationResponse) -> Bool {
        guard notification.identifier.hasPrefix(DateEchoPlanner.prefix) else { return false }
        // "echo.<date id>.y2031" / "echo.<date id>.l4.c6120": the date's id is a UUID, without dots
        let id = notification.identifier.dropFirst(DateEchoPlanner.prefix.count).split(separator: ".").first.map(String.init)
        if notification.isTap, let id {
            DateBook.shared.opened = id
            AppRouter.shared.show(.saros)
        }
        return true
    }
}
