import Observation

/// The Jump search field's state, shared by whoever draws the field and the Jump screen that reads it.
///
/// On iPhone the field lives in the tab bar (iOS 26 turns the search tab into it): the compact root applies
/// `.searchable` to its `TabView`, so the root owns the field and Jump only reads `query`. On iPad and Mac the Jump
/// screen draws its own field (under its title, in the window toolbar) bound to the same `query`.
///
///     JumpSearch.shared.isFocused = true     // ⌘K: put the cursor in the field, wherever it is
@MainActor @Observable
final class JumpSearch {
    static let shared = JumpSearch()

    /// The text in the field.
    var query = ""
    /// The field has the keyboard focus. Set it to focus the field (⌘K) or to put the keyboard away; the view that
    /// owns the field keeps its `@FocusState` and this value in step.
    var isFocused = false
    /// Bumped when Return is pressed in a field the Jump screen does not own (the iPhone tab bar's): Jump submits.
    private(set) var submissions = 0

    func submit() { submissions &+= 1 }

    /// The field's placeholder.
    nonisolated static func prompt(pure: Bool) -> String { pure ? "Jump to a moment" : "Jump to a time" }
}
