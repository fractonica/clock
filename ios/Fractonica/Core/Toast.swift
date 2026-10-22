import Observation
import SwiftUI

/// Short transient messages over the whole window ("End of the catalogue", "Link copied"), the web app's toast.
///
///     @Environment(ToastCenter.self) private var toasts
///     toasts.show("Showing the live clock")
@MainActor @Observable
final class ToastCenter {
    static let shared = ToastCenter()

    /// The message on screen, if any.
    private(set) var message: String?
    @ObservationIgnored private var hideTask: Task<Void, Never>?

    /// Shows `message` for `seconds`, replacing any message already showing.
    func show(_ message: String, for seconds: Double = 2.2) {
        hideTask?.cancel()
        withAnimation(.snappy) { self.message = message }
        AccessibilityNotification.Announcement(message).post()
        hideTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            withAnimation(.smooth) { self?.message = nil }
        }
    }

    /// Says why the clock could not move: the catalogue ends there.
    func show(_ edge: ClockStore.Edge) {
        show(edge == .end ? "End of the catalogue" : "Start of the catalogue")
    }
}

extension View {
    /// Shows the app's toasts at the top of this view. Applied once, at the root of each window.
    func toastOverlay() -> some View {
        modifier(ToastOverlay())
    }
}

private struct ToastOverlay: ViewModifier {
    @Environment(ToastCenter.self) private var toasts

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let message = toasts.message {
                Text(message)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Theme.ink)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .glassSurface(.regular, in: .capsule)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .accessibilityAddTraits(.updatesFrequently)
                    .allowsHitTesting(false)
                    .id(message)
            }
        }
    }
}
