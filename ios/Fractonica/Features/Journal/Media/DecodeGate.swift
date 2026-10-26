import Foundation

/// Runs at most `limit` jobs at once, in the order they asked; a job whose task is cancelled while it waits leaves the
/// queue and does not run (`run` returns nil).
actor DecodeGate {
    private let limit: Int
    private var running = 0
    private var waiting: [(id: UUID, turn: CheckedContinuation<Bool, Never>)] = []

    init(limit: Int) {
        self.limit = limit
    }

    func run<T: Sendable>(_ job: @Sendable () async -> T) async -> T? {
        guard await enter() else { return nil }
        let result = await job()
        leave()
        return result
    }

    private func enter() async -> Bool {
        if Task.isCancelled { return false }
        if running < limit {
            running += 1
            return true
        }
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { turn in
                waiting.append((id, turn))
            }
        } onCancel: {
            Task { await self.drop(id) }
        }
    }

    private func leave() {
        if waiting.isEmpty {
            running -= 1
        } else {
            // the slot passes straight to the next in line
            waiting.removeFirst().turn.resume(returning: true)
        }
    }

    private func drop(_ id: UUID) {
        guard let i = waiting.firstIndex(where: { $0.id == id }) else { return }
        waiting.remove(at: i).turn.resume(returning: false)
    }
}
