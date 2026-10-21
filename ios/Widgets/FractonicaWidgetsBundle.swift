import SwiftUI
import WidgetKit

/// The widget extension: the clock widgets on both platforms and, on iOS, the timer's Live Activity.
@main
struct FractonicaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        ClockWidgets()
        #if os(iOS)
        TimerLiveActivityWidget()
        #endif
    }
}
