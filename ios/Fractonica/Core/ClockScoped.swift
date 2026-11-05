import FractonicaKit

/// One instance per reference series, for the app's long-lived models that read the clock once (a screen's caches, a
/// window kept between visits): made on first use, and made again on the first use after the reference series has
/// changed (`ReferenceSaros`), so a model never mixes two catalogues.
///
///     private static let scoped = ClockScoped { TimelineData() }
///     static var shared: TimelineData { scoped.value }
@MainActor
final class ClockScoped<Value: AnyObject> {
    private let make: @MainActor () -> Value
    private var kept: (series: Int, value: Value)?

    init(_ make: @escaping @MainActor () -> Value) {
        self.make = make
    }

    /// The instance for the reference series now.
    var value: Value {
        let series = FractonicaClock.shared.series
        if let kept, kept.series == series { return kept.value }
        let value = make()
        kept = (series, value)
        return value
    }
}
