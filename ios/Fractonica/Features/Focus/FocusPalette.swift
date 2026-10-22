import SwiftUI

/// The theme's colours as the shaders take them: linear-light RGB of `Theme.levelColor` for α … π (levels past ξ share
/// its hue, as in `Theme.levelHue`), of `Theme.background` and of `Theme.teal`.
struct FocusPalette: Sendable {
    var levels: [SIMD3<Float>]
    var background: SIMD3<Float>
    var accent: SIMD3<Float>

    static let standard = FocusPalette()

    init() {
        let environment = EnvironmentValues()
        func linear(_ color: Color) -> SIMD3<Float> {
            let resolved = color.resolve(in: environment)
            return SIMD3(resolved.linearRed, resolved.linearGreen, resolved.linearBlue)
        }
        levels = (0..<FocusHarmonics.levelCount).map { linear(Theme.levelColor($0)) }
        background = linear(Theme.background)
        accent = linear(Theme.teal)
    }
}
