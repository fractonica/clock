#if os(macOS)
import AppKit
import FractonicaKit
import SwiftUI

// The macOS-only scenes around the main window: Focus in a window of its own that goes full screen, and the menu
// bar clock with its panel.

// MARK: - Focus window

/// Focus mode in its own window, which enters full screen as it opens; closing it (or Focus's own close) ends Focus.
struct FocusWindow: View {
    var body: some View {
        FocusScreen()
            .environment(\.isImmersive, true)
            .frame(minWidth: 480, minHeight: 320)
            .background { Backdrop() }
            .background { FullScreenRequest() }
    }
}

/// Puts its window into full screen once, when it first appears in one.
private struct FullScreenRequest: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView { RequestView() }
    func updateNSView(_ nsView: NSView, context: Context) {}

    private final class RequestView: NSView {
        private var requested = false

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard !requested, let window, !window.styleMask.contains(.fullScreen) else { return }
            requested = true
            Task { @MainActor in window.toggleFullScreen(nil) }
        }
    }
}

// MARK: - Menu bar clock

/// The menu bar item: the live minor clock led by its Pentad, "⬠ II 34η 29ι" (the Pentad's shape and numeral, the
/// Helion in its Nuclide and the Preons completed); the Hypopentad's square alone.
struct MenuBarLabel: View {
    @State private var reading = MenuBarLabel.Reading(at: .now)

    var body: some View {
        // A TimelineView in a MenuBarExtra label makes AppKit re-request the status item forever (100 % CPU at launch,
        // no window); a plain Text refreshed by a task on each whole second does not. The status item takes a label's
        // Image as its image and its Text as its title, but drops an image inside a Text (`Text.pentadMark` leaves an
        // empty object character there): so the shape is the item's image, the numeral starts its title. The Pentad
        // changes once a Helion (`Pentads.at` keeps it for the running Helion): the label changes with the Preon.
        HStack(spacing: 3) {
            if let pentad = reading.pentad {
                Image(systemName: pentad == 3 ? "square" : "pentagon")
            }
            Text(verbatim: reading.title)
        }
            .monospacedDigit()
            .accessibilityLabel(Text(verbatim: PentadWords.lead("Fractonica clock", index: reading.pentad)))
            .task {
                while !Task.isCancelled {
                    let t = Date.now.timeIntervalSince1970
                    try? await Task.sleep(for: .seconds(t.rounded(.down) + 1 - t + 0.005))
                    let next = MenuBarLabel.Reading(at: .now)
                    if next != reading { reading = next }
                }
            }
    }

    /// What the label shows: the Pentad (nil outside the catalogue) and the title after its shape, the Pentad's numeral
    /// and the minor clock down to the Preon ("II 34η 29ι"; the Hypopentad's square has no numeral).
    private struct Reading: Equatable {
        let pentad: Int?
        let title: String

        init(at date: Date) {
            let t = date.timeIntervalSince1970
            pentad = Pentads.index(at: t)
            let numeral = pentad.map { Notation.pentadNumerals[$0] } ?? ""
            let clock = Notation.standard.clockText(at: t, upTo: "iota")
            title = numeral.isEmpty ? clock : "\(numeral) \(clock)"
        }
    }
}

/// The panel under the menu bar clock: the live reading (the minor clock with the Helion pair, the short date and,
/// in Earth mode, the local time) and quick actions (open, Focus, Timer, sound on / off, pure mode, quit).
struct MenuBarPanel: View {
    @Environment(AppSettings.self) private var settings
    @Environment(AppRouter.self) private var router
    @Environment(\.openWindow) private var openWindow
    private var sound: SoundEngine { .shared }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                reading(at: context.date.timeIntervalSince1970)
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            Divider().padding(.horizontal, 8)
            VStack(spacing: 2) {
                MenuRow("Open Fractonica", systemImage: "macwindow") { open(nil) }
                MenuRow("Focus", systemImage: Screen.focus.systemImage) {
                    openWindow(id: WindowID.focus)
                    NSApp.activate()
                }
                MenuRow("Timer", systemImage: Screen.timer.systemImage) { open(.timer) }
                MenuRow(sound.isOn ? "Sound Off" : "Sound", systemImage: sound.isOn ? "speaker.slash" : Screen.sound.systemImage) {
                    sound.toggle()
                }
                MenuRow(settings.pure ? "Pure Mode Off" : "Pure Mode", systemImage: "character.book.closed") { settings.pure.toggle() }
                Divider().padding(.horizontal, 8).padding(.vertical, 4)
                MenuRow("Quit Fractonica", systemImage: "power") { NSApp.terminate(nil) }
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 8)
        }
        .frame(width: 300)
    }

    private func reading(at t: Double) -> some View {
        let words = settings.wording
        let helion = FractonicaClock.shared.level(at: t, 6)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 12) {
                Text(words.notation.clockText(at: t))
                    .font(.reading(24, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                Spacer(minLength: 0)
                if let helion {
                    PairView(fraction: helion.phase, color: Theme.teal, height: 26)
                }
            }
            // the date led by its Pentad, as a civil date by its weekday
            Text.ledByPentad(Pentads.index(at: t), Text(verbatim: words.notation.dateText(at: t, upTo: "epsilon")))
                .font(.callout)
                .foregroundStyle(Theme.ink2)
            if !words.pure {
                Text("\(words.earth.long(t)) · \(words.tag(t))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(Theme.ink3)
            }
        }
    }

    /// Brings the main window forward, on `screen` if given.
    private func open(_ screen: Screen?) {
        if let screen { router.show(screen) }
        openWindow(id: WindowID.main)
        NSApp.activate()
    }
}

/// A full-width row that highlights under the pointer, like a menu item.
private struct MenuRow: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    @State private var hovering = false

    init(_ title: String, systemImage: String, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(hovering ? Theme.teal.opacity(0.18) : .clear, in: .rect(cornerRadius: 6))
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
#endif
