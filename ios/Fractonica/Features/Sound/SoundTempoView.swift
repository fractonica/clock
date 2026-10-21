import FractonicaKit
import SwiftUI

/// The tempo lock: "one cycle of depth N lasts x" sets the time-lapse so the hierarchy becomes nested rhythm — the
/// quarters of the locked cycle are the pulses, the finer cycles their subdivisions — and holds it until the speed is
/// changed elsewhere. Below, the rhythm it makes and the speeds to listen at.
struct SoundTempoView: View {
    let words: SoundWords

    @Environment(ClockStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(ToastCenter.self) private var toasts

    private var engine: SoundEngine { .shared }

    var body: some View {
        let prefs = engine.preferences
        SoundCard("Tempo") {
            if let lock = engine.lock {
                lockChip(lock)
            }
        } content: {
            VStack(alignment: .leading, spacing: 14) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 10) {
                        sentenceStart(prefs)
                        sentenceEnd(prefs)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        sentenceStart(prefs)
                        sentenceEnd(prefs)
                    }
                }
                lockButton
                Text(words.tempoReadout(depth: prefs.tempoDepth, rate: store.rate))
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                rhythm(prefs)
                speeds
            }
        }
        .sensoryFeedback(.selection, trigger: prefs.tempoSeconds) { _, _ in settings.haptics }
        .sensoryFeedback(.success, trigger: engine.lock != nil) { _, locked in locked && settings.haptics }
    }

    // MARK: "One η lasts 4 s"

    private func sentenceStart(_ prefs: SoundPreferences) -> some View {
        HStack(spacing: 8) {
            Text("One cycle of")
                .foregroundStyle(Theme.ink2)
            depthPicker(prefs)
        }
    }

    private func sentenceEnd(_ prefs: SoundPreferences) -> some View {
        HStack(spacing: 8) {
            Text("lasts")
                .foregroundStyle(Theme.ink2)
            lengthStepper(prefs)
        }
    }

    private func depthPicker(_ prefs: SoundPreferences) -> some View {
        Picker("Depth", selection: Binding(get: { engine.preferences.tempoDepth }, set: { d in engine.update { $0.tempoDepth = d } })) {
            ForEach(Array(SoundPreferences.tempoDepthRange), id: \.self) { depth in
                Text(words.depthOption(depth - 1)).tag(depth)
            }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .tint(Theme.levelColor(prefs.tempoDepth - 1, lightness: 0.72))
        .fixedSize()
    }

    private func lengthStepper(_ prefs: SoundPreferences) -> some View {
        let value = words.tempoValue(prefs.tempoSeconds)
        let ladder = words.tempoLadder
        let lower = ladder.last { $0 < value - 1e-9 }
        let higher = ladder.first { $0 > value + 1e-9 }
        return HStack(spacing: 2) {
            stepButton("minus", enabled: lower != nil) { if let lower { set(lower) } }
                .accessibilityLabel("Shorter")
            Text(words.tempoText(value))
                .font(.reading(15, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(minWidth: words.pure ? 92 : 56)
                .contentTransition(.numericText(value: value))
                .animation(.snappy, value: value)
            stepButton("plus", enabled: higher != nil) { if let higher { set(higher) } }
                .accessibilityLabel("Longer")
        }
        .padding(3)
        .background(Theme.panel3.opacity(0.7), in: .capsule)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Length of one cycle")
        .accessibilityValue(words.tempoText(value))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: if let higher { set(higher) }
            case .decrement: if let lower { set(lower) }
            @unknown default: break
            }
        }
    }

    private func stepButton(_ symbol: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.footnote.weight(.bold))
                .frame(width: 30, height: 30)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .foregroundStyle(enabled ? Theme.ink : Theme.ink3.opacity(0.5))
        .disabled(!enabled)
        .buttonRepeatBehavior(.enabled)
    }

    private func set(_ value: Double) {
        engine.update { $0.tempoSeconds = words.tempoSeconds(value) }
    }

    // MARK: Lock

    private var lockButton: some View {
        let locked = engine.lock != nil
        return Button {
            if locked {
                if let toast = engine.unlockTempo(words: words) { toasts.show(toast) }
            } else if let toast = engine.lockTempo(words: words) {
                toasts.show(toast)
            }
        } label: {
            Label(locked ? "Unlock tempo" : "Lock tempo", systemImage: locked ? "lock.open.fill" : "lock.fill")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
        }
        .buttonStyle(.glassProminent)
        .tint(locked ? Theme.panel3 : Theme.teal)
        .help(locked
            ? "Release the lock; the speed stays as it is until you change it."
            : "Set the time-lapse so one cycle of this depth lasts this long; its quarters become the pulses, finer cycles the subdivisions.")
    }

    private func lockChip(_ lock: SoundEngine.TempoLock) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "lock.fill").imageScale(.small)
            Text(words.lockChip(depth: lock.depth, seconds: lock.seconds))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .font(.caption.weight(.semibold).monospacedDigit())
        .foregroundStyle(Theme.teal)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Theme.teal.opacity(0.12), in: .capsule)
        .accessibilityElement(children: .combine)
    }

    // MARK: Rhythm

    private func rhythm(_ prefs: SoundPreferences) -> some View {
        let chips = words.rhythm(depth: prefs.tempoDepth, rate: store.rate, prefs: prefs)
        return SoundFlowLayout(spacing: 6, lineSpacing: 6) {
            ForEach(chips) { chip in
                HStack(spacing: 4) {
                    Text(chip.letter)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(Theme.levelColor(chip.level, lightness: 0.72))
                    Text(chip.length)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(chip.off ? Theme.ink3 : Theme.ink2)
                    switch chip.mark {
                    case .quarters: Text("♪").font(.caption.weight(.bold)).foregroundStyle(Theme.teal)
                    case .ends: Text("♪ end").font(.caption.weight(.bold)).foregroundStyle(Theme.teal.opacity(0.8))
                    case .none: EmptyView()
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Theme.levelColor(chip.level, opacity: chip.mark == .none ? 0.05 : 0.12, lightness: 0.5), in: .capsule)
                .overlay {
                    Capsule().strokeBorder(Theme.levelColor(chip.level, opacity: 0.3, lightness: 0.6), style: StrokeStyle(lineWidth: 1, dash: chip.off ? [3, 3] : []))
                }
                .help(chip.help)
                .accessibilityElement(children: .combine)
                .accessibilityHint(chip.help)
                if let factor = chip.factor {
                    Text("×\(factor)")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(Theme.ink3)
                }
            }
        }
    }

    // MARK: Speeds

    private var speeds: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(words.speedChips) { chip in
                    let active = isActive(chip.action)
                    Button {
                        perform(chip.action)
                    } label: {
                        VStack(spacing: 0) {
                            Text(chip.label)
                                .font(.footnote.weight(.semibold).monospacedDigit())
                            if !chip.unit.isEmpty {
                                Text(chip.unit)
                                    .font(.caption2)
                                    .opacity(0.75)
                            }
                        }
                        .lineLimit(1)
                        .padding(.horizontal, 11)
                        .frame(minHeight: 38)
                        .foregroundStyle(active ? Theme.background : Theme.ink2)
                        .background(active ? Theme.teal : Theme.panel3.opacity(0.7), in: .capsule)
                        .contentShape(.capsule)
                    }
                    .buttonStyle(.plain)
                    .help(chip.help)
                    .accessibilityHint(chip.help)
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
        }
        .scrollIndicators(.hidden)
        .sensoryFeedback(.selection, trigger: store.revision) { _, _ in settings.haptics }
    }

    private func isActive(_ action: SoundWords.SpeedChip.Action) -> Bool {
        switch action {
        case .live: store.isLive
        case .pause: store.isPaused
        case .reverse: !store.isLive && store.rate < 0
        case .rate(let r): !store.isLive && abs(store.rate - r) <= abs(r) * 1e-6
        }
    }

    private func perform(_ action: SoundWords.SpeedChip.Action) {
        switch action {
        case .live: store.goLive()
        case .pause: store.pause()
        case .reverse: store.setRate(store.rate == 0 ? -1 : -store.rate)
        case .rate(let r): store.setRate(r)
        }
    }
}

/// Chips that wrap onto as many lines as they need.
struct SoundFlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.reduce(0) { $0 + $1.height } + lineSpacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row {
        var items: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            let needed = row.items.isEmpty ? size.width : row.width + spacing + size.width
            if needed > width, !row.items.isEmpty {
                rows.append(row)
                row = Row()
            }
            row.width = row.items.isEmpty ? size.width : row.width + spacing + size.width
            row.height = max(row.height, size.height)
            row.items.append(index)
        }
        if !row.items.isEmpty { rows.append(row) }
        return rows
    }
}
