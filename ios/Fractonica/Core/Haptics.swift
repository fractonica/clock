#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

/// Haptic feedback, honouring the Haptics setting. iOS plays it on the Taptic Engine; macOS on a Force Touch
/// trackpad (alignment / level-change feels), where only selection-like kinds are felt.
///
///     Haptics.play(.step)   // a cycle step or a turnover
@MainActor
enum Haptics {
    enum Kind {
        /// A value or segment changed (pickers, scrubbing across states).
        case selection
        /// The clock moved by a cycle, or a cycle turned over.
        case step
        /// Something finished: a timer rang, an alert fired.
        case success
        /// Something could not happen (the catalogue ends there).
        case warning
    }

    static func play(_ kind: Kind = .selection) {
        guard AppSettings.shared.haptics else { return }
        #if os(iOS)
        switch kind {
        case .selection: UISelectionFeedbackGenerator().selectionChanged()
        case .step: UIImpactFeedbackGenerator(style: .soft).impactOccurred()
        case .success: UINotificationFeedbackGenerator().notificationOccurred(.success)
        case .warning: UINotificationFeedbackGenerator().notificationOccurred(.warning)
        }
        #elseif os(macOS)
        let pattern: NSHapticFeedbackManager.FeedbackPattern = kind == .selection ? .alignment : .levelChange
        NSHapticFeedbackManager.defaultPerformer.perform(pattern, performanceTime: .now)
        #endif
    }
}
