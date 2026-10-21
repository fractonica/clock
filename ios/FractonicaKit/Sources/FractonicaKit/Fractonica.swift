/// The Fractonica clock's fixed vocabulary (SPEC §3, §6.2, §14): the harmonic factor sequence, the period letters,
/// the quarter names and the Saros 141 catalogue. Ports `F.defaults`, `F.periodName` and model.js's constants.
public enum Fractonica {
    /// Default harmonic factor sequence S (SPEC §3.1): a level-L cycle holds S[L mod 8] cycles of level L+1, and
    /// P(L) = P(L−1) · S[(L−1) mod 8] with P(0) = 1.
    public static let sequence: [Int] = [5, 13, 5, 5, 7, 11, 9, 4]

    /// Period letters, one per level; after ω they repeat with a numeric suffix (SPEC §3.4).
    public static let greek = "αβγδεζηθικλμνξοπρστυφχψω"

    /// Deepest level the UI shows (depth 14, ξ: 44 ms cycles), per SPEC §3.3. model.js `MAX_LEVEL`.
    public static let maxLevel = 13

    /// Levels the engine computes readings for (depth 1 … 21, well past the 44 ms of depth 14). Within it every exact
    /// product fits 128-bit integers with room to spare; readings outside it are `nil`.
    public static let supportedLevels = 0...20

    /// Quarter names of a cycle for the ascending family, named by the threshold that ends them (SPEC §6.2).
    public static let quarterNames = ["peak", "node", "valley", "end"]

    /// `F.periodName(level)`: the letter of `level mod 24` and, from the second alphabet on, a numeric suffix
    /// (level 24 is α1, level 49 is β2). Negative levels, which the library rejects, read as level 0.
    public static func periodName(_ level: Int) -> (letter: String, suffix: String, text: String) {
        let level = max(0, level)
        let letter = greekLetters[level % greekLetters.count]
        let round = level / greekLetters.count
        let suffix = round > 0 ? String(round) : ""
        return (letter, suffix, letter + suffix)
    }

    /// The 24 letters as strings, indexed by level.
    static let greekLetters: [String] = greek.map(String.init)
}
