#if DEBUG && os(iOS) && canImport(ActivityKit)
import SwiftUI

/// Debug builds only: the Live Activity's views drawn in the app under the `-FXTimerActivity timer|paused|stale|stopwatch`
/// launch argument, so screenshots can show the Lock Screen and Dynamic Island presentations (the simulator's Lock
/// Screen cannot be captured by the build scripts). Uses the same shared views as the widget extension.
struct TimerActivityPreview: View {
    private let mode = UserDefaults.standard.string(forKey: "FXTimerActivity")

    @Environment(AppSettings.self) private var settings

    var body: some View {
        if let mode {
            let content = sample(mode)
            ScrollView {
                VStack(spacing: 18) {
                    TimerActivityLockScreen(attributes: content.attributes, state: content.state)
                        .background(Theme.background.opacity(0.92), in: .rect(cornerRadius: 24))
                        .environment(\.timerActivityStale, mode == "stale")
                    island(content)
                }
                .padding(16)
                .environment(\.timerActivityStale, mode == "stale")
                .environment(\.timerActivityStill, true)
            }
            .frame(maxHeight: 520)
            .background(
                LinearGradient(colors: [Theme.levelColor(2, lightness: 0.25), Theme.levelColor(9, lightness: 0.2)], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: .rect(cornerRadius: 28)
            )
            .padding(12)
        }
    }

    private func island(_ content: (attributes: TimerActivityAttributes, state: TimerActivityAttributes.ContentState)) -> some View {
        let a = content.attributes, s = content.state
        return VStack(spacing: 14) {
            // compact
            HStack {
                TimerActivityBadge(attributes: a, state: s, size: 22, lineWidth: 3)
                Spacer()
                TimerActivityCompactReading(attributes: a, state: s)
            }
            .padding(.horizontal, 10)
            .frame(width: 250, height: 37)
            .background(.black, in: .capsule)
            HStack(spacing: 14) {
                // minimal
                TimerActivityBadge(attributes: a, state: s, size: 22, lineWidth: 3)
                    .frame(width: 37, height: 37)
                    .background(.black, in: .circle)
            }
            // expanded
            VStack(spacing: 8) {
                HStack {
                    HStack(spacing: 10) {
                        TimerActivityBadge(attributes: a, state: s, size: 36, lineWidth: 4)
                        VStack(alignment: .leading, spacing: 1) {
                            if a.kind == .timer { Text("Timer").font(.caption2.weight(.semibold)).foregroundStyle(Theme.ink3) }
                            Text(s.title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                        }
                    }
                    Spacer()
                    TimerActivityReading(attributes: a, state: s, size: 34).frame(maxWidth: 150, alignment: .trailing)
                }
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(s.detail).font(.footnote.monospacedDigit()).foregroundStyle(Theme.ink2).lineLimit(1)
                        if a.kind == .timer { TimerActivityBar(state: s) }
                    }
                    Spacer(minLength: 4)
                    TimerActivityButtons(attributes: a, state: s, compact: true)
                }
            }
            .padding(18)
            .frame(width: 370)
            .background(.black, in: .rect(cornerRadius: 44))
        }
    }

    private func sample(_ mode: String) -> (attributes: TimerActivityAttributes, state: TimerActivityAttributes.ContentState) {
        let timer = TimerStore.shared
        let words = timer.words
        if mode == "stopwatch" {
            var run = StopwatchStore.shared.run
            if run.isClear {
                run.since = .now.addingTimeInterval(-63)
                run.marks = [20.5, 41.2]
            }
            return (TimerActivityAttributes(kind: .stopwatch, runID: "preview"), TimerActivities.state(for: run, words: words))
        }
        var run = timer.run ?? (try? TimerRun.start(.ladder(LadderSpan(iota: 4)), at: .now.addingTimeInterval(-600), clock: timer.clock).get())
        if mode == "paused" { run?.pause(at: .now, clock: timer.clock) }
        guard let run else {
            let now = Date.now
            return (TimerActivityAttributes(kind: .timer, runID: "preview"), .init(title: "—", start: now, end: now, pausedAt: now, reading: "—", compact: "—", detail: "", pure: settings.pure))
        }
        return (TimerActivityAttributes(kind: .timer, runID: "preview"), TimerActivities.state(for: run, words: words))
    }
}
#endif
