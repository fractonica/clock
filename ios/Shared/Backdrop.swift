import SwiftUI

/// The app's background: the near-black canvas with the web app's two faint glows, teal from the top left and cursor
/// blue from the bottom right (src/styles/app.css `body`). Put it behind whole screens: `.background { Backdrop() }`.
struct Backdrop: View {
    var body: some View {
        GeometryReader { geo in
            let reach = max(geo.size.width, geo.size.height)
            ZStack {
                Theme.background
                RadialGradient(
                    colors: [Theme.teal.opacity(0.09), .clear],
                    center: UnitPoint(x: 0.08, y: -0.1),
                    startRadius: 0,
                    endRadius: reach * 0.9
                )
                RadialGradient(
                    colors: [Theme.cursor.opacity(0.07), .clear],
                    center: UnitPoint(x: 1, y: 1.1),
                    startRadius: 0,
                    endRadius: reach * 0.8
                )
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}
