import Observation

/// The Jump field's state, kept outside the Jump screen so that what opens Jump can also put the cursor in its field:
/// ⌘K and the iPhone Cycles tab's Jump button set `isFocused` before showing Jump (a sheet on iPhone, the sidebar's
/// search item on iPad and Mac). The Jump screen draws the field (under its title; in the window toolbar on the Mac)
/// and keeps its own focus and this value in step.
///
///     JumpSearch.shared.isFocused = true     // ⌘K: put the cursor in the field, even while Jump shows
@MainActor @Observable
final class JumpSearch {
    static let shared = JumpSearch()

    /// The text in the field.
    var query = ""
    /// The field has the keyboard focus. Set it to focus the field (⌘K) or to put the keyboard away; the Jump screen
    /// keeps its `@FocusState` and this value in step.
    var isFocused = false

    /// The field's placeholder.
    nonisolated static func prompt(pure: Bool) -> String { pure ? "Jump to a moment" : "Jump to a time" }
}
