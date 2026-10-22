import SwiftUI
import WidgetKit

/// The widget extension, the same on iOS and macOS: the journal face, the clock, up next and the rings on the Home
/// Screen, the desktop and in StandBy; the extra-large overview on iPad and the Mac; the Helion Arc there and on the
/// Lock Screen; the Lock Screen accessories (iOS); the Focus and Timer controls; on iOS the timer's Live Activity.
@main
struct FractonicaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        JournalWidget()
        ClockWidget()
        UpNextWidget()
        RingsWidget()
        OverviewWidget()
        HelionArcWidget()
        #if os(iOS)
        AccessoryWidget()
        #endif
        FocusControl()
        TimerControl()
        #if os(iOS)
        TimerLiveActivityWidget()
        #endif
    }
}
